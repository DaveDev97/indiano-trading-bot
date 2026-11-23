// Forza dei settori: un settore è forte se il suo ETF ha battuto SPY nelle ultime N sedute (§4.2).
import { BENCHMARK, ETF_SETTORE, SETTORI, type Settore } from "../config/settori.ts";
import type { CalendarDay } from "../broker/types.ts";
import type { Bar, MarketData } from "../data/types.ts";
import { closedBars } from "../data/bars.ts";
import { addDays, dateInTz, TZ_NY } from "../util/time.ts";

export const PERIODI_FORZA = [21, 63, 126] as const;

export interface ForzaSettore {
  settore: Settore;
  etf: string;
  /** Rendimento dell'ETF per periodo (sedute); null = dati insufficienti. */
  rendimenti: Record<string, number | null>;
  forte: boolean;
}

export interface ForzaSettori {
  data: string | null;
  periodo: number;
  spy: Record<string, number | null>;
  settori: ForzaSettore[];
  forti: Settore[];
}

export function rendimento(bars: Bar[], sedute: number): number | null {
  if (bars.length < sedute + 1) return null;
  const a = bars[bars.length - 1 - sedute]!.c;
  const b = bars[bars.length - 1]!.c;
  return a > 0 ? b / a - 1 : null;
}

export function calcolaForza(bars: Record<string, Bar[]>, periodo: number): ForzaSettori {
  const spyBars = bars[BENCHMARK] ?? [];
  const spy: Record<string, number | null> = {};
  for (const p of PERIODI_FORZA) spy[p] = rendimento(spyBars, p);
  const settori: ForzaSettore[] = SETTORI.map((s) => {
    const etf = ETF_SETTORE[s];
    const b = bars[etf] ?? [];
    const rendimenti: Record<string, number | null> = {};
    for (const p of PERIODI_FORZA) rendimenti[p] = rendimento(b, p);
    const r = rendimenti[periodo] ?? null;
    const sp = spy[periodo] ?? null;
    return { settore: s, etf, rendimenti, forte: r !== null && sp !== null && r > sp };
  });
  settori.sort((a, b) => (b.rendimenti[periodo] ?? -Infinity) - (a.rendimenti[periodo] ?? -Infinity));
  return { data: spyBars.at(-1)?.t ?? null, periodo, spy, settori, forti: settori.filter((x) => x.forte).map((x) => x.settore) };
}

export async function forzaSettori(data: MarketData, now: Date, calendar: CalendarDay[], periodo: number): Promise<ForzaSettori> {
  const start = addDays(dateInTz(now, TZ_NY), -260);
  const syms = [BENCHMARK, ...Object.values(ETF_SETTORE)];
  const raw = await data.getDailyBars(syms, { start, end: now, adjustment: "all" });
  const closed: Record<string, Bar[]> = {};
  for (const [s, b] of Object.entries(raw)) closed[s] = closedBars(b, now, calendar);
  return calcolaForza(closed, periodo);
}
