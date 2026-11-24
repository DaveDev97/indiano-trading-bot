# Indiano Trading Bot

Un bot di **paper trading** su azioni USA che lavora da solo, su un conto simulato Alpaca:

- sceglie i titoli con criteri fondamentali (Finnhub) e tecnici (candele Alpaca);
- tiene al massimo 5 posizioni, ognuna sempre protetta da uno stop sul broker;
- si sveglia 4 volte al giorno e ti aggiorna su Telegram;
- tiene un diario di tutto e, ogni qualche settimana, propone di aggiustare i propri parametri, ma solo con la tua conferma;
- confronta ogni risultato con **comprare e tenere SPY**, per dire con i numeri se guadagna davvero.

Le regole complete sono in [Contratto.md](Contratto.md). Le scelte prese dove il contratto non bastava sono in [docs/decisioni.md](docs/decisioni.md).

> Solo conto **paper**. L'indirizzo di trading è una costante del codice. Il bot si rifiuta di partire se trova una chiave live (`AK…`) o un URL di trading diverso da quello paper.

## Come è fatto

Il bot è fatto di due processi separati, che condividono solo la cartella `state/`.

| Parte | Cos'è | Chi lo avvia |
| --- | --- | --- |
| **Motore** | Un processo **batch**: `bun run tick` controlla se c'è una sveglia da fare, la esegue ed esce. Il sabato fa la scansione dei titoli e, se è il momento, la review. | L'Utilità di pianificazione (Windows) o i timer di systemd (Linux), ogni 5 minuti. In alternativa `start avvia` tiene accesi motore e dashboard in una sola finestra (o `start motore` il solo motore). |
| **Dashboard** | Una **webapp** su `http://127.0.0.1:8787`. Mostra come sta andando e permette di governare il motore: parametri, pausa acquisti, freno d'emergenza, proposte della review, azioni manuali sulle posizioni. Legge anche i pulsanti di Telegram. | Si avvia all'accesso (Windows) o come servizio (Linux). Si può chiudere: il motore continua. |

Il motore e la dashboard non si parlano direttamente. Ogni azione che manda ordini, da qualunque parte arrivi, passa dallo stesso esecutore sotto lo stesso lock: mai due ordini uguali, mai due processi sul broker insieme.

Il "cervello" è Claude Code in modalità non interattiva (`claude -p`). Riceve dati già calcolati e sceglie solo tra le opzioni che il codice ha ammesso. Quantità, stop e controlli li decide il codice.

## Requisiti

- **Bun** 1.4 o successivo:
  - Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`
  - Linux: `curl -fsSL https://bun.sh/install | bash`
- **Claude Code** (il comando `claude` deve essere nel PATH):
  - Windows: `irm https://claude.ai/install.ps1 | iex`
  - Linux: `curl -fsSL https://claude.ai/install.sh | bash`

  Poi lancia `claude setup-token` per ottenere il token.
- Un conto **paper** Alpaca, un bot Telegram (da BotFather) e una chiave Finnhub gratuita.

Il motore non ha dipendenze npm. La dashboard usa i grafici di [bklit](https://bklit.com) e [motion](https://motion.dev), già compilati in `src/dashboard/assets/`: per usare il bot non serve `bun install`.

**Raspberry Pi 4B:** serve un sistema a **64 bit** (Raspberry Pi OS 64-bit o Ubuntu arm64), perché Bun non gira a 32 bit. Il Pi deve restare acceso, e i timer usano sempre l'ora di Roma qualunque sia il fuso del sistema.

## Installazione

1. **Scarica il pacchetto** per il tuo sistema e scompattalo in una cartella. I pacchetti si trovano nella scheda *Actions* (artefatti di ogni build) o nelle *Release* su GitHub, oppure li crei con `bun run build`.
   - Windows: `indiano-trading-<versione>-windows.zip`
   - Linux: `indiano-trading-<versione>-linux.tar.gz` (poi `tar -xzf …`)
2. **Avvia e segui la configurazione guidata.** Lancia `start avvia`. Al primo avvio non c'è niente da scrivere a mano: nel terminale compare una riga «Configurazione iniziale: apri `http://127.0.0.1:8787/configurazione?codice=…`». Aprila: il link contiene un codice monouso, che impedisce ad altri di configurare il bot al posto tuo. La pagina ti guida passo per passo:
   1. scegli la **password** della dashboard (almeno 12 caratteri);
   2. **Alpaca**: crea l'account, passa al conto *Paper* e genera le chiavi (iniziano con `PK`); la pagina le verifica sul conto paper;
   3. **Finnhub**: registrati e copia la chiave gratuita; la pagina la verifica;
   4. **Telegram**: crei il bot con **@BotFather** (`/newbot`, nome, username che finisce con `bot`) e incolli il token. Poi premi *Avvia* nella chat con il tuo bot, e la pagina trova da sola la tua chat e ti manda un messaggio di prova. Il passo si può saltare;
   5. **Claude Code**: la pagina controlla che sia installato e, se vuoi, salva il token di `claude setup-token`;
   6. **riepilogo** e «Salva e avvia il bot».

   Le chiavi vengono scritte in `secrets.ts`, su quel computer, e la pagina non le rimostra mai. Poi il bot si riavvia da solo e trovi la pagina di accesso. Il motore, nel frattempo, aspetta la configurazione senza andare in errore. `secrets.ts` non entra mai in git né nei pacchetti. Chi preferisce può ancora compilarlo a mano partendo da `secrets.example.ts`. Per rifare la configurazione da zero: chiudi il bot, rinomina `secrets.ts` e rilancia `start avvia`.
3. **Prova tutto senza chiavi:** `start test`, poi `start once --fake --slot briefing`.
4. **Sonda reale:** `start probe` verifica Alpaca, Finnhub e il cervello e scrive [docs/campi-dati.md](docs/campi-dati.md).
5. **Prima scansione:** `start scan` (60–90 minuti la prima volta; poi riprende dalla cache).
6. **Pianificazione:** `start installa`.

Su Windows i comandi sono `.\start.ps1 <comando>` da PowerShell, oppure `start.cmd <comando>` da cmd o con doppio clic. Su Linux sono `./start.sh <comando>`.

## Comandi

| Comando | Cosa fa |
| --- | --- |
| `start installa` / `start disinstalla` | Registra o rimuove motore, scansione e dashboard: Utilità di pianificazione su Windows, timer di systemd dell'utente su Linux. |
| `start avvia` | Motore e dashboard insieme, in una sola finestra, senza pianificazione. Ctrl+C o la chiusura della finestra li ferma entrambi. Se uno dei due si chiude da solo, lo riavvia dopo 15 secondi; dopo 5 chiusure in un'ora ferma tutto. |
| `start motore` | Il motore in primo piano: un tick ogni 30 secondi, finché non chiudi. |
| `start dashboard` | La webapp su `127.0.0.1:8787`. |
| `start tick` | Una sola esecuzione del motore: la sveglia dovuta, o la scansione del sabato. |
| `start once --slot briefing\|apertura\|meta\|chiusura [--force]` | Una sveglia subito. Fuori orario ha un suo id e non si confonde con quelle previste. |
| `start scan` | Scansione fondamentale (riprende dalla cache se interrotta). |
| `start review [--force]` | Review di apprendimento. |
| `start status` | Stato rapido nel terminale. |
| `start probe` | Sonda reale dei servizi. |
| `start test` | Tutti i test, con broker, dati e cervello finti. |
| `start build` | Crea i pacchetti per Windows e Linux in `build/`. |

Aggiungi `--fake` a qualsiasi comando per usare broker, dati, cervello e Telegram finti. Lo stato finto sta in `fake/`, separato da quello vero.

## Le sveglie (ora di New York, calendario di borsa)

| Sveglia | Quando | Cosa fa |
| --- | --- | --- |
| Briefing | 09:30 ora di Roma | Conto, protezioni, segnali sulle candele chiuse, piano del giorno. Nessun ordine, salvo ricreare una protezione mancante. |
| Apertura | apertura + 10 min | Prima le uscite, poi gli ingressi nei posti liberi. |
| Metà seduta | 12:30 New York | Protezioni. Ingressi solo se in giornata si è liberato un posto. |
| Chiusura | chiusura − 30 min | Resoconto, operazioni ombra, simulazioni. |

Una sveglia partita con più di 20 minuti di ritardo è "saltata". Se il bot riparte dopo averne saltata qualcuna (PC spento, motore chiuso), al primo tick recupera **una sola** sveglia della giornata, con queste regole:

- a mercato aperto recupera l'apertura, oppure la metà seduta;
- dopo l'orario della chiusura recupera solo la chiusura, senza acquisti;
- prima dell'apertura recupera solo il briefing.

Non si torna mai indietro dopo una sveglia già fatta. Se la prossima sveglia prevista è a meno di 30 minuti, il recupero lascia fare a lei. Ogni recupero si tenta una volta sola, e il resoconto su Telegram dice che è un recupero. Weekend e festivi non contano.

## Dove guardare

- **Telegram**: un messaggio a fine sveglia (alla chiusura con la distanza di ogni posizione aperta da stop e take profit, in % e in $), gli allarmi ⚠ a parte, la scansione del sabato, la review con i pulsanti Approva/Rifiuta.
- **Dashboard** (tema Dusk, grafici bklit animati con motion, utilizzabile anche da telefono):
  - *Panoramica*: patrimonio contro SPY e riquadri delle posizioni;
  - *Guida*: come funziona il bot, dalla selezione alle uscite, con i numeri dei parametri attivi;
  - *Selezione*: l'analisi del mercato della scansione: settori contro SPY, i passi dall'universo agli acquistabili, l'elenco con lo stato tecnico di ogni titolo. Ogni titolo si apre con il perché è stato scelto (criterio per criterio, con valori, soglie e percentili), i segnali tecnici e i grafici di prezzo (1 mese, 6 mesi, 1 anno, tutto lo storico) e volume. Da qui si fanno gli override della lista (aggiungere un titolo della zona grigia, toglierne uno) e si lancia una scansione manuale;
  - *Storico* e *Ombra*: le operazioni ombra sono simulate e sempre separate;
  - *Review*: elenco cliccabile, con il dettaglio di cosa è stato provato e perché; proposte e versioni dei parametri;
  - *Impostazioni*, a schede, con una spiegazione per ogni scheda e la «i» accanto a ogni parametro;
  - *Consumi AI*: il costo è una stima del client, non l'importo fatturato.
- **File**: `logs/<id-sveglia>.log` per ogni sveglia, `state/journal/` per il diario (solo in aggiunta).

Da un altro computer la dashboard non è raggiungibile, per scelta. Sul Raspberry usa un tunnel SSH: `ssh -L 8787:127.0.0.1:8787 utente@raspberry`, poi apri `http://127.0.0.1:8787`.

## Sicurezza

- Solo paper.
- Niente short e niente leva: all'avvio il conto viene impostato con `no_shorting` e moltiplicatore 1, e se l'impostazione non si applica il bot non parte.
- Si spende solo il cash, mai il margine.
- I segreti non compaiono in log, messaggi, pagine o pacchetti.

## Limiti da conoscere

- Gli stop scattano solo in seduta regolare e **non proteggono dai gap di apertura**.
- Il conto paper esegue in modo ideale: i risultati reali sarebbero peggiori.
- Con 5 posizioni di settimane servono mesi per avere 30 operazioni chiuse. Fino ad allora ogni conclusione è da "campione piccolo", e la review non propone niente.
- Con Finnhub gratuito mancano le stime degli analisti e l'FFO dei REIT: quei criteri risultano sempre "non disponibile".

L'elenco completo è in fondo a [docs/review-codice.md](docs/review-codice.md).

## Per chi sviluppa

- Bun + TypeScript. Il motore non ha dipendenze; il lato browser della dashboard sì (vedi sotto).

### Librerie della grafica

Servono solo alla dashboard nel browser. Sono già compilate in `src/dashboard/assets/client.js` e `client.css`, quindi per usare il bot non vanno installate.

| Libreria | Versione | A cosa serve | Licenza |
| --- | --- | --- | --- |
| [bklit](https://bklit.com) (componenti dei grafici) | copiati in `src/dashboard/client/bklit/` | grafici a linee, a barre, impilati e a torta, con tooltip | MIT |
| [motion](https://motion.dev) | 12.27.0 | animazioni dei grafici e ingresso degli elementi; rispetta "riduci movimento" | MIT |
| [React](https://react.dev) e react-dom | 19.2.0 | monta i grafici nelle pagine create dal server ("isole") | MIT |
| [d3-scale](https://d3js.org/d3-scale), [d3-shape](https://d3js.org/d3-shape), [d3-array](https://d3js.org/d3-array) | 4.0.2, 3.2.0, 3.2.4 | scale, curve e calcoli dei grafici bklit | ISC |
| [@number-flow/react](https://number-flow.barvian.me) | 0.5.11 | numeri animati dei riquadri (patrimonio, cash) | MIT |
| [@base-ui/react](https://base-ui.com) | 1.1.0 | componenti di base usati da bklit | MIT |
| [clsx](https://github.com/lukeed/clsx), [tailwind-merge](https://github.com/dcastil/tailwind-merge) | 2.1.1, 2.6.0 | composizione delle classi CSS | MIT |
| [Tailwind CSS](https://tailwindcss.com) | 4.1.8 | stili dei grafici; solo in fase di compilazione | MIT |
| [Wix Madefor](https://github.com/wix-incubator/wixmadefor) Display e Text | in `src/dashboard/assets/` | caratteri del tema Dusk, serviti in locale | OFL 1.1 |

Il resto della dashboard (pagine, tabelle, grafico a cono della selezione, grafici di riserva in SVG quando JavaScript non c'è) è HTML e SVG scritti a mano, senza librerie. Niente CDN: tutto è servito da `127.0.0.1`.

- Dopo una modifica ai grafici: `bun install`, poi `bun run client` (ricompila `src/dashboard/assets/client.js` e `client.css`, che vanno nel commit).
- Test con `bun test`.
- Struttura in `src/` (config, params, broker, data, scan, signals, cage, run, brain, journal, learning, telegram, dashboard, util).
- Come lavorare sul codice: [CLAUDE.md](CLAUDE.md).
- Revisione modulo per modulo: [docs/review-codice.md](docs/review-codice.md).
- Il motore è indipendente dal sistema operativo; le sole differenze sono isolate:
  - riconoscimento dei processi: `Get-Process` su Windows, `/proc` su Linux;
  - cartella di lavoro del cervello;
  - script di avvio e di pianificazione.
