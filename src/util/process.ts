// Riconoscimento dei processi: PID + ora di avvio (i sistemi riassegnano i PID).
// Windows: ora di avvio da Get-Process. Linux (es. Raspberry Pi): da /proc/<pid>/stat, senza lanciare comandi.
import * as fs from "node:fs";

/** Ora di avvio di questo processo (ms epoch). */
export const OWN_START_MS = Math.round(performance.timeOrigin);

export interface ProcessProbe {
  /** true se esiste un processo con quel PID avviato (± tolleranza) a startMs. */
  isAlive(pid: number, startMs: number): Promise<boolean>;
  /** Controllo veloce e sincrono: esiste un processo con quel PID? */
  pidExists(pid: number): boolean;
}

export function pidExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

const START_TOLERANCE_MS = 5_000;

/** Linux: ora di avvio di un processo da /proc (campo 22 di stat, in tick dall'accensione + btime). null se non leggibile. */
export function linuxStartMs(pid: number, clkTck = 100, leggi: (p: string) => string = (p) => fs.readFileSync(p, "utf8")): number | null {
  try {
    const stat = leggi(`/proc/${pid}/stat`);
    const after = stat.slice(stat.lastIndexOf(")") + 2).split(" "); // dal campo 3 (stato) in poi
    const startTicks = Number(after[19]);
    const btimeLine = leggi("/proc/stat").split("\n").find((l) => l.startsWith("btime "));
    const btime = Number(btimeLine?.split(/\s+/)[1]);
    if (!Number.isFinite(startTicks) || !Number.isFinite(btime)) return null;
    return Math.round((btime + startTicks / clkTck) * 1000);
  } catch {
    return null;
  }
}

async function windowsStartMs(pid: number): Promise<number | null | "assente"> {
  try {
    const p = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; if ($p) { [DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds() }`],
      { stdout: "pipe", stderr: "ignore" },
    );
    const timer = setTimeout(() => p.kill(), 15_000);
    const out = (await new Response(p.stdout).text()).trim();
    clearTimeout(timer);
    await p.exited;
    if (!out) return "assente";
    const t = Number(out);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/** Probe reale, valida su Windows e su Linux. Se l'ora di avvio non è verificabile, il processo si considera vivo (prudenza). */
export const realProcessProbe: ProcessProbe = {
  pidExists,
  async isAlive(pid, startMs) {
    if (pid === process.pid) return Math.abs(startMs - OWN_START_MS) <= START_TOLERANCE_MS;
    if (!pidExists(pid)) return false;
    let t: number | null | "assente";
    if (process.platform === "win32") t = await windowsStartMs(pid);
    else if (process.platform === "linux") t = linuxStartMs(pid);
    else t = null;
    if (t === "assente") return false;
    if (t === null) return true;
    return Math.abs(t - startMs) <= START_TOLERANCE_MS;
  },
};

/**
 * Per i processi lanciati da `bun run avvia`: se il padre (INDIANO_PADRE = "pid:avvioMs") non è più vivo,
 * il figlio si chiude da solo. Su Windows uccidere il padre non chiude i figli, che resterebbero orfani.
 */
export function chiudiSeOrfano(intervalloMs = 10_000, probe: ProcessProbe = realProcessProbe): void {
  const v = process.env.INDIANO_PADRE;
  if (!v) return;
  const [pid, avvio] = v.split(":").map(Number);
  if (!pid || !avvio) return;
  const t = setInterval(async () => {
    if (!(await probe.isAlive(pid, avvio))) {
      console.error("processo principale (avvia) chiuso: mi fermo anch'io.");
      process.exit(0);
    }
  }, intervalloMs);
  t.unref?.();
}
