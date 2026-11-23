// Log a righe JSON, sempre passate da redact().
import * as fs from "node:fs";
import * as path from "node:path";
import { redact, redactJson } from "./redact.ts";

export type Level = "info" | "avviso" | "errore";

export interface Logger {
  info(evento: string, dati?: Record<string, unknown>): void;
  warn(evento: string, dati?: Record<string, unknown>): void;
  error(evento: string, dati?: Record<string, unknown>): void;
  /** Righe registrate in memoria (per test e resoconti). */
  readonly righe: string[];
  readonly file: string | null;
}

export function createLogger(file: string | null, echo = false): Logger {
  const righe: string[] = [];
  if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  const write = (livello: Level, evento: string, dati?: Record<string, unknown>) => {
    const line = redactJson({ ts: new Date().toISOString(), livello, evento, ...(dati ?? {}) });
    righe.push(line);
    if (righe.length > 5000) righe.shift();
    if (file) {
      try {
        fs.appendFileSync(file, line + "\n");
      } catch {}
    }
    if (echo) {
      const msg = dati && Object.keys(dati).length ? `${evento} ${redactJson(dati)}` : evento;
      const prefix = livello === "errore" ? "✖" : livello === "avviso" ? "⚠" : "·";
      console.log(redact(`${prefix} ${msg}`));
    }
  };
  return {
    righe,
    file,
    info: (e, d) => write("info", e, d),
    warn: (e, d) => write("avviso", e, d),
    error: (e, d) => write("errore", e, d),
  };
}

/** Logger che non scrive su file (test). */
export function memoryLogger(): Logger {
  return createLogger(null, false);
}
