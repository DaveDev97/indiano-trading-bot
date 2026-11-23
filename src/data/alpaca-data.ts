// Alpaca Market Data: candele giornaliere SIP (end ≥ 16 minuti fa) e snapshot IEX.
import { ALPACA_DATA_URL } from "../config/costanti.ts";
import { httpJson, HttpError, type FetchFn } from "../util/http.ts";
import { RateLimiter } from "../util/ratelimit.ts";
import { dateInTz, TZ_NY } from "../util/time.ts";
import type { Adjustment, Bar, MarketData, Snapshot } from "./types.ts";

export const SIP_DELAY_MS = 16 * 60_000;

export class AlpacaData implements MarketData {
  private readonly limiter = new RateLimiter([{ max: 180, windowMs: 60_000 }]);
  constructor(
    private readonly keyId: string,
    private readonly secretKey: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async get<T = any>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.take();
      try {
        const r = await httpJson<T>(this.fetchFn, `${ALPACA_DATA_URL}${path}`, {
          timeoutMs: 30_000,
          headers: { "APCA-API-KEY-ID": this.keyId, "APCA-API-SECRET-KEY": this.secretKey },
        });
        return r.data;
      } catch (e) {
        if (e instanceof HttpError && e.status === 429 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 20_000));
          continue;
        }
        throw e;
      }
    }
  }

  async getDailyBars(symbols: string[], opts: { start: string; end: Date; adjustment: Adjustment }): Promise<Record<string, Bar[]>> {
    const out: Record<string, Bar[]> = {};
    const latestEnd = new Date(this.now().getTime() - SIP_DELAY_MS);
    const end = opts.end.getTime() > latestEnd.getTime() ? latestEnd : opts.end;
    for (let i = 0; i < symbols.length; i += 100) {
      const chunk = symbols.slice(i, i + 100);
      let token: string | null = null;
      for (let page = 0; page < 500; page++) {
        const sp = new URLSearchParams({
          symbols: chunk.join(","),
          timeframe: "1Day",
          start: `${opts.start}T00:00:00Z`,
          end: end.toISOString(),
          adjustment: opts.adjustment,
          feed: "sip",
          limit: "10000",
          sort: "asc",
        });
        if (token) sp.set("page_token", token);
        const r: any = await this.get(`/v2/stocks/bars?${sp}`);
        for (const [sym, bars] of Object.entries<any[]>(r.bars ?? {})) {
          const arr = (out[sym] ??= []);
          for (const b of bars) arr.push({ t: dateInTz(new Date(b.t), TZ_NY), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
        }
        token = r.next_page_token ?? null;
        if (!token) break;
      }
    }
    for (const s of Object.keys(out)) {
      const seen = new Set<string>();
      out[s] = out[s]!.filter((b) => (seen.has(b.t) ? false : (seen.add(b.t), true))).sort((a, b) => (a.t < b.t ? -1 : 1));
    }
    return out;
  }

  async getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
    const out: Record<string, Snapshot> = {};
    for (let i = 0; i < symbols.length; i += 100) {
      const chunk = symbols.slice(i, i + 100);
      const r: any = await this.get(`/v2/stocks/snapshots?symbols=${encodeURIComponent(chunk.join(","))}&feed=iex`);
      const map = r?.snapshots ?? r ?? {};
      for (const [sym, s] of Object.entries<any>(map)) {
        const price = s?.latestTrade?.p ?? s?.minuteBar?.c ?? s?.dailyBar?.c;
        if (typeof price !== "number") continue;
        out[sym] = {
          price,
          time: s?.latestTrade?.t ?? s?.minuteBar?.t ?? "",
          dailyOpen: typeof s?.dailyBar?.o === "number" ? s.dailyBar.o : null,
          prevClose: typeof s?.prevDailyBar?.c === "number" ? s.prevDailyBar.c : null,
          dailyDate: s?.dailyBar?.t ? dateInTz(new Date(s.dailyBar.t), TZ_NY) : null,
          dailyClose: typeof s?.dailyBar?.c === "number" ? s.dailyBar.c : null,
        };
      }
    }
    return out;
  }
}
