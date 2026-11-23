// Scrittura atomica (file temporaneo + rename) e lettura JSON tollerante.
import * as fs from "node:fs";
import * as path from "node:path";

function retrySync<T>(fn: () => T, tries = 20): T {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return fn();
    } catch (e: any) {
      last = e;
      // Su Windows antivirus e indicizzatore tengono aperti i file per pochi millisecondi.
      if (e?.code === "EPERM" || e?.code === "EBUSY" || e?.code === "EACCES") {
        Bun.sleepSync(25 + i * 10);
        continue;
      }
      throw e;
    }
  }
  throw last;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFileAtomic(file: string, data: string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    retrySync(() => fs.renameSync(tmp, file));
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
}

export function writeJsonAtomic(file: string, obj: unknown): void {
  writeFileAtomic(file, JSON.stringify(obj, null, 2));
}

export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "assente" | "corrotto"; error?: string };

export function readJsonSafe<T>(file: string, check?: (v: any) => boolean): ReadResult<T> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e: any) {
    if (e?.code === "ENOENT") return { ok: false, reason: "assente" };
    return { ok: false, reason: "corrotto", error: String(e?.message ?? e) };
  }
  try {
    const v = JSON.parse(raw);
    if (check && !check(v)) return { ok: false, reason: "corrotto", error: "struttura non valida" };
    return { ok: true, value: v as T };
  } catch (e: any) {
    return { ok: false, reason: "corrotto", error: String(e?.message ?? e) };
  }
}

/** Legge un JSON o restituisce il valore di riserva (assente o corrotto). */
export function readJsonOr<T>(file: string, fallback: T): T {
  const r = readJsonSafe<T>(file);
  return r.ok ? r.value : fallback;
}

export function fileExists(file: string): boolean {
  try {
    fs.statSync(file);
    return true;
  } catch {
    return false;
  }
}
