// bun run schedule [--fake] — tick ogni 30 secondi, finché non si chiude la finestra.
import { buildRuntime } from "../run/runtime.ts";
import { tick } from "../run/tick.ts";
import { parseArgs } from "../util/args.ts";
import { errText, redact } from "../util/redact.ts";
import { formatRome } from "../util/time.ts";
import { chiudiSeOrfano } from "../util/process.ts";
import { loadSecrets } from "../config/segreti.ts";
import { CODICE_RIAVVIO, mancantiPerMotore, mtimeSegreti } from "../setup/segreti-file.ts";

/** Senza configurazione il motore non va in errore: aspetta che secrets.ts cambi, poi esce per farsi riavviare. */
async function aspettaConfigurazione(): Promise<void> {
  let s;
  try {
    s = await loadSecrets();
  } catch (e) {
    console.error(`secrets.ts c'è ma non si legge (${errText(e)}): correggilo, oppure rinominalo per rifare la configurazione guidata.`);
    process.exit(1);
  }
  const mancano = mancantiPerMotore(s);
  if (!mancano.length) return;
  console.log(`Il bot non è ancora configurato (mancano: ${mancano.join(", ")}). Completa la configurazione guidata nella dashboard: il motore parte da solo quando hai finito.`);
  const prima = mtimeSegreti();
  for (;;) {
    await Bun.sleep(5000);
    if (mtimeSegreti() !== prima) {
      console.log("Configurazione salvata: il motore riparte.");
      process.exit(CODICE_RIAVVIO);
    }
  }
}

const args = parseArgs();
chiudiSeOrfano();
if (!args.flags.has("fake")) await aspettaConfigurazione();
const { ctx } = await buildRuntime({ fake: args.flags.has("fake"), nowOverride: args.values.get("ora") });
console.log("Pianificatore attivo: un tick ogni 30 secondi. Ctrl+C per uscire.");
let ultimo = "";
// se secrets.ts cambia (configurazione guidata rifatta, chiavi cambiate a mano) il motore si riavvia tra due tick:
// altrimenti continuerebbe a lavorare con le chiavi vecchie
const segretiAllAvvio = args.flags.has("fake") ? null : mtimeSegreti();
for (;;) {
  if (segretiAllAvvio !== null && mtimeSegreti() !== segretiAllAvvio) {
    console.log("secrets.ts è cambiato: il motore riparte con le chiavi nuove.");
    process.exit(CODICE_RIAVVIO);
  }
  try {
    const r = await tick(ctx, { echo: true });
    if (r.fatto !== ultimo || r.esito) console.log(redact(`${formatRome(new Date())} · ${r.fatto}`));
    ultimo = r.fatto;
  } catch (e) {
    console.error(redact(`${formatRome(new Date())} · tick fallito: ${errText(e)}`));
  }
  await Bun.sleep(30_000);
}
