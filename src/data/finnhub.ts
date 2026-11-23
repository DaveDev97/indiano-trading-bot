// Finnhub, piano gratuito: < 50 richieste/minuto e < 30/secondo. La chiave va nell'header, non nell'URL.
import { FINNHUB_URL } from "../config/costanti.ts";
import { httpJson, HttpError, type FetchFn } from "../util/http.ts";
import { RateLimiter } from "../util/ratelimit.ts";
import type { EarningsItem, FinnhubMetric, FinnhubProfile, Fundamentals } from "./types.ts";

export class FinnhubClient implements Fundamentals {
  readonly limiter: RateLimiter;
  /** Numero di richieste fatte (per i resoconti). */
  requests = 0;
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
    limiter?: RateLimiter,
  ) {
    this.limiter = limiter ?? new RateLimiter([
      { max: 48, windowMs: 60_000 },
      { max: 25, windowMs: 1_000 },
    ]);
  }

  private async get<T = any>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.take();
      this.requests++;
      try {
        const r = await httpJson<T>(this.fetchFn, `${FINNHUB_URL}${path}`, { timeoutMs: 20_000, headers: { "X-Finnhub-Token": this.apiKey } });
        return r.data;
      } catch (e) {
        if (e instanceof HttpError && (e.status === 429 || e.kind !== "http") && attempt < 2) {
          await new Promise((r) => setTimeout(r, e.status === 429 ? 61_000 : 5_000));
          continue;
        }
        throw e;
      }
    }
  }

  async getMetrics(symbol: string): Promise<FinnhubMetric | null> {
    const r: any = await this.get(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`);
    if (!r || typeof r !== "object" || !r.metric || Object.keys(r.metric).length === 0) return null;
    return { metric: r.metric, series: r.series };
  }

  async getProfile(symbol: string): Promise<FinnhubProfile | null> {
    const r: any = await this.get(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`);
    if (!r || typeof r !== "object" || Object.keys(r).length === 0) return null;
    return r as FinnhubProfile;
  }

  async getEarnings(symbol: string, from: string, to: string): Promise<EarningsItem[] | null> {
    try {
      const r: any = await this.get(`/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}`);
      const rows: any[] = Array.isArray(r?.earningsCalendar) ? r.earningsCalendar : null as any;
      if (!rows) return null;
      return rows.filter((x) => x?.date).map((x) => ({ symbol: String(x.symbol ?? symbol), date: String(x.date), hour: x.hour }));
    } catch {
      return null;
    }
  }
}
