// Mappa criterio → campi di Finnhub /stock/metric?metric=all.
// STATO: VERIFICATA con `bun run probe` il 23/11/2026 su 20 titoli (vedi docs/campi-dati.md): tutti i campi elencati esistono.
// Unità verificate: percentuali come numeri (15 = 15%), capitalizzazione in milioni di $, rapporti come numeri puri.
// quickRatio ed epsGrowth5Y mancano per alcune banche (18/20): per i finanziari il quick ratio non si applica.
// Per ogni criterio si prova il primo campo presente nell'elenco. Un elenco vuoto = sempre "non disponibile".

export type MetricId =
  | "epsAnnuo"
  | "ricaviTrim"
  | "epsTrim"
  | "roe"
  | "roa"
  | "debito"
  | "quick"
  | "pe"
  | "margine"
  | "ricavi5a"
  | "eps5a"
  | "epsProssimo"
  | "epsProssimi5"
  | "pfcf"
  | "peg"
  | "cap"
  | "yield"
  | "payout";

export interface CampoDef {
  campi: string[];
  /** Unità in cui Finnhub restituisce il valore (verificata dalla sonda). */
  unita: "%" | "rapporto" | "mln $";
  nota?: string;
}

export const CAMPI_FINNHUB: Record<MetricId, CampoDef> = {
  epsAnnuo: { campi: ["epsGrowthTTMYoy"], unita: "%" },
  ricaviTrim: { campi: ["revenueGrowthQuarterlyYoy"], unita: "%" },
  epsTrim: { campi: ["epsGrowthQuarterlyYoy"], unita: "%" },
  roe: { campi: ["roeTTM", "roeRfy"], unita: "%" },
  roa: { campi: ["roaTTM", "roaRfy"], unita: "%" },
  debito: { campi: ["totalDebt/totalEquityQuarterly", "totalDebt/totalEquityAnnual"], unita: "rapporto" },
  quick: { campi: ["quickRatioQuarterly", "quickRatioAnnual"], unita: "rapporto" },
  pe: { campi: ["peTTM", "peExclExtraTTM", "peBasicExclExtraTTM"], unita: "rapporto" },
  margine: { campi: ["netProfitMarginTTM", "netProfitMarginAnnual"], unita: "%" },
  ricavi5a: { campi: ["revenueGrowth5Y"], unita: "%" },
  eps5a: { campi: ["epsGrowth5Y"], unita: "%" },
  epsProssimo: { campi: [], unita: "%", nota: "stima degli analisti: a pagamento su Finnhub" },
  epsProssimi5: { campi: [], unita: "%", nota: "stima degli analisti: a pagamento su Finnhub" },
  pfcf: { campi: ["pfcfShareTTM", "pfcfShareAnnual"], unita: "rapporto" },
  peg: { campi: ["pegTTM"], unita: "rapporto", nota: "se manca: P/E ÷ crescita EPS 5 anni (PEG storico)" },
  cap: { campi: ["marketCapitalization"], unita: "mln $" },
  yield: { campi: ["currentDividendYieldTTM", "dividendYieldIndicatedAnnual"], unita: "%" },
  payout: { campi: ["payoutRatioTTM", "payoutRatioAnnual"], unita: "%" },
};

/** Serie storica annuale del P/E (per la media a 5 anni). */
export const SERIE_PE = { gruppo: "annual" as const, campi: ["pe"] };

export function leggiCampo(metric: Record<string, unknown>, id: MetricId): { valore: number | null; campo: string | null } {
  for (const c of CAMPI_FINNHUB[id].campi) {
    const v = metric[c];
    if (typeof v === "number" && Number.isFinite(v)) return { valore: v, campo: c };
  }
  return { valore: null, campo: null };
}
