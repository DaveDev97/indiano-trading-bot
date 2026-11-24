// Diario: JSONL solo in aggiunta, un file per mese, scritto sotto lock dedicato (§7.1, §10).
import * as path from "node:path";
import type { Paths } from "../config/paths.ts";
import { appendJsonl, readJsonlDir } from "../util/jsonl.ts";
import { monthRome } from "../util/time.ts";

export type TipoEvento =
  | "sveglia"
  | "decisione"
  | "ordine"
  | "esecuzione"
  | "rifiuto"
  | "errore"
  | "allarme"
  | "manuale"
  | "parametri"
  | "review"
  | "proposta"
  | "freno"
  | "piano"
  | "scheda-ingresso"
  | "scheda-uscita"
  | "scheda-simulazione"
  | "scheda-candele"
  | "scheda-trimestrale"
  | "scheda-manuale"
  | "scansione"
  | "override-selezione";

export interface EventoDiario {
  ts: string;
  tipo: TipoEvento;
  runId?: string;
  simbolo?: string;
  [k: string]: unknown;
}

function journalFile(paths: Paths, prefix: string, when: Date): string {
  return path.join(paths.journal, `${prefix}${monthRome(when)}.jsonl`);
}

/** Aggiunge eventi al diario delle operazioni reali e della vita del bot. */
export function appendJournal(paths: Paths, events: Omit<EventoDiario, "ts">[] | Omit<EventoDiario, "ts">, now = new Date()): void {
  const list = Array.isArray(events) ? events : [events];
  const rows = list.map((e) => ({ ts: now.toISOString(), ...e }));
  appendJsonl(journalFile(paths, "diario-", now), paths.journalLock, rows);
}

/** Diario separato delle operazioni ombra: mai mescolato alle operazioni reali. */
export function appendShadowJournal(paths: Paths, events: Omit<EventoDiario, "ts">[], now = new Date()): void {
  const rows = events.map((e) => ({ ts: now.toISOString(), ...e }));
  appendJsonl(journalFile(paths, "ombra-", now), paths.journalLock, rows);
}

export function readJournal(paths: Paths): EventoDiario[] {
  return readJsonlDir<EventoDiario>(paths.journal, "diario-").rows;
}

export function readShadowJournal(paths: Paths): EventoDiario[] {
  return readJsonlDir<EventoDiario>(paths.journal, "ombra-").rows;
}
