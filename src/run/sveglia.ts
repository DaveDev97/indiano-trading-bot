// Il giro di una sveglia (§6): lock → testimone → broker → parametri → dati e segnali → protezioni e uscite forti
// → cervello → gabbia → esecuzione → diario → testimone nuovo → Telegram e log → rilascio del lock.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Ctx } from "./context.ts";
import { acquireLock, readLock, type HeldLock, type LockContent } from "./lock.ts";
import { leggiTestimone, scriviTestimone, type Testimone } from "./baton.ts";
import { NOME_SVEGLIA, situazione, type SlotPrevisto } from "./calendario.ts";
import { Esecutore } from "./esecutore.ts";
import { aggiornaPiani, leggiPiani, livelloStop, ricostruisciPiano, type PianoUscita } from "./piani.ts";
import { controllaProtezioni, type EsitoProtezione } from "./protezioni.ts";
import { flattenOrders, isOpenStatus, type Account, type CalendarDay, type Order, type Position } from "../broker/types.ts";
import { loadParams, type Params } from "../params/params.ts";
import { appendJournal, readJournal } from "../journal/journal.ts";
import { readJsonOr, readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { addDays, dateInTz, formatRome, TZ_NY } from "../util/time.ts";
import { errText } from "../util/redact.ts";
import { valutaFreno } from "../cage/freno.ts";
import { lezioniDalDiario, pauseDaRifiuti, pauseDaUscite, usciteRecenti, type Pausa } from "../cage/pause.ts";
import { applicaGabbia, type Decisione, type Rifiuto, type TipoSveglia } from "../cage/gabbia.ts";
import { CassaSveglia, impegnoAcquistiAperti, quantita } from "../cage/dimensionamento.ts";
import { livelliBracket } from "../cage/prezzi.ts";
import { segnaliDellaSeduta, leggiCandele, type SegnaliSeduta } from "../signals/sessione.ts";
import { controlloPrezzo } from "../signals/rules.ts";
import type { Watchlist } from "../scan/scan.ts";
import { variazioneDaChiusura } from "../data/types.ts";
import type { VoceClassifica } from "../scan/classifica.ts";
import { chiamaCervello, SCHEMA_DECISIONE, SYSTEM_DECISIONE, validaDecisione } from "../brain/cervello.ts";
import { aggiornaEsecuzioni, aggiornaSimulazioni, creaOmbre, rilevaUscite, segnaTrimestrali, type CandidatoOmbra } from "../journal/operazioni.ts";
import { schedeReali, type IngressoScheda } from "../journal/schede.ts";
import { ultimaReview } from "../learning/archivio.ts";
import { messaggioAllarmi, messaggioFineSveglia } from "../telegram/messaggi.ts";
import { applicaOverride, leggiOverride } from "../scan/override.ts";
import type { Settore } from "../config/settori.ts";

export interface OpzioniSveglia {
  slot: SlotPrevisto;
  forzata: boolean;
  /** Recupero di una sveglia saltata (il bot è ripartito dopo l'orario). `anche`: le altre saltate di oggi, che non si recuperano più. */
  recupero?: { motivo: string; anche?: string[] };
}

export interface Candidato {
  voce: VoceClassifica;
  prezzo: number;
}

export interface EsitoSveglia {
  runId: string;
  tipo: TipoSveglia;
  eseguita: boolean;
  motivo?: string;
  allarmi: string[];
  inviati: { simbolo: string; azione: string; id: string; stato: string }[];
  rifiuti: Rifiuto[];
  errori: string[];
  messaggio: string;
  candidati: string[];
  decisioni: Decisione[];
  cervelloOk: boolean;
}

interface StatoSveglie {
  eseguite: { id: string; tipo: string; previsto: string; eseguitaIl: string; forzata: boolean; recupero?: boolean }[];
  saltateSegnalate: string[];
  /** Avvii di un recupero (un id può comparire due volte: il secondo è la ripresa dopo un processo interrotto). */
  recuperiTentati?: string[];
  /** Recuperi finiti (bene o male) o rinunciati: non si ritentano più. */
  recuperiConclusi?: string[];
}

/**
 * Sveglie che il recupero non deve più toccare: concluse, oppure già avviate due volte.
 * Un recupero avviato una volta e mai concluso (processo ucciso a metà) si riprende UNA volta: la sveglia successiva
 * altrimenti potrebbe trovarsi una posizione appena comprata senza la sua protezione per ore.
 */
export function recuperiBloccati(st: StatoSveglie): Set<string> {
  const n = new Map<string, number>();
  for (const id of st.recuperiTentati ?? []) n.set(id, (n.get(id) ?? 0) + 1);
  return new Set([...(st.recuperiConclusi ?? []), ...[...n].filter(([, k]) => k >= 2).map(([id]) => id)]);
}

export function leggiStatoSveglie(ctx: Ctx): StatoSveglie {
  return readJsonOr<StatoSveglie>(ctx.paths.sveglie, { eseguite: [], saltateSegnalate: [] });
}

/** Configurazione del conto: niente short, niente margine. Se non si applica, il bot non parte (§3.2, test 32). */
export async function assicuraConfigurazione(ctx: Ctx): Promise<string | null> {
  try {
    let c = await ctx.broker.getAccountConfig();
    if (c.noShorting !== true || c.maxMarginMultiplier !== "1") {
      await ctx.broker.patchAccountConfig({ noShorting: true, maxMarginMultiplier: "1" });
      c = await ctx.broker.getAccountConfig();
    }
    if (c.noShorting !== true || c.maxMarginMultiplier !== "1") return `configurazione del conto non applicata (no_shorting=${c.noShorting}, max_margin_multiplier=${c.maxMarginMultiplier}): il bot non parte`;
    return null;
  } catch (e) {
    return `configurazione del conto non verificabile: ${errText(e)}`;
  }
}

/** Riconcilia con Alpaca gli id lasciati da una sveglia interrotta (lock morti, anche di recuperi non completati). */
async function riconciliaLockMorti(ctx: Ctx, runId: string): Promise<string[]> {
  const out: string[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(ctx.paths.state).filter((f) => f.startsWith("run.lock.morto-") && !f.endsWith(".riconciliato"));
  } catch {
    return out;
  }
  for (const f of files) {
    const full = path.join(ctx.paths.state, f);
    const c = readLock(full) as LockContent | null;
    const righe: string[] = [];
    for (const id of c?.pendingOrderIds ?? []) {
      const o = await ctx.broker.getOrderByClientId(id).catch(() => undefined);
      righe.push(o === undefined ? `${id}: non verificabile` : o ? `${id}: arrivato (${o.status})` : `${id}: non arrivato`);
    }
    appendJournal(ctx.paths, { tipo: "allarme", runId, motivo: "sveglia precedente interrotta", lock: c ? { runId: c.runId, pid: c.pid, holder: c.holder } : null, riconciliati: righe }, ctx.now());
    out.push(`Sveglia precedente interrotta (${c?.runId ?? "sconosciuta"}). Ordini riconciliati: ${righe.length ? righe.join("; ") : "nessuno in sospeso"}.`);
    try {
      fs.renameSync(full, `${full}.riconciliato`);
    } catch {}
  }
  return out;
}

function giorniTra(a: string, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - Date.parse(a)) / 86_400_000));
}

export async function eseguiSveglia(ctx: Ctx, o: OpzioniSveglia): Promise<EsitoSveglia> {
  const runId = o.slot.id;
  const tipo = o.slot.tipo;
  const base: EsitoSveglia = { runId, tipo, eseguita: false, allarmi: [], inviati: [], rifiuti: [], errori: [], messaggio: "", candidati: [], decisioni: [], cervelloOk: false };
  const lk = await acquireLock(ctx.paths.runLock, { holder: "sveglia", runId, probe: ctx.probe, now: ctx.now });
  if (!lk.ok) {
    if (lk.reason === "bloccata") {
      const msg = `Sveglia bloccata: la sveglia ${lk.holder?.runId ?? "?"} (PID ${lk.holder?.pid}) è viva ma il suo battito è fermo dal ${lk.holder ? formatRome(lk.holder.heartbeat) : "?"}. Non subentro.`;
      // un recupero non ha finestra: ritenterebbe a ogni tick, e l'allarme lo mandano già le sveglie previste
      if (o.recupero) {
        ctx.log.warn("recupero rimandato: lock bloccato", { holder: lk.holder?.runId });
        return { ...base, motivo: "bloccata", allarmi: [msg] };
      }
      await ctx.tg.send(messaggioAllarmi(runId, [msg]));
      return { ...base, motivo: "bloccata", allarmi: [msg] };
    }
    ctx.log.info("sveglia già in corso", { holder: lk.holder?.runId });
    return { ...base, motivo: "sveglia già in corso" };
  }
  try {
    // ricontrollo DENTRO il lock: chi ha deciso che la sveglia era da fare può essere arrivato al lock dopo che
    // un'altra istanza l'aveva già eseguita e rilasciata (controllo e poi azione: la corsa si chiude solo qui)
    if (!o.forzata && leggiStatoSveglie(ctx).eseguite.some((x) => x.id === runId)) {
      ctx.log.info("sveglia già eseguita da un'altra istanza", { runId });
      return { ...base, motivo: "sveglia già eseguita" };
    }
    if (o.recupero) {
      // il tentativo si registra PRIMA del giro e sotto il lock: due motori partiti insieme non recuperano due volte,
      // e le altre sveglie saltate di oggi diventano concluse (una sola sveglia recuperata per giornata)
      const st0 = leggiStatoSveglie(ctx);
      if (recuperiBloccati(st0).has(runId) || st0.eseguite.some((x) => x.id === runId)) return { ...base, motivo: "recupero già tentato" };
      writeJsonAtomic(ctx.paths.sveglie, {
        ...st0,
        recuperiTentati: [...(st0.recuperiTentati ?? []), runId].slice(-200),
        recuperiConclusi: [...(st0.recuperiConclusi ?? []), ...(o.recupero.anche ?? [])].slice(-200),
      } satisfies StatoSveglie);
      try {
        return await giro(ctx, o, lk.lock, base);
      } finally {
        // finito, bene o male (anche con un errore): non si ritenta. Se il processo muore qui dentro, non si arriva a
        // questa riga e la sveglia dopo lo riprende una volta.
        const st1 = leggiStatoSveglie(ctx);
        writeJsonAtomic(ctx.paths.sveglie, { ...st1, recuperiConclusi: [...(st1.recuperiConclusi ?? []), runId].slice(-200) } satisfies StatoSveglie);
      }
    }
    return await giro(ctx, o, lk.lock, base);
  } catch (e) {
    const err = `errore imprevisto nella sveglia: ${errText(e)}`;
    ctx.log.error("sveglia interrotta da un errore", { errore: err });
    try {
      appendJournal(ctx.paths, { tipo: "errore", runId, motivo: err }, ctx.now());
    } catch {}
    await ctx.tg.send(messaggioAllarmi(runId, [err]));
    return { ...base, eseguita: false, motivo: err, errori: [err], allarmi: [err] };
  } finally {
    lk.lock.release();
  }
}

async function giro(ctx: Ctx, o: OpzioniSveglia, lock: HeldLock, r: EsitoSveglia): Promise<EsitoSveglia> {
  const { runId, tipo } = r;
  const now = ctx.now();
  const seduta = o.slot.seduta;
  const allarmi = r.allarmi;
  const note: string[] = [];
  const J = (ev: Record<string, unknown> & { tipo: any }) => appendJournal(ctx.paths, { runId, ...ev }, ctx.now());
  J({ tipo: "sveglia", sveglia: tipo, seduta, forzata: o.forzata, previsto: o.slot.at.toISOString() });

  // 1b. riconciliazione di sveglie interrotte
  allarmi.push(...(await riconciliaLockMorti(ctx, runId)));

  // 2. testimone e sveglie saltate
  const bt = leggiTestimone(ctx.paths);
  if (bt.allarme) allarmi.push(bt.allarme);
  const prev = bt.testimone;

  // 4. parametri
  const pl = loadParams(ctx.paths, now);
  const P = pl.params;
  if (pl.allarme) allarmi.push(pl.allarme);

  // 3. broker
  const cfgErr = await assicuraConfigurazione(ctx);
  if (cfgErr) {
    allarmi.push(cfgErr);
    J({ tipo: "errore", motivo: cfgErr });
    await ctx.tg.send(messaggioAllarmi(runId, allarmi));
    return { ...r, motivo: cfgErr };
  }
  let account: Account, posizioni: Position[], aperti: Order[], cal: CalendarDay[], mercatoAperto: boolean;
  try {
    [account, posizioni, aperti, cal] = await Promise.all([
      ctx.broker.getAccount(),
      ctx.broker.getPositions(),
      ctx.broker.listOrders({ status: "open" }).then(flattenOrders),
      ctx.broker.getCalendar(addDays(seduta, -60), addDays(seduta, 30)),
    ]);
    mercatoAperto = (await ctx.broker.getClock()).isOpen;
  } catch (e) {
    const err = `broker non raggiungibile: ${errText(e)}`;
    allarmi.push(err);
    J({ tipo: "errore", motivo: err });
    await ctx.tg.send(messaggioAllarmi(runId, allarmi));
    return { ...r, motivo: err, errori: [err] };
  }

  const st = leggiStatoSveglie(ctx);
  const eseguite = new Set(st.eseguite.map((x) => x.id));
  const ultimaEseguita = st.eseguite.length ? new Date(st.eseguite.map((x) => x.previsto).sort().at(-1)!) : prev ? new Date(prev.eseguitaIl) : null;
  const sit = situazione(cal, P, now, eseguite, ultimaEseguita);
  // alla prima sveglia in assoluto (nessuna eseguita, nessun testimone) non c'è niente di saltato
  const primaVolta = st.eseguite.length === 0 && !prev;
  const saltateNuove = primaVolta ? [] : sit.saltate.filter((s) => !st.saltateSegnalate.includes(s.id) && s.id !== runId);
  if (saltateNuove.length) allarmi.push(`Sveglie saltate: ${saltateNuove.map((s) => `${NOME_SVEGLIA[s.tipo]} delle ${formatRome(s.at).slice(11)} (run ${s.id})`).join(", ")}. ${o.recupero ? "Si recupera solo l'ultima utile della giornata, una volta." : "Non si recuperano."}`);
  if (o.recupero) note.unshift(`Recupero della sveglia di ${NOME_SVEGLIA[tipo]} prevista alle ${formatRome(o.slot.at).slice(11)}, eseguita alle ${formatRome(now).slice(11)}: ${o.recupero.motivo}.`);

  // stato del conto, freno, pausa acquisti, watchlist
  const freno = await valutaFreno(ctx.paths, ctx.broker, account.equity, P.n("rischio.freno"), now).catch((e) => {
    allarmi.push(`freno d'emergenza non verificabile: ${errText(e)} (acquisti bloccati per prudenza)`);
    return null;
  });
  if (freno?.attivo) allarmi.push(`Freno d'emergenza attivo: patrimonio ${account.equity.toFixed(0)} $ sotto il ${(P.n("rischio.freno") * 100).toFixed(0)}% del massimo ${freno.massimo?.toFixed(0)} $. Nessun nuovo acquisto. Si sblocca solo dalla dashboard.`);
  const pausaAcq = readJsonOr<{ attiva: boolean }>(ctx.paths.pausaAcquisti, { attiva: false }).attiva;
  const wlr = readJsonSafe<Watchlist>(ctx.paths.watchlist);
  // override manuali della dashboard: titoli aggiunti dalla zona grigia o tolti dalla lista (gabbia e segnali invariati)
  const ov = leggiOverride(ctx.paths);
  const wl = wlr.ok ? applicaOverride(wlr.value, ov).wl : null;
  const etaWl = wl ? giorniTra(wl.generata, now) : null;
  let wlProblema: string | null = null;
  if (ov.errore) wlProblema = `${ov.errore}: un titolo tolto a mano potrebbe tornare comprabile`;
  else if (!wl) wlProblema = "watchlist assente, la scansione non è ancora finita (la prima parte da sola all'avvio della dashboard, oppure dal pulsante in Selezione)";
  else if (etaWl! > P.n("settori.watchlistMaxGiorni")) wlProblema = `watchlist vecchia di ${etaWl} giorni (massimo ${P.n("settori.watchlistMaxGiorni")})`;
  if (wlProblema) allarmi.push(`${wlProblema}: nessun acquisto.`);

  // 5. segnali della seduta
  const simboliPos = posizioni.map((p) => p.symbol);
  const watchSyms = wl ? [...wl.acquistabili.map((v) => v.simbolo), ...wl.zonaGrigia.map((v) => v.simbolo), ...wl.settoriDeboli.map((v) => v.simbolo)] : [];
  const { segnali, calcolati } = await segnaliDellaSeduta(ctx, P, seduta, [...new Set([...simboliPos, ...watchSyms])], runId, cal);
  if (segnali.errore) allarmi.push(`Dati non disponibili: ${segnali.errore}. Nessun acquisto.`);
  if (calcolati) note.push(`segnali calcolati sulle candele chiuse fino al ${segnali.ultimaCandela}`);

  // prezzi attuali
  const candSyms = wl ? wl.acquistabili.map((v) => v.simbolo) : [];
  let prezzi: Record<string, number> = {};
  let spyOggi: number | null = null;
  try {
    const snaps = await ctx.data.getSnapshots([...new Set([...simboliPos, ...candSyms, "SPY"])]);
    for (const [k, v] of Object.entries(snaps)) prezzi[k] = v.price;
    const spy = snaps.SPY;
    spyOggi = variazioneDaChiusura(spy, dateInTz(now, TZ_NY));
  } catch (e) {
    allarmi.push(`Prezzi attuali non disponibili: ${errText(e)}. Nessun acquisto.`);
    for (const p of posizioni) if (p.currentPrice) prezzi[p.symbol] = p.currentPrice;
  }
  const prezziOk = candSyms.every((s) => prezzi[s] !== undefined) || candSyms.length === 0;

  // piani di uscita: ricostruzione se mancano, massimo raggiunto
  let { piani, persi } = leggiPiani(ctx.paths);
  for (const p of posizioni) {
    if (!piani[p.symbol]) {
      const prot = aperti.filter((x) => x.symbol === p.symbol && x.side === "sell");
      const ric = ricostruisciPiano(ctx.paths, p.symbol, p.qty, p.avgEntryPrice, prot, now);
      piani = aggiornaPiani(ctx.paths, (pp) => (pp[p.symbol] = ric), { runId, simbolo: p.symbol, nota: "piano ricostruito dagli ordini aperti e dal diario" }, now);
      allarmi.push(`${p.symbol}: piano di uscita ${persi ? "perso" : "mancante"}, ricostruito dagli ordini di protezione e dal diario.`);
    }
  }
  piani = aggiornaPiani(ctx.paths, (pp) => {
    for (const p of posizioni) {
      const pr = prezzi[p.symbol];
      const x = pp[p.symbol];
      if (x && pr && pr > x.massimo) {
        x.massimo = pr;
        x.aggiornato = now.toISOString();
      }
    }
  }, undefined, now);

  // esecuzioni degli acquisti precedenti (prezzo reale nella scheda)
  note.push(...(await aggiornaEsecuzioni(ctx, runId)));

  const esec = new Esecutore(ctx.broker, lock, ctx.log, ctx.sleep);
  const motivi = new Map<string, string>();
  const venduti = new Set<string>();

  // acquisti a mercato ancora aperti dopo 30 minuti: si cancellano
  for (const x of aperti.filter((x) => x.side === "buy" && !x.parentId && x.type === "market" && isOpenStatus(x.status))) {
    if (now.getTime() - Date.parse(x.createdAt) > P.n("rischio.cancellaAcquistoMinuti") * 60_000 && mercatoAperto) {
      const c = await esec.cancellaEAttendi([x], 10_000);
      allarmi.push(`${x.symbol}: acquisto a mercato ancora aperto dopo ${P.n("rischio.cancellaAcquistoMinuti")} minuti, ${c.ok ? "cancellato" : "cancellazione non confermata"}.`);
    }
  }

  // chiudi all'apertura (richiesta manuale dalla dashboard)
  if (tipo === "apertura" && mercatoAperto) {
    for (const p of posizioni) {
      const pl = piani[p.symbol];
      if (!pl?.chiudiAllApertura) continue;
      const id = `${pl.chiudiAllApertura.richiesto.slice(0, 10)}-${p.symbol}-manual-${pl.chiudiAllApertura.codice}`;
      motivi.set(id, "manuale");
      const v = await esec.vendi(p.symbol, id, "chiusura manuale richiesta dalla dashboard", P.n("uscita.attesaCancellazioneSec") * 1000);
      if (v.stato === "venduto" || v.stato === "niente da vendere") {
        venduti.add(p.symbol);
        r.inviati.push({ simbolo: p.symbol, azione: "vendi (manuale)", id, stato: v.stato });
      } else allarmi.push(`${p.symbol}: chiusura all'apertura non riuscita (${v.stato}). Protezione lasciata attiva.`);
    }
  }

  // uscite forti: il codice vende anche se il modello direbbe di tenere
  for (const p of posizioni) {
    if (venduti.has(p.symbol)) continue;
    const sg = segnali.titoli[p.symbol];
    if (!sg?.uscitaForte) continue;
    if (!mercatoAperto || tipo === "briefing") {
      note.push(`${p.symbol}: uscita forte segnalata, si vende alla sveglia di apertura`);
      continue;
    }
    const id = `${runId}-${p.symbol}-sell`;
    motivi.set(id, "uscita forte");
    const v = await esec.vendi(p.symbol, id, "uscita forte", P.n("uscita.attesaCancellazioneSec") * 1000);
    if (v.stato === "venduto" || v.stato === "niente da vendere") {
      venduti.add(p.symbol);
      r.inviati.push({ simbolo: p.symbol, azione: "vendi (uscita forte)", id, stato: v.stato });
    } else allarmi.push(`${p.symbol}: uscita forte non eseguita (${v.stato}).`);
  }

  // protezioni (dopo le vendite: le posizioni vendute non si proteggono)
  const posDaProteggere = posizioni.filter((p) => !venduti.has(p.symbol));
  const apertiOra = venduti.size ? flattenOrders(await ctx.broker.listOrders({ status: "open" })) : aperti;
  const prot: EsitoProtezione[] = await controllaProtezioni(posDaProteggere, apertiOra, {
    esecutore: esec,
    piani,
    prezzi,
    aggiornaPiano: (s, patch, nota) => {
      piani = aggiornaPiani(ctx.paths, (pp) => {
        if (pp[s]) pp[s] = { ...pp[s]!, ...patch, aggiornato: ctx.now().toISOString() };
      }, { runId, simbolo: s, nota }, ctx.now());
    },
    motivoUscita: (pl, pr) => (pl.modalita === "trailing" ? (pr >= pl.ingresso ? "stop mobile in utile" : "stop in perdita") : pr < pl.ingresso ? "stop in perdita" : "altro: stop in utile"),
  }, { runId, tipo, mercatoAperto, tentativi: P.n("uscita.tentativiProtezione"), maxGiorni: P.n("uscita.protezioneMaxGiorni"), attesaCancMs: P.n("uscita.attesaCancellazioneSec") * 1000, now });
  for (const x of prot) {
    if (x.stato === "venduta") {
      venduti.add(x.simbolo);
      motivi.set(`${runId}-${x.simbolo}-sell`, x.dettagli.includes("stop mobile in utile") ? "stop mobile in utile" : x.dettagli.includes("stop in perdita") ? "stop in perdita" : "altro: prezzo oltre lo stop");
    }
    if (x.allarme) allarmi.push(x.allarme);
  }
  const nonProtette = prot.filter((x) => x.stato === "non protetta" || (x.stato === "vendita all'apertura" && x.allarme)).map((x) => x.simbolo);

  // pause e lezioni
  const diario = readJournal(ctx.paths);
  let pause: Pausa[] = [];
  try {
    pause = pauseDaUscite(await usciteRecenti(ctx.broker, now), cal, seduta, P.n("rischio.pausaDopoStop"), P.n("rischio.pausaDopoUscita"));
  } catch (e) {
    allarmi.push(`ordini chiusi non leggibili, pause non verificabili: ${errText(e)}. Nessun acquisto.`);
    wlProblema ??= "pause non verificabili";
  }
  pause.push(...pauseDaRifiuti(diario, cal, seduta, P.n("rischio.rifiutiPerPausa"), P.n("rischio.pausaRifiuti")));
  const inPausa = new Map(pause.map((p) => [p.simbolo, p]));

  // candidati ammessi
  const tenuti = new Set(posizioni.map((p) => p.symbol));
  const acqAperti = new Map<string, Settore | null>();
  for (const x of apertiOra) if (x.side === "buy" && !x.parentId && isOpenStatus(x.status)) acqAperti.set(x.symbol, null);
  const settorePos = new Map<string, Settore | null>();
  const schede = schedeReali(ctx.paths);
  for (const p of posizioni) settorePos.set(p.symbol, schede.filter((s) => s.ingresso.simbolo === p.symbol).at(-1)?.ingresso.settore ?? wl?.acquistabili.find((v) => v.simbolo === p.symbol)?.settore ?? null);
  for (const k of acqAperti.keys()) acqAperti.set(k, wl?.acquistabili.find((v) => v.simbolo === k)?.settore ?? schede.filter((s) => s.ingresso.simbolo === k).at(-1)?.ingresso.settore ?? null);
  const scartati: { simbolo: string; motivo: string }[] = [];
  const candidati: Candidato[] = [];
  const listaBriefing = tipo === "meta" ? new Set(prev?.seduta === seduta && prev.listaBriefing ? prev.listaBriefing : readBriefingList(ctx, seduta)) : null;
  const ultimaSedutaTrim = cal.filter((c) => c.date >= seduta).map((c) => c.date)[P.n("rischio.sedutePrimaTrimestrale")] ?? addDays(seduta, 10);
  const staticiOk: string[] = [];
  if (wl && !segnali.errore) {
    const forti = new Set(wl.forza.forti);
    for (const v of wl.acquistabili) {
      const s = v.simbolo;
      const sg = segnali.titoli[s];
      const no = (m: string) => scartati.push({ simbolo: s, motivo: m });
      if (!forti.has(v.settore)) { no("settore non forte"); continue; }
      if (!sg) { no("segnali non disponibili"); continue; }
      if (!sg.ingresso) { no(`segnali di ingresso non superati: ${sg.motivi.join("; ")}`); continue; }
      if (tenuti.has(s) || acqAperti.has(s)) { no("già in portafoglio"); continue; }
      const pz = inPausa.get(s);
      if (pz) { no(`in pausa: ${pz.motivo}`); continue; }
      staticiOk.push(s);
      if (listaBriefing && !listaBriefing.has(s)) { no("non era nella lista del briefing"); continue; }
      const pr = prezzi[s];
      if (pr === undefined) { no("prezzo attuale non disponibile"); continue; }
      const ck = controlloPrezzo(sg, pr, P.n("rischio.gapMaxAtr"));
      if (!ck.ok) { no(ck.motivi.join("; ")); continue; }
      const ea = await ctx.fund.getEarnings(s, seduta, ultimaSedutaTrim).catch(() => null);
      if (ea === null) { no("data della trimestrale non verificabile"); continue; }
      if (ea.length) { no(`trimestrale il ${ea[0]!.date}, entro ${P.n("rischio.sedutePrimaTrimestrale")} sedute`); continue; }
      candidati.push({ voce: v, prezzo: pr });
      if (candidati.length >= P.n("ai.maxCandidati")) break;
    }
  }
  r.candidati = candidati.map((c) => c.voce.simbolo);
  if (wl) {
    const motivi = new Map<string, number>();
    for (const x of scartati) {
      const k = x.motivo.startsWith("segnali di ingresso") ? "segnali di ingresso non superati" : x.motivo.startsWith("in pausa") ? "in pausa" : x.motivo.startsWith("trimestrale") ? "trimestrale vicina" : x.motivo.split(":")[0]!.replace(/ d.*$/, "");
      motivi.set(k, (motivi.get(k) ?? 0) + 1);
    }
    note.push(`Candidati ammessi: ${candidati.length} su ${wl.acquistabili.length} acquistabili${motivi.size ? ` (scartati: ${[...motivi].map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}.`);
  }

  // blocco acquisti
  const maxPos = P.n("rischio.maxPosizioni");
  const occupati = new Set([...tenuti, ...acqAperti.keys()]).size;
  const postiLiberi = Math.max(0, maxPos - occupati);
  let blocco: string | null = null;
  if (freno?.attivo) blocco = "freno d'emergenza attivo";
  else if (!freno) blocco = "freno non verificabile";
  else if (pausaAcq) blocco = "pausa acquisti attiva dalle impostazioni";
  else if (wlProblema) blocco = wlProblema;
  else if (segnali.errore) blocco = "segnali non disponibili";
  else if (!prezziOk) blocco = "prezzi attuali non disponibili";
  else if (wl && wl.forza.forti.length === 0) blocco = "nessun settore forte";
  else if (nonProtette.length) blocco = `posizioni non protette (${nonProtette.join(", ")}): prima si risolve quello`;
  if (wl && wl.forza.forti.length === 0) note.push("Nessun settore forte: zero acquisti, come da regola.");

  // 6. cervello
  const posPerCervello = posizioni.filter((p) => !venduti.has(p.symbol)).map((p) => {
    const pl = piani[p.symbol];
    const sg = segnali.titoli[p.symbol];
    return {
      simbolo: p.symbol, settore: settorePos.get(p.symbol), quantita: p.qty, prezzoCarico: p.avgEntryPrice, prezzo: prezzi[p.symbol] ?? p.currentPrice,
      pnlPct: prezzi[p.symbol] ? prezzi[p.symbol]! / p.avgEntryPrice - 1 : null, giorni: pl ? giorniTra(pl.creato, now) : null,
      modalita: pl?.modalita, stop: pl ? livelloStop(pl) : null, takeProfit: pl?.takeProfit ?? null,
      usciteDeboli: sg?.usciteDeboli ?? [], uscitaForte: sg?.uscitaForte ?? false,
    };
  });
  const rv = ultimaReview(ctx.paths);
  const dati = {
    sveglia: NOME_SVEGLIA[tipo],
    seduta,
    acquistiAmmessi: (tipo === "apertura" || (tipo === "meta" && postoLiberatoOggi(ctx, seduta))) && !blocco && mercatoAperto,
    motivoBlocco: blocco,
    conto: { patrimonio: account.equity, cash: account.cash },
    posizioni: posPerCervello,
    postiLiberi,
    candidati: candidati.map((c) => ({
      simbolo: c.voce.simbolo, nome: c.voce.nome, settore: c.voce.settore, profilo: c.voce.profilo, punteggio: c.voce.punteggio, posizione: c.voce.posizioneGenerale, prezzo: c.prezzo,
      segnali: pick(segnali.titoli[c.voce.simbolo]!, ["adx", "pdi", "mdi", "nConferme", "conferme", "rapportoVolume", "sma50", "sma200", "atr", "chiusura", "livelloRotto"]),
      criteri: c.voce.criteri.filter((x) => x.esito !== "non applicabile").map((x) => ({ nome: x.nome, valore: x.valore, soglia: x.soglia, esito: x.esito })),
    })),
    pause: pause.map((p) => ({ simbolo: p.simbolo, motivo: p.motivo, finoA: p.finoA })),
    pianoPrecedente: prev?.piano ?? null,
    lezioni: lezioniDalDiario(diario),
    review: rv ? { data: rv.data, sintesi: rv.sintesi } : null,
  };
  const taskId = `decisione-${tipo}`;
  const cerv = await chiamaCervello(ctx, P, {
    task: taskId, runId, forzata: o.forzata, systemPrompt: SYSTEM_DECISIONE,
    istruzioni: `Sveglia di ${NOME_SVEGLIA[tipo]} del ${seduta}. Decidi tra le opzioni ammesse nei DATI. Se acquistiAmmessi è false non proporre acquisti.`,
    dati, schema: SCHEMA_DECISIONE, valida: validaDecisione, modello: P.s(tipo === "apertura" || tipo === "meta" ? "ai.modelloDecisioni" : "ai.modelloSemplici"), tetto: P.n("ai.tettoDecisione"),
  });
  allarmi.push(...cerv.allarmi);
  let ragionamento = "";
  let piano = "";
  let lezione: string | null = null;
  let decisioni: Decisione[] = [];
  if (cerv.ok) {
    r.cervelloOk = true;
    decisioni = cerv.valore.decisions;
    ragionamento = cerv.valore.reasoning;
    piano = cerv.valore.planNext;
    lezione = cerv.valore.lezione;
    J({ tipo: "decisione", decisioni, ragionamento, piano, lezione, paramsVersione: P.versione });
  } else {
    allarmi.push(`${cerv.sospeso ? "Cervello sospeso" : "Errore del cervello"}: ${cerv.motivo}. Protezioni e uscite forti eseguite, nessun acquisto.`);
    J({ tipo: "errore", motivo: cerv.motivo, codice: "cervello" });
    blocco ??= cerv.sospeso ? "cervello sospeso per il budget" : "cervello non disponibile";
  }
  r.decisioni = decisioni;

  // 7. gabbia
  const usciteDeboli = new Set(posPerCervello.filter((p) => p.usciteDeboli.length).map((p) => p.simbolo));
  const g = applicaGabbia(decisioni, {
    tipo, mercatoAperto,
    candidati: new Map(candidati.map((c) => [c.voce.simbolo, { settore: c.voce.settore }])),
    posizioni: new Map([...settorePos].filter(([k]) => !venduti.has(k))),
    acquistiAperti: acqAperti,
    usciteDeboli,
    maxPosizioni: maxPos,
    maxPerSettore: P.n("rischio.maxPerSettore"),
    bloccoAcquisti: cerv.ok ? blocco : blocco ?? "cervello non disponibile",
    postoLiberatoOggi: postoLiberatoOggi(ctx, seduta) || venduti.size > 0,
  });
  r.rifiuti.push(...g.rifiuti);

  // 8. esecuzione: prima le uscite deboli approvate, poi gli ingressi
  for (const d of g.vendite) {
    const id = `${runId}-${d.simbolo}-sell`;
    motivi.set(id, "uscita debole");
    const v = await esec.vendi(d.simbolo, id, "uscita debole", P.n("uscita.attesaCancellazioneSec") * 1000);
    if (v.stato === "venduto" || v.stato === "niente da vendere") {
      venduti.add(d.simbolo);
      r.inviati.push({ simbolo: d.simbolo, azione: "vendi (uscita debole)", id, stato: v.stato });
    } else r.rifiuti.push({ simbolo: d.simbolo, azione: "vendi", motivo: `vendita non eseguita: ${v.stato}`, codice: "vendita" });
  }
  const cassa = new CassaSveglia(account.cash, impegnoAcquistiAperti(apertiOra, (s) => prezzi[s] ?? null));
  const candById = new Map(candidati.map((c) => [c.voce.simbolo, c]));
  const modalita = P.s("uscita.modalita") as "bracket" | "trailing";
  for (const d of g.acquisti) {
    const c = candById.get(d.simbolo)!;
    const prezzo = c.prezzo;
    const qty = quantita(prezzo, account.equity, cassa.disponibile, P.n("rischio.peso"), P.n("rischio.margineCash"));
    if (qty < 1) {
      r.rifiuti.push({ simbolo: d.simbolo, azione: "compra", motivo: `quantità sotto 1 azione (cash disponibile ${cassa.disponibile.toFixed(0)} $)`, codice: "quantita-zero" });
      continue;
    }
    const id = `${runId}-${d.simbolo}-buy`;
    const tradeId = `T-${runId}-${d.simbolo}`;
    let stop: number | null = null, tp: number | null = null;
    if (modalita === "bracket") {
      const lv = livelliBracket(prezzo, P.n("uscita.stopPct"), P.n("uscita.takeProfitPct"));
      if ("errore" in lv) {
        r.rifiuti.push({ simbolo: d.simbolo, azione: "compra", motivo: lv.errore, codice: "livelli" });
        continue;
      }
      stop = lv.stop;
      tp = lv.takeProfit;
    }
    const pianoNuovo: PianoUscita = {
      simbolo: d.simbolo, tradeId, modalita, stop, takeProfit: tp, trailingPct: modalita === "trailing" ? P.n("uscita.trailingPct") : null, trailPrice: null,
      massimo: prezzo, ingresso: prezzo, quantita: qty, origine: "iniziale", creato: now.toISOString(), aggiornato: now.toISOString(), chiudiAllApertura: null, paramsVersione: P.versione,
    };
    // il piano si salva PRIMA dell'invio: se il processo muore, la sveglia dopo sa come proteggere
    piani = aggiornaPiani(ctx.paths, (pp) => (pp[d.simbolo] = pianoNuovo), { runId, simbolo: d.simbolo, nota: "piano iniziale" }, now);
    // scheda d'ingresso PRIMA dell'invio (come il piano): se il processo muore subito dopo l'ordine, l'operazione resta nel diario
    const cand = leggiCandele(ctx, seduta);
    const sg = segnali.titoli[d.simbolo]!;
    const fs0 = wl!.forza.settori.find((x) => x.settore === c.voce.settore);
    const ingresso: IngressoScheda = {
      tradeId, simbolo: d.simbolo, nome: c.voce.nome, runId, dataSegnale: sg.data, seduta, profilo: c.voce.profilo, settore: c.voce.settore,
      forzaSettore: fs0 ? { periodo: wl!.forza.periodo, rendimenti: fs0.rendimenti, spy: wl!.forza.spy, forte: fs0.forte } : null,
      criteri: c.voce.criteri, segnale: sg, punteggio: c.voce.punteggio, posizioneClassifica: c.voce.posizioneGenerale ?? null, motivazione: d.perche, override: c.voce.override ?? null,
      paramsVersione: P.versione, prezzo, quantita: qty, piano: pianoNuovo, modalita, stopPct: P.n("uscita.stopPct"), tpPct: P.n("uscita.takeProfitPct"), trailPct: P.n("uscita.trailingPct"),
      candele: cand.all[d.simbolo] ?? [], candeleSplit: cand.split[d.simbolo] ?? [], ordineId: id,
    };
    if (!schedeReali(ctx.paths).some((x) => x.tradeId === tradeId)) J({ tipo: "scheda-ingresso", tradeId, simbolo: d.simbolo, ingresso });
    const esito = modalita === "bracket"
      ? await esec.invia({ clientOrderId: id, symbol: d.simbolo, side: "buy", type: "market", qty, tif: "gtc", orderClass: "bracket", takeProfit: { limitPrice: tp! }, stopLoss: { stopPrice: stop! } }, "compra")
      : await esec.invia({ clientOrderId: id, symbol: d.simbolo, side: "buy", type: "market", qty, tif: "day" }, "compra");
    if (esito.nonInviato) {
      // il broker non ha risposto nemmeno alla verifica per id: l'ordine NON è partito (e non è un rifiuto dell'ordine)
      J({ tipo: "esecuzione", tradeId, simbolo: d.simbolo, annullata: `acquisto non inviato: ${esito.errore}` });
      piani = aggiornaPiani(ctx.paths, (pp) => delete pp[d.simbolo], { runId, simbolo: d.simbolo, nota: "acquisto non inviato: piano rimosso" }, now);
      allarmi.push(`${d.simbolo}: broker non raggiungibile, acquisto NON inviato (${esito.errore}).`);
      continue;
    }
    if (esito.stato === "rifiutato") {
      J({ tipo: "esecuzione", tradeId, simbolo: d.simbolo, annullata: `acquisto rifiutato dal broker: ${esito.errore}` });
      piani = aggiornaPiani(ctx.paths, (pp) => delete pp[d.simbolo], { runId, simbolo: d.simbolo, nota: "acquisto rifiutato: piano rimosso" }, now);
      r.rifiuti.push({ simbolo: d.simbolo, azione: "compra", motivo: `rifiutato dal broker: ${esito.errore}`, codice: esito.codice ?? "broker" });
      continue;
    }
    cassa.impegna(qty * prezzo * 1.01);
    r.inviati.push({ simbolo: d.simbolo, azione: "compra", id, stato: esito.ordine?.status ?? esito.stato });
    if (esito.stato === "esito sconosciuto") allarmi.push(`${d.simbolo}: acquisto senza risposta dal broker e non trovato per id. Non lo rimando; la prossima sveglia verifica.`);
    // modalità trailing: dopo l'esecuzione, lo stop mobile
    if (modalita === "trailing" && esito.ordine) {
      let filled: Order | null = null;
      const fino = Date.now() + P.n("uscita.attesaEsecuzioneSec") * 1000;
      for (let i = 0; i < 30; i++) {
        const cur = await ctx.broker.getOrderByClientId(id).catch(() => null);
        if (cur && cur.status === "filled") { filled = cur; break; }
        if (Date.now() > fino) break;
        await ctx.sleep(1000);
      }
      if (filled) {
        const t = await esec.invia({ clientOrderId: `${runId}-${d.simbolo}-protect`, symbol: d.simbolo, side: "sell", type: "trailing_stop", qty: filled.filledQty, tif: "gtc", trailPercent: P.n("uscita.trailingPct") }, "protect");
        if (t.stato === "rifiutato" || t.stato === "esito sconosciuto") allarmi.push(`${d.simbolo}: NON PROTETTA, stop mobile non creato (${t.errore ?? t.stato}). La prossima sveglia riprova.`);
      } else allarmi.push(`${d.simbolo}: acquisto non ancora eseguito dopo ${P.n("uscita.attesaEsecuzioneSec")} s, lo stop mobile lo crea la prossima sveglia.`);
    }
  }

  // eventi dell'esecutore e della gabbia nel diario (con la seduta, per lezioni e pause)
  for (const e of esec.eventi) J({ tipo: e.tipo, simbolo: e.simbolo, azione: e.azione === "compra" ? "compra" : e.azione, id: e.id, stato: e.stato, motivo: e.motivo, codice: e.codice, dettagli: e.dettagli, seduta });
  for (const x of g.rifiuti) J({ tipo: "rifiuto", simbolo: x.simbolo, azione: x.azione, motivo: x.motivo, codice: `gabbia-${x.codice}`, seduta });
  for (const x of r.rifiuti.filter((y) => !g.rifiuti.includes(y))) J({ tipo: "rifiuto", simbolo: x.simbolo, azione: x.azione, motivo: x.motivo, codice: x.codice, seduta });
  r.errori.push(...esec.eventi.filter((e) => e.tipo === "errore").map((e) => `${e.simbolo}: ${e.motivo}`));

  // uscite avvenute: scheda completata, piano rimosso
  const posDopo = await ctx.broker.getPositions().catch(() => posizioni);
  const apertiDopo = await ctx.broker.listOrders({ status: "open" }).then(flattenOrders).catch(() => apertiOra);
  const acqApertiDopo = new Set(apertiDopo.filter((x) => x.side === "buy" && !x.parentId).map((x) => x.symbol));
  // i motivi delle vendite di questa sveglia si registrano una volta; quelli passati si rileggono dal diario
  for (const [id, m] of motivi) J({ tipo: "ordine", id, motivoUscita: m });
  for (const e of readJournal(ctx.paths)) if (e.tipo === "ordine" && typeof e.id === "string" && typeof e.motivoUscita === "string" && !motivi.has(e.id)) motivi.set(e.id, e.motivoUscita);
  const chiuse = await rilevaUscite(ctx, runId, posDopo, acqApertiDopo, cal, motivi);
  const tenutiDopo = new Set(posDopo.map((p) => p.symbol));
  const daRimuovere = Object.keys(piani).filter((s) => !tenutiDopo.has(s) && !acqApertiDopo.has(s));
  if (daRimuovere.length) piani = aggiornaPiani(ctx.paths, (pp) => { for (const s of daRimuovere) delete pp[s]; }, { runId, nota: `piani chiusi: ${daRimuovere.join(", ")}` }, now);

  // chiusura: trimestrali, simulazioni, operazioni ombra
  let ombre = 0;
  if (tipo === "chiusura") {
    await segnaTrimestrali(ctx, runId).catch((e) => note.push(`trimestrali non verificate: ${errText(e)}`));
    if (wl && !segnali.errore) ombre = creaOmbre(ctx, P, runId, seduta, cal, candidatiOmbra(ctx, P, wl, segnali, seduta, new Set(r.inviati.filter((x) => x.azione === "compra").map((x) => x.simbolo)), scartati, decisioni));
    const sim = await aggiornaSimulazioni(ctx, P, runId, cal);
    note.push(...sim.errori);
    if (ombre) note.push(`${ombre} operazioni ombra registrate (simulate, separate dai risultati reali)`);
  }

  // 10. testimone
  const lezioni = lezioniDalDiario(readJournal(ctx.paths));
  const listaB = tipo === "briefing" ? staticiOk : prev?.seduta === seduta ? prev.listaBriefing : undefined;
  const testimone: Testimone = {
    runId, tipo, seduta, eseguitaIl: now.toISOString(), paramsVersione: P.versione,
    ordiniProposti: decisioni.map((d) => ({ simbolo: d.simbolo, azione: d.azione, perche: d.perche })),
    ordiniInviati: r.inviati,
    rifiuti: r.rifiuti.map((x) => ({ simbolo: x.simbolo, azione: x.azione, motivo: x.motivo })),
    errori: [...r.errori, ...allarmi],
    ragionamento, piano, lezioni, listaBriefing: listaB,
    testo: testoTestimone(tipo, seduta, r, ragionamento, piano, lezione, lezioni.length),
  };
  scriviTestimone(ctx.paths, testimone);
  if (tipo === "briefing") writeJsonAtomic(path.join(ctx.paths.segnali, `${seduta}-lista-briefing.json`), staticiOk);
  writeJsonAtomic(ctx.paths.sveglie, {
    eseguite: [...st.eseguite.filter((x) => x.id !== runId), { id: runId, tipo, previsto: o.slot.at.toISOString(), eseguitaIl: now.toISOString(), forzata: o.forzata, ...(o.recupero ? { recupero: true } : {}) }].slice(-400),
    saltateSegnalate: [...st.saltateSegnalate, ...saltateNuove.map((s) => s.id)].slice(-400),
    recuperiTentati: (st.recuperiTentati ?? []).slice(-200),
    recuperiConclusi: (st.recuperiConclusi ?? []).slice(-200),
  } satisfies StatoSveglie);
  writeJsonAtomic(ctx.paths.allarmi, { runId, ts: now.toISOString(), allarmi, nonProtette });

  // 11. Telegram
  const msg = messaggioFineSveglia({
    runId, tipo, P, account, posizioni: posDopo, piani, prezzi, spyOggi, inviati: r.inviati, rifiuti: r.rifiuti, ragionamento, cervelloOk: cerv.ok, cervelloMotivo: cerv.ok ? null : cerv.motivo,
    postiLiberi: Math.max(0, maxPos - new Set([...tenutiDopo, ...acqApertiDopo]).size), maxPos, prossima: sit.prossima, nonProtette, note, chiuse, blocco: tipo === "apertura" || tipo === "meta" ? blocco : null,
  });
  r.messaggio = msg;
  if (P.b("notifiche.telegram")) {
    const a = await ctx.tg.send(msg);
    if (!a.ok) ctx.log.warn("messaggio di fine sveglia non inviato", { errore: a.errore });
    if (allarmi.length) {
      const b = await ctx.tg.send(messaggioAllarmi(runId, allarmi));
      if (!b.ok) ctx.log.warn("allarmi non inviati su Telegram", { errore: b.errore });
    }
  }
  ctx.log.info("sveglia completata", { runId, inviati: r.inviati.length, rifiuti: r.rifiuti.length, allarmi: allarmi.length });
  return { ...r, eseguita: true, allarmi };
}

function pick(o: any, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = o?.[k];
  return out;
}

function readBriefingList(ctx: Ctx, seduta: string): string[] {
  return readJsonOr<string[]>(path.join(ctx.paths.segnali, `${seduta}-lista-briefing.json`), []);
}

/** Un posto si è liberato oggi se una vendita è stata eseguita in questa seduta (dal diario). */
function postoLiberatoOggi(ctx: Ctx, seduta: string): boolean {
  return schedeReali(ctx.paths).some((s) => s.uscita?.data === seduta);
}

function candidatiOmbra(ctx: Ctx, P: Params, wl: Watchlist, seg: SegnaliSeduta, seduta: string, comprati: Set<string>, scartati: { simbolo: string; motivo: string }[], decisioni: Decisione[]): CandidatoOmbra[] {
  const cand = leggiCandele(ctx, seduta);
  const out: CandidatoOmbra[] = [];
  const mk = (sym: string, categoria: CandidatoOmbra["categoria"], motivo: string, v: { nome?: string; settore: Settore; profilo: string; punteggio?: number; posizioneGenerale?: number; criteri: any[] }) => {
    const sg = seg.titoli[sym];
    if (!sg) return;
    const fs0 = wl.forza.settori.find((x) => x.settore === v.settore);
    out.push({
      categoria, motivo,
      ingresso: {
        simbolo: sym, nome: v.nome, runId: seg.runId, dataSegnale: sg.data, profilo: v.profilo, settore: v.settore,
        forzaSettore: fs0 ? { periodo: wl.forza.periodo, rendimenti: fs0.rendimenti, spy: wl.forza.spy, forte: fs0.forte } : null,
        criteri: v.criteri, segnale: sg, punteggio: v.punteggio ?? null, posizioneClassifica: v.posizioneGenerale ?? null, motivazione: null,
        paramsVersione: P.versione, modalita: P.s("uscita.modalita") as any, stopPct: P.n("uscita.stopPct"), tpPct: P.n("uscita.takeProfitPct"), trailPct: P.n("uscita.trailingPct"),
        candele: cand.all[sym] ?? [], candeleSplit: cand.split[sym] ?? [],
      },
    });
  };
  const contrari = new Set(decisioni.filter((d) => d.azione !== "compra").map((d) => d.simbolo));
  for (const v of wl.acquistabili) {
    const sg = seg.titoli[v.simbolo];
    if (!sg || comprati.has(v.simbolo)) continue;
    if (sg.ingresso) {
      const m = scartati.find((x) => x.simbolo === v.simbolo)?.motivo ?? (contrari.has(v.simbolo) ? "modello contrario" : "posti pieni o non scelto");
      if (!m.startsWith("già in portafoglio")) mk(v.simbolo, "non comprata", m, v);
    } else if (sg.quasi) mk(v.simbolo, "quasi", sg.quasiMotivo ?? "quasi", v);
  }
  for (const g of wl.zonaGrigia) {
    const sg = seg.titoli[g.simbolo];
    if (sg && (sg.ingresso || sg.quasi)) mk(g.simbolo, "zona grigia", `zona grigia: ${g.criterioMancato.nome} ${g.criterioMancato.valore ?? "n/d"} (soglia ${g.criterioMancato.soglia})${sg.ingresso ? "" : `; ${sg.quasiMotivo}`}`, { ...g, punteggio: undefined });
  }
  for (const v of wl.settoriDeboli) {
    const sg = seg.titoli[v.simbolo];
    if (sg && (sg.ingresso || sg.quasi)) mk(v.simbolo, "settore debole", `settore debole (${v.settore})${sg.ingresso ? "" : `; ${sg.quasiMotivo}`}`, v);
  }
  return out;
}

function testoTestimone(tipo: TipoSveglia, seduta: string, r: EsitoSveglia, ragionamento: string, piano: string, lezione: string | null, nLezioni: number): string {
  const L = [`Sveglia di ${NOME_SVEGLIA[tipo]} del ${seduta} (run ${r.runId}).`];
  L.push(r.inviati.length ? `Ordini inviati: ${r.inviati.map((x) => `${x.azione} ${x.simbolo} (${x.stato})`).join(", ")}.` : "Nessun ordine inviato.");
  if (r.rifiuti.length) L.push(`Rifiutati: ${r.rifiuti.map((x) => `${x.azione} ${x.simbolo}: ${x.motivo}`).join("; ")}.`);
  if (ragionamento) L.push(`Ragionamento: ${ragionamento}`);
  if (piano) L.push(`Piano per la prossima sveglia: ${piano}`);
  if (lezione) L.push(`Lezione: ${lezione}`);
  L.push(`Lezioni registrate (errori e rifiuti recenti): ${nLezioni}.`);
  return L.join("\n");
}
