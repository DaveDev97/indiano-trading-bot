// Lock brevi e sincroni (diario, parametri): creazione atomica con "wx".
import * as fs from "node:fs";
import * as path from "node:path";
import { OWN_START_MS, pidExists } from "./process.ts";

export class LockTimeout extends Error {
  constructor(file: string) {
    super(`lock occupato: ${path.basename(file)}`);
  }
}

interface ShortLockContent {
  pid: number;
  procStart: number;
  at: number;
  token: string;
}

function tryBreakStale(file: string, staleMs: number): void {
  let c: ShortLockContent | null = null;
  try {
    c = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e: any) {
    if (e?.code === "ENOENT") return;
    // file illeggibile (scrittura interrotta): lo consideriamo vecchio solo se lo è davvero
    try {
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs < staleMs) return;
    } catch {
      return;
    }
  }
  const dead = c ? !pidExists(c.pid) : true;
  const old = c ? Date.now() - c.at > staleMs : true;
  if (!dead && !old) return;
  // rinomina atomica: solo uno dei contendenti riesce a rimuoverlo
  const grave = `${file}.vecchio-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(file, grave);
    // controllo che sia proprio quello visto (non un lock nuovo creato nel frattempo)
    try {
      const now = JSON.parse(fs.readFileSync(grave, "utf8")) as ShortLockContent;
      if (c && now.token !== c.token) {
        // abbiamo spostato un lock vivo: lo rimettiamo a posto se il posto è libero
        try {
          fs.linkSync(grave, file);
        } catch {}
      }
    } catch {}
    try {
      fs.unlinkSync(grave);
    } catch {}
  } catch {}
}

/** Prende il lock, esegue fn, rilascia. Attende al massimo timeoutMs. */
export function withShortLock<T>(file: string, fn: () => T, timeoutMs = 10_000, staleMs = 60_000): T {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const content: ShortLockContent = { pid: process.pid, procStart: OWN_START_MS, at: Date.now(), token };
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    try {
      const fd = fs.openSync(file, "wx");
      try {
        fs.writeSync(fd, JSON.stringify(content));
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (e: any) {
      if (e?.code !== "EEXIST" && e?.code !== "EPERM") throw e;
      if (Date.now() > deadline) throw new LockTimeout(file);
      if (attempt % 10 === 0) tryBreakStale(file, staleMs);
      attempt++;
      Bun.sleepSync(10 + Math.min(attempt, 20) * 5);
    }
  }
  try {
    return fn();
  } finally {
    try {
      const cur = JSON.parse(fs.readFileSync(file, "utf8")) as ShortLockContent;
      if (cur.token === token) fs.unlinkSync(file);
    } catch {}
  }
}
