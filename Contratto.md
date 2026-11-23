# Contratto — Indiano Trading Bot

Questo file dice **cosa** deve fare il bot: requisiti, regole, criteri, test di accettazione.
**Come** lavorare (strumenti, processo, note tecniche verificate, auto-review) è in `CLAUDE.md`.
Se i due file sembrano in contraddizione vince questo, e la contraddizione va segnalata.
Il documento originale dei criteri è in `docs/criteri-originali.docx`; qui è già tradotto in regole.

---

## 1. Obiettivo

Un bot che fa **paper trading da solo** su azioni USA, senza nessuno davanti allo schermo:

- tiene **al massimo 5 posizioni aperte**, che possono restare aperte per giorni o settimane;
- quando un posto si libera, **sceglie la prossima azione** tra quelle che passano i criteri
  fondamentali e tecnici (sezione 4);
- si sveglia 4 volte al giorno, decide, esegue, mi aggiorna su Telegram;
- **tiene un diario** di tutto quello che vede, decide e ottiene, e periodicamente **propone di
  aggiustare i propri parametri** in base ai risultati, chiedendomi conferma (sezione 7);
- ha una **dashboard web** per vedere portafoglio e posizioni, intervenire a mano e cambiare i
  parametri (sezione 8).

## 2. Principi

1. **Dire sempre la verità.** Su cosa ha fatto, su quali dati ha usato (e quanto erano vecchi), su
   cosa si è rotto, e su **se sta guadagnando o no rispetto a comprare e tenere SPY**. Un dato
   mancante si dichiara "non disponibile", mai si inventa o si considera superato in silenzio.
2. **Non sbagliare mai due volte la stessa cosa.** Mai lo stesso ordine due volte. Un ordine
   rifiutato non si ripropone nella stessa seduta; dopo 2 rifiuti per lo stesso motivo resta in
   pausa per 5 sedute (6.10). Mai ricomprare subito ciò che è appena andato in stop.
3. **Il modello propone, il codice dispone.** Il codice seleziona i titoli, calcola indicatori,
   quantità e statistiche, applica la gabbia. Il modello (Claude) sceglie solo tra opzioni già
   ammesse e spiega il perché in italiano.
4. **Nessuna modifica dei parametri senza la mia conferma.**

## 3. Vincoli non negoziabili 🔒

Valgono sempre. Non sono parametri: non compaiono nelle impostazioni e nessuna review li può cambiare.

1. **Solo paper trading.** L'endpoint di trading è la costante `https://paper-api.alpaca.markets`.
   Il programma si rifiuta di partire se trova un altro URL di trading in `secrets.ts` o
   nell'ambiente, oppure se la chiave Alpaca inizia con `AK` (prefisso delle chiavi live).
2. **Niente short, niente leva, niente opzioni, solo azioni intere.** Si spende solo `cash`, mai il
   `buying_power` (che include il margine).
   - Il conto paper è un conto a margine con lo short abilitato. All'avvio il bot imposta
     `PATCH /v2/account/configurations` con `no_shorting: true` e `max_margin_multiplier: "1"`, poi
     rilegge la configurazione.
   - Se le impostazioni non risultano applicate, **non parte**.
   - Una vendita non supera mai la quantità realmente posseduta in quel momento.
3. **Massimo 5 posizioni.** Il parametro può scendere sotto 5, mai salire sopra.
4. **Mai due volte lo stesso ordine**, anche se la sveglia muore a metà o viene lanciata due volte,
   anche in contemporanea, anche con un doppio clic dalla dashboard.
5. **Le chiavi non si vedono mai**: non finiscono nei log, nei messaggi, nella dashboard o a schermo.
6. **Ogni posizione ha sempre un ordine di protezione sul broker** per l'intera quantità
   (sezione 4.6).
7. **La dashboard è raggiungibile solo dal computer stesso** (`127.0.0.1`) e richiede una password.

---

## 4. Strategia

Ogni soglia di questa sezione è un **parametro** (sezione 10). I valori indicati sono quelli iniziali.

### 4.1 Universo (scansione settimanale)

La scansione gira **il sabato alle 10:00 ora di Roma** e a richiesta (`bun run scan`). È lenta
(Finnhub gratuito: max 50 richieste/minuto) e deve **riprendere da dove si è interrotta** grazie alla
cache (metriche valide 7 giorni, profilo 90 giorni).

Un titolo entra nell'universo se:
- è un'azione USA attiva e negoziabile su Alpaca, quotata su NYSE o NASDAQ;
- prezzo ≥ 5 $;
- controvalore medio scambiato negli ultimi 20 giorni ≥ 20 milioni $;
- capitalizzazione nell'intervallo scelto: `"tutte"` (> 300 milioni, valore iniziale), `"large"`
  (> 10 miliardi) o `"mid-small"` (da 300 milioni a 10 miliardi);
- non è un ETF e Finnhub restituisce metriche non vuote.

### 4.2 Forza dei settori

| Settore | ETF | Settore | ETF |
|---|---|---|---|
| Financial | XLF | Communication Services | XLC |
| Technology | XLK | Basic Materials | XLB |
| Healthcare | XLV | Energy | XLE |
| Utilities | XLU | Industrials | XLI |
| Real Estate | XLRE | Consumer Cyclical | XLY |
| | | Consumer Defensive | XLP |

- Finnhub non usa questi 11 settori: `finnhubIndustry` ha decine di industrie ("Banking",
  "Semiconductors", "Retail"…).
  - La mappa industria → settore sta in `src/config/settori.ts` ed è costruita sui valori visti
    davvero dalla sonda.
  - Le industrie ambigue (ad esempio "Retail", che può essere ciclico o difensivo) vanno decise in
    `docs/decisioni.md`.
  - Un'industria non mappata esclude il titolo, e l'esclusione va nel resoconto.
- Un settore è **forte** se il suo ETF ha battuto SPY nelle ultime 63 sedute (circa 3 mesi).
- **Si comprano solo titoli di settori forti.** Se nessun settore è forte non entra niente di nuovo,
  e il resoconto lo dice.

### 4.3 Profili fondamentali

Un titolo passa se soddisfa **tutti i criteri valutabili** di almeno un profilo.

**Dati mancanti:** un criterio senza dato vale "non disponibile" e non conta.
- Se un profilo ha meno del 70% dei criteri valutabili, il titolo **non** passa quel profilo.
- Il 70% si calcola sui criteri **applicabili** a quel settore, arrotondando per eccesso.
- I criteri non disponibili compaiono sempre nei resoconti.

**Unità di misura:** la sonda registra l'unità di ogni campo. Ad esempio Finnhub dà la
capitalizzazione in milioni e molte percentuali come numeri (15 = 15%). Le soglie si confrontano
nella stessa unità.

**Settori dove un criterio non ha senso** (non si applica, non conta come mancante):
- debito/patrimonio: non si applica a Financial, Real Estate, Utilities;
- quick ratio: non si applica a Financial (e Real Estate nel profilo dividendo);
- payout ratio: per Real Estate vale "non disponibile" (i REIT si valutano sull'FFO, che non abbiamo).

| Profilo | Criterio | Soglia iniziale | Nota |
|---|---|---|---|
| **Growth** | EPS anno su anno | > 0 | |
| | Ricavi trimestre vs stesso trimestre anno prima | > 20% | |
| | EPS trimestre vs stesso trimestre anno prima | > 0 | |
| | ROE | > 15% | |
| | ROA | > 10% | Nel documento 15%: esclude quasi tutto il mercato |
| | Debito/patrimonio | < 0,4 | |
| | Quick ratio | > 1 | |
| | P/E rispetto alla sua media a 5 anni | entro ±1 dev. standard | Con utili negativi: non superato |
| **Value / qualità a prezzo ragionevole** | ROE | > 15% | |
| | Margine netto | > 20% | |
| | Crescita ricavi 5 anni | > 5% | |
| | Crescita EPS 5 anni | > 5% | |
| | Crescita EPS prossimo anno | > 0 | Stima analisti: probabilmente non disponibile |
| | Crescita EPS prossimi 5 anni | > 5% | Stima analisti: probabilmente non disponibile |
| | Prezzo / free cash flow | < 30 | |
| | P/E | < 30 | |
| | PEG | < 2 | Se manca: P/E ÷ crescita EPS 5 anni, etichettato "PEG storico" |
| | Quick ratio | > 1 | |
| **Dividendo solido** | Capitalizzazione | > 2 miliardi $ | Nel documento "10 milioni" (refuso). 10 miliardi lascerebbe pochissimi titoli: vedi sotto |
| | Dividend yield | > 3% | |
| | Payout ratio | tra 40% e 75% | Aggiunto il massimo: oltre ~80–100% il dividendo è a rischio |
| | Quick ratio | > 0,5 | |
| | ROE | > 15% | |
| | Margine netto | > 15% | |

**Capitalizzazione del profilo dividendo:** 2 miliardi è un compromesso tra "azienda solida" e numero
di candidati. Il filtro sul controvalore scambiato già esclude i titoli illiquidi. Il resoconto della
scansione riporta **quanti titoli passano ogni profilo**: se un profilo ne produce meno di 5 per due
scansioni di fila, scatta un avviso che suggerisce di rivedere le sue soglie.

### 4.4 Classifica e watchlist

1. Per ogni titolo che passa un profilo si calcola il percentile di ogni sua metrica rispetto agli
   altri titoli dello stesso settore che passano lo stesso profilo.
   - Ogni metrica ha una **direzione** definita in `src/config/`. "Più alto è meglio" per ROE,
     margini e crescite. "Più basso è meglio" per P/E, PEG, P/FCF e debito/patrimonio. Il payout è
     migliore se vicino al centro del suo intervallo.
   - Se nel settore ci sono meno di 5 titoli per quel profilo, il confronto si fa con tutti i
     titoli del profilo.
2. Punteggio = media dei percentili delle metriche valutabili. Se un titolo passa più profili, vale
   il punteggio migliore, e il profilo corrispondente è quello registrato.
3. Si tengono i migliori 3 titoli per settore forte, massimo 30: sono gli **acquistabili**.
4. Si tengono anche, separati, i titoli in **zona grigia**: quelli che hanno mancato **un solo**
   criterio fondamentale entro un passo della soglia (7.4). **Non si comprano mai.** Servono solo
   all'apprendimento come "operazioni ombra" (sezione 7.2).
5. Sempre solo per l'apprendimento, si tengono anche i migliori 3 titoli di ogni **settore debole**.
   Servono a valutare il periodo usato per misurare la forza dei settori.

Output: `state/watchlist.json` (scrittura atomica), con data, classifica dei settori, acquistabili,
zona grigia, conteggi per profilo e criteri non disponibili. Se alla sveglia la watchlist ha più di
8 giorni: allarme ⚠ e nessun acquisto.

### 4.5 Segnali tecnici

Li calcola il codice, mai il modello.

**Quali candele:**
- solo **candele giornaliere chiuse**, almeno 300 sedute;
- la candela della seduta in corso si scarta sempre, finché la seduta non è chiusa;
- per gli indicatori le candele sono rettificate per split e dividendi;
- per simulazioni e percorsi di prezzo sono rettificate **solo per gli split** (sezione 7.2).

**Quando si calcolano:** **una volta per seduta**, alla prima sveglia del giorno (di norma il
briefing). Si salvano in `state/segnali/<data>.json` e tutte le sveglie della stessa seduta usano
gli stessi segnali. Così le decisioni sono coerenti nel corso della giornata.

**Indicatori:**
- medie mobili semplici SMA20, SMA50, SMA200;
- ATR(14);
- ADX(14) con +DI e −DI, metodo di Wilder;
- canale di Donchian a 20 sedute;
- media del volume a 20 sedute;
- linea di forza relativa RS = chiusura del titolo ÷ chiusura di SPY.

**Ingresso — condizioni obbligatorie (tutte):**
1. Trend crescente: chiusura > SMA50 e SMA50 > SMA200.
2. ADX(14) ≥ 20 e +DI > −DI. Nel documento la soglia era 15; sotto 20 un trend di solito non è
   considerato affidabile. L'ADX da solo non dice la direzione del trend, quindi serve anche il
   confronto tra +DI e −DI.
3. Forza relativa crescente: linea RS sopra la sua media a 50 sedute.

**Ingresso — conferme (almeno 2 su 4):**
- a. Rottura del canale di Donchian: chiusura > massimo delle 20 sedute precedenti.
- b. Volume della seduta ≥ 1,5 × media a 20 sedute.
- c. Rottura di resistenza. Resistenza = gruppo di massimi locali (5 barre) delle ultime 120 sedute
  entro l'1,5% l'uno dall'altro. La rottura vale se la chiusura la supera di almeno lo 0,5%.
- d. Candela verde lunga: corpo ≥ 1,5 × ATR(14) e chiusura nel quarto più alto del range della seduta.

**Uscita forte** (il codice vende anche se il modello dice di tenere): chiusura sotto il minimo di
Donchian a 20 sedute **e** volume ≥ 1,5 × media.

**Uscita debole** (segnalata al modello, che decide e spiega):
- chiusura sotto SMA50;
- linea RS sotto la sua media a 50 sedute;
- candela rossa lunga (corpo ≥ 1,5 × ATR) con volume in aumento.

### 4.6 Rischio, protezioni e uscite

**Si compra solo un titolo che:**
- è tra gli acquistabili della watchlist, in un settore forte;
- ha passato i segnali di ingresso della seduta (4.5);
- **supera il controllo del prezzo al momento dell'acquisto**:
  - il prezzo attuale è ancora sopra la SMA50 e, se la conferma era una rottura (a o c), sopra il
    livello rotto;
  - il gap rispetto alla chiusura precedente non supera 1 ATR in nessuna delle due direzioni.

  Lo stesso controllo si applica alle operazioni ombra.
- non è in pausa (vedi sotto);
- non ha la trimestrale nei prossimi 5 giorni di borsa (calendario Finnhub). Se la data non si può
  verificare, non si compra e il motivo va nel resoconto;
- non porta a più di **2 posizioni nello stesso settore**;
- e solo se gli acquisti non sono in pausa (impostazione "pausa acquisti" o freno d'emergenza).

**Dimensione:**
- quantità = parte intera di (min(**peso per posizione** × patrimonio, cash disponibile × 0,99) ÷
  prezzo corrente). Il peso iniziale è il 20%, un parametro di sicurezza (7.4);
- il cash disponibile va diminuito **nel codice** degli acquisti già inviati nella stessa sveglia e
  di quelli ancora aperti, perché Alpaca aggiorna il cash solo a esecuzione avvenuta;
- sotto 1 azione non si compra;
- contano come posizioni anche gli acquisti ancora aperti;
- una posizione salita oltre il peso massimo non viene ridotta.

**Prezzi degli ordini:**
- Alpaca rifiuta più di 2 decimali sopra 1 $ (4 sotto 1 $) e non arrotonda da solo;
- lo stop si arrotonda per difetto al centesimo e il take profit per eccesso;
- prima dell'invio entrambi si verificano rispetto al prezzo attuale: lo stop deve stare almeno
  0,01 $ sotto il prezzo di base.

**Modalità di uscita** (parametro `uscita.modalita`):
- `"bracket"` (iniziale, come nel documento): ordine bracket `gtc` con acquisto a mercato,
  take profit limit a **+20%** e stop a **−10%**. Il rapporto guadagno/rischio è 2:1.
- `"trailing"`: acquisto a mercato, poi, appena eseguito, uno **stop mobile** (`trailing_stop`,
  `gtc`) al 10% sotto il massimo raggiunto. Non ha un tetto al guadagno.

  Le strategie basate sul momentum guadagnano soprattutto grazie a pochi titoli che salgono molto.
  Un take profit fisso al +20% taglia proprio quei titoli. Per questo il diario simula **entrambe le
  modalità** su ogni operazione e la review dirà quale avrebbe reso di più (sezione 7).

**Piano di uscita di ogni posizione.** Al momento dell'acquisto si salva in
`state/piani-uscita.json` (scrittura atomica, copia anche nel diario):
- modalità (bracket o trailing);
- stop;
- take profit;
- percentuale dello stop mobile;
- **massimo prezzo raggiunto**, aggiornato a ogni sveglia, per la modalità trailing;
- origine (iniziale, manuale, review).

Il piano **non cambia** quando cambiano i parametri. I nuovi parametri valgono solo per le nuove
posizioni. Il piano cambia solo con un'azione manuale dalla dashboard, che viene registrata. Se il
file va perso, si ricostruisce dagli ordini di protezione aperti su Alpaca e dal diario.

**Controllo delle protezioni a ogni sveglia.** Per ogni posizione deve esistere un ordine di uscita
aperto, per **l'intera quantità**, coerente con il suo piano. Conta come protezione anche una
vendita già in coda per l'intera quantità (ad esempio "chiudi all'apertura").
- Se i livelli non coincidono con il piano: **modifica** con `PATCH` (sostituzione dell'ordine),
  che Alpaca supporta per le gambe di bracket e OCO e per il `trail` dello stop mobile.
- Se la protezione manca o la quantità non torna (esecuzione parziale, processo morto tra acquisto e
  stop mobile), cancella quello che resta e ricrea secondo il piano: OCO `gtc` oppure
  `trailing_stop` `gtc`.
  - Uno stop mobile ricreato deve ripartire dal **massimo registrato**, non dal prezzo attuale. Se il
    prezzo è già sotto massimo × (1 − percentuale), si vende. Altrimenti si imposta un `trail_price`
    che riproduce lo stesso livello di stop.
  - Se la ricreazione fallisce: allarme ⚠ immediato e nuovo tentativo, al massimo 3. La posizione
    va segnalata come "**non protetta**" in ogni messaggio finché non è risolto.
- Alpaca **cancella da solo gli ordini `gtc` dopo 90 giorni**. Una protezione con più di 80 giorni si
  ricrea, nella sveglia di apertura.
- Se il prezzo è già oltre lo stop, si vende: subito se il mercato è aperto, altrimenti alla sveglia
  di apertura. **Il briefing non vende mai.**
- Gli stop scattano solo in seduta regolare: **non proteggono dai gap di apertura** (va nei limiti).

**Procedura di vendita** (sveglia, uscita forte, chiusura manuale), solo a mercato aperto:
1. Cancella gli ordini di protezione aperti sul titolo.
2. Attendi la conferma della cancellazione, per al massimo 10 secondi.
   - **Se non arriva:** non vendere, manda un allarme e lascia la protezione com'è.
   - Altrimenti una gamba potrebbe eseguirsi mentre vendi, e la vendita aprirebbe uno short.
3. Rileggi la posizione da Alpaca e vendi a mercato **solo la quantità effettivamente disponibile**.
   Se una gamba è già stata eseguita, la quantità può essere zero.

Senza il passo 1 Alpaca rifiuta la vendita con un 403, perché le azioni sono impegnate negli ordini
di protezione.

**Motivi di uscita** (servono a pause e statistiche): stop in perdita, stop mobile in utile,
take profit, uscita forte, uscita debole, manuale, protezione scaduta o altro (con descrizione).

**Trimestrali con posizione aperta:** non c'è un'uscita automatica, ma l'operazione viene marcata
"attraverso la trimestrale" così la review può misurarne l'effetto.

**Pause:**
- niente riacquisto dello stesso titolo per 10 sedute dopo uno **stop in perdita**, e per 3 sedute
  dopo qualsiasi altra uscita;
- le pause si ricostruiscono dagli ordini chiusi su Alpaca negli ultimi 30 giorni, non dal testimone.

**Freno d'emergenza:**
- scatta se il patrimonio scende sotto l'85% del suo massimo;
- il massimo si calcola da `/v2/account/portfolio/history`, con una data di inizio esplicita: la
  più recente tra l'avvio del bot e l'ultimo sblocco. Si ignora lo storico del conto precedente al
  bot;
- data di avvio, data e valore dell'ultimo sblocco stanno in `state/freno.json` (scrittura
  atomica, evento anche nel diario). Se il file va perso, si ricostruisce dal diario;
- quando scatta: nessun nuovo acquisto e allarme ⚠ a ogni sveglia;
- si sblocca solo dalla dashboard, con conferma esplicita;
- lo sblocco **riporta il massimo di riferimento al patrimonio attuale**. Altrimenti il freno
  scatterebbe di nuovo alla sveglia successiva.

---

## 5. Orari e sveglie

Si ragiona in **ora di New York**. USA ed Europa cambiano l'ora legale in date diverse, e ci sono le
mezze giornate. Aperture e chiusure arrivano dal calendario Alpaca. Si lavora solo nei giorni di
borsa: weekend e festivi non contano come sveglie saltate.

| Sveglia | Quando | Cosa fa |
|---|---|---|
| briefing | 09:30 Europe/Rome | Conto, protezioni, segnali su candele chiuse, piano del giorno. **Nessun ordine**, salvo ricreare una protezione mancante. |
| apertura | apertura + 10 min (di norma 15:40 Roma) | Prima le uscite (forti, e deboli se approvate dal modello), poi gli ingressi nei posti liberi. |
| metà seduta | 12:30 ET (di norma 18:30 Roma) | Protezioni. Se in giornata si è liberato un posto, ingressi dalla lista del briefing. |
| chiusura | chiusura − 30 min (di norma 21:30 Roma) | Nessun ingresso. Resoconto del giorno, aggiornamento delle operazioni ombra. |

- Se due sveglie cadono a meno di 30 minuti l'una dall'altra (ad esempio nelle mezze giornate),
  si esegue solo la seconda.
- Una sveglia vale se parte entro 20 minuti dall'orario previsto. Oltre è **saltata**: si segnala
  e non si recupera.
- L'id della sveglia usa l'**orario previsto** in ora di Roma: `run 2026-09-24-1540`.
- Sabato: scansione (4.1), poi verifica se è il momento di una review (7.3).

## 6. Il giro di una sveglia

1. **Lock** `state/run.lock`, creato in modo atomico (la creazione fallisce se il file esiste già).
   - **Contenuto:**
     - PID e **ora di avvio del processo**, che servono a riconoscerlo anche se Windows ha
       riassegnato quel PID;
     - chi lo tiene (sveglia o dashboard) e l'id della sveglia;
     - un **battito** aggiornato ogni 30 secondi;
     - prima di ogni invio, gli id degli ordini che sta per mandare.
   - **Se il lock esiste e il processo che lo tiene è vivo:** non si prende mai il suo posto.
     - Esci con "sveglia già in corso", oppure, se chi aspetta è la dashboard, aspetta fino a 60
       secondi.
     - Se il battito è fermo da più di 15 minuti con il processo vivo: allarme ⚠ "sveglia bloccata",
       senza proseguire.
   - **Se il processo che lo tiene è morto:** la sveglia precedente si è interrotta.
     - Rinomina in modo atomico il lock in `run.lock.morto-<data>`: solo uno dei contendenti ci riesce.
     - Riconcilia con Alpaca ogni id elencato, manda un allarme, poi crea il tuo lock.
   - **La scansione del sabato ha un lock separato** (`state/scan.lock`, stesse regole) e non blocca
     le sveglie.
2. **Testimone** `state/baton.json`.
   - Se è corrotto, usa l'ultima copia valida in `state/history/` e manda un allarme. Se non ce n'è
     nessuna, vai avanti senza.
   - Segnala le sveglie saltate dopo l'ultimo testimone.
3. **Alpaca**: conto, posizioni, ordini aperti, ordini chiusi negli ultimi 30 giorni, orologio,
   calendario, storico del patrimonio.
4. **Parametri** attivi (`state/params.json`): la versione in uso va registrata ovunque.
5. **Dati e segnali**:
   - i segnali della seduta, calcolati se è la prima sveglia del giorno, altrimenti letti da
     `state/segnali/` (4.5);
   - prezzi attuali;
   - aggiornamento del massimo raggiunto nei piani di uscita;
   - protezioni da riparare;
   - uscite forti e deboli;
   - candidati ammessi ordinati per punteggio;
   - posti liberi.
6. **Cervello.** Riceve un JSON costruito dal codice:
   - conto e posizioni;
   - segnali di uscita;
   - fino a 10 candidati ammessi, con metriche e segnali;
   - posti liberi;
   - pause;
   - piano e lezioni del testimone precedente;
   - **le ultime conclusioni della review** (sezione 7).

   Risponde con:
   - `decisions`: `{simbolo, azione: compra | vendi | tieni, perché in una frase}`;
   - `reasoning`: 3–5 frasi;
   - `planNext`;
   - `lezione` (facoltativa).

   **Niente quantità**: le calcola il codice. Se il cervello fallisce (timeout, risposta non valida,
   budget superato, errore) o è sospeso per il budget mensile (8.7): si eseguono comunque
   protezioni e uscite forti, **nessun acquisto**, allarme ⚠.

   Ogni chiamata, riuscita o no, registra i propri consumi (8.7).
7. **Gabbia**: si compra solo tra i candidati di questa sveglia e si vende solo ciò che è in
   portafoglio. Ogni rifiuto va nel log e nel messaggio, con il motivo.
8. **Esecuzione.**
   - Id deterministico `AAAA-MM-GG-HHMM-SIMBOLO-azione`, con azione `buy`, `sell` o `protect`.
     Prima di inviare si verifica per id. Un id già presente su Alpaca, in qualsiasi stato, non si
     rimanda mai.
   - Timeout sull'invio: **non** riprovare, verifica per id.
   - Un acquisto a mercato ancora aperto dopo 30 minuti si cancella e si segnala.
9. **Diario**: tutti gli eventi della sveglia (sezione 7.1).
10. **Testimone nuovo**, con scrittura atomica (file temporaneo + rename), in italiano semplice.
    - Contiene: ordini proposti, inviati e rifiutati con il motivo; errori; ragionamento; piano.
    - Contiene anche le **lezioni**: gli ultimi 20 errori o rifiuti (tipo, simbolo, motivo, quante
      volte, ultima volta). Un ordine rifiutato 2 volte per lo stesso motivo non si ripropone per
      5 sedute.
    - Una copia va in `state/history/`.
11. **Telegram, log** `logs/<id>.log` (righe JSON passate da `redact()`), **rilascio del lock**.

---

## 7. Diario e apprendimento

### 7.1 Il diario

Il diario è in `state/journal/`: file JSONL **solo in aggiunta**, uno per mese. Non si modifica né si
cancella mai una riga. Registra ogni evento:
- sveglia;
- decisione;
- ordine;
- esecuzione;
- rifiuto;
- errore;
- intervento manuale;
- cambio dei parametri;
- review.

Per ogni operazione esiste una **scheda** che si completa nel tempo:

- **All'ingresso** — la fotografia di tutto ciò che ha portato alla decisione:
  - profilo e settore, con la forza del settore;
  - ogni criterio fondamentale con valore e soglia;
  - ogni indicatore tecnico con il suo valore e le conferme presenti;
  - punteggio e posizione in classifica;
  - motivazione del modello;
  - versione dei parametri;
  - prezzo, quantità, piano di uscita;
  - le **ultime 300 candele grezze** (OHLCV), per poter ricalcolare gli indicatori con parametri
    diversi.
- **All'uscita**:
  - motivo (stop, take profit, stop mobile, uscita forte, uscita debole, manuale);
  - prezzo e durata in sedute;
  - risultato in $ e in % e in **multipli del rischio iniziale** (R);
  - massimo guadagno e massima perdita toccati durante la vita della posizione;
  - rendimento di SPY nello stesso periodo;
  - "attraverso la trimestrale" sì/no.
- **Simulazione delle due modalità** (bracket e trailing), su **ogni** operazione reale con lo
  stesso simulatore delle operazioni ombra (7.2):
  - la simulazione **prosegue anche dopo l'uscita reale**, finché entrambe le modalità non sono
    chiuse;
  - nel frattempo la scheda è marcata "simulazione in corso";
  - le uscite deboli, che sono scelte del modello, nella simulazione si ignorano: valgono solo stop,
    take profit, stop mobile e uscita forte;
  - nelle statistiche il confronto tra le modalità usa **solo i risultati simulati**, così sono
    confrontabili tra loro. Il risultato reale si mostra a parte.
- Le operazioni con un intervento manuale sono marcate "manuale" e tenute **separate** nelle
  statistiche.

### 7.2 Operazioni ombra

Con 5 posizioni si chiudono poche operazioni alla settimana: troppo poche per imparare. Per questo
il bot registra anche le **operazioni ombra**, cioè quelle che avrebbe potuto fare:
- candidati che hanno passato tutte le regole ma non sono stati comprati (posti pieni, limite di
  settore, trimestrale vicina, modello contrario);
- candidati "quasi": mancava una sola conferma, o l'ADX era entro 3 punti dalla soglia;
- titoli in zona grigia (4.4) che passano i segnali tecnici;
- migliori titoli dei settori deboli (4.4) che passano i segnali tecnici.

**Regole di simulazione**, sulle candele giornaliere rettificate solo per gli split:
- **Ingresso** all'apertura della seduta **successiva alla candela del segnale** (non alla sveglia),
  più uno slittamento dello 0,1%, e solo se supera il controllo del prezzo (4.6).
- **Ogni seduta, in quest'ordine:**
  1. si controlla l'uscita con i livelli della seduta precedente: stop, livello dello stop mobile;
  2. poi si aggiorna il massimo con la seduta corrente.
- **Prezzi di esecuzione:**
  - stop: min(apertura, stop). Un gap sotto lo stop esce all'apertura, non allo stop;
  - take profit: max(apertura, take profit);
  - se nella stessa seduta si toccano sia lo stop che il take profit, vale lo stop (ipotesi prudente).
- Un titolo genera al massimo un'operazione ombra ogni 10 sedute.
- Le candele usate si salvano nella scheda appena vengono lette. Così una nuova lettura non cambia i
  risultati passati.

Ogni risultato simulato è marcato come tale e **non va mai mescolato ai risultati reali** nei
resoconti sul portafoglio.

### 7.3 La review periodica

**Quando:** il sabato, dopo la scansione, se è vera una delle due condizioni:
- dall'ultima review sono passate **almeno 20 sedute** e si sono chiuse **almeno 15 operazioni
  reali** nuove;
- oppure sono passate **40 sedute** (circa 2 mesi), comunque vada.

Non prima di 20 sedute, per evitare di inseguire il rumore. Non dopo 40, per non restare troppo a
lungo con parametri sbagliati. Con 5 posti e posizioni di più settimane, in pratica la review
arriverà quasi sempre ogni 40 sedute.

**Campione piccolo** = meno di **30 operazioni reali chiuse** in totale. Con un campione piccolo la
review fa solo il resoconto, **senza proposte**. Le operazioni ombra servono a confermare un'ipotesi,
non a farla nascere da sole.

**Cosa calcola il codice:**
- risultati reali:
  - percentuale di operazioni vincenti;
  - guadagno medio e perdita media;
  - **attesa per operazione in R** (quanto si guadagna in media per ogni unità di rischio);
  - fattore di profitto;
  - massimo drawdown;
  - confronto con SPY;
- gli stessi numeri, separatamente, per le operazioni ombra;
- suddivisione per profilo, settore, tipo di conferma, fascia di ADX, motivo di uscita, durata;
- confronto tra uscita bracket e trailing su tutte le operazioni, reali e ombra;
- per ogni parametro regolabile (7.4): l'effetto del valore vicino, un passo sopra e un passo sotto,
  ricalcolato sulle operazioni registrate. È possibile perché ogni scheda contiene la fotografia
  completa dei dati all'ingresso.
  - **Rendere un filtro più severo** si valuta sulle operazioni che già esistono.
  - **Allentarlo** si può valutare solo se esistono operazioni ombra "quasi" o in zona grigia che
    coprono quel passo.
  - Se per una direzione mancano i dati, quella direzione non si valuta e la review lo scrive.
  - Stop, take profit e stop mobile si possono simulare per qualsiasi valore sul percorso di prezzo
    di ogni operazione.

**Come si valuta un passo.** Per i filtri non si confrontano due campioni sovrapposti: si guarda
**solo la differenza**.
- **Rendere un filtro più severo:** si guardano le operazioni che verrebbero **escluse**. La modifica
  ha senso solo se la loro attesa media in R è negativa.
- **Allentarlo:** si guardano le operazioni che verrebbero **aggiunte** (ombra "quasi" o zona grigia).
  La modifica ha senso solo se la loro attesa media è positiva.
- **Livelli di uscita** (stop, take profit, stop mobile): si confronta, operazione per operazione,
  l'R simulato con il valore attuale e con quello nuovo, sugli stessi percorsi di prezzo.

**Quando una modifica può essere proposta (regole contro l'overfitting), tutte insieme:**
- campione non piccolo, e almeno 30 operazioni (reali + ombra) nel gruppo della differenza;
- effetto di almeno **0,1 R** per operazione;
- intervallo di confidenza bootstrap al 90% che **non comprende lo zero**, calcolato **separatamente**
  sui primi 2/3 del periodo (in ordine di tempo) e sull'ultimo terzo;
- il livello di confidenza va **corretto per il numero di confronti** fatti in quella review
  (correzione di Bonferroni). Più parametri si provano, più severo diventa il test;
- al massimo **2 parametri per review**, ciascuno al massimo di **un passo**;
- i parametri di sicurezza si muovono solo nella direzione ammessa (7.4).

Se nessuna proposta supera i controlli, la review lo dice chiaramente ("campione insufficiente" o
"nessun miglioramento robusto") e non propone niente. Va bene così: con questi numeri la maggior
parte delle review **non dovrebbe** proporre modifiche.

Il **modello** riceve le statistiche e le proposte candidate già calcolate dal codice. Sceglie quali
presentare (senza inventarne) e scrive la review in italiano: cosa ha funzionato, cosa no, cosa
propone e perché, quanto è affidabile la conclusione.

**Conferma:**
- La review arriva su Telegram con un pulsante **Approva** / **Rifiuta** per ogni proposta, ed è
  visibile anche nella dashboard.
- Si accettano solo risposte dalla mia chat (`chatId`).
- **Lettura dei pulsanti:**
  - **un solo processo** legge gli aggiornamenti di Telegram: la dashboard, che resta sempre accesa,
    ogni 30 secondi, 7 giorni su 7. Due lettori si ruberebbero i clic a vicenda;
  - Telegram conserva i clic non letti solo per 24 ore. Se la dashboard era spenta, il clic si
    perde: il messaggio della review lo dice, e la proposta si può sempre approvare dalla dashboard.
- Ogni proposta ha un id. Approvarla due volte (Telegram + dashboard) produce un solo effetto.
- Una proposta senza risposta scade dopo 7 giorni.
- Una proposta approvata crea una **nuova versione dei parametri**, valida dalla sveglia successiva.
- Alla review successiva si confrontano le operazioni aperte con la versione nuova e con quella
  vecchia.
- Si può sempre tornare a una versione precedente dalla dashboard.

### 7.4 Parametri regolabili dalla review

Ogni parametro ha in `src/config/` un **passo** e un **intervallo** ammessi. Lista iniziale:

**Parametri della strategia**: la review può muoverli in entrambe le direzioni, entro l'intervallo.

| Parametro | Passo | Intervallo | Come si valuta |
|---|---|---|---|
| ADX minimo | 2 | 15–30 | Dalle schede e dalle ombra "quasi" |
| Conferme minime | 1 | 1–4 | Dalle schede e dalle ombra "quasi" |
| Moltiplicatore del volume | 0,25 | 1,0–2,5 | Ricalcolando dalle 300 candele salvate |
| Periodo Donchian | 5 | 10–55 | Ricalcolando dalle 300 candele salvate |
| Stop | 2 punti % | 6–20% | Simulazione sui percorsi di prezzo |
| Take profit | 5 punti % | 10–40% | Simulazione sui percorsi di prezzo |
| Stop mobile | 2 punti % | 6–20% | Simulazione sui percorsi di prezzo |
| Modalità di uscita | — | bracket o trailing | Confronto tra le due simulazioni |
| Sedute per la forza del settore | — | 21, 63, 126 | Ombra dei settori deboli |
| Soglie fondamentali "> x" con x ≠ 0 | ±10% di x | entro ±50% del valore iniziale | Schede e zona grigia |
| Soglie fondamentali "> 0" | 5 punti % | da −10% a +20% | Schede e zona grigia |

Stop e stop mobile sono trattati allo stesso modo, in entrambe le direzioni. Stringerli sempre di
più non è "più prudente": con gli ingressi su rottura, stop stretti di solito significano più uscite
premature e rendimenti più bassi.

**Parametri di sicurezza**: la review può solo renderli più prudenti. Io posso cambiarli nelle
impostazioni, entro l'intervallo.

| Parametro | Iniziale | Intervallo | Direzione ammessa alla review |
|---|---|---|---|
| Peso per posizione | 20% | 5–20% | Solo in giù |
| Numero massimo di posizioni | 5 | 1–5 | Solo in giù |
| Posizioni massime per settore | 2 | 1–2 | Solo in giù |
| Freno d'emergenza | 85% | 75–95% | Solo in su (più sensibile) |

Un parametro che non ha i dati per essere valutato in una direzione non viene proposto in quella
direzione, e la review lo dice.

---

## 8. Dashboard web

`bun run dashboard` avvia un server Bun su `http://127.0.0.1:8787` (porta modificabile).

**Accesso:**
- password presa da `secrets.ts` e cookie di sessione `HttpOnly` + `SameSite=Strict`;
- ogni azione che cambia qualcosa richiede un token anti-CSRF;
- nessun segreto è mai inviato al browser;
- niente librerie esterne: HTML, CSS e JS scritti a mano, grafici in SVG;
- interfaccia in italiano, utilizzabile anche su schermo piccolo.

### 8.1 Panoramica (pagina iniziale)

- Patrimonio, cash, valore investito, posti liberi.
- P&L in $ e in % di **oggi, settimana, mese e dall'inizio**, ciascuno affiancato al rendimento di
  SPY nello stesso periodo.
- Grafico del patrimonio (1 settimana / 1 mese / 3 mesi / tutto), con SPY sovrapposto.
- Stato del bot: ultima e prossima sveglia, allarmi aperti, freno, pausa acquisti, età della
  watchlist, versione dei parametri.
- Un **riquadro per ogni posizione**:
  - simbolo, nome e settore;
  - P&L in % e in $;
  - giorni in posizione;
  - distanza da stop e take profit, come barra visiva.

### 8.2 Dettaglio posizione (si apre cliccando un riquadro)

- **Perché è stata comprata**, presa dalla scheda del diario:
  - profilo e settore, con la forza del settore in quel momento;
  - tabella dei criteri fondamentali (valore, soglia, superato sì/no/non disponibile);
  - indicatori tecnici e conferme;
  - punteggio;
  - motivazione del modello.
- **Situazione:**
  - prezzo di carico, quantità, prezzo attuale;
  - ordini di protezione attivi;
  - grafico del prezzo dall'ingresso con i livelli disegnati.
- **Profitto atteso:**
  - guadagno in $ se arriva al take profit e perdita in $ se arriva allo stop, con il rapporto tra
    i due;
  - in modalità trailing: il guadagno già protetto dallo stop mobile;
  - "**valore atteso stimato**" calcolato dallo storico reale del diario (percentuale di vincenti ×
    guadagno medio − perdenti × perdita media), mostrato solo con almeno 20 operazioni chiuse;
    altrimenti "non stimabile: storico insufficiente".
- **Azioni manuali**, ciascuna con una finestra di conferma:
  - **Chiudi ora**: disponibile solo a mercato aperto. A mercato chiuso diventa **"Chiudi
    all'apertura"**, che registra l'intenzione nel piano di uscita: la sveglia di apertura eseguirà
    la vendita con la procedura normale. La protezione resta attiva fino ad allora;
  - **modifica stop e take profit**: nuovi valori validati, stop sotto il prezzo attuale di almeno
    l'1% e take profit sopra di almeno l'1%. Si eseguono con `PATCH` sull'ordine esistente e si
    aggiorna il piano di uscita (origine "manuale");
  - **passa a stop mobile**: cancella l'OCO e crea il `trailing_stop` (6–20%). Se la creazione fallisce
    si ripristina subito l'OCO precedente e si manda un allarme.
- **Cronologia degli eventi** della posizione.

### 8.3 Storico

- Operazioni chiuse, con esito, motivo di uscita, durata, R e confronto con SPY. Filtri per profilo,
  settore e modalità.
- Le operazioni ombra in una scheda separata, chiaramente marcate come simulate.

### 8.4 Review

- Review passate.
- Proposte in attesa, con **Approva** / **Rifiuta**.
- Cronologia delle versioni dei parametri: chi ha cambiato cosa, quando, e i risultati ottenuti con
  ogni versione. Pulsante **ripristina questa versione**.

### 8.5 Impostazioni

- Tutti i parametri, raggruppati: universo, profili fondamentali, settori, segnali tecnici, rischio e
  uscite, orari, apprendimento, notifiche.
- Per ognuno: descrizione in italiano, valore attuale, valore iniziale, intervallo ammesso, ultima
  modifica (da me o da review vN).
- Al salvataggio:
  - mostra l'anteprima delle differenze;
  - valida i valori, rifiutando quelli fuori intervallo;
  - crea una nuova versione;
  - scrive l'evento nel diario;
  - mi avvisa su Telegram.
- Effetto dalla sveglia successiva.
- Interruttori:
  - **pausa acquisti**;
  - **sblocca freno d'emergenza**;
  - **ripristina valori iniziali**.
- I vincoli 🔒 della sezione 3 non compaiono.

### 8.6 Azioni manuali: regole

- Passano dallo **stesso esecutore** delle sveglie: stesso lock (attesa fino a 60 secondi, poi "bot
  occupato, riprova"), stessa verifica per id, stessa procedura di vendita.
- Id deterministico: quando la pagina mostra un pulsante d'azione, il server genera un codice
  univoco e lo inserisce nel modulo. L'id dell'ordine è `AAAA-MM-GG-SIMBOLO-manual-<codice>`.
  - Un secondo invio dello stesso modulo, anche a distanza di tempo, riusa lo stesso codice, quindi
    produce un solo ordine.
  - "Chiudi ora" su una posizione che non esiste più risponde "posizione già chiusa".
- Ogni azione manuale va nel diario e su Telegram.

### 8.7 Consumi AI

Una scheda per sapere quanto lavora il "cervello" (`claude -p`), quanto costerebbe e per cosa.

**Da dove vengono i dati.** Ogni chiamata al cervello, riuscita o no, scrive una riga in
`state/ai-usage/AAAA-MM.jsonl`: file solo in aggiunta, scritto sotto il lock del diario. La riga
contiene:
- data e ora;
- id della sveglia o della review;
- **tipologia di task**;
- modello;
- esito: `ok`, `timeout`, `risposta non valida`, `budget superato`, `errore`;
- durata totale e durata delle chiamate API;
- numero di turni;
- token: input, output, letti dalla cache, scritti in cache;
- costo stimato in $;
- dimensione del prompt inviato;
- se era una sveglia forzata (`--force`).

**Tipologie di task:**
- decisione briefing;
- decisione apertura;
- decisione metà seduta;
- decisione chiusura;
- review periodica;
- sonda/prova (`probe`).

Quando ne serve una nuova, si aggiunge in `src/config/` e compare da sola nella scheda.

**Onestà dei numeri** (va scritto nella scheda, non nascosto in una nota):
- il costo è una **stima calcolata dal client** con un listino incorporato, non l'importo
  fatturato;
- con l'abbonamento Claude (token OAuth) non è un addebito a consumo ma il **costo equivalente se
  si pagasse a consumo**;
- i limiti di utilizzo dell'abbonamento non sono leggibili dal bot, quindi la scheda non li mostra;
- se una chiamata viene interrotta per timeout non c'è un resoconto dei consumi: la riga riporta i
  token come "**non misurato**" e la conta a parte. Non si stima e non si mette zero;
- se Claude si blocca, alcuni risultati d'errore riportano zero: si mostrano come "non misurato".

**Cosa mostra la scheda:**
- **Riquadri** per oggi, settimana, mese e dall'inizio:
  - numero di chiamate e quante fallite;
  - token totali, divisi in input, output e cache;
  - costo stimato;
  - durata media;
  - **quota di token letti dalla cache**, che indica quanto il prompt viene riutilizzato.
- **Grafico nel tempo**:
  - barre per giorno, settimana o mese, a scelta;
  - impilate per tipologia di task;
  - si può passare tra costo, token e numero di chiamate.
- **Tabella dello spaccato**: righe = tipologie di task, colonne = periodo scelto (oggi, 7 giorni,
  30 giorni, mese corrente, mese precedente, dall'inizio, oppure un intervallo di date). Per ogni
  cella:
  - chiamate;
  - token;
  - costo stimato;
  - costo medio per chiamata;
  - durata media;
  - percentuale di errori.

  La riga dei totali deve coincidere con la somma delle righe.
- **Per modello**: stessa tabella raggruppata per modello, dal dettaglio per modello del
  risultato.
- **Rapporto con il trading**, solo come informazione:
  - costo AI stimato per operazione chiusa;
  - costo AI stimato del mese accanto al P&L del mese.
- **Proiezione del mese**: costo medio per giorno di borsa × giorni di borsa rimanenti, etichettato
  "stima".
- **Ultime 50 chiamate**: data, tipologia, esito, token, costo, durata, collegamento al log della
  sveglia.
- Filtri per tipologia, esito e intervallo di date. Esportazione CSV del periodo selezionato.
- Tutti i periodi si calcolano in **ora di Roma**: il giorno va da mezzanotte a mezzanotte.

**Limiti di spesa** (parametri nelle impostazioni, gruppo "AI"):
- **modello**: passato con `--model`, separatamente per le decisioni e per la review. Il valore
  iniziale è "predefinito di Claude Code". È la leva principale sul costo: la scheda mostra il costo
  medio per chiamata di ciascun modello usato, così il confronto si fa con i dati;
- **tetto per chiamata**: passato a `claude -p` con `--max-budget-usd`. Valori iniziali: 1,00 $ per
  una decisione, 3,00 $ per una review. Una chiamata che lo supera conta come errore del cervello
  (6.6): nessun acquisto. Se **2 chiamate di fila** superano il tetto, arriva un allarme specifico
  "tetto per chiamata troppo basso" con il costo osservato;
- **budget mensile stimato**: valore iniziale 30 $. Avviso ⚠ su Telegram al 80% e al 100%, una volta
  sola per soglia e per mese;
- **al superamento del budget mensile**: `"solo avviso"` (iniziale) oppure `"sospendi il cervello"`.
  - Con la sospensione le sveglie continuano: protezioni e uscite forti vengono eseguite, ma niente
    acquisti, come quando il cervello fallisce.
  - Il resoconto lo dice a ogni sveglia.

---

## 9. Telegram

Ogni messaggio porta l'id della sveglia, lo stesso del log. Testo HTML con caratteri speciali
convertiti; i messaggi oltre i 4096 caratteri si spezzano.

- **Fine sveglia**:
  - ordini inviati e rifiutati, con il motivo;
  - motivazione in 2 righe;
  - posizioni con P&L e livelli;
  - patrimonio e P&L del giorno **con SPY a confronto**;
  - posti liberi;
  - prossima sveglia.
- **Allarmi ⚠**, in un messaggio separato:
  - sveglia interrotta o saltata;
  - errore del broker, dei dati o del cervello;
  - protezione ricreata, o **posizione non protetta** (ripetuto a ogni sveglia finché non è
    risolto);
  - watchlist vecchia;
  - freno d'emergenza;
  - profilo con meno di 5 titoli;
  - budget AI mensile stimato all'80% o al 100%, cervello sospeso.
- **Scansione del sabato**: settori forti, migliori 3 titoli per settore, conteggi per profilo,
  criteri non disponibili.
- **Review**: sintesi e pulsanti Approva / Rifiuta.
- **Azioni manuali e cambi di parametri.**
- Se Telegram non risponde, il bot non si ferma: lo scrive nel log.

## 10. Parametri

- I valori iniziali, gli intervalli e i passi stanno in `src/config/`.
- I valori **attivi** stanno in `state/params.json`, con versione (`v1`, `v2`, …), autore (iniziali,
  io, review) e data. Le versioni precedenti stanno in `state/params-history/`.
- Il codice legge **solo** i valori attivi. Nessuna soglia è scritta direttamente nella logica.
- I parametri valgono per le **nuove** decisioni. Le posizioni aperte seguono il proprio piano di
  uscita (4.6).
- Se `params.json` è corrotto: si usa l'ultima versione valida dello storico, con un allarme.
- **Scritture concorrenti.** Salvataggio dalla dashboard, approvazione da Telegram, sblocco del freno
  e ripristino possono arrivare insieme.
  - Ogni scrittura di parametri passa da un lock dedicato (`state/params.lock`) con un controllo
    sulla versione: si scrive v(N+1) solo se quella attuale è ancora vN, altrimenti si rilegge e si
    riprova o si segnala il conflitto.
  - Anche le aggiunte al diario passano da un lock dedicato, così le righe non si mescolano.

## 11. Guadagna davvero?

Il bot deve poter rispondere a questa domanda con i numeri, senza addolcirli.

- Ogni resoconto (giornaliero, review, dashboard) affianca i risultati a **comprare e tenere SPY**
  nello stesso periodo.
- Se dopo 60 sedute di attività il bot rende meno di SPY, la review lo scrive **nella prima riga**.
- Non si giudica prima di avere almeno 30 operazioni chiuse. Fino ad allora ogni conclusione va
  accompagnata da "campione piccolo".

---

## 12. Test di accettazione (con broker, dati e cervello finti)

**Affidabilità**
1. Stessa sveglia lanciata due volte → un solo ordine per titolo.
2. Due processi in contemporanea → ne procede uno.
3. Processo ucciso dopo il primo ordine → la sveglia dopo riconcilia e non ricompra.
4. Testimone delle 09:30, poi niente fino alle 21:40 → apertura e metà seduta segnalate come saltate.
5. Weekend e festivi non risultano saltati. Mezza giornata → una sveglia sola tra metà seduta e
   chiusura.
6. 16 marzo 2026 (ora legale disallineata) → apertura alle 14:40 ora di Roma.
7. Testimone corrotto → ultima copia valida + allarme. Senza copie valide si va avanti col broker.
8. Cervello in timeout o con risposta non valida → protezioni e uscite forti eseguite, nessun
   acquisto, allarme.
9. Telegram irraggiungibile → la sveglia finisce e lo scrive nel log.

**Sicurezza**
10. URL live o chiave `AK…` → il programma non parte.
11. Nessun segreto in log, messaggi, risposte della dashboard o output, nemmeno con un errore di rete
    sull'URL di Telegram.
12. Dashboard: senza sessione → 401. Senza token CSRF → 403. Il server ascolta solo su 127.0.0.1.

**Gabbia e uscite**
13. Simbolo fuori dai candidati, 6ª posizione o 3ª nello stesso settore → rifiutati.
14. Posizione senza protezione → protezione ricreata. Prezzo già oltre lo stop → venduta.
15. Vendita con protezione aperta → prima la cancellazione, poi la vendita. Nessun 403.
16. Stop su un titolo → non si ricompra per 10 sedute, anche se è primo in classifica e anche
    cancellando il testimone.
17. Trimestrale entro 5 giorni, o data non verificabile → nessun ingresso, con il motivo.
18. Patrimonio sotto l'85% del massimo → nessun ingresso, allarme. Si sblocca solo dalla dashboard.
19. Modalità trailing: processo morto tra l'acquisto e lo stop mobile → la sveglia dopo crea lo stop
    mobile.

**Selezione e segnali**
20. Nessun settore forte → zero acquisti, dichiarato.
21. Screener:
    - payout 120% → escluso;
    - debito/patrimonio ignorato per una banca;
    - criterio mancante → "non disponibile";
    - profilo con meno del 70% dei criteri valutabili → non passa.
22. Indicatori → coincidono con i valori di riferimento, con la fonte indicata nel test.
23. Scansione interrotta → riparte dalla cache.

**Diario e apprendimento**
24. Ogni acquisto ha una scheda con la fotografia completa e le 300 candele. Ogni uscita completa la
    scheda. Se una delle due modalità simulate è ancora aperta, la scheda resta "simulazione in
    corso" e si chiude da sola alle sveglie successive.
25. Simulazione:
    - stop e take profit toccati nella stessa seduta → vale lo stop;
    - gap sotto lo stop → uscita all'apertura;
    - ingresso alla seduta dopo la candela del segnale.
26. Review non avviata prima di 20 sedute. Avviata a 40 sedute anche con poche operazioni. Con meno
    di 30 operazioni reali chiuse: solo resoconto, nessuna proposta.
27. Proposte:
    - mai più di 2, mai oltre un passo;
    - parametri di sicurezza mai nella direzione meno prudente;
    - mai con effetto sotto 0,1 R;
    - mai se l'intervallo bootstrap, corretto per il numero di confronti, comprende lo zero in una
      delle due parti del periodo.

    Su dati casuali senza vantaggio reale la review non deve proporre niente nella grande
    maggioranza dei casi: simulalo nel test.
28. Pulsante Telegram premuto da un'altra chat → ignorato. Approvazione → nuova versione dei
    parametri. Ripristino → torna la versione precedente.

**Dashboard**
29. Doppio clic su "Chiudi ora" → un solo ordine.
30. Azione manuale durante una sveglia → aspetta il lock oppure risponde "bot occupato".
31. Impostazione fuori intervallo → rifiutata con un messaggio chiaro, nessuna nuova versione.

**Aggiunti dopo la revisione del contratto**
32. Configurazione del conto con short o margine attivi, e impossibile da correggere → il programma
    non parte.
33. Cancellazione della protezione non confermata entro 10 secondi → nessuna vendita, allarme.
    Gamba eseguita durante la cancellazione → la vendita usa la quantità riletta, quindi zero:
    nessuno short.
34. Due acquisti nella stessa sveglia → il secondo viene dimensionato sul cash meno il primo.
    Il cash non va mai sotto zero.
35. Cambio dei parametri di uscita → le posizioni aperte mantengono il proprio piano. Uno stop
    modificato a mano non viene "riparato" ai valori iniziali.
36. Lock:
    - processo vivo con battito fermo → allarme, nessun subentro;
    - due processi che recuperano insieme un lock morto → ne vince uno;
    - la scansione lunga non blocca le sveglie.
37. Candela della seduta in corso → mai usata nei segnali. Metà seduta e chiusura usano i segnali
    salvati al briefing.
38. Prezzi con più di 2 decimali → arrotondati prima dell'invio (stop per difetto, take profit per
    eccesso).
39. Gap oltre 1 ATR o prezzo tornato sotto la SMA50 o sotto il livello rotto → nessun acquisto, con
    il motivo.
40. Protezione `gtc` con più di 80 giorni → ricreata. Stop mobile ricreato → riparte dal massimo
    registrato, non dal prezzo attuale.
41. Due salvataggi di parametri contemporanei → una sola v(N+1), l'altro riceve "conflitto".
    La stessa proposta approvata da Telegram e dalla dashboard → un solo effetto.
42. "Chiudi ora" a mercato chiuso → diventa "chiudi all'apertura". La protezione resta attiva e la
    vendita avviene alla sveglia di apertura.

**Consumi AI**
43. Ogni chiamata al cervello produce una riga di consumo, anche se fallisce:
    - riuscita → token e costo letti dal risultato;
    - timeout → "non misurato", mai zero;
    - risultato d'errore con costi azzerati → "non misurato".
44. Aggregazione:
    - una chiamata alle 00:30 ora di Roma va nel giorno giusto, anche nei giorni di cambio dell'ora
      legale;
    - la somma delle tipologie coincide con il totale in ogni periodo;
    - le chiamate "non misurate" sono contate ma non sommate nei token.
45. Chiamata oltre il tetto (`error_max_budget_usd`) → trattata come errore del cervello, nessun
    acquisto. Il costo registrato è `total_cost_usd`, che include la risposta che ha superato il
    tetto.
46. Budget mensile:
    - all'80% → un solo avviso nel mese;
    - in modalità "sospendi" → le sveglie successive non chiamano il cervello, eseguono le
      protezioni e lo scrivono nel resoconto.
47. Scheda consumi senza sessione → 401. Esportazione CSV → stessi numeri della tabella a video.

## 13. Fuori da questa versione (da elencare nei limiti)

- Notizie macro e analisi delle notizie.
- Backtest storico sui fondamentali (servono dati "point-in-time", non disponibili gratis).
- Pattern grafici e trendline.
- Stime degli analisti.
- Accesso alla dashboard da fuori dal computer.
- Acquisti manuali dalla dashboard.
- Conto reale.
