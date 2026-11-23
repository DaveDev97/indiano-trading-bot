// Interfacce dei dati di mercato e fondamentali.

/** Candela giornaliera. t = data della seduta "AAAA-MM-GG" (New York). */
export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Adjustment = "all" | "split";

export interface Snapshot {
  /** Ultimo prezzo (IEX, tempo reale): solo per il prezzo, mai per i volumi. */
  price: number;
  time: string;
  dailyOpen: number | null;
  prevClose: number | null;
  /** Data (NY) e chiusura della candela del giorno dello snapshot: prima dell'apertura è ancora quella della seduta precedente. */
  dailyDate: string | null;
  dailyClose: number | null;
}

/** Variazione dall'ultima chiusura vera (come last_equity del conto). Prima dell'apertura il riferimento è la chiusura della candela del giorno. */
export function variazioneDaChiusura(s: Snapshot | undefined, oggiNy: string): number | null {
  if (!s) return null;
  const rif = s.dailyDate && s.dailyDate < oggiNy ? s.dailyClose : s.prevClose;
  return rif ? s.price / rif - 1 : null;
}

export interface MarketData {
  /**
   * Candele giornaliere, SIP. `end` deve essere almeno 16 minuti fa (piano gratuito).
   * NON filtra la seduta in corso: usare closedBars().
   */
  getDailyBars(symbols: string[], opts: { start: string; end: Date; adjustment: Adjustment }): Promise<Record<string, Bar[]>>;
  getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>>;
}

export interface FinnhubMetric {
  metric: Record<string, number | string | null>;
  series?: { annual?: Record<string, { period: string; v: number }[]>; quarterly?: Record<string, { period: string; v: number }[]> };
}

export interface FinnhubProfile {
  name?: string;
  ticker?: string;
  exchange?: string;
  finnhubIndustry?: string;
  marketCapitalization?: number;
  country?: string;
  currency?: string;
  [k: string]: unknown;
}

export interface EarningsItem {
  symbol: string;
  date: string;
  hour?: string;
}

export interface Fundamentals {
  getMetrics(symbol: string): Promise<FinnhubMetric | null>;
  getProfile(symbol: string): Promise<FinnhubProfile | null>;
  /** null = non verificabile (errore). [] = nessuna trimestrale nel periodo. */
  getEarnings(symbol: string, from: string, to: string): Promise<EarningsItem[] | null>;
}
