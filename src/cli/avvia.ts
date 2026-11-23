// bun run avvia [--fake] — motore (un tick ogni 30 s) e dashboard insieme, in una sola finestra.
// Ctrl+C (o la chiusura della finestra) ferma entrambi. Se uno dei due si chiude da solo viene riavviato
// dopo 15 secondi; oltre 5 riavvii in un'ora si ferma tutto, così un guasto ripetuto non passa inosservato.
import * as path from "node:path";
import { PROJECT_ROOT } from "../config/paths.ts";
import { parseArgs } from "../util/args.ts";
import { OWN_START_MS } from "../util/process.ts";
import { redact } from "../util/redact.ts";
import { formatRome } from "../util/time.ts";

const args = parseArgs();
const passa = args.flags.has("fake") ? ["--fake"] : [];
const ATTESA_RIAVVIO_MS = 15_000;
const MAX_RIAVVII_ORA = 5;

interface Figlio {
  nome: string;
  script: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  riavvii: number[];
}

const figli: Figlio[] = [
  { nome: "motore", script: "src/cli/schedule.ts", proc: null, riavvii: [] },
  { nome: "dashboard", script: "src/cli/dashboard.ts", proc: null, riavvii: [] },
];
let fermando = false;
const larghezza = Math.max(...figli.map((f) => f.nome.length));
const scrivi = (nome: string, riga: string, err = false) => {
  const t = `${nome.padEnd(larghezza)} │ ${redact(riga)}`;
  if (err) console.error(t);
  else console.log(t);
};

async function inoltra(nome: string, stream: ReadableStream<Uint8Array> | null | undefined, err: boolean) {
  if (!stream) return;
  const dec = new TextDecoder();
  let resto = "";
  for await (const chunk of stream) {
    resto += dec.decode(chunk, { stream: true });
    const righe = resto.split(/\r?\n/);
    resto = righe.pop() ?? "";
    for (const r of righe) if (r.trim()) scrivi(nome, r, err);
  }
  if (resto.trim()) scrivi(nome, resto, err);
}

function avvia(f: Figlio) {
  const proc = Bun.spawn([process.execPath, "run", path.join(PROJECT_ROOT, f.script), ...passa], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, INDIANO_PADRE: `${process.pid}:${OWN_START_MS}` },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  f.proc = proc;
  void inoltra(f.nome, proc.stdout as ReadableStream<Uint8Array>, false);
  void inoltra(f.nome, proc.stderr as ReadableStream<Uint8Array>, true);
  void proc.exited.then((codice) => {
    if (fermando) return;
    const ora = Date.now();
    f.riavvii = f.riavvii.filter((t) => ora - t < 3_600_000);
    if (f.riavvii.length >= MAX_RIAVVII_ORA) {
      scrivi(f.nome, `chiuso (codice ${codice}) per la ${MAX_RIAVVII_ORA + 1}ª volta in un'ora: fermo tutto. Controlla i log in logs/.`, true);
      void ferma(1);
      return;
    }
    f.riavvii.push(ora);
    scrivi(f.nome, `chiuso inaspettatamente (codice ${codice}): lo riavvio tra ${ATTESA_RIAVVIO_MS / 1000} secondi.`, true);
    setTimeout(() => {
      if (!fermando) avvia(f);
    }, ATTESA_RIAVVIO_MS);
  });
}

async function ferma(codice: number) {
  if (fermando) return;
  fermando = true;
  console.log(`${formatRome(new Date())} · fermo motore e dashboard…`);
  for (const f of figli) {
    try {
      f.proc?.kill();
    } catch {}
  }
  await Promise.race([Promise.all(figli.map((f) => f.proc?.exited)), Bun.sleep(5000)]);
  process.exit(codice);
}

process.on("SIGINT", () => void ferma(0));
process.on("SIGTERM", () => void ferma(0));

console.log(`${formatRome(new Date())} · Indiano Trading: avvio motore e dashboard${passa.length ? " (modalità finta)" : ""}. Ctrl+C per fermare entrambi.`);
for (const f of figli) avvia(f);
