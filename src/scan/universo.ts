// Universo (§4.1): azioni attive sulle borse scelte (universo.borse, di norma NYSE e NASDAQ), prezzo, controvalore,
// capitalizzazione, sede della società (universo.sede), dati Finnhub.
// Le chiamate a Finnhub passano da una cache su file: la scansione riprende da dove si è interrotta.
import * as path from "node:path";
import { BORSE_AMMESSE } from "../config/costanti.ts";
import type { Paths } from "../config/paths.ts";
import type { Asset, CalendarDay } from "../broker/types.ts";
import type { FinnhubMetric, FinnhubProfile, Fundamentals, MarketData } from "../data/types.ts";
import { closedBars } from "../data/bars.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { addDays, dateInTz, TZ_NY } from "../util/time.ts";
import type { Logger } from "../util/log.ts";
import { errText } from "../util/redact.ts";

export interface Prefiltrato {
  simbolo: string;
  nome: string;
  borsa: string;
  prezzo: number;
  controvalore: number;
}

export function assetAmmesso(a: Asset, borse: string[] = BORSE_AMMESSE): boolean {
  return a.status === "active" && a.tradable && a.assetClass === "us_equity" && borse.includes(a.exchange) && !/[\/\s]/.test(a.symbol);
}

/** Prezzo e controvalore medio a 20 sedute dalle candele Alpaca (molti simboli per richiesta). */
export async function prefiltro(
  assets: Asset[],
  data: MarketData,
  now: Date,
  calendar: CalendarDay[],
  opts: { prezzoMin: number; controvaloreMin: number; cacheFile: string; log: Logger; borse?: string[] },
): Promise<Prefiltrato[]> {
  const borse = opts.borse ?? BORSE_AMMESSE;
  const chiaveBorse = [...borse].sort().join(",");
  const c = readJsonSafe<{ data: string; borse?: string; righe: Prefiltrato[] }>(opts.cacheFile);
  const oggi = dateInTz(now, TZ_NY);
  // la cache vale per il giorno e per le stesse borse (senza "borse" è una cache di prima: NYSE e NASDAQ)
  if (c.ok && c.value.data === oggi && (c.value.borse ?? "NASDAQ,NYSE") === chiaveBorse) {
    opts.log.info("prefiltro dalla cache", { titoli: c.value.righe.length });
    return c.value.righe.filter((r) => r.prezzo >= opts.prezzoMin && r.controvalore >= opts.controvaloreMin);
  }
  const ok = assets.filter((a) => assetAmmesso(a, borse));
  const bySym = new Map(ok.map((a) => [a.symbol, a]));
  const out: Prefiltrato[] = [];
  const start = addDays(oggi, -45);
  for (let i = 0; i < ok.length; i += 100) {
    const chunk = ok.slice(i, i + 100).map((a) => a.symbol);
    let bars: Record<string, any[]>;
    try {
      bars = await data.getDailyBars(chunk, { start, end: now, adjustment: "all" });
    } catch (e) {
      opts.log.warn("candele del prefiltro non disponibili per un gruppo", { da: chunk[0], errore: errText(e) });
      continue;
    }
    for (const [s, raw] of Object.entries(bars)) {
      const b = closedBars(raw, now, calendar);
      if (b.length < 20) continue;
      const last20 = b.slice(-20);
      const controvalore = last20.reduce((a, x) => a + x.c * x.v, 0) / 20;
      const a = bySym.get(s)!;
      out.push({ simbolo: s, nome: a.name, borsa: a.exchange, prezzo: b[b.length - 1]!.c, controvalore });
    }
    if ((i / 100) % 10 === 0) opts.log.info("prefiltro in corso", { fatti: Math.min(i + 100, ok.length), totale: ok.length });
  }
  writeJsonAtomic(opts.cacheFile, { data: oggi, borse: chiaveBorse, righe: out });
  return out.filter((r) => r.prezzo >= opts.prezzoMin && r.controvalore >= opts.controvaloreMin);
}

interface CacheEntry<T> {
  fetchedAt: string;
  data: T | null;
}

export class FinnhubCache {
  constructor(
    private readonly dir: string,
    private readonly fund: Fundamentals,
    private readonly now: () => Date,
  ) {}
  private file(kind: string, sym: string): string {
    return path.join(this.dir, kind, `${sym.replace(/[^A-Za-z0-9.-]/g, "_")}.json`);
  }
  private async get<T>(kind: string, sym: string, maxDays: number, fetcher: () => Promise<T | null>): Promise<{ data: T | null; fromCache: boolean }> {
    const f = this.file(kind, sym);
    const r = readJsonSafe<CacheEntry<T>>(f);
    if (r.ok && this.now().getTime() - Date.parse(r.value.fetchedAt) < maxDays * 86_400_000) return { data: r.value.data, fromCache: true };
    const data = await fetcher();
    writeJsonAtomic(f, { fetchedAt: this.now().toISOString(), data } satisfies CacheEntry<T>);
    return { data, fromCache: false };
  }
  metric(sym: string, maxDays: number) {
    return this.get<FinnhubMetric>("metric", sym, maxDays, () => this.fund.getMetrics(sym));
  }
  profile(sym: string, maxDays: number) {
    return this.get<FinnhubProfile>("profile", sym, maxDays, () => this.fund.getProfile(sym));
  }
}

export function capOk(capMln: number | null, scelta: string): boolean {
  if (capMln === null) return false;
  if (scelta === "large") return capMln > 10_000;
  if (scelta === "mid-small") return capMln >= 300 && capMln <= 10_000;
  return capMln > 300;
}

export function prefiltroCacheFile(paths: Paths): string {
  return path.join(paths.cache, "scan", "prefiltro.json");
}
