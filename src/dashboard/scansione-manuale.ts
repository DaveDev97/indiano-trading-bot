// Scansione lanciata dalla dashboard: un processo a parte (`bun run scan`), così continua anche se la pagina si chiude.
// Due scansioni insieme non sono possibili: la scansione ha il suo lock (state/scan.lock), indipendente da quello delle sveglie.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Ctx } from "../run/context.ts";
import { PROJECT_ROOT } from "../config/paths.ts";
import { readJsonSafe } from "../util/atomic.ts";
import { dateInTz, TZ_ROME } from "../util/time.ts";

export interface StatoScansione {
  inCorso: boolean;
  avviata: string | null;
  fase: string | null;
  fatti: number | null;
  totale: number | null;
}

/** Stato della scansione dal lock (processo vivo) e dall'ultima riga di avanzamento del suo log. */
export async function statoScansione(ctx: Ctx): Promise<StatoScansione> {
  const lk = readJsonSafe<{ pid: number; procStart: number; started: string }>(ctx.paths.scanLock);
  const vivo = lk.ok ? await ctx.probe.isAlive(lk.value.pid, lk.value.procStart).catch(() => false) : false;
  if (!lk.ok || !vivo) {
    // appena lanciata: il processo non ha ancora preso il lock. Si mostra «avvio» per al massimo 20 secondi,
    // e non oltre la scrittura della nuova lista (una scansione con tutto in cache può finire prima)
    let mtimeLista = 0;
    try {
      mtimeLista = fs.statSync(ctx.paths.watchlist).mtimeMs;
    } catch {}
    if (ultimoLancio && Date.now() - ultimoLancio < 20_000 && mtimeLista < ultimoLancio) return { inCorso: true, avviata: new Date(ultimoLancio).toISOString(), fase: "avvio", fatti: null, totale: null };
    return { inCorso: false, avviata: null, fase: null, fatti: null, totale: null };
  }
  let fase: string | null = "avvio", fatti: number | null = null, totale: number | null = null;
  try {
    const f = path.join(ctx.paths.logs, `scan-${dateInTz(new Date(lk.value.started), TZ_ROME)}.log`);
    const righe = fs.readFileSync(f, "utf8").trim().split(/\r?\n/).reverse();
    for (const r of righe) {
      const j = JSON.parse(r) as { ts: string; evento: string; fatti?: number; totale?: number };
      if (j.ts < lk.value.started) break;
      if (j.evento === "scansione in corso" || j.evento === "prefiltro in corso") {
        fase = j.evento === "prefiltro in corso" ? "prezzi e scambi (Alpaca)" : "bilanci (Finnhub)";
        fatti = j.fatti ?? null;
        totale = j.totale ?? null;
        break;
      }
      if (j.evento === "universo dopo il prefiltro") {
        fase = "bilanci (Finnhub)";
        break;
      }
    }
  } catch {}
  return { inCorso: true, avviata: lk.value.started, fase, fatti, totale };
}

/** Testo dell'avanzamento, lo stesso nella pagina e negli aggiornamenti ogni secondo. */
export function testoAvanzamento(sc: StatoScansione): string {
  const it = (n: number) => n.toLocaleString("it-IT");
  return `${sc.fase ?? "avvio"}${sc.fatti !== null && sc.totale ? ` · ${it(sc.fatti)} di ${it(sc.totale)}` : ""}`;
}

/**
 * Prima scansione: all'avvio della dashboard, se la lista dei titoli non c'è ancora (installazione nuova, appena
 * configurata), la scansione parte da sola. Senza, il bot resterebbe fermo fino al sabato.
 */
export async function scansioneIniziale(ctx: Ctx, lancia: (ctx: Ctx) => Promise<{ ok: boolean; messaggio: string }> = lanciaScansione): Promise<boolean> {
  if (fs.existsSync(ctx.paths.watchlist)) return false;
  if ((await statoScansione(ctx)).inCorso) return false;
  const r = await lancia(ctx);
  if (r.ok) ctx.log.info("prima scansione avviata in automatico: la lista dei titoli non c'era ancora");
  else ctx.log.warn("prima scansione non avviata", { motivo: r.messaggio });
  return r.ok;
}

let ultimoLancio = 0;

/** Avvia `bun run scan` staccato dalla dashboard. Il risultato arriva su Telegram e nella pagina Selezione. */
export async function lanciaScansione(ctx: Ctx): Promise<{ ok: boolean; messaggio: string }> {
  if ((await statoScansione(ctx)).inCorso) return { ok: false, messaggio: "Una scansione è già in corso: aspetta che finisca." };
  if (Date.now() - ultimoLancio < 30_000) return { ok: false, messaggio: "Scansione appena avviata: l'avanzamento compare qui sotto." };
  ultimoLancio = Date.now();
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.INDIANO_PADRE; // la scansione non deve chiudersi se si chiude la dashboard
  const p = Bun.spawn([process.execPath, "run", path.join(PROJECT_ROOT, "src", "cli", "scan.ts"), ...(ctx.fake ? ["--fake"] : [])], {
    cwd: PROJECT_ROOT,
    env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  p.unref();
  return { ok: true, messaggio: "Scansione avviata. Riprende dalla cache: con i dati già scaricati bastano pochi minuti, altrimenti circa un'ora. L'esito arriva anche su Telegram." };
}
