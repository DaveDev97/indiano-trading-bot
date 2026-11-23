// Chiamata a `claude -p` (il "cervello"). Prompt via stdin, cwd fuori dal progetto, niente strumenti.
import * as fs from "node:fs";
import * as path from "node:path";
import { brainCwd } from "../config/costanti.ts";
import type { EsitoAi } from "../config/ai-task.ts";
import { errText, redact } from "../util/redact.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";

export interface UsageModello {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

export interface Consumi {
  /** null = non misurato */
  costoUsd: number | null;
  token: { input: number; output: number; cacheLettura: number; cacheScrittura: number } | null;
  perModello: Record<string, UsageModello>;
  durataApiMs: number | null;
  turni: number | null;
  subtype: string | null;
}

export interface ClaudeResult {
  esito: EsitoAi;
  structured: unknown | null;
  testo: string | null;
  consumi: Consumi;
  durataMs: number;
  errore?: string;
  modello: string | null;
}

export interface ClaudeOpts {
  prompt: string;
  schema: object;
  systemPrompt: string;
  model?: string | null;
  maxBudgetUsd: number;
  timeoutMs: number;
  oauthToken?: string | null;
  cacheDir: string;
}

export function findClaude(): string | null {
  const w = Bun.which("claude");
  if (w) return w;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  for (const p of [path.join(home, ".local", "bin", "claude.exe"), path.join(home, ".local", "bin", "claude")]) if (fs.existsSync(p)) return p;
  return null;
}

async function runCapture(cmd: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const t = setTimeout(() => p.kill(), timeoutMs);
  const out = await new Response(p.stdout).text();
  const code = await p.exited;
  clearTimeout(t);
  return { code, out };
}

export interface ClaudeFlags {
  versione: string;
  flags: string[];
}

/** Legge `claude --version` e i flag di `claude -p --help` (in cache per versione). */
export async function claudeFlags(exe: string, cacheDir: string): Promise<ClaudeFlags> {
  const v = (await runCapture([exe, "--version"], 30_000)).out.trim();
  const file = path.join(cacheDir, "claude-flags.json");
  const c = readJsonSafe<ClaudeFlags>(file);
  if (c.ok && c.value.versione === v && c.value.flags.length) return c.value;
  const help = (await runCapture([exe, "-p", "--help"], 30_000)).out;
  const flags = [...new Set([...help.matchAll(/(--[a-z][a-z0-9-]+)/gi)].map((m) => m[1]!))];
  const res = { versione: v, flags };
  try {
    writeJsonAtomic(file, res);
  } catch {}
  return res;
}

export function buildArgs(exe: string, f: ClaudeFlags, o: Pick<ClaudeOpts, "schema" | "systemPrompt" | "model" | "maxBudgetUsd">): string[] {
  const has = (x: string) => f.flags.includes(x);
  const a = [exe, "-p", "--output-format", "json", "--json-schema", JSON.stringify(o.schema), "--tools", ""];
  if (has("--disallowedTools")) a.push("--disallowedTools", "mcp__*");
  if (has("--strict-mcp-config")) a.push("--strict-mcp-config");
  if (has("--no-session-persistence")) a.push("--no-session-persistence");
  if (has("--max-turns")) a.push("--max-turns", "3");
  a.push("--max-budget-usd", o.maxBudgetUsd.toFixed(2));
  if (o.model && o.model !== "predefinito") a.push("--model", o.model);
  if (has("--setting-sources")) a.push("--setting-sources", "project");
  if (has("--safe-mode")) a.push("--safe-mode");
  if (has("--system-prompt")) a.push("--system-prompt", o.systemPrompt);
  return a;
}

const ZERO_CONSUMI: Consumi = { costoUsd: null, token: null, perModello: {}, durataApiMs: null, turni: null, subtype: null };

/** Estrae i consumi dal JSON finale. Costo e token da total_cost_usd e modelUsage, non da usage. */
export function estraiConsumi(j: any): Consumi {
  if (!j || typeof j !== "object") return { ...ZERO_CONSUMI };
  const perModello: Record<string, UsageModello> = {};
  let tin = 0, tout = 0, tcr = 0, tcw = 0;
  for (const [m, u] of Object.entries<any>(j.modelUsage ?? {})) {
    const x: UsageModello = {
      inputTokens: Number(u?.inputTokens ?? 0) || 0,
      outputTokens: Number(u?.outputTokens ?? 0) || 0,
      cacheReadInputTokens: Number(u?.cacheReadInputTokens ?? 0) || 0,
      cacheCreationInputTokens: Number(u?.cacheCreationInputTokens ?? 0) || 0,
      costUSD: Number(u?.costUSD ?? 0) || 0,
    };
    perModello[m] = x;
    tin += x.inputTokens;
    tout += x.outputTokens;
    tcr += x.cacheReadInputTokens;
    tcw += x.cacheCreationInputTokens;
  }
  const cost = typeof j.total_cost_usd === "number" ? j.total_cost_usd : null;
  const totTok = tin + tout + tcr + tcw;
  const misurato = totTok > 0 || (cost !== null && cost > 0);
  return {
    costoUsd: misurato ? cost : null,
    token: misurato && totTok > 0 ? { input: tin, output: tout, cacheLettura: tcr, cacheScrittura: tcw } : null,
    perModello: misurato ? perModello : {},
    durataApiMs: typeof j.duration_api_ms === "number" ? j.duration_api_ms : null,
    turni: typeof j.num_turns === "number" ? j.num_turns : null,
    subtype: typeof j.subtype === "string" ? j.subtype : null,
  };
}

/** Interpreta l'uscita del processo (separata per poterla testare). */
export function interpretaUscita(code: number | null, stdout: string, timedOut: boolean, durataMs: number): ClaudeResult {
  if (timedOut) return { esito: "timeout", structured: null, testo: null, consumi: { ...ZERO_CONSUMI }, durataMs, errore: "timeout: processo terminato", modello: null };
  let j: any = null;
  try {
    j = JSON.parse(stdout.trim());
  } catch {
    // a volte l'ultima riga è il JSON
    const last = stdout.trim().split(/\r?\n/).pop() ?? "";
    try {
      j = JSON.parse(last);
    } catch {}
  }
  if (!j || typeof j !== "object") {
    return { esito: "errore", structured: null, testo: null, consumi: { ...ZERO_CONSUMI }, durataMs, errore: `uscita ${code}, risposta non JSON`, modello: null };
  }
  const consumi = estraiConsumi(j);
  const modello = Object.keys(consumi.perModello)[0] ?? null;
  if (j.subtype === "error_max_budget_usd") return { esito: "budget superato", structured: null, testo: null, consumi, durataMs, errore: "tetto per chiamata superato", modello };
  if (code !== 0 || j.is_error === true || (j.subtype && j.subtype !== "success")) {
    return { esito: "errore", structured: null, testo: typeof j.result === "string" ? j.result : null, consumi, durataMs, errore: redact(`uscita ${code}, ${j.subtype ?? "errore"}: ${String(j.result ?? "").slice(0, 300)}`), modello };
  }
  if (j.structured_output === undefined || j.structured_output === null) {
    return { esito: "risposta non valida", structured: null, testo: typeof j.result === "string" ? j.result : null, consumi, durataMs, errore: "structured_output assente", modello };
  }
  return { esito: "ok", structured: j.structured_output, testo: typeof j.result === "string" ? j.result : null, consumi, durataMs, modello };
}

export async function callClaude(o: ClaudeOpts): Promise<ClaudeResult> {
  const t0 = Date.now();
  const exe = findClaude();
  if (!exe) return { esito: "errore", structured: null, testo: null, consumi: { ...ZERO_CONSUMI }, durataMs: 0, errore: "comando claude non trovato nel PATH", modello: null };
  const cwd = brainCwd();
  fs.mkdirSync(cwd, { recursive: true });
  let flags: ClaudeFlags;
  try {
    flags = await claudeFlags(exe, o.cacheDir);
  } catch (e) {
    return { esito: "errore", structured: null, testo: null, consumi: { ...ZERO_CONSUMI }, durataMs: Date.now() - t0, errore: `claude --help non leggibile: ${errText(e)}`, modello: null };
  }
  const args = buildArgs(exe, flags, o);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  if (o.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = o.oauthToken;
  let timedOut = false;
  try {
    const p = Bun.spawn(args, { cwd, env, stdin: new Blob([o.prompt]), stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill();
    }, o.timeoutMs);
    const [out] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    clearTimeout(timer);
    return interpretaUscita(code, out, timedOut, Date.now() - t0);
  } catch (e) {
    return { esito: "errore", structured: null, testo: null, consumi: { ...ZERO_CONSUMI }, durataMs: Date.now() - t0, errore: errText(e), modello: null };
  }
}
