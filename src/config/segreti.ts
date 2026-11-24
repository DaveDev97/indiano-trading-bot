// Caricamento di secrets.ts (solo import, mai stampa) e controlli di sicurezza all'avvio (§3.1).
import * as fs from "node:fs";
import * as path from "node:path";
import { ENV_TRADING_URL_VARS, PAPER_TRADING_URL } from "./costanti.ts";
import { PROJECT_ROOT } from "./paths.ts";
import { registerSecret } from "../util/redact.ts";

export interface Secrets {
  alpaca: { keyId: string; secretKey: string; [k: string]: unknown };
  telegram: { botToken: string; chatId: string };
  finnhub: { apiKey: string };
  dashboard: { password: string };
  claude: { oauthToken: string };
  [k: string]: unknown;
}

export class SafetyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SafetyError";
  }
}

function registerAll(obj: unknown): void {
  if (typeof obj === "string") registerSecret(obj);
  else if (obj && typeof obj === "object") for (const v of Object.values(obj)) registerAll(v);
}

/** Importa secrets.ts. Restituisce null se manca. Registra tutti i valori per redact(). */
export async function loadSecrets(file = path.join(PROJECT_ROOT, "secrets.ts")): Promise<Secrets | null> {
  // "assente" solo se il file non esiste: un secrets.ts scritto a mano che importa un modulo mancante o legge un file
  // che non c'è dà anche lui "Cannot find…", ma va segnalato, non scambiato per assente (e poi sovrascritto)
  if (!fs.existsSync(file)) return null;
  let mod: any;
  try {
    mod = await import(file);
  } catch {
    throw new Error("secrets.ts non leggibile (errore di sintassi, o importa un file che non c'è?)");
  }
  const s = mod?.secrets as Secrets | undefined;
  if (!s || typeof s !== "object") throw new Error("secrets.ts non esporta `secrets`");
  registerAll(s);
  return s;
}

const ALLOWED_ALPACA_HOSTS = new Set(["paper-api.alpaca.markets", "data.alpaca.markets", "stream.data.alpaca.markets"]);

function badAlpacaUrls(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/([a-z0-9.-]*alpaca\.markets)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (!ALLOWED_ALPACA_HOSTS.has(m[1]!.toLowerCase())) out.push(m[1]!);
  return out;
}

function collectStrings(obj: unknown, acc: string[] = []): string[] {
  if (typeof obj === "string") acc.push(obj);
  else if (obj && typeof obj === "object") for (const v of Object.values(obj)) collectStrings(v, acc);
  return acc;
}

/** Errori che impediscono la partenza: chiave live, URL di trading diverso dal paper (§3.1, test 10). */
export function paperSafetyProblems(s: Secrets | null, env: Record<string, string | undefined> = process.env): string[] {
  const errs: string[] = [];
  if (s) {
    const key = String(s.alpaca?.keyId ?? "").trim();
    if (key.toUpperCase().startsWith("AK")) errs.push("la chiave Alpaca inizia con AK: è una chiave LIVE. Il bot lavora solo sul conto paper.");
    for (const v of collectStrings(s)) {
      const bad = badAlpacaUrls(v);
      if (bad.length) errs.push(`secrets.ts contiene un URL Alpaca non paper (${bad.join(", ")}).`);
    }
  }
  for (const name of ENV_TRADING_URL_VARS) {
    const v = env[name];
    if (v && v.replace(/\/+$/, "").replace(/\/v2$/, "") !== PAPER_TRADING_URL) errs.push(`la variabile d'ambiente ${name} punta a un endpoint diverso dal paper.`);
  }
  for (const [name, v] of Object.entries(env)) {
    if (typeof v === "string" && badAlpacaUrls(v).length) errs.push(`la variabile d'ambiente ${name} contiene un URL Alpaca non paper.`);
  }
  return [...new Set(errs)];
}

export function assertPaperSafety(s: Secrets | null, env: Record<string, string | undefined> = process.env): void {
  const p = paperSafetyProblems(s, env);
  if (p.length) throw new SafetyError(`Il bot non parte: ${p.join(" ")}`);
}
