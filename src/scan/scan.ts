// Scansione fondamentale settimanale (§4.1–4.4). Lock separato (state/scan.lock): non blocca le sveglie.
import type { Ctx } from "../run/context.ts";
import { acquireLock } from "../run/lock.ts";
import { loadParams, type Params } from "../params/params.ts";
import { settoreDi, type Settore } from "../config/settori.ts";
import { appendJournal } from "../journal/journal.ts";
import { readJsonOr, writeJsonAtomic } from "../util/atomic.ts";
import { addDays, dateInTz, TZ_NY } from "../util/time.ts";
import { errText } from "../util/redact.ts";
import { datiDa, PROFILI, valutaProfilo, type Profilo, type ValutazioneProfilo } from "./profili.ts";
import { classifica, type TitoloValutato, type VoceClassifica } from "./classifica.ts";
import { forzaSettori, type ForzaSettori } from "./forza-settori.ts";
import { capOk, FinnhubCache, prefiltro, prefiltroCacheFile } from "./universo.ts";

export interface VoceGrigia {
  simbolo: string;
  nome: string;
  settore: Settore;
  industria: string;
  profilo: Profilo;
  criterioMancato: { id: string; nome: string; valore: number | null; soglia: string; passi: number | null };
  criteri: ValutazioneProfilo["criteri"];
}

export interface Watchlist {
  data: string;
  generata: string;
  paramsVersione: string;
  forza: ForzaSettori;
  acquistabili: VoceClassifica[];
  zonaGrigia: VoceGrigia[];
  settoriDeboli: VoceClassifica[];
  conteggi: { universo: number; prefiltro: number; conDati: number; valutati: number; profili: Record<Profilo, number>; esclusi: Record<string, number> };
  criteriNonDisponibili: Record<string, number>;
  industrieNonMappate: Record<string, string[]>;
  avvisi: string[];
  completa: boolean;
}

export interface EsitoScan {
  ok: boolean;
  motivo?: string;
  watchlist?: Watchlist;
}

const MAX_GRIGI = 60;

/** Costruisce la watchlist dai titoli valutati (separata per i test). */
export function costruisciWatchlist(titoli: TitoloValutato[], forza: ForzaSettori, P: Params, meta: { data: string; generata: string; conteggi: Watchlist["conteggi"]; industrieNonMappate: Record<string, string[]> }): Watchlist {
  const voci = classifica(titoli, P.n("settori.minConfronto"));
  const forti = new Set(forza.forti);
  const perSett = P.n("settori.migliori");
  const acquistabili = voci.filter((v) => forti.has(v.settore) && v.posizioneSettore <= perSett).slice(0, P.n("settori.maxAcquistabili"));
  acquistabili.forEach((v, i) => (v.posizioneGenerale = i + 1));
  const settoriDeboli = voci.filter((v) => !forti.has(v.settore) && v.posizioneSettore <= 3);
  const passati = new Set(voci.map((v) => v.simbolo));
  const grigi: VoceGrigia[] = [];
  for (const t of titoli) {
    if (passati.has(t.simbolo)) continue;
    let best: VoceGrigia | null = null;
    for (const p of PROFILI) {
      const vp = t.profili[p];
      if (!vp.zonaGrigia) continue;
      const m = vp.criteri.find((c) => c.esito === "non superato")!;
      if (!best || (m.passiDallaSoglia ?? 9) < (best.criterioMancato.passi ?? 9))
        best = { simbolo: t.simbolo, nome: t.nome, settore: t.settore, industria: t.industria, profilo: p, criterioMancato: { id: m.id, nome: m.nome, valore: m.valore, soglia: m.soglia, passi: m.passiDallaSoglia }, criteri: vp.criteri };
    }
    if (best) grigi.push(best);
  }
  grigi.sort((a, b) => (a.criterioMancato.passi ?? 9) - (b.criterioMancato.passi ?? 9) || a.simbolo.localeCompare(b.simbolo));
  const nd: Record<string, number> = {};
  for (const t of titoli) for (const p of PROFILI) for (const c of t.profili[p].criteri) if (c.esito === "non disponibile") nd[`${c.id} (${c.nome})`] = (nd[`${c.id} (${c.nome})`] ?? 0) + 1;
  const conteggi = { ...meta.conteggi, profili: { growth: 0, value: 0, dividendo: 0 } as Record<Profilo, number> };
  for (const t of titoli) for (const p of PROFILI) if (t.profili[p].superato) conteggi.profili[p]++;
  const avvisi: string[] = [];
  if (forza.forti.length === 0) avvisi.push("Nessun settore forte: non entra niente di nuovo finché la situazione non cambia.");
  return { data: meta.data, generata: meta.generata, paramsVersione: P.versione, forza, acquistabili, zonaGrigia: grigi.slice(0, MAX_GRIGI), settoriDeboli, conteggi, criteriNonDisponibili: nd, industrieNonMappate: meta.industrieNonMappate, avvisi, completa: true };
}

/** Avviso se un profilo produce meno di N titoli per due scansioni di fila. */
export function avvisiProfili(paths: Ctx["paths"], conteggi: Record<Profilo, number>, data: string, minimo: number): string[] {
  const storico = readJsonOr<{ data: string; profili: Record<Profilo, number> }[]>(paths.scanHistory, []);
  const prev = storico.filter((s) => s.data !== data).at(-1);
  const out: string[] = [];
  for (const p of PROFILI) {
    if (conteggi[p] < minimo && prev && prev.profili[p] < minimo)
      out.push(`Il profilo ${p} ha prodotto meno di ${minimo} titoli per due scansioni di fila (${prev.profili[p]} e ${conteggi[p]}): conviene rivedere le sue soglie.`);
  }
  writeJsonAtomic(paths.scanHistory, [...storico.filter((s) => s.data !== data), { data, profili: conteggi }].slice(-20));
  return out;
}

export async function runScan(ctx: Ctx, opts: { limite?: number } = {}): Promise<EsitoScan> {
  const now = ctx.now();
  const data = dateInTz(now, TZ_NY);
  const lk = await acquireLock(ctx.paths.scanLock, { holder: "scansione", runId: `scan ${data}`, probe: ctx.probe, now: ctx.now });
  if (!lk.ok) return { ok: false, motivo: lk.reason === "bloccata" ? "scansione bloccata (battito fermo da più di 15 minuti)" : "scansione già in corso" };
  try {
    const { params: P, allarme } = loadParams(ctx.paths, now);
    if (allarme) ctx.log.warn(allarme);
    const cal = await ctx.broker.getCalendar(addDays(data, -400), data);
    const forza = await forzaSettori(ctx.data, now, cal, P.n("settori.periodoForza"));
    ctx.log.info("forza dei settori", { forti: forza.forti, data: forza.data });
    const assets = await ctx.broker.listAssets();
    const pre = await prefiltro(assets, ctx.data, now, cal, { prezzoMin: P.n("universo.prezzoMin"), controvaloreMin: P.n("universo.controvaloreMin"), cacheFile: prefiltroCacheFile(ctx.paths), log: ctx.log });
    const lista = opts.limite ? pre.sort((a, b) => b.controvalore - a.controvalore).slice(0, opts.limite) : pre;
    ctx.log.info("universo dopo il prefiltro", { titoli: lista.length, asset: assets.length });
    const cache = new FinnhubCache(ctx.paths.finnhubCache, ctx.fund, ctx.now);
    const esclusi: Record<string, number> = { senzaProfilo: 0, senzaMetriche: 0, industriaNonMappata: 0, capitalizzazione: 0, erroreDati: 0 };
    const nonMappate: Record<string, string[]> = {};
    const titoli: TitoloValutato[] = [];
    let conDati = 0;
    for (let i = 0; i < lista.length; i++) {
      const a = lista[i]!;
      try {
        const prof = (await cache.profile(a.simbolo, P.n("universo.cacheProfiloGiorni"))).data;
        if (!prof || !prof.finnhubIndustry) {
          esclusi.senzaProfilo!++;
          continue;
        }
        const settore = settoreDi(a.simbolo, prof.finnhubIndustry);
        if (!settore) {
          esclusi.industriaNonMappata!++;
          (nonMappate[prof.finnhubIndustry] ??= []).push(a.simbolo);
          continue;
        }
        const m = (await cache.metric(a.simbolo, P.n("universo.cacheMetricheGiorni"))).data;
        if (!m) {
          esclusi.senzaMetriche!++;
          continue;
        }
        conDati++;
        const cap = typeof m.metric.marketCapitalization === "number" ? (m.metric.marketCapitalization as number) : typeof prof.marketCapitalization === "number" ? prof.marketCapitalization : null;
        if (!capOk(cap, P.s("universo.capitalizzazione"))) {
          esclusi.capitalizzazione!++;
          continue;
        }
        const d = datiDa(m);
        const profili = Object.fromEntries(PROFILI.map((p) => [p, valutaProfilo(p, d, settore, P)])) as Record<Profilo, ValutazioneProfilo>;
        titoli.push({ simbolo: a.simbolo, nome: prof.name ?? a.nome, settore, industria: prof.finnhubIndustry, capitalizzazione: cap, prezzo: a.prezzo, controvalore: a.controvalore, profili });
      } catch (e) {
        esclusi.erroreDati!++;
        ctx.log.warn("dati Finnhub non disponibili", { simbolo: a.simbolo, errore: errText(e) });
      }
      if (i % 100 === 99) ctx.log.info("scansione in corso", { fatti: i + 1, totale: lista.length });
    }
    const wl = costruisciWatchlist(titoli, forza, P, {
      data,
      generata: now.toISOString(),
      conteggi: { universo: assets.length, prefiltro: pre.length, conDati, valutati: titoli.length, profili: { growth: 0, value: 0, dividendo: 0 }, esclusi },
      industrieNonMappate: nonMappate,
    });
    if (Object.keys(nonMappate).length) wl.avvisi.push(`Industrie non mappate (titoli esclusi): ${Object.entries(nonMappate).map(([k, v]) => `${k} (${v.length})`).join(", ")}.`);
    if (esclusi.erroreDati! > lista.length * 0.1) {
      wl.completa = false;
      wl.avvisi.push(`Dati Finnhub mancanti per ${esclusi.erroreDati} titoli su ${lista.length}: la scansione è incompleta, rilanciala per riprendere dalla cache.`);
    }
    wl.avvisi.push(...avvisiProfili(ctx.paths, wl.conteggi.profili, data, P.n("settori.avvisoMinProfilo")));
    writeJsonAtomic(ctx.paths.watchlist, wl);
    appendJournal(ctx.paths, { tipo: "scansione", data, paramsVersione: P.versione, acquistabili: wl.acquistabili.map((v) => v.simbolo), forti: forza.forti, conteggi: wl.conteggi, avvisi: wl.avvisi }, now);
    return { ok: true, watchlist: wl };
  } catch (e) {
    ctx.log.error("scansione fallita", { errore: errText(e) });
    return { ok: false, motivo: errText(e) };
  } finally {
    lk.lock.release();
  }
}
