// Piani di uscita (§4.6): state/piani-uscita.json, scrittura atomica, copia nel diario.
// Il piano non cambia quando cambiano i parametri: solo con un'azione manuale (registrata).
import type { Paths } from "../config/paths.ts";
import type { Order } from "../broker/types.ts";
import { appendJournal, readJournal } from "../journal/journal.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { withShortLock } from "../util/shortlock.ts";

export type Modalita = "bracket" | "trailing";

export interface PianoUscita {
  simbolo: string;
  tradeId: string;
  modalita: Modalita;
  stop: number | null;
  takeProfit: number | null;
  trailingPct: number | null;
  /** Se lo stop mobile è stato ricreato con trail_price (dal massimo registrato). */
  trailPrice: number | null;
  massimo: number;
  ingresso: number;
  quantita: number;
  origine: "iniziale" | "manuale" | "review" | "ricostruito";
  creato: string;
  aggiornato: string;
  chiudiAllApertura: { richiesto: string; codice: string } | null;
  paramsVersione: string;
}

export type Piani = Record<string, PianoUscita>;

export function leggiPiani(paths: Paths): { piani: Piani; persi: boolean } {
  const r = readJsonSafe<Piani>(paths.piani, (v) => v && typeof v === "object" && !Array.isArray(v));
  if (r.ok) return { piani: r.value, persi: false };
  return { piani: {}, persi: r.reason === "corrotto" || readJournal(paths).some((e) => e.tipo === "piano") };
}

/** Aggiorna i piani sotto lock (i salvataggi della dashboard e delle sveglie non si sovrascrivono). */
export function aggiornaPiani(paths: Paths, fn: (p: Piani) => void, evento?: { runId?: string; nota: string; simbolo?: string }, now = new Date()): Piani {
  return withShortLock(paths.paramsLock, () => {
    const cur = leggiPiani(paths).piani;
    fn(cur);
    writeJsonAtomic(paths.piani, cur);
    if (evento) appendJournal(paths, { tipo: "piano", runId: evento.runId, simbolo: evento.simbolo, nota: evento.nota, piano: evento.simbolo ? cur[evento.simbolo] ?? null : null }, now);
    return cur;
  });
}

/** Ricostruisce un piano dagli ordini di protezione aperti e dall'ultimo piano registrato nel diario. */
export function ricostruisciPiano(paths: Paths, simbolo: string, qty: number, avg: number, protezioni: Order[], now: Date): PianoUscita {
  const dalDiario = readJournal(paths).filter((e) => e.tipo === "piano" && e.simbolo === simbolo && e.piano).at(-1)?.piano as PianoUscita | undefined;
  const trailing = protezioni.find((o) => o.type === "trailing_stop");
  const stop = protezioni.find((o) => o.type === "stop");
  const lim = protezioni.find((o) => o.type === "limit");
  const base: PianoUscita = {
    simbolo,
    tradeId: dalDiario?.tradeId ?? `T-ricostruito-${simbolo}`,
    modalita: trailing ? "trailing" : "bracket",
    stop: stop?.stopPrice ?? dalDiario?.stop ?? null,
    takeProfit: lim?.limitPrice ?? dalDiario?.takeProfit ?? null,
    trailingPct: trailing?.trailPercent ?? dalDiario?.trailingPct ?? null,
    trailPrice: trailing?.trailPrice ?? null,
    massimo: Math.max(trailing?.hwm ?? 0, dalDiario?.massimo ?? 0, avg),
    ingresso: dalDiario?.ingresso ?? avg,
    quantita: qty,
    origine: "ricostruito",
    creato: dalDiario?.creato ?? now.toISOString(),
    aggiornato: now.toISOString(),
    chiudiAllApertura: dalDiario?.chiudiAllApertura ?? null,
    paramsVersione: dalDiario?.paramsVersione ?? "sconosciuta",
  };
  if (!trailing && !stop && dalDiario) return { ...dalDiario, quantita: qty, origine: "ricostruito", aggiornato: now.toISOString() };
  return base;
}

/** Livello di stop effettivo del piano (per la modalità trailing: massimo × (1 − %), oppure massimo − trail_price). */
export function livelloStop(p: PianoUscita): number | null {
  if (p.modalita === "bracket") return p.stop;
  if (p.trailPrice != null) return p.massimo - p.trailPrice;
  if (p.trailingPct != null) return p.massimo * (1 - p.trailingPct / 100);
  return null;
}
