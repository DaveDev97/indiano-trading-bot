// Pagine: accesso, panoramica, dettaglio posizione, storico, operazioni ombra.
import type { Ctx } from "../run/context.ts";
import { NOME_SVEGLIA } from "../run/calendario.ts";
import { livelloStop } from "../run/piani.ts";
import { schedeOmbra, schedeReali, type Scheda } from "../journal/schede.ts";
import { readJournal } from "../journal/journal.ts";
import { expandBars } from "../data/bars.ts";
import { statistiche, type Risultato } from "../learning/statistiche.ts";
import { addDays, dateInTz, formatRome, TZ_NY, TZ_ROME } from "../util/time.ts";
import { cls, html, isola, num, pagina, pct, quota, raw, usd, type Safe } from "./html.ts";
import { barreOrizzontali, composizione, graficoLinee, striscia } from "./svg.ts";
import { conto, rendimentoDa, statoBot, storia } from "./dati.ts";
import { estremi } from "./consumi.ts";
import { nuovoCodice } from "./azioni.ts";
import { errText } from "../util/redact.ts";
import { classificaSettori as classificaSettoriHtml, nomeSettore } from "./pagine-selezione.ts";

export function paginaLogin(errore?: string): string {
  return pagina("Accesso", "", html`<h1>Accesso</h1>
<form method="post" action="/accedi" class="card" style="max-width:360px">
<label>Password<br><input type="password" name="password" autocomplete="current-password" autofocus required></label><br><br>
<button class="primary">Entra</button>${errore ? html`<p class="down">${errore}</p>` : ""}</form>
<p class="muted small">La dashboard è raggiungibile solo da questo computer (127.0.0.1).</p>`);
}

function messaggio(m?: { ok: boolean; testo: string } | null): Safe {
  return m ? html`<div class="${m.ok ? "note" : "alarm"}">${m.testo}</div>` : raw("");
}

export async function paginaPanoramica(ctx: Ctx, csrf: string, q: URLSearchParams, flash?: { ok: boolean; testo: string } | null): Promise<string> {
  const st = await statoBot(ctx);
  let corpo: Safe;
  try {
    const c = await conto(ctx);
    const h = await storia(ctx);
    const eq = c.account.equity;
    const oggiNy = dateInTz(ctx.now(), TZ_NY);
    // "nello stesso periodo": ogni periodo parte dal più recente tra il suo inizio e l'avvio del bot
    const daAvvio = (d: string) => (d > h.avvio ? d : h.avvio);
    const sett = daAvvio(estremi("settimana", ctx.now()).da);
    const mese = daAvvio(oggiNy.slice(0, 8) + "01");
    const botOggi = c.account.lastEquity ? eq / c.account.lastEquity - 1 : null;
    const per = [
      { n: "Oggi", bot: botOggi, usdV: c.account.lastEquity ? eq - c.account.lastEquity : null, spy: c.spyOggi },
      { n: "Settimana", bot: rendimentoDa(h.patrimonio, sett, eq), spy: rendimentoDa(h.spy, sett) },
      { n: "Mese", bot: rendimentoDa(h.patrimonio, mese, eq), spy: rendimentoDa(h.spy, mese) },
      { n: `Dall'inizio (${h.avvio})`, bot: rendimentoDa(h.patrimonio, h.avvio, eq), spy: rendimentoDa(h.spy, h.avvio) },
    ].map((x: any) => ({ ...x, usdV: x.usdV ?? (x.bot !== null ? eq - eq / (1 + x.bot) : null) }));
    const prezzo = (s: string, fallback: number) => c.prezzi[s] ?? fallback;
    const investito = c.posizioni.reduce((a, p) => a + prezzo(p.symbol, p.currentPrice ?? p.avgEntryPrice) * p.qty, 0);
    const maxPos = st.P.n("rischio.maxPosizioni");
    const occupati = new Set([...c.posizioni.map((p) => p.symbol), ...c.aperti.filter((o) => o.side === "buy" && !o.parentId).map((o) => o.symbol)]).size;

    // 1. patrimonio e SPY, entrambi a base 100 (un solo asse); SPY solo da dove ci sono dati del bot
    const g = q.get("grafico") ?? "1m";
    const inizio = g === "1s" ? addDays(oggiNy, -7) : g === "3m" ? addDays(oggiNy, -92) : g === "tutto" ? "2000-01-01" : addDays(oggiNy, -31);
    const pe = h.patrimonio.filter((x) => x.data >= inizio);
    const ps = pe.length ? h.spy.filter((x) => x.data >= pe[0]!.data) : [];
    const ix = (s: { data: string; v: number }[]) => s.map((x) => ({ x: x.data, y: s[0] ? (100 * x.v) / s[0].v : null }));
    const perData = new Map<string, Record<string, number | string | null>>();
    for (const x of ix(pe)) perData.set(x.x, { data: x.x, bot: x.y === null ? null : x.y / 100 - 1, spy: null });
    for (const x of ix(ps)) if (perData.has(x.x)) perData.get(x.x)!.spy = x.y === null ? null : x.y / 100 - 1;
    const graficoEqSvg = graficoLinee([{ nome: "Bot", colore: "var(--s1)", punti: ix(pe) }, { nome: "SPY", colore: "var(--s2)", punti: ix(ps) }], { titolo: "Patrimonio e SPY (base 100)", fmt: (v) => num(v, 1), larghezza: 520 });

    const graficoEq = pe.length >= 2 ? isola("linee", { serie: [{ chiave: "bot", nome: "Bot", colore: "var(--chart-1)" }, { chiave: "spy", nome: "SPY", colore: "var(--chart-5)" }], punti: [...perData.values()], formato: "pct", rapporto: "16 / 5.5" }, graficoEqSvg) : graficoEqSvg;

    // 2. dove sono i soldi: cash e ogni posizione (parti di un intero)
    const ramp = ["var(--r1)", "var(--r2)", "var(--r3)", "var(--r4)", "var(--r5)", "var(--r6)"];
    const parti = [
      ...c.posizioni.map((p, i) => ({ nome: p.symbol, valore: prezzo(p.symbol, p.currentPrice ?? p.avgEntryPrice) * p.qty, colore: ramp[i % ramp.length]! })),
      { nome: "Cash", valore: Math.max(0, c.account.cash), colore: "var(--color-muted)" },
    ];
    const totSoldi = parti.reduce((a, p) => a + p.valore, 0);
    const legendaSoldi = html`<ul class="legenda-lista">${parti.filter((p) => p.valore > 0).map((p) => html`<li><span class="pallino" style="background:${p.colore}"></span><span>${p.nome}</span><span class="n">${usd(p.valore, 0)}</span><span class="n muted">${quota(totSoldi > 0 ? p.valore / totSoldi : null)}</span></li>`)}</ul>`;
    const graficoSoldi = isola("torta", { fette: parti.map((p) => ({ nome: p.nome, valore: p.valore, colore: p.colore })), centro: "Patrimonio" }, composizione(parti, { titolo: "Dove sono i soldi", fmt: (v) => usd(v, 0), larghezza: 520 }));

    // 4. risultato di ogni seduta ($), ultime 40
    const giorni = h.patrimonio.slice(-41).map((x, i, a) => ({ data: x.data, valore: i === 0 ? null : x.v - a[i - 1]!.v })).slice(1);
    const graficoGiorni = isola("barre", { righe: giorni.filter((x) => x.valore !== null).map((x) => ({ etichetta: x.data.slice(8, 10) + "/" + x.data.slice(5, 7), valore: x.valore, nota: x.data })), formato: "usd0", rapporto: "16 / 6" }, striscia(giorni, { titolo: "Risultato di ogni seduta", fmt: (v) => usd(v, 0), larghezza: 520 }));

    // 4. settori: classifica con barre sottili (rendimento in più di SPY), diversa per tipo dal grafico principale
    const wl = st.watchlist;
    const periodo = wl?.forza.periodo ?? st.P.n("settori.periodoForza");
    let classificaSettori: Safe = raw(`<p class="muted small">Watchlist assente: lancia la scansione.</p>`);
    if (wl) {
      classificaSettori = html`${classificaSettoriHtml(wl, periodo)}<p class="small"><a href="/selezione">Come sono stati scelti i titoli →</a></p>`;
    }

    const schede = schedeReali(ctx.paths);
    const righe = c.posizioni.map((p) => {
      const pr = prezzo(p.symbol, p.currentPrice ?? p.avgEntryPrice);
      const pl = st.piani[p.symbol];
      const sc = schede.filter((s) => s.ingresso.simbolo === p.symbol && !s.uscita).at(-1);
      const stop = pl ? livelloStop(pl) : null;
      const tp = pl?.takeProfit ?? null;
      const lo = stop ?? pr * 0.9, hi = tp ?? Math.max(pl?.massimo ?? pr, pr) * 1.05;
      const posi = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100));
      const giorniPos = pl ? Math.floor((ctx.now().getTime() - Date.parse(pl.creato)) / 86_400_000) : null;
      const np = st.allarmi?.nonProtette.includes(p.symbol);
      return html`<a class="riga${np ? " aperta" : ""}" href="/posizione/${encodeURIComponent(p.symbol)}">
<span class="iniziale">${p.symbol.slice(0, 2)}</span>
<span><span class="t">${p.symbol}</span> <span class="d">${sc?.ingresso.nome ?? ""}</span>
<span class="d" style="display:block">${nomeSettore(sc?.ingresso.settore)}, ${giorniPos ?? "n/d"} giorni, ${pl?.modalita === "trailing" ? `stop mobile ${pl.trailingPct ?? ""}%` : "stop e take profit"}${np ? ", NON PROTETTA" : ""}</span>
<span class="bar" data-tip="${`stop ${num(stop)} (${pct(stop ? stop / pr - 1 : null, 1)})\nprezzo ${num(pr)}\n${tp ? `take profit ${num(tp)} (${pct(tp / pr - 1, 1)})` : "nessun take profit"}`}"><b style="left:${posi(p.avgEntryPrice).toFixed(1)}%;width:${Math.max(0, posi(pr) - posi(p.avgEntryPrice)).toFixed(1)}%"></b><i style="left:${posi(pr).toFixed(1)}%"></i></span>
<span class="d">stop ${num(stop)}${tp ? `, take profit ${num(tp)}` : ""}</span></span>
<span class="n"><span class="v ${cls(pr - p.avgEntryPrice)}">${pct(pr / p.avgEntryPrice - 1)}</span><span class="d" style="display:block">${usd((pr - p.avgEntryPrice) * p.qty, 0)}</span></span></a>`;
    });
    const filtri = html`<div class="filters">${[["1s", "1 settimana"], ["1m", "1 mese"], ["3m", "3 mesi"], ["tutto", "Tutto"]].map(([k, n]) => html`<a class="btn" href="/?grafico=${k}" ${k === g ? raw('aria-current="true"') : ""}>${n}</a>`)}</div>`;
    corpo = html`<h1>Panoramica</h1>${messaggio(flash)}
${(st.allarmi?.allarmi ?? []).map((a) => html`<div class="alarm">${a}</div>`)}
<div class="tally">
<div><div class="k">Patrimonio</div><div class="v" data-numero="${Math.round(eq)}" data-formato="usd0">${usd(eq, 0)}</div><div class="s">oggi <span class="${cls(botOggi)}">${pct(botOggi)}</span>, SPY ${pct(c.spyOggi)}</div></div>
<div><div class="k">Investito</div><div class="v" data-numero="${Math.round(investito)}" data-formato="usd0">${usd(investito, 0)}</div><div class="s">${quota(eq > 0 ? investito / eq : null)} del patrimonio</div></div>
<div><div class="k">Cash</div><div class="v" data-numero="${Math.round(c.account.cash)}" data-formato="usd0">${usd(c.account.cash, 0)}</div><div class="s">solo cash, mai margine</div></div>
<div><div class="k">Posti liberi</div><div class="v">${Math.max(0, maxPos - occupati)} di ${maxPos}</div><div class="s">${c.mercatoAperto ? "mercato aperto" : "mercato chiuso"}</div></div></div>
<div class="card principale" style="margin-top:16px"><div class="testa"><h3>Rendimento del bot e di SPY nel periodo</h3>${filtri}</div>${graficoEq}</div>
<div class="ritmo"><div class="card"><h3>Risultato di ogni seduta</h3>${graficoGiorni}</div>
<div class="card"><h3>Dove sono i soldi</h3>${graficoSoldi}${legendaSoldi}</div></div>
<div class="card"><h3>Settori: rendimento in più di SPY${wl ? ` su ${periodo} sedute` : ""}</h3>${classificaSettori}</div>
<h2>Risultati a confronto con SPY</h2><div class="card scroll"><table><tr><th>Periodo</th><th class="n">Bot</th><th class="n">Bot $</th><th class="n">SPY</th><th class="n">Differenza</th></tr>
${per.map((x) => html`<tr><td>${x.n}</td><td class="n ${cls(x.bot)}">${pct(x.bot)}</td><td class="n ${cls(x.usdV)}">${usd(x.usdV, 0)}</td><td class="n">${pct(x.spy)}</td><td class="n ${cls(x.bot !== null && x.spy !== null ? x.bot - x.spy : null)}">${x.bot !== null && x.spy !== null ? pct(x.bot - x.spy) : "n/d"}</td></tr>`)}</table></div>
<h2>Posizioni (${c.posizioni.length})</h2>${c.posizioni.length ? html`<div class="lista">${righe}</div>` : html`<div class="note">Nessuna posizione aperta. Il bot compra alla sveglia di apertura, solo titoli che superano tutti i controlli.</div>`}
${statoHtml(st, c.mercatoAperto)}`;
  } catch (e) {
    corpo = html`<h1>Panoramica</h1>${messaggio(flash)}<div class="alarm">Broker non raggiungibile: ${errText(e)}</div>${statoHtml(st, null)}`;
  }
  return pagina("Panoramica", "/", corpo, { csrf });
}

function statoHtml(st: Awaited<ReturnType<typeof statoBot>>, aperto: boolean | null): Safe {
  return html`<h2>Stato del bot</h2><div class="card scroll"><table>
<tr><td>Mercato</td><td>${aperto === null ? "n/d" : aperto ? "aperto" : "chiuso"}</td></tr>
<tr><td>Ultima sveglia</td><td>${st.ultima ? `${NOME_SVEGLIA[st.ultima.tipo as keyof typeof NOME_SVEGLIA] ?? st.ultima.tipo}, run ${st.ultima.id}, eseguita ${formatRome(st.ultima.eseguitaIl)}` : "nessuna"}</td></tr>
<tr><td>Prossima sveglia</td><td>${st.prossima ? `${NOME_SVEGLIA[st.prossima.tipo]}, ${formatRome(st.prossima.at)}` : st.erroreCalendario ? `n/d (${st.erroreCalendario})` : "n/d"}</td></tr>
<tr><td>Allarmi aperti</td><td>${st.allarmi?.allarmi.length ? html`<span class="badge b-crit">${st.allarmi.allarmi.length}</span> dall'ultima sveglia (${st.allarmi.runId})` : "nessuno"}</td></tr>
<tr><td>Freno d'emergenza</td><td>${st.freno.attivo ? html`<span class="badge b-crit">attivo</span> dal ${formatRome(st.freno.scattatoIl ?? "")}` : "non attivo"}, soglia ${quota(st.P.n("rischio.freno"))} del massimo</td></tr>
<tr><td>Pausa acquisti</td><td>${st.pausaAcquisti ? html`<span class="badge b-warn">attiva</span>` : "no"}</td></tr>
<tr><td>Watchlist</td><td>${st.watchlist ? `del ${st.watchlist.data}, ${st.etaWatchlist} giorni (massimo ${st.P.n("settori.watchlistMaxGiorni")}), ${st.watchlist.acquistabili.length} acquistabili, settori forti: ${st.watchlist.forza.forti.map(nomeSettore).join(", ") || "nessuno"}` : "assente"}</td></tr>
<tr><td>Parametri</td><td>${st.P.versione} (${st.P.file.autore}, ${formatRome(st.P.file.data)})</td></tr></table></div>`;
}

function valoreAtteso(schede: Scheda[], minimo: number): { testo: string; valore: number | null } {
  const ch = schede.filter((s) => s.uscita && !s.manuale);
  if (ch.length < minimo) return { testo: `non stimabile: storico insufficiente (${ch.length} operazioni chiuse su ${minimo})`, valore: null };
  const st = statistiche(ch.map((s) => ({ id: s.tradeId, data: s.uscita!.data, R: s.uscita!.R, pct: s.uscita!.risultatoPct, usd: s.uscita!.risultatoUsd, spy: null, durata: null, gruppi: {} })));
  const v = (st.quotaVincenti ?? 0) * (st.guadagnoMedioPct ?? 0) + (1 - (st.quotaVincenti ?? 0)) * (st.perditaMediaPct ?? 0);
  return { testo: `${pct(v)} per operazione (da ${ch.length} operazioni reali chiuse)`, valore: v };
}

export async function paginaPosizione(ctx: Ctx, csrf: string, simbolo: string, flash?: { ok: boolean; testo: string } | null): Promise<string> {
  const st = await statoBot(ctx);
  const c = await conto(ctx);
  const p = c.posizioni.find((x) => x.symbol === simbolo);
  const schede = schedeReali(ctx.paths);
  const sc = schede.filter((s) => s.ingresso.simbolo === simbolo).at(-1);
  const pl = st.piani[simbolo];
  if (!p) return pagina(simbolo, "/", html`<h1>${simbolo}</h1>${messaggio(flash)}<p>Posizione già chiusa o inesistente.</p>${sc ? html`<p><a href="/storico">Vedi lo storico</a></p>` : ""}`, { csrf });
  const pr = c.prezzi[simbolo] ?? p.currentPrice ?? p.avgEntryPrice;
  const prot = c.aperti.filter((o) => o.symbol === simbolo && o.side === "sell");
  const stop = pl ? livelloStop(pl) : null;
  const tp = pl?.takeProfit ?? null;
  const ing = sc?.ingresso;
  const barre = sc ? expandBars(sc.candeleDopo) : [];
  const punti = [...barre.map((b) => ({ x: b.t, y: b.c })), { x: dateInTz(ctx.now(), TZ_NY) + " (ora)", y: pr }];
  const livelli = [{ y: p.avgEntryPrice, nome: "carico", colore: "var(--muted)" }];
  if (stop) livelli.push({ y: stop, nome: "stop", colore: "var(--crit)" });
  if (tp) livelli.push({ y: tp, nome: "tp", colore: "var(--good)" });
  const graficoSvg = graficoLinee([{ nome: simbolo, colore: "var(--s1)", punti }], { titolo: `Prezzo di ${simbolo} dall'ingresso`, fmt: (v) => num(v, 2), livelli, altezza: 260 });
  // bklit: variazione dal prezzo di carico (lo zero è il carico), stop e take profit tratteggiati
  const oggiIso = dateInTz(ctx.now(), TZ_NY);
  const rel = (v: number) => v / p.avgEntryPrice - 1;
  const puntiRel = [...barre.filter((b) => b.t < oggiIso).map((b) => ({ data: b.t, v: b.c })), { data: oggiIso, v: pr }].map((x) => ({ data: x.data, prezzo: rel(x.v), ...(stop ? { stop: rel(stop) } : {}), ...(tp ? { tp: rel(tp) } : {}) }));
  const grafico = puntiRel.length >= 2
    ? isola("linee", { serie: [{ chiave: "prezzo", nome: simbolo, colore: "var(--chart-1)" }, ...(stop ? [{ chiave: "stop", nome: "stop", colore: "var(--chart-2)", tratteggiata: true }] : []), ...(tp ? [{ chiave: "tp", nome: "take profit", colore: "var(--chart-5)", tratteggiata: true }] : [])], punti: puntiRel, formato: "pct" }, graficoSvg)
    : graficoSvg;
  const va = valoreAtteso(schede, st.P.n("appr.minValoreAtteso"));
  const codice = nuovoCodice(ctx.now());
  const guadagnoTp = tp ? (tp - p.avgEntryPrice) * p.qty : null;
  const perditaStop = stop ? (stop - p.avgEntryPrice) * p.qty : null;
  const eventi = readJournal(ctx.paths).filter((e) => e.simbolo === simbolo && (!sc || e.ts >= sc.eventi[0]!.ts)).slice(-60).reverse();
  const corpo = html`<h1>${simbolo} <span class="muted small">${ing?.nome ?? ""}, ${nomeSettore(ing?.settore)}</span></h1>${messaggio(flash)}
${st.allarmi?.nonProtette.includes(simbolo) ? html`<div class="alarm">Posizione segnalata come non protetta all'ultima sveglia.</div>` : ""}
<h2>Perché è stata comprata</h2>
${ing ? html`<div class="card"><p>Profilo <b>${ing.profilo ?? "n/d"}</b>, settore ${nomeSettore(ing.settore)}${ing.forzaSettore ? html` (ETF ${pct(ing.forzaSettore.rendimenti[String(ing.forzaSettore.periodo)])} contro SPY ${pct(ing.forzaSettore.spy[String(ing.forzaSettore.periodo)])} su ${ing.forzaSettore.periodo} sedute)` : ""}, punteggio ${num(ing.punteggio, 1)}, posizione in classifica ${ing.posizioneClassifica ?? "n/d"}, parametri ${ing.paramsVersione}</p>
<p><b>Motivazione del modello:</b> ${ing.motivazione ?? "n/d"}</p>
<div class="scroll"><table><tr><th>Criterio</th><th class="n">Valore</th><th>Soglia</th><th>Esito</th></tr>${ing.criteri.map((x) => html`<tr><td>${x.nome}${x.nota ? html` <span class="muted small">(${x.nota})</span>` : ""}</td><td class="n">${num(x.valore)}</td><td>${x.soglia}</td><td>${x.esito === "superato" ? html`<span class="badge b-good">sì</span>` : x.esito === "non superato" ? html`<span class="badge b-crit">no</span>` : html`<span class="badge">${x.esito}</span>`}</td></tr>`)}</table></div>
<h2>Indicatori al segnale (${ing.segnale.data})</h2><div class="scroll"><table>
<tr><td>Chiusura</td><td class="n">${num(ing.segnale.chiusura)}</td><td>SMA50 / SMA200</td><td class="n">${num(ing.segnale.sma50)} / ${num(ing.segnale.sma200)}</td></tr>
<tr><td>ADX (+DI / −DI)</td><td class="n">${num(ing.segnale.adx, 1)} (${num(ing.segnale.pdi, 1)} / ${num(ing.segnale.mdi, 1)})</td><td>ATR</td><td class="n">${num(ing.segnale.atr)}</td></tr>
<tr><td>Volume / media</td><td class="n">${num(ing.segnale.rapportoVolume)}</td><td>Donchian alto / basso</td><td class="n">${num(ing.segnale.donchianAlto)} / ${num(ing.segnale.donchianBasso)}</td></tr>
<tr><td>Conferme</td><td colspan="3">${Object.entries(ing.segnale.conferme).map(([k, v]) => html`<span class="badge ${v ? "b-good" : ""}">${k}: ${v ? "sì" : "no"}</span> `)}</td></tr></table></div></div>` : html`<p class="muted">Scheda d'ingresso non trovata (posizione aperta prima del bot o diario perso).</p>`}
<h2>Situazione</h2><div class="grid">
<div class="card tile"><div class="k">Prezzo di carico</div><div class="v">${num(p.avgEntryPrice)}</div></div>
<div class="card tile"><div class="k">Quantità</div><div class="v">${p.qty}</div></div>
<div class="card tile"><div class="k">Prezzo attuale</div><div class="v ${cls(pr - p.avgEntryPrice)}">${num(pr)} (${pct(pr / p.avgEntryPrice - 1)})</div></div></div>
<div class="card" style="margin-top:12px">${grafico}</div>
<h2>Ordini di protezione attivi</h2>${prot.length ? html`<div class="scroll"><table><tr><th>Tipo</th><th class="n">Quantità</th><th class="n">Livello</th><th>Stato</th><th>Creato</th></tr>${prot.map((o) => html`<tr><td>${o.type}</td><td class="n">${o.qty}</td><td class="n">${o.stopPrice ? num(o.stopPrice) : o.limitPrice ? num(o.limitPrice) : ""}${o.trailPercent ? ` (${o.trailPercent}%)` : o.trailPrice ? ` (${num(o.trailPrice)} $)` : ""}</td><td>${o.status}</td><td>${formatRome(o.createdAt)}</td></tr>`)}</table></div>` : html`<div class="alarm">Nessun ordine di protezione aperto</div>`}
<h2>Profitto atteso</h2><div class="card"><table>
${pl?.modalita === "trailing" ? html`<tr><td>Stop mobile</td><td>${pl.trailingPct ?? "—"}% (livello ${num(stop)}, massimo registrato ${num(pl.massimo)})</td></tr><tr><td>Guadagno già protetto dallo stop mobile</td><td class="${cls(perditaStop)}">${usd(perditaStop)}</td></tr>`
  : html`<tr><td>Se arriva al take profit</td><td class="up">${usd(guadagnoTp)}</td></tr><tr><td>Se arriva allo stop</td><td class="${cls(perditaStop)}">${usd(perditaStop)}</td></tr><tr><td>Rapporto guadagno/rischio</td><td>${guadagnoTp !== null && perditaStop ? num(guadagnoTp / Math.abs(perditaStop), 2) : "n/d"}</td></tr>`}
<tr><td>Valore atteso stimato</td><td>${va.testo}</td></tr></table>
<p class="muted small">Gli stop scattano solo in seduta regolare: non proteggono dai gap di apertura.</p></div>
<h2>Azioni manuali</h2><div class="card">
<form method="post" action="/azione/chiudi" data-confirm="${c.mercatoAperto ? `Vendere ora tutta la posizione ${simbolo}?` : `Il mercato è chiuso: ${simbolo} verrà venduto alla sveglia di apertura. Confermi?`}">
<input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="simbolo" value="${simbolo}"><input type="hidden" name="codice" value="${codice}">
<button class="danger">${c.mercatoAperto ? "Chiudi ora" : "Chiudi all'apertura"}</button>${pl?.chiudiAllApertura ? html` <span class="badge b-warn">chiusura all'apertura già richiesta</span>` : ""}</form>
${pl?.modalita === "bracket" ? html`<hr style="border:0;border-top:1px solid var(--line)"><form method="post" action="/azione/livelli" class="filters" data-confirm="Modificare stop e take profit di ${simbolo}?">
<input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="simbolo" value="${simbolo}">
<label>Stop (≤ ${num(pr * 0.99)})<input name="stop" type="number" step="0.01" value="${stop ?? ""}" required></label>
<label>Take profit (≥ ${num(pr * 1.01)})<input name="tp" type="number" step="0.01" value="${tp ?? ""}" required></label><button>Modifica</button></form>
<form method="post" action="/azione/trailing" class="filters" data-confirm="Cancellare l'OCO di ${simbolo} e passare a uno stop mobile?">
<input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="simbolo" value="${simbolo}"><input type="hidden" name="codice" value="${codice}">
<label>Stop mobile %<input name="pct" type="number" min="6" max="20" step="1" value="${st.P.n("uscita.trailingPct")}" required></label><button>Passa a stop mobile</button></form>` : ""}
</div>
<h2>Cronologia degli eventi</h2><div class="scroll"><table><tr><th>Quando</th><th>Evento</th><th>Dettagli</th></tr>${eventi.map((e) => html`<tr><td>${formatRome(e.ts)}</td><td>${e.tipo}</td><td class="small">${[e.azione, e.stato, e.motivo, e.nota, e.esito].filter(Boolean).join(", ")}</td></tr>`)}</table></div>`;
  return pagina(simbolo, "/", corpo, { csrf });
}

function risultatoReale(s: Scheda): Risultato {
  return { id: s.tradeId, data: s.uscita!.data, R: s.uscita!.R, pct: s.uscita!.risultatoPct, usd: s.uscita!.risultatoUsd, spy: s.uscita!.spyRendimento, durata: s.uscita!.durataSedute, gruppi: {} };
}

export function paginaStorico(ctx: Ctx, csrf: string, q: URLSearchParams): string {
  const tutte = schedeReali(ctx.paths).filter((s) => s.uscita);
  const f = { profilo: q.get("profilo") ?? "", settore: q.get("settore") ?? "", modalita: q.get("modalita") ?? "" };
  const sel = tutte.filter((s) => (!f.profilo || s.ingresso.profilo === f.profilo) && (!f.settore || s.ingresso.settore === f.settore) && (!f.modalita || s.ingresso.modalita === f.modalita));
  const auto = sel.filter((s) => !s.manuale);
  const man = sel.filter((s) => s.manuale);
  const st = statistiche(auto.map(risultatoReale));
  const opt = (vals: string[], cur: string) => [html`<option value="">tutti</option>`, ...[...new Set(vals)].sort().map((v) => html`<option ${v === cur ? raw("selected") : ""}>${v}</option>`)];
  const riga = (s: Scheda) => {
    const u = s.uscita!;
    return html`<tr><td>${s.ingresso.simbolo}</td><td>${s.ingresso.profilo ?? ""}</td><td>${nomeSettore(s.ingresso.settore)}</td><td>${s.ingresso.modalita}</td><td>${s.dataIngresso ?? s.ingresso.seduta} → ${u.data}</td>
<td class="n ${cls(u.risultatoPct)}">${pct(u.risultatoPct)}</td><td class="n ${cls(u.risultatoUsd)}">${usd(u.risultatoUsd, 0)}</td><td class="n">${num(u.R)}</td><td>${u.motivo}</td><td class="n">${u.durataSedute}</td><td class="n">${pct(u.spyRendimento)}</td>
<td class="small">${s.trimestrale ? "trimestrale, " : ""}${s.stato}${s.simulazione ? `, sim. bracket ${num(s.simulazione.bracket?.R)} R, trailing ${num(s.simulazione.trailing?.R)} R` : ""}</td></tr>`;
  };
  const tabella = (xs: Scheda[]) => html`<div class="scroll"><table><tr><th>Titolo</th><th>Profilo</th><th>Settore</th><th>Modalità</th><th>Periodo</th><th class="n">Esito</th><th class="n">$</th><th class="n">R</th><th>Motivo</th><th class="n">Sedute</th><th class="n">SPY</th><th>Note</th></tr>${xs.map(riga)}</table></div>`;
  const corpo = html`<h1>Storico delle operazioni reali</h1>
<form class="filters" method="get"><label>Profilo<select name="profilo">${opt(tutte.map((s) => s.ingresso.profilo ?? ""), f.profilo)}</select></label>
<label>Settore<select name="settore">${opt(tutte.map((s) => s.ingresso.settore ?? ""), f.settore)}</select></label>
<label>Modalità<select name="modalita">${opt(tutte.map((s) => s.ingresso.modalita), f.modalita)}</select></label><button>Filtra</button></form>
<div class="card small">${auto.length} operazioni (manuali escluse), vincenti ${quota(st.quotaVincenti)}, attesa ${num(st.attesaR)} R, fattore di profitto ${num(st.fattoreProfitto)}, rendimento medio ${pct(st.rendimentoMedioPct)} contro SPY ${pct(st.spyMedioPct)} nello stesso periodo${auto.length < 30 ? ", campione piccolo" : ""}</div>
${auto.length ? tabella(auto) : html`<p class="muted">Nessuna operazione chiusa</p>`}
<h2>Operazioni con intervento manuale (tenute a parte)</h2>${man.length ? tabella(man) : html`<p class="muted">Nessuna</p>`}`;
  return pagina("Storico", "/storico", corpo, { csrf });
}

export function paginaOmbra(ctx: Ctx, csrf: string): string {
  const s = schedeOmbra(ctx.paths).slice(-300).reverse();
  const modo = "bracket";
  const chiuse = s.filter((x) => x.simulazione?.[modo]?.stato === "chiusa");
  const st = statistiche(chiuse.map((x) => ({ id: x.tradeId, data: x.simulazione![modo]!.uscita!.data, R: x.simulazione![modo]!.R, pct: x.simulazione![modo]!.rendimento, usd: null, spy: null, durata: null, gruppi: {} })));
  const corpo = html`<h1>Operazioni ombra <span class="badge b-warn">SIMULATE</span></h1>
<div class="note">Sono operazioni che il bot <b>avrebbe potuto</b> fare. Sono simulate sulle candele giornaliere e <b>non</b> entrano nei risultati del portafoglio.</div>
<div class="card small">${chiuse.length} chiuse in modalità bracket simulata, attesa ${num(st.attesaR)} R, vincenti ${quota(st.quotaVincenti)}</div>
<div class="scroll"><table><tr><th>Titolo</th><th>Categoria</th><th>Motivo</th><th>Segnale</th><th>Stato</th><th class="n">Bracket (sim.)</th><th class="n">Trailing (sim.)</th></tr>
${s.map((x) => html`<tr><td>${x.ingresso.simbolo}</td><td>${x.ingresso.categoria ?? ""}</td><td class="small">${x.ingresso.motivoOmbra ?? ""}</td><td>${x.ingresso.dataSegnale}</td><td class="small">${x.nonEntrata ? `non entrata: ${x.nonEntrata}` : x.stato}</td>
<td class="n">${x.simulazione?.bracket ? `${num(x.simulazione.bracket.R)} R${x.simulazione.bracket.uscita ? ` (${x.simulazione.bracket.uscita.motivo})` : " (aperta)"}` : "—"}</td>
<td class="n">${x.simulazione?.trailing ? `${num(x.simulazione.trailing.R)} R${x.simulazione.trailing.uscita ? ` (${x.simulazione.trailing.uscita.motivo})` : " (aperta)"}` : "—"}</td></tr>`)}</table></div>`;
  return pagina("Ombra", "/ombra", corpo, { csrf });
}

