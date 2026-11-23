// Testimone (§6.2, §6.10): state/baton.json, scrittura atomica, copia in state/history/.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Paths } from "../config/paths.ts";
import type { Lezione } from "../cage/pause.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";

export interface Testimone {
  runId: string;
  tipo: string;
  seduta: string;
  eseguitaIl: string;
  paramsVersione: string;
  ordiniProposti: { simbolo: string; azione: string; perche: string }[];
  ordiniInviati: { simbolo: string; azione: string; id: string; stato: string }[];
  rifiuti: { simbolo: string; azione: string; motivo: string }[];
  errori: string[];
  ragionamento: string;
  piano: string;
  lezioni: Lezione[];
  /** Lista dei candidati del briefing (usata a metà seduta). */
  listaBriefing?: string[];
  testo: string;
}

const isBaton = (v: any) => v && typeof v.runId === "string" && typeof v.eseguitaIl === "string";

export interface LetturaTestimone {
  testimone: Testimone | null;
  allarme?: string;
}

export function leggiTestimone(paths: Paths): LetturaTestimone {
  const r = readJsonSafe<Testimone>(paths.baton, isBaton);
  if (r.ok) return { testimone: r.value };
  if (r.reason === "assente") {
    const h = ultimaCopiaValida(paths);
    return h ? { testimone: h, allarme: "testimone assente: uso l'ultima copia valida dello storico" } : { testimone: null };
  }
  const h = ultimaCopiaValida(paths);
  if (h) return { testimone: h, allarme: `testimone corrotto: uso l'ultima copia valida (${h.runId})` };
  return { testimone: null, allarme: "testimone corrotto e nessuna copia valida: proseguo con i dati del broker" };
}

function ultimaCopiaValida(paths: Paths): Testimone | null {
  let files: string[] = [];
  try {
    files = fs.readdirSync(paths.history).filter((f) => f.startsWith("baton-") && f.endsWith(".json")).sort().reverse();
  } catch {
    return null;
  }
  for (const f of files) {
    const r = readJsonSafe<Testimone>(path.join(paths.history, f), isBaton);
    if (r.ok) return r.value;
  }
  return null;
}

export function scriviTestimone(paths: Paths, t: Testimone): void {
  writeJsonAtomic(paths.baton, t);
  writeJsonAtomic(path.join(paths.history, `baton-${t.runId.replace(/[^0-9A-Za-z-]/g, "_")}.json`), t);
}
