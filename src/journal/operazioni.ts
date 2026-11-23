// Aggiornamento delle schede durante le sveglie: esecuzioni, uscite, trimestrali, simulazioni, operazioni ombra.
import type { Ctx } from "../run/context.ts";
import type { Params } from "../params/params.ts";
import type { CalendarDay, Order, Position } from "../broker/types.ts";
import { BENCHMARK } from "../config/settori.ts";
import { closedBars, compactBars, expandBars, type CompactBar } from "../data/bars.ts";
import type { Bar } from "../data/types.ts";
import { controlloPrezzo, type SegnaleTitolo } from "../signals/rules.ts";
import { addDays, dateInTz, TZ_NY } from "../util/time.ts";
import { errText } from "../util/redact.ts";
import { appendJournal, appendShadowJournal } from "./journal.ts";
import { schedeOmbra, schedeReali, unitaR, type CategoriaOmbra, type IngressoScheda, type Scheda } from "./schede.ts";
import { simula, type ParamSim } from "./simulatore.ts";
import { seduteTra } from "../cage/pause.ts";

export function paramSim(P: Params, s?: { stopPct: number; tpPct: number; trailPct: number }): ParamSim {
  return {
    stopPct: s?.stopPct ?? P.n("uscita.stopPct"),
    tpPct: s?.tpPct ?? P.n("uscita.takeProfitPct"),
    trailPct: s?.trailPct ?? P.n("uscita.trailingPct"),
    donchian: P.n("segnali.donchianPeriodo"),
    volumeMult: P.n("segnali.volumeMult"),
    volumeMedia: P.n("segnali.volumeMediaPeriodo"),
    maxSedute: P.n("appr.simulazioneMaxSedute"),
  };
}

/** Esecuzione degli acquisti: prezzo e quantità reali, oppure acquisto annullato. */
export async function aggiornaEsecuzioni(ctx: Ctx, runId: string): Promise<string[]> {
  const note: string[] = [];
  for (const s of schedeReali(ctx.paths)) {
    if (s.prezzoIngresso !== null || s.annullata || !s.ingresso.ordineId) continue;
    let o: Order | null = null;
    try {
      o = await ctx.broker.getOrderByClientId(s.ingresso.ordineId);
    } catch (e) {
      note.push(`${s.ingresso.simbolo}: stato dell'acquisto non leggibile (${errText(e)})`);
      continue;
    }
    if (!o) {
      appendJournal(ctx.paths, { tipo: "esecuzione", runId, tradeId: s.tradeId, simbolo: s.ingresso.simbolo, annullata: "ordine non trovato su Alpaca" }, ctx.now());
      continue;
    }
    const finale = ["filled", "canceled", "expired", "rejected", "done_for_day"].includes(o.status);
    if (o.filledQty > 0 && o.filledAvgPrice && (o.status === "filled" || finale)) {
      appendJournal(ctx.paths, { tipo: "esecuzione", runId, tradeId: s.tradeId, simbolo: o.symbol, prezzo: o.filledAvgPrice, quantita: o.filledQty, data: dateInTz(new Date(o.filledAt ?? ctx.now()), TZ_NY), stato: o.status }, ctx.now());
    } else if (finale && o.filledQty === 0) {
      appendJournal(ctx.paths, { tipo: "esecuzione", runId, tradeId: s.tradeId, simbolo: o.symbol, annullata: `acquisto ${o.status} senza esecuzione` }, ctx.now());
    }
  }
  return note;
}

function motivoDaOrdine(o: Order, ingresso: number, modalita: string, motiviIntenzione: Map<string, string>): string {
  const cid = o.clientOrderId;
  const m = motiviIntenzione.get(cid);
  if (m) return m;
  if (cid.includes("-manual-")) return "manuale";
  if (o.type === "limit") return "take profit";
  if (o.type === "trailing_stop") return o.filledAvgPrice! >= ingresso ? "stop mobile in utile" : "stop in perdita";
  if (o.type === "stop" || o.type === "stop_limit") return o.filledAvgPrice! < ingresso ? "stop in perdita" : "altro: stop in utile";
  if (o.status === "expired") return "protezione scaduta";
  return `altro: vendita ${o.type}`;
}

/** Rendimento di SPY (rettificato per i dividendi) dalla chiusura precedente l'ingresso alla chiusura dell'uscita. */
async function rendimentoSpy(ctx: Ctx, da: string, a: string, cal: CalendarDay[]): Promise<number | null> {
  try {
    const r = await ctx.data.getDailyBars([BENCHMARK], { start: addDays(da, -10), end: ctx.now(), adjustment: "all" });
    const b = closedBars(r[BENCHMARK] ?? [], ctx.now(), cal);
    const prima = b.filter((x) => x.t < da).at(-1);
    const fine = b.filter((x) => x.t <= a).at(-1);
    return prima && fine ? fine.c / prima.c - 1 : null;
  } catch {
    return null;
  }
}

/** Completa la scheda delle operazioni reali chiuse. */
export async function rilevaUscite(ctx: Ctx, runId: string, posizioni: Position[], acquistiAperti: Set<string>, cal: CalendarDay[], motiviIntenzione: Map<string, string>): Promise<Scheda[]> {
  const chiuse: Scheda[] = [];
  const tenuti = new Set(posizioni.map((p) => p.symbol));
  const aperte = schedeReali(ctx.paths).filter((s) => !s.uscita && !s.annullata && s.prezzoIngresso !== null);
  if (!aperte.length) return chiuse;
  let ordini: Order[] = [];
  try {
    ordini = await ctx.broker.listOrders({ status: "closed", after: addDays(dateInTz(ctx.now(), TZ_NY), -400) + "T00:00:00Z", symbols: [...new Set(aperte.map((s) => s.ingresso.simbolo))] });
  } catch (e) {
    ctx.log.warn("ordini chiusi non leggibili: schede di uscita rimandate", { errore: errText(e) });
    return chiuse;
  }
  for (const s of aperte) {
    const sym = s.ingresso.simbolo;
    if (tenuti.has(sym) || acquistiAperti.has(sym)) continue;
    const dopo = s.dataIngresso ?? s.ingresso.seduta;
    const vendite = ordini.filter((o) => o.symbol === sym && o.side === "sell" && o.filledQty > 0 && o.filledAvgPrice && o.filledAt && dateInTz(new Date(o.filledAt), TZ_NY) >= dopo);
    if (!vendite.length) continue;
    const qty = vendite.reduce((a, o) => a + o.filledQty, 0);
    const prezzo = vendite.reduce((a, o) => a + o.filledQty * o.filledAvgPrice!, 0) / qty;
    const ultima = vendite.sort((a, b) => (a.filledAt! < b.filledAt! ? 1 : -1))[0]!;
    const data = dateInTz(new Date(ultima.filledAt!), TZ_NY);
    const ing = s.prezzoIngresso!;
    const q = s.quantitaEseguita ?? qty;
    const path = expandBars(s.candeleDopo).filter((b) => b.t >= dopo && b.t <= data);
    const mfe = path.length ? Math.max(...path.map((b) => b.h)) / ing - 1 : null;
    const mae = path.length ? Math.min(...path.map((b) => b.l)) / ing - 1 : null;
    const ur = unitaR(s);
    const uscita = {
      motivo: motivoDaOrdine(ultima, ing, s.ingresso.modalita, motiviIntenzione),
      prezzo,
      data,
      durataSedute: seduteTra(cal, dopo, data),
      risultatoUsd: (prezzo - ing) * q,
      risultatoPct: prezzo / ing - 1,
      R: ur ? (prezzo - ing) / ur : null,
      mfe,
      mae,
      spyRendimento: await rendimentoSpy(ctx, dopo, data, cal),
      attraversoTrimestrale: s.trimestrale,
    };
    appendJournal(ctx.paths, { tipo: "scheda-uscita", runId, tradeId: s.tradeId, simbolo: sym, uscita }, ctx.now());
    chiuse.push({ ...s, uscita });
  }
  return chiuse;
}

/** Marca "attraverso la trimestrale" le posizioni aperte che hanno passato una data di trimestrale. */
export async function segnaTrimestrali(ctx: Ctx, runId: string): Promise<void> {
  const oggi = dateInTz(ctx.now(), TZ_NY);
  for (const s of schedeReali(ctx.paths)) {
    if (s.uscita || s.annullata || s.trimestrale || s.prezzoIngresso === null) continue;
    const da = s.dataIngresso ?? s.ingresso.seduta;
    const e = await ctx.fund.getEarnings(s.ingresso.simbolo, da, oggi).catch(() => null);
    if (e && e.some((x) => x.date >= da && x.date <= oggi)) appendJournal(ctx.paths, { tipo: "scheda-trimestrale", runId, tradeId: s.tradeId, simbolo: s.ingresso.simbolo, data: e[0]!.date }, ctx.now());
  }
}

/**
 * Aggiorna candele e simulazioni (bracket e trailing) di tutte le schede aperte, reali e ombra.
 * Le candele lette si salvano subito nella scheda: una nuova lettura non cambia i risultati passati.
 */
export async function aggiornaSimulazioni(ctx: Ctx, P: Params, runId: string, cal: CalendarDay[]): Promise<{ aggiornate: number; errori: string[] }> {
  const errori: string[] = [];
  const reali = schedeReali(ctx.paths).filter((s) => s.prezzoIngresso !== null && !s.annullata && (!s.simulazione || s.simulazione.inCorso));
  const ombra = schedeOmbra(ctx.paths).filter((s) => !s.nonEntrata && (s.prezzoIngresso === null || !s.simulazione || s.simulazione.inCorso));
  const tutte = [...reali, ...ombra];
  if (!tutte.length) return { aggiornate: 0, errori };
  const minDate = tutte.map((s) => s.ingresso.dataSegnale).sort()[0]!;
  const syms = [...new Set(tutte.map((s) => s.ingresso.simbolo))];
  let bars: Record<string, Bar[]> = {};
  try {
    const raw = await ctx.data.getDailyBars(syms, { start: addDays(minDate, 1), end: ctx.now(), adjustment: "split" });
    for (const [k, v] of Object.entries(raw)) bars[k] = closedBars(v, ctx.now(), cal);
  } catch (e) {
    errori.push(`candele per le simulazioni non disponibili: ${errText(e)}`);
    return { aggiornate: 0, errori };
  }
  let n = 0;
  const slip = P.n("appr.slittamento") / 100;
  const gapMax = P.n("rischio.gapMaxAtr");
  for (const s of tutte) {
    const write = s.reale ? (ev: any[]) => appendJournal(ctx.paths, ev, ctx.now()) : (ev: any[]) => appendShadowJournal(ctx.paths, ev, ctx.now());
    const have = new Set(s.candeleDopo.map((b) => b[0]));
    const nuove = (bars[s.ingresso.simbolo] ?? []).filter((b) => b.t > s.ingresso.dataSegnale && !have.has(b.t));
    const ev: any[] = [];
    let candele: CompactBar[] = s.candeleDopo;
    if (nuove.length) {
      ev.push({ tipo: "scheda-candele", runId, tradeId: s.tradeId, simbolo: s.ingresso.simbolo, candele: compactBars(nuove) });
      candele = [...s.candeleDopo, ...compactBars(nuove)].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    }
    let prezzoIngresso = s.prezzoIngresso;
    let dataIngresso = s.dataIngresso;
    if (!s.reale && prezzoIngresso === null) {
      const primo = expandBars(candele)[0];
      if (!primo) {
        if (ev.length) write(ev);
        continue;
      }
      // ingresso all'apertura della seduta dopo la candela del segnale, con lo stesso controllo del prezzo
      const ck = controlloPrezzo(s.ingresso.segnale, primo.o, gapMax);
      if (!ck.ok) {
        ev.push({ tipo: "esecuzione", runId, tradeId: s.tradeId, simbolo: s.ingresso.simbolo, nonEntrata: ck.motivi.join("; "), data: primo.t });
        write(ev);
        n++;
        continue;
      }
      prezzoIngresso = primo.o * (1 + slip);
      dataIngresso = primo.t;
      ev.push({ tipo: "esecuzione", runId, tradeId: s.tradeId, simbolo: s.ingresso.simbolo, prezzo: prezzoIngresso, data: primo.t, quantita: null });
    }
    const da = dataIngresso ?? s.ingresso.seduta;
    const percorso = expandBars(candele).filter((b) => b.t >= da);
    const storia = expandBars(s.ingresso.candeleSplit).filter((b) => b.t < da);
    const ur = (prezzoIngresso! * s.ingresso.stopPct) / 100;
    const ps = paramSim(P, s.ingresso);
    const br = simula("bracket", storia, percorso, prezzoIngresso!, ur, ps);
    const tr = simula("trailing", storia, percorso, prezzoIngresso!, ur, ps);
    const inCorso = br.stato === "aperta" || tr.stato === "aperta";
    const prev = s.simulazione;
    if (!prev || JSON.stringify(prev.bracket) !== JSON.stringify(br) || JSON.stringify(prev.trailing) !== JSON.stringify(tr) || prev.inCorso !== inCorso) {
      ev.push({ tipo: "scheda-simulazione", runId, tradeId: s.tradeId, simbolo: s.ingresso.simbolo, bracket: br, trailing: tr, inCorso, simulata: true });
    }
    if (ev.length) {
      write(ev);
      n++;
    }
  }
  return { aggiornate: n, errori };
}

export interface CandidatoOmbra {
  categoria: CategoriaOmbra;
  motivo: string;
  ingresso: Omit<IngressoScheda, "tradeId" | "seduta" | "prezzo" | "quantita" | "piano" | "ordineId">;
}

/** Registra le operazioni ombra della seduta (al massimo una ogni N sedute per titolo). */
export function creaOmbre(ctx: Ctx, P: Params, runId: string, seduta: string, cal: CalendarDay[], candidati: CandidatoOmbra[]): number {
  const esistenti = schedeOmbra(ctx.paths);
  const gap = P.n("appr.ombraIntervallo");
  const ev: any[] = [];
  const fatti = new Set<string>();
  for (const c of candidati) {
    const sym = c.ingresso.simbolo;
    if (fatti.has(sym)) continue;
    const ultima = esistenti.filter((s) => s.ingresso.simbolo === sym).map((s) => s.ingresso.dataSegnale).sort().at(-1);
    if (ultima && seduteTra(cal, ultima, c.ingresso.dataSegnale) < gap) continue;
    const tradeId = `S-${c.ingresso.dataSegnale}-${sym}`;
    if (esistenti.some((s) => s.tradeId === tradeId)) continue;
    fatti.add(sym);
    const ingresso: IngressoScheda = { ...c.ingresso, tradeId, seduta, prezzo: null, quantita: null, piano: null, ordineId: null, categoria: c.categoria, motivoOmbra: c.motivo };
    ev.push({ tipo: "scheda-ingresso", runId, tradeId, simbolo: sym, simulata: true, ingresso });
  }
  if (ev.length) appendShadowJournal(ctx.paths, ev, ctx.now());
  return ev.length;
}

export function snapshotSegnale(s: SegnaleTitolo): SegnaleTitolo {
  return { ...s };
}
