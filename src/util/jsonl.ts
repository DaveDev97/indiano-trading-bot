// File JSONL solo in aggiunta, con lock dedicato perché le righe non si mescolino.
import * as fs from "node:fs";
import * as path from "node:path";
import { withShortLock } from "./shortlock.ts";
import { redactJson } from "./redact.ts";

export function appendJsonl(file: string, lockFile: string, rows: unknown[]): void {
  if (rows.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = rows.map((r) => redactJson(r)).join("\n") + "\n";
  withShortLock(lockFile, () => {
    fs.appendFileSync(file, text);
  });
}

export interface JsonlRead<T> {
  rows: T[];
  /** Righe illeggibili (es. scrittura interrotta): si saltano e si contano. */
  corrupt: number;
}

export function readJsonl<T = any>(file: string): JsonlRead<T> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { rows: [], corrupt: 0 };
  }
  const rows: T[] = [];
  let corrupt = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      corrupt++;
    }
  }
  return { rows, corrupt };
}

/** Legge tutti i file JSONL di una cartella che iniziano con il prefisso, in ordine di nome. */
export function readJsonlDir<T = any>(dir: string, prefix = ""): JsonlRead<T> {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl") && f.startsWith(prefix)).sort();
  } catch {
    return { rows: [], corrupt: 0 };
  }
  const out: JsonlRead<T> = { rows: [], corrupt: 0 };
  for (const f of files) {
    const r = readJsonl<T>(path.join(dir, f));
    out.rows.push(...r.rows);
    out.corrupt += r.corrupt;
  }
  return out;
}
