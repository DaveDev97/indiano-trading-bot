// Broker finto: simula Alpaca paper con bracket, OCO, trailing stop, cancellazioni e guasti iniettabili.
// Usato dai test e da --fake. Lo stato si può salvare su file per usarlo tra un lancio e l'altro.
import * as fs from "node:fs";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { dateInTz, TZ_NY, zonedToUtc, addDays } from "../util/time.ts";
import { fakeCalendar } from "../data/calendario-finto.ts";
import {
  BrokerError,
  isOpenStatus,
  type Account,
  type AccountConfig,
  type Asset,
  type Broker,
  type CalendarDay,
  type Clock,
  type Order,
  type OrderQuery,
  type OrderRequest,
  type PortfolioHistory,
  type Position,
  type ReplaceRequest,
} from "./types.ts";

interface StoredOrder extends Order {
  legIds: string[];
}

export interface FakeBrokerState {
  cash: number;
  positions: Record<string, { qty: number; avgEntryPrice: number }>;
  orders: StoredOrder[];
  prices: Record<string, number>;
  config: { noShorting: boolean; maxMarginMultiplier: string };
  equityHistory: { date: string; equity: number }[];
  seq: number;
  assets: Asset[];
}

export interface FakeFaults {
  /** L'ordine arriva al broker ma la chiamata va in timeout. */
  submitTimeoutAccepted?: (r: OrderRequest) => boolean;
  /** La chiamata va in timeout e l'ordine NON arriva. */
  submitTimeoutLost?: (r: OrderRequest) => boolean;
  /** Rifiuto con messaggio (422). */
  rejectSubmit?: (r: OrderRequest) => string | null;
  /** La cancellazione resta "pending_cancel" per sempre. */
  cancelNeverConfirms?: boolean;
  /** Alla richiesta di cancellazione di una protezione del simbolo, la gamba stop si esegue. */
  fillOnCancel?: Set<string>;
  /** Gli acquisti a mercato non si eseguono mai. */
  marketNeverFills?: boolean;
  /** La configurazione del conto non si lascia cambiare. */
  configLocked?: boolean;
  /** Le modifiche (PATCH) falliscono. */
  replaceFails?: boolean;
  /** Creazione di trailing stop fallisce. */
  rejectTrailing?: boolean;
  /** Tutte le chiamate falliscono con errore di rete. */
  down?: boolean;
}

export interface FakeBrokerOpts {
  now: () => Date;
  file?: string;
  initialCash?: number;
  priceProvider?: (symbol: string, now: Date) => number | null;
  calendar?: (start: string, end: string) => CalendarDay[];
}

function initialState(cash: number): FakeBrokerState {
  return {
    cash,
    positions: {},
    orders: [],
    prices: {},
    config: { noShorting: false, maxMarginMultiplier: "4" }, // come un conto paper appena aperto
    equityHistory: [],
    seq: 1,
    assets: [],
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function decimalsOk(p: number): boolean {
  const s = p >= 1 ? 100 : 10_000;
  return Math.abs(Math.round(p * s) - p * s) < 1e-6;
}

export class FakeBroker implements Broker {
  readonly name = "finto" as const;
  state: FakeBrokerState;
  faults: FakeFaults = {};
  /** Registro delle chiamate (per i test). */
  calls: { method: string; arg?: unknown }[] = [];
  private readonly calendarFn: (s: string, e: string) => CalendarDay[];

  constructor(private readonly opts: FakeBrokerOpts) {
    this.calendarFn = opts.calendar ?? fakeCalendar;
    let st: FakeBrokerState | null = null;
    if (opts.file) {
      const r = readJsonSafe<FakeBrokerState>(opts.file);
      if (r.ok) st = r.value;
    }
    this.state = st ?? initialState(opts.initialCash ?? 100_000);
  }

  // ---------- utilità interne ----------
  private now(): Date {
    return this.opts.now();
  }
  private save(): void {
    if (this.opts.file) writeJsonAtomic(this.opts.file, this.state);
  }
  private guard(method: string, arg?: unknown): void {
    this.calls.push({ method, arg });
    if (this.faults.down) throw new BrokerError("rete", null, "rete non raggiungibile (finto)");
  }
  private newId(): string {
    return `fake-${String(this.state.seq++).padStart(6, "0")}`;
  }
  price(symbol: string): number | null {
    const p = this.opts.priceProvider?.(symbol, this.now());
    if (p != null) {
      this.state.prices[symbol] = p;
      return p;
    }
    return this.state.prices[symbol] ?? null;
  }
  setPrice(symbol: string, p: number): void {
    this.state.prices[symbol] = p;
    this.step();
    this.save();
  }
  isMarketOpen(at = this.now()): boolean {
    const d = dateInTz(at, TZ_NY);
    const cal = this.calendarFn(d, d)[0];
    if (!cal) return false;
    const o = zonedToUtc(d, cal.open, TZ_NY).getTime();
    const c = zonedToUtc(d, cal.close, TZ_NY).getTime();
    return at.getTime() >= o && at.getTime() < c;
  }
  private find(id: string): StoredOrder | undefined {
    return this.state.orders.find((o) => o.id === id);
  }
  private expand(o: StoredOrder): Order {
    const { legIds, ...rest } = o;
    return { ...rest, legs: legIds.map((id) => this.find(id)).filter(Boolean).map((l) => this.expand(l!)) };
  }
  private heldSellQty(symbol: string, exceptGroup?: Set<string>): number {
    // quantità impegnata da ordini di vendita aperti (per gruppo OCO/bracket si conta una volta sola)
    const groups = new Map<string, number>();
    for (const o of this.state.orders) {
      if (o.symbol !== symbol || o.side !== "sell" || !isOpenStatus(o.status)) continue;
      const g = o.parentId ?? o.id;
      if (exceptGroup?.has(g)) continue;
      groups.set(g, Math.max(groups.get(g) ?? 0, o.qty - o.filledQty));
    }
    return [...groups.values()].reduce((a, b) => a + b, 0);
  }
  private fill(o: StoredOrder, price: number): void {
    const qty = o.qty - o.filledQty;
    const pos = this.state.positions[o.symbol] ?? { qty: 0, avgEntryPrice: 0 };
    if (o.side === "buy") {
      const newQty = pos.qty + qty;
      pos.avgEntryPrice = newQty > 0 ? (pos.avgEntryPrice * pos.qty + price * qty) / newQty : 0;
      pos.qty = newQty;
      this.state.cash -= qty * price;
    } else {
      pos.qty -= qty;
      this.state.cash += qty * price;
    }
    if (pos.qty === 0) delete this.state.positions[o.symbol];
    else this.state.positions[o.symbol] = pos;
    o.filledQty = o.qty;
    o.filledAvgPrice = price;
    o.status = "filled";
    o.filledAt = this.now().toISOString();
    // bracket: all'esecuzione del padre si attivano le gambe
    if (o.orderClass === "bracket" && o.side === "buy") {
      for (const id of o.legIds) {
        const l = this.find(id);
        if (l && l.status === "held_parent") l.status = l.type === "stop" ? "held" : "new";
      }
    }
    // OCO / bracket: un'esecuzione cancella le sorelle
    const groupId = o.parentId ?? (o.orderClass === "oco" ? o.id : null);
    if (o.side === "sell" && groupId) {
      for (const s of this.state.orders) {
        if (s.id === o.id) continue;
        if ((s.parentId === groupId || s.id === groupId) && isOpenStatus(s.status) && s.side === "sell") {
          s.status = "canceled";
          s.canceledAt = this.now().toISOString();
        }
      }
    }
  }
  /** Fa avanzare il mercato: esegue gli ordini che devono essere eseguiti al prezzo attuale. */
  step(): void {
    if (!this.isMarketOpen()) {
      this.recordEquity();
      return;
    }
    for (const o of this.state.orders) {
      if (!isOpenStatus(o.status) || o.status === "held_parent" || o.status === "pending_cancel") continue;
      const p = this.price(o.symbol);
      if (p == null) continue;
      if (o.type === "market") {
        if (o.side === "buy" && this.faults.marketNeverFills) continue;
        this.fill(o, p);
      } else if (o.type === "limit") {
        if (o.side === "sell" && p >= (o.limitPrice ?? Infinity)) this.fill(o, Math.max(p, o.limitPrice!));
        if (o.side === "buy" && p <= (o.limitPrice ?? -Infinity)) this.fill(o, Math.min(p, o.limitPrice!));
      } else if (o.type === "stop") {
        if (o.side === "sell" && p <= (o.stopPrice ?? -Infinity)) this.fill(o, p);
      } else if (o.type === "trailing_stop") {
        o.hwm = Math.max(o.hwm ?? p, p);
        const stop = o.trailPercent != null ? o.hwm * (1 - o.trailPercent / 100) : o.hwm - (o.trailPrice ?? 0);
        o.stopPrice = round2(stop);
        if (p <= stop) this.fill(o, p);
      }
    }
    this.recordEquity();
  }
  private equity(): number {
    let eq = this.state.cash;
    for (const [s, p] of Object.entries(this.state.positions)) eq += p.qty * (this.price(s) ?? p.avgEntryPrice);
    return eq;
  }
  private recordEquity(): void {
    const d = dateInTz(this.now(), TZ_NY);
    const eq = this.equity();
    const last = this.state.equityHistory[this.state.equityHistory.length - 1];
    if (last && last.date === d) last.equity = eq;
    else this.state.equityHistory.push({ date: d, equity: eq });
  }

  // ---------- API ----------
  async getAccount(): Promise<Account> {
    this.guard("getAccount");
    this.step();
    const eq = this.equity();
    const prev = this.state.equityHistory.length >= 2 ? this.state.equityHistory[this.state.equityHistory.length - 2]!.equity : eq;
    return {
      equity: eq,
      lastEquity: prev,
      cash: this.state.cash,
      buyingPower: this.state.cash * Number(this.state.config.maxMarginMultiplier),
      status: "ACTIVE",
      tradingBlocked: false,
      accountBlocked: false,
      currency: "USD",
    };
  }
  async getAccountConfig(): Promise<AccountConfig> {
    this.guard("getAccountConfig");
    return { ...this.state.config };
  }
  async patchAccountConfig(c: { noShorting: boolean; maxMarginMultiplier: string }): Promise<AccountConfig> {
    this.guard("patchAccountConfig", c);
    if (!this.faults.configLocked) {
      this.state.config = { noShorting: c.noShorting, maxMarginMultiplier: c.maxMarginMultiplier };
      this.save();
    }
    return { ...this.state.config };
  }
  async getPositions(): Promise<Position[]> {
    this.guard("getPositions");
    this.step();
    this.save();
    return Object.entries(this.state.positions).map(([symbol, p]) => this.position(symbol, p));
  }
  private position(symbol: string, p: { qty: number; avgEntryPrice: number }): Position {
    const cur = this.price(symbol);
    return {
      symbol,
      qty: p.qty,
      qtyAvailable: p.qty - this.heldSellQty(symbol),
      avgEntryPrice: p.avgEntryPrice,
      currentPrice: cur,
      marketValue: cur != null ? cur * p.qty : null,
      unrealizedPl: cur != null ? (cur - p.avgEntryPrice) * p.qty : null,
      side: p.qty >= 0 ? "long" : "short",
    };
  }
  async getPosition(symbol: string): Promise<Position | null> {
    this.guard("getPosition", symbol);
    this.step();
    const p = this.state.positions[symbol];
    return p ? this.position(symbol, p) : null;
  }
  async listOrders(q: OrderQuery): Promise<Order[]> {
    this.guard("listOrders", q);
    this.step();
    return this.state.orders
      .filter((o) => (q.status === "all" ? true : q.status === "open" ? isOpenStatus(o.status) : !isOpenStatus(o.status)))
      .filter((o) => (q.after ? o.createdAt > q.after : true))
      .filter((o) => (q.until ? o.createdAt < q.until : true))
      .filter((o) => (q.symbols?.length ? q.symbols.includes(o.symbol) : true))
      .map((o) => ({ ...this.expand(o), status: o.status === "held_parent" ? "held" : o.status }))
      .reverse();
  }
  async getOrder(id: string): Promise<Order | null> {
    this.guard("getOrder", id);
    this.step();
    const o = this.find(id);
    return o ? this.publicOrder(o) : null;
  }
  private publicOrder(o: StoredOrder): Order {
    const e = this.expand(o);
    return { ...e, status: o.status === "held_parent" ? "held" : o.status };
  }
  async getOrderByClientId(cid: string): Promise<Order | null> {
    this.guard("getOrderByClientId", cid);
    this.step();
    const o = this.state.orders.find((x) => x.clientOrderId === cid);
    return o ? this.publicOrder(o) : null;
  }

  async submitOrder(r: OrderRequest): Promise<Order> {
    this.guard("submitOrder", r);
    if (this.faults.submitTimeoutLost?.(r)) throw new BrokerError("timeout", null, "timeout (finto, ordine perso)");
    if (this.state.orders.some((o) => o.clientOrderId === r.clientOrderId))
      throw new BrokerError("http", 422, "client_order_id must be unique", 40010001);
    const rej = this.faults.rejectSubmit?.(r);
    if (rej) throw new BrokerError("http", 422, rej, 42210000);
    if (r.type === "trailing_stop" && this.faults.rejectTrailing) throw new BrokerError("http", 422, "trailing stop rifiutato (finto)", 42210000);
    if (!Number.isInteger(r.qty) || r.qty <= 0) throw new BrokerError("http", 422, "qty must be a positive integer", 40010001);
    for (const p of [r.limitPrice, r.stopPrice, r.takeProfit?.limitPrice, r.stopLoss?.stopPrice, r.trailPrice])
      if (p !== undefined && !decimalsOk(p)) throw new BrokerError("http", 422, "invalid limit_price: sub-penny increment does not fulfill minimum pricing criteria", 42210000);
    const price = this.price(r.symbol);
    if (price == null) throw new BrokerError("http", 422, `asset ${r.symbol} not found`, 40410000);
    const now = this.now().toISOString();
    const base = (over: Partial<StoredOrder>): StoredOrder => ({
      id: this.newId(),
      clientOrderId: r.clientOrderId,
      symbol: r.symbol,
      side: r.side,
      type: r.type,
      qty: r.qty,
      filledQty: 0,
      filledAvgPrice: null,
      status: "new",
      orderClass: (r.orderClass ?? "simple") as any,
      limitPrice: r.limitPrice ?? null,
      stopPrice: r.stopPrice ?? null,
      trailPercent: r.trailPercent ?? null,
      trailPrice: r.trailPrice ?? null,
      hwm: null,
      tif: r.tif,
      createdAt: now,
      filledAt: null,
      canceledAt: null,
      expiresAt: r.tif === "gtc" ? new Date(this.now().getTime() + 90 * 86_400_000).toISOString() : null,
      legs: [],
      legIds: [],
      parentId: null,
      replacedBy: null,
      ...over,
    });
    if (r.side === "sell") {
      const pos = this.state.positions[r.symbol];
      const avail = (pos?.qty ?? 0) - this.heldSellQty(r.symbol);
      if (r.qty > avail) {
        if (this.state.config.noShorting || (pos?.qty ?? 0) > 0)
          throw new BrokerError("http", 403, `insufficient qty available for order (requested: ${r.qty}, available: ${Math.max(0, avail)})`, 40310000);
      }
    } else {
      if (r.qty * price > this.state.cash + 1e-6 && Number(this.state.config.maxMarginMultiplier) <= 1)
        throw new BrokerError("http", 403, "insufficient buying power", 40310000);
    }
    let parent: StoredOrder;
    if (r.orderClass === "bracket") {
      if (!r.takeProfit || !r.stopLoss) throw new BrokerError("http", 422, "bracket orders must have take_profit and stop_loss", 42210000);
      if (r.stopLoss.stopPrice > price - 0.01) throw new BrokerError("http", 422, "stop_loss.stop_price must be less than or equal to base_price - 0.01", 42210000);
      if (r.takeProfit.limitPrice < price + 0.01) throw new BrokerError("http", 422, "take_profit.limit_price must be greater than or equal to base_price + 0.01", 42210000);
      parent = base({});
      const tp = base({ id: this.newId(), clientOrderId: `${r.clientOrderId}-tp`, side: "sell", type: "limit", limitPrice: r.takeProfit.limitPrice, stopPrice: null, status: "held_parent", parentId: parent.id, orderClass: "bracket" });
      const sl = base({ id: this.newId(), clientOrderId: `${r.clientOrderId}-sl`, side: "sell", type: "stop", stopPrice: r.stopLoss.stopPrice, limitPrice: null, status: "held_parent", parentId: parent.id, orderClass: "bracket" });
      parent.legIds = [tp.id, sl.id];
      this.state.orders.push(parent, tp, sl);
    } else if (r.orderClass === "oco") {
      if (r.side !== "sell" || !r.takeProfit || !r.stopLoss) throw new BrokerError("http", 422, "oco orders must be sell with take_profit and stop_loss", 42210000);
      if (r.stopLoss.stopPrice > price - 0.01) throw new BrokerError("http", 422, "stop price must be below current price", 42210000);
      parent = base({ type: "limit", limitPrice: r.takeProfit.limitPrice, orderClass: "oco" });
      const sl = base({ id: this.newId(), clientOrderId: `${r.clientOrderId}-sl`, type: "stop", stopPrice: r.stopLoss.stopPrice, limitPrice: null, status: "held", parentId: parent.id, orderClass: "oco" });
      parent.legIds = [sl.id];
      this.state.orders.push(parent, sl);
    } else {
      parent = base({ status: this.isMarketOpen() ? "new" : "accepted" });
      if (r.type === "trailing_stop") parent.hwm = price;
      this.state.orders.push(parent);
    }
    this.step();
    this.save();
    if (this.faults.submitTimeoutAccepted?.(r)) throw new BrokerError("timeout", null, "timeout (finto, ordine arrivato)");
    return this.publicOrder(parent);
  }

  async replaceOrder(id: string, r: ReplaceRequest): Promise<Order> {
    this.guard("replaceOrder", { id, ...r });
    if (this.faults.replaceFails) throw new BrokerError("http", 422, "replace fallito (finto)", 42210000);
    const o = this.find(id);
    if (!o) throw new BrokerError("non-trovato", 404, "order not found", 40410000);
    if (!isOpenStatus(o.status) || o.status === "pending_cancel") throw new BrokerError("http", 422, "order is not replaceable", 42210000);
    for (const p of [r.limitPrice, r.stopPrice]) if (p !== undefined && !decimalsOk(p)) throw new BrokerError("http", 422, "sub-penny increment", 42210000);
    const nu: StoredOrder = { ...o, id: this.newId(), legIds: [...o.legIds], createdAt: this.now().toISOString() };
    if (r.qty !== undefined) nu.qty = r.qty;
    if (r.limitPrice !== undefined) nu.limitPrice = r.limitPrice;
    if (r.stopPrice !== undefined) nu.stopPrice = r.stopPrice;
    if (r.trail !== undefined) {
      if (o.trailPercent != null) nu.trailPercent = r.trail;
      else nu.trailPrice = r.trail;
    }
    o.status = "replaced";
    o.replacedBy = nu.id;
    this.state.orders.push(nu);
    // aggiorna i riferimenti delle gambe
    for (const x of this.state.orders) {
      x.legIds = x.legIds.map((l) => (l === o.id ? nu.id : l));
      if (x.parentId === o.id) x.parentId = nu.id;
    }
    this.step();
    this.save();
    return this.publicOrder(nu);
  }

  async cancelOrder(id: string): Promise<void> {
    this.guard("cancelOrder", id);
    const o = this.find(id);
    if (!o) throw new BrokerError("non-trovato", 404, "order not found", 40410000);
    if (!isOpenStatus(o.status)) throw new BrokerError("http", 422, `order is already in "${o.status}" state`, 42210000);
    const groupId = o.parentId ?? o.id;
    const group = this.state.orders.filter((x) => (x.id === groupId || x.parentId === groupId) && isOpenStatus(x.status) && x.side === o.side);
    if (o.side === "sell" && this.faults.fillOnCancel?.has(o.symbol)) {
      const stopLeg = group.find((x) => x.type === "stop" || x.type === "trailing_stop") ?? o;
      const p = this.price(o.symbol)!;
      this.fill(stopLeg, p);
      this.save();
      return;
    }
    for (const x of group) {
      if (this.faults.cancelNeverConfirms) x.status = "pending_cancel";
      else {
        x.status = "canceled";
        x.canceledAt = this.now().toISOString();
      }
    }
    this.save();
  }

  async getClock(): Promise<Clock> {
    this.guard("getClock");
    const now = this.now();
    const d = dateInTz(now, TZ_NY);
    const days = this.calendarFn(d, addDays(d, 10));
    let nextOpen = "", nextClose = "";
    for (const c of days) {
      const o = zonedToUtc(c.date, c.open, TZ_NY);
      const cl = zonedToUtc(c.date, c.close, TZ_NY);
      if (!nextClose && cl.getTime() > now.getTime()) nextClose = cl.toISOString();
      if (!nextOpen && o.getTime() > now.getTime()) nextOpen = o.toISOString();
    }
    return { timestamp: now.toISOString(), isOpen: this.isMarketOpen(now), nextOpen, nextClose };
  }
  async getCalendar(start: string, end: string): Promise<CalendarDay[]> {
    this.guard("getCalendar");
    return this.calendarFn(start, end);
  }
  async getPortfolioHistory(start: string): Promise<PortfolioHistory> {
    this.guard("getPortfolioHistory", start);
    this.step();
    const rows = this.state.equityHistory.filter((r) => r.date >= start);
    return {
      timestamps: rows.map((r) => Math.floor(zonedToUtc(r.date, "16:00", TZ_NY).getTime() / 1000)),
      equity: rows.map((r) => r.equity),
    };
  }
  async listAssets(): Promise<Asset[]> {
    this.guard("listAssets");
    return this.state.assets;
  }

  // ---------- comodità per i test ----------
  /** Inserisce una posizione e, se richiesto, una protezione OCO. */
  seedPosition(symbol: string, qty: number, avg: number, opts: { price?: number } = {}): void {
    this.state.positions[symbol] = { qty, avgEntryPrice: avg };
    this.state.prices[symbol] = opts.price ?? avg;
    this.save();
  }
  openOrders(symbol?: string): Order[] {
    return this.state.orders.filter((o) => isOpenStatus(o.status) && (!symbol || o.symbol === symbol)).map((o) => this.publicOrder(o));
  }
  submittedCount(filter: (r: OrderRequest) => boolean = () => true): number {
    return this.calls.filter((c) => c.method === "submitOrder" && filter(c.arg as OrderRequest)).length;
  }
  /** Ordini effettivamente creati (non le chiamate). */
  createdOrders(filter: (o: Order) => boolean = () => true): Order[] {
    return this.state.orders.filter((o) => !o.parentId).map((o) => this.publicOrder(o)).filter(filter);
  }
  wipeFile(): void {
    if (this.opts.file) fs.rmSync(this.opts.file, { force: true });
  }
}
