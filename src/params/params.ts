// Parametri attivi con versioni (§10). Ogni scrittura passa da state/params.lock con controllo di versione.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Paths } from "../config/paths.ts";
import { MAX_POSIZIONI_ASSOLUTO } from "../config/costanti.ts";
import { PARAM_BY_KEY, PARAM_DEFS, validaValore, valoriIniziali, type Valore } from "../config/parametri.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { withShortLock } from "../util/shortlock.ts";
import { appendJournal } from "../journal/journal.ts";

export interface Modifica {
  chiave: string;
  da: Valore | undefined;
  a: Valore;
}

export interface ParamsFile {
  versione: number;
  autore: string; // "iniziali" | "utente" | "review rN" | "ripristino vN"
  data: string;
  nota?: string;
  valori: Record<string, Valore>;
  modifiche: Modifica[];
}

export class Params {
  constructor(readonly file: ParamsFile) {}
  get versione(): string {
    return `v${this.file.versione}`;
  }
  get(chiave: string): Valore {
    if (!PARAM_BY_KEY.has(chiave)) throw new Error(`parametro sconosciuto: ${chiave}`);
    const v = this.file.valori[chiave];
    return v === undefined ? PARAM_BY_KEY.get(chiave)!.iniziale : v;
  }
  n(chiave: string): number {
    const v = this.get(chiave);
    if (typeof v !== "number") throw new Error(`parametro non numerico: ${chiave}`);
    if (chiave === "rischio.maxPosizioni") return Math.min(v, MAX_POSIZIONI_ASSOLUTO);
    return v;
  }
  s(chiave: string): string {
    return String(this.get(chiave));
  }
  b(chiave: string): boolean {
    return this.get(chiave) === true;
  }
  valori(): Record<string, Valore> {
    const out = valoriIniziali();
    for (const [k, v] of Object.entries(this.file.valori)) if (PARAM_BY_KEY.has(k)) out[k] = v;
    return out;
  }
}

function isParamsFile(v: any): boolean {
  return v && typeof v === "object" && Number.isInteger(v.versione) && v.versione >= 1 && v.valori && typeof v.valori === "object";
}

function historyFile(paths: Paths, versione: number): string {
  return path.join(paths.paramsHistory, `v${String(versione).padStart(4, "0")}.json`);
}

export function listVersions(paths: Paths): ParamsFile[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(paths.paramsHistory).filter((f) => /^v\d+\.json$/.test(f)).sort();
  } catch {
    return [];
  }
  const out: ParamsFile[] = [];
  for (const f of files) {
    const r = readJsonSafe<ParamsFile>(path.join(paths.paramsHistory, f), isParamsFile);
    if (r.ok) out.push(r.value);
  }
  return out.sort((a, b) => a.versione - b.versione);
}

export interface LoadResult {
  params: Params;
  allarme?: string;
}

/** Legge i parametri attivi. Se mancano crea v1 con i valori iniziali; se corrotti usa l'ultima versione valida dello storico. */
export function loadParams(paths: Paths, now = new Date()): LoadResult {
  const r = readJsonSafe<ParamsFile>(paths.params, isParamsFile);
  if (r.ok) {
    const bad = validaTutti(r.value.valori);
    if (bad.length === 0) return { params: new Params(r.value) };
  }
  const versions = listVersions(paths).filter((v) => validaTutti(v.valori).length === 0);
  if (!r.ok && r.reason === "assente" && versions.length === 0) {
    const v1: ParamsFile = { versione: 1, autore: "iniziali", data: now.toISOString(), valori: valoriIniziali(), modifiche: [] };
    withShortLock(paths.paramsLock, () => {
      const again = readJsonSafe<ParamsFile>(paths.params, isParamsFile);
      if (again.ok) return;
      writeJsonAtomic(historyFile(paths, 1), v1);
      writeJsonAtomic(paths.params, v1);
    });
    const after = readJsonSafe<ParamsFile>(paths.params, isParamsFile);
    return { params: new Params(after.ok ? after.value : v1) };
  }
  const last = versions[versions.length - 1];
  if (last) {
    return { params: new Params(last), allarme: `state/params.json ${r.ok ? "non valido" : r.reason}: uso l'ultima versione valida dello storico (v${last.versione})` };
  }
  const iniz: ParamsFile = { versione: 0, autore: "iniziali", data: now.toISOString(), valori: valoriIniziali(), modifiche: [] };
  return { params: new Params(iniz), allarme: "state/params.json corrotto e storico vuoto: uso i valori iniziali (non salvati)" };
}

/** Errori di validazione su un insieme completo o parziale di valori. */
export function validaTutti(valori: Record<string, unknown>): string[] {
  const errs: string[] = [];
  for (const [k, v] of Object.entries(valori)) {
    const def = PARAM_BY_KEY.get(k);
    if (!def) continue; // chiavi sconosciute (vecchie versioni): ignorate
    const e = validaValore(def, v);
    if (e) errs.push(e);
  }
  if (typeof valori["rischio.maxPosizioni"] === "number" && (valori["rischio.maxPosizioni"] as number) > MAX_POSIZIONI_ASSOLUTO)
    errs.push(`Numero massimo di posizioni: mai oltre ${MAX_POSIZIONI_ASSOLUTO}`);
  const pmin = valori["fond.div.payout.min"], pmax = valori["fond.div.payout.max"];
  if (typeof pmin === "number" && typeof pmax === "number" && pmin >= pmax) errs.push("Payout: il minimo deve essere sotto il massimo");
  return errs;
}

export type SaveResult =
  | { ok: true; params: Params; modifiche: Modifica[] }
  | { ok: false; conflitto: boolean; errori: string[] };

/**
 * Crea la versione N+1 solo se quella attuale è ancora `versioneAttesa`.
 * Le modifiche sono parziali: le chiavi non indicate restano com'erano.
 */
export function saveParams(
  paths: Paths,
  modifiche: Record<string, Valore>,
  opts: { autore: string; nota?: string; versioneAttesa: number; now?: Date; sostituisciTutto?: boolean },
): SaveResult {
  const now = opts.now ?? new Date();
  const unknown = Object.keys(modifiche).filter((k) => !PARAM_BY_KEY.has(k));
  if (unknown.length) return { ok: false, conflitto: false, errori: unknown.map((k) => `Parametro sconosciuto: ${k}`) };
  if (!readJsonSafe(paths.params).ok && listVersions(paths).length === 0) loadParams(paths, now); // crea v1 fuori dal lock
  return withShortLock(paths.paramsLock, (): SaveResult => {
    const cur = loadParams(paths, now).params;
    if (cur.file.versione !== opts.versioneAttesa) {
      return { ok: false, conflitto: true, errori: [`Conflitto: la versione attuale è v${cur.file.versione}, non v${opts.versioneAttesa}. Ricarica la pagina.`] };
    }
    const base = opts.sostituisciTutto ? valoriIniziali() : cur.valori();
    const nuovi = { ...base, ...modifiche };
    const errori = validaTutti(nuovi);
    if (errori.length) return { ok: false, conflitto: false, errori };
    const curVals = cur.valori();
    const diff: Modifica[] = [];
    for (const d of PARAM_DEFS) {
      if (curVals[d.chiave] !== nuovi[d.chiave]) diff.push({ chiave: d.chiave, da: curVals[d.chiave], a: nuovi[d.chiave]! });
    }
    if (diff.length === 0) return { ok: false, conflitto: false, errori: ["Nessuna modifica rispetto alla versione attuale."] };
    const maxStorico = Math.max(cur.file.versione, ...listVersions(paths).map((v) => v.versione));
    const next: ParamsFile = { versione: maxStorico + 1, autore: opts.autore, data: now.toISOString(), nota: opts.nota, valori: nuovi, modifiche: diff };
    writeJsonAtomic(historyFile(paths, next.versione), next);
    writeJsonAtomic(paths.params, next);
    appendJournal(paths, { tipo: "parametri", versione: `v${next.versione}`, autore: opts.autore, nota: opts.nota, modifiche: diff }, now);
    return { ok: true, params: new Params(next), modifiche: diff };
  });
}

/** Ripristina i valori di una versione precedente creando una nuova versione. */
export function restoreVersion(paths: Paths, versione: number, versioneAttesa: number, autore = "utente", now = new Date()): SaveResult {
  const v = listVersions(paths).find((x) => x.versione === versione);
  if (!v) return { ok: false, conflitto: false, errori: [`Versione v${versione} non trovata`] };
  const vals: Record<string, Valore> = {};
  for (const d of PARAM_DEFS) vals[d.chiave] = v.valori[d.chiave] ?? d.iniziale;
  return saveParams(paths, vals, { autore, nota: `ripristino della v${versione}`, versioneAttesa, now });
}

/** Ripristina i valori iniziali (nuova versione). */
export function restoreInitial(paths: Paths, versioneAttesa: number, now = new Date()): SaveResult {
  return saveParams(paths, valoriIniziali(), { autore: "utente", nota: "ripristino dei valori iniziali", versioneAttesa, now });
}
