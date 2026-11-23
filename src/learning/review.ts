// Review periodica (§7.3) e conferma delle proposte (Telegram e dashboard, un solo effetto).
import * as path from "node:path";
import type { Ctx } from "../run/context.ts";
import { loadParams, saveParams, versioniManuali, type Params } from "../params/params.ts";
import { PARAM_BY_KEY } from "../config/parametri.ts";
import { schedeOmbra, schedeReali, type Scheda } from "../journal/schede.ts";
import { appendJournal } from "../journal/journal.ts";
import { paramSim } from "../journal/operazioni.ts";
import { leggiFreno } from "../cage/freno.ts";
import { seduteTra } from "../cage/pause.ts";
import { chiamaCervello } from "../brain/cervello.ts";
import { readJsonOr, writeJsonAtomic } from "../util/atomic.ts";
import { withShortLock } from "../util/shortlock.ts";
import { addDays, dateInTz, formatDateIt, TZ_NY } from "../util/time.ts";
import { esc, fmtNum, fmtPct } from "../telegram/format.ts";
import { fasciaAdx, fasciaDurata, perGruppo, statistiche, type Risultato, type Statistiche } from "./statistiche.ts";
import { valutaProposte, type EsitoProposte, type Valutazione } from "./proposte.ts";
import { leggiProposte, listaReview, type Proposta, type ReviewSalvata } from "./archivio.ts";
import { BENCHMARK } from "../config/settori.ts";
import { closedBars } from "../data/bars.ts";

function risultatiReali(schede: Scheda[]): Risultato[] {
  return schede.filter((s) => s.uscita && !s.manuale && !s.annullata).map((s) => ({
    id: s.tradeId, data: s.uscita!.data, R: s.uscita!.R, pct: s.uscita!.risultatoPct, usd: s.uscita!.risultatoUsd, spy: s.uscita!.spyRendimento, durata: s.uscita!.durataSedute,
    gruppi: gruppi(s, s.uscita!.motivo, s.uscita!.durataSedute),
  }));
}

function gruppi(s: Scheda, motivo: string, durata: number | null): Record<string, string> {
  const c = s.ingresso.segnale.conferme;
  return {
    profilo: s.ingresso.profilo ?? "n/d",
    settore: s.ingresso.settore ?? "n/d",
    conferme: Object.entries(c).filter(([, v]) => v).map(([k]) => k).join("+") || "nessuna",
    adx: fasciaAdx(s.ingresso.segnale.adx),
    uscita: motivo,
    durata: fasciaDurata(durata),
    versione: s.ingresso.paramsVersione,
    categoria: s.ingresso.categoria ?? "reale",
  };
}

function risultatiOmbra(schede: Scheda[], modo: "bracket" | "trailing"): Risultato[] {
  return schede.filter((s) => s.simulazione?.[modo]?.stato === "chiusa").map((s) => {
    const r = s.simulazione![modo]!;
    return { id: s.tradeId, data: r.uscita!.data, R: r.R, pct: r.rendimento, usd: null, spy: null, durata: r.sedute, gruppi: gruppi(s, r.uscita!.motivo, r.sedute) };
  });
}

function confrontoModalita(schede: Scheda[]): { n: number; bracket: Statistiche; trailing: Statistiche } {
  const both = schede.filter((s) => s.simulazione?.bracket?.stato === "chiusa" && s.simulazione?.trailing?.stato === "chiusa");
  const mk = (m: "bracket" | "trailing") => statistiche(both.map((s) => ({ id: s.tradeId, data: s.simulazione![m]!.uscita!.data, R: s.simulazione![m]!.R, pct: s.simulazione![m]!.rendimento, usd: null, spy: null, durata: null, gruppi: {} })));
  return { n: both.length, bracket: mk("bracket"), trailing: mk("trailing") };
}

export interface StatoReview {
  dovuta: boolean;
  motivo: string;
  sedute: number;
  nuoveOperazioni: number;
}

export async function statoReview(ctx: Ctx, P: Params): Promise<StatoReview> {
  const oggi = dateInTz(ctx.now(), TZ_NY);
  const ultima = listaReview(ctx.paths).at(-1);
  const da = ultima?.data ?? leggiFreno(ctx.paths, ctx.now()).stato.avvio;
  const cal = await ctx.broker.getCalendar(da, oggi);
  const sedute = seduteTra(cal, da, oggi);
  const nuove = schedeReali(ctx.paths).filter((s) => s.uscita && !s.manuale && s.uscita.data > da).length;
  const min = P.n("appr.reviewMinSedute"), max = P.n("appr.reviewMaxSedute"), op = P.n("appr.reviewMinOperazioni");
  if (sedute >= max) return { dovuta: true, motivo: `passate ${sedute} sedute dall'ultima review (massimo ${max})`, sedute, nuoveOperazioni: nuove };
  if (sedute >= min && nuove >= op) return { dovuta: true, motivo: `${sedute} sedute e ${nuove} operazioni reali nuove`, sedute, nuoveOperazioni: nuove };
  return { dovuta: false, motivo: sedute < min ? `solo ${sedute} sedute dall'ultima review (minimo ${min})` : `${nuove} operazioni nuove su ${op} e ${sedute} sedute su ${max}`, sedute, nuoveOperazioni: nuove };
}

export async function maybeRunReview(ctx: Ctx, o: { force: boolean }): Promise<{ eseguita: boolean; motivo: string; review?: ReviewSalvata }> {
  const P = loadParams(ctx.paths, ctx.now()).params;
  scadiProposte(ctx);
  const st = await statoReview(ctx, P);
  if (!st.dovuta && !o.force) {
    ctx.log.info("review non dovuta", { motivo: st.motivo });
    return { eseguita: false, motivo: st.motivo };
  }
  const r = await runReview(ctx, P, o.force ? `forzata (${st.motivo})` : st.motivo);
  return { eseguita: true, motivo: st.motivo, review: r };
}

async function confrontoSpy(ctx: Ctx, P: Params): Promise<{ sedute: number; bot: number | null; spy: number | null }> {
  const avvio = leggiFreno(ctx.paths, ctx.now()).stato.avvio;
  const oggi = dateInTz(ctx.now(), TZ_NY);
  try {
    const cal = await ctx.broker.getCalendar(avvio, oggi);
    const sedute = seduteTra(cal, avvio, oggi);
    const h = await ctx.broker.getPortfolioHistory(avvio);
    const eq = h.equity.filter((x): x is number => typeof x === "number" && x > 0);
    const bot = eq.length >= 2 ? eq.at(-1)! / eq[0]! - 1 : null;
    const raw = await ctx.data.getDailyBars([BENCHMARK], { start: addDays(avvio, -7), end: ctx.now(), adjustment: "all" });
    const b = closedBars(raw[BENCHMARK] ?? [], ctx.now(), cal);
    const a0 = b.filter((x) => x.t <= avvio).at(-1) ?? b[0];
    const spy = a0 && b.length ? b.at(-1)!.c / a0.c - 1 : null;
    return { sedute, bot, spy };
  } catch {
    return { sedute: 0, bot: null, spy: null };
  }
}

export const SYSTEM_REVIEW = [
  "Sei il \"cervello\" di un bot di paper trading. Scrivi la review periodica in italiano, chiara e onesta.",
  "Ricevi statistiche e proposte candidate GIÀ calcolate dal codice: non inventarne altre e non modificarne i valori.",
  "Scegli quali proposte presentare (anche nessuna) indicando i loro id in `proposteScelte`.",
  "Nel testo: cosa ha funzionato, cosa no, cosa proponi e perché, quanto è affidabile la conclusione.",
  "Con campione piccolo scrivilo chiaramente. Le operazioni ombra sono simulate: non mescolarle ai risultati reali.",
  "Se `modificheManuali` non è vuoto, dedica un paragrafo a ogni modifica fatta a mano: cosa è cambiato, perché (nota), e cosa dicono i risultati per versione (`perVersione`) rispetto alla versione precedente, con la cautela dovuta al campione.",
].join("\n");

export const SCHEMA_REVIEW = {
  type: "object",
  additionalProperties: false,
  properties: { testo: { type: "string" }, proposteScelte: { type: "array", items: { type: "string" } }, affidabilita: { type: "string", enum: ["bassa", "media", "alta"] } },
  required: ["testo", "proposteScelte", "affidabilita"],
};

export function validaReview(ids: Set<string>) {
  return (v: unknown): { ok: true; valore: { testo: string; proposteScelte: string[]; affidabilita: string } } | { ok: false; errore: string } => {
    if (!v || typeof v !== "object") return { ok: false, errore: "non è un oggetto" };
    const o = v as any;
    if (typeof o.testo !== "string" || !o.testo.trim()) return { ok: false, errore: "testo mancante" };
    if (!Array.isArray(o.proposteScelte) || o.proposteScelte.some((x: unknown) => typeof x !== "string")) return { ok: false, errore: "proposteScelte non valido" };
    if (o.proposteScelte.some((x: string) => !ids.has(x))) return { ok: false, errore: "proposta inventata (id non tra le candidate)" };
    if (!["bassa", "media", "alta"].includes(o.affidabilita)) return { ok: false, errore: "affidabilità non valida" };
    return { ok: true, valore: { testo: o.testo.slice(0, 6000), proposteScelte: [...new Set<string>(o.proposteScelte)], affidabilita: o.affidabilita } };
  };
}

export async function runReview(ctx: Ctx, P: Params, motivo: string): Promise<ReviewSalvata> {
  const now = ctx.now();
  const data = dateInTz(now, TZ_NY);
  const id = `r-${data}-${now.getTime().toString(36).slice(-4)}`;
  const reali = schedeReali(ctx.paths);
  const ombra = schedeOmbra(ctx.paths);
  const modo = P.s("uscita.modalita") as "bracket" | "trailing";
  const rr = risultatiReali(reali);
  const ro = risultatiOmbra(ombra, modo);
  const realiChiuse = rr.length;
  const piccolo = realiChiuse < P.n("appr.campionePiccolo");
  const ev: EsitoProposte = valutaProposte([...reali, ...ombra], P, { realiChiuse, paramSim: paramSim(P), seed: now.getTime() % 100000 });
  const spy = await confrontoSpy(ctx, P);
  const statisticheTot = {
    reali: statistiche(rr),
    ombra: statistiche(ro),
    perProfilo: perGruppo(rr, "profilo"),
    perSettore: perGruppo(rr, "settore"),
    perConferme: perGruppo(rr, "conferme"),
    perAdx: perGruppo(rr, "adx"),
    perUscita: perGruppo(rr, "uscita"),
    perDurata: perGruppo(rr, "durata"),
    perVersione: perGruppo(rr, "versione"),
    ombraPerCategoria: perGruppo(ro, "categoria"),
    modalitaReali: confrontoModalita(reali),
    modalitaTutte: confrontoModalita([...reali, ...ombra]),
    manualiSeparate: reali.filter((s) => s.manuale && s.uscita).length,
    portafoglio: spy,
  };
  let primaRiga = "";
  if (spy.sedute >= P.n("appr.sedutePrimaGiudizio") && spy.bot !== null && spy.spy !== null && spy.bot < spy.spy)
    primaRiga = `Il bot rende MENO di SPY: ${fmtPct(spy.bot)} contro ${fmtPct(spy.spy)} in ${spy.sedute} sedute di attività.`;
  const candidate = ev.candidate.map((v, i) => ({ id: `${id}-p${i + 1}`, ...v }));
  const datiCervello = {
    motivo, campionePiccolo: piccolo, operazioniRealiChiuse: realiChiuse, primaRiga: primaRiga || null,
    statistiche: { reali: statisticheTot.reali, ombra: statisticheTot.ombra, perProfilo: statisticheTot.perProfilo, perUscita: statisticheTot.perUscita, modalita: statisticheTot.modalitaTutte, portafogloVsSpy: spy },
    proposteCandidate: candidate.map((c) => ({ id: c.id, parametro: c.descrizione, da: c.da, a: c.a, effettoR: c.effettoR, n: c.n, icPrimi: c.icPrimi, icUltimi: c.icUltimi })),
    nonValutati: ev.nonValutati.slice(0, 30),
    // modifiche fatte a mano dall'ultima review: il cervello ne commenta l'effetto, versione per versione
    modificheManuali: versioniManuali(ctx.paths, listaReview(ctx.paths).at(-1)?.creata).map((v) => ({
      versione: `v${v.versione}`, data: v.data, nota: v.nota ?? null,
      modifiche: v.modifiche.map((m) => ({ parametro: PARAM_BY_KEY.get(m.chiave)?.descrizione ?? m.chiave, da: m.da, a: m.a })),
    })),
    perVersione: statisticheTot.perVersione,
  };
  const cerv = await chiamaCervello(ctx, P, {
    task: "review", runId: id, forzata: false, systemPrompt: SYSTEM_REVIEW, istruzioni: "Scrivi la review periodica con i dati qui sotto.",
    dati: datiCervello, schema: SCHEMA_REVIEW, valida: validaReview(new Set(candidate.map((c) => c.id))), modello: P.s("ai.modelloReview"), tetto: P.n("ai.tettoReview"),
  });
  let testo: string, scelte: string[], cervello: string;
  if (cerv.ok) {
    testo = cerv.valore.testo;
    scelte = cerv.valore.proposteScelte;
    cervello = `ok (affidabilità ${cerv.valore.affidabilita})`;
  } else {
    // senza cervello: testo scritto dal codice, nessuna proposta (le proposte le sceglie il modello)
    testo = testoDiRiserva(statisticheTot.reali, statisticheTot.ombra, piccolo, ev);
    if (datiCervello.modificheManuali.length) testo += `\n\nModifiche fatte a mano dall'ultima review: ${datiCervello.modificheManuali.map((m) => `${m.versione} (${m.modifiche.map((x) => `${x.parametro} ${x.da} → ${x.a}`).join("; ")})`).join(", ")}. Confrontale con i risultati per versione.`;
    scelte = [];
    cervello = `non disponibile: ${cerv.motivo}`;
  }
  if (piccolo) testo = `Campione piccolo (${realiChiuse} operazioni reali chiuse su ${P.n("appr.campionePiccolo")}): solo resoconto, nessuna proposta.\n\n${testo}`;
  if (primaRiga) testo = `${primaRiga}\n\n${testo}`;
  const proposte: Proposta[] = piccolo ? [] : candidate.filter((c) => scelte.includes(c.id)).map((c) => ({
    id: c.id, reviewId: id, chiave: c.chiave, da: c.da as any, a: c.a as any, direzione: c.direzione, effettoR: c.effettoR!, n: c.n,
    ic: { primi: c.icPrimi!, ultimi: c.icUltimi! }, descrizione: `${c.descrizione}: da ${c.da} a ${c.a}`, stato: "in attesa", creata: now.toISOString(),
    scade: new Date(now.getTime() + P.n("appr.scadenzaGiorni") * 86_400_000).toISOString(), decisa: null, decisaDa: null, versioneCreata: null,
  }));
  const sintesi = testo.split(/\n+/).slice(0, 3).join(" ").slice(0, 600);
  const rv: ReviewSalvata = { id, data, creata: now.toISOString(), paramsVersione: P.versione, campionePiccolo: piccolo, primaRiga, testo, sintesi, statistiche: { ...statisticheTot, valutazioni: ev.valutazioni, confronti: ev.confronti }, proposte: proposte.map((p) => p.id), nonValutati: ev.nonValutati, cervello };
  writeJsonAtomic(path.join(ctx.paths.reviews, `${id}.json`), rv);
  if (proposte.length) withShortLock(lockProposte(ctx), () => writeJsonAtomic(ctx.paths.proposte, [...leggiProposte(ctx.paths), ...proposte]));
  appendJournal(ctx.paths, { tipo: "review", runId: id, motivo, campionePiccolo: piccolo, proposte: proposte.map((p) => ({ id: p.id, chiave: p.chiave, da: p.da, a: p.a })), cervello }, now);
  if (P.b("notifiche.telegram")) await inviaReview(ctx, rv, proposte, statisticheTot.reali, statisticheTot.ombra);
  return rv;
}

function testoDiRiserva(r: Statistiche, o: Statistiche, piccolo: boolean, ev: EsitoProposte): string {
  const L = [
    `Operazioni reali chiuse: ${r.n}. Vincenti ${fmtPct(r.quotaVincenti, 0)}, attesa ${fmtNum(r.attesaR)} R, fattore di profitto ${fmtNum(r.fattoreProfitto)}.`,
    `Operazioni ombra (simulate, a parte): ${o.n}, attesa ${fmtNum(o.attesaR)} R.`,
    ev.candidate.length && !piccolo ? `Ci sono ${ev.candidate.length} modifiche che superano i controlli, ma senza il cervello non vengono proposte.` : "Nessun miglioramento robusto: nessuna proposta.",
    "Testo scritto dal codice: il cervello non era disponibile.",
  ];
  return L.join("\n");
}

async function inviaReview(ctx: Ctx, rv: ReviewSalvata, proposte: Proposta[], r: Statistiche, o: Statistiche): Promise<void> {
  const L = [`<b>📊 Review del ${esc(formatDateIt(rv.data))}</b> · id ${esc(rv.id)} · parametri ${esc(rv.paramsVersione)}`];
  if (rv.primaRiga) L.push(`⚠ <b>${esc(rv.primaRiga)}</b>`);
  L.push("");
  L.push(`Reali: ${r.n} chiuse, vincenti ${fmtPct(r.quotaVincenti, 0)}, attesa ${fmtNum(r.attesaR)} R. Ombra (simulate): ${o.n}, attesa ${fmtNum(o.attesaR)} R.`);
  L.push("");
  L.push(esc(rv.testo.slice(0, 2500)));
  if (proposte.length) {
    L.push("");
    L.push("<b>Proposte</b> (valgono dalla sveglia successiva all'approvazione):");
    for (const p of proposte) L.push(`• ${esc(p.descrizione)} — effetto ${fmtNum(p.effettoR, 2)} R su ${p.n} operazioni`);
    L.push("<i>I pulsanti funzionano se la dashboard è accesa: Telegram conserva i clic per 24 ore al massimo. Puoi sempre approvare dalla dashboard (scheda Review). Ogni proposta scade dopo 7 giorni.</i>");
  } else L.push("\nNessuna proposta.");
  const bottoni = proposte.map((p, i) => [
    { text: `✅ Approva ${i + 1}`, callback_data: `rv:a:${p.id}`.slice(0, 64) },
    { text: `❌ Rifiuta ${i + 1}`, callback_data: `rv:r:${p.id}`.slice(0, 64) },
  ]);
  const res = await ctx.tg.send(L.join("\n"), bottoni.length ? { bottoni } : {});
  if (!res.ok) ctx.log.warn("review non inviata su Telegram", { errore: res.errore });
}

export function lockProposte(ctx: Pick<Ctx, "paths">): string {
  return path.join(ctx.paths.state, "proposte.lock");
}

export function scadiProposte(ctx: Pick<Ctx, "paths" | "now">): number {
  return withShortLock(lockProposte(ctx), () => {
    const ps = leggiProposte(ctx.paths);
    let n = 0;
    for (const p of ps) if (p.stato === "in attesa" && Date.parse(p.scade) < ctx.now().getTime()) { p.stato = "scaduta"; p.decisa = ctx.now().toISOString(); n++; }
    if (n) writeJsonAtomic(ctx.paths.proposte, ps);
    return n;
  });
}

export type EsitoDecisione = { ok: boolean; messaggio: string; versione?: string };

/** Approva o rifiuta una proposta. Idempotente: una seconda approvazione (Telegram + dashboard) non ha effetto. */
export function decidiProposta(ctx: Pick<Ctx, "paths" | "now">, id: string, approva: boolean, da: "telegram" | "dashboard"): EsitoDecisione {
  return withShortLock(lockProposte(ctx), (): EsitoDecisione => {
    const ps = leggiProposte(ctx.paths);
    const p = ps.find((x) => x.id === id);
    if (!p) return { ok: false, messaggio: "proposta non trovata" };
    if (p.stato !== "in attesa") return { ok: false, messaggio: `proposta già ${p.stato}${p.versioneCreata ? ` (${p.versioneCreata})` : ""}: nessun effetto` };
    const now = ctx.now();
    if (Date.parse(p.scade) < now.getTime()) {
      p.stato = "scaduta";
      p.decisa = now.toISOString();
      writeJsonAtomic(ctx.paths.proposte, ps);
      return { ok: false, messaggio: "proposta scaduta" };
    }
    if (!approva) {
      p.stato = "rifiutata";
      p.decisa = now.toISOString();
      p.decisaDa = da;
      writeJsonAtomic(ctx.paths.proposte, ps);
      appendJournal(ctx.paths, { tipo: "proposta", id, esito: "rifiutata", da }, now);
      return { ok: true, messaggio: "proposta rifiutata" };
    }
    const def = PARAM_BY_KEY.get(p.chiave);
    if (!def) return { ok: false, messaggio: "parametro sconosciuto" };
    if (def.categoria === "sicurezza") {
      const menoPrudente = def.direzioneSicura === "giu" ? (p.a as number) > (p.da as number) : (p.a as number) < (p.da as number);
      if (menoPrudente) return { ok: false, messaggio: "rifiutata dal codice: direzione meno prudente per un parametro di sicurezza" };
    }
    const cur = loadParams(ctx.paths, now).params;
    if (cur.get(p.chiave) !== p.da) return { ok: false, messaggio: `conflitto: il parametro ora vale ${cur.get(p.chiave)}, non ${p.da}. Proposta non applicata.` };
    const res = saveParams(ctx.paths, { [p.chiave]: p.a }, { autore: `review ${p.reviewId}`, nota: `proposta ${p.id} approvata da ${da}`, versioneAttesa: cur.file.versione, now });
    if (!res.ok) return { ok: false, messaggio: res.errori.join("; ") };
    p.stato = "approvata";
    p.decisa = now.toISOString();
    p.decisaDa = da;
    p.versioneCreata = res.params.versione;
    writeJsonAtomic(ctx.paths.proposte, ps);
    appendJournal(ctx.paths, { tipo: "proposta", id, esito: "approvata", da, versione: res.params.versione }, now);
    return { ok: true, messaggio: `approvata: nuova versione ${res.params.versione}, valida dalla prossima sveglia`, versione: res.params.versione };
  });
}

