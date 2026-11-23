// Azioni manuali (§8.2, §8.6): stesso esecutore e stesso lock delle sveglie (attesa fino a 60 s).
// Id dell'ordine: AAAA-MM-GG-SIMBOLO-manual-<codice>; il codice è nel modulo, quindi un doppio invio produce un solo ordine.
import type { Ctx } from "../run/context.ts";
import { acquireLock } from "../run/lock.ts";
import { Esecutore } from "../run/esecutore.ts";
import { aggiornaPiani, leggiPiani } from "../run/piani.ts";
import { classificaProtezioni } from "../run/protezioni.ts";
import { flattenOrders } from "../broker/types.ts";
import { arrotondaGiu, arrotondaSu } from "../cage/prezzi.ts";
import { appendJournal } from "../journal/journal.ts";
import { schedeReali } from "../journal/schede.ts";
import { loadParams } from "../params/params.ts";
import { errText } from "../util/redact.ts";
import { esc } from "../telegram/format.ts";

export interface EsitoAzione {
  ok: boolean;
  messaggio: string;
}

export const CODICE_RE = /^\d{4}-\d{2}-\d{2}\|[a-z0-9]{10}$/;

export function nuovoCodice(now: Date): string {
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return `${now.toISOString().slice(0, 10)}|${s}`;
}

function idManuale(codice: string, simbolo: string, suffisso = ""): string {
  const [data, c] = codice.split("|");
  return `${data}-${simbolo}-manual-${c}${suffisso}`;
}

async function conLock<T>(ctx: Ctx, nome: string, fn: (e: Esecutore) => Promise<T>, waitMs = 60_000): Promise<T | EsitoAzione> {
  const lk = await acquireLock(ctx.paths.runLock, { holder: "dashboard", runId: `manuale ${nome}`, probe: ctx.probe, now: ctx.now, waitMs });
  if (!lk.ok) return { ok: false, messaggio: lk.reason === "bloccata" ? "Il bot risulta bloccato (battito fermo): nessuna azione eseguita." : "Bot occupato, riprova tra poco." };
  try {
    return await fn(new Esecutore(ctx.broker, lk.lock, ctx.log, ctx.sleep));
  } finally {
    lk.lock.release();
  }
}

function registra(ctx: Ctx, simbolo: string, azione: string, dettagli: Record<string, unknown>, esito: EsitoAzione): void {
  const scheda = schedeReali(ctx.paths).filter((s) => s.ingresso.simbolo === simbolo && !s.uscita).at(-1);
  appendJournal(ctx.paths, { tipo: "manuale", simbolo, azione, ...dettagli, esito: esito.messaggio, ok: esito.ok }, ctx.now());
  if (scheda && esito.ok) appendJournal(ctx.paths, { tipo: "scheda-manuale", tradeId: scheda.tradeId, simbolo, azione }, ctx.now());
}

async function avvisa(ctx: Ctx, testo: string): Promise<void> {
  const P = loadParams(ctx.paths, ctx.now()).params;
  if (P.b("notifiche.telegram")) await ctx.tg.send(`🖐 <b>Azione manuale</b> (dashboard): ${esc(testo)}`);
}

/** Chiudi ora (mercato aperto) oppure, a mercato chiuso, "chiudi all'apertura" nel piano di uscita. */
export async function chiudi(ctx: Ctx, simbolo: string, codice: string, waitMs?: number): Promise<EsitoAzione> {
  if (!CODICE_RE.test(codice)) return { ok: false, messaggio: "Codice dell'azione non valido: ricarica la pagina." };
  const r = await conLock(ctx, `chiudi ${simbolo}`, async (e): Promise<EsitoAzione> => {
    const id = idManuale(codice, simbolo);
    const gia = await e.trovaPerId(id).catch(() => null);
    if (gia) return { ok: true, messaggio: `Ordine già inviato con questo modulo (${gia.status}): nessun nuovo ordine.` };
    const pos = await ctx.broker.getPosition(simbolo);
    if (!pos || pos.qty <= 0) return { ok: false, messaggio: "Posizione già chiusa." };
    const clock = await ctx.broker.getClock();
    if (!clock.isOpen) {
      const [data, c] = codice.split("|");
      aggiornaPiani(ctx.paths, (pp) => {
        if (pp[simbolo]) pp[simbolo] = { ...pp[simbolo]!, chiudiAllApertura: { richiesto: `${data}T00:00:00Z`, codice: c! }, origine: "manuale", aggiornato: ctx.now().toISOString() };
      }, { simbolo, nota: "chiudi all'apertura (manuale)" }, ctx.now());
      return { ok: true, messaggio: `Mercato chiuso: ${simbolo} verrà venduto alla sveglia di apertura. La protezione resta attiva fino ad allora.` };
    }
    const P = loadParams(ctx.paths, ctx.now()).params;
    const v = await e.vendi(simbolo, id, "chiusura manuale", P.n("uscita.attesaCancellazioneSec") * 1000);
    appendJournal(ctx.paths, { tipo: "ordine", id, motivoUscita: "manuale" }, ctx.now());
    if (v.stato === "venduto") return { ok: true, messaggio: `Vendita di ${v.quantita} ${simbolo} inviata.` };
    if (v.stato === "niente da vendere") return { ok: true, messaggio: "Quantità disponibile zero: una protezione si è eseguita durante la cancellazione." };
    return { ok: false, messaggio: `Vendita non eseguita: ${v.stato}${v.errore ? ` (${v.errore})` : ""}. Protezione lasciata com'è.` };
  }, waitMs);
  registra(ctx, simbolo, "chiudi", { codice }, r as EsitoAzione);
  await avvisa(ctx, `chiudi ${simbolo}: ${(r as EsitoAzione).messaggio}`);
  return r as EsitoAzione;
}

/** Modifica stop e take profit: stop ≥ 1% sotto il prezzo, take profit ≥ 1% sopra. PATCH sull'ordine esistente. */
export async function modificaLivelli(ctx: Ctx, simbolo: string, stop: number, tp: number | null): Promise<EsitoAzione> {
  const r = await conLock(ctx, `livelli ${simbolo}`, async (e): Promise<EsitoAzione> => {
    const pos = await ctx.broker.getPosition(simbolo);
    if (!pos) return { ok: false, messaggio: "Posizione già chiusa." };
    const piano = leggiPiani(ctx.paths).piani[simbolo];
    if (!piano) return { ok: false, messaggio: "Piano di uscita assente: attendi la prossima sveglia." };
    if (piano.modalita !== "bracket") return { ok: false, messaggio: "In modalità stop mobile non ci sono stop e take profit fissi." };
    const prezzo = (await ctx.data.getSnapshots([simbolo]))[simbolo]?.price ?? pos.currentPrice;
    if (!prezzo) return { ok: false, messaggio: "Prezzo attuale non disponibile." };
    const s = arrotondaGiu(stop);
    const t = tp !== null ? arrotondaSu(tp) : null;
    if (!(s > 0) || s > prezzo * 0.99) return { ok: false, messaggio: `Lo stop deve stare almeno l'1% sotto il prezzo attuale (${prezzo.toFixed(2)}): massimo ${(prezzo * 0.99).toFixed(2)}.` };
    if (t === null || t < prezzo * 1.01) return { ok: false, messaggio: `Il take profit deve stare almeno l'1% sopra il prezzo attuale: minimo ${(prezzo * 1.01).toFixed(2)}.` };
    const aperti = flattenOrders(await ctx.broker.listOrders({ status: "open", symbols: [simbolo] })).filter((o) => o.symbol === simbolo && o.side === "sell");
    const k = classificaProtezioni(aperti, pos.qty);
    const st = k.stops[0], lim = k.limits[0];
    if (!st || !lim) return { ok: false, messaggio: "Protezione incompleta sul broker: la prossima sveglia la ricrea. Riprova dopo." };
    const a = await e.modifica(st, { stopPrice: s }, "manuale");
    if (!a.ok) return { ok: false, messaggio: `Modifica dello stop fallita: ${a.errore}` };
    const b = await e.modifica(lim, { limitPrice: t }, "manuale");
    aggiornaPiani(ctx.paths, (pp) => {
      if (pp[simbolo]) pp[simbolo] = { ...pp[simbolo]!, stop: s, takeProfit: b.ok ? t : pp[simbolo]!.takeProfit, origine: "manuale", aggiornato: ctx.now().toISOString() };
    }, { simbolo, nota: `livelli modificati a mano: stop ${s}${b.ok ? `, take profit ${t}` : ""}` }, ctx.now());
    if (!b.ok) return { ok: false, messaggio: `Stop portato a ${s}, ma modifica del take profit fallita: ${b.errore}` };
    return { ok: true, messaggio: `Stop ${s} e take profit ${t} applicati (piano aggiornato, origine manuale).` };
  });
  registra(ctx, simbolo, "livelli", { stop, tp }, r as EsitoAzione);
  await avvisa(ctx, `livelli ${simbolo}: ${(r as EsitoAzione).messaggio}`);
  return r as EsitoAzione;
}

/** Passa a stop mobile: cancella l'OCO e crea il trailing_stop; se fallisce, ripristina subito l'OCO e manda un allarme. */
export async function passaATrailing(ctx: Ctx, simbolo: string, pct: number, codice: string): Promise<EsitoAzione> {
  if (!CODICE_RE.test(codice)) return { ok: false, messaggio: "Codice dell'azione non valido: ricarica la pagina." };
  if (!(pct >= 6 && pct <= 20)) return { ok: false, messaggio: "Lo stop mobile deve essere tra il 6% e il 20%." };
  const r = await conLock(ctx, `trailing ${simbolo}`, async (e): Promise<EsitoAzione> => {
    const id = idManuale(codice, simbolo);
    if (await e.trovaPerId(id).catch(() => null)) return { ok: true, messaggio: "Stop mobile già creato con questo modulo." };
    const pos = await ctx.broker.getPosition(simbolo);
    if (!pos) return { ok: false, messaggio: "Posizione già chiusa." };
    const piano = leggiPiani(ctx.paths).piani[simbolo];
    if (!piano || piano.modalita !== "bracket") return { ok: false, messaggio: "La posizione non è in modalità bracket." };
    const P = loadParams(ctx.paths, ctx.now()).params;
    const aperti = await e.venditeAperte(simbolo);
    const c = await e.cancellaEAttendi(aperti, P.n("uscita.attesaCancellazioneSec") * 1000);
    if (!c.ok) return { ok: false, messaggio: "Cancellazione dell'OCO non confermata: niente cambio, protezione lasciata com'è." };
    const posNow = await ctx.broker.getPosition(simbolo);
    if (!posNow || posNow.qty <= 0) return { ok: false, messaggio: "Una gamba si è eseguita durante la cancellazione: posizione chiusa." };
    const t = await e.invia({ clientOrderId: id, symbol: simbolo, side: "sell", type: "trailing_stop", qty: Math.floor(posNow.qty), tif: "gtc", trailPercent: pct }, "manuale");
    if (t.stato === "inviato" || t.stato === "già presente") {
      const prezzo = posNow.currentPrice ?? piano.massimo;
      aggiornaPiani(ctx.paths, (pp) => {
        pp[simbolo] = { ...pp[simbolo]!, modalita: "trailing", trailingPct: pct, trailPrice: null, stop: null, takeProfit: null, massimo: prezzo, origine: "manuale", aggiornato: ctx.now().toISOString() };
      }, { simbolo, nota: `passaggio a stop mobile ${pct}% (manuale)` }, ctx.now());
      return { ok: true, messaggio: `Stop mobile al ${pct}% creato.` };
    }
    // ripristino immediato dell'OCO precedente
    const rip = await e.invia({ clientOrderId: idManuale(codice, simbolo, "-rip"), symbol: simbolo, side: "sell", type: "limit", qty: Math.floor(posNow.qty), tif: "gtc", orderClass: "oco", takeProfit: { limitPrice: piano.takeProfit! }, stopLoss: { stopPrice: piano.stop! } }, "protect");
    const ripOk = rip.stato === "inviato" || rip.stato === "già presente";
    await ctx.tg.send(`⚠ <b>Allarme</b>: passaggio a stop mobile di ${esc(simbolo)} fallito (${esc(t.errore ?? t.stato)}). ${ripOk ? "OCO precedente ripristinato." : "<b>Ripristino dell'OCO fallito: posizione NON PROTETTA</b>, la prossima sveglia riprova."}`);
    return { ok: false, messaggio: `Creazione dello stop mobile fallita (${t.errore ?? t.stato}). ${ripOk ? "OCO ripristinato." : "Ripristino fallito: posizione non protetta, allarme inviato."}` };
  });
  registra(ctx, simbolo, "trailing", { pct, codice }, r as EsitoAzione);
  await avvisa(ctx, `stop mobile ${simbolo}: ${(r as EsitoAzione).messaggio}`);
  return r as EsitoAzione;
}

export function errore(e: unknown): EsitoAzione {
  return { ok: false, messaggio: `Errore: ${errText(e)}` };
}
