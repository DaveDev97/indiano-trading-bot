// Pagine: accesso, panoramica, dettaglio posizione, storico, operazioni ombra.
import type { Ctx } from "../run/context.ts";
import { NOME_SETTORE, type Settore } from "../config/settori.ts";
import { NOME_SVEGLIA } from "../run/calendario.ts";
import { livelloStop } from "../run/piani.ts";
import { schedeOmbra, schedeReali, type Scheda } from "../journal/schede.ts";
import { readJournal } from "../journal/journal.ts";
import { expandBars } from "../data/bars.ts";
import { statistiche, type Risultato } from "../learning/statistiche.ts";
import { addDays, dateInTz, formatRome, TZ_NY, TZ_ROME } from "../util/time.ts";
import { cls, html, num, pagina, pct, quota, raw, usd, type Safe } from "./html.ts";
import { graficoLinee } from "./svg.ts";
import { conto, rendimentoDa, statoBot, storia } from "./dati.ts";
import { estremi } from "./consumi.ts";
import { nuovoCodice } from "./azioni.ts";
import { errText } from "../util/redact.ts";

export function paginaLogin(errore?: string): string {
  return pagina("Accesso", "", html`<h1>Accesso</h1>
<form method="post" action="/accedi" class="card" style="max-width:360px">
<label>Password<br><input type="password" name="password" autocomplete="current-password" autofocus required></label><br><br>
<button class="primary">Entra</button>${errore ? html`<p class="down">${errore}</p>` : ""}</form>
<p class="muted small">La dashboard è raggiungibile solo da questo computer (127.0.0.1).</p>`);
}

function nomeSettore(s: string | null | undefined): string {
  return s ? (NOME_SETTORE[s as Settore] ?? s) : "n/d";
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
    const per = [
      { n: "Oggi", bot: c.account.lastEquity ? eq / c.account.lastEquity - 1 : null, usdV: c.account.lastEquity ? eq - c.account.lastEquity : null, spy: c.spyOggi },
      { n: "Settimana", bot: rendimentoDa(h.patrimonio, sett, eq), spy: rendimentoDa(h.spy, sett) },
      { n: "Mese", bot: rendimentoDa(h.patrimonio, mese, eq), spy: rendimentoDa(h.spy, mese) },
      { n: `Dall'inizio (${h.avvio})`, bot: rendimentoDa(h.patrimonio, h.avvio, eq), spy: rendimentoDa(h.spy, h.avvio) },
    ].map((x: any) => ({ ...x, usdV: x.usdV ?? (x.bot !== null ? eq - eq / (1 + x.bot) : null) }));
    const investito = c.posizioni.reduce((a, p) => a + (c.prezzi[p.symbol] ?? p.currentPrice ?? 0) * p.qty, 0);
    const maxPos = st.P.n("rischio.maxPosizioni");
    const occupati = new Set([...c.posizioni.map((p) => p.symbol), ...c.aperti.filter((o) => o.side === "buy" && !o.parentId).map((o) => o.symbol)]).size;
    // grafico del patrimonio con SPY, entrambi indicizzati a 100 (un solo asse)
    const g = q.get("grafico") ?? "1m";
    const inizio = g === "1s" ? addDays(oggiNy, -7) : g === "3m" ? addDays(oggiNy, -92) : g === "tutto" ? "2000-01-01" : addDays(oggiNy, -31);
    const pe = h.patrimonio.filter((x) => x.data >= inizio);
    // SPY si disegna solo da dove ci sono dati del bot: prima il bot non esisteva
    const ps = pe.length ? h.spy.filter((x) => x.data >= pe[0]!.data) : [];
    const ix = (s: { data: string; v: number }[]) => s.map((x) => ({ x: x.data, y: s[0] ? (100 * x.v) / s[0].v : null }));
    const grafico = graficoLinee([{ nome: "Bot", colore: "var(--s1)", punti: ix(pe) }, { nome: "SPY", colore: "var(--s2)", punti: ix(ps) }], { titolo: "Patrimonio e SPY (base 100)", fmt: (v) => num(v, 1) });
    const schede = schedeReali(ctx.paths);
    const riquadri = c.posizioni.map((p) => {
      const pr = c.prezzi[p.symbol] ?? p.currentPrice ?? p.avgEntryPrice;
      const pl = st.piani[p.symbol];
      const sc = schede.filter((s) => s.ingresso.simbolo === p.symbol && !s.uscita).at(-1);
      const stop = pl ? livelloStop(pl) : null;
      const tp = pl?.takeProfit ?? null;
      const lo = stop ?? pr * 0.9, hi = tp ?? Math.max(pl?.massimo ?? pr, pr) * 1.05;
      const pos = Math.max(0, Math.min(100, ((pr - lo) / (hi - lo || 1)) * 100));
      const giorni = pl ? Math.floor((ctx.now().getTime() - Date.parse(pl.creato)) / 86_400_000) : null;
      const np = st.allarmi?.nonProtette.includes(p.symbol);
      return html`<a class="card" href="/posizione/${encodeURIComponent(p.symbol)}" style="text-decoration:none;color:inherit">
<div><b>${p.symbol}</b> <span class="muted small">${sc?.ingresso.nome ?? ""}, ${nomeSettore(sc?.ingresso.settore)}</span>${np ? html` <span class="badge b-crit">⚠ non protetta</span>` : ""}</div>
<div class="pnl ${cls(pr - p.avgEntryPrice)}">${pct(pr / p.avgEntryPrice - 1)}, ${usd((pr - p.avgEntryPrice) * p.qty, 0)}</div>
<div class="small muted">${giorni ?? "n/d"} giorni, ${pl?.modalita === "trailing" ? `stop mobile ${pl.trailingPct ?? ""}%` : "bracket"}</div>
<div class="bar" data-tip="${`stop ${num(stop)}, prezzo ${num(pr)}, ${tp ? `take profit ${num(tp)}` : "nessun take profit"}`}"><i style="left:${pos.toFixed(1)}%"></i></div>
<div class="small" style="display:flex;justify-content:space-between"><span>stop ${num(stop)} (${pct(stop ? stop / pr - 1 : null, 1)})</span><span>${tp ? `tp ${num(tp)} (${pct(tp / pr - 1, 1)})` : "—"}</span></div></a>`;
    });
    corpo = html`<h1>Panoramica</h1>${messaggio(flash)}
${(st.allarmi?.allarmi ?? []).map((a) => html`<div class="alarm">⚠ ${a}</div>`)}
<div class="grid">
<div class="card tile"><div class="k">Patrimonio</div><div class="v">${usd(eq, 0)}</div></div>
<div class="card tile"><div class="k">Cash</div><div class="v">${usd(c.account.cash, 0)}</div></div>
<div class="card tile"><div class="k">Investito</div><div class="v">${usd(investito, 0)}</div></div>
<div class="card tile"><div class="k">Posti liberi</div><div class="v">${Math.max(0, maxPos - occupati)} su ${maxPos}</div></div></div>
<h2>Risultati, a confronto con SPY</h2><div class="scroll"><table><tr><th>Periodo</th><th class="n">Bot</th><th class="n">Bot $</th><th class="n">SPY</th><th class="n">Differenza</th></tr>
${per.map((x) => html`<tr><td>${x.n}</td><td class="n ${cls(x.bot)}">${pct(x.bot)}</td><td class="n ${cls(x.usdV)}">${usd(x.usdV, 0)}</td><td class="n">${pct(x.spy)}</td><td class="n ${cls(x.bot !== null && x.spy !== null ? x.bot - x.spy : null)}">${x.bot !== null && x.spy !== null ? pct(x.bot - x.spy) : "n/d"}</td></tr>`)}</table></div>
<h2>Patrimonio e SPY (base 100)</h2>
<div class="filters">${[["1s", "1 settimana"], ["1m", "1 mese"], ["3m", "3 mesi"], ["tutto", "Tutto"]].map(([k, n]) => html`<a class="btn" href="/?grafico=${k}" ${k === g ? raw('aria-current="true"') : ""}>${n}</a>`)}</div>
<div class="card">${grafico}</div>
<h2>Posizioni (${c.posizioni.length})</h2>${c.posizioni.length ? html`<div class="grid">${riquadri}</div>` : html`<p class="muted">Nessuna posizione aperta.</p>`}
${statoHtml(st, c.mercatoAperto)}`;
  } catch (e) {
    corpo = html`<h1>Panoramica</h1>${messaggio(flash)}<div class="alarm">Broker non raggiungibile: ${errText(e)}</div>${statoHtml(st, null)}`;
  }
  return pagina("Panoramica", "/", corpo, { csrf });
}

function statoHtml(st: Awaited<ReturnType<typeof statoBot>>, aperto: boolean | null): Safe {
  return html`<h2>Stato del bot</h2><div class="card"><table>
<tr><td>Mercato</td><td>${aperto === null ? "n/d" : aperto ? "aperto" : "chiuso"}</td></tr>
<tr><td>Ultima sveglia</td><td>${st.ultima ? `${NOME_SVEGLIA[st.ultima.tipo as keyof typeof NOME_SVEGLIA] ?? st.ultima.tipo}, run ${st.ultima.id}, eseguita ${formatRome(st.ultima.eseguitaIl)}` : "nessuna"}</td></tr>
<tr><td>Prossima sveglia</td><td>${st.prossima ? `${NOME_SVEGLIA[st.prossima.tipo]}, ${formatRome(st.prossima.at)}` : st.erroreCalendario ? `n/d (${st.erroreCalendario})` : "n/d"}</td></tr>
<tr><td>Allarmi aperti</td><td>${st.allarmi?.allarmi.length ? html`<span class="badge b-crit">⚠ ${st.allarmi.allarmi.length}</span> dall'ultima sveglia (${st.allarmi.runId})` : "nessuno"}</td></tr>
<tr><td>Freno d'emergenza</td><td>${st.freno.attivo ? html`<span class="badge b-crit">⚠ ATTIVO</span> dal ${formatRome(st.freno.scattatoIl ?? "")}` : "non attivo"}, soglia ${quota(st.P.n("rischio.freno"))} del massimo</td></tr>
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
  const grafico = graficoLinee([{ nome: simbolo, colore: "var(--s1)", punti }], { titolo: `Prezzo di ${simbolo} dall'ingresso`, fmt: (v) => num(v, 2), livelli, altezza: 260 });
  const va = valoreAtteso(schede, st.P.n("appr.minValoreAtteso"));
  const codice = nuovoCodice(ctx.now());
  const guadagnoTp = tp ? (tp - p.avgEntryPrice) * p.qty : null;
  const perditaStop = stop ? (stop - p.avgEntryPrice) * p.qty : null;
  const eventi = readJournal(ctx.paths).filter((e) => e.simbolo === simbolo && (!sc || e.ts >= sc.eventi[0]!.ts)).slice(-60).reverse();
  const corpo = html`<h1>${simbolo} <span class="muted small">${ing?.nome ?? ""}, ${nomeSettore(ing?.settore)}</span></h1>${messaggio(flash)}
${st.allarmi?.nonProtette.includes(simbolo) ? html`<div class="alarm">⚠ Posizione segnalata come NON PROTETTA all'ultima sveglia.</div>` : ""}
<h2>Perché è stata comprata</h2>
${ing ? html`<div class="card"><p>Profilo <b>${ing.profilo ?? "n/d"}</b>, settore ${nomeSettore(ing.settore)}${ing.forzaSettore ? html` (ETF ${pct(ing.forzaSettore.rendimenti[String(ing.forzaSettore.periodo)])} contro SPY ${pct(ing.forzaSettore.spy[String(ing.forzaSettore.periodo)])} su ${ing.forzaSettore.periodo} sedute)` : ""}, punteggio ${num(ing.punteggio, 1)}, posizione in classifica ${ing.posizioneClassifica ?? "n/d"}, parametri ${ing.paramsVersione}</p>
<p><b>Motivazione del modello:</b> ${ing.motivazione ?? "n/d"}</p>
<div class="scroll"><table><tr><th>Criterio</th><th class="n">Valore</th><th>Soglia</th><th>Esito</th></tr>${ing.criteri.map((x) => html`<tr><td>${x.nome}${x.nota ? html` <span class="muted small">(${x.nota})</span>` : ""}</td><td class="n">${num(x.valore)}</td><td>${x.soglia}</td><td>${x.esito === "superato" ? html`<span class="badge b-good">sì</span>` : x.esito === "non superato" ? html`<span class="badge b-crit">no</span>` : html`<span class="badge">${x.esito}</span>`}</td></tr>`)}</table></div>
<h2>Indicatori al segnale (${ing.segnale.data})</h2><div class="scroll"><table>
<tr><td>Chiusura</td><td class="n">${num(ing.segnale.chiusura)}</td><td>SMA50 / SMA200</td><td class="n">${num(ing.segnale.sma50)} / ${num(ing.segnale.sma200)}</td></tr>
<tr><td>ADX (+DI / −DI)</td><td class="n">${num(ing.segnale.adx, 1)} (${num(ing.segnale.pdi, 1)} / ${num(ing.segnale.mdi, 1)})</td><td>ATR</td><td class="n">${num(ing.segnale.atr)}</td></tr>
<tr><td>Volume / media</td><td class="n">${num(ing.segnale.rapportoVolume)}</td><td>Donchian alto / basso</td><td class="n">${num(ing.segnale.donchianAlto)} / ${num(ing.segnale.donchianBasso)}</td></tr>
<tr><td>Conferme</td><td colspan="3">${Object.entries(ing.segnale.conferme).map(([k, v]) => html`<span class="badge ${v ? "b-good" : ""}">${k}${v ? " ✓" : " ✗"}</span> `)}</td></tr></table></div></div>` : html`<p class="muted">Scheda d'ingresso non trovata (posizione aperta prima del bot o diario perso).</p>`}
<h2>Situazione</h2><div class="grid">
<div class="card tile"><div class="k">Prezzo di carico</div><div class="v">${num(p.avgEntryPrice)}</div></div>
<div class="card tile"><div class="k">Quantità</div><div class="v">${p.qty}</div></div>
<div class="card tile"><div class="k">Prezzo attuale</div><div class="v ${cls(pr - p.avgEntryPrice)}">${num(pr)} (${pct(pr / p.avgEntryPrice - 1)})</div></div></div>
<div class="card" style="margin-top:12px">${grafico}</div>
<h2>Ordini di protezione attivi</h2>${prot.length ? html`<div class="scroll"><table><tr><th>Tipo</th><th class="n">Quantità</th><th class="n">Livello</th><th>Stato</th><th>Creato</th></tr>${prot.map((o) => html`<tr><td>${o.type}</td><td class="n">${o.qty}</td><td class="n">${o.stopPrice ? num(o.stopPrice) : o.limitPrice ? num(o.limitPrice) : ""}${o.trailPercent ? ` (${o.trailPercent}%)` : o.trailPrice ? ` (${num(o.trailPrice)} $)` : ""}</td><td>${o.status}</td><td>${formatRome(o.createdAt)}</td></tr>`)}</table></div>` : html`<div class="alarm">⚠ Nessun ordine di protezione aperto.</div>`}
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
${auto.length ? tabella(auto) : html`<p class="muted">Nessuna operazione chiusa.</p>`}
<h2>Operazioni con intervento manuale (tenute a parte)</h2>${man.length ? tabella(man) : html`<p class="muted">Nessuna.</p>`}`;
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

