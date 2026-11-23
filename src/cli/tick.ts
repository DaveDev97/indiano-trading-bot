// bun run tick [--fake] — esegue la sveglia o la scansione dovuta. Non legge i pulsanti di Telegram (lo fa la dashboard).
import { buildRuntime } from "../run/runtime.ts";
import { tick } from "../run/tick.ts";
import { parseArgs } from "../util/args.ts";
import { errText, redact } from "../util/redact.ts";

const args = parseArgs();
try {
  const { ctx } = await buildRuntime({ fake: args.flags.has("fake"), nowOverride: args.values.get("ora") });
  const r = await tick(ctx);
  console.log(redact(r.fatto));
} catch (e) {
  console.error(redact(`tick fallito: ${errText(e)}`));
  process.exitCode = 1;
}
