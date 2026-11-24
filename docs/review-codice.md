# Auto-review del codice

Una sezione per modulo, nell'ordine di costruzione. Risposte brevi, senza cortesie.

## 1. Utilità e configurazione

**Corretto?**
- Fusi orari: solo `Intl.DateTimeFormat`. `zonedToUtc` fa due iterazioni, quindi è corretto anche vicino ai cambi d'ora. Test sul 16/03/2026 (apertura 14:40 Roma), sul 24/09/2026 (15:40) e sulla mezzanotte dei giorni di cambio dell'ora legale.
- Ora inesistente (es. 02:30 Roma del 29/03): `zonedToUtc` restituisce l'istante spostato di un'ora. Non capita con gli orari del bot (09:30 Roma, orari NY in seduta).
- Scrittura atomica: file temporaneo + `fsync` + `rename`, con nuovi tentativi su `EPERM`/`EBUSY` (antivirus su Windows).
- File corrotto: `readJsonSafe` distingue "assente" da "corrotto". Nel JSONL le righe corrotte si saltano e si contano.
- Parametri: versione N+1 solo se quella attuale è ancora N (sotto `params.lock`). Valori fuori intervallo rifiutati. `maxPosizioni` è limitato a 5 anche in lettura.

**Funziona?** 20 test eseguiti con `bun test`: tempo, redact, atomico, lock brevi, JSONL, parametri (conflitto, ripristino, file corrotto).

**Aiuta a guadagnare / capire?** Fornisce la base per registrare la versione dei parametri ovunque e non perdere dati. Non c'è rischio di ordini doppi in questo modulo.

**Sicuro?**
- `redact()` oscura i segreti registrati più alcuni schemi riconoscibili: token Telegram anche dentro `bot<TOKEN>/`, `sk-ant-…`, header Alpaca, `token=`.
- Il logger e il JSONL passano sempre da `redact`.
- Limite: un segreto di meno di 6 caratteri non viene registrato, per evitare falsi positivi. La password della dashboard deve averne almeno 12.

## 2. Broker e dati (veri e finti)

**Corretto?**
- `AlpacaBroker` ha l'URL paper come costante. Rifiuta le chiavi `AK…` anche se costruito direttamente.
- `paperSafetyProblems` controlla `secrets.ts` (ogni stringa) e tutte le variabili d'ambiente in cerca di host Alpaca diversi da paper e data.
- Numeri convertiti da stringa in un solo punto (`parseOrder`).
- Prezzi formattati con 2 decimali da 1 $ in su e 4 sotto. Alpaca rifiuta il sotto-centesimo (verificato con la sonda): l'arrotondamento lo fa la gabbia, prima.
- Ordini aperti letti in forma piatta (`nested=false`, gambe incluse) e deduplicati per id.
- `done_for_day` è trattato come aperto: per le protezioni è l'ipotesi prudente.
- Candele: `closedBars` scarta la seduta in corso finché non sono passati 16 minuti dalla chiusura (ritardo SIP). Test con una candela parziale.
- Finnhub: chiave nell'header (non nell'URL); limitatore a 48/min e 25/s; 429 → attesa di 61 s.

**Funziona?**
- 18 test sul broker finto: bracket, OCO, trailing, 403 con protezioni aperte, 422 sul duplicato, sotto-centesimo, mercato chiuso, persistenza.
- Sonda reale eseguita il 23/11/2026: tutti i campi verificati e scritti in `docs/campi-dati.md`.
- Rete che cade: `httpJson` distingue timeout, rete e HTTP. Chi chiama decide; per l'invio degli ordini il timeout non si riprova (modulo 6).

**Aiuta a guadagnare / capire?** Il broker finto riproduce i comportamenti che fanno perdere soldi: 403 sulle vendite, gambe eseguite durante la cancellazione, timeout con ordine arrivato. Così i test li coprono.

**Sicuro?**
- Gli errori HTTP portano solo origine e percorso dell'URL, oscurati.
- La sonda scrive nomi e tipi, mai i valori del conto. Unica eccezione: i flag di configurazione (`no_shorting`, `max_margin_multiplier`), che non sono sensibili.
- Rischio residuo: la sonda invia un ordine limit di prova (SPY a 1 $) sul conto paper e lo cancella subito. Si salta con `--senza-ordini`.

## 3. Indicatori

**Corretto?**
- SMA, ATR e ADX/DI di Wilder (prima somma, poi lisciatura `S − S/n + x`); Donchian e volume medio sulle sedute *precedenti*; RS allineata per data; resistenze come gruppi di ≥ 2 massimi locali entro l'1,5%.
- Valori di riferimento:
  - SMA e ATR calcolati a mano;
  - ADX = 100 e +DI = 66,67 su una serie sempre crescente (valori analitici);
  - coincidenza con un'implementazione indipendente nella forma "a medie" di Wilder.
- Limite onesto: nei test non c'è una tabella numerica pubblicata (es. il foglio di calcolo di StockCharts). Non la ricordo con certezza e non ho voluto inventarla.
- Rottura di resistenza: conta solo se nessuna chiusura successiva all'ultimo massimo del gruppo aveva già superato la soglia. Senza questa regola un titolo salito mesi fa "romperebbe" ogni giorno.

**Funziona?** 12 test, tutti verdi.

**Aiuta a guadagnare / capire?**
- I segnali sono deterministici e salvati per seduta, quindi riproducibili.
- Il controllo del prezzo (gap, SMA50, livello rotto) evita di comprare un'apertura già scappata o una rottura fallita.

**Sicuro?** Non tocca rete né segreti.

## 4. Scansione

**Corretto?**
- Universo: asset attivi, negoziabili, `us_equity`, NYSE/NASDAQ.
- Prefiltro con candele Alpaca chiuse: prezzo ≥ 5 $ e controvalore medio a 20 sedute ≥ 20 mln $. Così Finnhub viene interrogato solo sui titoli liquidi.
- ETF esclusi perché Finnhub non restituisce il profilo. Industria non mappata = titolo escluso e citato negli avvisi.
- Profili:
  - regola del 70% sui criteri *applicabili*, arrotondando per eccesso;
  - "non applicabile" e "non disponibile" sono tenuti distinti;
  - P/E e P/FCF negativi = non superato;
  - PEG da `pegTTM`, che la sonda ha trovato in 20 titoli su 20; se manca, PEG storico. Con crescita negativa il PEG storico è "non superato".
- Classifica: percentili per settore e profilo (sotto 5 titoli si usa tutto il profilo); vale il profilo migliore.
- Zona grigia: un solo criterio mancato, entro un passo della soglia.
- Settori deboli: migliori 3 per settore.
- Watchlist scritta in modo atomico. Se più del 10% dei titoli non ha dati, è marcata "incompleta" e lo dice.

**Funziona?**
- 11 test: payout 120%, banca, criterio mancante, 70%, PEG storico, utili negativi, zona grigia, nessun settore forte, scansione completa, ripresa dopo un'interruzione (solo le 23 richieste mancanti).
- Non ancora eseguita sul mercato vero: con circa 2.500 titoli servono 60–100 minuti. La lancio alla fine.

**Aiuta a guadagnare / capire?**
- I criteri non disponibili sono contati e riportati, non considerati superati.
- Rischio di autoinganno: la zona grigia e i settori deboli entrano nella watchlist, ma sono marcati e **non si comprano** (lo verifica la gabbia, modulo 5).

**Sicuro?** Lock separato (`scan.lock`), quindi non blocca le sveglie. La cache su disco non contiene segreti.

## 5. Gabbia

**Corretto?**
- Prezzi:
  - stop arrotondato per difetto, take profit per eccesso, 2 decimali da 1 $ (4 sotto);
  - stop verificato ad almeno 0,01 $ sotto il prezzo.
- Dimensionamento: `floor(min(peso × patrimonio, cash × 0,99) / prezzo)`. Il cash è diminuito degli acquisti aperti (+1% di margine per lo slittamento) e di quelli inviati nella stessa sveglia (`CassaSveglia`, mai sotto zero).
- Gabbia:
  - compra solo tra i candidati di questa sveglia;
  - gli acquisti aperti contano come posizioni; massimo 5 posizioni e 2 per settore;
  - briefing e chiusura non comprano; metà seduta compra solo se si è liberato un posto;
  - vende solo le posizioni con un'uscita debole segnalata, e solo all'apertura;
  - decisioni doppie scartate.
- Pause dagli ordini chiusi di Alpaca (30 giorni), non dal testimone:
  - stop in perdita: 10 sedute; altre uscite: 3;
  - se il prezzo d'acquisto non si trova, uno stop vale come stop in perdita (prudenza).
- Pause dai rifiuti, lette dal diario: stessa seduta bloccata; 2 rifiuti per lo stesso motivo → 5 sedute.
- Freno:
  - massimo dal `portfolio/history` con data di inizio esplicita (avvio o ultimo sblocco);
  - resta attivo finché non si sblocca dalla dashboard;
  - lo sblocco riporta il massimo al patrimonio attuale;
  - se il file va perso, si ricostruisce dal diario.

**Funziona?** 13 test (numeri 13, 16, 18, 34, 38 del contratto), più i test della sveglia che usano la gabbia dal vivo.

**Aiuta a guadagnare / capire?**
- Limita le perdite: il freno, le pause dopo uno stop e il limite per settore.
- Rischio residuo: le pause dopo i rifiuti valgono anche per i rifiuti della gabbia. È più prudente (meno ordini), ma un candidato buono può restare fermo 5 sedute. Vedi decisioni.

**Sicuro?** Nessun ordine parte da qui. La gabbia restituisce solo decisioni filtrate.

## 6. Sveglia

**Corretto?**
- Ordine del giro come nel §6, con una sola differenza voluta: protezioni e uscite forti si eseguono **prima** del cervello. Così vengono eseguite anche se il cervello fallisce.
- Lock con battito ogni 30 s, PID + ora di avvio (letta con `Get-Process`), id degli ordini scritti nel lock prima dell'invio.
- Lock morto: guardia atomica, rinomina, riconciliazione degli id. Anche i `run.lock.morto-*` rimasti da recuperi incompleti vengono riconciliati.
- Calendario:
  - orari NY dal calendario Alpaca, id in ora di Roma;
  - mezze giornate: resta la seconda di due sveglie a meno di 30 minuti;
  - una sveglia è "saltata" oltre 20 minuti dall'orario previsto, e lo si segnala una volta sola;
  - weekend e festivi non generano sveglie.
- Esecutore:
  - verifica per id **prima** di inviare;
  - timeout: niente nuovo invio, solo verifica per id (3 volte);
  - se l'id non si può verificare, non invia.
- Vendita: cancella, attende la conferma (10 s), rilegge la posizione, vende solo `min(qty, qty_available)`.
- Protezioni:
  - si confronta l'ordine con il **piano**, non con i parametri;
  - livelli diversi: PATCH; mancante o quantità diversa: cancella e ricrea (OCO o trailing), al massimo 3 tentativi;
  - più di 80 giorni: si ricrea all'apertura;
  - stop mobile ricreato con `trail_price` dal massimo registrato;
  - prezzo oltre lo stop: vendita (mai al briefing).
- Al briefing le protezioni esistenti non si modificano (solo la ricreazione di quelle mancanti), come dice il §5.
- Piano di uscita salvato **prima** dell'acquisto: se il processo muore, la sveglia dopo sa come proteggere.
- Con una posizione non protetta gli acquisti si bloccano finché non è risolta: è più prudente del contratto, vedi decisioni.

**Funziona?**
- 24 test del nucleo (calendario, lock, testimone, esecutore, protezioni).
- 17 test di accettazione della sveglia completa, con broker, dati e cervello finti: numeri 1, 2, 3, 8, 9, 16, 17, 18, 19, 20, 24, 34, 37, 46 del contratto.
- Rete che cade a metà:
  - ogni chiamata al broker in apertura è in un `try` → allarme e uscita;
  - un errore imprevisto in mezzo → allarme, lock rilasciato. La sveglia successiva ricostruisce tutto dal broker.

**Aiuta a guadagnare / capire?**
- Rischi coperti: ordini doppi (id + lock), posizioni senza protezione (controllo a ogni sveglia), dati vecchi (watchlist con più di 8 giorni, candela in corso scartata).
- Rischio residuo: tra l'esecuzione del bracket e l'attivazione delle gambe Alpaca, la protezione dipende dal broker.

**Sicuro?** Le azioni passano tutte dall'esecutore sotto lock. I log passano da `redact`.

## 7. Cervello

**Corretto?**
- Comando costruito sui flag letti da `claude -p --help`, quindi senza `--max-turns` (che non esiste) e senza `--bare`.
- Prompt via stdin, cwd in `%LOCALAPPDATA%\IndianoTrading\brain-cwd`, `--setting-sources project`, `--safe-mode`, `--system-prompt`.
- La sonda conferma che il cervello non vede `CLAUDE.md` né la memoria dell'utente.
- Risposta validata a mano: simboli, azioni ammesse, niente quantità.
- Consumi:
  - registrati a ogni chiamata, anche fallita;
  - costo da `total_cost_usd` e token da `modelUsage`;
  - timeout e costi azzerati → "non misurato" (null), mai zero.
- Budget:
  - avvisi all'80% e al 100% una volta per mese;
  - "sospendi" → il cervello non viene chiamato;
  - 2 chiamate di fila oltre il tetto → allarme dedicato.

**Funziona?**
- 11 test (numeri 43, 45, 46 del contratto).
- Chiamata reale fatta dalla sonda: esito ok, 0,027 $, 3 turni.

**Aiuta a guadagnare / capire?** Il modello sceglie solo tra opzioni già ammesse, e la gabbia ricontrolla tutto. Un errore del modello non può far comprare un titolo fuori lista.

**Sicuro?**
- Il token OAuth passa nell'ambiente del processo figlio, mai nella riga di comando.
- Il prompt contiene solo dati di mercato e del conto, mai le chiavi.

## 8. Telegram

**Corretto?**
- HTML con `&`, `<`, `>` convertiti in ogni testo variabile.
- Spezzatura sotto i 4096 caratteri tra le righe, senza tagliare le entità.
- 429 → attesa di `retry_after` (al massimo 2 volte).
- `send` non lancia mai: un errore va nel log e la sveglia continua (test 9).
- Pulsanti: `rv:a:<id>` / `rv:r:<id>` (meno di 64 byte). Si accettano solo quelli di `chatId`; l'offset è salvato.
- Un solo lettore: `leggiPulsanti`, chiamato solo dalla dashboard.

**Funziona?** Test sul pulsante da un'altra chat, sull'approvazione e sul clic riletto (test 28). Il token oscurato anche negli errori di rete è coperto dal test 11 nel modulo 2.

**Aiuta a capire?** Ogni messaggio porta l'id della sveglia e affianca SPY al P&L del giorno.

**Sicuro?** Il token sta solo nell'URL di `fetch`, e ogni errore passa da `redact`.

## 9. Diario, schede, ombra, simulatore

**Corretto?**
- Diario JSONL solo in aggiunta, sotto lock. Le operazioni ombra stanno in file separati (`ombra-AAAA-MM.jsonl`): non si possono mescolare.
- Scheda d'ingresso con la fotografia completa: criteri, segnale, forza del settore su tutti e tre i periodi, punteggio, motivazione, versione dei parametri, piano, e 300 candele `all` + 300 candele `split`.
- Scheda d'uscita: motivo, R, mfe/mae dal percorso salvato, SPY (rettificato per i dividendi) nello stesso periodo, trimestrale.
- Simulatore:
  - prima l'uscita con i livelli di ieri, poi il massimo;
  - stop = min(apertura, stop) e tp = max(apertura, tp); stop e tp nello stesso giorno → stop;
  - uscita forte all'apertura del giorno dopo; durata massima 250 sedute.
- Operazioni ombra:
  - ingresso all'apertura della seduta dopo il segnale, con lo stesso controllo del prezzo;
  - una ogni 10 sedute per titolo;
  - le candele si salvano appena lette.
- Nessun look-ahead: la decisione ombra usa solo il segnale (candele precedenti) e l'apertura del giorno d'ingresso.

**Funziona?** Test 24 (scheda, uscita, "simulazione in corso" che si chiude da sola) e ombra separate. Il simulatore è testato anche dentro i test dell'apprendimento.

**Aiuta a capire?**
- Rende misurabile tutto, anche le alternative (bracket contro trailing).
- Rischio di autoinganno: il giorno d'ingresso di un'operazione reale la simulazione considera tutta la candela, anche la parte prima dell'acquisto (ipotesi prudente).

**Sicuro?** Nessun segreto nel diario: le righe passano da `redactJson`.

## 10. Apprendimento

**Corretto?**
- Statistiche reali e ombra separate.
- Suddivisioni per profilo, settore, conferme, ADX, motivo di uscita, durata e versione dei parametri.
- Confronto bracket/trailing solo su risultati simulati.
- Valutazione dei filtri "per differenza": +R le operazioni aggiunte, −R quelle escluse.
- Livelli di uscita: ΔR operazione per operazione sugli stessi percorsi, con la stessa unità di R.
- Controlli:
  - n ≥ 30;
  - effetto ≥ 0,1 R;
  - IC bootstrap corretto con Bonferroni (sul numero di confronti testati) che esclude lo zero nei primi 2/3 e nell'ultimo terzo;
  - al massimo 2 proposte, un passo ciascuna;
  - sicurezza mai proposta;
  - campione piccolo = solo resoconto.
- **Errore trovato e corretto:** confrontare i livelli di uscita solo sulle simulazioni chiuse era una distorsione di selezione. Con dati casuali il take profit 20→25% passava i controlli nel 15% delle review. Ora le simulazioni aperte si valutano all'ultima chiusura: 0 proposte su 40 review casuali.
- Approvazione idempotente (lock delle proposte, controllo dello stato e del valore attuale). Scadenza a 7 giorni.
- Prima riga "rende meno di SPY" dopo 60 sedute di attività.

**Funziona?** 8 test: casuale senza vantaggio, vantaggio reale trovato, campione piccolo, sicurezza, 20/40 sedute, pulsanti, doppia approvazione, scadenza.

**Aiuta a guadagnare / capire?**
- Il rischio principale è l'autoinganno su campioni piccoli. La combinazione Bonferroni + due metà + soglia di effetto rende rare le proposte (voluto).
- Limite: le operazioni ombra "quasi" sono correlate con quelle reali (stessi giorni di mercato), quindi il bootstrap per operazione sovrastima l'indipendenza.

**Sicuro?** Le proposte cambiano i parametri solo con `saveParams` (validazione e controllo di versione).

## 11. Dashboard

**Corretto?**
- Accesso e protezioni:
  - `Bun.serve` su `127.0.0.1` (costante);
  - header `Host` controllato, contro il DNS rebinding; `Origin` controllato sui POST;
  - password da `secrets.ts` (minimo 12 caratteri), confrontata in tempo costante, con blocco di 5 minuti dopo 10 errori;
  - cookie `HttpOnly; SameSite=Strict`, sessioni in memoria di 12 ore;
  - CSRF su ogni POST;
  - CSP senza sorgenti esterne, nessuna libreria esterna.
- Panoramica:
  - patrimonio, cash, investito, posti liberi;
  - P&L di oggi, settimana, mese e dall'inizio, ciascuno affiancato a SPY;
  - grafico del patrimonio con SPY indicizzati a 100: un solo asse, come richiedono le regole dei grafici;
  - stato del bot e riquadri delle posizioni con la barra stop/prezzo/take profit.
- Dettaglio posizione:
  - perché è stata comprata (criteri, indicatori, conferme, punteggio, motivazione);
  - protezioni, grafico dall'ingresso con i livelli, profitto atteso;
  - valore atteso solo con almeno 20 operazioni chiuse, altrimenti "non stimabile";
  - azioni manuali con conferma; cronologia degli eventi.
- Storico: filtri; operazioni manuali tenute a parte. Ombra: scheda separata, marcata "simulate".
- Review: proposte in attesa con Approva/Rifiuta, versioni dei parametri con i loro risultati, ripristino.
- Impostazioni:
  - tutti i parametri raggruppati, con descrizione, valore iniziale, intervallo e ultima modifica;
  - anteprima delle differenze, poi conferma; validazione e conflitto di versione;
  - interruttori: pausa acquisti, sblocco del freno, ripristino dei valori iniziali.
- Consumi AI:
  - riquadri, grafico impilato per tipologia (costo, token o chiamate; giorno, settimana o mese), spaccato con totale = somma delle righe, tabella per modello;
  - rapporto con il trading, proiezione del mese, ultime 50 chiamate, filtri e CSV;
  - la nota di onestà sul costo stimato è nella scheda, ben visibile.
- Azioni manuali: stesso esecutore e stesso lock (attesa fino a 60 s), id `AAAA-MM-GG-SIMBOLO-manual-<codice>` con il codice generato quando la pagina mostra il modulo.

**Funziona?**
- 10 test: 401 senza sessione, 403 senza CSRF, host estraneo 421, password errata, cookie, nessun segreto nelle pagine, tutte le pagine con dati finti, doppio clic, "bot occupato", chiudi all'apertura, giorno di Roma nei cambi d'ora, totali, CSV identico.
- Prova dal vivo con `bun run dashboard --fake`: tutte le pagine rispondono 200.

**Aiuta a guadagnare / capire?**
- Il confronto con SPY è ovunque; le operazioni simulate sono sempre etichettate.
- Rischio residuo: le sessioni sono in memoria. Un riavvio della dashboard chiede di rifare l'accesso (prudente).

**Sicuro?**
- Le pagine non contengono segreti (test con un errore che ne contiene uno).
- Il log di una sveglia si mostra ripassato da `redact`.

## 12. Pianificazione

**Corretto?** `scripts/installa-pianificazione.ps1` registra tre attività:
- **tick**: ogni 5 minuti, lun–ven 09:00–23:00, riattiva il computer, tempo massimo 20 minuti, `MultipleInstances IgnoreNew`;
- **scansione**: sabato 10:00, tempo massimo 3 ore (lo `scan` del sabato fa poi il controllo della review);
- **dashboard**: all'accesso, in un ciclo che la riavvia dopo 15 secondi se si chiude, più il riavvio automatico dell'Utilità di pianificazione.
- Il PATH dell'attività include `~/.bun/bin` e `~/.local/bin`, perché `claude` va trovato anche fuori da VS Code.
- `-Rimuovi` cancella le attività.

**Funziona?**
- Sintassi verificata con il parser di PowerShell. **Non l'ho eseguito**: lo lancia l'utente, come da istruzioni.
- `tick` e `once` sono provati dal vivo in modalità finta.

**Aiuta?** Senza tempo massimo un tick bloccato fermerebbe tutti i successivi: qui il limite è di 20 minuti.

**Sicuro?**
- Attività con l'utente interattivo e privilegi limitati: nessuna password salvata.
- Limite: le attività girano solo con l'utente connesso.

## Bug trovati durante la prova dal vivo (e corretti)

- **Pausa dopo un rifiuto strutturale.** Al briefing il cervello finto proponeva un acquisto, la gabbia lo rifiutava ("il briefing non fa ingressi") e quel rifiuto metteva il titolo in pausa per tutta la seduta. Così non si sarebbe comprato nemmeno all'apertura.
  - Ora i rifiuti `gabbia-*` restano nel diario e nelle lezioni ma non generano pause.
  - Aggiunto un test che riproduce il caso.
- **Sveglie "saltate" alla prima esecuzione.** Alla prima sveglia in assoluto venivano segnalate come saltate le sveglie dei giorni precedenti all'avvio del bot. Ora no.
- **Messaggio senza il perché.** Il messaggio non diceva perché non c'erano candidati. Ora riporta "candidati ammessi N su M" con i motivi principali degli scarti.

## Insieme

**Corretto?**
- I 47 test di accettazione del contratto sono coperti da test automatici, tranne:
  - il **5** "mezza giornata", coperto dal calendario ma non con una sveglia completa;
  - il **26**, in cui "avviata a 40 sedute" è verificato con `statoReview` e una review reale su dati finti.
- Il **10** (chiave `AK…` o URL live → il programma non parte) passa da `buildRuntime`: nessun comando reale parte senza `assertPaperSafety`.
- Problema trovato nell'auto-review finale e corretto: un errore nella scrittura del battito dentro `setInterval` poteva uccidere il processo a metà sveglia. Ora è intercettato.
- Casi limite gestiti:
  - dati mancanti → "non disponibile" e nessun acquisto;
  - mercato chiuso → niente vendite, protezioni lasciate attive;
  - mezza giornata, ora legale, esecuzione parziale (quantità riletta, protezione ricreata);
  - timeout (mai un nuovo invio senza verifica per id);
  - file corrotti (testimone, parametri, piani, freno);
  - doppio lancio (lock + id deterministici).

**Funziona?**
- `bun test`: 161 test verdi, stabili su 3 giri consecutivi (compresi i guasti con processi veri uccisi per PID).
- Prove dal vivo in modalità finta: `scan`, `once` (briefing, apertura, metà seduta), `dashboard`.
- Prove reali: `probe`, poi la scansione completa e `once --slot briefing` sul conto paper (vedi resoconto finale).

**Aiuta a guadagnare, o almeno a capire se si guadagna?**
- Ogni resoconto affianca SPY.
- Reali e ombra sono separati per costruzione: file diversi.
- La review propone poco, ed è voluto: su dati casuali 0 proposte su 40.
- Rischi di perdita affrontati: ordini doppi, posizioni non protette, dati vecchi, short accidentali (vendita sempre sulla quantità riletta, `no_shorting` imposto e verificato).

**Sicuro?**
- Segreti solo importati: nessun valore stampato.
- `redact` su log, diario, messaggi, pagine ed errori.
- La dashboard è solo su 127.0.0.1, con password, sessione e CSRF.
- Ogni ordine passa dall'esecutore sotto lock, sia dalle sveglie sia dalla dashboard.

## Limiti conosciuti

- **Gap di apertura.** Stop e stop mobile scattano solo in seduta regolare: un gap sotto lo stop esce al prezzo di apertura, anche molto più in basso. Il simulatore lo modella (`min(apertura, stop)`); il conto paper non sempre.
- **Esecuzioni ideali del conto paper.** Alpaca paper esegue senza impatto sul mercato e con slittamento minimo: i risultati reali sarebbero peggiori. L'ombra usa uno slittamento dello 0,1%, che è comunque una stima.
- **Campioni piccoli.** Con 5 posizioni di settimane servono mesi per 30 operazioni chiuse. Fino ad allora la review fa solo il resoconto. Il bootstrap tratta le operazioni come indipendenti, ma operazioni dello stesso periodo sono correlate (stesso mercato): la confidenza reale è più bassa di quella dichiarata.
- **Criteri non disponibili con Finnhub gratuito.** Crescita EPS del prossimo anno e dei prossimi 5 anni (stime degli analisti): sempre "non disponibile". FFO dei REIT: il payout dei REIT è "non disponibile". Il PEG arriva da `pegTTM`. I dati Finnhub non sono "point-in-time" e possono essere rivisti.
- **Fuori da questa versione (§13):** notizie macro e analisi delle notizie; backtest storico sui fondamentali; pattern grafici e trendline; stime degli analisti; accesso alla dashboard da fuori dal computer; acquisti manuali dalla dashboard; conto reale.
- **Costi AI.** Il costo è una stima del client (Claude Code). Con l'abbonamento è il costo equivalente a consumo, e i limiti dell'abbonamento non si vedono.
- **Lettura dei pulsanti.** Se la dashboard resta spenta più di 24 ore, i clic su Telegram si perdono: si approva dalla dashboard.
- **Attività pianificate.** Girano solo con l'utente connesso. "Riattiva il computer" richiede i timer di riattivazione abilitati nelle opzioni di risparmio energia.
- **Indicatori.** Verificati con valori calcolati a mano, valori analitici e un'implementazione indipendente, non con una tabella numerica pubblicata.
- **Lunghezza della scansione.** Circa 2.200 titoli dopo il prefiltro: 60–90 minuti con Finnhub gratuito (meno nelle settimane in cui i profili sono in cache).

## Sessione dei guasti (avvocato del diavolo)

Test in `tests/guasti.test.ts`. I guasti 1, 2 e 5 usano processi bun veri, uccisi per PID con SIGKILL (TerminateProcess su Windows), e il riconoscimento reale dei processi (`Get-Process` su Windows, `/proc` su Linux).

| Guasto | Cosa succede davvero | Esito |
| --- | --- | --- |
| 1. Kill dopo il primo ordine, poi rilancio | Sul broker 1 acquisto; il lock resta. Al rilancio: lock morto riconosciuto, id riconciliato ("arrivato, filled"), allarme. Alla fine 5 titoli, **ognuno comprato una volta**, tutti protetti. | **Bug trovato:** la posizione comprata prima del kill non aveva la scheda nel diario. Corretto nel codice (decisione 25). |
| 2. Due sveglie a 0,5 s di distanza | Una "eseguita", l'altra "sveglia già in corso". 5 acquisti, uno per titolo, lock rilasciato. | Tiene. |
| 3. Alpaca muto per 30 s durante l'invio | Ordine arrivato: 1 sul broker, nessun reinvio. Ordine perso: 0, nessun reinvio. Il giorno dopo un solo ordine per titolo, tutti protetti. | **Bug trovato:** l'allarme diceva "senza risposta" anche per un ordine mai partito. Corretto (decisione 26). |
| 4a. JSON troncato | Nessun acquisto, protezioni eseguite, allarme, consumo registrato. | Tiene. |
| 4b. Campo mancante (`reasoning`) | Come sopra ("risposta non valida"). | Tiene. |
| 4c. Quantità negativa | Il campo viene ignorato: il codice non legge mai quantità dal modello. La quantità è quella calcolata dal dimensionamento. | Non è un problema reale, nessuna modifica. |
| 5. Kill mentre si salva `baton.json` (6 kill in momenti diversi) | Il testimone si legge sempre. Al massimo resta un file `.tmp-` orfano. | Tiene. I `.tmp` orfani non sono un problema reale: nessuno li legge e nascono solo da un crash. |
| 6a. Chiusura che "parte" alle 22:05 (solo pianificatore) | Il tick non la esegue (oltre 20 minuti), nessun ordine; il briefing dopo la segnala saltata e non vende. | Tiene. |
| 6b. Chiusura lanciata a mano alle 22:05 | Nessun ordine a mercato chiuso. La posizione sotto lo stop resta, con allarme "non protetta" e vendita rimandata all'apertura. La chiusura saltata si segnala una volta sola. | Tiene. La prima versione del test si aspettava la segnalazione anche il mattino dopo: era sbagliata l'aspettativa (il contratto dice "si segnala", una volta), non il codice. |

Limiti di questa sessione:
- Il guasto 3 usa un orologio finto, quindi i 30 s non sono reali. Il client Alpaca vero ha un timeout di 15 s sull'invio e segue la stessa strada (`BrokerError` di tipo timeout).
- La lettura di `/proc` è testata su Linux con un file di esempio; i kill su Linux li esegue la CI (`ubuntu-latest`, `ubuntu-24.04-arm`).

### Aggiunte dopo la prova reale

- **Guasto 2, ripreso.** Sotto il carico della suite completa il test del doppio lancio è fallito una volta: la seconda istanza aveva letto lo stato prima che la prima finisse e preso il lock dopo. Corretto nel codice (decisione 29), con il test deterministico 2b. Poi 3 giri completi della suite, 161/161 ogni volta.
- **Prova reale sul conto paper** (`once --slot briefing`, 23/11/2026):
  - il primo giro ha trovato il 400 su `portfolio/history` (decisione 27) e il "SPY oggi" sbagliato (decisione 28);
  - il secondo giro è stato pulito: configurazione del conto `no_shorting=true`, `max_margin_multiplier=1`; cervello reale ok, 0,007 $; 0 candidati su 21 (nessuno supera i segnali d'ingresso); nessun ordine.
- **Dashboard reale:** le pagine rispondono 200 con i dati del conto e la watchlist reale.

## Dashboard: Dusk, bklit e motion

**Corretto?**
- I grafici bklit si montano come isole sopra un grafico SVG di riserva generato dal server. Provato in Edge senza interfaccia: 5 isole su 5 montate, nessun errore in console (dopo aver tolto le barre orizzontali con i negativi).
- Il server non importa React: le dipendenze riguardano solo il bundle del browser.
- La CSP resta `script-src 'self'`, perché il bundle è servito dalla dashboard.

**Funziona?**
- 168 test, compresi i nuovi: review cliccabile, schede, spiegazioni, modello osservato, menu del telefono, bundle servito e isole nella pagina.
- Viste in browser vero: panoramica a 1440 px e a 390 px, impostazioni, dettaglio della review.

**Aiuta a capire?**
- Il grafico principale è il rendimento contro SPY.
- La curva è monotona, quindi non disegna oscillazioni che nei dati non ci sono.
- La ciambella ha una legenda con valori e percentuali: l'identità non dipende dal solo colore.

**Sicuro?**
- Le nuove dipendenze girano solo nel browser della dashboard, su dati già mostrati in pagina; nessun segreto passa da loro.
- Rischio residuo: il bundle compilato è codice di terzi (React, motion, d3, bklit) che va aggiornato quando escono correzioni di sicurezza.

**Limiti:**
- Il bundle pesa 503 KB.
- Bun compila due file di bklit nella modalità JSX "classica": funzionano, ma è un'avvertenza da rivedere a ogni aggiornamento di bklit.

## Conferme a 1, segnali per versione, traccia delle modifiche manuali (23/11/2026)

1. **È corretto?**
   - Il cambio dei parametri passa da `saveParams`: versione nuova, controllo del conflitto, diario. Nessuna scrittura diretta su `params.json`.
   - Caso limite: parametri cambiati dopo il calcolo dei segnali del giorno. Prima la sveglia avrebbe applicato le soglie vecchie; ora si ricalcolano sulle stesse candele chiuse. Senza dati nuovi non c'è look-ahead.
2. **Funziona?**
   - Test nuovi: ricalcolo dei segnali al cambio di versione, e motivo ADX che dice quale condizione manca.
   - Eseguito sul conto paper reale: la sveglia forzata `2026-11-23-1559` ha ricalcolato i segnali con v3. Esito: 0 candidati, perché nessun titolo aveva rotture sulla candela del 20/11.
3. **Aiuta a guadagnare, o a capirlo?**
   - Più segnali, quindi più operazioni da misurare. Il rischio di peggiorare il risultato è dichiarato nella nota della v3 ed è da verificare in review.
   - Le modifiche fatte a mano restano visibili, con i risultati prima e dopo, così non si attribuisce alla strategia un effetto che dipende dal cambio. Lo studio di frequenza non entra nelle statistiche.
4. **È sicuro?** Nessun segreto nei testi nuovi. La gabbia è invariata: il cambio tocca solo un parametro di strategia, entro il suo intervallo (1–4).

## Pagina Selezione e comando `avvia` (23/11/2026)

1. **È corretto?**
   - **Selezione:** legge solo watchlist e segnali, quindi non può toccare ordini, gabbia o lock. Un titolo fuori selezione apre una pagina chiara, non un errore. Se mancano le candele il dettaglio dice "non disponibile" e non inventa niente.
   - **`avvia`:** i casi limite sono la chiusura di un figlio (riavvio dopo 15 secondi, al massimo 5 in un'ora) e la morte del padre (i figli se ne accorgono e si chiudono). Un doppio avvio resta protetto: il lock delle sveglie vale anche tra due motori, e una seconda dashboard trova la porta occupata e si ferma dopo 5 tentativi.
2. **Funziona?**
   - **Test:** selezione con segnali calcolati sul momento, pagine aperte con la posizione dello scenario, nessun segreto nelle pagine.
   - **Prova con i dati reali:** anteprima su un'altra porta senza lettore Telegram, vista nel browser su desktop e a 390 pixel.
   - **Prova di `avvia` in modalità finta:** avvio, riavvio della dashboard uccisa, chiusura dei figli alla morte del padre.
3. **Aiuta a guadagnare, o a capirlo?** Rende verificabile perché il bot può comprare un titolo, e perché oggi non lo compra. Non cambia nessuna decisione.
4. **È sicuro?**
   - **Selezione:** passa dall'autenticazione come le altre pagine. Il simbolo nell'indirizzo è ripulito dai caratteri non ammessi, e i testi passano dall'escape dei modelli HTML.
   - **`avvia`:** l'output dei figli passa da `redact()`.

## Resoconto di fine giornata e pagina Guida (24/11/2026)

1. **È corretto?**
   - Distanze calcolate dal prezzo attuale, verificate con valori di riferimento nei test. Ad esempio, con ingresso 100, prezzo 110, stop 90 e take profit 120: stop a −18,18% (−200 $), take profit a +9,09% (+100 $), al 67% del percorso.
   - Il trailing usa `livelloStop`, lo stesso livello della verifica delle protezioni.
   - I casi limite (oltre lo stop, piano mancante, prezzo mancante) hanno un test.
2. **Funziona?** C'è un test della sveglia di chiusura completa con una posizione aperta e il parametro delle posizioni spento. La Guida è vista nel browser con i dati reali.
3. **Aiuta a guadagnare, o a capirlo?** Il resoconto fa vedere ogni sera quanto rischio e quanto margine resta su ogni posizione. La Guida rende verificabili le regole. Nessuna delle due cambia una decisione.
4. **È sicuro?** Nessun dato sensibile nuovo. I simboli passano da `esc()` nel messaggio Telegram e dall'escape dei modelli nella pagina.

## Override, scansione manuale, universo e impatto, grafici a periodi (24/11/2026)

1. **È corretto?**
   - Gli override si applicano in una sola funzione (`applicaOverride`), usata sia dalla sveglia sia dalla dashboard, senza modificare il file della watchlist.
   - Casi limite: aggiunto non più in zona grigia (sospeso), tolto non più scelto (resta finché lo annulli), doppio clic (rifiutato), simbolo fuori lista (rifiutato).
   - Universo: i valori iniziali riproducono il comportamento di prima. La sede mancante con un filtro attivo esclude il titolo.
2. **Funziona?** I test coprono:
   - override puri e azioni con diario;
   - una sveglia che compra l'aggiunto e non il tolto;
   - le azioni dalla dashboard, con CSRF e redirect solo interno;
   - la scansione manuale, con un lanciatore finto;
   - i 4 periodi del grafico;
   - l'anteprima con la stima, e il salvataggio rifiutato senza stima;
   - la scansione con «solo NASDAQ» e con i filtri di sede.

   Con i dati reali ho provato la stima su tre casi: NYSE American (+75 titoli stimati, consumo AI invariato), solo USA (2.187 → 1.855), candidati 10 → 20 (+14,73 $ al mese nel caso peggiore). Ho anche visto le pagine nel browser.
3. **Aiuta a guadagnare, o a capirlo?**
   - Gli override danno controllo, ma rischiano di confondere il risultato: per questo sono marcati e misurati a parte.
   - La stima evita di scoprire il costo di un cambio dalla fattura.
4. **È sicuro?**
   - Le azioni nuove passano dall'autenticazione e dal token CSRF, e il redirect resta dentro `/selezione`.
   - Nessuna azione nuova manda ordini, quindi gabbia e lock non si possono aggirare.
   - La scansione manuale si avvia senza shell, con argomenti fissi.

## Configurazione guidata e recupero delle sveglie (24/11/2026)

Revisione fatta anche da due agenti esterni, senza contesto sul progetto, che hanno attaccato il codice con test usa e getta, sempre con servizi finti. Tutto quello che hanno trovato è corretto, e ogni problema ha un test di regressione in `tests/revisione.test.ts`.

**Recupero delle sveglie: problemi trovati e corretti**
- **Recuperi a catena:** si recuperava l'apertura, poi al tick dopo anche la metà seduta. Ora le altre sveglie saltate di oggi diventano "concluse" insieme alla recuperata.
- **Sveglia lanciata a mano con `once`:** il recupero non la vedeva, e poteva fare un secondo giro di acquisti. Ora una forzata di oggi vale come fatta per il suo tipo.
- **Id delle forzate:** potevano coincidere con quello di una sveglia prevista (una forzata lanciata alle 15:40 prendeva l'id dell'apertura). Ora hanno il suffisso `f`.
- **Lock bloccato:** produceva un allarme Telegram a ogni tick, per tutto il giorno. Ora durante il recupero si registra solo nel log; l'allarme lo mandano le sveglie previste.
- **Recupero interrotto da un processo ucciso:** non si ritentava mai, con il rischio di lasciare una posizione senza protezione. Ora si riprende una volta (tentato due volte al massimo; concluso = mai più).
- **File degli override illeggibile:** i titoli tolti a mano tornavano comprabili in silenzio, e il salvataggio successivo cancellava gli altri override. Ora la sveglia non compra e manda un allarme, la dashboard non lo sovrascrive e la pagina Selezione lo segnala.
- **Accettato e documentato:** una sveglia fallita nella sua finestra (ad esempio con il broker giù) viene ritentata una volta come recupero. Gli id degli ordini sono gli stessi, quindi nessun doppione.

**Configurazione guidata: problemi trovati e corretti**
- **`secrets.ts` scambiato per assente:** un file scritto a mano che importa un modulo mancante veniva preso per assente e poi sovrascritto. Ora "assente" significa solo che il file non esiste; negli altri casi il bot si ferma e lo dice.
- **Codice bloccato da un altro sito:** una pagina web qualunque poteva consumare i tentativi del codice e bloccarlo. Ora un GET con il codice vale solo come navigazione diretta.
- **Tentativi in parallelo:** aggiravano il limite di 10. Ora si contano prima dell'attesa.
- **Codice riutilizzabile:** rientrare con il codice buttava fuori la sessione aperta, e il codice era scritto nel log. Ora non si butta fuori nessuno, e il codice sta in `state/codice-configurazione.txt`, con permesso 600 su Linux, cancellato alla fine.
- **Codice con caratteri non ASCII:** dava un errore 500. Ora il confronto è a byte.
- **Metodi HTTP diversi da GET e POST:** ora rispondono 405.
- **Porta 80 o 0:** gli host ammessi ora si calcolano dalla porta vera.
- **File temporaneo con le chiavi:** era fuori da `.gitignore`. Ora `secrets.ts.*` è escluso e il temporaneo si cancella se la scrittura fallisce.
- **`secrets.ts` incompleto riscritto:** ora se ne tiene una copia accanto, anch'essa esclusa da git.
- **Motore sulle chiavi vecchie:** se la configurazione cambiava le chiavi, il motore continuava con quelle di prima. Ora il motore si riavvia se `secrets.ts` cambia.
- **Controllo di Claude Code:** si poteva bloccare perché nessuno leggeva l'uscita di errore. Ora viene letta.

**Cosa ha retto agli attacchi**
- Nessuna chiave è mai arrivata al browser o in un messaggio d'errore.
- Valori ostili (U+2028/2029, NUL, BOM, `${}`, `*/`, virgolette) producono un file valido, che si rilegge identico.
- La chiave live (AK) viene rifiutata prima di qualsiasi chiamata.
- Restano solidi: CSRF, controllo dell'origine, controllo dell'host, codice di riavvio 75 e limiti di riavvio.
- Sul recupero hanno retto:
  - ora legale fuori sincrono tra USA ed Europa, mezze giornate, festivi;
  - dopo mezzanotte a Roma si recupera la seduta di New York ancora in corso;
  - due tick insieme: una sola esecuzione;
  - dopo l'orario della chiusura il recupero non compra mai.

## Prima scansione automatica, avanzamento in diretta, controllo vero di Claude (24/11/2026)

1. **È corretto?**
   - La scansione automatica parte solo se manca la lista e non c'è un lock di scansione vivo.
   - Più riavvii della dashboard non lanciano due scansioni: la scansione ha il suo lock. Se il riavvio cade nel secondo prima che il processo prenda il lock, il secondo processo trova il lock e si ferma.
   - Lo stato «appena lanciata» dura al massimo 20 secondi e finisce prima se la lista viene riscritta, così una scansione molto rapida non resta «in corso» per finta.
   - Il controllo di Claude distingue tre casi: non installato, installato senza accesso, accesso rifiutato alla prova.
2. **Funziona?**
   - Test nuovi:
     - JSON di avanzamento dietro la sessione (401 senza sessione);
     - scheda che si aggiorna senza «Aggiorna», anche in Panoramica, e fine scansione vista dalla pagina;
     - scansione iniziale: parte solo senza lista e senza un'altra scansione in corso;
     - Claude: assente, senza accesso (niente domanda di prova), token rifiutato (il token non compare nell'errore e va nell'ambiente del processo), solo controlli veloci, percorso completo della configurazione con la prova.
   - Prova reale su questo PC, con i soli controlli veloci: risponde «installato ma non hai fatto l'accesso», che è proprio la situazione del comando `claude` qui.
   - La domanda di prova vera non l'ho eseguita: senza accesso fallirebbe comunque.
   - 230 test verdi.
3. **Aiuta a guadagnare?**
   - Un'installazione nuova non resta ferma fino al sabato.
   - Il bot non parte con un cervello che non risponde senza che la configurazione lo dica.
   - Nessun rischio di ordini: la scansione non compra.
4. **È sicuro?**
   - Il token incollato viene registrato in `redact` prima di qualsiasi comando ed entra solo nell'ambiente del processo figlio, mai negli argomenti.
   - L'endpoint di stato espone solo fase e conteggi.
   - La scansione automatica usa lo stesso lancio del pulsante, staccato dalla dashboard.
