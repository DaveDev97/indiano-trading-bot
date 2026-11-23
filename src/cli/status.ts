// bun run status [--fake] — stato rapido nel terminale.
import { buildRuntime } from "../run/runtime.ts";
import { readLock } from "../run/lock.ts";
import { statoBot, conto } from "../dashboard/dati.ts";
import { NOME_SVEGLIA } from "../run/calendario.ts";
import { livelloStop } from "../run/piani.ts";
import { parseArgs } from "../util/args.ts";
import { errText, redact } from "../util/redact.ts";
import { formatRome } from "../util/time.ts";

const args = parseArgs();
const L: string[] = [];
try {
  const { ctx } = await buildRuntime({ fake: args.flags.has("fake"), echo: false });
  const lk = readLock(ctx.paths.runLock);
  L.push(`Lock sveglie: ${lk ? `occupato da ${lk.holder} ${lk.runId} (PID ${lk.pid}), battito ${formatRome(lk.heartbeat)}` : "libero"}`);
  const sl = readLock(ctx.paths.scanLock);
  if (sl) L.push(`Scansione in corso: battito ${formatRome(sl.heartbeat)}`);
  const st = await statoBot(ctx);
  L.push(`Parametri: ${st.P.versione}`);
  L.push(`Ultima sveglia: ${st.ultima ? `${st.ultima.id} (${st.ultima.tipo}), eseguita ${formatRome(st.ultima.eseguitaIl)}` : "nessuna"}`);
  L.push(`Prossima sveglia: ${st.prossima ? `${NOME_SVEGLIA[st.prossima.tipo]} ${formatRome(st.prossima.at)}` : "n/d"}`);
  L.push(`Watchlist: ${st.watchlist ? `del ${st.watchlist.data} (${st.etaWatchlist} giorni), ${st.watchlist.acquistabili.length} acquistabili` : "assente"}`);
  L.push(`Freno: ${st.freno.attivo ? "ATTIVO" : "non attivo"} · pausa acquisti: ${st.pausaAcquisti ? "sì" : "no"}`);
  for (const a of st.allarmi?.allarmi ?? []) L.push(`⚠ ${a}`);
  try {
    const c = await conto(ctx);
    L.push(`Patrimonio ${c.account.equity.toFixed(2)} $ · cash ${c.account.cash.toFixed(2)} $ · mercato ${c.mercatoAperto ? "aperto" : "chiuso"}`);
    for (const p of c.posizioni) {
      const pl = st.piani[p.symbol];
      const pr = c.prezzi[p.symbol] ?? p.currentPrice ?? 0;
      const prot = c.aperti.filter((o) => o.symbol === p.symbol && o.side === "sell").map((o) => o.type).join("+") || "NESSUNA PROTEZIONE";
      L.push(`  ${p.symbol} ${p.qty} @ ${p.avgEntryPrice.toFixed(2)} → ${pr.toFixed(2)} (${((pr / p.avgEntryPrice - 1) * 100).toFixed(2)}%) · stop ${pl ? livelloStop(pl)?.toFixed(2) : "n/d"} · ${prot}`);
    }
  } catch (e) {
    L.push(`Broker non raggiungibile: ${errText(e)}`);
  }
  console.log(redact(L.join("\n")));
} catch (e) {
  console.error(redact(`status fallito: ${errText(e)}`));
  process.exitCode = 1;
}
