// Lock delle sveglie e della scansione (§6.1): creazione atomica, PID + ora di avvio, battito ogni 30 s,
// id degli ordini in arrivo, recupero di un lock lasciato da un processo morto.
import * as fs from "node:fs";
import * as path from "node:path";
import { OWN_START_MS, pidExists, type ProcessProbe } from "../util/process.ts";
import { sleep } from "../util/time.ts";

export type Holder = "sveglia" | "dashboard" | "scansione";

export interface LockContent {
  pid: number;
  procStart: number;
  holder: Holder;
  runId: string;
  started: string;
  heartbeat: string;
  pendingOrderIds: string[];
}

export interface Identity {
  pid: number;
  procStart: number;
}

export const OWN_IDENTITY: Identity = { pid: process.pid, procStart: OWN_START_MS };

export class HeldLock {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    readonly file: string,
    public content: LockContent,
    private readonly now: () => Date,
  ) {}
  startHeartbeat(ms = 30_000): void {
    // un errore di scrittura del battito (es. file tenuto aperto dall'antivirus) non deve mai uccidere la sveglia:
    // al giro dopo si riprova; se il battito resta fermo 15 minuti, la sveglia successiva lo segnala.
    this.timer = setInterval(() => {
      try {
        this.beat();
      } catch {}
    }, ms);
    (this.timer as any).unref?.();
  }
  beat(): void {
    this.content = { ...this.content, heartbeat: this.now().toISOString() };
    this.write();
  }
  /** Prima di ogni invio: registra gli id degli ordini che si stanno per mandare. */
  addPending(ids: string[]): void {
    this.content = { ...this.content, pendingOrderIds: [...new Set([...this.content.pendingOrderIds, ...ids])].slice(-200), heartbeat: this.now().toISOString() };
    this.write();
  }
  private write(): void {
    if (!this.isMine()) return;
    const tmp = `${this.file}.tmp-${this.content.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(this.content));
    for (let i = 0; i < 20; i++) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (e: any) {
        if (e?.code !== "EPERM" && e?.code !== "EBUSY") throw e;
        Bun.sleepSync(20);
      }
    }
  }
  isMine(): boolean {
    const c = readLock(this.file);
    return !!c && c.pid === this.content.pid && c.procStart === this.content.procStart && c.started === this.content.started;
  }
  release(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.isMine()) {
      try {
        fs.unlinkSync(this.file);
      } catch {}
    }
  }
}

export function readLock(file: string): LockContent | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (c && Number.isInteger(c.pid) && typeof c.started === "string") return c as LockContent;
  } catch {}
  return null;
}

export type AcquireResult =
  | { ok: true; lock: HeldLock; recovered: { file: string; content: LockContent } | null }
  | { ok: false; reason: "in-corso" | "bloccata"; holder: LockContent | null };

export interface AcquireOpts {
  holder: Holder;
  runId: string;
  probe: ProcessProbe;
  now?: () => Date;
  /** Attesa massima se il lock è occupato da un processo vivo (dashboard: 60 s). */
  waitMs?: number;
  staleHeartbeatMs?: number;
  identity?: Identity;
  heartbeatMs?: number;
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

function tryCreate(file: string, c: LockContent): boolean {
  try {
    const fd = fs.openSync(file, "wx");
    try {
      fs.writeSync(fd, JSON.stringify(c));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (e: any) {
    if (e?.code === "EEXIST" || e?.code === "EPERM") return false;
    throw e;
  }
}

export async function acquireLock(file: string, o: AcquireOpts): Promise<AcquireResult> {
  const now = o.now ?? (() => new Date());
  const id = o.identity ?? OWN_IDENTITY;
  const stale = o.staleHeartbeatMs ?? 15 * 60_000;
  const deadline = Date.now() + (o.waitMs ?? 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let recovered: { file: string; content: LockContent } | null = null;
  let unreadableSince: number | null = null;
  for (;;) {
    const t = now().toISOString();
    const mine: LockContent = { pid: id.pid, procStart: id.procStart, holder: o.holder, runId: o.runId, started: t, heartbeat: t, pendingOrderIds: [] };
    if (tryCreate(file, mine)) {
      const lock = new HeldLock(file, mine, now);
      lock.startHeartbeat(o.heartbeatMs);
      return { ok: true, lock, recovered };
    }
    const cur = readLock(file);
    if (!cur) {
      // file in scrittura o rovinato: aspetta un po', poi trattalo come morto se è vecchio
      unreadableSince ??= Date.now();
      let oldFile = false;
      try {
        oldFile = Date.now() - fs.statSync(file).mtimeMs > stale;
      } catch {
        continue; // sparito nel frattempo: riprova a crearlo
      }
      if (!oldFile || Date.now() - unreadableSince < 3_000) {
        await sleep(100);
        continue;
      }
    }
    const alive = cur ? await o.probe.isAlive(cur.pid, cur.procStart) : false;
    if (alive && cur) {
      if (now().getTime() - Date.parse(cur.heartbeat) > stale) return { ok: false, reason: "bloccata", holder: cur };
      if (Date.now() < deadline) {
        await sleep(1_000);
        continue;
      }
      return { ok: false, reason: "in-corso", holder: cur };
    }
    // processo morto: recupero con una guardia, così ci riesce uno solo
    const guard = `${file}.recupero`;
    const g: LockContent = { ...mine, runId: `recupero ${o.runId}` };
    if (!tryCreate(guard, g)) {
      const gc = readLock(guard);
      if (!gc || (!pidExists(gc.pid) && !(await o.probe.isAlive(gc.pid, gc.procStart))) || Date.now() - Date.parse(gc.started) > 60_000) {
        try {
          fs.renameSync(guard, `${guard}.vecchio-${stamp(now())}-${id.pid}`);
        } catch {}
        continue;
      }
      if (Date.now() < deadline) {
        await sleep(500);
        continue;
      }
      return { ok: false, reason: "in-corso", holder: cur };
    }
    try {
      const again = readLock(file);
      const same = (!cur && !again) || (cur && again && again.pid === cur.pid && again.procStart === cur.procStart && again.started === cur.started);
      if (same) {
        const dead = `${file}.morto-${stamp(now())}-${id.pid}`;
        try {
          fs.renameSync(file, dead);
          recovered = { file: dead, content: cur ?? { pid: 0, procStart: 0, holder: "sveglia", runId: "illeggibile", started: "", heartbeat: "", pendingOrderIds: [] } };
        } catch {}
      }
      // crea il nostro lock mentre teniamo ancora la guardia
      const t2 = now().toISOString();
      const mine2: LockContent = { ...mine, started: t2, heartbeat: t2 };
      if (tryCreate(file, mine2)) {
        const lock = new HeldLock(file, mine2, now);
        lock.startHeartbeat(o.heartbeatMs);
        return { ok: true, lock, recovered };
      }
    } finally {
      try {
        const gc = readLock(guard);
        if (gc && gc.pid === g.pid && gc.started === g.started) fs.unlinkSync(guard);
      } catch {}
    }
  }
}
