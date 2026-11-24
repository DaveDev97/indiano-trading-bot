// Pagina "Guida": come funziona il bot, spiegato per chi lo usa. I numeri vengono dai parametri attivi,
// così la guida resta vera anche dopo una modifica (manuale o approvata dalla review).
import type { Ctx } from "../run/context.ts";
import { loadParams } from "../params/params.ts";
import { html, num, pagina, usd, type Safe } from "./html.ts";
import { descrizioneUniverso } from "./pagine-selezione.ts";

interface Sezione {
  id: string;
  titolo: string;
  corpo: Safe;
}

export function paginaGuida(ctx: Ctx, csrf: string): string {
  const P = loadParams(ctx.paths, ctx.now()).params;
  const n = (k: string, d = 0) => num(P.n(k), d);
  const pc = (k: string, d = 0) => `${num(P.n(k) * 100, d)}%`;
  const bracket = P.s("uscita.modalita") === "bracket";
  const conf = P.n("segnali.confermeMin");

  const sezioni: Sezione[] = [
    {
      id: "in-breve",
      titolo: "In breve",
      corpo: html`<p>Il bot fa <b>paper trading</b> su azioni USA con un conto Alpaca di prova: soldi finti, mercato vero. Tiene al massimo <b>${n("rischio.maxPosizioni")} posizioni</b>, che possono restare aperte per giorni o settimane.</p>
<p>Le scelte sono divise così:</p>
<ul>
<li><b>Il codice</b> seleziona i titoli, calcola indicatori e quantità, e applica le regole di rischio (la <i>gabbia</i>).</li>
<li><b>Il cervello</b> (Claude) sceglie solo tra le opzioni che il codice ha già ammesso, e spiega il perché in italiano. Non può superare la gabbia: <i>il modello propone, il codice dispone</i>.</li>
<li><b>Tu</b> controlli tutto dalla dashboard e da Telegram. Nessun parametro cambia senza la tua conferma.</li>
</ul>
<p>Il risultato si misura sempre contro <b>SPY</b>, cioè contro il semplice comprare e tenere l'indice: se il bot rende meno, lo dice.</p>`,
    },
    {
      id: "pezzi",
      titolo: "I due pezzi: motore e dashboard",
      corpo: html`<div class="scroll"><table><tr><th>Pezzo</th><th>Cosa fa</th><th>Come parte</th></tr>
<tr><td><b>Motore</b></td><td>Ogni 30 secondi (o ogni 5 minuti con la pianificazione) controlla se c'è una sveglia da fare. Se c'è la esegue, altrimenti non fa niente. Il sabato fa la scansione dei titoli.</td><td><code>start avvia</code> (con la dashboard), <code>start motore</code>, oppure la pianificazione (<code>start installa</code>)</td></tr>
<tr><td><b>Dashboard</b></td><td>Questa webapp: mostra come sta andando e ti fa intervenire (pausa acquisti, freno, parametri, chiusura delle posizioni). Legge anche i pulsanti di Telegram.</td><td><code>start avvia</code> o <code>start dashboard</code>. Si apre solo da questo computer (127.0.0.1) e chiede la password.</td></tr></table></div>
<p class="small muted">Motore e dashboard non si parlano direttamente. Ogni ordine, da qualunque parte arrivi, passa dallo stesso esecutore sotto lo stesso lock: mai due ordini uguali, mai due processi sul broker insieme.</p>`,
    },
    {
      id: "giornata",
      titolo: "La giornata del bot",
      corpo: html`<p>Si lavora solo nei giorni di borsa USA, secondo il calendario di Alpaca, che include festivi e mezze giornate. Gli orari si calcolano in ora di New York, quindi il cambio dell'ora legale è già gestito.</p>
<div class="scroll"><table><tr><th>Sveglia</th><th>Quando (ora di Roma, di norma)</th><th>Cosa fa</th></tr>
<tr><td>☀ Briefing</td><td>${P.s("orari.briefing")}</td><td>Controlla conto e protezioni, calcola i segnali sulle candele chiuse e prepara il piano del giorno. <b>Non compra e non vende.</b></td></tr>
<tr><td>🔔 Apertura</td><td>15:30 + ${n("orari.aperturaMinuti")} min</td><td>Prima le uscite, poi gli acquisti nei posti liberi. Usa il modello per le decisioni (${P.s("ai.modelloDecisioni")}).</td></tr>
<tr><td>🕧 Metà seduta</td><td>${P.s("orari.metaSeduta")} di New York</td><td>Controlla le protezioni. Se in giornata si è liberato un posto, compra dalla lista del briefing.</td></tr>
<tr><td>🌙 Chiusura</td><td>22:00 − ${n("orari.chiusuraMinuti")} min</td><td>Nessun acquisto. Fa il resoconto del giorno, con la distanza di ogni posizione da stop e take profit, e aggiorna le operazioni ombra.</td></tr>
<tr><td>Sabato</td><td>${P.s("orari.scansione")}</td><td>Scansione dei titoli (sotto), poi controlla se è il momento di una review.</td></tr></table></div>
<p class="small muted">Una sveglia vale se parte entro ${n("orari.finestraMinuti")} minuti dall'orario previsto. Oltre è <i>saltata</i>. Se il bot riparte dopo averne saltata qualcuna (PC spento, motore chiuso), recupera <b>una sola</b> sveglia della giornata: a mercato aperto l'apertura (o la metà seduta), dopo l'orario della chiusura solo la chiusura (senza acquisti), prima dell'apertura solo il briefing. Non torna mai indietro dopo una sveglia già fatta, ogni recupero si tenta una volta sola e il resoconto lo dice. Se due sveglie cadono a meno di ${n("orari.distanzaMinima")} minuti l'una dall'altra, si fa solo la seconda.</p>`,
    },
    {
      id: "selezione",
      titolo: "Come sceglie i titoli (la scansione del sabato)",
      corpo: html`<ol class="passi">
<li><b>Universo.</b> Si parte dalle ${descrizioneUniverso(P)}, negoziabili su Alpaca, e si tengono quelle con prezzo ≥ ${n("universo.prezzoMin")} $ e scambi medi a 20 sedute ≥ ${usd(P.n("universo.controvaloreMin"), 0)} al giorno. Borse e sede si scelgono in Impostazioni → Universo; Alpaca negozia solo titoli quotati in USA. Prima di salvare un cambio vedi quanti titoli cambiano, quanto dura la scansione e quanto incide sul consumo AI.</li>
<li><b>Settori forti.</b> Per ognuno degli 11 settori si guarda il suo ETF (ad esempio XLK per la tecnologia). Il settore è forte se l'ETF ha reso più di SPY nelle ultime ${n("settori.periodoForza")} sedute. Si compra solo nei settori forti.</li>
<li><b>Bilanci.</b> Ogni titolo si valuta su tre profili, con i dati di Finnhub:
  <ul>
  <li><i>Growth</i>: utili e ricavi in crescita, buona redditività;</li>
  <li><i>Value</i>: qualità a un prezzo ragionevole;</li>
  <li><i>Dividendo solido</i>: rendimento alto ma sostenibile.</li>
  </ul>
  Un profilo è superato se passano tutti i criteri valutabili e se ne possono valutare almeno il ${pc("fond.copertura")}. Un dato mancante vale «non disponibile» e non viene mai considerato superato.</li>
<li><b>Classifica.</b> Per ogni criterio si calcola il percentile rispetto ai titoli dello stesso settore. La media dei percentili è il punteggio. Si tengono i migliori ${n("settori.migliori")} per settore forte, al massimo ${n("settori.maxAcquistabili")}: sono gli <b>acquistabili</b>.</li></ol>
<p>Nella pagina <a href="/selezione">Selezione</a> vedi il risultato. Ogni titolo si apre con il perché è stato scelto, criterio per criterio, e il suo grafico (1 mese, 6 mesi, 1 anno o tutto lo storico).</p>
<p><b>Override a mano.</b> Puoi correggere la lista:</p>
<ul>
<li><b>aggiungere</b> un titolo della zona grigia, cioè uno che ha mancato di poco un criterio di bilancio. Resta in lista finché è in zona grigia;</li>
<li><b>togliere</b> un acquistabile. Resta fuori anche dopo le scansioni successive, finché non lo rimetti.</li>
</ul>
<p>Un override cambia solo la lista: per comprare servono comunque il segnale tecnico, il settore forte e il via libera della gabbia. Le operazioni nate da un titolo aggiunto a mano restano marcate nel diario. Dalla stessa pagina puoi anche <b>lanciare una scansione</b> senza aspettare il sabato.</p>`,
    },
    {
      id: "ingresso",
      titolo: "Quando compra",
      corpo: html`<p>Un titolo acquistabile si compra solo quando il grafico dà il segnale. Il segnale si calcola sull'ultima candela <b>chiusa</b>: niente dati parziali della seduta in corso. Servono tutte e tre queste condizioni:</p>
<ul>
<li><b>Trend crescente:</b> prezzo sopra la media a ${n("segnali.smaMedia")} sedute, e questa sopra quella a ${n("segnali.smaLunga")};</li>
<li><b>Trend forte e rialzista:</b> ADX almeno ${n("segnali.adxMin")} e +DI sopra −DI;</li>
<li><b>Più forte di SPY:</b> la linea di forza relativa sta sopra la sua media a ${n("segnali.rsMediaPeriodo")} sedute.</li></ul>
<p>Poi servono almeno <b>${conf} conferm${conf === 1 ? "a" : "e"} di rottura</b> su 4:</p>
<ul>
<li>chiusura sopra il massimo delle ${n("segnali.donchianPeriodo")} sedute precedenti;</li>
<li>volume almeno ${num(P.n("segnali.volumeMult"), 2)} volte la media;</li>
<li>resistenza superata di almeno lo ${num(P.n("segnali.rotturaMin"), 1)}%;</li>
<li>candela verde lunga.</li></ul>
<p>Al momento dell'acquisto si controlla anche che:</p>
<ul>
<li>il prezzo non si sia già allontanato troppo (al massimo ${num(P.n("rischio.gapMaxAtr"), 1)} ATR dalla chiusura precedente);</li>
<li>la trimestrale non cada entro ${n("rischio.sedutePrimaTrimestrale")} giorni di borsa;</li>
<li>ci sia un posto libero.</li></ul>
<p>Fra più candidati sceglie il cervello, che deve spiegare il perché.</p>`,
    },
    {
      id: "gabbia",
      titolo: "La gabbia: i limiti di rischio",
      corpo: html`<ul>
<li><b>Dimensione:</b> ogni posizione vale al massimo il ${pc("rischio.peso")} del patrimonio, e si usa solo il cash che c'è davvero. Niente margine, niente short, solo azioni intere.</li>
<li><b>Al massimo ${n("rischio.maxPosizioni")} posizioni</b>, di cui al massimo ${n("rischio.maxPerSettore")} nello stesso settore. Contano anche gli acquisti non ancora eseguiti.</li>
<li><b>Pause:</b>
  <ul>
  <li>dopo uno stop in perdita, quel titolo non si ricompra per ${n("rischio.pausaDopoStop")} sedute;</li>
  <li>dopo ogni altra uscita, per ${n("rischio.pausaDopoUscita")} sedute;</li>
  <li>dopo ${n("rischio.rifiutiPerPausa")} rifiuti per lo stesso motivo, pausa di ${n("rischio.pausaRifiuti")} sedute.</li>
  </ul></li>
<li><b>Freno d'emergenza:</b> se il patrimonio scende sotto il ${pc("rischio.freno")} del suo massimo, il bot smette di comprare e manda un allarme a ogni sveglia. Si sblocca solo dalla dashboard, in Impostazioni.</li>
<li><b>Pausa acquisti:</b> un interruttore in Impostazioni. Ferma gli acquisti, ma protezioni e uscite continuano.</li>
<li><b>Sempre protetto:</b> ogni posizione ha sul broker un ordine di uscita per l'intera quantità. Ogni sveglia lo verifica e, se manca, lo ripara.</li></ul>`,
    },
    {
      id: "uscita",
      titolo: "Quando vende",
      corpo: html`<ol class="passi">
<li><b>Stop e take profit, sul broker.</b> ${bracket ? html`Modalità attuale <i>bracket</i>: all'acquisto partono uno stop a −${n("uscita.stopPct")}% e un take profit a +${n("uscita.takeProfitPct")}% dal prezzo d'ingresso.` : html`Modalità attuale <i>trailing</i>: uno stop mobile al ${n("uscita.trailingPct")}% sotto il massimo raggiunto, senza tetto al guadagno.`} Questi ordini scattano da soli in seduta, anche a PC spento.</li>
<li><b>Uscita forte, la decide il codice.</b> Chiusura sotto il minimo delle ${n("segnali.donchianPeriodo")} sedute precedenti, con volume almeno ${num(P.n("segnali.volumeMult"), 2)} volte la media. Si vende anche se il cervello direbbe di tenere.</li>
<li><b>Uscite deboli, le valuta il cervello.</b> Si guardano tre segnali: chiusura sotto la media a ${n("segnali.smaMedia")} sedute, forza relativa sotto la sua media, candela rossa lunga con volume in crescita. Il cervello decide se vendere o tenere, e spiega il perché.</li>
<li><b>A mano.</b> Dal dettaglio di una posizione puoi chiudere subito, chiudere all'apertura o spostare stop e take profit.</li></ol>
<p class="small muted">Prima di vendere si cancellano gli ordini di protezione, poi si vende solo la quantità realmente posseduta: così non si apre mai uno short per errore. Gli stop scattano solo in seduta regolare. Se un titolo apre in forte ribasso sotto lo stop, si esce al prezzo di apertura e la perdita supera lo stop.</p>`,
    },
    {
      id: "cervello",
      titolo: "Il cervello (AI)",
      corpo: html`<p>È Claude, chiamato con <code>claude -p</code> dal computer. Riceve i dati già filtrati dal codice e risponde in un formato fisso, che il codice valida campo per campo. Se la risposta non è valida, il bot non compra: protezioni e uscite forti si fanno comunque.</p>
<div class="scroll"><table><tr><th>Compito</th><th>Modello</th></tr>
<tr><td>Apertura e metà seduta: compra, vendi, tieni</td><td>${P.s("ai.modelloDecisioni")}</td></tr>
<tr><td>Briefing e chiusura: piano e resoconto</td><td>${P.s("ai.modelloSemplici")}</td></tr>
<tr><td>Review periodica</td><td>${P.s("ai.modelloReview")}</td></tr></table></div>
<p class="small muted">Ogni chiamata ha un tetto di spesa stimata (${usd(P.n("ai.tettoDecisione"))} per le sveglie, ${usd(P.n("ai.tettoReview"))} per la review) e un tempo massimo di ${n("ai.timeoutSec")} secondi. Il budget mensile stimato è ${usd(P.n("ai.budgetMensile"), 0)}, con questa regola: «${P.s("ai.azioneBudget")}». I consumi sono nella pagina <a href="/consumi">Consumi AI</a>: sono stime del client, non la fattura.</p>`,
    },
    {
      id: "apprendimento",
      titolo: "Come impara",
      corpo: html`<ul>
<li><b>Diario:</b> ogni sveglia, decisione, ordine e uscita viene registrata, con la versione dei parametri in uso.</li>
<li><b>Operazioni ombra:</b> il bot simula anche gli ingressi che ha scartato di poco, ad esempio quando mancava una sola conferma, e confronta le due modalità di uscita. Sono simulate e restano <b>sempre separate</b> dai risultati reali (pagina <a href="/ombra">Ombra</a>).</li>
<li><b>Review:</b> parte un sabato, almeno ogni ${n("appr.reviewMinSedute")} sedute e al più tardi dopo ${n("appr.reviewMaxSedute")}. Prova a spostare di un passo ogni parametro della strategia sulle operazioni registrate. Propone una modifica solo se il miglioramento è netto e stabile nel tempo:
  <ul>
  <li>almeno ${n("appr.effettoMinR", 2)} R di effetto;</li>
  <li>intervallo bootstrap con correzione di Bonferroni;</li>
  <li>verificato sia sui primi 2/3 del periodo sia sull'ultimo terzo.</li>
  </ul></li>
<li><b>Campione piccolo:</b> con meno di ${n("appr.campionePiccolo")} operazioni reali chiuse, la review fa solo il resoconto e non propone niente. Con pochi dati qualunque "miglioramento" può essere un caso.</li>
<li><b>Conferma tua:</b> ogni proposta arriva su Telegram con i pulsanti Approva e Rifiuta, e si può decidere anche in <a href="/review">Review</a>. Scade dopo ${n("appr.scadenzaGiorni")} giorni. Anche le modifiche fatte a mano restano tracciate e la review successiva le valuta.</li></ul>`,
    },
    {
      id: "telegram",
      titolo: "Telegram",
      corpo: html`<ul>
<li>Un messaggio a fine sveglia, con:
  <ul>
  <li>gli ordini inviati e quelli rifiutati, con il motivo;</li>
  <li>la motivazione del cervello;</li>
  <li>patrimonio contro SPY e prossima sveglia.</li>
  </ul>
  Alla chiusura ogni posizione aperta mostra anche quanto dista dallo stop e dal take profit, in % e in $.</li>
<li>Gli allarmi ⚠ arrivano a parte: posizione non protetta, freno, broker che non risponde, budget AI.</li>
<li>Il sabato arrivano il riepilogo della scansione e, quando c'è, la review con i pulsanti.</li>
<li>Il bot accetta i pulsanti solo dalla tua chat. I clic li legge la dashboard ogni 30 secondi, quindi deve essere accesa. Telegram conserva i clic non letti per 24 ore.</li></ul>`,
    },
    {
      id: "sicurezza",
      titolo: "Sicurezza",
      corpo: html`<ul>
<li><b>Solo conto paper:</b> l'indirizzo di Alpaca è fisso nel codice. Il bot si rifiuta di partire con una chiave del conto reale.</li>
<li><b>Niente short e niente leva:</b> all'avvio imposta il conto a "niente short, margine 1" e lo verifica rileggendo. Se non è applicato, non parte.</li>
<li><b>Mai due volte lo stesso ordine:</b> ogni ordine ha un id deterministico, controllato sul broker prima dell'invio. Le sveglie hanno un lock, quindi due lanci contemporanei non fanno doppi ordini, nemmeno se il processo muore a metà.</li>
<li><b>Le chiavi non si vedono mai:</b> stanno in <code>secrets.ts</code> e vengono tolte da log, messaggi e pagine.</li></ul>`,
    },
    {
      id: "comandi",
      titolo: "Comandi",
      corpo: html`<div class="scroll"><table><tr><th>Comando (Windows: <code>.\\start.ps1 …</code>, Linux: <code>./start.sh …</code>)</th><th>Cosa fa</th></tr>
<tr><td><code>avvia</code></td><td>Motore e dashboard insieme, in una finestra. Ctrl+C li ferma entrambi.</td></tr>
<tr><td><code>installa</code> / <code>disinstalla</code></td><td>Registra o rimuove le attività pianificate: motore ogni 5 minuti, scansione del sabato, dashboard all'accesso.</td></tr>
<tr><td><code>status</code></td><td>Stato rapido nel terminale.</td></tr>
<tr><td><code>once --slot apertura --force</code></td><td>Una sveglia subito, fuori orario.</td></tr>
<tr><td><code>scan</code></td><td>La scansione dei titoli. Riparte dalla cache se interrotta.</td></tr>
<tr><td><code>review --force</code></td><td>Una review subito.</td></tr>
<tr><td><code>… --fake</code></td><td>Qualunque comando con broker, dati e cervello finti.</td></tr></table></div>`,
    },
    {
      id: "limiti",
      titolo: "Limiti da conoscere",
      corpo: html`<ul>
<li><b>Gap di apertura:</b> gli stop non proteggono da un'apertura molto sotto lo stop.</li>
<li><b>Conto paper:</b> le esecuzioni sono ideali, senza code né slittamenti reali. Il risultato vero sarebbe un po' peggiore.</li>
<li><b>Campioni piccoli:</b> per capire se una regola funziona servono decine di operazioni chiuse, cioè mesi.</li>
<li><b>Dati gratuiti di Finnhub:</b> mancano stime degli analisti, bilanci standardizzati e storico dei dividendi. I criteri che li richiedono sono «non disponibili».</li>
<li><b>Fuori da questa versione:</b>
  <ul>
  <li>notizie e analisi macro;</li>
  <li>backtest sui fondamentali;</li>
  <li>pattern grafici;</li>
  <li>accesso alla dashboard da fuori dal computer;</li>
  <li>acquisti manuali;</li>
  <li>conto reale.</li>
  </ul></li></ul>`,
    },
  ];

  const corpo = html`<h1>Come funziona il bot</h1>
<p class="introduzione">Una guida al bot. I numeri sono quelli dei parametri attivi (${P.versione}): se cambi un'impostazione, la guida si aggiorna da sola.</p>
<nav class="card indice" aria-label="Indice della guida"><ol>${sezioni.map((s) => html`<li><a href="#${s.id}">${s.titolo}</a></li>`)}</ol></nav>
${sezioni.map((s) => html`<section id="${s.id}" class="guida"><h2>${s.titolo}</h2><div class="card">${s.corpo}</div></section>`)}`;
  return pagina("Guida", "/guida", corpo, { csrf });
}
