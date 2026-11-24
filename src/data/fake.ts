// Mercato finto deterministico: candele, snapshot, fondamentali e trimestrali. Per test e --fake.
import type { Asset, CalendarDay } from "../broker/types.ts";
import { fakeCalendar } from "./calendario-finto.ts";
import { addDays, dateInTz, TZ_NY, zonedToUtc } from "../util/time.ts";
import { ETF_SETTORE, BENCHMARK, type Settore } from "../config/settori.ts";
import type { MetricId } from "../config/campi-finnhub.ts";
import { CAMPI_FINNHUB } from "../config/campi-finnhub.ts";
import type { Adjustment, Bar, EarningsItem, FinnhubMetric, FinnhubProfile, Fundamentals, MarketData, Snapshot } from "./types.ts";

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-12);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface FakeSymbolSpec {
  symbol: string;
  name: string;
  industry: string | null;
  exchange: string;
  drift: number;
  vol: number;
  start: number;
  volume: number;
  metrics: Partial<Record<MetricId, number | null>>;
  peSeries?: number[];
  /** Trimestrale fra N giorni di calendario (null = data non verificabile). */
  earningsInDays?: number | null;
  isEtf?: boolean;
  /** Sede della società (campo country di Finnhub); se manca, "US". */
  country?: string;
}

const FIRST_DAY = "2024-06-03";

function spec(symbol: string, name: string, industry: string | null, drift: number, metrics: FakeSymbolSpec["metrics"], extra: Partial<FakeSymbolSpec> = {}): FakeSymbolSpec {
  return { symbol, name, industry, exchange: "NYSE", drift, vol: 0.018, start: 40 + (hashStr(symbol) % 120), volume: 1_500_000, metrics, earningsInDays: 30, ...extra };
}

const GROWTH = { epsAnnuo: 25, ricaviTrim: 30, epsTrim: 20, roe: 25, roa: 14, debito: 0.2, quick: 1.8, pe: 28, margine: 22, ricavi5a: 18, eps5a: 20, pfcf: 25, cap: 50_000, yield: 0.3, payout: 10 };
const VALUE = { epsAnnuo: 5, ricaviTrim: 6, epsTrim: 4, roe: 22, roa: 9, debito: 0.5, quick: 1.3, pe: 18, margine: 24, ricavi5a: 8, eps5a: 12, pfcf: 18, cap: 80_000, yield: 1.5, payout: 30 };
const DIVID = { epsAnnuo: 3, ricaviTrim: 3, epsTrim: 2, roe: 18, roa: 4, debito: 1.2, quick: 0.8, pe: 16, margine: 18, ricavi5a: 4, eps5a: 4, pfcf: 20, cap: 30_000, yield: 4.2, payout: 60 };

/** Universo finto: 3 titoli per settore, gli ETF di settore e SPY. */
export function defaultFakeUniverse(): FakeSymbolSpec[] {
  const out: FakeSymbolSpec[] = [];
  const sectorDrift: Record<Settore, number> = {
    Technology: 0.0012, Financial: 0.0009, Healthcare: 0.0002, Utilities: 0.0001, "Real Estate": -0.0002,
    "Communication Services": 0.0010, "Basic Materials": 0.0003, Energy: -0.0001, Industrials: 0.0008,
    "Consumer Cyclical": 0.0004, "Consumer Defensive": 0.0002,
  };
  const ind: Record<Settore, string> = {
    Technology: "Semiconductors", Financial: "Banking", Healthcare: "Biotechnology", Utilities: "Utilities", "Real Estate": "Real Estate",
    "Communication Services": "Media", "Basic Materials": "Chemicals", Energy: "Energy", Industrials: "Machinery",
    "Consumer Cyclical": "Retail", "Consumer Defensive": "Beverages",
  };
  const pref: Record<Settore, string> = {
    Technology: "TEC", Financial: "BNK", Healthcare: "SAN", Utilities: "UTI", "Real Estate": "IMM", "Communication Services": "COM",
    "Basic Materials": "MAT", Energy: "ENE", Industrials: "IND", "Consumer Cyclical": "CIC", "Consumer Defensive": "DIF",
  };
  for (const [sett, etf] of Object.entries(ETF_SETTORE) as [Settore, string][]) {
    out.push({ symbol: etf, name: `ETF ${sett}`, industry: null, exchange: "ARCA", drift: sectorDrift[sett], vol: 0.011, start: 80, volume: 8_000_000, metrics: {}, isEtf: true });
    const base = sett === "Utilities" || sett === "Real Estate" || sett === "Consumer Defensive" ? DIVID : sett === "Technology" || sett === "Communication Services" ? GROWTH : VALUE;
    for (const k of ["A", "B", "C"]) {
      const sym = `${pref[sett]}${k}`;
      const tilt = k === "A" ? 0.0010 : k === "B" ? 0.0004 : -0.0004;
      const m: FakeSymbolSpec["metrics"] = { ...base };
      if (k === "B") m.roe = (base.roe as number) * 0.9;
      if (k === "C") m.margine = null;
      out.push(spec(sym, `Società ${sym}`, ind[sett], sectorDrift[sett] + tilt, m, { peSeries: [22, 26, 24, 30, 27], earningsInDays: k === "B" ? 3 : 35 }));
    }
  }
  out.push({ symbol: BENCHMARK, name: "SPDR S&P 500", industry: null, exchange: "ARCA", drift: 0.0005, vol: 0.009, start: 450, volume: 60_000_000, metrics: {}, isEtf: true });
  return out;
}

export class FakeMarket implements MarketData, Fundamentals {
  readonly specs = new Map<string, FakeSymbolSpec>();
  /** Candele imposte dai test (sostituiscono quelle generate). */
  readonly barOverrides = new Map<string, Bar[]>();
  readonly splitOverrides = new Map<string, Bar[]>();
  readonly priceOverrides = new Map<string, number>();
  failSnapshots = false;
  failBars = false;
  failEarnings = new Set<string>();
  private cache = new Map<string, Bar[]>();
  calls = { metric: 0, profile: 0, earnings: 0, bars: 0, snapshots: 0 };

  constructor(
    private readonly now: () => Date,
    specs: FakeSymbolSpec[] = defaultFakeUniverse(),
    private readonly calendar: (s: string, e: string) => CalendarDay[] = fakeCalendar,
  ) {
    for (const s of specs) this.specs.set(s.symbol, s);
  }

  assets(): Asset[] {
    return [...this.specs.values()].map((s) => ({ symbol: s.symbol, name: s.name, exchange: s.exchange, status: "active", tradable: true, assetClass: "us_equity" }));
  }

  /** Serie completa (compresa una candela parziale della seduta in corso). */
  private series(sym: string): Bar[] {
    const over = this.barOverrides.get(sym);
    if (over) return over;
    const sp = this.specs.get(sym);
    if (!sp) return [];
    const now = this.now();
    const today = dateInTz(now, TZ_NY);
    const key = `${sym}|${today}|${Math.floor(now.getTime() / 60_000)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const rnd = mulberry32(hashStr(sym));
    const days = this.calendar(FIRST_DAY, today);
    const out: Bar[] = [];
    let prev = sp.start;
    for (const d of days) {
      const gap = gaussian(rnd) * sp.vol * 0.3;
      const ret = sp.drift + gaussian(rnd) * sp.vol;
      const o = prev * (1 + gap);
      const c = prev * (1 + ret);
      const h = Math.max(o, c) * (1 + Math.abs(gaussian(rnd)) * sp.vol * 0.5);
      const l = Math.min(o, c) * (1 - Math.abs(gaussian(rnd)) * sp.vol * 0.5);
      const v = Math.round(sp.volume * (0.6 + rnd() * 0.8 + Math.max(0, ret) * 20));
      let bar: Bar = { t: d.date, o: r4(o), h: r4(h), l: r4(l), c: r4(c), v };
      if (d.date === today) {
        const openAt = zonedToUtc(d.date, d.open, TZ_NY).getTime();
        const closeAt = zonedToUtc(d.date, d.close, TZ_NY).getTime();
        if (now.getTime() < openAt) break;
        const f = Math.min(1, (now.getTime() - openAt) / (closeAt - openAt));
        const cc = o + (c - o) * f;
        bar = { t: d.date, o: r4(o), h: r4(Math.max(o, cc, o + (h - Math.max(o, c)) * f)), l: r4(Math.min(o, cc)), c: r4(cc), v: Math.round(v * f) };
      }
      out.push(bar);
      prev = c;
    }
    this.cache.set(key, out);
    return out;
  }

  async getDailyBars(symbols: string[], opts: { start: string; end: Date; adjustment: Adjustment }): Promise<Record<string, Bar[]>> {
    this.calls.bars++;
    if (this.failBars) throw new Error("dati non disponibili (finto)");
    const end = dateInTz(opts.end, TZ_NY);
    const out: Record<string, Bar[]> = {};
    for (const s of symbols) {
      const src = opts.adjustment === "split" ? (this.splitOverrides.get(s) ?? this.series(s)) : this.series(s);
      const rows = src.filter((b) => b.t >= opts.start && b.t <= end);
      if (rows.length) out[s] = rows;
    }
    return out;
  }

  currentPrice(sym: string): number | null {
    const o = this.priceOverrides.get(sym);
    if (o != null) return o;
    const s = this.series(sym);
    return s.length ? s[s.length - 1]!.c : null;
  }

  async getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
    this.calls.snapshots++;
    if (this.failSnapshots) throw new Error("snapshot non disponibili (finto)");
    const out: Record<string, Snapshot> = {};
    const today = dateInTz(this.now(), TZ_NY);
    for (const s of symbols) {
      const p = this.currentPrice(s);
      if (p == null) continue;
      const ser = this.series(s);
      const last = ser[ser.length - 1];
      const isToday = last?.t === today;
      const prev = isToday ? ser[ser.length - 2] : last;
      out[s] = { price: p, time: this.now().toISOString(), dailyOpen: isToday ? last!.o : null, prevClose: isToday ? (prev?.c ?? null) : (ser[ser.length - 2]?.c ?? null), dailyDate: last?.t ?? null, dailyClose: last?.c ?? null };
    }
    return out;
  }

  async getMetrics(symbol: string): Promise<FinnhubMetric | null> {
    this.calls.metric++;
    const sp = this.specs.get(symbol);
    if (!sp || sp.isEtf) return null;
    const metric: Record<string, number | null> = {};
    for (const [id, v] of Object.entries(sp.metrics) as [MetricId, number | null][]) {
      const campo = CAMPI_FINNHUB[id].campi[0];
      if (campo && v !== null && v !== undefined) metric[campo] = v;
    }
    if (Object.keys(metric).length === 0) return null;
    const series = sp.peSeries ? { annual: { pe: sp.peSeries.map((v, i) => ({ period: `${2025 - i}-12-31`, v })) } } : undefined;
    return { metric, series };
  }

  async getProfile(symbol: string): Promise<FinnhubProfile | null> {
    this.calls.profile++;
    const sp = this.specs.get(symbol);
    if (!sp || sp.isEtf) return null;
    return { name: sp.name, ticker: sp.symbol, exchange: sp.exchange, country: sp.country ?? "US", finnhubIndustry: sp.industry ?? undefined, marketCapitalization: (sp.metrics.cap as number) ?? undefined };
  }

  async getEarnings(symbol: string, from: string, to: string): Promise<EarningsItem[] | null> {
    this.calls.earnings++;
    if (this.failEarnings.has(symbol)) return null;
    const sp = this.specs.get(symbol);
    if (!sp) return [];
    if (sp.earningsInDays === null) return null;
    const d = addDays(dateInTz(this.now(), TZ_NY), sp.earningsInDays ?? 30);
    return d >= from && d <= to ? [{ symbol, date: d }] : [];
  }
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
