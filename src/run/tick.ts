// tick: esegue la sveglia dovuta (finestra di 20 minuti) oppure, il sabato, la scansione e la review.
import * as path from "node:path";
import type { Ctx } from "./context.ts";
import { loadParams } from "../params/params.ts";
import { situazione, slotId, slotsDelGiorno, tipoDaNome, type SlotPrevisto } from "./calendario.ts";
import { eseguiSveglia, leggiStatoSveglie, type EsitoSveglia } from "./sveglia.ts";
import { runScan } from "../scan/scan.ts";
import { maybeRunReview } from "../learning/review.ts";
import { messaggioScan } from "../telegram/messaggi-scan.ts";
import { readJsonSafe } from "../util/atomic.ts";
import { addDays, clockInTz, dateInTz, partsInTz, TZ_NY, TZ_ROME } from "../util/time.ts";
import { createLogger } from "../util/log.ts";
import type { Watchlist } from "../scan/scan.ts";

/** Logger della sveglia: logs/<id>.log (righe JSON passate da redact). */
export function conLogDellaSveglia(ctx: Ctx, id: string, echo = true): Ctx {
  return { ...ctx, log: createLogger(path.join(ctx.paths.logs, `${id}.log`), echo) };
}

export async function tick(ctx: Ctx, opts: { echo?: boolean } = {}): Promise<{ fatto: string; esito?: EsitoSveglia }> {
  const now = ctx.now();
  const P = loadParams(ctx.paths, now).params;
  const roma = partsInTz(now, TZ_ROME);
  if (roma.wd === 6 && clockInTz(now, TZ_ROME) >= P.s("orari.scansione")) {
    const wl = readJsonSafe<Watchlist>(ctx.paths.watchlist);
    const oggi = dateInTz(now, TZ_ROME);
    if (!wl.ok || dateInTz(new Date(wl.value.generata), TZ_ROME) !== oggi || !wl.value.completa) {
      const c = conLogDellaSveglia(ctx, `scan-${oggi}`, opts.echo);
      const r = await runScan(c);
      if (r.ok && P.b("notifiche.telegram")) await ctx.tg.send(messaggioScan(r.watchlist!));
      if (r.ok) await maybeRunReview(c, { force: false });
      return { fatto: r.ok ? "scansione completata" : `scansione non eseguita: ${r.motivo}` };
    }
    return { fatto: "scansione del sabato già fatta" };
  }
  const oggiNy = dateInTz(now, TZ_NY);
  const cal = await ctx.broker.getCalendar(addDays(oggiNy, -5), addDays(oggiNy, 1));
  const st = leggiStatoSveglie(ctx);
  const ultima = st.eseguite.length ? new Date(st.eseguite.map((x) => x.previsto).sort().at(-1)!) : null;
  const sit = situazione(cal, P, now, new Set(st.eseguite.map((x) => x.id)), ultima);
  if (!sit.dovuta) return { fatto: "nessuna sveglia dovuta" };
  const c = conLogDellaSveglia(ctx, sit.dovuta.id, opts.echo);
  const esito = await eseguiSveglia(c, { slot: sit.dovuta, forzata: false });
  return { fatto: `sveglia ${sit.dovuta.id}: ${esito.eseguita ? "eseguita" : esito.motivo}`, esito };
}

/**
 * Sveglia immediata (bun run once). Se l'orario previsto è entro la finestra e non è ancora stata fatta, usa il suo id;
 * altrimenti è una sveglia "fuori orario" con id dell'ora attuale (non si confonde con quelle previste).
 */
export async function once(ctx: Ctx, nome: string, force: boolean): Promise<{ ok: boolean; messaggio: string; esito?: EsitoSveglia }> {
  const tipo = tipoDaNome(nome);
  if (!tipo) return { ok: false, messaggio: `sveglia sconosciuta: ${nome} (briefing, apertura, meta, chiusura)` };
  const now = ctx.now();
  const P = loadParams(ctx.paths, now).params;
  const oggi = dateInTz(now, TZ_NY);
  const day = (await ctx.broker.getCalendar(oggi, oggi))[0];
  if (!day && !force) return { ok: false, messaggio: `oggi (${oggi}) la borsa è chiusa: usa --force per una sveglia comunque` };
  const prevista = day ? slotsDelGiorno(day, P).find((s) => s.tipo === tipo) : undefined;
  const fatte = new Set(leggiStatoSveglie(ctx).eseguite.map((x) => x.id));
  const finestra = P.n("orari.finestraMinuti") * 60_000;
  let slot: SlotPrevisto;
  let forzata = force;
  if (prevista && !fatte.has(prevista.id) && now.getTime() >= prevista.at.getTime() && now.getTime() <= prevista.at.getTime() + finestra && !force) slot = prevista;
  else {
    if (prevista && fatte.has(prevista.id) && !force && Math.abs(now.getTime() - prevista.at.getTime()) <= finestra) return { ok: false, messaggio: `la sveglia ${prevista.id} è già stata eseguita: usa --force per rifarla` };
    slot = { tipo, at: now, id: slotId(now), seduta: day?.date ?? oggi };
    forzata = true;
  }
  const c = conLogDellaSveglia(ctx, slot.id);
  const esito = await eseguiSveglia(c, { slot, forzata });
  return { ok: esito.eseguita, messaggio: esito.eseguita ? `sveglia ${slot.id} eseguita${forzata ? " (fuori orario)" : ""}` : `sveglia non eseguita: ${esito.motivo}`, esito };
}
