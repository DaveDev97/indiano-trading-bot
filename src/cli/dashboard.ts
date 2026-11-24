// bun run dashboard [--fake] [--porta N] — server web su 127.0.0.1. È l'unico lettore dei pulsanti di Telegram.
// Al primo avvio (secrets.ts assente o incompleto) parte la configurazione guidata; finita quella, il processo
// esce con il codice di riavvio e `start avvia` / `start dashboard` lo rilanciano con la dashboard vera.
import * as fs from "node:fs";
import * as path from "node:path";
import { buildRuntime } from "../run/runtime.ts";
import { avviaDashboard } from "../dashboard/server.ts";
import { loadParams } from "../params/params.ts";
import { makePaths, PROJECT_ROOT } from "../config/paths.ts";
import { loadSecrets } from "../config/segreti.ts";
import { parseArgs } from "../util/args.ts";
import { chiudiSeOrfano } from "../util/process.ts";
import { errText, redact, registerSecret } from "../util/redact.ts";
import { dateInTz, TZ_ROME } from "../util/time.ts";
import { campiMancanti, CODICE_RIAVVIO } from "../setup/segreti-file.ts";
import { avviaConfigurazione } from "../setup/server-configurazione.ts";

const args = parseArgs();
chiudiSeOrfano();
try {
  const fake = args.flags.has("fake");
  if (!fake) {
    let s;
    try {
      s = await loadSecrets();
    } catch (e) {
      // un secrets.ts scritto a mano ma con un errore di sintassi non si sovrascrive mai
      console.error(`secrets.ts c'è ma non si legge (${errText(e)}): correggilo, oppure rinominalo per rifare la configurazione guidata.`);
      process.exit(1);
    }
    const mancano = campiMancanti(s);
    if (mancano.length) {
      const paths = makePaths(PROJECT_ROOT);
      const porta = Number(args.values.get("porta") ?? loadParams(paths).params.n("dashboard.porta"));
      const c = avviaConfigurazione({
        porta,
        esistenti: s,
        alTermine: () => {
          c.stop();
          try {
            fs.unlinkSync(path.join(paths.state, "codice-configurazione.txt"));
          } catch {}
          process.exit(CODICE_RIAVVIO);
        },
      });
      console.log(`Configurazione iniziale: apri ${c.url}  (codice ${c.codice}). Mancano: ${mancano.join(", ")}.`);
      // il codice non va nel log (che altri utenti del computer potrebbero leggere): sta in un file solo del proprietario,
      // utile quando la dashboard parte dall'Utilità di pianificazione e il terminale non si vede
      const fileCodice = path.join(paths.state, "codice-configurazione.txt");
      try {
        fs.mkdirSync(paths.state, { recursive: true });
        fs.writeFileSync(fileCodice, `${c.url}\n`, { mode: 0o600 });
        if (process.platform !== "win32") fs.chmodSync(fileCodice, 0o600);
        fs.mkdirSync(paths.logs, { recursive: true });
        fs.appendFileSync(path.join(paths.logs, `dashboard-${dateInTz(new Date(), TZ_ROME)}.log`), `${JSON.stringify({ ts: new Date().toISOString(), livello: "info", evento: `configurazione iniziale in attesa: il link con il codice è nel terminale e in ${fileCodice}` })}\n`);
      } catch {}
    } else await avviaNormale(fake);
  } else await avviaNormale(fake);
} catch (e) {
  console.error(redact(`dashboard non avviata: ${errText(e)}`));
  process.exit(1);
}

async function avviaNormale(fake: boolean) {
  const { ctx, secrets } = await buildRuntime({ fake, logFile: (p) => path.join(p.logs, `dashboard-${dateInTz(new Date(), TZ_ROME)}.log`), echo: false });
  const P = loadParams(ctx.paths, ctx.now()).params;
  const porta = Number(args.values.get("porta") ?? P.n("dashboard.porta"));
  const password = fake ? (secrets?.dashboard.password || "dashboard-finta-123") : secrets!.dashboard.password;
  registerSecret(password);
  const d = avviaDashboard(ctx, { password, porta });
  console.log(`Dashboard su ${d.url}${fake ? " (modalità finta, password: dashboard-finta-123)" : ""}. Legge i pulsanti di Telegram ogni 30 secondi.`);
}
