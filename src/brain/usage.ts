// Registro dei consumi AI (§8.7): state/ai-usage/AAAA-MM.jsonl, solo in aggiunta, sotto il lock del diario.
import * as path from "node:path";
import type { Paths } from "../config/paths.ts";
import type { AiTaskId, EsitoAi } from "../config/ai-task.ts";
import { appendJsonl, readJsonlDir } from "../util/jsonl.ts";
import { monthRome } from "../util/time.ts";
import type { ClaudeResult, UsageModello } from "./claude.ts";

export interface RigaConsumo {
  ts: string;
  runId: string;
  task: AiTaskId | string;
  modello: string | null;
  esito: EsitoAi;
  durataMs: number;
  durataApiMs: number | null;
  turni: number | null;
  /** null = non misurato */
  token: { input: number; output: number; cacheLettura: number; cacheScrittura: number } | null;
  costoUsd: number | null;
  perModello: Record<string, UsageModello>;
  promptByte: number;
  forzata: boolean;
  subtype: string | null;
  errore?: string;
}

export function rigaDaRisultato(r: ClaudeResult, meta: { runId: string; task: string; promptByte: number; forzata: boolean; modelloRichiesto?: string | null }, now = new Date()): RigaConsumo {
  return {
    ts: now.toISOString(),
    runId: meta.runId,
    task: meta.task,
    modello: r.modello ?? (meta.modelloRichiesto && meta.modelloRichiesto !== "predefinito" ? meta.modelloRichiesto : null),
    esito: r.esito,
    durataMs: r.durataMs,
    durataApiMs: r.consumi.durataApiMs,
    turni: r.consumi.turni,
    token: r.consumi.token,
    costoUsd: r.consumi.costoUsd,
    perModello: r.consumi.perModello,
    promptByte: meta.promptByte,
    forzata: meta.forzata,
    subtype: r.consumi.subtype,
    errore: r.errore,
  };
}

export function appendUsage(paths: Paths, row: RigaConsumo): void {
  appendJsonl(path.join(paths.aiUsage, `${monthRome(new Date(row.ts))}.jsonl`), paths.journalLock, [row]);
}

export function readUsage(paths: Paths): RigaConsumo[] {
  return readJsonlDir<RigaConsumo>(paths.aiUsage).rows;
}

/**
 * Modello usato davvero nelle ultime chiamate di queste tipologie: quello con il costo maggiore nel dettaglio per modello
 * (Claude Code usa anche un modello piccolo per compiti interni). null se non c'è ancora nessuna chiamata misurata.
 */
export function modelloOsservato(righe: RigaConsumo[], tipologie: string[]): { modello: string; quando: string } | null {
  for (let i = righe.length - 1; i >= 0; i--) {
    const r = righe[i]!;
    if (!tipologie.includes(r.task)) continue;
    const m = Object.entries(r.perModello ?? {}).sort((a, b) => b[1].costUSD - a[1].costUSD || b[1].outputTokens - a[1].outputTokens)[0];
    if (m) return { modello: m[0], quando: r.ts };
  }
  return null;
}
