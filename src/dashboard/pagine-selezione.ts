// Pagina "Selezione": come la scansione ha scelto i titoli su cui il bot può operare, e il dettaglio di ognuno
// (perché è stato scelto, criterio per criterio, segnali tecnici e grafico). Sola lettura: nessuna azione.
import * as fs from "node:fs";
import type { Ctx } from "../run/context.ts";
import { BENCHMARK, NOME_SETTORE, type Settore } from "../config/settori.ts";
import { CRITERI, NOME_PROFILO } from "../scan/profili.ts";
import type { Watchlist } from "../scan/scan.ts";
import type { VoceClassifica } from "../scan/classifica.ts";
import { loadParams, type Params } from "../params/params.ts";
import { leggiCandele, leggiSegnali } from "../signals/sessione.ts";
import { calcolaSegnali, parametriSegnali, type SegnaleTitolo } from "../signals/rules.ts";
import { donchianPrev, sma, volumeAvgPrev } from "../signals/indicators.ts";
import { expandBars } from "../data/bars.ts";
import type { Bar } from "../data/types.ts";
import { readJsonSafe } from "../util/atomic.ts";
import { addDays, dateInTz, formatDateIt, formatRome, TZ_NY } from "../util/time.ts";
import { errText } from "../util/redact.ts";
import { cls, html, isola, num, pagina, pct, raw, usd, type Safe } from "./html.ts";
import { graficoLinee, striscia } from "./svg.ts";
import { cached } from "./dati.ts";

type VoceGrigia = Watchlist["zonaGrigia"][number];
type Gruppo = "acquistabile" | "zona grigia" | "settore debole";

export const nomeSettore = (s: string | null | undefined): string => (s ? (NOME_SETTORE[s as Settore] ?? s) : "n/d");
const nomeProfilo = (p: string) => NOME_PROFILO[p as keyof typeof NOME_PROFILO] ?? p;
const UNITA = new Map(CRITERI.map((c) => [c.id, c.unita]));

function leggiWatchlist(ctx: Ctx): Watchlist | null {
  const r = readJsonSafe<Watchlist>(ctx.paths.watchlist);
  return r.ok ? r.value : null;
}

/** Ultima seduta con i segnali salvati (state/segnali/AAAA-MM-GG.json). */
function ultimaSeduta(ctx: Ctx): string | null {
  try {
    const f = fs.readdirSync(ctx.paths.segnali).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
    return f.length ? f.at(-1)!.slice(0, 10) : null;
  } catch {
    return null;
  }
}

interface Tecnica {
  segnale: SegnaleTitolo;
  bars: Bar[];
  fonte: string;
}

/** Segnali e candele: dalla seduta salvata se ci sono, altrimenti calcolati ora (candele chiuse, cache 15 minuti). */
async function datiTecnici(ctx: Ctx, P: Params, sym: string): Promise<Tecnica | { errore: string }> {
  const sed = ultimaSeduta(ctx);
  if (sed) {
    const s = leggiSegnali(ctx, sed);
    const c = leggiCandele(ctx, sed);
    const sg = s?.titoli[sym];
    if (s && sg && c.all[sym]?.length) return { segnale: sg, bars: expandBars(c.all[sym]!), fonte: `segnali della seduta del ${formatDateIt(sed)}, parametri ${s.paramsVersione}` };
  }
  try {
    return await cached(`selezione-${sym}-${P.versione}`, 15 * 60_000, async () => {
      const now = ctx.now();
      const oggi = dateInTz(now, TZ_NY);
      const raw = await ctx.data.getDailyBars([BENCHMARK, sym], { start: addDays(oggi, -540), end: new Date(now.getTime() - 16 * 60_000), adjustment: "all" });
      const chiuse = (b: Bar[] | undefined) => (b ?? []).filter((x) => x.t.slice(0, 10) < oggi);
      const bars = chiuse(raw[sym]);
      if (bars.length < 30) throw new Error(`solo ${bars.length} sedute disponibili`);
      return { segnale: calcolaSegnali(sym, bars, chiuse(raw[BENCHMARK]), parametriSegnali(P)), bars: bars.slice(-300), fonte: `calcolati ora sulle candele chiuse, parametri ${P.versione}` };
    });
  } catch (e) {
    return { errore: errText(e) };
  }
}

/** Stato tecnico in breve, per l'elenco. */
function statoBreve(sg: SegnaleTitolo | undefined, confermeMin: number): Safe {
  if (!sg) return html`<span class="badge">segnali non ancora calcolati</span>`;
  if (sg.ingresso) return html`<span class="badge b-good">segnale d'ingresso</span>`;
  const manca: string[] = [];
  if (!sg.candeleSufficienti) manca.push("storico corto");
  if (!sg.obbligatorie.trend) manca.push("trend");
  if (!sg.obbligatorie.adx) manca.push("ADX");
  if (!sg.obbligatorie.rs) manca.push("forza relativa");
  if (sg.nConferme < confermeMin) manca.push(`conferme ${sg.nConferme}/${confermeMin}`);
  return html`<span class="badge${sg.quasi ? " b-warn" : ""}">${sg.quasi ? "quasi: " : "manca: "}${manca.join(", ")}</span>`;
}

function rigaTitolo(v: { simbolo: string; nome: string; settore: string; profilo: string }, dettaglio: string, iniziale: string, sg: SegnaleTitolo | undefined, P: Params): Safe {
  return html`<a class="riga" href="/selezione/${encodeURIComponent(v.simbolo)}"><span class="iniziale">${iniziale}</span>
<span><span class="t">${v.simbolo}</span> <span class="muted">${v.nome}</span>
<span class="d" style="display:block">${dettaglio}</span></span>
<span class="n">${statoBreve(sg, P.n("segnali.confermeMin"))}${sg ? html`<span class="d" style="display:block">chiusura ${num(sg.chiusura, 2)} $ del ${formatDateIt(sg.data)}</span>` : ""}</span></a>`;
}

/** Classifica dei settori (rendimento in più di SPY), condivisa con la panoramica. */
export function classificaSettori(wl: Watchlist, periodo: number): Safe {
  const spyP = wl.forza.spy[periodo] ?? null;
  if (spyP === null) return raw(`<p class="muted small">Rendimento di SPY non disponibile.</p>`);
  const righe = wl.forza.settori.filter((x) => x.rendimenti[periodo] != null).map((x) => ({ s: x, ex: x.rendimenti[periodo]! - spyP })).sort((a, b) => b.ex - a.ex);
  const m = Math.max(...righe.map((r) => Math.abs(r.ex)), 1e-9);
  return html`<ol class="classifica">${righe.map((r) => html`<li${r.ex > 0 ? raw(' class="forte"') : ""}><span class="nome">${nomeSettore(r.s.settore)}<span class="muted"> ${r.s.etf}</span></span>
<span class="traccia"><span class="riempi" style="${r.ex >= 0 ? `left:50%;width:${((r.ex / m) * 50).toFixed(1)}%` : `right:50%;width:${((-r.ex / m) * 50).toFixed(1)}%`}"></span></span>
<span class="v ${cls(r.ex)}">${pct(r.ex, 1)}</span><span class="stato">${r.ex > 0 ? "si compra" : "non si compra"}</span></li>`)}</ol>
<p class="small muted">${wl.forza.forti.length} settori su ${righe.length} battono SPY (${pct(spyP, 1)} su ${periodo} sedute): solo lì si compra</p>`;
}

export function paginaSelezione(ctx: Ctx, csrf: string): string {
  const P = loadParams(ctx.paths, ctx.now()).params;
  const wl = leggiWatchlist(ctx);
  if (!wl) return pagina("Selezione", "/selezione", html`<h1>Selezione dei titoli</h1><div class="note">Nessuna scansione ancora: la prima parte il sabato alle ${P.s("orari.scansione")}, oppure lanciala con <code>start scan</code>.</div>`, { csrf });
  const sed = ultimaSeduta(ctx);
  const seg = sed ? leggiSegnali(ctx, sed) : null;
  const periodo = wl.forza.periodo;
  const k = wl.conteggi;
  const passati = k.profili.growth + k.profili.value + k.profili.dividendo;
  const conIngresso = wl.acquistabili.filter((v) => seg?.titoli[v.simbolo]?.ingresso).length;
  const imbuto: [string, number, string][] = [
    ["Azioni USA negoziabili", k.universo, "tutte quelle che Alpaca permette di comprare"],
    ["Liquide e sopra il prezzo minimo", k.prefiltro, `prezzo ≥ ${num(P.n("universo.prezzoMin"), 0)} $ e scambi medi a 20 sedute ≥ ${usd(P.n("universo.controvaloreMin"), 0)} al giorno`],
    ["Con i dati di bilancio", k.valutati, `profilo e metriche Finnhub disponibili (${k.esclusi.senzaProfilo} senza profilo, ${k.esclusi.industriaNonMappata} con industria non riconosciuta)`],
    ["Superano almeno un profilo", passati, `Growth ${k.profili.growth}, Value ${k.profili.value}, Dividendo ${k.profili.dividendo} (un titolo può superarne più di uno)`],
    ["Acquistabili", wl.acquistabili.length, `i migliori ${P.n("settori.migliori")} per ogni settore forte, al massimo ${P.n("settori.maxAcquistabili")}`],
  ];
  const max = Math.max(k.universo, 1);
  const voceA = (v: VoceClassifica) => `${nomeSettore(v.settore)} · ${nomeProfilo(v.profilo)} · punteggio ${num(v.punteggio, 1)} · ${v.posizioneSettore}° nel settore${v.capitalizzazione ? ` · ${num(v.capitalizzazione / 1000, 1)} mld $` : ""}`;
  const voceG = (v: VoceGrigia) => `${nomeSettore(v.settore)} · ${nomeProfilo(v.profilo)} · mancato di poco: ${v.criterioMancato.nome} ${num(v.criterioMancato.valore, 2)} (soglia ${v.criterioMancato.soglia})`;
  const corpo = html`<h1>Selezione dei titoli</h1>
<p class="introduzione">Ogni sabato la scansione parte da tutte le azioni USA e tiene solo quelle con bilanci solidi, nei settori che stanno battendo il mercato. Sono gli <b>acquistabili</b>: il bot compra solo tra questi, e solo quando il grafico dà il segnale d'ingresso. Clicca un titolo per vedere perché è stato scelto e il suo grafico.</p>
<div class="tally">
<div><div class="k">Scansione</div><div class="v">${formatDateIt(wl.data)}</div><div class="s">generata ${formatRome(wl.generata)}</div></div>
<div><div class="k">Acquistabili</div><div class="v">${wl.acquistabili.length}</div><div class="s">su ${num(k.universo, 0)} azioni</div></div>
<div><div class="k">Settori forti</div><div class="v">${wl.forza.forti.length} di ${wl.forza.settori.length}</div><div class="s">battono SPY su ${periodo} sedute</div></div>
<div><div class="k">Con segnale oggi</div><div class="v">${seg ? conIngresso : "n/d"}</div><div class="s">${seg ? `candela del ${formatDateIt(seg.ultimaCandela ?? sed!)}` : "segnali non ancora calcolati"}</div></div></div>
${wl.avvisi.map((a) => html`<div class="note">${a}</div>`)}
<div class="due" style="margin-top:16px">
<div class="card"><h3>Il mercato: settori contro SPY su ${periodo} sedute</h3>${classificaSettori(wl, periodo)}
<p class="small muted">Un settore è <b>forte</b> se il suo ETF ha reso più di SPY nelle ultime ${periodo} sedute (dati al ${formatDateIt(wl.forza.data ?? wl.data)}). SPY: ${pct(wl.forza.spy[21] ?? null, 1)} a 1 mese, ${pct(wl.forza.spy[63] ?? null, 1)} a 3 mesi, ${pct(wl.forza.spy[126] ?? null, 1)} a 6 mesi.</p></div>
<div class="card"><h3>Dall'universo agli acquistabili</h3><ol class="classifica">${imbuto.map(([n, v, d]) => html`<li class="forte"><span class="nome">${n}<span class="muted small" style="display:block">${d}</span></span>
<span class="traccia"><span class="riempi" style="left:0;width:${Math.max(1, (Math.log10(v + 1) / Math.log10(max + 1)) * 100).toFixed(1)}%"></span></span><span class="v">${num(v, 0)}</span><span class="stato"></span></li>`)}</ol>
<p class="small muted">Barre in scala logaritmica. Un profilo si supera solo se tutti i criteri valutabili passano e se ne possono valutare almeno il ${num(P.n("fond.copertura") * 100, 0)}%.</p></div></div>
<h2>Acquistabili (${wl.acquistabili.length})</h2>
${wl.acquistabili.length ? html`<div class="lista">${wl.acquistabili.map((v) => rigaTitolo(v, voceA(v), String(v.posizioneGenerale ?? ""), seg?.titoli[v.simbolo], P))}</div>` : html`<div class="note">Nessun titolo acquistabile in questa scansione.</div>`}
${wl.zonaGrigia.length ? html`<details class="card" style="margin-top:16px"><summary><b>Zona grigia (${wl.zonaGrigia.length})</b> <span class="muted small">hanno mancato un solo criterio, di poco: non si comprano, ma il bot li segue come operazioni ombra</span></summary>
<div class="lista" style="margin-top:12px">${wl.zonaGrigia.map((v) => rigaTitolo(v, voceG(v), "~", seg?.titoli[v.simbolo], P))}</div></details>` : ""}
${wl.settoriDeboli.length ? html`<details class="card" style="margin-top:16px"><summary><b>Buoni ma in settori deboli (${wl.settoriDeboli.length})</b> <span class="muted small">superano i bilanci ma il loro settore non batte SPY</span></summary>
<div class="lista" style="margin-top:12px">${wl.settoriDeboli.map((v) => rigaTitolo(v, voceA(v), "·", seg?.titoli[v.simbolo], P))}</div></details>` : ""}`;
  return pagina("Selezione", "/selezione", corpo, { csrf });
}

function trova(wl: Watchlist, sym: string): { gruppo: Gruppo; voce: VoceClassifica | VoceGrigia } | null {
  const a = wl.acquistabili.find((v) => v.simbolo === sym);
  if (a) return { gruppo: "acquistabile", voce: a };
  const d = wl.settoriDeboli.find((v) => v.simbolo === sym);
  if (d) return { gruppo: "settore debole", voce: d };
  const g = wl.zonaGrigia.find((v) => v.simbolo === sym);
  return g ? { gruppo: "zona grigia", voce: g } : null;
}

const si = (ok: boolean) => (ok ? html`<span class="badge b-good">sì</span>` : html`<span class="badge b-warn">no</span>`);
const esitoBadge = (e: string) => html`<span class="badge${e === "superato" ? " b-good" : e === "non superato" ? " b-warn" : ""}">${e}</span>`;

export async function paginaSelezioneDettaglio(ctx: Ctx, csrf: string, sym: string): Promise<string> {
  const P = loadParams(ctx.paths, ctx.now()).params;
  const wl = leggiWatchlist(ctx);
  const t = wl ? trova(wl, sym) : null;
  if (!wl || !t) return pagina(sym, "/selezione", html`<h1>${sym}</h1><div class="note">Il titolo non è nella selezione dell'ultima scansione.</div><p><a href="/selezione">← Torna alla selezione</a></p>`, { csrf });
  const v = t.voce;
  const periodo = wl.forza.periodo;
  const fs_ = wl.forza.settori.find((x) => x.settore === v.settore);
  const rSett = fs_?.rendimenti[periodo] ?? null;
  const rSpy = wl.forza.spy[periodo] ?? null;
  const voceCl = "punteggio" in v ? (v as VoceClassifica) : null;
  const tec = await datiTecnici(ctx, P, sym);
  const ps = parametriSegnali(P);

  // passi della selezione
  const criteri = v.criteri;
  const applicabili = criteri.filter((c) => c.esito !== "non applicabile").length;
  const valutabili = criteri.filter((c) => c.esito === "superato" || c.esito === "non superato").length;
  const passi = html`<ol class="passi">
<li><b>Universo.</b> Azione USA negoziabile su Alpaca, prezzo ≥ ${num(P.n("universo.prezzoMin"), 0)} $ e scambi medi a 20 sedute ≥ ${usd(P.n("universo.controvaloreMin"), 0)} al giorno: superato (è tra i ${num(wl.conteggi.prefiltro, 0)} titoli rimasti su ${num(wl.conteggi.universo, 0)}).</li>
<li><b>Settore: ${nomeSettore(v.settore)}${fs_ ? ` (ETF ${fs_.etf})` : ""}.</b> ${rSett !== null && rSpy !== null ? html`In ${periodo} sedute l'ETF ha reso <span class="${cls(rSett)}">${pct(rSett, 1)}</span> contro <span class="${cls(rSpy)}">${pct(rSpy, 1)}</span> di SPY: ${fs_?.forte ? html`<b>settore forte</b>, si può comprare.` : html`<b>settore debole</b>, qui non si compra.`}` : "Rendimento del settore non disponibile."}</li>
<li><b>Bilanci: profilo ${nomeProfilo(v.profilo)}.</b> ${t.gruppo === "zona grigia" ? html`Non superato per un solo criterio: <b>${(v as VoceGrigia).criterioMancato.nome}</b> ${num((v as VoceGrigia).criterioMancato.valore, 2)} contro la soglia ${(v as VoceGrigia).criterioMancato.soglia}.` : html`Superato: tutti i ${valutabili} criteri valutabili passano la soglia (ne servono almeno ${Math.ceil(P.n("fond.copertura") * applicabili - 1e-9)} valutabili su ${applicabili} applicabili).`} I criteri «non disponibili» mancano nei dati gratuiti di Finnhub e non contano.</li>
<li><b>Classifica.</b> ${voceCl ? html`Per ogni criterio si calcola il percentile rispetto agli altri titoli dello stesso settore e profilo (100 = il migliore). Il punteggio è la media: <b>${num(voceCl.punteggio, 1)}</b>, ${voceCl.posizioneSettore}° nel settore. ${t.gruppo === "acquistabile" ? html`Si tengono i primi ${P.n("settori.migliori")} di ogni settore forte: <b>acquistabile</b>, ${voceCl.posizioneGenerale}° in classifica generale.` : html`Il settore non è forte, quindi resta fuori dagli acquistabili.`}` : "Non entra in classifica: è in zona grigia."}</li>
<li><b>Ingresso.</b> Anche da acquistabile si compra solo con il segnale tecnico qui sotto, e solo se la gabbia lo permette (posti liberi, settore, trimestrale lontana, prezzo non scappato).</li></ol>`;

  const tabCriteri = html`<div class="scroll"><table><tr><th>Criterio</th><th class="n">Valore</th><th>Soglia</th><th>Esito</th><th class="n">Percentile</th><th>Nota</th></tr>
${criteri.map((c) => {
    const u = UNITA.get(c.id) ?? "";
    const perc = voceCl?.percentili[c.id];
    return html`<tr><td>${c.nome}${c.campo ? html`<div class="small muted">${c.campo}</div>` : ""}</td><td class="n">${c.valore === null ? "n/d" : `${num(c.valore, 2)}${u && u !== "x" ? ` ${u}` : ""}`}</td><td>${c.soglia}</td><td>${esitoBadge(c.esito)}</td><td class="n">${perc === undefined ? "—" : num(perc, 0)}</td><td class="small muted">${c.nota ?? ""}</td></tr>`;
  })}</table></div>`;

  let tecnica: Safe;
  let grafico: Safe = raw("");
  if ("errore" in tec) tecnica = html`<div class="note">Segnali tecnici non disponibili: ${tec.errore}</div>`;
  else {
    const sg = tec.segnale;
    const b = tec.bars;
    const conf = sg.conferme;
    const righe: [string, boolean, string][] = [
      ["Trend crescente", sg.obbligatorie.trend, `chiusura ${num(sg.chiusura, 2)} > SMA${ps.smaMedia} ${num(sg.sma50, 2)} > SMA${ps.smaLunga} ${num(sg.sma200, 2)}`],
      ["Trend forte e rialzista", sg.obbligatorie.adx, `ADX ${num(sg.adx, 1)} (minimo ${ps.adxMin}), +DI ${num(sg.pdi, 1)} contro −DI ${num(sg.mdi, 1)}`],
      ["Più forte di SPY", sg.obbligatorie.rs, `linea di forza relativa ${num(sg.rs, 4)} contro la sua media a ${ps.rsMediaPeriodo} sedute ${num(sg.rsMedia, 4)}`],
      ["Conferma: massimo a " + ps.donchianPeriodo + " sedute rotto", conf.donchian, `chiusura ${num(sg.chiusura, 2)} contro il massimo precedente ${num(sg.donchianAlto, 2)}`],
      ["Conferma: volume alto", conf.volume, `volume ${num(sg.rapportoVolume, 2)} volte la media (serve ${num(ps.volumeMult, 2)})`],
      ["Conferma: resistenza superata", conf.resistenza, sg.resistenza ? `rotta la resistenza a ${num(sg.resistenza, 2)}` : `nessuna resistenza rotta di almeno lo ${num(ps.rotturaMin, 1)}%`],
      ["Conferma: candela verde lunga", conf.candela, `corpo ${num(sg.chiusura - sg.apertura, 2)} contro ${num(ps.candelaCorpoAtr, 1)} × ATR ${num(sg.atr, 2)}, chiusura nel quarto alto`],
    ];
    tecnica = html`<p>${sg.ingresso ? html`<span class="badge b-good">segnale d'ingresso</span> Tutte le condizioni sono soddisfatte: alla prossima sveglia di acquisto è un candidato, se la gabbia lo permette.` : html`<span class="badge${sg.quasi ? " b-warn" : ""}">${sg.quasi ? "quasi" : "nessun segnale"}</span> Servono trend, forza e direzione, più almeno ${ps.confermeMin} conferm${ps.confermeMin === 1 ? "a" : "e"} su 4. Ne ha ${sg.nConferme}.`} <span class="muted small">Candela del ${formatDateIt(sg.data)} · ${tec.fonte}.</span></p>
<div class="scroll"><table><tr><th>Condizione</th><th>Soddisfatta</th><th>Valori</th></tr>${righe.map(([n, ok, d]) => html`<tr><td>${n}</td><td>${si(ok)}</td><td class="small">${d}</td></tr>`)}</table></div>
${sg.usciteDeboli.length || sg.uscitaForte ? html`<p class="small muted">Segnali di uscita (contano solo se è in portafoglio): ${[...(sg.uscitaForte ? ["uscita forte (minimo a 20 sedute rotto con volume)"] : []), ...sg.usciteDeboli].join("; ")}.</p>` : ""}`;

    // grafico: ultime ~6 mesi, variazione rispetto all'ultima chiusura (lo zero è il prezzo di oggi)
    const closes = b.map((x) => x.c);
    const s50 = sma(closes, ps.smaMedia), s200 = sma(closes, ps.smaLunga);
    const ok = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);
    // finestra di ~6 mesi, ma non prima che la SMA lunga esista (le candele salvate sono 300)
    const primaS200 = s200.findIndex((x) => ok(x));
    const da = Math.max(0, b.length - 125, primaS200 >= 0 && primaS200 < b.length - 20 ? primaS200 : 0);
    const ultimo = b.at(-1)!.c;
    const rel = (x: number) => x / ultimo - 1;
    const punti = b.slice(da).map((x, j) => {
      const i = da + j;
      const don = donchianPrev(b, i, ps.donchianPeriodo);
      return { data: x.t.slice(0, 10), prezzo: rel(x.c), ...(ok(s50[i]) ? { sma50: rel(s50[i]!) } : {}), ...(ok(s200[i]) ? { sma200: rel(s200[i]!) } : {}), ...(don ? { massimo: rel(don.alto) } : {}) };
    });
    const serie = [
      { chiave: "prezzo", nome: sym, colore: "var(--chart-1)" },
      { chiave: "sma50", nome: `SMA${ps.smaMedia}`, colore: "var(--chart-4)" },
      { chiave: "sma200", nome: `SMA${ps.smaLunga}`, colore: "var(--chart-5)" },
      { chiave: "massimo", nome: `massimo ${ps.donchianPeriodo} sedute`, colore: "var(--chart-2)", tratteggiata: true },
    ].filter((s) => punti.every((p) => s.chiave in p));
    const riservaPrezzo = graficoLinee([
      { nome: sym, colore: "var(--s1)", punti: b.slice(da).map((x) => ({ x: x.t.slice(0, 10), y: x.c })) },
      { nome: `SMA${ps.smaMedia}`, colore: "var(--s3)", punti: b.slice(da).map((x, j) => ({ x: x.t.slice(0, 10), y: ok(s50[da + j]) ? s50[da + j]! : null })) },
      { nome: `SMA${ps.smaLunga}`, colore: "var(--s5)", punti: b.slice(da).map((x, j) => ({ x: x.t.slice(0, 10), y: ok(s200[da + j]) ? s200[da + j]! : null })) },
    ], { titolo: `Prezzo di ${sym}`, fmt: (y) => num(y, 2), altezza: 260 });
    const vol = b.slice(-60).map((x, j) => {
      const i = b.length - 60 + j;
      const m = volumeAvgPrev(b, i, ps.volumeMediaPeriodo);
      return { data: x.t.slice(0, 10), valore: m && m > 0 ? x.v / m - 1 : null };
    }).filter((x) => x.valore !== null);
    const riservaVol = striscia(vol, { titolo: "Volume rispetto alla media", fmt: (y) => pct(y, 0), larghezza: 520 });
    grafico = html`<div class="card principale" style="margin-top:16px"><h3>Prezzo, medie mobili e massimo a ${ps.donchianPeriodo} sedute</h3>
<p class="small muted">Variazione rispetto all'ultima chiusura (${num(ultimo, 2)} $ del ${formatDateIt(b.at(-1)!.t.slice(0, 10))}): lo zero è il prezzo di oggi. Il trend è crescente quando il prezzo sta sopra la SMA${ps.smaMedia} e questa sopra la SMA${ps.smaLunga}; la rottura avviene quando il prezzo supera la linea tratteggiata.</p>
${punti.length >= 2 ? isola("linee", { serie, punti, formato: "pct", rapporto: "16 / 6" }, riservaPrezzo) : riservaPrezzo}
<ul class="legenda-linee">${serie.map((s) => html`<li><i class="${"tratteggiata" in s ? "tratto" : ""}" style="--c:${s.colore}"></i>${s.nome}</li>`)}</ul></div>
<div class="card" style="margin-top:16px"><h3>Volume delle ultime 60 sedute rispetto alla media a ${ps.volumeMediaPeriodo}</h3>
<p class="small muted">Sopra lo zero gli scambi sono più alti del solito. La conferma di volume chiede almeno +${num((ps.volumeMult - 1) * 100, 0)}%.</p>
${vol.length >= 2 ? isola("barre", { righe: vol.map((x) => ({ etichetta: x.data.slice(8, 10) + "/" + x.data.slice(5, 7), valore: x.valore, nota: formatDateIt(x.data) })), formato: "pct", rapporto: "16 / 5" }, riservaVol) : riservaVol}</div>`;
  }

  const stato = t.gruppo === "acquistabile" ? html`<span class="badge b-good">acquistabile, ${(v as VoceClassifica).posizioneGenerale}° in classifica</span>` : t.gruppo === "zona grigia" ? html`<span class="badge b-warn">zona grigia</span>` : html`<span class="badge">settore debole</span>`;
  const corpo = html`<p><a href="/selezione">← Selezione</a></p>
<h1>${sym} <span class="muted" style="font-size:0.6em">${v.nome}</span></h1>
<p>${stato} <span class="muted">${nomeSettore(v.settore)} · ${v.industria} · profilo ${nomeProfilo(v.profilo)} · scansione del ${formatDateIt(wl.data)}</span></p>
<div class="tally">
<div><div class="k">Punteggio</div><div class="v">${voceCl ? num(voceCl.punteggio, 1) : "—"}</div><div class="s">media dei percentili</div></div>
<div><div class="k">Nel settore</div><div class="v">${voceCl ? `${voceCl.posizioneSettore}°` : "—"}</div><div class="s">${nomeSettore(v.settore)}</div></div>
<div><div class="k">Settore contro SPY</div><div class="v ${cls(rSett !== null && rSpy !== null ? rSett - rSpy : null)}">${rSett !== null && rSpy !== null ? pct(rSett - rSpy, 1) : "n/d"}</div><div class="s">su ${periodo} sedute</div></div>
<div><div class="k">Capitalizzazione</div><div class="v">${voceCl?.capitalizzazione ? `${num(voceCl.capitalizzazione / 1000, 1)} mld $` : "n/d"}</div><div class="s">${voceCl ? `prezzo alla scansione ${num(voceCl.prezzo, 2)} $` : ""}</div></div></div>
${grafico}
<h2>Perché è stato scelto</h2><div class="card">${passi}</div>
<h2>I criteri di bilancio, uno per uno</h2><div class="card">${tabCriteri}<p class="small muted">Valori Finnhub: le percentuali sono in punti (15 = 15%). Il percentile confronta il titolo con gli altri dello stesso settore e profilo che superano il criterio.</p></div>
<h2>Segnali tecnici</h2><div class="card">${tecnica}</div>`;
  return pagina(sym, "/selezione", corpo, { csrf });
}
