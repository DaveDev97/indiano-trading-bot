// bun run once [--slot briefing|apertura|meta|chiusura] [--force] [--fake] — sveglia immediata.
import { buildRuntime } from "../run/runtime.ts";
import { once } from "../run/tick.ts";
import { parseArgs } from "../util/args.ts";
import { errText, redact } from "../util/redact.ts";

const args = parseArgs();
try {
  const { ctx } = await buildRuntime({ fake: args.flags.has("fake"), nowOverride: args.values.get("ora") });
  const r = await once(ctx, args.values.get("slot") ?? "briefing", args.flags.has("force"));
  console.log(redact(r.messaggio));
  if (r.esito?.messaggio) console.log("\n" + redact(r.esito.messaggio.replace(/<[^>]+>/g, "")));
  if (r.esito?.allarmi.length) console.log("\nAllarmi:\n" + r.esito.allarmi.map((a) => `⚠ ${redact(a)}`).join("\n"));
  if (!r.ok) process.exitCode = 1;
} catch (e) {
  console.error(redact(`sveglia fallita: ${errText(e)}`));
  process.exitCode = 1;
}
