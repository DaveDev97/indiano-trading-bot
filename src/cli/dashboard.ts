// bun run dashboard [--fake] [--porta N] — server web su 127.0.0.1. È l'unico lettore dei pulsanti di Telegram.
import * as path from "node:path";
import { buildRuntime } from "../run/runtime.ts";
import { avviaDashboard } from "../dashboard/server.ts";
import { loadParams } from "../params/params.ts";
import { parseArgs } from "../util/args.ts";
import { errText, redact, registerSecret } from "../util/redact.ts";
import { dateInTz, TZ_ROME } from "../util/time.ts";

const args = parseArgs();
try {
  const fake = args.flags.has("fake");
  const { ctx, secrets } = await buildRuntime({ fake, logFile: (p) => path.join(p.logs, `dashboard-${dateInTz(new Date(), TZ_ROME)}.log`), echo: false });
  const P = loadParams(ctx.paths, ctx.now()).params;
  const porta = Number(args.values.get("porta") ?? P.n("dashboard.porta"));
  const password = fake ? (secrets?.dashboard.password || "dashboard-finta-123") : secrets!.dashboard.password;
  registerSecret(password);
  const d = avviaDashboard(ctx, { password, porta });
  console.log(`Dashboard su ${d.url}${fake ? " (modalità finta, password: dashboard-finta-123)" : ""}. Legge i pulsanti di Telegram ogni 30 secondi.`);
} catch (e) {
  console.error(redact(`dashboard non avviata: ${errText(e)}`));
  process.exit(1);
}
