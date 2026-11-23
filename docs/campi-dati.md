# Campi dei dati (sonda reale)

Generato da `bun run probe` il 23/11/2026 10:23 (ora di Roma). Contiene solo **nomi e tipi** dei campi, mai i valori del conto né i segreti.

## Alpaca trading (paper)

Endpoint: `https://paper-api.alpaca.markets/v2`.

### `GET /v2/account`

| Campo | Tipo | Valore |
|---|---|---|
| `account_blocked` | boolean | `false` |
| `account_number` | stringa | — |
| `accrued_fees` | stringa numerica | — |
| `admin_configurations` | object | — |
| `balance_asof` | stringa | — |
| `buying_power` | stringa numerica | — |
| `cash` | stringa numerica | — |
| `created_at` | stringa | — |
| `crypto_status` | stringa | — |
| `crypto_tier` | number | — |
| `currency` | stringa | `"USD"` |
| `effective_buying_power` | stringa numerica | — |
| `equity` | stringa numerica | — |
| `id` | stringa | — |
| `initial_margin` | stringa numerica | — |
| `intraday_adjustments` | stringa numerica | — |
| `last_equity` | stringa numerica | — |
| `last_maintenance_margin` | stringa numerica | — |
| `long_market_value` | stringa numerica | — |
| `maintenance_margin` | stringa numerica | — |
| `multiplier` | stringa numerica | `"2"` |
| `non_marginable_buying_power` | stringa numerica | — |
| `options_approved_level` | number | — |
| `options_buying_power` | stringa numerica | — |
| `options_trading_level` | number | — |
| `pending_reg_taf_fees` | stringa numerica | — |
| `portfolio_value` | stringa numerica | — |
| `position_market_value` | stringa numerica | — |
| `regt_buying_power` | stringa numerica | — |
| `short_market_value` | stringa numerica | — |
| `shorting_enabled` | boolean | `true` |
| `sma` | stringa numerica | — |
| `status` | stringa | `"ACTIVE"` |
| `trade_suspended_by_user` | boolean | — |
| `trading_blocked` | boolean | `false` |
| `transfers_blocked` | boolean | — |
| `user_configurations` | null | — |

Campi PDT deprecati presenti (il bot non li usa): nessuno.

### `GET /v2/account/configurations`

| Campo | Tipo | Valore |
|---|---|---|
| `closing_transactions_only` | boolean | `false` |
| `disable_overnight_trading` | boolean | `false` |
| `fractional_trading` | boolean | `true` |
| `max_margin_multiplier` | stringa numerica | `"4"` |
| `no_shorting` | boolean | `false` |
| `ptp_no_exception_entry` | boolean | `false` |
| `suspend_trade` | boolean | `false` |
| `trade_confirm_email` | stringa | `"all"` |

- `no_shorting` presente: **sì**; `max_margin_multiplier` presente: **sì** (tipo stringa numerica).
- La sonda non modifica la configurazione: lo fa la prima sveglia, che poi la rilegge.

### `GET /v2/clock`

| Campo | Tipo | Valore |
|---|---|---|
| `is_open` | boolean | `false` |
| `next_close` | stringa | `"2026-11-23T16:00:00-05:00"` |
| `next_open` | stringa | `"2026-11-23T09:30:00-05:00"` |
| `timestamp` | stringa | `"2026-11-23T04:23:30.793995565-05:00"` |

### `GET /v2/calendar`

| Campo | Tipo | Valore |
|---|---|---|
| `close` | stringa | `"16:00"` |
| `date` | stringa | `"2026-11-23"` |
| `open` | stringa | `"09:30"` |
| `session_close` | stringa numerica | `"2000"` |
| `session_open` | stringa numerica | `"0400"` |
| `settlement_date` | stringa | `"2026-11-24"` |

Mezze giornate nei prossimi 40 giorni: 2026-11-27, 2026-12-24. Formato di `open`/`close`: `09:30` (ora di New York).

### `GET /v2/account/portfolio/history`

Campi: `timestamp` (array(7)), `equity` (array(7)), `profit_loss` (array(7)), `profit_loss_pct` (array(7)), `base_value` (number), `base_value_asof` (stringa), `timeframe` (stringa).

### `GET /v2/assets`

| Campo | Tipo | Valore |
|---|---|---|
| `attributes` | array(0) | — |
| `borrow_status` | stringa | — |
| `class` | stringa | `"us_equity"` |
| `easy_to_borrow` | boolean | — |
| `exchange` | stringa | `"OTC"` |
| `fractionable` | boolean | — |
| `id` | stringa | — |
| `maintenance_margin_requirement` | number | — |
| `margin_requirement_long` | stringa numerica | — |
| `margin_requirement_short` | stringa numerica | — |
| `marginable` | boolean | — |
| `name` | stringa | — |
| `shortable` | boolean | — |
| `status` | stringa | `"active"` |
| `symbol` | stringa | — |
| `tradable` | boolean | `false` |

Titoli attivi: 14459. Per borsa: OTC 1196, NASDAQ 5615, ARCA 2780, NYSE 2883, BATS 1682, AMEX 290, TXSE 13.

### Ordini: id duplicato, ricerca per id, sotto-centesimo

- Ricerca di un id inesistente: **HTTP 404** (atteso 404).
- Primo invio: stato `pending_new`. Campi dell'ordine: `asset_class`, `asset_id`, `canceled_at`, `client_order_id`, `created_at`, `expired_at`, `expires_at`, `extended_hours`, `failed_at`, `filled_at`, `filled_avg_price`, `filled_qty`, `hwm`, `id`, `legs`, `limit_price`, `notional`, `order_class`, `order_type`, `position_intent`, `qty`, `replaced_at`, `replaced_by`, `replaces`, `side`, `source`, `status`, `stop_price`, `submitted_at`, `subtag`, `symbol`, `time_in_force`, `trail_percent`, `trail_price`, `type`, `updated_at`.
- Secondo invio con lo stesso id: **HTTP 422**, codice `42210000`, messaggio "client_order_id must be unique". Il bot non dipende da questo codice: verifica per id prima di inviare.
- Ricerca per id dell'ordine appena inviato: trovato, stato `new`.
- Dopo la cancellazione: stato `canceled`.
- Prezzo 1,005 $ (sotto-centesimo): **rifiutato**, HTTP 422, "invalid limit_price 1.005. sub-penny increment does not fulfill minimum pricing criteria".

## Alpaca Market Data

Endpoint: `https://data.alpaca.markets/v2`.

### Candele giornaliere `GET /v2/stocks/bars` (feed=sip)

Chiavi della risposta: `bars`, `next_page_token`. Campi di una candela: `c` (number), `h` (number), `l` (number), `n` (number), `o` (number), `t` (stringa), `v` (number), `vw` (number).

- `t` di esempio: `2026-11-13T05:00:00Z`: mezzanotte di New York espressa in UTC. Il bot la converte nella data della seduta.
- Ultima candela SPY: `2026-11-20T05:00:00Z`. Chiusura con adjustment=all 689.81, con adjustment=split 689.81. Le chiusure passate differiscono per i dividendi: non in questo intervallo.

### Snapshot `GET /v2/stocks/snapshots` (feed=iex)

Forma della risposta: mappa simbolo → snapshot. Campi: `dailyBar`, `latestQuote`, `latestTrade`, `minuteBar`, `prevDailyBar`. `latestTrade`: `c`, `i`, `p`, `s`, `t`, `x`, `z`.

## Finnhub (piano gratuito)

Endpoint: `https://finnhub.io/api/v1`. Chiave nell'header `X-Finnhub-Token`.

### `/stock/metric?metric=all` su 20 titoli (AAPL, MSFT, NVDA, JPM, BAC, XOM, JNJ, PFE, O, PLD, NEE, DUK, KO, PG, WMT, HD, CAT, LIN, GOOGL, T)

| Criterio | Campo usato | Presente in | Valori di esempio | Unità |
|---|---|---|---|---|
| epsAnnuo | `epsGrowthTTMYoy` | 20/20 | AAPL 20.31; MSFT 36.24; NVDA 130.51; JPM 17.88 | % |
| ricaviTrim | `revenueGrowthQuarterlyYoy` | 20/20 | AAPL 11.72; MSFT 18.80; NVDA 103.21; JPM 73.97 | % |
| epsTrim | `epsGrowthQuarterlyYoy` | 20/20 | AAPL 13.59; MSFT 32.37; NVDA 107.10; JPM 9.69 | % |
| roe | `roeTTM` | 20/20 | AAPL 127.61; MSFT 33.21; NVDA 106.67; JPM 17.91 | % |
| roe | `roeRfy` | 20/20 | AAPL 117.92; MSFT 30.23; NVDA 76.33; JPM 15.74 | % |
| roa | `roaTTM` | 20/20 | AAPL 34.37; MSFT 19.69; NVDA 78.10; JPM 1.36 | % |
| roa | `roaRfy` | 20/20 | AAPL 32.67; MSFT 17.64; NVDA 58.06; JPM 1.29 | % |
| debito | `totalDebt/totalEquityQuarterly` | 20/20 | AAPL 0.71; MSFT 0.23; NVDA 0.12; JPM 3.32 | rapporto |
| debito | `totalDebt/totalEquityAnnual` | 20/20 | AAPL 0.73; MSFT 0.24; NVDA 0.05; JPM 2.55 | rapporto |
| quick | `quickRatioQuarterly` | 18/20 | AAPL 0.94; MSFT 1.21; NVDA 3.29; XOM 0.92 | rapporto |
| quick | `quickRatioAnnual` | 18/20 | AAPL 0.94; MSFT 1.22; NVDA 3.14; XOM 0.79 | rapporto |
| pe | `peTTM` | 20/20 | AAPL 37.66; MSFT 25.23; NVDA 13.37; JPM 12.50 | rapporto |
| pe | `peExclExtraTTM` | 20/20 | AAPL 37.66; MSFT 25.23; NVDA 13.37; JPM 12.50 | rapporto |
| pe | `peBasicExclExtraTTM` | 20/20 | AAPL 37.66; MSFT 25.23; NVDA 13.37; JPM 12.50 | rapporto |
| margine | `netProfitMarginTTM` | 20/20 | AAPL 27.60; MSFT 41.17; NVDA 62.53; JPM 33.26 | % |
| margine | `netProfitMarginAnnual` | 20/20 | AAPL 27.60; MSFT 40.31; NVDA 55.60; JPM 29.28 | % |
| ricavi5a | `revenueGrowth5Y` | 20/20 | AAPL 5.53; MSFT 14.57; NVDA 66.90; JPM 7.73 | % |
| eps5a | `epsGrowth5Y` | 18/20 | AAPL 9.85; MSFT 17.38; NVDA 95.27; JPM 16.80 | % |
| epsProssimo | — | — | — | non disponibile: stima degli analisti: a pagamento su Finnhub |
| epsProssimi5 | — | — | — | non disponibile: stima degli analisti: a pagamento su Finnhub |
| pfcf | `pfcfShareTTM` | 20/20 | AAPL 36.59; MSFT 60.01; NVDA 20.34; JPM 5.39 | rapporto |
| pfcf | `pfcfShareAnnual` | 20/20 | AAPL 36.59; MSFT 53.71; NVDA 31.29; JPM 63.56 | rapporto |
| peg | `pegTTM` | 20/20 | AAPL 3.06; MSFT 1.53; NVDA 0.46; JPM 1.33 | rapporto |
| peg | `pegRatio` | 0/20 | — | rapporto |
| cap | `marketCapitalization` | 20/20 | AAPL 4978144.50; MSFT 3598139.80; NVDA 3025273.00; JPM 824646.44 | mln $ |
| yield | `currentDividendYieldTTM` | 20/20 | AAPL 0.32; MSFT 0.75; NVDA 0.42; JPM 2.12 | % |
| yield | `dividendYieldIndicatedAnnual` | 19/20 | AAPL 0.51; MSFT 0.79; NVDA 0.03; JPM 2.74 | % |
| payout | `payoutRatioTTM` | 20/20 | AAPL 11.89; MSFT 18.95; NVDA 5.55; JPM 26.46 | % |
| payout | `payoutRatioAnnual` | 20/20 | AAPL 11.89; MSFT 19.77; NVDA 0.81; JPM 29.14 | % |

Tutti i campi visti in `metric` (133), con il numero di titoli che li hanno:

`10DayAverageTradingVolume` 20 · `13WeekPriceReturnDaily` 20 · `26WeekPriceReturnDaily` 20 · `3MonthADReturnStd` 20 · `3MonthAverageTradingVolume` 20 · `52WeekHigh` 20 · `52WeekHighDate` 20 · `52WeekLow` 20 · `52WeekLowDate` 20 · `52WeekPriceReturnDaily` 20 · `5DayPriceReturnDaily` 20 · `assetTurnoverAnnual` 18 · `assetTurnoverTTM` 18 · `beta` 20 · `bookValuePerShareAnnual` 20 · `bookValuePerShareQuarterly` 20 · `bookValueShareGrowth5Y` 20 · `capexCagr5Y` 20 · `cashFlowPerShareAnnual` 20 · `cashFlowPerShareQuarterly` 20 · `cashFlowPerShareTTM` 20 · `cashPerSharePerShareAnnual` 20 · `cashPerSharePerShareQuarterly` 20 · `currentDividendYieldTTM` 20 · `currentEv/freeCashFlowAnnual` 17 · `currentEv/freeCashFlowTTM` 16 · `currentRatioAnnual` 18 · `currentRatioQuarterly` 18 · `dividendGrowthRate5Y` 19 · `dividendIndicatedAnnual` 20 · `dividendPerShareAnnual` 20 · `dividendPerShareTTM` 20 · `dividendYieldIndicatedAnnual` 19 · `ebitdaCagr5Y` 20 · `ebitdaInterimCagr5Y` 20 · `ebitdPerShareAnnual` 18 · `ebitdPerShareTTM` 20 · `enterpriseValue` 20 · `epsAnnual` 20 · `epsBasicExclExtraItemsAnnual` 20 · `epsBasicExclExtraItemsTTM` 20 · `epsExclExtraItemsAnnual` 20 · `epsExclExtraItemsTTM` 20 · `epsGrowth3Y` 20 · `epsGrowth5Y` 20 · `epsGrowthQuarterlyYoy` 20 · `epsGrowthTTMYoy` 20 · `epsInclExtraItemsAnnual` 20 · `epsInclExtraItemsTTM` 20 · `epsNormalizedAnnual` 20 · `epsTTM` 20 · `evEbitdaTTM` 18 · `evRevenueTTM` 18 · `focfCagr5Y` 20 · `forwardPE` 20 · `forwardPEG` 17 · `grossMargin5Y` 16 · `grossMarginAnnual` 16 · `grossMarginTTM` 17 · `inventoryTurnoverAnnual` 17 · `inventoryTurnoverTTM` 17 · `longTermDebt/equityAnnual` 20 · `longTermDebt/equityQuarterly` 20 · `marketCapitalization` 20 · `monthToDatePriceReturnDaily` 20 · `netIncomeEmployeeAnnual` 20 · `netIncomeEmployeeTTM` 20 · `netInterestCoverageAnnual` 17 · `netInterestCoverageTTM` 18 · `netMarginGrowth5Y` 20 · `netProfitMargin5Y` 20 · `netProfitMarginAnnual` 20 · `netProfitMarginTTM` 20 · `operatingMargin5Y` 20 · `operatingMarginAnnual` 20 · `operatingMarginTTM` 20 · `payoutRatioAnnual` 20 · `payoutRatioTTM` 20 · `pb` 20 · `pbAnnual` 20 · `pbQuarterly` 20 · `pcfShareAnnual` 20 · `pcfShareTTM` 20 · `peAnnual` 20 · `peBasicExclExtraTTM` 20 · `peExclExtraAnnual` 19 · `peExclExtraTTM` 20 · `pegTTM` 20 · `peInclExtraTTM` 20 · `peNormalizedAnnual` 20 · `peTTM` 20 · `pfcfShareAnnual` 20 · `pfcfShareTTM` 20 · `pretaxMargin5Y` 20 · `pretaxMarginAnnual` 20 · `pretaxMarginTTM` 20 · `priceRelativeToS&P50013Week` 20 · `priceRelativeToS&P50026Week` 20 · `priceRelativeToS&P5004Week` 20 · `priceRelativeToS&P50052Week` 20 · `priceRelativeToS&P500Ytd` 20 · `psAnnual` 20 · `psTTM` 20 · `ptbvAnnual` 20 · `ptbvQuarterly` 20 · `quickRatioAnnual` 18 · `quickRatioQuarterly` 18 · `receivablesTurnoverAnnual` 18 · `receivablesTurnoverTTM` 18 · `revenueEmployeeAnnual` 20 · `revenueEmployeeTTM` 18 · `revenueGrowth3Y` 20 · `revenueGrowth5Y` 20 · `revenueGrowthQuarterlyYoy` 20 · `revenueGrowthTTMYoy` 20 · `revenuePerShareAnnual` 20 · `revenuePerShareTTM` 20 · `revenueShareGrowth5Y` 20 · `roa5Y` 20 · `roaRfy` 20 · `roaTTM` 20 · `roe5Y` 20 · `roeRfy` 20 · `roeTTM` 20 · `roi5Y` 20 · `roiAnnual` 20 · `roiTTM` 20 · `tangibleBookValuePerShareAnnual` 20 · `tangibleBookValuePerShareQuarterly` 20 · `tbvCagr5Y` 19 · `totalDebt/totalEquityAnnual` 20 · `totalDebt/totalEquityQuarterly` 20 · `yearToDatePriceReturnDaily` 20

Serie annuali (`series.annual`): `bookValue`, `cashRatio`, `currentRatio`, `ebitPerShare`, `ebitda`, `eps`, `ev`, `evEbitda`, `evRevenue`, `fcfMargin`, `grossMargin`, `inventoryTurnover`, `longtermDebtTotalAsset`, `longtermDebtTotalCapital`, `longtermDebtTotalEquity`, `netDebtToTotalCapital`, `netDebtToTotalEquity`, `netMargin`, `operatingMargin`, `payoutRatio`, `pb`, `pe`, `pfcf`, `pretaxMargin`, `ps`, `ptbv`, `quickRatio`, `receivablesTurnover`, `roa`, `roe`, `roic`, `rotc`, `salesPerShare`, `sgaToSale`, `tangibleBookValue`, `totalDebtToEquity`, `totalDebtToTotalAsset`, `totalDebtToTotalCapital`, `totalRatio`.
Esempio `series.annual.pe` di AAPL: 2026-09-26=37.4, 2025-09-27=33.6, 2024-09-28=37.6, 2023-09-30=27.9, 2022-09-24=24.1, 2021-09-25=25.4.

### `/stock/profile2`

Campi: `country`, `currency`, `estimateCurrency`, `exchange`, `finnhubIndustry`, `floatingShare`, `ipo`, `logo`, `marketCapitalization`, `name`, `phone`, `shareOutstanding`, `ticker`, `weburl`.
Capitalizzazione di AAPL (milioni di $): profile2 4978144 · metric 4978145.

### Valori di `finnhubIndustry` visti (36) e settore assegnato

| Industria | Settore | Esempi |
|---|---|---|
| Aerospace & Defense | Industrials | BA, GE, RTX, LMT, GD, NOC |
| Airlines | Industrials | DAL, UAL, LUV |
| Automobiles | Consumer Cyclical | TSLA, GM, F |
| Banking | Financial | JPM, BAC, WFC, C, USB, PNC |
| Beverages | Consumer Defensive | KO, PEP, STZ, KDP |
| Biotechnology | Healthcare | ABBV, AMGN, GILD, VRTX, REGN |
| Chemicals | Basic Materials | LIN, SHW, APD, ECL, DOW, PPG |
| Commercial Services & Supplies | Industrials | WM, RSG |
| Communications | Technology | CSCO, ANET, MSI |
| Construction | Industrials | VMC, MLM |
| Consumer products | Consumer Defensive | PG, CL, KMB, EL, CLX |
| Electrical Equipment | Industrials | APH, TEL, GLW, ETN, EMR |
| Energy | Energy | XOM, CVX, COP, EOG, SLB, PSX |
| Financial Services | Financial | GS, MS, SCHW, BLK, AXP, SPGI |
| Food Products | Consumer Defensive | MDLZ, GIS, KHC, HSY, ADM |
| Health Care | Healthcare | UNH, ABT, ISRG, MDT, SYK, BSX |
| Hotels, Restaurants & Leisure | Consumer Cyclical | MCD, SBUX, BKNG, MAR, HLT, CMG |
| Industrial Conglomerates | Industrials | DD, HON |
| Insurance | Financial | CB, PGR, AON, MET, PRU, AIG |
| Life Sciences Tools & Services | Healthcare | TMO, DHR, IQV, A |
| Logistics & Transportation | Industrials | UPS, FDX |
| Machinery | Industrials | CAT, DE, ITW, PH, CMI, PCAR |
| Media | Communication Services | GOOGL, META, DIS, NFLX, CHTR, EA |
| Metals & Mining | Basic Materials | FCX, NEM, NUE |
| Packaging | Basic Materials | IP, BALL |
| Pharmaceuticals | Healthcare | JNJ, PFE, LLY, MRK, BMY, ZTS |
| Real Estate | Real Estate | O, PLD, AMT, EQIX, CCI, PSA |
| Retail | Consumer Cyclical | WMT, HD, AMZN, LOW, TJX, ORLY |
| Road & Rail | Industrials | UNP, CSX, NSC |
| Semiconductors | Technology | NVDA, AVGO, AMD, INTC, QCOM, TXN |
| Technology | Technology | AAPL, MSFT, ORCL, CRM, ADBE, IBM |
| Telecommunication | Communication Services | T, VZ, TMUS, CMCSA |
| Textiles, Apparel & Luxury Goods | Consumer Cyclical | NKE, LULU |
| Tobacco | Consumer Defensive | PM, MO |
| Trading Companies & Distributors | Industrials | URI, FAST, GWW |
| Utilities | Utilities | NEE, DUK, SO, D, AEP, EXC |

### `/calendar/earnings`

Risposta per AAPL (−100/+30 giorni): 1 righe; esempio {"symbol":"AAPL","date":"2026-11-02","hour":"amc"}.

Richieste Finnhub fatte dalla sonda: 241.

## Cervello (`claude -p`)

Versione: `2.1.325 (Claude Code)`. Percorso trovato: nel PATH.

| Flag | Presente |
|---|---|
| `--output-format` | sì |
| `--json-schema` | sì |
| `--tools` | sì |
| `--disallowedTools` | sì |
| `--strict-mcp-config` | sì |
| `--no-session-persistence` | sì |
| `--max-turns` | **no** |
| `--max-budget-usd` | sì |
| `--model` | sì |
| `--setting-sources` | sì |
| `--safe-mode` | sì |
| `--system-prompt` | sì |
| `--bare` | sì |

Comando usato (senza prompt, che passa da stdin): `-p --output-format json --json-schema {"type":"object","properties":{"istruzioni":{"type":"stri… --tools "" --disallowedTools mcp__* --strict-mcp-config --no-session-persistence --max-budget-usd 0.50 --setting-sources project --safe-mode --system-prompt Sei il modulo di prova del bot Indiano Trading. Rispondi …`

Esito: **ok**. Durata 22.9 s.

Consumi letti: costo stimato 0.027140000000000004 $, token {"input":1286,"output":1873,"cacheLettura":1428,"cacheScrittura":2579}, turni 3, subtype `success`, modelli: `claude-haiku-5-5`, `claude-sonnet-5-5`.

Cosa dice di ricevere il cervello:

- **Istruzioni:** Ricevo: (a) il ruolo di "modulo di prova del bot Indiano Trading", con risposte in italiano e concise; (b) la regola di eseguire in parallelo le chiamate a strumenti indipendenti e in sequenza quelle dipendenti; (c) l'obbligo di chiamare StructuredOutput una sola volta alla fine; (d) indicazioni sull'ambiente: scratchpad per i file temporanei, file scaricati trattati come non attendibili (cartelle separate, Python con -I), PowerShell come shell principale. Sono indicato come agente Claude basato sull'Agent SDK, con budget di 0,5 USD.
- **Contesto:** CLAUDE.md: non presente. Memoria dell'utente: non presente. Skill: nessuna elencata. File di impostazioni: nessuno visibile. Vedo solo i dati dell'ambiente. Cartella di lavoro: C:/Users/davide.ambrosi/AppData/Local/IndianoTrading/brain-cwd (non è un repository git). Piattaforma: win32, Windows 11 Enterprise 10.0.26200, shell PowerShell (Bash disponibile). Scratchpad: C:/Users/DAVIDE~1.AMB/AppData/Local/Temp/claude/55faf9b1389a9026/5746907c-5bf8-4838-bd98-dc1fc774a3d3/scratchpad. Modello: Sonnet 5.5 (claude-sonnet-5-5). Data: 2026-11-23. Budget: circa 0,014 USD usati su 0,5.
- **Strumenti:** StructuredOutput: l'unico strumento che posso chiamare. Restituisce la risposta finale con i campi istruzioni, contesto e strumenti., Il testo di sistema parla di strumenti 'deferred' che possono comparire più avanti, ma finora non ne è comparso nessuno., Il testo cita anche uno strumento Bash, ma non ne ho una definizione chiamabile., Non vedo altri strumenti, come lettura o scrittura di file o accesso al web.

