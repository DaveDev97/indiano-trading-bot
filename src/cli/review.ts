// bun run review [--force] [--fake] — review di apprendimento (se dovuta, o comunque con --force).
import * as path from "node:path";
import { buildRuntime } from "../run/runtime.ts";
import { maybeRunReview } from "../learning/review.ts";
import { parseArgs } from "../util/args.ts";
import { errText, redact } from "../util/redact.ts";
import { dateInTz, TZ_ROME } from "../util/time.ts";

const args = parseArgs();
try {
  const { ctx } = await buildRuntime({ fake: args.flags.has("fake"), logFile: (p) => path.join(p.logs, `review-${dateInTz(new Date(), TZ_ROME)}.log`) });
  const r = await maybeRunReview(ctx, { force: args.flags.has("force") });
  console.log(redact(r.eseguita ? `Review ${r.review!.id} eseguita (${r.motivo}).\n\n${r.review!.testo}` : `Review non dovuta: ${r.motivo}. Usa --force per farla comunque.`));
} catch (e) {
  console.error(redact(`review fallita: ${errText(e)}`));
  process.exitCode = 1;
}
