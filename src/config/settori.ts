// Settori, ETF di riferimento (§4.2) e mappa industria Finnhub → settore.
// La mappa è costruita sui valori di `finnhubIndustry` visti dalla sonda (docs/campi-dati.md).
// Le industrie ambigue sono decise in docs/decisioni.md. Un'industria non mappata esclude il titolo.

export type Settore =
  | "Financial"
  | "Technology"
  | "Healthcare"
  | "Utilities"
  | "Real Estate"
  | "Communication Services"
  | "Basic Materials"
  | "Energy"
  | "Industrials"
  | "Consumer Cyclical"
  | "Consumer Defensive";

export const ETF_SETTORE: Record<Settore, string> = {
  Financial: "XLF",
  Technology: "XLK",
  Healthcare: "XLV",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  "Communication Services": "XLC",
  "Basic Materials": "XLB",
  Energy: "XLE",
  Industrials: "XLI",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
};

export const SETTORI = Object.keys(ETF_SETTORE) as Settore[];
export const BENCHMARK = "SPY";

export const NOME_SETTORE: Record<Settore, string> = {
  Financial: "Finanziario",
  Technology: "Tecnologia",
  Healthcare: "Sanità",
  Utilities: "Utility",
  "Real Estate": "Immobiliare",
  "Communication Services": "Comunicazione",
  "Basic Materials": "Materiali di base",
  Energy: "Energia",
  Industrials: "Industriali",
  "Consumer Cyclical": "Consumi ciclici",
  "Consumer Defensive": "Consumi difensivi",
};

export const INDUSTRIA_SETTORE: Record<string, Settore> = {
  Banking: "Financial",
  "Financial Services": "Financial",
  Insurance: "Financial",
  Technology: "Technology",
  Semiconductors: "Technology",
  Communications: "Technology", // apparati di comunicazione (es. Cisco): Information Technology nel GICS
  Biotechnology: "Healthcare",
  Pharmaceuticals: "Healthcare",
  "Health Care": "Healthcare",
  "Life Sciences Tools & Services": "Healthcare",
  Utilities: "Utilities",
  "Real Estate": "Real Estate",
  Media: "Communication Services",
  Telecommunication: "Communication Services",
  Chemicals: "Basic Materials",
  "Metals & Mining": "Basic Materials",
  "Paper & Forest": "Basic Materials",
  Packaging: "Basic Materials",
  Energy: "Energy",
  "Aerospace & Defense": "Industrials",
  Airlines: "Industrials",
  Building: "Industrials",
  "Commercial Services & Supplies": "Industrials",
  Construction: "Industrials",
  "Electrical Equipment": "Industrials",
  "Industrial Conglomerates": "Industrials",
  "Logistics & Transportation": "Industrials",
  Machinery: "Industrials",
  Marine: "Industrials",
  "Professional Services": "Industrials",
  "Road & Rail": "Industrials",
  "Trading Companies & Distributors": "Industrials",
  "Transportation Infrastructure": "Industrials",
  "Auto Components": "Consumer Cyclical",
  Automobiles: "Consumer Cyclical",
  "Diversified Consumer Services": "Consumer Cyclical",
  "Hotels, Restaurants & Leisure": "Consumer Cyclical",
  "Leisure Products": "Consumer Cyclical",
  "Textiles, Apparel & Luxury Goods": "Consumer Cyclical",
  Distributors: "Consumer Cyclical",
  Retail: "Consumer Cyclical", // ambigua: vedi RETAIL_DIFENSIVI e docs/decisioni.md
  Beverages: "Consumer Defensive",
  "Food Products": "Consumer Defensive",
  Tobacco: "Consumer Defensive",
  "Consumer products": "Consumer Defensive",
};

/** "Retail" è ambigua: questi distributori di beni di prima necessità vanno nei difensivi. */
export const RETAIL_DIFENSIVI = new Set(["WMT", "COST", "KR", "DG", "DLTR", "BJ", "ACI", "SFM", "WBA", "CVS", "GO", "PSMT", "CASY", "OLLI"]);

export function settoreDi(symbol: string, industria: string | undefined | null): Settore | null {
  if (!industria) return null;
  const s = INDUSTRIA_SETTORE[industria.trim()];
  if (!s) return null;
  if (s === "Consumer Cyclical" && industria.trim() === "Retail" && RETAIL_DIFENSIVI.has(symbol)) return "Consumer Defensive";
  return s;
}
