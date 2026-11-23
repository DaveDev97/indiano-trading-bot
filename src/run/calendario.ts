// Calendario delle sveglie (§5): orari in ora di New York dal calendario Alpaca, id in ora di Roma.
import type { CalendarDay } from "../broker/types.ts";
import type { Params } from "../params/params.ts";
import type { TipoSveglia } from "../cage/gabbia.ts";
import { dateInTz, hhmmInTz, TZ_NY, TZ_ROME, zonedToUtc } from "../util/time.ts";

export interface SlotPrevisto {
  tipo: TipoSveglia;
  at: Date;
  /** "AAAA-MM-GG-HHMM" con l'orario previsto in ora di Roma. */
  id: string;
  /** Data della seduta (New York). */
  seduta: string;
}

export function slotId(at: Date): string {
  return `${dateInTz(at, TZ_ROME)}-${hhmmInTz(at, TZ_ROME)}`;
}

/** Le sveglie di una seduta. Se due cadono a meno di `distanzaMinima` minuti, si tiene solo la seconda. */
export function slotsDelGiorno(day: CalendarDay, P: Params): SlotPrevisto[] {
  const open = zonedToUtc(day.date, day.open, TZ_NY);
  const close = zonedToUtc(day.date, day.close, TZ_NY);
  const raw: { tipo: TipoSveglia; at: Date }[] = [
    { tipo: "briefing", at: zonedToUtc(day.date, P.s("orari.briefing"), TZ_ROME) },
    { tipo: "apertura", at: new Date(open.getTime() + P.n("orari.aperturaMinuti") * 60_000) },
    { tipo: "meta", at: zonedToUtc(day.date, P.s("orari.metaSeduta"), TZ_NY) },
    { tipo: "chiusura", at: new Date(close.getTime() - P.n("orari.chiusuraMinuti") * 60_000) },
  ];
  raw.sort((a, b) => a.at.getTime() - b.at.getTime());
  const gap = P.n("orari.distanzaMinima") * 60_000;
  const kept: { tipo: TipoSveglia; at: Date }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const next = raw[i + 1];
    if (next && next.at.getTime() - raw[i]!.at.getTime() < gap) continue;
    kept.push(raw[i]!);
  }
  return kept.map((s) => ({ ...s, id: slotId(s.at), seduta: day.date }));
}

export function slotsTra(calendar: CalendarDay[], P: Params, from: Date, to: Date): SlotPrevisto[] {
  return calendar.flatMap((d) => slotsDelGiorno(d, P)).filter((s) => s.at.getTime() >= from.getTime() && s.at.getTime() <= to.getTime());
}

export interface SituazioneSveglie {
  /** La sveglia da eseguire adesso (dentro la sua finestra e non ancora fatta). */
  dovuta: SlotPrevisto | null;
  /** Sveglie la cui finestra è passata senza esecuzione, dopo l'ultima eseguita. */
  saltate: SlotPrevisto[];
  prossima: SlotPrevisto | null;
}

export function situazione(calendar: CalendarDay[], P: Params, now: Date, eseguite: Set<string>, ultimaEseguita: Date | null): SituazioneSveglie {
  const finestra = P.n("orari.finestraMinuti") * 60_000;
  const all = calendar.flatMap((d) => slotsDelGiorno(d, P)).sort((a, b) => a.at.getTime() - b.at.getTime());
  const t = now.getTime();
  const inFinestra = all.filter((s) => s.at.getTime() <= t && t <= s.at.getTime() + finestra && !eseguite.has(s.id));
  const dovuta = inFinestra.at(-1) ?? null;
  const da = ultimaEseguita ? ultimaEseguita.getTime() : t - 3 * 86_400_000;
  const saltate = all.filter((s) => s.at.getTime() > da && s.at.getTime() + finestra < t && !eseguite.has(s.id) && s.id !== dovuta?.id);
  // se ce n'è una dovuta più recente, le precedenti nella finestra contano come saltate
  for (const s of inFinestra.slice(0, -1)) if (!saltate.some((x) => x.id === s.id)) saltate.push(s);
  const prossima = all.find((s) => s.at.getTime() > t) ?? null;
  return { dovuta, saltate, prossima };
}

export function tipoDaNome(nome: string): TipoSveglia | null {
  const n = nome.toLowerCase().replace(/[^a-z]/g, "");
  if (n === "briefing") return "briefing";
  if (n === "apertura" || n === "open") return "apertura";
  if (n === "meta" || n === "metaseduta" || n === "midday") return "meta";
  if (n === "chiusura" || n === "close") return "chiusura";
  return null;
}

export const NOME_SVEGLIA: Record<TipoSveglia, string> = { briefing: "briefing", apertura: "apertura", meta: "metà seduta", chiusura: "chiusura" };
