// Broker Alpaca, SOLO paper. L'URL è una costante: non si legge da nessuna configurazione.
import { PAPER_TRADING_URL } from "../config/costanti.ts";
import { HttpError, httpJson, type FetchFn } from "../util/http.ts";
import { dateInTz, TZ_NY } from "../util/time.ts";
import {
  BrokerError,
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

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseOrder(o: any, parentId: string | null = null): Order {
  return {
    id: String(o.id),
    clientOrderId: String(o.client_order_id ?? ""),
    symbol: String(o.symbol ?? ""),
    side: o.side,
    type: o.type ?? o.order_type,
    qty: num(o.qty) ?? 0,
    filledQty: num(o.filled_qty) ?? 0,
    filledAvgPrice: num(o.filled_avg_price),
    status: String(o.status),
    orderClass: o.order_class ?? "",
    limitPrice: num(o.limit_price),
    stopPrice: num(o.stop_price),
    trailPercent: num(o.trail_percent),
    trailPrice: num(o.trail_price),
    hwm: num(o.hwm),
    tif: o.time_in_force,
    createdAt: String(o.created_at ?? o.submitted_at ?? ""),
    filledAt: o.filled_at ?? null,
    canceledAt: o.canceled_at ?? null,
    expiresAt: o.expires_at ?? null,
    legs: Array.isArray(o.legs) ? o.legs.map((l: any) => parseOrder(l, String(o.id))) : [],
    parentId,
    replacedBy: o.replaced_by ?? null,
  };
}

/** Prezzo nel formato accettato da Alpaca: 2 decimali da 1 $ in su, 4 sotto. Il chiamante ha già arrotondato. */
export function priceStr(p: number): string {
  return p >= 1 ? p.toFixed(2) : p.toFixed(4);
}

export function orderBody(r: OrderRequest): Record<string, unknown> {
  const b: Record<string, unknown> = {
    symbol: r.symbol,
    qty: String(r.qty),
    side: r.side,
    type: r.type,
    time_in_force: r.tif,
    client_order_id: r.clientOrderId,
  };
  if (r.limitPrice !== undefined) b.limit_price = priceStr(r.limitPrice);
  if (r.stopPrice !== undefined) b.stop_price = priceStr(r.stopPrice);
  if (r.trailPercent !== undefined) b.trail_percent = String(r.trailPercent);
  if (r.trailPrice !== undefined) b.trail_price = priceStr(r.trailPrice);
  if (r.orderClass && r.orderClass !== "simple") b.order_class = r.orderClass;
  if (r.takeProfit) b.take_profit = { limit_price: priceStr(r.takeProfit.limitPrice) };
  if (r.stopLoss) b.stop_loss = { stop_price: priceStr(r.stopLoss.stopPrice) };
  return b;
}

export class AlpacaBroker implements Broker {
  readonly name = "alpaca-paper" as const;
  private readonly base = `${PAPER_TRADING_URL}/v2`;
  constructor(
    private readonly keyId: string,
    private readonly secretKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    if (keyId.toUpperCase().startsWith("AK")) throw new Error("chiave live rifiutata");
  }

  private async req<T = any>(method: string, p: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
    try {
      const r = await httpJson<T>(this.fetchFn, `${this.base}${p}`, {
        method,
        body,
        timeoutMs,
        headers: { "APCA-API-KEY-ID": this.keyId, "APCA-API-SECRET-KEY": this.secretKey },
      });
      return r.data;
    } catch (e) {
      if (e instanceof HttpError) {
        const code = e.body && typeof e.body === "object" ? ((e.body as any).code ?? null) : null;
        if (e.status === 404) throw new BrokerError("non-trovato", 404, e.message, code);
        throw new BrokerError(e.kind, e.status, e.message, code);
      }
      throw e;
    }
  }

  async getAccount(): Promise<Account> {
    const a = await this.req("GET", "/account");
    return {
      equity: num(a.equity) ?? 0,
      lastEquity: num(a.last_equity),
      cash: num(a.cash) ?? 0,
      buyingPower: num(a.buying_power),
      status: String(a.status),
      tradingBlocked: !!a.trading_blocked,
      accountBlocked: !!a.account_blocked,
      currency: String(a.currency ?? "USD"),
    };
  }

  async getAccountConfig(): Promise<AccountConfig> {
    const c = await this.req("GET", "/account/configurations");
    return { noShorting: typeof c.no_shorting === "boolean" ? c.no_shorting : null, maxMarginMultiplier: c.max_margin_multiplier != null ? String(c.max_margin_multiplier) : null };
  }

  async patchAccountConfig(c: { noShorting: boolean; maxMarginMultiplier: string }): Promise<AccountConfig> {
    const r = await this.req("PATCH", "/account/configurations", { no_shorting: c.noShorting, max_margin_multiplier: c.maxMarginMultiplier });
    return { noShorting: typeof r.no_shorting === "boolean" ? r.no_shorting : null, maxMarginMultiplier: r.max_margin_multiplier != null ? String(r.max_margin_multiplier) : null };
  }

  private parsePosition(p: any): Position {
    return {
      symbol: String(p.symbol),
      qty: num(p.qty) ?? 0,
      qtyAvailable: num(p.qty_available),
      avgEntryPrice: num(p.avg_entry_price) ?? 0,
      currentPrice: num(p.current_price),
      marketValue: num(p.market_value),
      unrealizedPl: num(p.unrealized_pl),
      side: p.side === "short" ? "short" : "long",
    };
  }

  async getPositions(): Promise<Position[]> {
    const ps = await this.req<any[]>("GET", "/positions");
    return ps.map((p) => this.parsePosition(p));
  }

  async getPosition(symbol: string): Promise<Position | null> {
    try {
      return this.parsePosition(await this.req("GET", `/positions/${encodeURIComponent(symbol)}`));
    } catch (e) {
      if (e instanceof BrokerError && e.kind === "non-trovato") return null;
      throw e;
    }
  }

  async listOrders(q: OrderQuery): Promise<Order[]> {
    const out: Order[] = [];
    const limit = q.limit ?? 500;
    let until = q.until;
    for (let page = 0; page < 20; page++) {
      const sp = new URLSearchParams({ status: q.status, limit: String(limit), direction: "desc", nested: "false" });
      if (q.after) sp.set("after", q.after);
      if (until) sp.set("until", until);
      if (q.symbols?.length) sp.set("symbols", q.symbols.join(","));
      const rows = await this.req<any[]>("GET", `/orders?${sp}`);
      const parsed = rows.map((o) => parseOrder(o));
      out.push(...parsed);
      if (rows.length < limit) break;
      const oldest = parsed[parsed.length - 1]?.createdAt;
      if (!oldest || oldest === until) break;
      until = oldest;
    }
    const seen = new Set<string>();
    return out.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  }

  async getOrder(id: string): Promise<Order | null> {
    try {
      return parseOrder(await this.req("GET", `/orders/${encodeURIComponent(id)}?nested=true`));
    } catch (e) {
      if (e instanceof BrokerError && e.kind === "non-trovato") return null;
      throw e;
    }
  }

  async getOrderByClientId(clientOrderId: string): Promise<Order | null> {
    try {
      return parseOrder(await this.req("GET", `/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}&nested=true`));
    } catch (e) {
      if (e instanceof BrokerError && e.kind === "non-trovato") return null;
      throw e;
    }
  }

  async submitOrder(r: OrderRequest): Promise<Order> {
    if (r.clientOrderId.length > 128) throw new Error("client_order_id oltre 128 caratteri");
    return parseOrder(await this.req("POST", "/orders", orderBody(r), 15_000));
  }

  async replaceOrder(id: string, r: ReplaceRequest): Promise<Order> {
    const b: Record<string, unknown> = {};
    if (r.qty !== undefined) b.qty = String(r.qty);
    if (r.limitPrice !== undefined) b.limit_price = priceStr(r.limitPrice);
    if (r.stopPrice !== undefined) b.stop_price = priceStr(r.stopPrice);
    if (r.trail !== undefined) b.trail = String(r.trail);
    return parseOrder(await this.req("PATCH", `/orders/${encodeURIComponent(id)}`, b, 15_000));
  }

  async cancelOrder(id: string): Promise<void> {
    await this.req("DELETE", `/orders/${encodeURIComponent(id)}`);
  }

  async getClock(): Promise<Clock> {
    const c = await this.req("GET", "/clock");
    return { timestamp: c.timestamp, isOpen: !!c.is_open, nextOpen: c.next_open, nextClose: c.next_close };
  }

  async getCalendar(start: string, end: string): Promise<CalendarDay[]> {
    const rows = await this.req<any[]>("GET", `/calendar?start=${start}&end=${end}`);
    return rows.map((d) => ({ date: String(d.date), open: String(d.open).slice(0, 5), close: String(d.close).slice(0, 5) }));
  }

  async getPortfolioHistory(start: string): Promise<PortfolioHistory> {
    // end esplicito: senza, prima dell'apertura Alpaca usa l'ultima chiusura e rifiuta uno start di oggi ("start cannot be after end")
    const sp = new URLSearchParams({ timeframe: "1D", start: `${start}T00:00:00Z`, end: new Date().toISOString(), intraday_reporting: "market_hours", pnl_reset: "per_day" });
    const h = await this.req("GET", `/account/portfolio/history?${sp}`);
    return { timestamps: (h.timestamp ?? []).map(Number), equity: (h.equity ?? []).map((v: unknown) => num(v)) };
  }

  async listAssets(): Promise<Asset[]> {
    const rows = await this.req<any[]>("GET", "/assets?status=active&asset_class=us_equity", undefined, 60_000);
    return rows.map((a) => ({
      symbol: String(a.symbol),
      name: String(a.name ?? ""),
      exchange: String(a.exchange ?? ""),
      status: String(a.status),
      tradable: !!a.tradable,
      assetClass: String(a.class ?? a.asset_class ?? ""),
    }));
  }
}

/** Data di seduta NY di un istante (utile per gli ordini). */
export function nyDateOf(iso: string): string {
  return dateInTz(new Date(iso), TZ_NY);
}
