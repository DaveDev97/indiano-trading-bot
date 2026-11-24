// Vincoli non negoziabili (Contratto §3). Non sono parametri: non compaiono nelle impostazioni.
import * as path from "node:path";

/** Unico endpoint di trading ammesso. */
export const PAPER_TRADING_URL = "https://paper-api.alpaca.markets";
export const ALPACA_DATA_URL = "https://data.alpaca.markets";
export const FINNHUB_URL = "https://finnhub.io/api/v1";
export const TELEGRAM_URL = "https://api.telegram.org";

/** Tetto massimo di posizioni: il parametro può scendere, mai salire oltre. */
export const MAX_POSIZIONI_ASSOLUTO = 5;

/** Borse ammesse per l'universo. */
export const BORSE_AMMESSE = ["NYSE", "NASDAQ"];

/** Borse ammesse per ogni scelta del parametro universo.borse (codici Alpaca). Alpaca negozia solo titoli quotati in USA. */
export const BORSE_PER_SCELTA: Record<string, string[]> = {
  "NYSE e NASDAQ": ["NYSE", "NASDAQ"],
  "NYSE, NASDAQ e NYSE American": ["NYSE", "NASDAQ", "AMEX"],
  "solo NYSE": ["NYSE"],
  "solo NASDAQ": ["NASDAQ"],
};
export const NOME_BORSA: Record<string, string> = { NYSE: "NYSE", NASDAQ: "NASDAQ", AMEX: "NYSE American", ARCA: "NYSE Arca", BATS: "Cboe BZX", OTC: "OTC" };

/** Sede della società (campo country del profilo Finnhub). */
export const SEDI = ["tutte", "solo USA", "solo estere"] as const;
export function sedeAmmessa(scelta: string, country: string | undefined | null): boolean {
  if (scelta === "tutte") return true;
  if (!country) return false; // sede non disponibile: con un filtro attivo si esclude, per prudenza
  return scelta === "solo USA" ? country === "US" : country !== "US";
}

/** Indirizzo della dashboard: solo il computer stesso. */
export const DASHBOARD_HOST = "127.0.0.1";

/** Cartella vuota fuori dal progetto per il cervello (CLAUDE.md delle cartelle superiori non deve caricarsi). */
export function brainCwd(): string {
  // fuori dal progetto: Claude Code legge i CLAUDE.md della cartella di lavoro e di tutte quelle superiori
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "C:\\", "AppData", "Local");
    return path.join(base, "IndianoTrading", "brain-cwd");
  }
  const home = process.env.HOME ?? "/tmp";
  const base = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(base, "IndianoTrading", "brain-cwd");
}

/** Variabili d'ambiente che, se presenti, potrebbero puntare a un endpoint di trading. */
export const ENV_TRADING_URL_VARS = [
  "APCA_API_BASE_URL",
  "ALPACA_BASE_URL",
  "ALPACA_API_BASE_URL",
  "ALPACA_TRADING_URL",
  "APCA_TRADING_URL",
];
