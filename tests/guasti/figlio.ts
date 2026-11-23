// Processo figlio per i test dei guasti: un vero processo bun, da uccidere per PID.
// Ambiente: GUASTO_ROOT (cartella di stato), GUASTO_ORA (orologio finto, ISO), GUASTO_MODO:
//   normale                  → un tick e basta
//   ferma-dopo-primo-ordine  → dopo il primo ordine arrivato al broker stampa PRIMO_ORDINE e resta appeso (per il kill)
//   lento                    → il cervello impiega 3 secondi (per sovrapporre due sveglie)
//   testimone                → riscrive di continuo un testimone grande (per morire a metà del salvataggio)
import { scenario } from "../scenario.ts";
import { realProcessProbe } from "../../src/util/process.ts";
import { tick } from "../../src/run/tick.ts";
import { scriviTestimone, type Testimone } from "../../src/run/baton.ts";
import { makePaths } from "../../src/config/paths.ts";

const root = process.env.GUASTO_ROOT!;
const ora = process.env.GUASTO_ORA!;
const modo = process.env.GUASTO_MODO ?? "normale";
const tienivivo = () => setInterval(() => {}, 1000);

if (modo === "testimone") {
  const paths = makePaths(root);
  const base: Testimone = { runId: "", tipo: "chiusura", seduta: "2026-11-24", eseguitaIl: new Date().toISOString(), paramsVersione: "v1", ordiniProposti: [], ordiniInviati: [], rifiuti: [], errori: [], ragionamento: "", piano: "", lezioni: [], testo: "" };
  console.log("SCRIVO");
  for (let i = 0; ; i++) scriviTestimone(paths, { ...base, runId: `2026-11-24-${String(i).padStart(6, "0")}`, testo: `riga ${i} `.repeat(300_000) });
}

const sc = scenario({ root, brokerSuFile: true, probe: realProcessProbe });
sc.ctx.setNow(ora);
if (modo === "ferma-dopo-primo-ordine") {
  const orig = sc.ctx.broker.submitOrder.bind(sc.ctx.broker);
  sc.ctx.broker.submitOrder = async (r) => {
    const o = await orig(r);
    console.log(`PRIMO_ORDINE ${r.clientOrderId}`);
    tienivivo();
    await new Promise(() => {});
    return o;
  };
}
if (modo === "lento") {
  const orig = sc.brain.run.bind(sc.brain);
  sc.brain.run = async (req) => {
    await new Promise((r) => setTimeout(r, 3000));
    return orig(req);
  };
}
const r = await tick(sc.ctx, { echo: false });
console.log(`ESITO ${JSON.stringify({ pid: process.pid, fatto: r.fatto, eseguita: r.esito?.eseguita ?? false, motivo: r.esito?.motivo ?? null, allarmi: r.esito?.allarmi ?? [] })}`);
process.exit(0);
