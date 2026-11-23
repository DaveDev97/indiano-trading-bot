// Interfaccia comune del broker (Alpaca paper e finto). I numeri sono già convertiti da stringa.

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
export type TimeInForce = "day" | "gtc";
export type OrderClass = "simple" | "bracket" | "oco" | "oto" | "";

/** Stati finali: tutti gli altri sono "aperti" (CLAUDE.md, note Alpaca). */
export const FINAL_STATUSES = new Set(["filled", "canceled", "expired", "replaced", "rejected", "done_for_day", "stopped", "suspended"]);
// done_for_day non è propriamente finale ma l'ordine non lavora più fino alla seduta dopo: per prudenza
// lo trattiamo come APERTO nelle protezioni (vedi isOpenStatus).

export function isOpenStatus(status: string): boolean {
  if (status === "done_for_day") return true;
  return !FINAL_STATUSES.has(status);
}

export interface Order {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  filledQty: number;
  filledAvgPrice: number | null;
  status: string;
  orderClass: OrderClass;
  limitPrice: number | null;
  stopPrice: number | null;
  trailPercent: number | null;
  trailPrice: number | null;
  hwm: number | null;
  tif: TimeInForce;
  createdAt: string;
  filledAt: string | null;
  canceledAt: string | null;
  expiresAt: string | null;
  legs: Order[];
  /** Id dell'ordine "padre" se questo è una gamba (ricostruito da noi). */
  parentId?: string | null;
  replacedBy?: string | null;
}

export interface OrderRequest {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  tif: TimeInForce;
  limitPrice?: number;
  stopPrice?: number;
  trailPercent?: number;
  trailPrice?: number;
  orderClass?: "simple" | "bracket" | "oco";
  takeProfit?: { limitPrice: number };
  stopLoss?: { stopPrice: number };
}

export interface ReplaceRequest {
  qty?: number;
  limitPrice?: number;
  stopPrice?: number;
  trail?: number;
}

export interface Position {
  symbol: string;
  qty: number;
  qtyAvailable: number | null;
  avgEntryPrice: number;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  side: "long" | "short";
}

export interface Account {
  equity: number;
  lastEquity: number | null;
  cash: number;
  buyingPower: number | null;
  status: string;
  tradingBlocked: boolean;
  accountBlocked: boolean;
  currency: string;
}

export interface AccountConfig {
  noShorting: boolean | null;
  maxMarginMultiplier: string | null;
}

export interface Clock {
  timestamp: string;
  isOpen: boolean;
  nextOpen: string;
  nextClose: string;
}

export interface CalendarDay {
  /** Data della seduta "AAAA-MM-GG" (New York). */
  date: string;
  /** "HH:MM" New York. */
  open: string;
  close: string;
}

export interface PortfolioHistory {
  /** Secondi epoch. */
  timestamps: number[];
  equity: (number | null)[];
}

export interface Asset {
  symbol: string;
  name: string;
  exchange: string;
  status: string;
  tradable: boolean;
  assetClass: string;
}

export interface OrderQuery {
  status: "open" | "closed" | "all";
  after?: string;
  until?: string;
  symbols?: string[];
  limit?: number;
}

export interface Broker {
  readonly name: "alpaca-paper" | "finto";
  getAccount(): Promise<Account>;
  getAccountConfig(): Promise<AccountConfig>;
  patchAccountConfig(c: { noShorting: boolean; maxMarginMultiplier: string }): Promise<AccountConfig>;
  getPositions(): Promise<Position[]>;
  getPosition(symbol: string): Promise<Position | null>;
  listOrders(q: OrderQuery): Promise<Order[]>;
  getOrder(id: string): Promise<Order | null>;
  getOrderByClientId(clientOrderId: string): Promise<Order | null>;
  submitOrder(r: OrderRequest): Promise<Order>;
  replaceOrder(id: string, r: ReplaceRequest): Promise<Order>;
  cancelOrder(id: string): Promise<void>;
  getClock(): Promise<Clock>;
  getCalendar(start: string, end: string): Promise<CalendarDay[]>;
  getPortfolioHistory(start: string): Promise<PortfolioHistory>;
  listAssets(): Promise<Asset[]>;
}

/** Errore del broker con stato HTTP (null = rete o timeout). */
export class BrokerError extends Error {
  constructor(
    readonly kind: "timeout" | "rete" | "http" | "non-trovato",
    readonly status: number | null,
    message: string,
    readonly code: string | number | null = null,
  ) {
    super(message);
    this.name = "BrokerError";
  }
}

/** Appiattisce ordini e gambe, senza duplicati, ricordando il padre. */
export function flattenOrders(orders: Order[]): Order[] {
  const seen = new Map<string, Order>();
  const visit = (o: Order, parent: string | null) => {
    if (!seen.has(o.id)) seen.set(o.id, { ...o, parentId: o.parentId ?? parent });
    for (const l of o.legs ?? []) visit(l, o.id);
  };
  for (const o of orders) visit(o, null);
  return [...seen.values()];
}
