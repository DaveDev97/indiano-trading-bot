// Stima, al momento dell'anteprima, di quanto un cambio dell'universo incide su scansione e consumo AI.
// Tutto dai dati veri: elenco titoli di Alpaca, cache del prefiltro e di Finnhub, watchlist, registro dei consumi.
// Dove manca un dato lo si dice ("stima" o "non stimabile"), non lo si inventa.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Ctx } from "../run/context.ts";
import type { Params } from "../params/params.ts";
import type { Valore } from "../config/parametri.ts";
import { BORSE_AMMESSE, BORSE_PER_SCELTA, NOME_BORSA, sedeAmmessa } from "../config/costanti.ts";
import { assetAmmesso, capOk, prefiltroCacheFile, type Prefiltrato } from "../scan/universo.ts";
import type { Watchlist } from "../scan/scan.ts";
import { readUsage } from "../brain/usage.ts";
import { leggiSegnali } from "../signals/sessione.ts";
import { readJsonSafe } from "../util/atomic.ts";
import { errText } from "../util/redact.ts";
import { html, num, usd, type Safe } from "./html.ts";
import { cached } from "./dati.ts";

/** Parametri che cambiano quanti titoli arrivano al cervello. */
export const CHIAVI_IMPATTO = ["universo.borse", "universo.sede", "universo.capitalizzazione", "universo.prezzoMin", "universo.controvaloreMin", "settori.migliori", "settori.maxAcquistabili", "ai.maxCandidati"];
const SVEGLIE_DECISIONE_MESE = 2 * 21; // apertura e metà seduta, circa 21 sedute al mese
const FINNHUB_AL_MINUTO = 50;

export interface Impatto {
  html: Safe;
  conferma: string;
}

interface Scenario {
  borse: string[];
  sede: string;
  cap: string;
  prezzoMin: number;
  controvaloreMin: number;
  migliori: number;
  maxAcq: number;
  maxCand: number;
}

const scenarioDa = (get: (k: string) => Valore): Scenario => ({
  borse: BORSE_PER_SCELTA[String(get("universo.borse"))] ?? BORSE_AMMESSE,
  sede: String(get("universo.sede")),
  cap: String(get("universo.capitalizzazione")),
  prezzoMin: Number(get("universo.prezzoMin")),
  controvaloreMin: Number(get("universo.controvaloreMin")),
  migliori: Number(get("settori.migliori")),
  maxAcq: Number(get("settori.maxAcquistabili")),
  maxCand: Number(get("ai.maxCandidati")),
});

function leggiCache<T>(dir: string, sym: string): T | null {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, `${sym}.json`), "utf8")) as { data: T | null }).data;
  } catch {
    return null;
  }
}

export async function stimaImpatto(ctx: Ctx, P: Params, modifiche: Record<string, Valore>): Promise<Impatto | null> {
  if (!Object.keys(modifiche).some((k) => CHIAVI_IMPATTO.includes(k))) return null;
  const prima = scenarioDa((k) => P.valori()[k]!);
  const dopo = scenarioDa((k) => (k in modifiche ? modifiche[k]! : P.valori()[k]!));
  try {
    // 1. titoli negoziabili per borsa (Alpaca), con cache di un'ora
    const assets = await cached("impatto-assets", 3600_000, () => ctx.broker.listAssets());
    const perBorsa = new Map<string, number>();
    for (const a of assets) if (assetAmmesso(a, Object.keys(NOME_BORSA))) perBorsa.set(a.exchange, (perBorsa.get(a.exchange) ?? 0) + 1);
    // 2. prezzo e scambi dalla cache del prefiltro; sede e capitalizzazione dalla cache di Finnhub
    const pre = readJsonSafe<{ data: string; borse?: string; righe: Prefiltrato[] }>(prefiltroCacheFile(ctx.paths));
    const righe = pre.ok ? pre.value.righe : [];
    const borseNote = new Set(righe.map((r) => r.borsa));
    const dirProf = path.join(ctx.paths.finnhubCache, "profile");
    const dirMet = path.join(ctx.paths.finnhubCache, "metric");
    const info = new Map(righe.map((r) => {
      const prof = leggiCache<{ country?: string; marketCapitalization?: number }>(dirProf, r.simbolo);
      const met = leggiCache<{ metric?: { marketCapitalization?: number } }>(dirMet, r.simbolo);
      const cap = typeof met?.metric?.marketCapitalization === "number" ? met.metric.marketCapitalization : typeof prof?.marketCapitalization === "number" ? prof.marketCapitalization : null;
      return [r.simbolo, { conProfilo: !!prof, country: prof?.country, cap }];
    }));
    const conta = (s: Scenario) => {
      let n = 0, finnhub = 0, stimati = 0;
      const liquidi = righe.filter((r) => s.borse.includes(r.borsa) && r.prezzo >= s.prezzoMin && r.controvalore >= s.controvaloreMin);
      for (const r of liquidi) {
        const i = info.get(r.simbolo)!;
        if (!i.conProfilo) finnhub += 2; // da chiedere a Finnhub (profilo e metriche)
        if (i.conProfilo && !sedeAmmessa(s.sede, i.country)) continue;
        if (i.cap !== null && !capOk(i.cap, s.cap)) continue;
        n++;
      }
      // borse mai scansionate (es. NYSE American): stessa quota di titoli liquidi delle borse note, segnata come stima
      const quota = righe.length ? liquidi.length / Math.max(1, [...borseNote].reduce((a, b) => a + (perBorsa.get(b) ?? 0), 0)) : 0;
      for (const b of s.borse) {
        if (borseNote.has(b)) continue;
        const extra = Math.round((perBorsa.get(b) ?? 0) * quota);
        stimati += extra;
        n += extra;
        finnhub += 2 * extra;
      }
      return { liquidi: n, finnhub, stimati };
    };
    const a = conta(prima), b = conta(dopo);
    // 3. acquistabili: i migliori N per settore forte, con la quota di titoli che supera un profilo nell'ultima scansione
    const wlr = readJsonSafe<Watchlist>(ctx.paths.watchlist);
    const wl = wlr.ok ? wlr.value : null;
    const k = wl?.conteggi;
    const quotaProfili = k && k.valutati > 0 ? (k.profili.growth + k.profili.value + k.profili.dividendo) / k.valutati : null;
    const forti = wl?.forza.forti.length ?? 0;
    const acquistabili = (s: Scenario, liquidi: number) => (quotaProfili === null ? null : Math.min(s.maxAcq, Math.round(forti * Math.min(s.migliori, (liquidi * quotaProfili) / 11))));
    const acqA = wl ? wl.acquistabili.length : acquistabili(prima, a.liquidi);
    const acqB = acquistabili(dopo, b.liquidi) !== null && acquistabili(prima, a.liquidi) !== null ? Math.max(0, Math.round((acqA ?? 0) * (acquistabili(dopo, b.liquidi)! / Math.max(1, acquistabili(prima, a.liquidi)!)))) : null;
    const candA = acqA === null ? null : Math.min(prima.maxCand, acqA);
    const candB = acqB === null ? null : Math.min(dopo.maxCand, acqB);
    // 4. costo AI: byte di un candidato nel prompt (dai dati veri) × costo per byte delle chiamate di decisione registrate
    const decisioni = readUsage(ctx.paths).filter((r) => r.task.startsWith("decisione-") && r.costoUsd !== null && r.promptByte > 0).slice(-40);
    const costoByte = decisioni.length ? decisioni.reduce((s, r) => s + r.costoUsd!, 0) / decisioni.reduce((s, r) => s + r.promptByte, 0) : null;
    const costoMeseOra = readUsage(ctx.paths).filter((r) => r.ts >= new Date(ctx.now().getTime() - 30 * 86400_000).toISOString()).reduce((s, r) => s + (r.costoUsd ?? 0), 0);
    let byteCandidato: number | null = null;
    if (wl?.acquistabili.length) {
      const sedFile = fs.existsSync(ctx.paths.segnali) ? fs.readdirSync(ctx.paths.segnali).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1) : undefined;
      const seg = sedFile ? leggiSegnali(ctx, sedFile.slice(0, 10)) : null;
      const campione = wl.acquistabili.slice(0, 10).map((v) => JSON.stringify({ simbolo: v.simbolo, nome: v.nome, settore: v.settore, profilo: v.profilo, punteggio: v.punteggio, posizione: v.posizioneGenerale, prezzo: v.prezzo, segnali: seg?.titoli[v.simbolo] ? Object.fromEntries(["adx", "pdi", "mdi", "nConferme", "conferme", "rapportoVolume", "sma50", "sma200", "atr", "chiusura", "livelloRotto"].map((x) => [x, (seg.titoli[v.simbolo] as any)[x]])) : {}, criteri: v.criteri.filter((x) => x.esito !== "non applicabile").map((x) => ({ nome: x.nome, valore: x.valore, soglia: x.soglia, esito: x.esito })) }).length);
      byteCandidato = Math.round(campione.reduce((s, x) => s + x, 0) / campione.length);
    }
    const deltaCand = candA !== null && candB !== null ? candB - candA : null;
    const deltaChiamata = deltaCand !== null && byteCandidato !== null && costoByte !== null ? deltaCand * byteCandidato * costoByte : null;
    const deltaMese = deltaChiamata === null ? null : deltaChiamata * SVEGLIE_DECISIONE_MESE;
    const minuti = (x: number) => Math.ceil(x / FINNHUB_AL_MINUTO);
    const serveScansione = Object.keys(modifiche).some((c) => c.startsWith("universo.") || c.startsWith("settori."));
    const segno = (x: number, f: (v: number) => string) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${f(Math.abs(x))}`;

    const righeT: [string, string, string, string][] = [
      ["Titoli da valutare (liquidi, borse, sede, capitalizzazione)", num(a.liquidi, 0), num(b.liquidi, 0), b.stimati ? `include ${num(b.stimati, 0)} titoli stimati di borse mai scansionate` : "dalle cache della scansione"],
      ["Richieste nuove a Finnhub alla prossima scansione", num(a.finnhub, 0), num(b.finnhub, 0), `circa ${num(minuti(b.finnhub), 0)} minuti (limite di ${FINNHUB_AL_MINUTO} al minuto); i dati in cache non si richiedono`],
      ["Acquistabili attesi", acqA === null ? "n/d" : num(acqA, 0), acqB === null ? "n/d" : num(acqB, 0), `al massimo ${dopo.migliori} per settore forte (oggi ${forti}), tetto ${dopo.maxAcq}`],
      ["Candidati al cervello per sveglia, al massimo", candA === null ? "n/d" : num(candA, 0), candB === null ? "n/d" : num(candB, 0), `tetto ai.maxCandidati = ${dopo.maxCand}; di solito sono meno, perché servono i segnali d'ingresso`],
    ];
    const testoAi = deltaMese === null
      ? (costoByte === null ? "non stimabile: non c'è ancora nessuna chiamata di decisione misurata nel registro dei consumi." : "non stimabile: manca la watchlist per misurare quanto pesa un candidato.")
      : deltaCand === 0
        ? `invariato: il cervello riceve lo stesso numero massimo di candidati (${candB}). Cambiano solo la durata e le richieste della scansione, che non usa l'AI.`
        : `${segno(deltaMese, (v) => usd(v, 2))} al mese nel caso peggiore (${segno(deltaChiamata!, (v) => usd(v, 3))} per sveglia × ${SVEGLIE_DECISIONE_MESE} sveglie di decisione), su una spesa degli ultimi 30 giorni di ${usd(costoMeseOra, 2)}.`;
    const corpo = html`<div class="card" style="margin-bottom:18px;border:1px solid color-mix(in oklab,var(--color-accent-2) 45%,transparent)"><h3>⚠ Impatto stimato del cambio</h3>
<p><b>Consumo AI:</b> ${testoAi}</p>
<div class="scroll"><table><tr><th>Cosa</th><th class="n">Ora</th><th class="n">Dopo</th><th>Come è stimato</th></tr>${righeT.map(([n, x, y, d]) => html`<tr><td>${n}</td><td class="n">${x}</td><td class="n"><b>${y}</b></td><td class="small muted">${d}</td></tr>`)}</table></div>
<p class="small muted">Come si calcola il consumo AI: un candidato pesa circa ${byteCandidato === null ? "n/d" : num(byteCandidato, 0)} byte nel prompt, e le ultime ${decisioni.length} chiamate di decisione sono costate in media ${costoByte === null ? "n/d" : usd(costoByte * 1000, 4)} ogni 1.000 byte. La scansione non usa l'AI. ${serveScansione ? "Il cambio vale dalla prossima scansione (sabato, oppure il pulsante in Selezione)." : "Il cambio vale dalla prossima sveglia."} Sono stime del client, non la fattura.</p></div>`;
    const conferma = `Confermi il cambio? Titoli da valutare: ${num(a.liquidi, 0)} → ${num(b.liquidi, 0)}. Consumo AI: ${deltaMese === null ? "non stimabile" : deltaCand === 0 ? "invariato" : `${segno(deltaMese, (v) => usd(v, 2))} al mese nel caso peggiore`}. Scansione: circa ${num(minuti(b.finnhub), 0)} minuti di richieste a Finnhub.`;
    return { html: corpo, conferma };
  } catch (e) {
    return { html: html`<div class="alarm">Impatto del cambio non stimabile ora: ${errText(e)}. Puoi comunque confermare.</div>`, conferma: "Impatto non stimabile ora. Confermi comunque il cambio?" };
  }
}
