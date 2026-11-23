// bun run scan [--fake] [--limite N] — scansione fondamentale, riprende dalla cache. Il sabato poi controlla la review.
import * as path from "node:path";
import { buildRuntime } from "../run/runtime.ts";
import { runScan } from "../scan/scan.ts";
import { messaggioScan } from "../telegram/messaggi-scan.ts";
import { parseArgs } from "../util/args.ts";
import { errText, redact } from "../util/redact.ts";
import { dateInTz, partsInTz, TZ_ROME } from "../util/time.ts";
import { loadParams } from "../params/params.ts";
import { maybeRunReview } from "../learning/review.ts";

const args = parseArgs();

async function main() {
  const { ctx } = await buildRuntime({ fake: args.flags.has("fake"), logFile: (p) => path.join(p.logs, `scan-${dateInTz(new Date(), TZ_ROME)}.log`), nowOverride: args.values.get("ora") });
  const limite = args.values.get("limite") ? Number(args.values.get("limite")) : undefined;
  const r = await runScan(ctx, { limite });
  if (!r.ok) {
    ctx.log.error("scansione non eseguita", { motivo: r.motivo });
    if (r.motivo !== "scansione già in corso") await ctx.tg.send(`⚠ <b>Scansione non eseguita</b>: ${redact(r.motivo ?? "")}`);
    process.exitCode = 1;
    return;
  }
  const { params } = loadParams(ctx.paths, ctx.now());
  if (params.b("notifiche.telegram")) await ctx.tg.send(messaggioScan(r.watchlist!));
  ctx.log.info("scansione completata", { acquistabili: r.watchlist!.acquistabili.length, forti: r.watchlist!.forza.forti });
  if (partsInTz(ctx.now(), TZ_ROME).wd === 6 || args.flags.has("con-review")) await maybeRunReview(ctx, { force: false });
}

main().catch((e) => {
  console.error(redact(`Scansione fallita: ${errText(e)}`));
  process.exit(1);
});
