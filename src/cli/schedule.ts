// bun run schedule [--fake] — tick ogni 30 secondi, finché non si chiude la finestra.
import { buildRuntime } from "../run/runtime.ts";
import { tick } from "../run/tick.ts";
import { parseArgs } from "../util/args.ts";
import { errText, redact } from "../util/redact.ts";
import { formatRome } from "../util/time.ts";
import { chiudiSeOrfano } from "../util/process.ts";

const args = parseArgs();
chiudiSeOrfano();
const { ctx } = await buildRuntime({ fake: args.flags.has("fake"), nowOverride: args.values.get("ora") });
console.log("Pianificatore attivo: un tick ogni 30 secondi. Ctrl+C per uscire.");
let ultimo = "";
for (;;) {
  try {
    const r = await tick(ctx, { echo: true });
    if (r.fatto !== ultimo || r.esito) console.log(redact(`${formatRome(new Date())} · ${r.fatto}`));
    ultimo = r.fatto;
  } catch (e) {
    console.error(redact(`${formatRome(new Date())} · tick fallito: ${errText(e)}`));
  }
  await Bun.sleep(30_000);
}
