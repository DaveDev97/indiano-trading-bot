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
