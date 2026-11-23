// Gestione del tempo: solo Intl.DateTimeFormat con fusi orari IANA, mai offset scritti a mano.

export const TZ_NY = "America/New_York";
export const TZ_ROME = "Europe/Rome";

export interface TzParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
  /** 0 = domenica … 6 = sabato */
  wd: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function partsInTz(d: Date, tz: string): TzParts {
  const out: any = {};
  for (const p of fmt(tz).formatToParts(d)) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    hh: Number(out.hour) % 24,
    mm: Number(out.minute),
    ss: Number(out.second),
    wd: WD[out.weekday] ?? 0,
  };
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** "AAAA-MM-GG" della data nel fuso indicato. */
export function dateInTz(d: Date, tz: string): string {
  const p = partsInTz(d, tz);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
}

/** "HHMM" nel fuso indicato. */
export function hhmmInTz(d: Date, tz: string): string {
  const p = partsInTz(d, tz);
  return `${p2(p.hh)}${p2(p.mm)}`;
}

/** "HH:MM" nel fuso indicato. */
export function clockInTz(d: Date, tz: string): string {
  const p = partsInTz(d, tz);
  return `${p2(p.hh)}:${p2(p.mm)}`;
}

/** Differenza (ms) tra l'ora locale del fuso e UTC in quell'istante. */
export function tzOffsetMs(d: Date, tz: string): number {
  const p = partsInTz(d, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Converte data e ora "da orologio" in un fuso in un istante UTC. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!, 0);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  // seconda iterazione: corregge i casi vicini al cambio d'ora
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** Somma giorni a una data "AAAA-MM-GG" (aritmetica di calendario, senza fusi). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return t.toISOString().slice(0, 10);
}

/** Giorno della settimana di una data di calendario: 0 = domenica. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** Giorni di calendario tra due date "AAAA-MM-GG" (b − a). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  return Math.round((tb - ta) / 86_400_000);
}

/** "23/11/2026 15:40" in ora di Roma. */
export function formatRome(d: Date | string | number): string {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "n/d";
  const p = partsInTz(x, TZ_ROME);
  return `${p2(p.d)}/${p2(p.m)}/${p.y} ${p2(p.hh)}:${p2(p.mm)}`;
}

/** "23/11/2026" da "2026-11-23". */
export function formatDateIt(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** Mese "AAAA-MM" in ora di Roma. */
export function monthRome(d: Date): string {
  return dateInTz(d, TZ_ROME).slice(0, 7);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
