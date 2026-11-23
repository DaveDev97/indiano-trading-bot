// Pagine: review e versioni dei parametri, impostazioni, consumi AI.
import type { Ctx } from "../run/context.ts";
import { GRUPPI, PARAM_DEFS, PARAM_BY_KEY, type Valore } from "../config/parametri.ts";
import { AI_TASKS, ESITI_AI, nomeTask } from "../config/ai-task.ts";
import { listVersions, loadParams } from "../params/params.ts";
import { leggiProposte, listaReview } from "../learning/archivio.ts";
import { schedeReali } from "../journal/schede.ts";
import { statistiche } from "../learning/statistiche.ts";
import { readUsage, type RigaConsumo } from "../brain/usage.ts";
import { leggiFreno } from "../cage/freno.ts";
import { readJsonOr } from "../util/atomic.ts";
import { addDays, dateInTz, formatRome, TZ_NY, TZ_ROME } from "../util/time.ts";
import { html, num, pagina, pct, quota, raw, usd, cls, type Safe } from "./html.ts";
import { barreImpilate } from "./svg.ts";
import { aggrega, estremi, filtra, giornoRoma, PERIODI, secchio, spaccatoModello, spaccatoTask, type Grana, type PeriodoId } from "./consumi.ts";
import { conto } from "./dati.ts";

const flashHtml = (m?: { ok: boolean; testo: string } | null) => (m ? html`<div class="${m.ok ? "note" : "alarm"}">${m.testo}</div>` : raw(""));

export function paginaReview(ctx: Ctx, csrf: string, flash?: { ok: boolean; testo: string } | null): string {
  const reviews = listaReview(ctx.paths).reverse();
  const proposte = leggiProposte(ctx.paths);
  const attesa = proposte.filter((p) => p.stato === "in attesa");
  const versioni = listVersions(ctx.paths).reverse();
  const P = loadParams(ctx.paths, ctx.now()).params;
  const schede = schedeReali(ctx.paths).filter((s) => s.uscita && !s.manuale);
  const perVersione = (v: string) => {
    const xs = schede.filter((s) => s.ingresso.paramsVersione === v);
    const st = statistiche(xs.map((s) => ({ id: s.tradeId, data: s.uscita!.data, R: s.uscita!.R, pct: s.uscita!.risultatoPct, usd: s.uscita!.risultatoUsd, spy: null, durata: null, gruppi: {} })));
    return xs.length ? `${xs.length} operazioni chiuse, attesa ${num(st.attesaR)} R, vincenti ${quota(st.quotaVincenti)}` : "nessuna operazione chiusa";
  };
  const corpo = html`<h1>Review e parametri</h1>${flashHtml(flash)}
<h2>Proposte in attesa (${attesa.length})</h2>
${attesa.length ? attesa.map((p) => html`<div class="card" style="margin-bottom:8px"><b>${p.descrizione}</b><div class="small muted">review ${p.reviewId}, effetto ${num(p.effettoR, 2)} R su ${p.n} operazioni, IC primi 2/3 [${num(p.ic.primi[0], 3)}; ${num(p.ic.primi[1], 3)}], ultimo terzo [${num(p.ic.ultimi[0], 3)}; ${num(p.ic.ultimi[1], 3)}], scade ${formatRome(p.scade)}</div>
<form class="inline" method="post" action="/azione/proposta" data-confirm="Approvare: ${p.descrizione}? Crea una nuova versione dei parametri, valida dalla prossima sveglia."><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="esito" value="approva"><button class="primary">Approva</button></form>
<form class="inline" method="post" action="/azione/proposta"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="esito" value="rifiuta"><button>Rifiuta</button></form></div>`) : html`<p class="muted">Nessuna proposta in attesa.</p>`}
<h2>Review passate</h2>
${reviews.length ? reviews.map((r) => html`<details class="card" style="margin-bottom:8px"><summary><b>${r.data}</b>, ${r.id}, parametri ${r.paramsVersione}${r.campionePiccolo ? ", campione piccolo" : ""}, ${r.proposte.length} proposte</summary>
${r.primaRiga ? html`<div class="alarm">${r.primaRiga}</div>` : ""}<p style="white-space:pre-wrap">${r.testo}</p><p class="small muted">Cervello: ${r.cervello}</p>
${r.nonValutati.length ? html`<details><summary>Parametri non valutati (${r.nonValutati.length})</summary><ul class="small">${r.nonValutati.map((x) => html`<li>${x}</li>`)}</ul></details>` : ""}</details>`) : html`<p class="muted">Nessuna review ancora. La prima arriva un sabato dopo almeno 20 sedute.</p>`}
<h2>Versioni dei parametri</h2><div class="scroll"><table><tr><th>Versione</th><th>Autore</th><th>Data</th><th>Modifiche</th><th>Risultati con questa versione</th><th></th></tr>
${versioni.map((v) => html`<tr><td>v${v.versione}${`v${v.versione}` === P.versione ? html` <span class="badge b-good">attiva</span>` : ""}</td><td>${v.autore}${v.nota ? html`<div class="small muted">${v.nota}</div>` : ""}</td><td>${formatRome(v.data)}</td>
<td class="small">${v.modifiche.length ? v.modifiche.map((m) => `${PARAM_BY_KEY.get(m.chiave)?.descrizione ?? m.chiave}: ${m.da} → ${m.a}`).join("; ") : "valori iniziali"}</td><td class="small">${perVersione(`v${v.versione}`)}</td>
<td>${`v${v.versione}` !== P.versione ? html`<form method="post" action="/azione/ripristina-versione" data-confirm="Ripristinare i valori della v${v.versione}? Verrà creata una nuova versione."><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="versione" value="${v.versione}"><input type="hidden" name="attesa" value="${P.file.versione}"><button>Ripristina questa versione</button></form>` : ""}</td></tr>`)}</table></div>`;
  return pagina("Review", "/review", corpo, { csrf });
}

function campo(k: string, v: Valore): Safe {
  const d = PARAM_BY_KEY.get(k)!;
  const name = `p:${k}`;
  if (d.tipo === "booleano") return html`<select name="${name}"><option value="true" ${v === true ? raw("selected") : ""}>sì</option><option value="false" ${v === false ? raw("selected") : ""}>no</option></select>`;
  if (d.tipo === "scelta") return html`<select name="${name}">${d.opzioni!.map((o) => html`<option value="${o}" ${o === v ? raw("selected") : ""}>${o}</option>`)}</select>`;
  if (d.tipo === "ora") return html`<input name="${name}" value="${v}" pattern="[0-2][0-9]:[0-5][0-9]" size="6">`;
  return html`<input name="${name}" type="number" step="any" value="${v}" size="10">`;
}

/** Interpreta i valori del modulo: restituisce solo quelli cambiati, con i tipi giusti. */
export function leggiModuloParametri(form: URLSearchParams, attuali: Record<string, Valore>): { modifiche: Record<string, Valore>; errori: string[] } {
  const modifiche: Record<string, Valore> = {};
  const errori: string[] = [];
  for (const [key, raw0] of form) {
    if (!key.startsWith("p:")) continue;
    const k = key.slice(2);
    const d = PARAM_BY_KEY.get(k);
    if (!d) continue;
    let v: Valore;
    if (d.tipo === "booleano") v = raw0 === "true";
    else if (d.tipo === "scelta") v = typeof d.opzioni![0] === "number" ? Number(raw0) : raw0;
    else if (d.tipo === "ora") v = raw0.trim();
    else {
      const n = Number(raw0.replace(",", "."));
      if (!Number.isFinite(n)) {
        errori.push(`${d.descrizione}: "${raw0}" non è un numero`);
        continue;
      }
      v = n;
    }
    if (attuali[k] !== v) modifiche[k] = v;
  }
  return { modifiche, errori };
}

export function paginaImpostazioni(ctx: Ctx, csrf: string, flash?: { ok: boolean; testo: string } | null, anteprima?: { modifiche: Record<string, Valore>; errori: string[] }): string {
  const P = loadParams(ctx.paths, ctx.now()).params;
  const vals = P.valori();
  const versioni = listVersions(ctx.paths);
  const ultimaModifica = (k: string) => {
    const v = [...versioni].reverse().find((x) => x.modifiche.some((m) => m.chiave === k));
    return v ? `v${v.versione}, ${v.autore.startsWith("review") ? `da ${v.autore}` : v.autore === "utente" ? "da te" : v.autore}` : "mai";
  };
  const pausa = readJsonOr<{ attiva: boolean }>(ctx.paths.pausaAcquisti, { attiva: false }).attiva;
  const freno = leggiFreno(ctx.paths, ctx.now()).stato;
  let ant: Safe = raw("");
  if (anteprima) {
    const ks = Object.keys(anteprima.modifiche);
    ant = html`<div class="card" style="border-color:var(--accent)"><h2 style="margin-top:0">Anteprima delle differenze</h2>
${anteprima.errori.map((e) => html`<div class="alarm">${e}</div>`)}
${ks.length ? html`<table><tr><th>Parametro</th><th>Attuale</th><th>Nuovo</th></tr>${ks.map((k) => html`<tr><td>${PARAM_BY_KEY.get(k)!.descrizione}</td><td>${String(vals[k])}</td><td><b>${String(anteprima.modifiche[k])}</b></td></tr>`)}</table>
<form method="post" action="/azione/parametri/salva"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="attesa" value="${P.file.versione}">
${ks.map((k) => html`<input type="hidden" name="p:${k}" value="${String(anteprima.modifiche[k])}">`)}<button class="primary">Conferma e crea la nuova versione</button> <a href="/impostazioni">Annulla</a></form>` : html`<p>Nessuna modifica.</p>`}</div>`;
  }
  const gruppi = GRUPPI.map((g) => {
    const defs = PARAM_DEFS.filter((d) => d.gruppo === g.id);
    return html`<h2>${g.nome}</h2><div class="scroll"><table><tr><th>Parametro</th><th>Valore</th><th>Iniziale</th><th>Intervallo</th><th>Ultima modifica</th></tr>
${defs.map((d) => html`<tr><td>${d.descrizione}${d.categoria === "sicurezza" ? html` <span class="badge b-warn">sicurezza</span>` : d.categoria === "strategia" ? html` <span class="badge">review</span>` : ""}${d.unita ? html` <span class="muted small">(${d.unita})</span>` : ""}</td>
<td>${campo(d.chiave, vals[d.chiave]!)}</td><td class="small">${String(d.iniziale)}</td><td class="small">${d.opzioni ? d.opzioni.join(" / ") : d.min !== undefined ? `${d.min}–${d.max}${d.passo ? `, passo ${d.passo}` : ""}` : d.tipo === "ora" ? "HH:MM" : "—"}</td><td class="small">${ultimaModifica(d.chiave)}</td></tr>`)}</table></div>`;
  });
  const corpo = html`<h1>Impostazioni</h1>${flashHtml(flash)}${ant}
<div class="card"><h2 style="margin-top:0">Interruttori</h2>
<form class="inline" method="post" action="/azione/pausa" data-confirm="${pausa ? "Riprendere gli acquisti?" : "Mettere in pausa gli acquisti? Protezioni e uscite continuano."}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="attiva" value="${pausa ? "no" : "si"}"><button>${pausa ? "Riprendi gli acquisti" : "Pausa acquisti"}</button></form>
<form class="inline" method="post" action="/azione/freno" data-confirm="Sbloccare il freno d'emergenza? Il massimo di riferimento torna al patrimonio attuale."><input type="hidden" name="csrf" value="${csrf}"><button class="danger" ${freno.attivo ? "" : raw("disabled")}>Sblocca freno d'emergenza${freno.attivo ? " (ATTIVO)" : ""}</button></form>
<form class="inline" method="post" action="/azione/ripristina-iniziali" data-confirm="Ripristinare tutti i valori iniziali? Verrà creata una nuova versione."><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="attesa" value="${P.file.versione}"><button>Ripristina valori iniziali</button></form>
<p class="small muted">Versione attiva: ${P.versione}. Le modifiche valgono dalla sveglia successiva e solo per le nuove posizioni: quelle aperte seguono il proprio piano di uscita.</p></div>
<form method="post" action="/azione/parametri/anteprima"><input type="hidden" name="csrf" value="${csrf}">${gruppi}
<p><button class="primary">Mostra l'anteprima delle differenze</button></p></form>`;
  return pagina("Impostazioni", "/impostazioni", corpo, { csrf });
}

const COL = (i: number) => `var(--r${(i % 6) + 1})`;

export async function paginaConsumi(ctx: Ctx, csrf: string, q: URLSearchParams): Promise<string> {
  const tutte = readUsage(ctx.paths);
  const now = ctx.now();
  const periodo = (PERIODI.some((p) => p.id === q.get("periodo")) ? q.get("periodo") : "30g") as PeriodoId;
  const ext = estremi(periodo, now, q.get("da") ?? undefined, q.get("a") ?? undefined);
  const task = q.get("task") || undefined;
  const esito = q.get("esito") || undefined;
  const grana = (["giorno", "settimana", "mese"].includes(q.get("grana") ?? "") ? q.get("grana") : "giorno") as Grana;
  const metrica = (["costo", "token", "chiamate"].includes(q.get("metrica") ?? "") ? q.get("metrica") : "costo") as "costo" | "token" | "chiamate";
  const sel = filtra(tutte, { ...ext, task, esito });
  const tile = (nome: string, id: PeriodoId) => {
    const a = aggrega(filtra(tutte, { ...estremi(id, now), task, esito }));
    return html`<div class="card tile"><div class="k">${nome}</div><div class="v">${usd(a.costo, 2)}</div>
<div class="small">${a.chiamate} chiamate (${a.fallite} fallite${a.nonMisurate ? `, ${a.nonMisurate} non misurate` : ""})</div>
<div class="small">${a.token.toLocaleString("it-IT")} token: input ${a.input.toLocaleString("it-IT")}, output ${a.output.toLocaleString("it-IT")}, cache ${(a.cacheLettura + a.cacheScrittura).toLocaleString("it-IT")}</div>
<div class="small muted">durata media ${a.durataMedia ? num(a.durataMedia / 1000, 1) + " s" : "n/d"}, letti dalla cache ${quota(a.quotaCache)}</div></div>`;
  };
  // grafico impilato per tipologia
  const valore = (rows: RigaConsumo[]) => (metrica === "costo" ? rows.reduce((s, r) => s + (r.costoUsd ?? 0), 0) : metrica === "token" ? aggrega(rows).token : rows.length);
  const secchi = [...new Set(sel.map((r) => secchio(giornoRoma(r.ts), grana)))].sort();
  const pile = AI_TASKS.map((t, i) => ({ nome: t.nome, colore: COL(i), id: t.id }));
  const grafico = barreImpilate(secchi, pile, (c, p) => valore(sel.filter((r) => secchio(giornoRoma(r.ts), grana) === c && nomeTask(r.task) === p)), { titolo: "Consumi nel tempo", fmt: (v) => (metrica === "costo" ? usd(v, 2) : Math.round(v).toLocaleString("it-IT")) });
  const sp = spaccatoTask(sel);
  const mod = spaccatoModello(sel);
  // rapporto con il trading
  const chiuse = schedeReali(ctx.paths).filter((s) => s.uscita && giornoRoma(s.uscita.data + "T12:00:00Z") >= ext.da && s.uscita.data <= ext.a);
  const meseCorr = aggrega(filtra(tutte, estremi("mese", now)));
  let pnlMese: number | null = null;
  try {
    const c = await conto(ctx);
    const h = await ctx.broker.getPortfolioHistory(dateInTz(now, TZ_NY).slice(0, 8) + "01");
    const first = h.equity.find((x) => typeof x === "number") as number | undefined;
    pnlMese = first ? c.account.equity - first : null;
  } catch {}
  // proiezione: costo medio per giorno di borsa × giorni di borsa rimanenti nel mese
  let proiezione: string = "n/d";
  try {
    const oggi = dateInTz(now, TZ_NY);
    const cal = await ctx.broker.getCalendar(oggi.slice(0, 8) + "01", addDays(oggi.slice(0, 8) + "28", 4));
    const mese = cal.filter((d) => d.date.slice(0, 7) === oggi.slice(0, 7));
    const passati = mese.filter((d) => d.date <= oggi).length;
    const rimasti = mese.length - passati;
    if (passati > 0) proiezione = `${usd(meseCorr.costo + (meseCorr.costo / passati) * rimasti)} (stima: ${usd(meseCorr.costo / passati)} per giorno di borsa × ${rimasti} giorni rimanenti + speso finora)`;
  } catch {}
  const opt = (vals: { v: string; n: string }[], cur?: string) => [html`<option value="">tutte</option>`, ...vals.map((x) => html`<option value="${x.v}" ${x.v === cur ? raw("selected") : ""}>${x.n}</option>`)];
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams(q);
    for (const [k, v] of Object.entries(over)) p.set(k, v);
    return `?${p}`;
  };
  const riga = (n: string, a: ReturnType<typeof aggrega>, b = false) => html`<tr${b ? raw(' class="totale"') : ""}><td>${n}</td><td class="n">${a.chiamate}</td><td class="n">${a.token.toLocaleString("it-IT")}${a.nonMisurate ? html` <span class="muted small">(+${a.nonMisurate} non mis.)</span>` : ""}</td><td class="n">${usd(a.costo, 3)}</td><td class="n">${usd(a.costoMedio, 3)}</td><td class="n">${a.durataMedia ? num(a.durataMedia / 1000, 1) + " s" : "n/d"}</td><td class="n">${quota(a.pctErrori)}</td></tr>`;
  const ultime = [...sel].reverse().slice(0, 50);
  const corpo = html`<h1>Consumi AI</h1>
<div class="note"><b>Come leggere questi numeri.</b> Il costo è una <b>stima calcolata dal client</b> (Claude Code) con un listino incorporato, non l'importo fatturato.
Con l'abbonamento Claude (token OAuth) non è un addebito a consumo: è il <b>costo equivalente se si pagasse a consumo</b>. I limiti di utilizzo dell'abbonamento non sono leggibili dal bot, quindi qui non compaiono.
Le chiamate interrotte per timeout, e gli errori che riportano zero, sono contati come "<b>non misurati</b>": non si stimano e non si mettono a zero.</div>
<div class="grid">${tile("Oggi", "oggi")}${tile("Settimana", "settimana")}${tile("Mese", "mese")}${tile("Dall'inizio", "tutto")}</div>
<form class="filters" method="get">
<label>Periodo<select name="periodo">${PERIODI.map((p) => html`<option value="${p.id}" ${p.id === periodo ? raw("selected") : ""}>${p.nome}</option>`)}</select></label>
<label>Da<input type="date" name="da" value="${ext.da === "2000-01-01" ? "" : ext.da}"></label><label>A<input type="date" name="a" value="${ext.a}"></label>
<label>Tipologia<select name="task">${opt(AI_TASKS.map((t) => ({ v: t.id, n: t.nome })), task)}</select></label>
<label>Esito<select name="esito">${opt(ESITI_AI.map((e) => ({ v: e, n: e })), esito)}</select></label>
<input type="hidden" name="grana" value="${grana}"><input type="hidden" name="metrica" value="${metrica}"><button>Applica</button>
<a class="btn" href="/consumi.csv${qs({})}">Esporta CSV</a></form>
<p class="small muted">Periodo: ${ext.da === "2000-01-01" ? "dall'inizio" : ext.da} → ${ext.a} (ora di Roma).</p>
<h2>Nel tempo</h2><div class="filters">${(["giorno", "settimana", "mese"] as Grana[]).map((g) => html`<a class="btn" href="${qs({ grana: g })}" ${g === grana ? raw('aria-current="true"') : ""}>${g}</a>`)}
<span class="sep"></span>${(["costo", "token", "chiamate"] as const).map((m) => html`<a class="btn" href="${qs({ metrica: m })}" ${m === metrica ? raw('aria-current="true"') : ""}>${m}</a>`)}</div>
<div class="card">${grafico}</div>
<h2>Spaccato per tipologia</h2><div class="scroll"><table><tr><th>Tipologia</th><th class="n">Chiamate</th><th class="n">Token</th><th class="n">Costo stimato</th><th class="n">Costo medio</th><th class="n">Durata media</th><th class="n">Errori</th></tr>
${sp.righe.map((r) => riga(r.nome, r.agg))}${riga("Totale", sp.totale, true)}</table></div>
<h2>Per modello</h2><div class="scroll"><table><tr><th>Modello</th><th class="n">Chiamate</th><th class="n">Token</th><th class="n">Costo stimato</th><th class="n">Costo medio per chiamata</th></tr>
${mod.righe.map((r) => html`<tr><td>${r.modello}</td><td class="n">${r.chiamate}</td><td class="n">${r.token.toLocaleString("it-IT")}</td><td class="n">${usd(r.costo, 3)}</td><td class="n">${usd(r.costoMedio, 4)}</td></tr>`)}</table>
${mod.nonAttribuite ? html`<p class="small muted">${mod.nonAttribuite} chiamate senza dettaglio per modello (non misurate).</p>` : ""}<p class="small muted">Una chiamata può usare più modelli (Claude Code usa anche un modello piccolo per compiti interni): per questo le chiamate per modello possono superare il totale.</p></div>
<h2>Rapporto con il trading (solo informazione)</h2><div class="card"><table>
<tr><td>Costo AI stimato per operazione chiusa nel periodo</td><td>${chiuse.length ? usd(aggrega(sel).costo / chiuse.length, 2) : "n/d (nessuna operazione chiusa)"}</td></tr>
<tr><td>Costo AI stimato del mese</td><td>${usd(meseCorr.costo, 2)}, accanto al P&amp;L del mese <span class="${cls(pnlMese)}">${usd(pnlMese, 0)}</span></td></tr>
<tr><td>Proiezione del mese</td><td>${proiezione}</td></tr></table></div>
<h2>Ultime 50 chiamate</h2><div class="scroll"><table><tr><th>Quando</th><th>Tipologia</th><th>Esito</th><th class="n">Token</th><th class="n">Costo</th><th class="n">Durata</th><th>Log</th></tr>
${ultime.map((r) => html`<tr><td>${formatRome(r.ts)}${r.forzata ? html` <span class="badge">forzata</span>` : ""}</td><td>${nomeTask(r.task)}</td><td>${r.esito === "ok" ? r.esito : html`<span class="badge b-crit">${r.esito}</span>`}</td><td class="n">${r.token ? (r.token.input + r.token.output + r.token.cacheLettura + r.token.cacheScrittura).toLocaleString("it-IT") : "non misurato"}</td><td class="n">${r.costoUsd === null ? "non misurato" : usd(r.costoUsd, 4)}</td><td class="n">${num(r.durataMs / 1000, 1)} s</td><td><a href="/log/${encodeURIComponent(r.runId)}">${r.runId}</a></td></tr>`)}</table></div>`;
  return pagina("Consumi AI", "/consumi", corpo, { csrf });
}

