// Calendario NYSE per la modalità finta e i test (2024–2027). Il bot vero usa /v2/calendar di Alpaca.
import type { CalendarDay } from "../broker/types.ts";
import { addDays, weekdayOf } from "../util/time.ts";

const HOLIDAYS = new Set([
  // 2024
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
  // 2025
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);

/** Mezze giornate: chiusura alle 13:00 NY. */
const EARLY_CLOSE = new Set(["2024-07-03", "2024-11-29", "2024-12-24", "2025-07-03", "2025-11-28", "2025-12-24", "2026-11-27", "2026-12-24", "2027-11-26"]);

export function fakeCalendar(start: string, end: string): CalendarDay[] {
  const out: CalendarDay[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6 || HOLIDAYS.has(d)) continue;
    out.push({ date: d, open: "09:30", close: EARLY_CLOSE.has(d) ? "13:00" : "16:00" });
  }
  return out;
}
