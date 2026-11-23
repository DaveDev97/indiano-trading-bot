// Definizione di tutti i parametri: valore iniziale, passo, intervallo, categoria (Contratto §4, §7.4, §8.7, §10).
// I valori ATTIVI stanno in state/params.json: la logica legge solo quelli.

export type Valore = number | string | boolean;
export type Categoria = "strategia" | "sicurezza" | "altro";
export type Gruppo =
  | "universo"
  | "profili"
  | "settori"
  | "segnali"
  | "rischio"
  | "uscite"
  | "orari"
  | "apprendimento"
  | "notifiche"
  | "ai"
  | "dashboard";

export const GRUPPI: { id: Gruppo; nome: string }[] = [
  { id: "universo", nome: "Universo" },
  { id: "profili", nome: "Profili fondamentali" },
  { id: "settori", nome: "Settori e watchlist" },
  { id: "segnali", nome: "Segnali tecnici" },
  { id: "rischio", nome: "Rischio" },
  { id: "uscite", nome: "Uscite" },
  { id: "orari", nome: "Orari" },
  { id: "apprendimento", nome: "Apprendimento" },
  { id: "notifiche", nome: "Notifiche" },
  { id: "ai", nome: "AI" },
  { id: "dashboard", nome: "Dashboard" },
];

export interface ParamDef {
  chiave: string;
  gruppo: Gruppo;
  descrizione: string;
  tipo: "numero" | "intero" | "scelta" | "booleano" | "ora";
  iniziale: Valore;
  min?: number;
  max?: number;
  passo?: number;
  opzioni?: (string | number)[];
  categoria: Categoria;
  /** Solo per i parametri di sicurezza: direzione in cui la review può muoverli. */
  direzioneSicura?: "giu" | "su";
  unita?: string;
  /** Come la review valuta il parametro (solo strategia). */
  valutazione?:
    | "filtro-adx"
    | "filtro-conferme"
    | "filtro-volume"
    | "filtro-donchian"
    | "uscita-stop"
    | "uscita-tp"
    | "uscita-trailing"
    | "uscita-modalita"
    | "settori-periodo"
    | "filtro-fondamentale";
}

const defs: ParamDef[] = [];
const add = (d: ParamDef) => defs.push(d);

// ---------- Universo (§4.1) ----------
add({ chiave: "universo.prezzoMin", gruppo: "universo", descrizione: "Prezzo minimo del titolo", tipo: "numero", iniziale: 5, min: 1, max: 50, passo: 1, categoria: "altro", unita: "$" });
add({ chiave: "universo.controvaloreMin", gruppo: "universo", descrizione: "Controvalore medio scambiato a 20 sedute, minimo", tipo: "numero", iniziale: 20_000_000, min: 1_000_000, max: 500_000_000, passo: 1_000_000, categoria: "altro", unita: "$" });
add({ chiave: "universo.capitalizzazione", gruppo: "universo", descrizione: "Intervallo di capitalizzazione: tutte (> 300 mln), large (> 10 mld), mid-small (300 mln–10 mld)", tipo: "scelta", iniziale: "tutte", opzioni: ["tutte", "large", "mid-small"], categoria: "altro" });
add({ chiave: "universo.cacheMetricheGiorni", gruppo: "universo", descrizione: "Validità della cache delle metriche Finnhub", tipo: "intero", iniziale: 7, min: 1, max: 30, passo: 1, categoria: "altro", unita: "giorni" });
add({ chiave: "universo.cacheProfiloGiorni", gruppo: "universo", descrizione: "Validità della cache del profilo Finnhub", tipo: "intero", iniziale: 90, min: 7, max: 365, passo: 1, categoria: "altro", unita: "giorni" });

// ---------- Profili fondamentali (§4.3) ----------
/** Soglia "> x" o "< x" con x ≠ 0: passo ±10% di x, intervallo ±50% del valore iniziale. Soglia 0: passo 5 punti, da −10 a +20. */
function soglia(chiave: string, descrizione: string, iniziale: number, unita?: string, decimali = 2): void {
  if (iniziale === 0) {
    add({ chiave, gruppo: "profili", descrizione, tipo: "numero", iniziale, min: -10, max: 20, passo: 5, categoria: "strategia", unita, valutazione: "filtro-fondamentale" });
    return;
  }
  const r = (v: number) => Number(v.toFixed(decimali));
  add({ chiave, gruppo: "profili", descrizione, tipo: "numero", iniziale, min: r(iniziale * 0.5), max: r(iniziale * 1.5), passo: r(Math.abs(iniziale) * 0.1), categoria: "strategia", unita, valutazione: "filtro-fondamentale" });
}
soglia("fond.growth.epsAnnuo.min", "Growth: crescita EPS anno su anno, minimo", 0, "%");
soglia("fond.growth.ricaviTrim.min", "Growth: ricavi trimestre vs stesso trimestre anno prima, minimo", 20, "%");
soglia("fond.growth.epsTrim.min", "Growth: EPS trimestre vs stesso trimestre anno prima, minimo", 0, "%");
soglia("fond.growth.roe.min", "Growth: ROE minimo", 15, "%");
soglia("fond.growth.roa.min", "Growth: ROA minimo", 10, "%");
soglia("fond.growth.debito.max", "Growth: debito/patrimonio massimo", 0.4, "rapporto", 3);
soglia("fond.growth.quick.min", "Growth: quick ratio minimo", 1, "rapporto");
soglia("fond.growth.peBanda", "Growth: P/E entro quante deviazioni standard dalla media a 5 anni", 1, "dev. std");
soglia("fond.value.roe.min", "Value: ROE minimo", 15, "%");
soglia("fond.value.margine.min", "Value: margine netto minimo", 20, "%");
soglia("fond.value.ricavi5a.min", "Value: crescita ricavi 5 anni, minimo", 5, "%");
soglia("fond.value.eps5a.min", "Value: crescita EPS 5 anni, minimo", 5, "%");
soglia("fond.value.epsProssimo.min", "Value: crescita EPS prossimo anno (stima analisti), minimo", 0, "%");
soglia("fond.value.epsProssimi5.min", "Value: crescita EPS prossimi 5 anni (stima analisti), minimo", 5, "%");
soglia("fond.value.pfcf.max", "Value: prezzo/free cash flow massimo", 30, "rapporto");
soglia("fond.value.pe.max", "Value: P/E massimo", 30, "rapporto");
soglia("fond.value.peg.max", "Value: PEG massimo", 2, "rapporto");
soglia("fond.value.quick.min", "Value: quick ratio minimo", 1, "rapporto");
soglia("fond.div.cap.min", "Dividendo: capitalizzazione minima (Finnhub, milioni di $)", 2000, "mln $", 0);
soglia("fond.div.yield.min", "Dividendo: dividend yield minimo", 3, "%");
soglia("fond.div.payout.min", "Dividendo: payout ratio minimo", 40, "%");
soglia("fond.div.payout.max", "Dividendo: payout ratio massimo", 75, "%");
soglia("fond.div.quick.min", "Dividendo: quick ratio minimo", 0.5, "rapporto", 3);
soglia("fond.div.roe.min", "Dividendo: ROE minimo", 15, "%");
soglia("fond.div.margine.min", "Dividendo: margine netto minimo", 15, "%");
add({ chiave: "fond.copertura", gruppo: "profili", descrizione: "Quota minima di criteri valutabili per profilo (sui criteri applicabili, arrotondando per eccesso)", tipo: "numero", iniziale: 0.7, min: 0.5, max: 1, passo: 0.05, categoria: "altro" });

// ---------- Settori e watchlist (§4.2, §4.4) ----------
add({ chiave: "settori.periodoForza", gruppo: "settori", descrizione: "Sedute su cui si misura la forza del settore rispetto a SPY", tipo: "scelta", iniziale: 63, opzioni: [21, 63, 126], categoria: "strategia", unita: "sedute", valutazione: "settori-periodo" });
add({ chiave: "settori.migliori", gruppo: "settori", descrizione: "Titoli acquistabili tenuti per ogni settore forte", tipo: "intero", iniziale: 3, min: 1, max: 5, passo: 1, categoria: "altro" });
add({ chiave: "settori.maxAcquistabili", gruppo: "settori", descrizione: "Numero massimo di titoli acquistabili", tipo: "intero", iniziale: 30, min: 5, max: 50, passo: 1, categoria: "altro" });
add({ chiave: "settori.minConfronto", gruppo: "settori", descrizione: "Sotto questo numero di titoli nel settore, i percentili si calcolano su tutto il profilo", tipo: "intero", iniziale: 5, min: 2, max: 20, passo: 1, categoria: "altro" });
add({ chiave: "settori.watchlistMaxGiorni", gruppo: "settori", descrizione: "Età massima della watchlist per comprare", tipo: "intero", iniziale: 8, min: 1, max: 14, passo: 1, categoria: "altro", unita: "giorni" });
add({ chiave: "settori.avvisoMinProfilo", gruppo: "settori", descrizione: "Avviso se un profilo produce meno di questi titoli per due scansioni di fila", tipo: "intero", iniziale: 5, min: 1, max: 20, passo: 1, categoria: "altro" });

// ---------- Segnali tecnici (§4.5) ----------
add({ chiave: "segnali.candeleMin", gruppo: "segnali", descrizione: "Sedute chiuse minime per calcolare i segnali", tipo: "intero", iniziale: 300, min: 250, max: 500, passo: 10, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.smaBreve", gruppo: "segnali", descrizione: "Media mobile breve", tipo: "intero", iniziale: 20, min: 5, max: 50, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.smaMedia", gruppo: "segnali", descrizione: "Media mobile media (trend e controllo prezzo)", tipo: "intero", iniziale: 50, min: 20, max: 100, passo: 5, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.smaLunga", gruppo: "segnali", descrizione: "Media mobile lunga", tipo: "intero", iniziale: 200, min: 100, max: 250, passo: 10, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.atrPeriodo", gruppo: "segnali", descrizione: "Periodo ATR (Wilder)", tipo: "intero", iniziale: 14, min: 5, max: 30, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.adxPeriodo", gruppo: "segnali", descrizione: "Periodo ADX e DI (Wilder)", tipo: "intero", iniziale: 14, min: 5, max: 30, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.adxMin", gruppo: "segnali", descrizione: "ADX minimo per entrare", tipo: "numero", iniziale: 20, min: 15, max: 30, passo: 2, categoria: "strategia", valutazione: "filtro-adx" });
add({ chiave: "segnali.confermeMin", gruppo: "segnali", descrizione: "Conferme minime su 4 (Donchian, volume, resistenza, candela)", tipo: "intero", iniziale: 2, min: 1, max: 4, passo: 1, categoria: "strategia", valutazione: "filtro-conferme" });
add({ chiave: "segnali.volumeMult", gruppo: "segnali", descrizione: "Moltiplicatore del volume rispetto alla media (conferma e uscita forte)", tipo: "numero", iniziale: 1.5, min: 1, max: 2.5, passo: 0.25, categoria: "strategia", valutazione: "filtro-volume" });
add({ chiave: "segnali.donchianPeriodo", gruppo: "segnali", descrizione: "Periodo del canale di Donchian", tipo: "intero", iniziale: 20, min: 10, max: 55, passo: 5, categoria: "strategia", unita: "sedute", valutazione: "filtro-donchian" });
add({ chiave: "segnali.volumeMediaPeriodo", gruppo: "segnali", descrizione: "Periodo della media del volume", tipo: "intero", iniziale: 20, min: 10, max: 50, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.rsMediaPeriodo", gruppo: "segnali", descrizione: "Periodo della media della linea di forza relativa", tipo: "intero", iniziale: 50, min: 20, max: 100, passo: 5, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.resistenzaFinestra", gruppo: "segnali", descrizione: "Sedute in cui cercare i massimi locali per le resistenze", tipo: "intero", iniziale: 120, min: 60, max: 250, passo: 10, categoria: "altro", unita: "sedute" });
add({ chiave: "segnali.resistenzaBarre", gruppo: "segnali", descrizione: "Barre della finestra del massimo locale (dispari)", tipo: "scelta", iniziale: 5, opzioni: [3, 5, 7, 9], categoria: "altro" });
add({ chiave: "segnali.resistenzaTolleranza", gruppo: "segnali", descrizione: "Distanza massima tra massimi dello stesso gruppo", tipo: "numero", iniziale: 1.5, min: 0.5, max: 5, passo: 0.25, categoria: "altro", unita: "%" });
add({ chiave: "segnali.rotturaMin", gruppo: "segnali", descrizione: "Superamento minimo della resistenza per una rottura", tipo: "numero", iniziale: 0.5, min: 0, max: 3, passo: 0.25, categoria: "altro", unita: "%" });
add({ chiave: "segnali.candelaCorpoAtr", gruppo: "segnali", descrizione: "Corpo minimo della candela lunga, in multipli di ATR", tipo: "numero", iniziale: 1.5, min: 0.5, max: 3, passo: 0.25, categoria: "altro", unita: "ATR" });
add({ chiave: "segnali.candelaQuarto", gruppo: "segnali", descrizione: "Posizione minima della chiusura nel range per la candela verde (0,75 = quarto più alto)", tipo: "numero", iniziale: 0.75, min: 0.5, max: 0.95, passo: 0.05, categoria: "altro" });
add({ chiave: "segnali.quasiAdx", gruppo: "segnali", descrizione: "Margine ADX sotto la soglia per le operazioni ombra \"quasi\"", tipo: "numero", iniziale: 3, min: 1, max: 6, passo: 1, categoria: "altro" });

// ---------- Rischio (§4.6, §7.4) ----------
add({ chiave: "rischio.peso", gruppo: "rischio", descrizione: "Peso per posizione sul patrimonio", tipo: "numero", iniziale: 0.2, min: 0.05, max: 0.2, passo: 0.01, categoria: "sicurezza", direzioneSicura: "giu", unita: "frazione" });
add({ chiave: "rischio.maxPosizioni", gruppo: "rischio", descrizione: "Numero massimo di posizioni (mai oltre 5)", tipo: "intero", iniziale: 5, min: 1, max: 5, passo: 1, categoria: "sicurezza", direzioneSicura: "giu" });
add({ chiave: "rischio.maxPerSettore", gruppo: "rischio", descrizione: "Posizioni massime nello stesso settore", tipo: "intero", iniziale: 2, min: 1, max: 2, passo: 1, categoria: "sicurezza", direzioneSicura: "giu" });
add({ chiave: "rischio.freno", gruppo: "rischio", descrizione: "Freno d'emergenza: scatta sotto questa frazione del massimo del patrimonio", tipo: "numero", iniziale: 0.85, min: 0.75, max: 0.95, passo: 0.01, categoria: "sicurezza", direzioneSicura: "su", unita: "frazione" });
add({ chiave: "rischio.margineCash", gruppo: "rischio", descrizione: "Quota del cash disponibile utilizzabile per un acquisto", tipo: "numero", iniziale: 0.99, min: 0.9, max: 0.99, passo: 0.01, categoria: "altro" });
add({ chiave: "rischio.sedutePrimaTrimestrale", gruppo: "rischio", descrizione: "Niente ingressi se la trimestrale cade entro questi giorni di borsa", tipo: "intero", iniziale: 5, min: 1, max: 15, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "rischio.gapMaxAtr", gruppo: "rischio", descrizione: "Scostamento massimo dalla chiusura precedente al momento dell'acquisto", tipo: "numero", iniziale: 1, min: 0.25, max: 3, passo: 0.25, categoria: "altro", unita: "ATR" });
add({ chiave: "rischio.pausaDopoStop", gruppo: "rischio", descrizione: "Sedute di pausa dopo uno stop in perdita", tipo: "intero", iniziale: 10, min: 1, max: 30, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "rischio.pausaDopoUscita", gruppo: "rischio", descrizione: "Sedute di pausa dopo ogni altra uscita", tipo: "intero", iniziale: 3, min: 0, max: 30, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "rischio.rifiutiPerPausa", gruppo: "rischio", descrizione: "Rifiuti per lo stesso motivo che fanno scattare la pausa", tipo: "intero", iniziale: 2, min: 1, max: 5, passo: 1, categoria: "altro" });
add({ chiave: "rischio.pausaRifiuti", gruppo: "rischio", descrizione: "Sedute di pausa dopo rifiuti ripetuti", tipo: "intero", iniziale: 5, min: 1, max: 20, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "rischio.cancellaAcquistoMinuti", gruppo: "rischio", descrizione: "Un acquisto a mercato ancora aperto dopo questi minuti si cancella", tipo: "intero", iniziale: 30, min: 5, max: 120, passo: 5, categoria: "altro", unita: "minuti" });

// ---------- Uscite (§4.6) ----------
add({ chiave: "uscita.modalita", gruppo: "uscite", descrizione: "Modalità di uscita delle nuove posizioni", tipo: "scelta", iniziale: "bracket", opzioni: ["bracket", "trailing"], categoria: "strategia", valutazione: "uscita-modalita" });
add({ chiave: "uscita.stopPct", gruppo: "uscite", descrizione: "Stop sotto il prezzo di ingresso (bracket)", tipo: "numero", iniziale: 10, min: 6, max: 20, passo: 2, categoria: "strategia", unita: "%", valutazione: "uscita-stop" });
add({ chiave: "uscita.takeProfitPct", gruppo: "uscite", descrizione: "Take profit sopra il prezzo di ingresso (bracket)", tipo: "numero", iniziale: 20, min: 10, max: 40, passo: 5, categoria: "strategia", unita: "%", valutazione: "uscita-tp" });
add({ chiave: "uscita.trailingPct", gruppo: "uscite", descrizione: "Stop mobile sotto il massimo raggiunto (trailing)", tipo: "numero", iniziale: 10, min: 6, max: 20, passo: 2, categoria: "strategia", unita: "%", valutazione: "uscita-trailing" });
add({ chiave: "uscita.protezioneMaxGiorni", gruppo: "uscite", descrizione: "Età oltre la quale una protezione gtc si ricrea (Alpaca le cancella a 90 giorni)", tipo: "intero", iniziale: 80, min: 30, max: 85, passo: 1, categoria: "altro", unita: "giorni" });
add({ chiave: "uscita.attesaCancellazioneSec", gruppo: "uscite", descrizione: "Attesa massima della conferma di cancellazione prima di vendere", tipo: "intero", iniziale: 10, min: 5, max: 30, passo: 1, categoria: "altro", unita: "secondi" });
add({ chiave: "uscita.tentativiProtezione", gruppo: "uscite", descrizione: "Tentativi di ricreare una protezione", tipo: "intero", iniziale: 3, min: 1, max: 3, passo: 1, categoria: "altro" });
add({ chiave: "uscita.attesaEsecuzioneSec", gruppo: "uscite", descrizione: "Attesa massima dell'esecuzione dell'acquisto prima dello stop mobile", tipo: "intero", iniziale: 30, min: 5, max: 60, passo: 5, categoria: "altro", unita: "secondi" });

// ---------- Orari (§5) ----------
add({ chiave: "orari.briefing", gruppo: "orari", descrizione: "Ora del briefing (ora di Roma)", tipo: "ora", iniziale: "09:30", categoria: "altro" });
add({ chiave: "orari.aperturaMinuti", gruppo: "orari", descrizione: "Sveglia di apertura: minuti dopo l'apertura", tipo: "intero", iniziale: 10, min: 5, max: 60, passo: 5, categoria: "altro", unita: "minuti" });
add({ chiave: "orari.metaSeduta", gruppo: "orari", descrizione: "Sveglia di metà seduta (ora di New York)", tipo: "ora", iniziale: "12:30", categoria: "altro" });
add({ chiave: "orari.chiusuraMinuti", gruppo: "orari", descrizione: "Sveglia di chiusura: minuti prima della chiusura", tipo: "intero", iniziale: 30, min: 15, max: 60, passo: 5, categoria: "altro", unita: "minuti" });
add({ chiave: "orari.finestraMinuti", gruppo: "orari", descrizione: "Ritardo massimo di una sveglia prima di considerarla saltata", tipo: "intero", iniziale: 20, min: 5, max: 60, passo: 5, categoria: "altro", unita: "minuti" });
add({ chiave: "orari.distanzaMinima", gruppo: "orari", descrizione: "Due sveglie più vicine di così: si esegue solo la seconda", tipo: "intero", iniziale: 30, min: 10, max: 60, passo: 5, categoria: "altro", unita: "minuti" });
add({ chiave: "orari.scansione", gruppo: "orari", descrizione: "Ora della scansione del sabato (ora di Roma)", tipo: "ora", iniziale: "10:00", categoria: "altro" });

// ---------- Apprendimento (§7) ----------
add({ chiave: "appr.reviewMinSedute", gruppo: "apprendimento", descrizione: "Sedute minime tra due review", tipo: "intero", iniziale: 20, min: 10, max: 60, passo: 5, categoria: "altro", unita: "sedute" });
add({ chiave: "appr.reviewMaxSedute", gruppo: "apprendimento", descrizione: "Sedute dopo le quali la review si fa comunque", tipo: "intero", iniziale: 40, min: 20, max: 120, passo: 5, categoria: "altro", unita: "sedute" });
add({ chiave: "appr.reviewMinOperazioni", gruppo: "apprendimento", descrizione: "Operazioni reali nuove chiuse per anticipare la review", tipo: "intero", iniziale: 15, min: 5, max: 60, passo: 5, categoria: "altro" });
add({ chiave: "appr.campionePiccolo", gruppo: "apprendimento", descrizione: "Sotto questo numero di operazioni reali chiuse: solo resoconto, nessuna proposta", tipo: "intero", iniziale: 30, min: 30, max: 200, passo: 10, categoria: "altro" });
add({ chiave: "appr.minGruppo", gruppo: "apprendimento", descrizione: "Operazioni minime (reali + ombra) nel gruppo della differenza", tipo: "intero", iniziale: 30, min: 30, max: 200, passo: 10, categoria: "altro" });
add({ chiave: "appr.effettoMinR", gruppo: "apprendimento", descrizione: "Effetto minimo per proporre una modifica", tipo: "numero", iniziale: 0.1, min: 0.1, max: 1, passo: 0.05, categoria: "altro", unita: "R" });
add({ chiave: "appr.confidenza", gruppo: "apprendimento", descrizione: "Confidenza dell'intervallo bootstrap (prima della correzione di Bonferroni)", tipo: "numero", iniziale: 0.9, min: 0.9, max: 0.99, passo: 0.01, categoria: "altro" });
add({ chiave: "appr.maxProposte", gruppo: "apprendimento", descrizione: "Proposte massime per review", tipo: "intero", iniziale: 2, min: 0, max: 2, passo: 1, categoria: "altro" });
add({ chiave: "appr.scadenzaGiorni", gruppo: "apprendimento", descrizione: "Una proposta senza risposta scade dopo", tipo: "intero", iniziale: 7, min: 1, max: 30, passo: 1, categoria: "altro", unita: "giorni" });
add({ chiave: "appr.ombraIntervallo", gruppo: "apprendimento", descrizione: "Sedute minime tra due operazioni ombra dello stesso titolo", tipo: "intero", iniziale: 10, min: 1, max: 30, passo: 1, categoria: "altro", unita: "sedute" });
add({ chiave: "appr.slittamento", gruppo: "apprendimento", descrizione: "Slittamento dell'ingresso simulato", tipo: "numero", iniziale: 0.1, min: 0, max: 1, passo: 0.05, categoria: "altro", unita: "%" });
add({ chiave: "appr.bootstrap", gruppo: "apprendimento", descrizione: "Ricampionamenti bootstrap", tipo: "intero", iniziale: 2000, min: 500, max: 20000, passo: 500, categoria: "altro" });
add({ chiave: "appr.minValoreAtteso", gruppo: "apprendimento", descrizione: "Operazioni chiuse minime per mostrare il valore atteso stimato", tipo: "intero", iniziale: 20, min: 20, max: 200, passo: 5, categoria: "altro" });
add({ chiave: "appr.sedutePrimaGiudizio", gruppo: "apprendimento", descrizione: "Sedute di attività dopo le quali la review dice in prima riga se il bot rende meno di SPY", tipo: "intero", iniziale: 60, min: 20, max: 250, passo: 5, categoria: "altro", unita: "sedute" });
add({ chiave: "appr.simulazioneMaxSedute", gruppo: "apprendimento", descrizione: "Durata massima di una simulazione di uscita", tipo: "intero", iniziale: 250, min: 60, max: 500, passo: 10, categoria: "altro", unita: "sedute" });

// ---------- Notifiche (§9) ----------
add({ chiave: "notifiche.telegram", gruppo: "notifiche", descrizione: "Invia i messaggi su Telegram", tipo: "booleano", iniziale: true, categoria: "altro" });
add({ chiave: "notifiche.posizioniNelResoconto", gruppo: "notifiche", descrizione: "Mostra le posizioni nel messaggio di fine sveglia", tipo: "booleano", iniziale: true, categoria: "altro" });

// ---------- AI (§8.7) ----------
/** Modelli che si possono scegliere (--model). "predefinito" = quello di Claude Code: la dashboard mostra quale ha usato davvero. */
export const MODELLI_AI = ["predefinito", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"];
add({ chiave: "ai.modelloDecisioni", gruppo: "ai", descrizione: "Modello per le decisioni complesse: sveglie di apertura e metà seduta, dove si comprano e vendono titoli", tipo: "scelta", iniziale: "claude-opus-5-5", opzioni: MODELLI_AI, categoria: "altro" });
add({ chiave: "ai.modelloSemplici", gruppo: "ai", descrizione: "Modello per i compiti semplici: briefing e chiusura (piano e resoconto, nessun ordine)", tipo: "scelta", iniziale: "claude-sonnet-5-5", opzioni: MODELLI_AI, categoria: "altro" });
add({ chiave: "ai.modelloReview", gruppo: "ai", descrizione: "Modello per la review periodica (analisi dei risultati e proposte)", tipo: "scelta", iniziale: "claude-opus-5-5", opzioni: MODELLI_AI, categoria: "altro" });
add({ chiave: "ai.tettoDecisione", gruppo: "ai", descrizione: "Tetto di spesa stimata per una chiamata di decisione (--max-budget-usd)", tipo: "numero", iniziale: 1, min: 0.05, max: 10, passo: 0.05, categoria: "altro", unita: "$" });
add({ chiave: "ai.tettoReview", gruppo: "ai", descrizione: "Tetto di spesa stimata per una chiamata di review (--max-budget-usd)", tipo: "numero", iniziale: 3, min: 0.1, max: 20, passo: 0.1, categoria: "altro", unita: "$" });
add({ chiave: "ai.budgetMensile", gruppo: "ai", descrizione: "Budget mensile stimato", tipo: "numero", iniziale: 30, min: 1, max: 1000, passo: 1, categoria: "altro", unita: "$" });
add({ chiave: "ai.azioneBudget", gruppo: "ai", descrizione: "Al superamento del budget mensile", tipo: "scelta", iniziale: "solo avviso", opzioni: ["solo avviso", "sospendi il cervello"], categoria: "altro" });
add({ chiave: "ai.timeoutSec", gruppo: "ai", descrizione: "Tempo massimo di una chiamata al cervello", tipo: "intero", iniziale: 180, min: 30, max: 600, passo: 10, categoria: "altro", unita: "secondi" });
add({ chiave: "ai.maxCandidati", gruppo: "ai", descrizione: "Candidati ammessi passati al cervello", tipo: "intero", iniziale: 10, min: 1, max: 10, passo: 1, categoria: "altro" });

// ---------- Dashboard (§8) ----------
add({ chiave: "dashboard.porta", gruppo: "dashboard", descrizione: "Porta della dashboard (solo 127.0.0.1)", tipo: "intero", iniziale: 8787, min: 1024, max: 65535, passo: 1, categoria: "altro" });

export const PARAM_DEFS: readonly ParamDef[] = defs;
export const PARAM_BY_KEY: ReadonlyMap<string, ParamDef> = new Map(defs.map((d) => [d.chiave, d]));

export function valoriIniziali(): Record<string, Valore> {
  const out: Record<string, Valore> = {};
  for (const d of defs) out[d.chiave] = d.iniziale;
  return out;
}

/** Valida un valore. Restituisce null se va bene, altrimenti il messaggio in italiano. */
export function validaValore(def: ParamDef, v: unknown): string | null {
  switch (def.tipo) {
    case "booleano":
      return typeof v === "boolean" ? null : `${def.descrizione}: deve essere sì o no`;
    case "ora":
      return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : `${def.descrizione}: formato HH:MM`;
    case "scelta":
      return def.opzioni!.some((o) => o === v) ? null : `${def.descrizione}: valore non ammesso (${def.opzioni!.join(", ")})`;
    case "intero":
    case "numero": {
      if (typeof v !== "number" || !Number.isFinite(v)) return `${def.descrizione}: deve essere un numero`;
      if (def.tipo === "intero" && !Number.isInteger(v)) return `${def.descrizione}: deve essere un numero intero`;
      const eps = 1e-9;
      if (def.min !== undefined && v < def.min - eps) return `${def.descrizione}: ${v} è sotto il minimo ${def.min}`;
      if (def.max !== undefined && v > def.max + eps) return `${def.descrizione}: ${v} è sopra il massimo ${def.max}`;
      return null;
    }
  }
}
