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

export interface Recupero {
  slot: SlotPrevisto;
  /** Perché si recupera proprio questa (in italiano, per il resoconto). */
  motivo: string;
  /** Le altre sveglie saltate di oggi: con questo recupero non si recuperano più (una sola sveglia per giornata). */
  anche: string[];
}

/** Sveglia lanciata a mano fuori orario oggi: vale come fatta per il suo tipo. */
export interface Forzata {
  tipo: TipoSveglia | string;
  at: Date;
}

/**
 * Sveglia di OGGI (seduta di New York) da recuperare adesso, quando il bot riparte dopo averne saltata qualcuna
 * (PC spento o motore chiuso). Regole prudenti, una sola sveglia per volta:
 * - solo sveglie la cui finestra è passata, mai eseguite, mai già tentate in recupero;
 * - solo se dopo non ne è stata eseguita un'altra della stessa seduta (la giornata è andata avanti: non si torna indietro);
 * - dall'orario della chiusura in poi si recupera solo la chiusura (resoconto, nessun acquisto);
 * - a mercato aperto l'apertura (uscite e ingressi), altrimenti la metà seduta;
 * - prima dell'apertura solo il briefing (nessun ordine); a mercato aperto il briefing non serve più;
 * - se la prossima sveglia prevista è a meno di `orari.distanzaMinima` minuti, si lascia fare a lei.
 */
export function daRecuperare(calendar: CalendarDay[], P: Params, now: Date, eseguite: Set<string>, tentati: Set<string>, forzateOggi: Forzata[] = []): Recupero | null {
  const t = now.getTime();
  const finestra = P.n("orari.finestraMinuti") * 60_000;
  const day = calendar.find((d) => d.date === dateInTz(now, TZ_NY));
  if (!day) return null;
  const slots = slotsDelGiorno(day, P);
  // una sveglia lanciata a mano oggi (once, anche fuori orario) vale come fatta per il suo tipo
  const fatta = (s: SlotPrevisto) => eseguite.has(s.id) || forzateOggi.some((f) => f.tipo === s.tipo && dateInTz(f.at, TZ_NY) === day.date);
  const ultimaFatta = Math.max(-Infinity, ...slots.filter(fatta).map((s) => s.at.getTime()));
  const passate = slots.filter((s) => s.at.getTime() + finestra < t && !fatta(s));
  const saltate = passate.filter((s) => !tentati.has(s.id) && s.at.getTime() > ultimaFatta);
  if (!saltate.length) return null;
  const conAnche = (r: { slot: SlotPrevisto; motivo: string }): Recupero => ({ ...r, anche: passate.map((s) => s.id).filter((id) => id !== r.slot.id) });
  const prossima = calendar.flatMap((d) => slotsDelGiorno(d, P)).filter((s) => s.at.getTime() > t).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  if (prossima && prossima.at.getTime() - t < P.n("orari.distanzaMinima") * 60_000) return null;
  const apre = zonedToUtc(day.date, day.open, TZ_NY).getTime();
  const chiude = zonedToUtc(day.date, day.close, TZ_NY).getTime();
  const chiusura = slots.find((s) => s.tipo === "chiusura");
  const di = (tipo: TipoSveglia) => saltate.find((s) => s.tipo === tipo);
  if (chiusura && t >= chiusura.at.getTime()) {
    const c = di("chiusura");
    return c ? conAnche({ slot: c, motivo: "è passato l'orario della chiusura: si recupera solo il resoconto della giornata, senza acquisti" }) : null;
  }
  if (t >= apre && t < chiude) {
    const a = di("apertura");
    if (a) return conAnche({ slot: a, motivo: "mercato aperto: si recuperano le uscite e gli ingressi dell'apertura, con i prezzi di adesso" });
    const m = di("meta");
    return m ? conAnche({ slot: m, motivo: "mercato aperto: si recupera la sveglia di metà seduta" }) : null;
  }
  if (t < apre) {
    const b = di("briefing");
    return b ? conAnche({ slot: b, motivo: "mercato non ancora aperto: si recupera il briefing (controlli e piano del giorno, nessun ordine)" }) : null;
  }
  return null;
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
