// bun run probe — sonda reale di Alpaca (paper), Alpaca Market Data, Finnhub e del cervello.
// Scrive docs/campi-dati.md con i NOMI e i TIPI dei campi (mai i valori del conto, mai i segreti).
import * as fs from "node:fs";
import * as path from "node:path";
import { PROJECT_ROOT, makePaths } from "../config/paths.ts";
import { assertPaperSafety, loadSecrets } from "../config/segreti.ts";
import { PAPER_TRADING_URL, ALPACA_DATA_URL, FINNHUB_URL } from "../config/costanti.ts";
import { CAMPI_FINNHUB, type MetricId } from "../config/campi-finnhub.ts";
import { INDUSTRIA_SETTORE } from "../config/settori.ts";
import { httpJson } from "../util/http.ts";
import { errText, redact } from "../util/redact.ts";
import { dateInTz, TZ_NY, addDays, formatRome } from "../util/time.ts";
import { parseArgs } from "../util/args.ts";
import { FinnhubClient } from "../data/finnhub.ts";
import { callClaude, claudeFlags, findClaude, buildArgs } from "../brain/claude.ts";
import { appendUsage, rigaDaRisultato } from "../brain/usage.ts";

const args = parseArgs();
const out: string[] = [];
const w = (s = "") => out.push(s);
const log = (s: string) => console.log(redact(s));

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v) ? "stringa numerica" : "stringa";
  return typeof v;
}

function fieldTable(obj: Record<string, unknown>, showValues: string[] = []): void {
  w("| Campo | Tipo | Valore |");
  w("|---|---|---|");
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    const shown = showValues.includes(k) ? `\`${JSON.stringify(v)}\`` : "—";
    w(`| \`${k}\` | ${typeOf(v)} | ${shown} |`);
  }
  w();
}

const SAMPLE_METRIC = ["AAPL", "MSFT", "NVDA", "JPM", "BAC", "XOM", "JNJ", "PFE", "O", "PLD", "NEE", "DUK", "KO", "PG", "WMT", "HD", "CAT", "LIN", "GOOGL", "T"];
const SAMPLE_INDUSTRY = [
  "AMZN", "META", "TSLA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "INTC", "CSCO", "QCOM", "TXN", "IBM", "NOW", "INTU", "AMAT", "MU", "LRCX", "ADI", "KLAC",
  "PANW", "SNPS", "CDNS", "ANET", "MSI", "APH", "TEL", "GLW", "HPQ", "DELL", "WFC", "C", "GS", "MS", "SCHW", "BLK", "AXP", "SPGI", "CB", "PGR",
  "MMC", "AON", "MET", "PRU", "AIG", "TRV", "ALL", "COF", "USB", "PNC", "V", "MA", "PYPL", "UNH", "LLY", "MRK", "ABBV", "TMO", "ABT", "DHR",
  "AMGN", "BMY", "GILD", "ISRG", "MDT", "SYK", "VRTX", "REGN", "ZTS", "BSX", "CI", "ELV", "HCA", "CVS", "MCK", "IQV", "A", "DXCM", "IDXX", "BDX",
  "SO", "D", "AEP", "EXC", "SRE", "XEL", "PEG", "ED", "WEC", "AWK", "AMT", "EQIX", "CCI", "PSA", "SPG", "WELL", "DLR", "VICI", "AVB", "EQR",
  "VZ", "TMUS", "CMCSA", "DIS", "NFLX", "CHTR", "EA", "TTWO", "WBD", "OMC", "SHW", "APD", "ECL", "FCX", "NEM", "NUE", "DOW", "DD", "PPG", "IP",
  "BALL", "VMC", "MLM", "CVX", "COP", "EOG", "SLB", "PSX", "MPC", "VLO", "OXY", "WMB", "KMI", "HAL", "BA", "GE", "HON", "UPS", "RTX", "LMT",
  "DE", "UNP", "ETN", "ITW", "EMR", "GD", "NOC", "FDX", "CSX", "NSC", "WM", "RSG", "PH", "CMI", "PCAR", "DAL", "UAL", "LUV", "URI", "FAST",
  "GWW", "MCD", "NKE", "SBUX", "LOW", "TJX", "BKNG", "MAR", "HLT", "GM", "F", "ORLY", "AZO", "ROST", "CMG", "YUM", "LULU", "DPZ", "EBAY", "ETSY",
  "PEP", "COST", "PM", "MO", "MDLZ", "CL", "KMB", "GIS", "KHC", "STZ", "TGT", "KR", "SYY", "HSY", "KDP", "EL", "CLX", "DG", "DLTR", "ADM",
];

async function main() {
  const secrets = await loadSecrets();
  if (!secrets) {
    console.error("secrets.ts non trovato: compila il file prima della sonda.");
    process.exit(1);
  }
  assertPaperSafety(secrets);
  const paths = makePaths(PROJECT_ROOT);
  const H = { "APCA-API-KEY-ID": secrets.alpaca.keyId, "APCA-API-SECRET-KEY": secrets.alpaca.secretKey };
  const now = new Date();
  w("# Campi dei dati (sonda reale)");
  w();
  w(`Generato da \`bun run probe\` il ${formatRome(now)} (ora di Roma). Contiene solo **nomi e tipi** dei campi, mai i valori del conto né i segreti.`);
  w();

  // ---------------- Alpaca trading ----------------
  w("## Alpaca trading (paper)");
  w();
  w(`Endpoint: \`${PAPER_TRADING_URL}/v2\`.`);
  w();
  const T = (p: string, init: { method?: string; body?: unknown } = {}) => httpJson(fetch, `${PAPER_TRADING_URL}/v2${p}`, { ...init, headers: H });
  try {
    const acc = (await T("/account")).data;
    w("### `GET /v2/account`");
    w();
    fieldTable(acc, ["status", "currency", "trading_blocked", "account_blocked", "shorting_enabled", "multiplier"]);
    const deprecated = ["pattern_day_trader", "daytrade_count", "daytrading_buying_power"].filter((k) => k in acc);
    w(`Campi PDT deprecati presenti (il bot non li usa): ${deprecated.length ? deprecated.map((x) => `\`${x}\``).join(", ") : "nessuno"}.`);
    w();
    log("✓ account");
  } catch (e) {
    w(`Errore su /account: ${errText(e)}`);
    w();
  }
  try {
    const cfg = (await T("/account/configurations")).data;
    w("### `GET /v2/account/configurations`");
    w();
    fieldTable(cfg, Object.keys(cfg));
    w(`- \`no_shorting\` presente: **${"no_shorting" in cfg ? "sì" : "NO"}**; \`max_margin_multiplier\` presente: **${"max_margin_multiplier" in cfg ? "sì" : "NO"}** (tipo ${typeOf(cfg.max_margin_multiplier)}).`);
    w("- La sonda non modifica la configurazione: lo fa la prima sveglia, che poi la rilegge.");
    w();
    log("✓ configurazioni");
  } catch (e) {
    w(`Errore su /account/configurations: ${errText(e)}`);
    w();
  }
  try {
    const clock = (await T("/clock")).data;
    w("### `GET /v2/clock`");
    w();
    fieldTable(clock, Object.keys(clock));
    const today = dateInTz(now, TZ_NY);
    const cal = (await T(`/calendar?start=${today}&end=${addDays(today, 40)}`)).data as any[];
    w("### `GET /v2/calendar`");
    w();
    if (cal[0]) fieldTable(cal[0], Object.keys(cal[0]));
    const half = cal.filter((d) => String(d.close).startsWith("13:00")).map((d) => d.date);
    w(`Mezze giornate nei prossimi 40 giorni: ${half.length ? half.join(", ") : "nessuna"}. Formato di \`open\`/\`close\`: \`${cal[0]?.open}\` (ora di New York).`);
    w();
    log("✓ orologio e calendario");
  } catch (e) {
    w(`Errore su clock/calendar: ${errText(e)}`);
    w();
  }
  try {
    const ph = (await T(`/account/portfolio/history?timeframe=1D&start=${addDays(dateInTz(now, TZ_NY), -10)}T00:00:00Z`)).data;
    w("### `GET /v2/account/portfolio/history`");
    w();
    w(`Campi: ${Object.keys(ph).map((k) => `\`${k}\` (${typeOf(ph[k])})`).join(", ")}.`);
    w();
  } catch (e) {
    w(`Errore su portfolio/history: ${errText(e)}`);
    w();
  }
  try {
    const assets = (await T("/assets?status=active&asset_class=us_equity")).data as any[];
    const ex = new Map<string, number>();
    for (const a of assets) ex.set(a.exchange, (ex.get(a.exchange) ?? 0) + 1);
    w("### `GET /v2/assets`");
    w();
    if (assets[0]) fieldTable(assets[0], ["class", "exchange", "status", "tradable"]);
    w(`Titoli attivi: ${assets.length}. Per borsa: ${[...ex].map(([k, v]) => `${k} ${v}`).join(", ")}.`);
    w();
    log(`✓ asset (${assets.length})`);
  } catch (e) {
    w(`Errore su /assets: ${errText(e)}`);
    w();
  }

  // ordine di prova: limit buy 1 SPY a 1 $ (non si esegue mai), poi duplicato, poi cancellazione
  w("### Ordini: id duplicato, ricerca per id, sotto-centesimo");
  w();
  if (args.flags.has("senza-ordini")) {
    w("Saltato (`--senza-ordini`).");
  } else {
    const cid = `probe-${Date.now()}`;
    try {
      const nf = await T(`/orders:by_client_order_id?client_order_id=${encodeURIComponent(cid)}`).then(() => "trovato", (e) => `HTTP ${e.status}`);
      w(`- Ricerca di un id inesistente: **${nf}** (atteso 404).`);
      const body = { symbol: "SPY", qty: "1", side: "buy", type: "limit", time_in_force: "day", limit_price: "1.00", client_order_id: cid };
      const first = (await T("/orders", { method: "POST", body })).data;
      w(`- Primo invio: stato \`${first.status}\`. Campi dell'ordine: ${Object.keys(first).sort().map((k) => `\`${k}\``).join(", ")}.`);
      try {
        await T("/orders", { method: "POST", body });
        w("- Secondo invio con lo stesso id: **accettato** (!). Il bot si difende comunque verificando l'id prima di inviare.");
      } catch (e: any) {
        w(`- Secondo invio con lo stesso id: **HTTP ${e.status}**, codice \`${e.body?.code ?? "n/d"}\`, messaggio "${redact(String(e.body?.message ?? e.message)).slice(0, 160)}". Il bot non dipende da questo codice: verifica per id prima di inviare.`);
      }
      const found = (await T(`/orders:by_client_order_id?client_order_id=${encodeURIComponent(cid)}`)).data;
      w(`- Ricerca per id dell'ordine appena inviato: trovato, stato \`${found.status}\`.`);
      await T(`/orders/${found.id}`, { method: "DELETE" }).catch(() => null);
      await Bun.sleep(1500);
      const after = (await T(`/orders/${found.id}`)).data;
      w(`- Dopo la cancellazione: stato \`${after.status}\`.`);
      try {
        const sub = (await T("/orders", { method: "POST", body: { ...body, client_order_id: `${cid}-sub`, limit_price: "1.005" } })).data;
        w(`- Prezzo 1,005 $ (sotto-centesimo): **accettato** (stato ${sub.status}); cancellato subito.`);
        await T(`/orders/${sub.id}`, { method: "DELETE" }).catch(() => null);
      } catch (e: any) {
        w(`- Prezzo 1,005 $ (sotto-centesimo): **rifiutato**, HTTP ${e.status}, "${redact(String(e.body?.message ?? e.message)).slice(0, 160)}".`);
      }
      log("✓ ordini di prova");
    } catch (e) {
      w(`- Errore nella prova degli ordini: ${errText(e)}`);
    }
  }
  w();

  // ---------------- Market data ----------------
  w("## Alpaca Market Data");
  w();
  w(`Endpoint: \`${ALPACA_DATA_URL}/v2\`.`);
  w();
  try {
    const end = new Date(now.getTime() - 16 * 60_000).toISOString();
    const start = addDays(dateInTz(now, TZ_NY), -10);
    const D = (p: string) => httpJson(fetch, `${ALPACA_DATA_URL}/v2${p}`, { headers: H });
    const ra = (await D(`/stocks/bars?symbols=SPY,AAPL&timeframe=1Day&start=${start}T00:00:00Z&end=${end}&adjustment=all&feed=sip&limit=1000`)).data;
    const rs = (await D(`/stocks/bars?symbols=SPY,AAPL&timeframe=1Day&start=${start}T00:00:00Z&end=${end}&adjustment=split&feed=sip&limit=1000`)).data;
    const b = ra.bars?.SPY?.[0] ?? {};
    w("### Candele giornaliere `GET /v2/stocks/bars` (feed=sip)");
    w();
    w(`Chiavi della risposta: ${Object.keys(ra).map((k) => `\`${k}\``).join(", ")}. Campi di una candela: ${Object.keys(b).map((k) => `\`${k}\` (${typeOf(b[k])})`).join(", ")}.`);
    w();
    w(`- \`t\` di esempio: \`${b.t}\`: mezzanotte di New York espressa in UTC. Il bot la converte nella data della seduta.`);
    const lastA = ra.bars?.SPY?.at(-1), lastS = rs.bars?.SPY?.at(-1);
    w(`- Ultima candela SPY: \`${lastA?.t}\`. Chiusura con adjustment=all ${lastA?.c}, con adjustment=split ${lastS?.c}. Le chiusure passate differiscono per i dividendi: ${ra.bars?.SPY?.[0]?.c !== rs.bars?.SPY?.[0]?.c ? "sì" : "non in questo intervallo"}.`);
    const snap = (await D(`/stocks/snapshots?symbols=SPY,AAPL&feed=iex`)).data;
    const s0 = snap.SPY ?? snap.snapshots?.SPY ?? {};
    w();
    w("### Snapshot `GET /v2/stocks/snapshots` (feed=iex)");
    w();
    w(`Forma della risposta: ${snap.SPY ? "mappa simbolo → snapshot" : "oggetto con `snapshots`"}. Campi: ${Object.keys(s0).map((k) => `\`${k}\``).join(", ")}. \`latestTrade\`: ${Object.keys(s0.latestTrade ?? {}).map((k) => `\`${k}\``).join(", ")}.`);
    w();
    log("✓ market data");
  } catch (e) {
    w(`Errore su market data: ${errText(e)}`);
    w();
  }

  // ---------------- Finnhub ----------------
  w("## Finnhub (piano gratuito)");
  w();
  w(`Endpoint: \`${FINNHUB_URL}\`. Chiave nell'header \`X-Finnhub-Token\`.`);
  w();
  const fh = new FinnhubClient(secrets.finnhub.apiKey);
  const metrics: Record<string, any> = {};
  for (const s of SAMPLE_METRIC) {
    try {
      metrics[s] = await fh.getMetrics(s);
    } catch (e) {
      metrics[s] = { errore: errText(e) };
    }
  }
  log("✓ metriche Finnhub");
  w(`### \`/stock/metric?metric=all\` su ${SAMPLE_METRIC.length} titoli (${SAMPLE_METRIC.join(", ")})`);
  w();
  w("| Criterio | Campo usato | Presente in | Valori di esempio | Unità |");
  w("|---|---|---|---|---|");
  for (const [id, def] of Object.entries(CAMPI_FINNHUB) as [MetricId, (typeof CAMPI_FINNHUB)[MetricId]][]) {
    if (!def.campi.length) {
      w(`| ${id} | — | — | — | non disponibile: ${def.nota ?? ""} |`);
      continue;
    }
    for (const c of def.campi) {
      const vals = SAMPLE_METRIC.map((s) => [s, metrics[s]?.metric?.[c]] as const).filter(([, v]) => typeof v === "number");
      const ex = vals.slice(0, 4).map(([s, v]) => `${s} ${Number(v).toFixed(2)}`).join("; ");
      w(`| ${id} | \`${c}\` | ${vals.length}/${SAMPLE_METRIC.length} | ${ex || "—"} | ${def.unita} |`);
    }
  }
  w();
  const allKeys = new Map<string, number>();
  for (const s of SAMPLE_METRIC) for (const k of Object.keys(metrics[s]?.metric ?? {})) allKeys.set(k, (allKeys.get(k) ?? 0) + 1);
  w(`Tutti i campi visti in \`metric\` (${allKeys.size}), con il numero di titoli che li hanno:`);
  w();
  w([...allKeys].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `\`${k}\` ${n}`).join(" · "));
  w();
  const serieKeys = new Set<string>();
  for (const s of SAMPLE_METRIC) for (const k of Object.keys(metrics[s]?.series?.annual ?? {})) serieKeys.add(k);
  w(`Serie annuali (\`series.annual\`): ${[...serieKeys].sort().map((k) => `\`${k}\``).join(", ") || "nessuna"}.`);
  const pe = metrics.AAPL?.series?.annual?.pe;
  w(`Esempio \`series.annual.pe\` di AAPL: ${Array.isArray(pe) ? pe.slice(0, 6).map((x: any) => `${x.period}=${Number(x.v).toFixed(1)}`).join(", ") : "assente"}.`);
  w();

  // profili e industrie
  const industries = new Map<string, string[]>();
  const profileKeys = new Set<string>();
  let capProfile: string | null = null;
  for (const s of [...SAMPLE_METRIC, ...SAMPLE_INDUSTRY]) {
    try {
      const p = await fh.getProfile(s);
      if (!p) continue;
      for (const k of Object.keys(p)) profileKeys.add(k);
      if (s === "AAPL") capProfile = `profile2 ${Number(p.marketCapitalization).toFixed(0)} · metric ${Number(metrics.AAPL?.metric?.marketCapitalization).toFixed(0)}`;
      const ind = String(p.finnhubIndustry ?? "(vuoto)");
      industries.set(ind, [...(industries.get(ind) ?? []), s]);
    } catch (e) {
      log(`profilo ${s}: ${errText(e)}`);
    }
  }
  log("✓ profili Finnhub");
  w("### `/stock/profile2`");
  w();
  w(`Campi: ${[...profileKeys].sort().map((k) => `\`${k}\``).join(", ")}.`);
  w(`Capitalizzazione di AAPL (milioni di $): ${capProfile ?? "n/d"}.`);
  w();
  w(`### Valori di \`finnhubIndustry\` visti (${industries.size}) e settore assegnato`);
  w();
  w("| Industria | Settore | Esempi |");
  w("|---|---|---|");
  for (const [ind, syms] of [...industries].sort((a, b) => a[0].localeCompare(b[0]))) {
    w(`| ${ind} | ${INDUSTRIA_SETTORE[ind] ?? "**NON MAPPATA**"} | ${syms.slice(0, 6).join(", ")} |`);
  }
  w();
  try {
    const from = dateInTz(now, TZ_NY);
    const e = await fh.getEarnings("AAPL", addDays(from, -100), addDays(from, 30));
    w("### `/calendar/earnings`");
    w();
    w(`Risposta per AAPL (−100/+30 giorni): ${e === null ? "non disponibile" : `${e.length} righe; esempio ${JSON.stringify(e[0] ?? null)}`}.`);
    w();
  } catch (e) {
    w(`Errore su earnings: ${errText(e)}`);
    w();
  }
  w(`Richieste Finnhub fatte dalla sonda: ${fh.requests}.`);
  w();

  // ---------------- Claude ----------------
  w("## Cervello (`claude -p`)");
  w();
  const exe = findClaude();
  if (!exe) {
    w("**`claude` non trovato.**");
  } else {
    const f = await claudeFlags(exe, paths.cache);
    w(`Versione: \`${f.versione}\`. Percorso trovato: ${Bun.which("claude") ? "nel PATH" : "fuori dal PATH (~/.local/bin)"}.`);
    w();
    const wanted = ["--output-format", "--json-schema", "--tools", "--disallowedTools", "--strict-mcp-config", "--no-session-persistence", "--max-turns", "--max-budget-usd", "--model", "--setting-sources", "--safe-mode", "--system-prompt", "--bare"];
    w("| Flag | Presente |");
    w("|---|---|");
    for (const x of wanted) w(`| \`${x}\` | ${f.flags.includes(x) ? "sì" : "**no**"} |`);
    w();
    const schema = { type: "object", properties: { istruzioni: { type: "string" }, contesto: { type: "string" }, strumenti: { type: "array", items: { type: "string" } } }, required: ["istruzioni", "contesto", "strumenti"] };
    const sys = "Sei il modulo di prova del bot Indiano Trading. Rispondi in italiano, in modo conciso.";
    const argv = buildArgs(exe, f, { schema, systemPrompt: sys, model: null, maxBudgetUsd: 0.5 });
    w(`Comando usato (senza prompt, che passa da stdin): \`${argv.slice(1).map((a) => (a.length > 60 ? a.slice(0, 57) + "…" : a || '""')).join(" ")}\``);
    w();
    const prompt = "Elenca, in breve: (1) le istruzioni di sistema che ricevi; (2) il contesto aggiuntivo che vedi (file CLAUDE.md, memoria dell'utente, cartella di lavoro, impostazioni, skill); (3) gli strumenti disponibili. Non inventare: se una cosa non c'è, dillo.";
    log("… chiamata di prova al cervello");
    const r = await callClaude({ prompt, schema, systemPrompt: sys, model: null, maxBudgetUsd: 0.5, timeoutMs: 180_000, oauthToken: secrets.claude.oauthToken || null, cacheDir: paths.cache });
    appendUsage(paths, rigaDaRisultato(r, { runId: `probe-${dateInTz(now, TZ_NY)}`, task: "probe", promptByte: Buffer.byteLength(prompt), forzata: false }));
    w(`Esito: **${r.esito}**${r.errore ? ` (${redact(r.errore)})` : ""}. Durata ${(r.durataMs / 1000).toFixed(1)} s.`);
    w();
    w(`Consumi letti: costo stimato ${r.consumi.costoUsd ?? "non misurato"} $, token ${r.consumi.token ? JSON.stringify(r.consumi.token) : "non misurati"}, turni ${r.consumi.turni ?? "n/d"}, subtype \`${r.consumi.subtype ?? "n/d"}\`, modelli: ${Object.keys(r.consumi.perModello).map((m) => `\`${m}\``).join(", ") || "n/d"}.`);
    w();
    if (r.structured && typeof r.structured === "object") {
      const s = r.structured as any;
      w("Cosa dice di ricevere il cervello:");
      w();
      w(`- **Istruzioni:** ${redact(String(s.istruzioni)).replace(/\n/g, " ")}`);
      w(`- **Contesto:** ${redact(String(s.contesto)).replace(/\n/g, " ")}`);
      w(`- **Strumenti:** ${Array.isArray(s.strumenti) && s.strumenti.length ? s.strumenti.map((x: any) => redact(String(x))).join(", ") : "nessuno"}`);
      w();
    }
    log(`✓ cervello: ${r.esito}`);
  }

  const file = path.join(PROJECT_ROOT, "docs", "campi-dati.md");
  fs.writeFileSync(file, redact(out.join("\n")) + "\n");
  log(`Scritto ${path.relative(PROJECT_ROOT, file)}`);
}

main().catch((e) => {
  console.error(redact(`Sonda fallita: ${errText(e)}`));
  process.exit(1);
});
