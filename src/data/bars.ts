// Regole sulle candele: mai la candela della seduta in corso (§4.5, test 37).
import type { CalendarDay } from "../broker/types.ts";
import { dateInTz, TZ_NY, zonedToUtc } from "../util/time.ts";
import type { Bar } from "./types.ts";
import { SIP_DELAY_MS } from "./alpaca-data.ts";

/**
 * Tiene solo le candele di sedute chiuse da almeno 16 minuti (ritardo SIP del piano gratuito).
 * Una candela con data non presente nel calendario si tiene solo se è di un giorno precedente a oggi (NY).
 */
export function closedBars(bars: Bar[], now: Date, calendar: CalendarDay[]): Bar[] {
  const byDate = new Map(calendar.map((c) => [c.date, c]));
  const today = dateInTz(now, TZ_NY);
  return bars.filter((b) => {
    const c = byDate.get(b.t);
    if (!c) return b.t < today;
    const closeAt = zonedToUtc(c.date, c.close, TZ_NY).getTime();
    return now.getTime() >= closeAt + SIP_DELAY_MS;
  });
}

/** Compatta le candele per il diario: [data, o, h, l, c, v]. */
export type CompactBar = [string, number, number, number, number, number];
export const compactBars = (bars: Bar[]): CompactBar[] => bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]);
export const expandBars = (rows: CompactBar[]): Bar[] => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
