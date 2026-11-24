# Decisioni prese dove il contratto non bastava

Formato: data — dubbio — scelta — motivo. Si sceglie sempre l'opzione più prudente.

## 23/11/2026

1. **Modalità `--fake`: dove salvare lo stato.**
   - Scelta: radice separata `fake/` (con `state/`, `logs/`, `cache/` propri), aggiunta al `.gitignore`.
   - Motivo: le operazioni finte non devono mai finire nel diario o nelle statistiche reali.

2. **Flag `--max-turns` di `claude -p`.**
   - Dubbio: CLAUDE.md lo indica, ma `claude -p --help` (versione 2.1.325) non lo elenca.
   - Scelta: il codice legge l'help una volta, salva l'elenco dei flag in cache e passa `--max-turns` solo se esiste.
   - Motivo: un flag sconosciuto farebbe fallire ogni chiamata. Con `--tools ""` il modello non ha strumenti, quindi non può fare giri a vuoto.

3. **Soglie fondamentali "< x" (debito/patrimonio, P/E, PEG, P/FCF) e payout.**
   - Dubbio: il §7.4 parla solo di soglie "> x".
   - Scelta: stessa regola delle "> x": passo ±10% di x, intervallo ±50% del valore iniziale.
   - Motivo: è la regola più vicina e la più simmetrica.

4. **Passi dei parametri di sicurezza.**
   - Dubbio: il contratto non li indica.
   - Scelta: peso 1 punto percentuale, posizioni 1, posizioni per settore 1, freno 1 punto percentuale.
   - Motivo: la review non ha un metodo per valutarli sulle operazioni in R. Quindi non li propone mai, e lo scrive nella review. Si possono cambiare solo dalle impostazioni.

5. **Industrie Finnhub ambigue.** La sonda ha visto 36 industrie, tutte mappate.
   - "Retail" va in Consumer Cyclical, tranne un elenco di distributori di beni di prima necessità (WMT, COST, KR, DG, DLTR, …) che va in Consumer Defensive.
   - "Communications" (Cisco, Arista, Motorola) va in Technology: sono apparati di comunicazione, IT nel GICS.
   - "Electrical Equipment" (Amphenol, TE, Corning, Eaton) va in Industrials, anche se alcuni di questi titoli nel GICS sono IT.
   - "Packaging" va in Basic Materials.
   - Motivo: la classificazione più vicina al GICS, che è anche quella degli ETF di settore.

6. **Gap al momento dell'acquisto.**
   - Dubbio: il gap si misura sull'apertura o sul prezzo attuale?
   - Scelta: |prezzo attuale − chiusura precedente| ≤ 1 ATR, a ogni sveglia che compra.
   - Motivo: copre sia il gap di apertura sia la corsa durante la seduta. È più severo, quindi più prudente.

7. **Volume medio per le conferme.**
   - Scelta: media delle 20 sedute *precedenti* alla candela del segnale.
   - Motivo: confrontare il volume del giorno con una media che lo include attenuerebbe il segnale.

8. **Rottura di resistenza.**
   - Scelta: vale solo se la chiusura supera il livello dello 0,5% e nessuna chiusura dopo l'ultimo massimo del gruppo l'aveva già superato.
   - Motivo: altrimenti una resistenza superata mesi fa conterebbe come rottura ogni giorno.

9. **Lock morto: ordine delle operazioni.**
   - Dubbio: il contratto dice "riconcilia, manda un allarme, poi crea il tuo lock".
   - Scelta: chi vince il recupero crea subito il proprio lock e riconcilia subito dopo, ancora dentro il lock.
   - Motivo: tra il recupero e la creazione nessun altro processo può partire. La riconciliazione è comunque fatta prima di qualsiasi ordine.
   - La gara è decisa da un file di guardia `run.lock.recupero`, creato in modo atomico. Ogni sveglia riconcilia anche gli eventuali `run.lock.morto-*` lasciati da un recupero non completato.

10. **Zona grigia nella watchlist.** Si tengono al massimo 60 titoli, i più vicini alla soglia. Servono solo alle operazioni ombra.

11. **Protezioni e uscite forti prima del cervello.** Il §6 mette il cervello al passo 6. Le eseguo prima, così sono garantite anche se il cervello fallisce o va in timeout, come richiede il §6.6.

12. **Posizione non protetta → acquisti bloccati.** Finché una posizione risulta non protetta, la sveglia non compra niente di nuovo. È più prudente.

13. **Il modello può vendere solo le uscite deboli segnalate, e solo alla sveglia di apertura.**
    - Dubbio: il contratto dice "si vende solo ciò che è in portafoglio".
    - Scelta: restringo alle posizioni con un'uscita debole segnalata.
    - Motivo: il §4.5 dice che le uscite deboli sono "segnalate al modello, che decide", e il §5 mette le uscite all'apertura. Le uscite forti, lo stop e il "chiudi all'apertura" restano al codice.

14. **Rifiuti che fanno scattare la pausa** (rivista dopo la prova dal vivo).
    - Contano i rifiuti legati all'ordine: broker, quantità sotto 1 azione, livelli non validi.
    - I rifiuti strutturali della gabbia (sveglia senza ingressi, mercato chiuso, posti esauriti, limite di settore, acquisti bloccati) restano nel diario e nelle lezioni, ma non mettono il titolo in pausa.
    - Motivo: un acquisto proposto al briefing e rifiutato perché "il briefing non fa ingressi" bloccava il titolo per tutta la seduta, anche all'apertura. Non è un errore dell'ordine.

15. **Unità di R.** R = (uscita − ingresso) / (ingresso × stop% all'ingresso).
    - La stessa unità vale per bracket e trailing e per ogni variante simulata della stessa operazione.
    - Motivo: altrimenti uno stop più stretto "gonfierebbe" gli R e il confronto sarebbe falso.

16. **Valutazione dei filtri nella review.**
    - Si usa l'R **simulato** con la modalità di uscita attuale, sia per le reali sia per le ombra.
    - Motivo: rende confrontabili reali e ombra. Le uscite deboli (scelte del modello) non entrano.
    - Il risultato reale si mostra a parte nelle statistiche.

17. **Livelli di uscita nella review.** Le simulazioni ancora aperte si valutano all'ultima chiusura, per evitare la distorsione di selezione (vedi review del modulo 10).

18. **Rendimento di SPY per un'operazione.** Dalla chiusura della seduta prima dell'ingresso alla chiusura del giorno d'uscita, con candele rettificate per i dividendi (rendimento totale).

19. **Lista del briefing per la metà seduta.**
    - Contiene i titoli che al briefing passano i controlli "statici": settore forte, segnali, nessuna pausa, non già posseduti.
    - A metà seduta si rifanno il controllo del prezzo e quello della trimestrale.

20. **Durata massima di una simulazione:** 250 sedute (parametro). Poi l'operazione si chiude all'ultima chiusura con motivo "scadenza".

21. **Il cervello viene chiamato a ogni sveglia, anche al briefing e alla chiusura.** Il §8.7 prevede le tipologie "decisione briefing" e "decisione chiusura". Lì il modello scrive solo piano e ragionamento: la gabbia non permette ordini.

22. **Tema della dashboard: Vantage (skill Hallmark, su richiesta dell'utente).**
    - Dalla skill ho preso, come prevede per le schermate applicative, solo palette, carattere, raggi e superfici; layout e navigazione restano quelli della dashboard.
    - Vantage è un tema **scuro**: la modalità chiara non c'è più.
    - Il carattere Geologica (licenza OFL, `src/dashboard/assets/`) è **servito dalla dashboard stessa**, non da Google Fonts: CLAUDE.md vieta i CDN.
    - Il linter della skill (`sloplint`) richiede Node, che su questo PC non c'è: non l'ho installato e le regole minime le ho applicate a mano. La deroga è scritta nell'intestazione del CSS.

23. **Motore indipendente dal sistema operativo.**
    - L'utente vuole farlo girare anche su Raspberry Pi 4B. Le uniche parti che dipendono dal sistema sono isolate:
      - ora di avvio di un processo: `Get-Process` su Windows, `/proc/<pid>/stat` su Linux, senza comandi;
      - cartella di lavoro del cervello: `%LOCALAPPDATA%` oppure `~/.local/share`;
      - script di avvio (`start.ps1`/`start.cmd` e `start.sh`);
      - pianificazione: Utilità di pianificazione oppure timer di systemd dell'utente, con gli orari in ora di Roma espliciti.
    - La regola "Sistema: Windows 11" di CLAUDE.md resta vera per lo sviluppo; il codice ora gira anche su Linux.

24. **Pacchetti.**
    - `bun run build` crea uno `.zip` per Windows e un `.tar.gz` per Linux, con archivi scritti a mano (zero dipendenze) e i checksum.
    - Il flusso GitHub Actions li ricrea a ogni push (artefatti) e li pubblica in una Release per i tag `v*`. Prima esegue i test su Windows, Linux x64 e Linux arm64.
    - L'azione `oven-sh/setup-bun` è l'unica cosa esterna, e solo nella CI.

25. **Scheda d'ingresso scritta prima dell'invio** (trovato dal guasto 1). Prima si scriveva dopo: un processo ucciso subito dopo l'ordine lasciava una posizione vera senza scheda, invisibile a statistiche e review. Ora la scheda si scrive prima, come il piano di uscita; se il broker rifiuta, o se l'ordine non parte, la scheda è marcata "annullata".

26. **"Non inviato" non è "senza risposta"** (trovato dal guasto 3).
    - Se il broker non risponde nemmeno alla verifica per id, l'ordine non parte. L'allarme ora lo dice, invece di "senza risposta", e il piano viene rimosso.
    - Non conta come rifiuto: un blackout del broker non deve mettere in pausa il titolo.

27. **Storia del patrimonio con `end` esplicito** (trovato dalla prova reale del 23/11/2026, 12:04).
    - Senza `end`, prima dell'apertura Alpaca usa l'ultima chiusura e rifiuta uno `start` di oggi con 400 "start cannot be after end".
    - Effetto: freno non verificabile, quindi acquisti bloccati per prudenza per tutto il primo giorno.
    - Ora `end` = adesso; un bot appena nato riceve una serie vuota e il massimo è il patrimonio attuale.

28. **"SPY oggi" e "stesso periodo".**
    - Prima dell'apertura lo snapshot ha come candela del giorno quella della seduta precedente: il "−3,07% oggi" del primo briefing reale era il venerdì.
    - Ora la variazione si misura dall'ultima chiusura vera, come `last_equity` del conto.
    - In dashboard ogni periodo (settimana, mese) parte dal più recente tra il suo inizio e l'avvio del bot, e il grafico disegna SPY solo da dove ci sono dati del bot: prima il bot non esisteva, e confrontarli sarebbe falso.

29. **Sveglia ricontrollata dentro il lock** (trovato dal guasto 2, fallito una volta sotto carico).
    - Il tick decide che la sveglia è da fare *prima* di prendere il lock. Se arriva al lock dopo che un'altra istanza l'ha già eseguita, la rifaceva.
    - Con Alpaca vero niente ordini doppi (stessi id), ma una seconda chiamata al cervello e messaggi doppi.
    - Ora, dentro il lock, una sveglia già eseguita non si ripete (salvo `--force`).

30. **Dipendenze per i grafici della dashboard: bklit e motion** (override esplicito dell'utente, 23/11/2026).
    - Dubbio: CLAUDE.md dice "zero dipendenze esterne, niente pacchetti npm, niente CDN nella dashboard". L'utente ha chiesto in chat di usare comunque le librerie di bklit e motion.
    - Scelta: le dipendenze valgono **solo per il lato browser** della dashboard. Motore, broker, cervello e server non le importano, e `bun test` gira senza.
    - I grafici bklit (licenza MIT) sono copiati come sorgenti in `src/dashboard/client/bklit/`, come fa il loro registro shadcn: commit e provenienza in `PROVENIENZA.txt`. Esclusi mappe, Sankey e i loro test.
    - Pacchetti installati con bun, versioni fissate:
      - per il browser: React 19.2, react-dom, motion 12.27, d3-array/scale/shape, clsx, tailwind-merge, `@number-flow/react` 0.5.11, `@base-ui/react` 1.1.0;
      - solo per compilare: Tailwind 4.1.8 (CLI).
    - `bun run client` compila tutto in `src/dashboard/assets/client.js` (503 KB) e `client.css` (31 KB). Nessun CDN: la dashboard li serve da sé.
    - I due file stanno nel repository, così il Raspberry e i pacchetti funzionano senza `node_modules`.
    - Ogni grafico è un'"isola": dati in JSON e, dentro, il grafico SVG del server come riserva. Senza JavaScript la pagina resta completa.
    - Motion anima con un solo ingresso morbido card e righe. bklit usa motion per i propri grafici, NumberFlow fa scorrere le cifre. Con "riduci movimento" tutto resta fermo.

31. **Tema Dusk al posto di Vantage** (richiesta dell'utente).
    - Ardesia, vetro fumé con bordo illuminato, Wix Madefor Display e Text serviti in locale (licenza OFL); Geologica è stato rimosso.
    - Segnali: pervinca (il bot, fatto, attivo, guadagno) e albicocca (aperto, da guardare, perdita).
    - Il tema vieta il rosso per le perdite, quindi niente rosso.

32. **Revisione `unslop`** (skill di heydamir, letta come regole, non installata). Applicati:
    - un grafico principale a tutta larghezza (rendimento del bot contro SPY) e gli altri più piccoli e di tipo diverso: barre delle sedute, ciambella, classifica dei settori;
    - tolto il grafico del risultato per posizione, già presente nell'elenco delle posizioni;
    - nessuna emoji nell'interfaccia;
    - un solo formato delle cifre, con il separatore delle migliaia sempre;
    - spaziature sulla griglia di 4 px e contenuto fino a 1440 px;
    - niente punto finale nelle frasi brevi;
    - curva delle linee monotona, che non inventa picchi tra i punti.

33. **Grafico del rendimento invece di "base 100".**
    - bklit fa partire l'asse da zero quando i dati sono positivi, il che appiattiva l'indice a base 100.
    - Il grafico ora mostra il rendimento dall'inizio del periodo, dove lo zero è il riferimento naturale. Lo stesso per la posizione: variazione dal prezzo di carico, con stop e take profit tratteggiati.

34. **Barre di bklit solo verticali.** Le barre orizzontali di bklit non gestiscono i valori negativi (larghezza negativa in console). Le barre con i negativi sono verticali, e i settori sono una classifica in HTML con barre sottili.

35. **Modelli AI** (richiesta dell'utente).
    - Opus 5.5 (`claude-opus-5-5`) per le decisioni complesse: sveglie di apertura e metà seduta, dove si comprano e vendono titoli, e per la review.
    - Sonnet 5.5 (`claude-sonnet-5-5`) per briefing e chiusura, che scrivono solo piano e resoconto.
    - Nuovo parametro `ai.modelloSemplici`. Sul conto reale applicato come versione v2 dei parametri, autore "utente".
    - Con "predefinito" la dashboard mostra il modello usato davvero nell'ultima chiamata. Se la chiamata ne usa più di uno, mostra quello con il costo maggiore: Claude Code usa anche un modello piccolo per compiti interni.

36. **Conferme minime da 2 a 1** (23/11/2026, richiesta dell'utente).
    - Alla prima apertura sul conto paper nessuno dei 21 acquistabili superava le regole d'ingresso.
    - Studio di frequenza sulle ultime 250 sedute, con i 21 acquistabili del giorno: con 2 conferme c'era almeno un segnale nel 31% delle sedute (circa 2 a settimana); con 1 nel 69% (circa 7 a settimana).
    - Il rendimento a 20 sedute non peggiora, ma il confronto ha due limiti: usa la selezione di oggi applicata al passato, che gonfia i risultati, e ha finestre sovrapposte. Non è una prova.
    - Applicata come versione v3 dei parametri, autore "utente", con il motivo nella nota.
    - La pagina Review elenca le modifiche fatte a mano, con i risultati della versione nuova e di quella precedente, finché una review non le ha valutate.
    - La review del sabato riceve `modificheManuali` e `perVersione` e deve commentarle.

37. **Segnali ricalcolati se cambiano i parametri a metà giornata.**
    - Prima: i segnali della seduta erano calcolati una sola volta e riusati anche dopo un cambio di soglie, quindi la sveglia applicava soglie non più attive.
    - Ora: se la versione salvata nei segnali è diversa da quella attiva, si ricalcolano tutti sulle stesse candele chiuse.
    - Più prudente così: le regole applicate sono sempre quelle attive. Le candele non cambiano, quindi non entra nessun dato nuovo.

38. **Pagina "Selezione"** (23/11/2026, richiesta dell'utente; non prevista dal contratto, che resta invariato).
    - È di sola lettura: nessuna azione, nessun ordine. Mostra la watchlist della scansione: settori contro SPY, l'imbuto dall'universo agli acquistabili, la zona grigia e i titoli buoni in settori deboli.
    - Il dettaglio di un titolo spiega ogni passo della selezione con i valori veri (filtri dell'universo, forza del settore, criteri del profilo con soglie ed esiti, percentili e classifica), poi i segnali tecnici e i grafici di prezzo e volume.
    - I segnali sono quelli della seduta salvata, cioè gli stessi che usa la sveglia. Se il titolo non è tra quelli calcolati, si ricalcolano sul momento sulle candele chiuse, con i parametri attivi e una cache di 15 minuti. La pagina dice sempre da dove vengono i dati.
    - Il grafico del prezzo mostra la variazione rispetto all'ultima chiusura: bklit fa partire l'asse da zero, e così lo zero è il prezzo di oggi.

39. **Resoconto di fine giornata con la distanza da stop e take profit** (24/11/2026, richiesta dell'utente).
    - Alla sveglia di chiusura le posizioni aperte compaiono sempre, anche se "posizioni nel resoconto" è spento: è la richiesta esplicita. Nelle altre sveglie decide quel parametro.
    - Per ogni posizione:
      - risultato dall'ingresso;
      - distanza dallo stop (o dallo stop mobile) e dal take profit, in % e in $ dal prezzo attuale;
      - posizione nel percorso tra stop e take profit.
    - Casi limite dichiarati e non inventati: prezzo già oltre lo stop o il take profit, piano di uscita mancante, prezzo non disponibile.

40. **Pagina "Guida"** (24/11/2026, richiesta dell'utente). Spiega il bot dalla selezione alle uscite. I numeri vengono dai parametri attivi, così la guida non diventa falsa dopo una modifica. È solo testo, senza azioni.

41. **Universo nelle impostazioni** (24/11/2026, richiesta dell'utente). Due parametri nuovi nel gruppo Universo:
    - `universo.borse`: NYSE e NASDAQ (iniziale, come prima), con NYSE American, solo NYSE, solo NASDAQ. Alpaca negozia solo titoli quotati in USA, quindi l'universo non può andare oltre le borse americane. NYSE Arca, Cboe e OTC restano fuori: sono soprattutto ETF o titoli poco liquidi;
    - `universo.sede`: tutte (iniziale, come prima), solo USA, solo estere, dal campo `country` del profilo Finnhub. Se la sede manca e c'è un filtro, il titolo si esclude: è la scelta prudente.

    I valori iniziali riproducono il comportamento di prima, quindi nulla cambia finché non li tocchi. La cache del prefiltro ora è legata alle borse: cambiandole a metà giornata non si riusa una cache sbagliata.

42. **Stima dell'impatto prima di salvare** un cambio dell'universo, di `settori.migliori`, di `settori.maxAcquistabili` o di `ai.maxCandidati`.
    - Calcolata al momento con i dati veri: elenco titoli di Alpaca, cache del prefiltro e di Finnhub, watchlist, registro dei consumi AI.
    - Consumo AI: il cervello riceve al massimo `ai.maxCandidati` candidati, quindi la stima è il caso peggiore. È la differenza dei candidati massimi × byte di un candidato (misurati sulla watchlist) × costo per byte delle ultime chiamate di decisione × 42 sveglie al mese. Spesso è "invariato": gli acquistabili sono al massimo 3 per settore forte, qualunque sia l'universo.
    - Borse mai scansionate (es. NYSE American): stimate con la quota di titoli liquidi delle altre, e segnate come stima.
    - La conferma è chiesta due volte: una finestra di conferma con i numeri, e un controllo nel server, che rifiuta il salvataggio se l'anteprima con la stima non è stata vista.

43. **Override della lista** (richiesta dell'utente; cambia una regola del contratto per scelta esplicita dell'utente).
    - Si può *aggiungere* un titolo della zona grigia, cioè uno che ha mancato un solo criterio di bilancio di poco, oppure *togliere* un acquistabile.
    - Scelte prudenti:
      - un override cambia solo la lista: per comprare servono comunque il segnale tecnico, un settore forte e il via libera della gabbia;
      - un aggiunto vale finché il titolo è in zona grigia; dopo una scansione in cui non lo è più resta "sospeso";
      - un tolto vale anche per le scansioni successive, finché non lo annulli;
      - una posizione già aperta su un titolo tolto resta protetta e segue le sue uscite.
    - Le operazioni nate da un aggiunto a mano hanno `override: "aggiunto"` nella scheda. La review le conta a parte (`perSelezione`), così non si attribuisce alla classifica un risultato che non è suo.
    - Ogni azione va nel diario e su Telegram.

44. **Scansione manuale dalla dashboard.**
    - Lancia `bun run scan` come processo separato, così continua anche se la pagina si chiude, e la pagina mostra l'avanzamento.
    - Il lock della scansione impedisce due scansioni insieme.
    - La conferma avverte di un rischio: durante la scansione le richieste a Finnhub arrivano vicino al limite, e una sveglia che parte nel frattempo potrebbe non verificare le trimestrali. In quel caso non compra, che è l'esito prudente.

45. **Grafico del titolo a periodi** (1 mese, 6 mesi, 1 anno, Max).
    - Le candele salvate (300) bastano solo per 1 mese con la SMA200. Per gli altri periodi si scaricano da Alpaca, aggiustate per i dividendi, con una cache di 30 minuti.
    - Max parte dal 2016, e oltre 600 punti mostra una seduta ogni N.
    - La finestra parte dove la SMA200 esiste già, così le medie si vedono su tutto il periodo.

46. **Grafico a cono** per i passaggi della scansione: HTML e CSS (clip-path), senza librerie, con animazione d'ingresso disattivata da "riduci movimento".

47. **Recupero delle sveglie saltate** (24/11/2026, richiesta dell'utente; cambia §5 del contratto, che diceva "non si recupera").
    - Se il bot riparte dopo l'orario di una sveglia di oggi (PC spento, motore chiuso), al primo tick ne recupera una sola, con lo stesso id della sveglia prevista: non si confonde con le sveglie forzate e non si può fare due volte.
    - Regole prudenti:
      - dopo l'orario della chiusura solo la chiusura, quindi nessun acquisto;
      - a mercato aperto l'apertura (che fa anche le uscite), altrimenti la metà seduta;
      - prima dell'apertura solo il briefing;
      - mai una sveglia precedente a una già eseguita oggi;
      - niente recupero se la prossima sveglia prevista è a meno di `orari.distanzaMinima`.
    - Il tentativo si registra sotto il lock prima del giro (`recuperiTentati` in `state/sveglie.json`). Se il recupero fallisce non si ritenta a ogni tick, e due motori avviati insieme non recuperano due volte.
    - Il controllo del prezzo all'acquisto (scostamento massimo in ATR dalla chiusura precedente) vale anche nel recupero: un titolo già scappato non si compra.
    - Si recupera solo la seduta di New York in corso, mai i giorni precedenti.

48. **Configurazione guidata al primo avvio** (24/11/2026, richiesta dell'utente). Se `secrets.ts` manca o è incompleto, la dashboard parte in modalità configurazione e il motore aspetta, senza andare in errore.
    - **Sicurezza:**
      - solo 127.0.0.1, con controllo dell'host e dell'origine e token CSRF;
      - un codice monouso stampato nel terminale e nel log della dashboard, con blocco dopo 10 codici sbagliati;
      - le chiavi non tornano mai al browser, e ogni valore è registrato per `redact()` prima di qualsiasi chiamata;
      - la chiave Alpaca live (AK) è rifiutata senza chiamare la rete, e la verifica usa solo l'endpoint paper.
    - **Verifiche, tutte in sola lettura:** `/v2/account` di Alpaca paper, `profile2` di Finnhub, `getMe` e `getUpdates` di Telegram (che trova la chat privata) con un messaggio di prova, `claude --version`.
    - **Scrittura:** `secrets.ts` scritto in modo atomico, con i valori passati da JSON.stringify e U+2028/2029 con la sequenza di escape. Su Linux il permesso è 600.
    - **Riavvio:** a fine configurazione il processo esce con il codice 75. `start avvia` lo riavvia subito, al massimo 5 volte in 10 minuti; `start dashboard` e `start motore` lo rilanciano finché esce con 75.
    - **File esistenti:** un `secrets.ts` scritto a mano ma illeggibile non si sovrascrive mai: il bot si ferma e lo dice. Telegram e il token di Claude sono facoltativi.

49. **Esito della revisione esterna** (dettagli in `docs/review-codice.md`).
    - Un recupero interrotto da un processo ucciso si riprende **una** volta. È l'unico caso in cui un recupero si ritenta: serve a non lasciare una posizione senza protezione fino alla sveglia dopo.
    - Le sveglie forzate (`once` fuori orario) hanno id con il suffisso `f`, e contano come fatte per il recupero.
    - Un file degli override illeggibile blocca gli acquisti.
    - Il motore si riavvia quando `secrets.ts` cambia.

50. **Modelli AI iniziali a «predefinito»** (24/11/2026, richiesta dell'utente; aggiorna la 35).
    - Opus non è disponibile in tutti i piani di Claude, quindi chi installa da zero parte con il modello predefinito del proprio account, senza `--model`, per decisioni, compiti semplici e review.
    - Chi ha Opus nel piano lo sceglie in Impostazioni → AI. Le spiegazioni e la configurazione guidata lo dicono.
    - Le installazioni esistenti tengono i loro parametri. Su questo PC la v3 resta con Opus per decisioni e review e Sonnet per i compiti semplici.
