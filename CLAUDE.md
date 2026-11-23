# CLAUDE.md — come lavorare su Indiano Trading Bot

Bot di paper trading su azioni USA (Alpaca), con selezione fondamentale e tecnica, diario,
apprendimento con conferma umana, notifiche Telegram e dashboard web locale.

- **Cosa deve fare** il bot: `Contratto.md`, che è la fonte di verità. Leggilo tutto prima di
  scrivere una riga.
- **Come lavorare**: questo file.
- Criteri originali dell'utente: `docs/criteri-originali.docx`. Sono già tradotti in regole nel
  contratto.

## Prerequisiti (verificali per primi)

Al 23/11/2026, su questo PC né `bun` né `claude` sono nel PATH di PowerShell.

- **Bun**: `powershell -c "irm bun.sh/install.ps1 | iex"`, poi riapri il terminale e verifica con
  `bun --version`.
- **Claude Code CLI** (serve al bot come "cervello" e deve essere un comando nel PATH, non solo
  l'estensione di VS Code): `irm https://claude.ai/install.ps1 | iex`, poi `claude --version`. Per il
  token da usare negli script: `claude setup-token`.

Se mancano, **fermati e chiedi all'utente di installarli**. Non installare nulla di tua iniziativa.

## Regole di base

- **Bun + TypeScript, zero dipendenze esterne.** Solo `fetch`, API di Bun (`Bun.serve`, `Bun.spawn`,
  `Bun.file`), `node:fs`/`node:path` dove serve, `bun:test`. Niente pacchetti npm, niente CDN nella
  dashboard.
- **Sistema: Windows 11.** Percorsi con `node:path`. Niente comandi Unix nel codice. Il fuso orario si
  gestisce con `Intl.DateTimeFormat` e `timeZone: "America/New_York"` / `"Europe/Rome"`, mai con
  offset scritti a mano.
- **Lingua:** testi per l'utente (Telegram, dashboard, testimone, review, log leggibili) in italiano.
  Nomi nel codice: come preferisci, ma coerenti.
- **Non committare e non fare push**: lo fa l'utente. Il repository git esiste già, con un remoto
  GitHub privato, e il `.gitignore` esclude `secrets.ts`, `state/`, `logs/` e `cache/`. Se crei
  altri file con dati sensibili, aggiungili al `.gitignore`.
- **Mai leggere, stampare o loggare i segreti.** `secrets.ts` lo compila l'utente. Tu lo importi
  soltanto. Non aprirlo per "controllare", non copiarne i valori in altri file, test, fixture o
  messaggi.
- **Mai usare l'endpoint live** di Alpaca, nemmeno in un test.

## Struttura suggerita

Adattala se serve, e motiva le modifiche nel piano.

```text
src/
  config/      valori iniziali, intervalli e passi dei parametri, mappe campi Finnhub e settori
  params/      lettura/scrittura/versioni di state/params.json
  broker/      interfaccia comune, alpaca.ts, fake.ts
  data/        candele e snapshot Alpaca, Finnhub, calendario; versioni finte
  scan/        universo, profili, classifica, watchlist
  signals/     indicatori, regole di ingresso e uscita
  cage/        gabbia: limiti, pause, freno, dimensionamento
  run/         sveglia, lock, testimone, pianificazione, riconciliazione, esecutore ordini
  brain/       chiamata a claude -p, schema, validazione, cervello finto
  journal/     diario, schede delle operazioni, operazioni ombra, simulatore di uscite
  learning/    statistiche, proposte, review
  telegram/    invio, spezzatura, conversione HTML, pulsanti e callback
  dashboard/   server, autenticazione, pagine, grafici SVG
  util/        redact, scrittura atomica, tempo, log
tests/
scripts/       installa-pianificazione.ps1
docs/          campi-dati.md, decisioni.md, review-codice.md
state/ logs/ cache/   (creati a runtime, ignorati da git)
```

## Comandi da realizzare

| Comando | Cosa fa |
|---|---|
| `bun run probe` | Sonda reale di Finnhub e Alpaca. Scrive `docs/campi-dati.md` |
| `bun run scan` | Scansione fondamentale, riprende dalla cache |
| `bun run tick` | Esegue la sveglia o la scansione dovuta (i pulsanti Telegram li legge la dashboard) |
| `bun run schedule` | `tick` ogni 30 secondi |
| `bun run once [--slot nome] [--force]` | Sveglia immediata |
| `bun run review [--force]` | Review di apprendimento |
| `bun run dashboard` | Server web su 127.0.0.1 |
| `bun run status` | Stato rapido nel terminale |
| `bun test` | Tutti i test, con broker, dati e cervello finti |

`--fake` su ogni comando usa broker, dati e cervello finti.

`scripts/installa-pianificazione.ps1` registra tre attività nell'Utilità di pianificazione:
- `bun run tick` ogni 5 minuti, lun–ven 09:00–23:00, con "riattiva il computer";
- `bun run scan` il sabato alle 10:00, seguito dal controllo della review;
- `bun run dashboard` all'accesso dell'utente.

Lo script lo scrivi tu e lo lancia l'utente.

## Note tecniche verificate (novembre 2026)

### Alpaca

**Trading**
- Endpoint paper: `https://paper-api.alpaca.markets/v2`.
- Header `APCA-API-KEY-ID` e `APCA-API-SECRET-KEY`.

**`client_order_id`**
- Massimo 128 caratteri, deve essere unico.
- Per cercare un ordine per id: `GET /v2/orders:by_client_order_id?client_order_id=…` (404 se non
  esiste).
- La documentazione **non garantisce** il codice di errore restituito per un id duplicato: verificalo
  con `probe` sul conto paper e non dipendere da quello. La difesa vera è il controllo per id
  **prima** di inviare.

**Timeout sull'invio**
- L'ordine può essere comunque arrivato al mercato. Alpaca consiglia di non rimandarlo finché lo
  stato non è confermato: verifica per id.

**Bracket**
- `order_class: "bracket"`, `time_in_force` `day` o `gtc`.
- `take_profit.limit_price` e `stop_loss.stop_price` sono obbligatori.
- Niente ore fuori seduta.
- Lo stop deve essere almeno 0,01 $ sotto il prezzo di base.

**OCO**
- Solo per **uscire** da una posizione esistente.
- `type: "limit"`, con `take_profit` e `stop_loss`.

**Trailing stop**
- `type: "trailing_stop"`, con `trail_percent` oppure `trail_price`, `time_in_force` `day` o `gtc`.
- **Non scatta fuori dalla seduta regolare.**

**Modifica degli ordini** (`PATCH /v2/orders/{id}`)
- **Supportata** per le gambe di bracket e OCO (`limit_price`, `stop_price`) e per il `trail` di un
  `trailing_stop` prima che scatti.
- **Non supportata** per gli OTO e per gli ordini `notional`.
- Preferisci sempre la modifica alla coppia cancella/ricrea: quest'ultima lascia un momento senza
  protezione.

**Scadenza degli ordini `gtc`**
- Alpaca li cancella automaticamente 90 giorni dopo la creazione, alle 16:15 ET della data
  `expires_at`.
- Ricrea le protezioni con più di 80 giorni.

**Precisione dei prezzi**
- Limit e stop ≥ 1 $: massimo 2 decimali. Sotto 1 $: massimo 4.
- Alpaca **rifiuta** gli ordini fuori regola (errore "sub-penny increment") e non arrotonda.

**Ordini a mercato chiuso**
- Un ordine non abilitato alle ore estese inviato dopo le 16:00 ET resta in coda fino alla seduta
  successiva.

**Configurazione del conto**
- `GET` / `PATCH /v2/account/configurations`: `no_shorting`, `max_margin_multiplier`.
- Il conto paper nasce a margine con lo short abilitato: imposta `no_shorting: true` e
  `max_margin_multiplier: "1"` all'avvio e verifica rileggendo.
- Controlla i nomi esatti dei campi con `probe` e scrivili in `docs/campi-dati.md`.

**Stati degli ordini**
- `new`, `partially_filled`, `filled`, `done_for_day`, `canceled`, `expired`, `replaced`,
  `pending_cancel`, `pending_replace`, `accepted`, `pending_new`, `rejected` e altri.
- Tratta come aperti tutti quelli che non sono finali.

**Vendita con ordini di protezione aperti**
- Prima cancella, poi vendi. Altrimenti risponde 403, perché le azioni non sono disponibili.

**Regola PDT**
- **Non esiste più.** Abolita da FINRA il 4 giugno 2026.
- I campi `pattern_day_trader`, `daytrade_count` e `daytrading_buying_power` sono deprecati: non
  usarli.

**Altri endpoint utili**
- `/v2/clock`, `/v2/calendar` (aperture e chiusure in ora di New York, comprese le mezze giornate);
- `/v2/account/portfolio/history` (patrimonio per periodo);
- `/v2/assets` (universo).

**Modalità trailing**
- Dopo l'acquisto a mercato, controlla lo stato dell'ordine fino all'esecuzione (al massimo
  30 secondi), poi crea il `trailing_stop`.
- Se il processo muore nel mezzo, la verifica delle protezioni della sveglia successiva lo ripara.

### Alpaca Market Data

- Endpoint `https://data.alpaca.markets/v2`. Piano gratuito: 200 richieste al minuto.
- **Candele giornaliere:**
  - `feed=sip` (volume di tutte le borse) con `end` ad almeno 16 minuti fa: il piano gratuito non
    dà dati SIP più recenti;
  - **scarta sempre la candela della seduta in corso** se la seduta non è chiusa. Con
    `end = adesso − 16 min` durante la seduta, Alpaca restituisce una candela parziale;
  - `adjustment=all` per gli indicatori (e per il rendimento totale di SPY);
  - `adjustment=split` per simulazioni, percorsi di prezzo e calcolo di R, così i prezzi coincidono
    con quelli degli ordini sul broker. Con `all` i prezzi passati cambiano a ogni stacco del
    dividendo;
  - richieste per più simboli insieme, gestendo `next_page_token`.
- **Prezzo corrente:** snapshot con `feed=iex`, che è in tempo reale ma copre circa il 2,5% del
  volume. Usalo solo per il prezzo, **mai** per i segnali sui volumi.

### Finnhub (piano gratuito)

- Limite 60 richieste al minuto: resta sotto le 50.
- Inoltre massimo 30 richieste al secondo.
- Endpoint **gratuiti** per i titoli USA:
  - `/stock/metric?metric=all` (indicatori fondamentali);
  - `/stock/profile2` (incluso `finnhubIndustry`);
  - `/calendar/earnings` (circa 1 mese).
- **A pagamento**: stime degli analisti, bilanci standardizzati, storico dividendi, contenuto degli ETF.
- I nomi dei campi di `metric=all` **non sono documentati** e alcuni nomi "ovvi" non esistono:
  - ad esempio `debtToEquityTTM` e `currentRatioTTM` mancano;
  - al loro posto ci sono `totalDebt/totalEquityQuarterly`, `currentRatioQuarterly` e
    `revenueGrowthTTMYoy`.
  - **Prima** di scrivere `src/config/campi-finnhub.ts` esegui `probe` e usa solo campi visti davvero.
  - Se la chiave non c'è, scrivi la mappa come "da verificare" e dillo nel resoconto.
- Le serie storiche (`series.annual` / `series.quarterly`) servono per la media del P/E a 5 anni,
  se presenti.
- **Unità di misura:** `marketCapitalization` è in **milioni** di $, e molte percentuali arrivano
  come numeri (15 = 15%), non come frazioni. La sonda registra l'unità di ogni campo usato. I test
  dello screener usano valori nelle unità reali.

### Claude Code headless (il "cervello")

```text
claude -p --output-format json --json-schema <schema-json> --tools "" --disallowedTools "mcp__*"
       --strict-mcp-config --no-session-persistence --max-turns 3
```

- **Prima di usarlo**, esegui `claude --version` e `claude -p --help` e verifica che i flag esistano.
  Se uno manca, adatta il comando e scrivilo in `docs/decisioni.md`.
- **Chiamata:**
  - prompt via **stdin** (`Bun.spawn` con `stdin`), mai come argomento: su Windows la riga di comando
    ha un limite di lunghezza;
  - lo schema passa come argomento dell'array di `Bun.spawn`, senza shell, quindi senza problemi di
    virgolette;
  - `cwd` = una cartella vuota **fuori dal progetto**: `%LOCALAPPDATA%\IndianoTrading\brain-cwd\`.
    Claude Code legge i `CLAUDE.md` della cartella di lavoro **e di tutte le cartelle superiori**:
    una cartella dentro `C:\IndianoTrading` caricherebbe comunque questo file;
  - impostazioni e memoria dell'utente (`~/.claude/`) vengono caricate lo stesso. Valuta
    `--setting-sources` (controlla in `claude -p --help` i valori ammessi) per limitarle;
  - nella sonda, fai una chiamata di prova chiedendo al cervello di elencare le istruzioni e il
    contesto che riceve, e scrivi l'esito in `docs/campi-dati.md`.
- **Autenticazione:**
  - `CLAUDE_CODE_OAUTH_TOKEN` nell'ambiente del processo figlio, preso da `secrets.claude.oauthToken`
    se compilato, altrimenti ereditato;
  - **non usare `--bare`**: in quella modalità il token OAuth non viene letto.
- **Risposta:**
  - è in `structured_output`. Se manca (ad esempio il modello ha rifiutato) è un errore del cervello;
  - **valida comunque** la risposta nel codice, con un validatore scritto a mano.
- **Timeout:** 180 secondi, poi termina il processo. Il codice di uscita diverso da 0 è un errore.

### Telegram

- `https://api.telegram.org/bot<TOKEN>/…`: **il token è nell'URL.** Ogni errore di `fetch` passa da
  `redact()` prima di essere loggato.
- **Messaggi:**
  - `sendMessage` con `parse_mode: "HTML"`; converti `&`, `<`, `>` in tutti i testi variabili;
  - massimo 4096 caratteri dopo la formattazione: spezza i messaggi lunghi.
- **Pulsanti:**
  - `reply_markup.inline_keyboard` con `callback_data` di massimo 64 byte;
  - i clic arrivano da `getUpdates` (usa `offset` per non rileggerli) come `callback_query`;
  - rispondi con `answerCallbackQuery`;
  - **accetta solo `callback_query.message.chat.id === secrets.telegram.chatId`**.
- **Un solo lettore di `getUpdates`**: il processo della dashboard, ogni 30 secondi, 7 giorni su 7.
  - `tick` e le sveglie **inviano** soltanto, non leggono mai gli aggiornamenti.
  - Due lettori si rubano gli aggiornamenti a vicenda: ognuno avanza l'`offset` dell'altro.
- **Durata degli aggiornamenti:** Telegram conserva quelli non letti per **24 ore al massimo**.
- **Errore 429:** rispetta `retry_after`.

### Utilità di pianificazione di Windows

Nello script `installa-pianificazione.ps1`:
- **tick:**
  - imposta un **tempo massimo di esecuzione** di 20 minuti;
  - se un'istanza è già in esecuzione, non avviarne un'altra (`MultipleInstances IgnoreNew`).
  Senza il tempo massimo, un tick bloccato impedirebbe tutti i successivi.
- **scansione del sabato** (attività separata): tempo massimo di 3 ore.
- **dashboard:** all'accesso, con riavvio automatico se si chiude.

## Processo di lavoro

1. Leggi `Contratto.md` e questo file per intero.
2. Mostra il **piano in 15 righe** (file e responsabilità), poi procedi senza aspettare conferma.
3. Costruisci **un modulo alla volta**, in quest'ordine:
   1. utilità e configurazione;
   2. broker e dati finti;
   3. indicatori;
   4. scansione;
   5. gabbia;
   6. sveglia;
   7. cervello;
   8. Telegram;
   9. diario e operazioni ombra;
   10. apprendimento;
   11. dashboard;
   12. pianificazione.

   Ogni modulo ha i suoi test prima di passare al successivo.
4. Dopo ogni modulo fai l'**auto-review** (sotto) e correggi quello che trovi.
5. Alla fine:
   - `bun test` finché è verde;
   - se `secrets.ts` è compilato: `bun run probe`, poi `bun run once --slot briefing` sul conto paper
     vero, poi apri la dashboard e verifica che la panoramica mostri i dati reali.
6. Chiudi con il **resoconto finale** (sotto).

## Auto-review obbligatoria

Dopo **ogni** modulo, e alla fine sull'insieme, rispondi per iscritto a queste domande in
`docs/review-codice.md`. Una sezione per modulo, risposte brevi e concrete, **niente risposte di
cortesia**.

1. **È corretto?**
   - Rispetta il contratto alla lettera?
   - Ci sono casi limite non gestiti? Ad esempio: dati mancanti, mercato chiuso, mezza giornata,
     ora legale, esecuzione parziale, timeout, risposta vuota, file corrotto, doppio lancio.
   - I calcoli sono giusti, verificati con valori di riferimento?
2. **Funziona?**
   - C'è un test che lo dimostra?
   - L'ho eseguito davvero, con i dati finti, e dove possibile anche con quelli reali?
   - Cosa succede se la rete cade a metà?
3. **Aiuta a guadagnare, o almeno a capire se si guadagna?**
   - Questo pezzo migliora le decisioni, riduce le perdite o rende misurabile il risultato?
   - Introduce un rischio di perdita (ordini doppi, posizione senza protezione, dati vecchi presi per
     nuovi)?
   - Introduce un rischio di autoinganno (statistiche su campioni piccoli, operazioni simulate
     mescolate a quelle reali, look-ahead bias nelle simulazioni)?
4. **È sicuro?**
   - Un segreto può finire in log, messaggi o browser?
   - Un'azione può bypassare la gabbia o il lock?

Se una risposta è "no" o "non so", **correggi prima di andare avanti**. Se non puoi correggere,
scrivilo nei limiti.

## Decisioni e ambiguità

Quando il contratto non basta:
- scegli l'opzione **più prudente** (meno ordini, più verifiche);
- scrivila in `docs/decisioni.md` (data, dubbio, scelta, motivo);
- citala nel resoconto finale.

Non cambiare in silenzio una regola del contratto.

## Cose da non fare

- Non inventare dati: un valore assente è "non disponibile".
- Non scrivere soglie nella logica: tutto da `state/params.json`, con i valori iniziali in
  `src/config/`.
- Non mescolare risultati simulati (ombra) e reali nelle statistiche di portafoglio.
- Non usare dati futuri nelle simulazioni: ogni decisione ombra usa solo candele chiuse **prima**
  dell'ingresso.
- Non lasciare una posizione senza ordine di protezione alla fine di una sveglia.
- Non far partire ordini da codice di test verso Alpaca vero.

## Resoconto finale

- Cosa hai costruito, e come si lancia ogni comando.
- **Cosa deve fare l'utente**:
  - compilare `secrets.ts`;
  - scrivere `/start` al bot e ricavare il `chatId`;
  - lanciare `bun run probe`;
  - lanciare lo script di pianificazione;
  - cancellare le chiavi rimaste in OneDrive.
- Esito di `bun test` ed eventuali prove reali.
- Contenuto di `docs/decisioni.md` in sintesi.
- **Limiti conosciuti**, scritti chiari, compresi quelli della sezione 13 del contratto e almeno:
  - stop e gap di apertura;
  - esecuzioni ideali del conto paper;
  - campioni piccoli nell'apprendimento;
  - criteri non disponibili con Finnhub gratuito.
