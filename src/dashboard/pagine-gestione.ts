// Pagine: review e versioni dei parametri, impostazioni, consumi AI.
import type { Ctx } from "../run/context.ts";
import { GRUPPI, PARAM_DEFS, PARAM_BY_KEY, type Valore } from "../config/parametri.ts";
import { AI_TASKS, ESITI_AI, nomeTask } from "../config/ai-task.ts";
import { listVersions, loadParams } from "../params/params.ts";
import { leggiProposte, listaReview, type Proposta } from "../learning/archivio.ts";
import { SPIEGAZIONE_GRUPPO, spiegazione } from "../config/spiegazioni.ts";
import { schedeReali } from "../journal/schede.ts";
import { statistiche } from "../learning/statistiche.ts";
import { modelloOsservato, readUsage, type RigaConsumo } from "../brain/usage.ts";
import { leggiFreno } from "../cage/freno.ts";
import { readJsonOr } from "../util/atomic.ts";
import { addDays, dateInTz, formatDateIt, formatRome, TZ_NY, TZ_ROME } from "../util/time.ts";
import { html, isola, num, pagina, pct, quota, raw, usd, cls, type Safe } from "./html.ts";
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
  const corpo = html`<h1>Review e parametri</h1>${flashHtml(flash)}
<p class="introduzione">La review guarda i risultati, prova a spostare di un passo ogni parametro della strategia sulle operazioni registrate e propone una modifica solo se il miglioramento è netto e stabile nel tempo. Con pochi dati non propone niente, ed è giusto così.</p>
<h2>Proposte in attesa (${attesa.length})</h2>
${attesa.length ? html`<div class="lista">${attesa.map((p) => propostaRiga(p, csrf))}</div>` : html`<div class="note">Nessuna proposta in attesa.</div>`}
<h2>Review passate</h2>
${reviews.length ? html`<div class="lista">${reviews.map((r) => {
    const st = (r.statistiche ?? {}) as any;
    const n = st.reali?.n ?? 0;
    return html`<a class="riga" href="/review/${encodeURIComponent(r.id)}"><span class="iniziale">${r.data.slice(8, 10)}</span>
<span><span class="t">Review del ${formatDateIt(r.data)}</span>${r.primaRiga ? html` <span class="badge b-crit">rende meno di SPY</span>` : ""}
<span class="d" style="display:block">${r.campionePiccolo ? "Campione piccolo: solo resoconto" : `${r.proposte.length} proposte`}, ${n} operazioni reali chiuse, parametri ${r.paramsVersione}</span>
<span class="d" style="display:block">${r.sintesi.slice(0, 160)}${r.sintesi.length > 160 ? "…" : ""}</span></span>
<span class="n"><span class="v">${st.reali?.attesaR == null ? "n/d" : `${num(st.reali.attesaR, 2)} R`}</span><span class="d" style="display:block">attesa per operazione</span></span></a>`;
  })}</div>` : html`<div class="note">Nessuna review ancora. La prima arriva un sabato, dopo almeno ${P.n("appr.reviewMinSedute")} sedute dall'avvio.</div>`}
<h2>Versioni dei parametri</h2><div class="card scroll"><table><tr><th>Versione</th><th>Autore</th><th>Data</th><th>Modifiche</th><th>Risultati con questa versione</th><th></th></tr>
${versioni.map((v) => html`<tr><td>v${v.versione}${`v${v.versione}` === P.versione ? html` <span class="badge b-good">attiva</span>` : ""}</td><td>${v.autore}${v.nota ? html`<div class="small muted">${v.nota}</div>` : ""}</td><td>${formatRome(v.data)}</td>
<td class="small">${v.modifiche.length ? v.modifiche.map((m) => `${PARAM_BY_KEY.get(m.chiave)?.descrizione ?? m.chiave}: ${m.da} → ${m.a}`).join("; ") : "valori iniziali"}</td><td class="small">${risultatiVersione(ctx, `v${v.versione}`)}</td>
<td>${`v${v.versione}` !== P.versione ? html`<form method="post" action="/azione/ripristina-versione" data-confirm="Ripristinare i valori della v${v.versione}? Verrà creata una nuova versione."><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="versione" value="${v.versione}"><input type="hidden" name="attesa" value="${P.file.versione}"><button>Ripristina</button></form>` : ""}</td></tr>`)}</table></div>`;
  return pagina("Review", "/review", corpo, { csrf });
}

function risultatiVersione(ctx: Ctx, v: string): string {
  const xs = schedeReali(ctx.paths).filter((s) => s.uscita && !s.manuale && s.ingresso.paramsVersione === v);
  const st = statistiche(xs.map((s) => ({ id: s.tradeId, data: s.uscita!.data, R: s.uscita!.R, pct: s.uscita!.risultatoPct, usd: s.uscita!.risultatoUsd, spy: null, durata: null, gruppi: {} })));
  return xs.length ? `${xs.length} operazioni chiuse, attesa ${num(st.attesaR)} R, vincenti ${quota(st.quotaVincenti)}` : "nessuna operazione chiusa";
}

function propostaRiga(p: Proposta, csrf: string): Safe {
  const azioni = p.stato === "in attesa"
    ? html`<span class="n"><form class="inline" method="post" action="/azione/proposta" data-confirm="Approvare: ${p.descrizione}? Crea una nuova versione dei parametri, valida dalla prossima sveglia."><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="esito" value="approva"><button class="primary">Approva</button></form><form class="inline" method="post" action="/azione/proposta"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${p.id}"><input type="hidden" name="esito" value="rifiuta"><button>Rifiuta</button></form></span>`
    : html`<span class="n"><span class="badge ${p.stato === "approvata" ? "b-good" : ""}">${p.stato}${p.versioneCreata ? ` (${p.versioneCreata})` : ""}</span></span>`;
  return html`<div class="riga${p.stato === "in attesa" ? " aperta" : ""}"><span class="iniziale">P</span><span><span class="t">${p.descrizione}</span>
<span class="d" style="display:block">effetto ${num(p.effettoR, 2)} R per operazione su ${p.n} operazioni; intervallo nei primi 2/3 [${num(p.ic.primi[0], 3)}; ${num(p.ic.primi[1], 3)}], nell'ultimo terzo [${num(p.ic.ultimi[0], 3)}; ${num(p.ic.ultimi[1], 3)}]${p.stato === "in attesa" ? `; scade ${formatRome(p.scade)}` : ""}</span></span>${azioni}</div>`;
}

function tabellaStat(righe: [string, any][]): Safe {
  const v = righe.filter(([, s]) => s && s.n > 0);
  if (!v.length) return html`<p class="muted small">Nessuna operazione</p>`;
  return html`<div class="scroll"><table><tr><th></th><th class="n">Operazioni</th><th class="n">Vincenti</th><th class="n">Guadagno medio</th><th class="n">Perdita media</th><th class="n">Attesa</th><th class="n">Fattore di profitto</th></tr>
${v.map(([n, s]) => html`<tr><td>${n}</td><td class="n">${s.n}</td><td class="n">${quota(s.quotaVincenti)}</td><td class="n">${pct(s.guadagnoMedioPct)}</td><td class="n">${pct(s.perditaMediaPct)}</td><td class="n ${cls(s.attesaR)}">${num(s.attesaR)} R</td><td class="n">${s.fattoreProfitto === null ? "n/d" : Number.isFinite(s.fattoreProfitto) ? num(s.fattoreProfitto) : "∞"}</td></tr>`)}</table></div>`;
}

export function paginaReviewDettaglio(ctx: Ctx, csrf: string, id: string): string {
  const r = listaReview(ctx.paths).find((x) => x.id === id);
  if (!r) return pagina("Review", "/review", html`<h1>Review non trovata</h1><p><a href="/review">Torna alle review</a></p>`, { csrf });
  const st = (r.statistiche ?? {}) as any;
  const proposte = leggiProposte(ctx.paths).filter((p) => p.reviewId === r.id);
  const val: any[] = st.valutazioni ?? [];
  const pf = st.portafoglio ?? {};
  const gruppo = (k: string) => Object.entries(st[k] ?? {}) as [string, any][];
  const corpo = html`<p class="small"><a href="/review">← Tutte le review</a></p>
<h1>Review del ${formatDateIt(r.data)}</h1>
${r.primaRiga ? html`<div class="alarm">${r.primaRiga}</div>` : ""}
<div class="tally">
<div><div class="k">Operazioni reali chiuse</div><div class="v">${st.reali?.n ?? 0}</div><div class="s">${r.campionePiccolo ? "campione piccolo" : "campione sufficiente"}</div></div>
<div><div class="k">Attesa per operazione</div><div class="v ${cls(st.reali?.attesaR)}">${st.reali?.attesaR == null ? "n/d" : `${num(st.reali.attesaR)} R`}</div><div class="s">vincenti ${quota(st.reali?.quotaVincenti)}</div></div>
<div><div class="k">Bot dall'avvio</div><div class="v ${cls(pf.bot)}">${pct(pf.bot)}</div><div class="s">SPY ${pct(pf.spy)} in ${pf.sedute ?? "n/d"} sedute</div></div>
<div><div class="k">Proposte</div><div class="v">${r.proposte.length}</div><div class="s">${st.confronti ?? 0} confronti statistici fatti</div></div></div>
<h2>Cosa dice la review</h2><div class="card"><p style="white-space:pre-wrap;margin:0">${r.testo}</p><p class="small muted" style="margin-bottom:0">Scritta da: ${r.cervello}. Parametri in vigore: ${r.paramsVersione}.</p></div>
<h2>Proposte</h2>${proposte.length ? html`<div class="lista">${proposte.map((p) => propostaRiga(p, csrf))}</div>` : html`<div class="note">${r.campionePiccolo ? "Nessuna proposta: con un campione piccolo la review fa solo il resoconto." : "Nessuna modifica ha superato tutti i controlli contro l'overfitting."}</div>`}
<h2>Risultati</h2><div class="due">
<div class="card"><h3>Reali e ombra (simulate, sempre separate)</h3>${tabellaStat([["Reali", st.reali], ["Ombra (simulate)", st.ombra]])}</div>
<div class="card"><h3>Bracket contro trailing (simulati sulle stesse operazioni)</h3>${tabellaStat([["Bracket", st.modalitaTutte?.bracket], ["Trailing", st.modalitaTutte?.trailing]])}</div>
<div class="card"><h3>Per profilo</h3>${tabellaStat(gruppo("perProfilo"))}</div>
<div class="card"><h3>Per motivo di uscita</h3>${tabellaStat(gruppo("perUscita"))}</div>
<div class="card"><h3>Per settore</h3>${tabellaStat(gruppo("perSettore"))}</div>
<div class="card"><h3>Per forza del trend (ADX)</h3>${tabellaStat(gruppo("perAdx"))}</div>
<div class="card"><h3>Per durata</h3>${tabellaStat(gruppo("perDurata"))}</div>
<div class="card"><h3>Per versione dei parametri</h3>${tabellaStat(gruppo("perVersione"))}</div></div>
<h2>Cosa è stato provato</h2><p class="introduzione">Ogni parametro della strategia spostato di un passo, valutato sulle operazioni che cambierebbe. Una modifica passa solo con almeno ${loadParams(ctx.paths, ctx.now()).params.n("appr.minGruppo")} operazioni, un effetto di almeno ${num(loadParams(ctx.paths, ctx.now()).params.n("appr.effettoMinR"), 2)} R e un intervallo che esclude lo zero sia nei primi 2/3 sia nell'ultimo terzo del periodo.</p>
${val.length ? html`<div class="card scroll"><table><tr><th>Parametro</th><th>Da → a</th><th class="n">Operazioni</th><th class="n">Effetto</th><th>Esito</th></tr>
${val.map((v) => html`<tr><td>${v.descrizione}</td><td>${String(v.da)} → ${String(v.a)}</td><td class="n">${v.n}</td><td class="n ${cls(v.effettoR)}">${num(v.effettoR, 3)} R</td><td class="small">${v.ammessa ? html`<span class="badge b-good">supera i controlli</span>` : v.motivo}</td></tr>`)}</table></div>` : html`<div class="note">Nessun parametro aveva operazioni sufficienti nel gruppo della differenza.</div>`}
${r.nonValutati.length ? html`<details class="card" style="margin-top:16px"><summary>Non valutati (${r.nonValutati.length})</summary><ul class="small">${r.nonValutati.map((x) => html`<li>${x}</li>`)}</ul></details>` : ""}`;
  return pagina(`Review ${r.data}`, "/review", corpo, { csrf });
}

function campo(k: string, v: Valore): Safe {
  const d = PARAM_BY_KEY.get(k)!;
  const name = `p:${k}`;
  const id = `f-${k.replace(/\./g, "-")}`;
  if (d.tipo === "booleano") return html`<select id="${id}" name="${name}"><option value="true" ${v === true ? raw("selected") : ""}>sì</option><option value="false" ${v === false ? raw("selected") : ""}>no</option></select>`;
  if (d.tipo === "scelta") return html`<select id="${id}" name="${name}">${d.opzioni!.map((o) => html`<option value="${o}" ${o === v ? raw("selected") : ""}>${o === "predefinito" ? "predefinito di Claude Code" : o}</option>`)}</select>`;
  if (d.tipo === "ora") return html`<input id="${id}" name="${name}" value="${v}" pattern="[0-2][0-9]:[0-5][0-9]" inputmode="numeric">`;
  return html`<input id="${id}" name="${name}" type="number" step="any" value="${v}" inputmode="decimal">`;
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

const TIPI_PER_MODELLO: Record<string, string[]> = {
  "ai.modelloDecisioni": ["decisione-apertura", "decisione-meta"],
  "ai.modelloSemplici": ["decisione-briefing", "decisione-chiusura"],
  "ai.modelloReview": ["review"],
};

export function paginaImpostazioni(ctx: Ctx, csrf: string, flash?: { ok: boolean; testo: string } | null, anteprima?: { modifiche: Record<string, Valore>; errori: string[] }, schedaRichiesta?: string | null): string {
  const P = loadParams(ctx.paths, ctx.now()).params;
  const vals = P.valori();
  const versioni = listVersions(ctx.paths);
  const usi = readUsage(ctx.paths);
  const scheda = GRUPPI.find((g) => g.id === schedaRichiesta)?.id ?? GRUPPI[0]!.id;
  const ultimaModifica = (k: string) => {
    const v = [...versioni].reverse().find((x) => x.modifiche.some((m) => m.chiave === k));
    return v ? `cambiato nella v${v.versione} ${v.autore.startsWith("review") ? `dalla ${v.autore}` : v.autore === "utente" ? "da te" : `(${v.autore})`}` : "mai cambiato";
  };
  const pausa = readJsonOr<{ attiva: boolean }>(ctx.paths.pausaAcquisti, { attiva: false }).attiva;
  const freno = leggiFreno(ctx.paths, ctx.now()).stato;
  let ant: Safe = raw("");
  if (anteprima) {
    const ks = Object.keys(anteprima.modifiche);
    ant = html`<div class="card" style="margin-bottom:18px"><h3>Anteprima delle differenze</h3>
${anteprima.errori.map((e) => html`<div class="alarm">${e}</div>`)}
${ks.length ? html`<div class="scroll"><table><tr><th>Parametro</th><th>Attuale</th><th>Nuovo</th></tr>${ks.map((k) => html`<tr><td>${PARAM_BY_KEY.get(k)!.descrizione}</td><td>${String(vals[k])}</td><td><b>${String(anteprima.modifiche[k])}</b></td></tr>`)}</table></div>
<form method="post" action="/azione/parametri/salva" style="margin-top:12px"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="attesa" value="${P.file.versione}"><input type="hidden" name="scheda" value="${scheda}">
${ks.map((k) => html`<input type="hidden" name="p:${k}" value="${String(anteprima.modifiche[k])}">`)}<button class="primary">Conferma e crea la nuova versione</button> <a class="btn" href="/impostazioni?scheda=${scheda}">Annulla</a></form>` : html`<p>Nessuna modifica in questa scheda.</p>`}</div>`;
  }
  const g = GRUPPI.find((x) => x.id === scheda)!;
  const defs = PARAM_DEFS.filter((d) => d.gruppo === scheda);
  const cambiati = (gid: string) => PARAM_DEFS.filter((d) => d.gruppo === gid && vals[d.chiave] !== d.iniziale).length;
  const modelloAttuale = (k: string): Safe => {
    if (!TIPI_PER_MODELLO[k]) return raw("");
    const v = String(vals[k]);
    if (v !== "predefinito") return html`<span class="badge b-good">usa ${v}</span>`;
    const o = modelloOsservato(usi, TIPI_PER_MODELLO[k]!);
    return o ? html`<span class="badge b-good">predefinito: ha usato ${o.modello} (${formatRome(o.quando)})</span>` : html`<span class="badge">predefinito: modello non ancora noto, si vedrà dopo la prima chiamata</span>`;
  };
  const righe = defs.map((d) => html`<div class="param">
<div class="nome"><label for="f-${d.chiave.replace(/\./g, "-")}">${d.descrizione}${d.unita ? html` <span class="muted small">(${d.unita})</span>` : ""}</label><details class="info"><summary title="Cosa significa" aria-label="Spiegazione: ${d.descrizione}">i</summary><p>${spiegazione(d.chiave)}</p></details>${d.categoria === "sicurezza" ? html`<span class="badge b-warn">sicurezza</span>` : d.categoria === "strategia" ? html`<span class="badge">la review può proporlo</span>` : ""}${modelloAttuale(d.chiave)}</div>
${campo(d.chiave, vals[d.chiave]!)}
<div class="meta">Iniziale ${String(d.iniziale)}${d.opzioni ? `, scelte: ${d.opzioni.join(" / ")}` : d.min !== undefined ? `, intervallo ${d.min}–${d.max}${d.passo ? `, passo ${d.passo}` : ""}` : d.tipo === "ora" ? ", formato HH:MM" : ""}; ${ultimaModifica(d.chiave)}</div></div>`);
  const corpo = html`<h1>Impostazioni</h1>${flashHtml(flash)}
<div class="card" style="margin-bottom:22px"><h3>Comandi rapidi</h3>
<form class="inline" method="post" action="/azione/pausa" data-confirm="${pausa ? "Riprendere gli acquisti?" : "Mettere in pausa gli acquisti? Protezioni e uscite continuano."}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="attiva" value="${pausa ? "no" : "si"}"><button>${pausa ? "Riprendi gli acquisti" : "Pausa acquisti"}</button></form>
<form class="inline" method="post" action="/azione/freno" data-confirm="Sbloccare il freno d'emergenza? Il massimo di riferimento torna al patrimonio attuale."><input type="hidden" name="csrf" value="${csrf}"><button class="danger" ${freno.attivo ? "" : raw("disabled")}>Sblocca freno d'emergenza${freno.attivo ? " (ATTIVO)" : ""}</button></form>
<form class="inline" method="post" action="/azione/ripristina-iniziali" data-confirm="Ripristinare tutti i valori iniziali? Verrà creata una nuova versione."><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="attesa" value="${P.file.versione}"><button>Ripristina valori iniziali</button></form>
<p class="small muted" style="margin-bottom:0">Versione attiva ${P.versione}. Le modifiche valgono dalla sveglia successiva e solo per le posizioni nuove: quelle aperte seguono il proprio piano di uscita.</p></div>
<div class="schede"><nav aria-label="Schede delle impostazioni"><ul class="tabs">${GRUPPI.map((x) => html`<li><a href="/impostazioni?scheda=${x.id}" ${x.id === scheda ? raw('aria-current="page"') : ""}>${x.nome}<span class="c">${cambiati(x.id) ? `${cambiati(x.id)} cambiati` : ""}</span></a></li>`)}</ul></nav>
<section>${ant}<h2 style="margin-top:0">${g.nome}</h2><p class="introduzione">${SPIEGAZIONE_GRUPPO[scheda]}</p>
<form method="post" action="/azione/parametri/anteprima"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="scheda" value="${scheda}">
<div class="card">${righe}</div><p><button class="primary">Mostra l'anteprima delle differenze</button></p></form></section></div>`;
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
  const graficoSvg = barreImpilate(secchi, pile, (c, p) => valore(sel.filter((r) => secchio(giornoRoma(r.ts), grana) === c && nomeTask(r.task) === p)), { titolo: "Consumi nel tempo", fmt: (v) => (metrica === "costo" ? usd(v, 2) : Math.round(v).toLocaleString("it-IT")) });
  // bklit: barre impilate per tipologia, con i colori nello stesso ordine fisso
  const grafico = secchi.length
    ? isola("impilate", {
        categorie: secchi.map((c) => (grana === "mese" ? c : `${c.slice(8, 10)}/${c.slice(5, 7)}`)),
        serie: pile.map((p) => ({ chiave: p.id, nome: p.nome, colore: p.colore })),
        valori: secchi.map((c) => Object.fromEntries(pile.map((p) => [p.id, valore(sel.filter((r) => secchio(giornoRoma(r.ts), grana) === c && r.task === p.id))]))),
        formato: metrica === "costo" ? "usd" : "numero",
      }, graficoSvg)
    : graficoSvg;
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

