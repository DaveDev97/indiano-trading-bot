// Spiegazioni in italiano semplice per la pagina delle impostazioni: una per scheda e una per parametro.
// Le soglie fondamentali si spiegano componendo il significato della metrica con la regola del criterio.
import type { Gruppo } from "./parametri.ts";
import { PARAM_BY_KEY } from "./parametri.ts";
import { CRITERI, NOME_PROFILO } from "../scan/profili.ts";
import { NOME_SETTORE } from "./settori.ts";

export const SPIEGAZIONE_GRUPPO: Record<Gruppo, string> = {
  universo: "Da quali titoli parte la ricerca. Ogni sabato il bot prende le azioni delle borse scelte (di norma NYSE e NASDAQ; Alpaca negozia solo titoli quotati in USA), tiene le società della sede scelta e scarta quelle troppo piccole, troppo economiche o poco scambiate: è il primo setaccio, prima ancora di guardare i bilanci. Quando cambi qualcosa qui, prima di salvare vedi una stima di quanti titoli cambiano, di quanto dura la scansione e di quanto incide sul consumo AI. Il cambio vale dalla scansione successiva.",
  profili: "I criteri di bilancio. Un titolo entra in lista se soddisfa tutti i criteri valutabili di almeno uno dei tre profili: Growth (crescita), Value (qualità a prezzo ragionevole) o Dividendo solido. Sono le soglie che la review può proporre di spostare, un passo alla volta.",
  settori: "Si comprano solo titoli di settori «forti», cioè che stanno battendo l'indice SPY. Qui si decide su quante sedute misurare la forza, quanti titoli tenere per settore e quando la lista diventa troppo vecchia per comprare.",
  segnali: "Le regole tecniche sul grafico dei prezzi: trend, forza del trend (ADX), forza relativa contro SPY e almeno due conferme di rottura. Li calcola il codice una volta per seduta, mai il modello.",
  rischio: "Quanto si rischia: peso di ogni posizione, numero massimo di posizioni, freno d'emergenza, pause dopo uno stop. I parametri di sicurezza (segnati) la review può solo renderli più prudenti.",
  uscite: "Come si esce da una posizione: stop e take profit fissi (bracket) oppure stop mobile che segue il massimo (trailing). Valgono solo per le posizioni nuove: quelle già aperte seguono il proprio piano.",
  orari: "Quando si sveglia il bot. Gli orari di apertura e chiusura arrivano dal calendario di borsa di New York, quindi tengono conto da soli delle mezze giornate e dell'ora legale.",
  apprendimento: "Le regole della review periodica: ogni quanto si fa, quante operazioni servono perché un risultato conti, e quanto deve essere netto un miglioramento per diventare una proposta. Sono volutamente severe: con pochi dati è facile vedere effetti che non esistono.",
  notifiche: "Cosa arriva su Telegram.",
  ai: "Il «cervello» è Claude Code, chiamato a ogni sveglia per scegliere tra le opzioni già ammesse dal codice e per scrivere la review. Qui scegli i modelli, il tetto di spesa stimata per chiamata e il budget del mese.",
  dashboard: "Impostazioni di questa pagina web.",
};

const P: Record<string, string> = {
  "universo.prezzoMin": "Sotto questo prezzo un'azione non si considera (le azioni da pochi dollari sono più erratiche e più facili da manipolare). Più alto = universo più piccolo e più solido.",
  "universo.controvaloreMin": "Media dei dollari scambiati ogni giorno nelle ultime 20 sedute (prezzo × volume). Serve a evitare titoli illiquidi, dove comprare e vendere costa caro. Più alto = solo titoli molto scambiati.",
  "universo.borse": "Le borse da cui la scansione prende i titoli. Alpaca negozia solo titoli quotati negli Stati Uniti, quindi le scelte sono borse americane: NYSE e NASDAQ (le principali), con l'aggiunta di NYSE American (società più piccole, spesso meno liquide), oppure una sola delle due. Vale dalla prossima scansione; prima di salvare vedi una stima di quanti titoli cambiano, del tempo di scansione e del consumo AI.",
  "universo.sede": "Dove ha sede la società, secondo il profilo Finnhub: «tutte» comprende anche le società estere quotate in USA (ad esempio NVO, danese, o BAM, canadese); «solo USA» le esclude; «solo estere» tiene solo quelle. Se la sede non è disponibile e c'è un filtro, il titolo si esclude per prudenza. Vale dalla prossima scansione.",
  "universo.capitalizzazione":"Grandezza delle aziende: «tutte» (oltre 300 milioni di $), «large» (oltre 10 miliardi, le più grandi e stabili) o «mid-small» (tra 300 milioni e 10 miliardi, più volatili e con più margine di crescita).",
  "universo.cacheMetricheGiorni": "Per quanti giorni si riusano i dati di bilancio già scaricati da Finnhub. Serve a non superare il limite di richieste del piano gratuito e a far riprendere una scansione interrotta.",
  "universo.cacheProfiloGiorni": "Per quanti giorni si riusa il profilo dell'azienda (nome, industria). Cambia raramente, quindi può durare mesi.",
  "fond.copertura": "Se mancano dati, un criterio vale «non disponibile» e non conta. Ma se ne mancano troppi il titolo non può passare: qui si fissa la quota minima di criteri che devono avere un dato (0,7 = almeno il 70%).",
  "settori.periodoForza": "Un settore è forte se il suo ETF (es. XLK per la tecnologia) ha reso più di SPY in questo numero di sedute: 21 ≈ un mese, 63 ≈ tre mesi, 126 ≈ sei mesi. Più corto = reagisce prima ma sbaglia più spesso.",
  "settori.migliori": "Quanti titoli tenere, per ogni settore forte, tra i migliori in classifica.",
  "settori.maxAcquistabili": "Numero massimo di titoli nella lista degli acquistabili, sommando tutti i settori forti.",
  "settori.minConfronto": "La classifica confronta un titolo con gli altri dello stesso settore e profilo. Se in quel settore sono meno di questo numero, il confronto si fa con tutti i titoli del profilo.",
  "settori.watchlistMaxGiorni": "Se la lista dei titoli (aggiornata il sabato) ha più giorni di questo, il bot non compra e manda un allarme: meglio non comprare che comprare su dati vecchi.",
  "settori.avvisoMinProfilo": "Se un profilo produce meno di questi titoli per due scansioni di fila arriva un avviso: forse le sue soglie sono troppo severe per il mercato di oggi.",
  "segnali.candeleMin": "Quante sedute chiuse servono per calcolare i segnali. La media a 200 sedute ne richiede almeno 200; 300 danno margine.",
  "segnali.smaBreve": "Media mobile breve del prezzo (di solito 20 sedute): mostrata nelle schede, non decide gli ingressi.",
  "segnali.smaMedia": "Media mobile media (50 sedute). Per entrare la chiusura deve stare sopra, e la SMA50 sopra la SMA200: è la definizione di trend crescente. Serve anche al controllo del prezzo al momento dell'acquisto.",
  "segnali.smaLunga": "Media mobile lunga (200 sedute): il trend di fondo.",
  "segnali.atrPeriodo": "Sedute su cui si calcola l'ATR, la «escursione media giornaliera» del titolo. Misura quanto si muove di solito e serve a riconoscere una candela anomala o un gap eccessivo.",
  "segnali.adxPeriodo": "Sedute su cui si calcola l'ADX (forza del trend) e le linee +DI e −DI (direzione), con il metodo di Wilder.",
  "segnali.adxMin": "L'ADX misura quanto è forte un trend, da 0 a 100, senza dire se sale o scende (per quello c'è il confronto +DI > −DI). Sotto 20 di solito il trend non è affidabile. Più alto = meno ingressi ma trend più netti. La review lo può spostare di 2 punti alla volta.",
  "segnali.confermeMin": "Oltre al trend servono conferme di una «rottura»: nuovo massimo a 20 sedute, volume alto, superamento di una resistenza, candela verde lunga. Qui quante ne servono su 4. Più alto = meno ingressi, più selettivi.",
  "segnali.volumeMult": "Il volume della seduta deve essere almeno questo multiplo della media delle 20 sedute prima (1,5 = +50%). Vale come conferma d'ingresso e per l'uscita forte.",
  "segnali.donchianPeriodo": "Il canale di Donchian è il massimo e il minimo delle ultime N sedute. Chiudere sopra il massimo è una conferma d'ingresso; chiudere sotto il minimo con volume alto è un'uscita forte.",
  "segnali.volumeMediaPeriodo": "Sedute su cui si calcola il volume medio usato nelle conferme.",
  "segnali.rsMediaPeriodo": "La forza relativa è il prezzo del titolo diviso SPY: se sale, il titolo batte il mercato. Per entrare deve stare sopra la sua media su questo numero di sedute.",
  "segnali.resistenzaFinestra": "Sedute in cui cercare le resistenze: zone dove il prezzo si è fermato più volte.",
  "segnali.resistenzaBarre": "Ampiezza (in candele) per riconoscere un massimo locale: 5 = più alto delle 2 candele prima e delle 2 dopo.",
  "segnali.resistenzaTolleranza": "Due massimi fanno parte della stessa resistenza se distano meno di questa percentuale.",
  "segnali.rotturaMin": "Di quanto la chiusura deve superare la resistenza perché valga come rottura (evita le rotture «di un centesimo»).",
  "segnali.candelaCorpoAtr": "Una candela è «lunga» se il suo corpo (da apertura a chiusura) è almeno questo multiplo dell'ATR. Verde lunga = conferma d'ingresso; rossa lunga con volume in aumento = uscita debole.",
  "segnali.candelaQuarto": "Per la candela verde lunga la chiusura deve stare nella parte alta della giornata: 0,75 = nel quarto più alto tra minimo e massimo.",
  "segnali.quasiAdx": "Per imparare, il bot registra anche le operazioni «quasi» (non comprate, solo simulate): qui di quanti punti l'ADX può mancare la soglia per contare come «quasi».",
  "rischio.peso": "Quanto del patrimonio va in ogni nuova posizione (0,2 = 20%): con 5 posizioni è tutto investito. Più basso = posizioni più piccole e perdite più piccole. Parametro di sicurezza: la review può solo abbassarlo.",
  "rischio.maxPosizioni": "Numero massimo di titoli tenuti insieme (contano anche gli acquisti in attesa). Mai oltre 5. Parametro di sicurezza: la review può solo abbassarlo.",
  "rischio.maxPerSettore": "Massimo di posizioni nello stesso settore, per non concentrare il rischio. Parametro di sicurezza.",
  "rischio.freno": "Se il patrimonio scende sotto questa quota del suo massimo (0,85 = −15%), il freno blocca ogni nuovo acquisto finché non lo sblocchi tu da qui. Più alto = scatta prima. Parametro di sicurezza: la review può solo alzarlo.",
  "rischio.margineCash": "Si usa al massimo questa quota del cash disponibile per un acquisto (0,99 = 99%), per lasciare spazio allo slittamento del prezzo. Il bot non usa mai il margine.",
  "rischio.sedutePrimaTrimestrale": "Non si entra se l'azienda pubblica i conti (trimestrale) entro questo numero di sedute: il giorno dei conti il prezzo può saltare molto in qualsiasi direzione. Se la data non è verificabile, non si compra.",
  "rischio.gapMaxAtr": "Al momento dell'acquisto il prezzo non deve essersi allontanato dalla chiusura precedente di più di questi ATR: evita di comprare dopo un salto già avvenuto.",
  "rischio.pausaDopoStop": "Dopo uno stop in perdita il titolo non si ricompra per queste sedute: evita di rientrare subito in qualcosa che è appena andato male.",
  "rischio.pausaDopoUscita": "Pausa (in sedute) dopo ogni altra uscita: take profit, stop mobile in utile, uscita manuale.",
  "rischio.rifiutiPerPausa": "Se il broker rifiuta un ordine per lo stesso motivo questo numero di volte, il titolo va in pausa (vedi sotto): mai insistere sullo stesso errore.",
  "rischio.pausaRifiuti": "Sedute di pausa dopo rifiuti ripetuti dello stesso ordine.",
  "rischio.cancellaAcquistoMinuti": "Un acquisto a mercato che dopo questi minuti non è ancora eseguito si cancella e si segnala.",
  "uscita.modalita": "«bracket»: insieme all'acquisto partono uno stop fisso e un take profit fisso. «trailing»: uno stop mobile segue il prezzo massimo raggiunto, senza tetto al guadagno. Il diario simula entrambe su ogni operazione e la review dice quale avrebbe reso di più.",
  "uscita.stopPct": "Bracket: si vende in automatico se il prezzo scende di questa percentuale sotto l'acquisto. È anche l'unità di rischio (1 R) con cui si misurano i risultati. Non protegge dai salti di apertura.",
  "uscita.takeProfitPct": "Bracket: si vende in automatico se il prezzo sale di questa percentuale. Con stop 10% e take profit 20% si guadagna il doppio di quanto si rischia.",
  "uscita.trailingPct": "Trailing: lo stop sta sempre questa percentuale sotto il massimo raggiunto e sale con lui, mai scende.",
  "uscita.protezioneMaxGiorni": "Alpaca cancella da solo gli ordini «gtc» dopo 90 giorni: il bot li ricrea prima, quando superano questi giorni.",
  "uscita.attesaCancellazioneSec": "Per vendere, prima si cancellano gli ordini di protezione e si attende la conferma per questi secondi. Senza conferma non si vende (si rischierebbe una vendita doppia).",
  "uscita.tentativiProtezione": "Tentativi di ricreare una protezione mancante prima di dichiarare la posizione «non protetta» con un allarme.",
  "uscita.attesaEsecuzioneSec": "Modalità trailing: secondi di attesa dell'esecuzione dell'acquisto prima di creare lo stop mobile (se non basta, lo crea la sveglia successiva).",
  "orari.briefing": "Ora (di Roma) della prima sveglia: conto, protezioni, segnali del giorno e piano. Al briefing non si compra e non si vende.",
  "orari.aperturaMinuti": "La sveglia di apertura parte questi minuti dopo l'apertura di Wall Street (di norma 15:40 a Roma): prima le uscite, poi gli ingressi.",
  "orari.metaSeduta": "Ora di New York della sveglia di metà seduta: controlla le protezioni e compra solo se in giornata si è liberato un posto.",
  "orari.chiusuraMinuti": "La sveglia di chiusura parte questi minuti prima della chiusura: resoconto del giorno e operazioni ombra, nessun acquisto.",
  "orari.finestraMinuti": "Una sveglia che parte con più ritardo di così è «saltata»: si segnala e non si recupera, perché il momento giusto è passato.",
  "orari.distanzaMinima": "Se due sveglie cadono più vicine di così (succede nelle mezze giornate) si fa solo la seconda.",
  "orari.scansione": "Ora (di Roma) della scansione dei titoli del sabato.",
  "appr.reviewMinSedute": "La review non si fa prima di queste sedute dall'ultima: con troppo poco tempo si inseguirebbe il rumore.",
  "appr.reviewMaxSedute": "Passate queste sedute la review si fa comunque, anche con poche operazioni.",
  "appr.reviewMinOperazioni": "La review può anticipare (dopo il minimo di sedute) se si sono chiuse almeno queste operazioni reali nuove.",
  "appr.campionePiccolo": "Sotto questo numero di operazioni reali chiuse la review fa solo il resoconto, senza proposte: i numeri non sono ancora affidabili.",
  "appr.minGruppo": "Una modifica si valuta sulle operazioni che cambierebbe (quelle che entrerebbero o uscirebbero): devono essere almeno queste.",
  "appr.effettoMinR": "Miglioramento minimo, in multipli del rischio per operazione, perché una modifica valga la pena (0,1 R = un decimo dello stop).",
  "appr.confidenza": "Quanto deve essere sicuro il test statistico (bootstrap) che il miglioramento non sia zero. Si corregge in automatico per il numero di confronti fatti nella stessa review.",
  "appr.maxProposte": "Massimo di modifiche proposte in una review: poche alla volta, per capire che effetto hanno.",
  "appr.scadenzaGiorni": "Una proposta senza risposta scade dopo questi giorni.",
  "appr.ombraIntervallo": "Un titolo genera al massimo un'operazione ombra (simulata) ogni queste sedute, per non contare dieci volte la stessa occasione.",
  "appr.slittamento": "Nelle simulazioni l'acquisto costa questa percentuale in più dell'apertura, per tenere conto che nella realtà non si compra mai al prezzo perfetto.",
  "appr.bootstrap": "Quante volte si ricampionano i risultati per il test statistico. Più alto = test più stabile ma più lento.",
  "appr.minValoreAtteso": "Il «valore atteso stimato» di una posizione si mostra solo con almeno queste operazioni chiuse; prima è «non stimabile».",
  "appr.sedutePrimaGiudizio": "Dopo queste sedute di attività, se il bot rende meno di SPY la review lo scrive nella prima riga.",
  "appr.simulazioneMaxSedute": "Una simulazione di uscita che resta aperta così a lungo si chiude all'ultima chiusura (motivo «scadenza»).",
  "notifiche.telegram": "Spento = il bot lavora uguale ma non manda messaggi (resta tutto nei log e nella dashboard).",
  "notifiche.posizioniNelResoconto": "Elenco delle posizioni con P&L e livelli nel messaggio di fine sveglia.",
  "ai.modelloDecisioni": "Modello per le sveglie di apertura e metà seduta, dove si decide se comprare o vendere: conviene il più capace (Opus). «predefinito» = il modello predefinito di Claude Code: accanto vedi quale ha usato davvero.",
  "ai.modelloSemplici": "Modello per briefing e chiusura, che scrivono solo piano e resoconto senza ordini: basta un modello più veloce ed economico (Sonnet).",
  "ai.modelloReview": "Modello per la review periodica, che legge le statistiche e sceglie quali proposte presentare.",
  "ai.tettoDecisione": "Spesa stimata massima per una chiamata di decisione. Se la supera, la chiamata si interrompe e conta come errore del cervello: niente acquisti in quella sveglia. Due volte di fila = allarme «tetto troppo basso».",
  "ai.tettoReview": "Come sopra, per la review (che legge più dati e costa di più).",
  "ai.budgetMensile": "Spesa stimata del mese oltre la quale arriva un avviso (all'80% e al 100%). Con l'abbonamento Claude non è un addebito: è il costo equivalente a consumo.",
  "ai.azioneBudget": "Cosa fare se il budget del mese è superato: «solo avviso» oppure «sospendi il cervello» (le protezioni e le uscite continuano, ma niente acquisti fino al mese dopo).",
  "ai.timeoutSec": "Se il cervello non risponde entro questi secondi la chiamata si interrompe: la sveglia continua con protezioni e uscite, senza acquisti.",
  "ai.maxCandidati": "Quanti titoli candidati (già ammessi dal codice) si passano al cervello, in ordine di punteggio.",
  "dashboard.porta": "Porta di questa pagina (http://127.0.0.1:porta). Raggiungibile solo da questo computer. Vale dal prossimo riavvio della dashboard.",
};

const METRICA: Record<string, string> = {
  epsAnnuo: "crescita degli utili per azione (EPS) degli ultimi 12 mesi rispetto ai 12 precedenti",
  ricaviTrim: "crescita dei ricavi dell'ultimo trimestre rispetto allo stesso trimestre dell'anno prima",
  epsTrim: "crescita degli utili per azione dell'ultimo trimestre rispetto allo stesso trimestre dell'anno prima",
  roe: "ROE: utile diviso patrimonio netto, cioè quanto rende il capitale degli azionisti",
  roa: "ROA: utile diviso totale dell'attivo, cioè quanto rendono tutte le risorse dell'azienda",
  debito: "debito totale diviso patrimonio netto: più è alto, più l'azienda è indebitata",
  quick: "quick ratio: attività liquide divise debiti a breve; sopra 1 l'azienda copre i debiti a breve senza vendere magazzino",
  peBanda: "P/E (prezzo diviso utili) di oggi confrontato con la sua media degli ultimi 5 anni, in deviazioni standard: dice se il titolo è caro o a sconto rispetto alla sua storia",
  margine: "margine netto: quanta parte dei ricavi resta come utile",
  ricavi5a: "crescita media annua dei ricavi negli ultimi 5 anni",
  eps5a: "crescita media annua degli utili per azione negli ultimi 5 anni",
  epsProssimo: "crescita attesa degli utili il prossimo anno (stima degli analisti: con Finnhub gratuito non è disponibile)",
  epsProssimi5: "crescita attesa degli utili nei prossimi 5 anni (stima degli analisti: con Finnhub gratuito non è disponibile)",
  pfcf: "prezzo diviso free cash flow per azione: quanti anni di cassa generata si pagano comprando il titolo",
  pe: "P/E: prezzo diviso utili per azione; più è basso, meno si paga ogni dollaro di utile",
  peg: "PEG: il P/E diviso la crescita degli utili; sotto 1–2 la crescita giustifica il prezzo",
  cap: "capitalizzazione di borsa (milioni di $): il valore di tutte le azioni",
  yield: "dividend yield: dividendo annuo diviso prezzo",
  payout: "payout: quota degli utili pagata come dividendo; troppo alta mette a rischio il dividendo",
};

/** Spiegazione di un parametro. Per le soglie fondamentali la compone dal criterio. */
export function spiegazione(chiave: string): string {
  if (P[chiave]) return P[chiave]!;
  const c = CRITERI.find((x) => x.param === chiave || x.paramMax === chiave);
  const def = PARAM_BY_KEY.get(chiave);
  if (c && def) {
    const m = METRICA[c.metrica] ?? c.nome;
    const verso =
      c.tipo === ">" ? "deve stare sopra la soglia: alzarla rende il criterio più severo"
      : c.tipo === "<" ? "deve stare sotto la soglia: abbassarla rende il criterio più severo"
      : c.tipo === "banda" ? "deve stare entro questo numero di deviazioni standard dalla media: un numero più basso è più severo; con utili negativi il criterio non è superato"
      : chiave === c.param ? "deve stare tra il minimo e il massimo: questo è il minimo" : "deve stare tra il minimo e il massimo: questo è il massimo (oltre ~80–100% il dividendo è a rischio)";
    const settori = [c.nonApplicabile?.length ? ` Non si applica a: ${c.nonApplicabile.map((x) => NOME_SETTORE[x]).join(", ")}.` : "", c.nonDisponibileIn?.length ? ` Per ${c.nonDisponibileIn.map((x) => NOME_SETTORE[x]).join(", ")} vale «non disponibile».` : ""].join("");
    return `Profilo ${NOME_PROFILO[c.profilo]}. Cosa misura: ${m}. Il valore ${verso}.${settori} Se il dato manca vale «non disponibile» e non conta. La review può spostarla di un passo (${def.passo !== undefined ? String(def.passo).replace(".", ",") : "—"}).`;
  }
  return def?.descrizione ?? "";
}
