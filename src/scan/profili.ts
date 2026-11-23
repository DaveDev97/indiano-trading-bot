// Profili fondamentali (§4.3): criteri, applicabilità per settore, regola del 70%, zona grigia.
import { CAMPI_FINNHUB, leggiCampo, SERIE_PE, type MetricId } from "../config/campi-finnhub.ts";
import { PARAM_BY_KEY } from "../config/parametri.ts";
import type { Settore } from "../config/settori.ts";
import type { FinnhubMetric } from "../data/types.ts";
import type { Params } from "../params/params.ts";

export type Profilo = "growth" | "value" | "dividendo";
export const PROFILI: Profilo[] = ["growth", "value", "dividendo"];
export const NOME_PROFILO: Record<Profilo, string> = { growth: "Growth", value: "Value / qualità a prezzo ragionevole", dividendo: "Dividendo solido" };

export type Direzione = "alto" | "basso" | "centro";
export type Esito = "superato" | "non superato" | "non disponibile" | "non applicabile";

export interface CriterioDef {
  id: string;
  profilo: Profilo;
  nome: string;
  metrica: MetricId | "peBanda";
  tipo: ">" | "<" | "tra" | "banda";
  param: string;
  paramMax?: string;
  direzione: Direzione;
  nonApplicabile?: Settore[];
  nonDisponibileIn?: Settore[];
  unita: string;
}

const C = (d: CriterioDef) => d;
export const CRITERI: CriterioDef[] = [
  C({ id: "growth.epsAnnuo", profilo: "growth", nome: "EPS anno su anno", metrica: "epsAnnuo", tipo: ">", param: "fond.growth.epsAnnuo.min", direzione: "alto", unita: "%" }),
  C({ id: "growth.ricaviTrim", profilo: "growth", nome: "Ricavi trimestre vs anno prima", metrica: "ricaviTrim", tipo: ">", param: "fond.growth.ricaviTrim.min", direzione: "alto", unita: "%" }),
  C({ id: "growth.epsTrim", profilo: "growth", nome: "EPS trimestre vs anno prima", metrica: "epsTrim", tipo: ">", param: "fond.growth.epsTrim.min", direzione: "alto", unita: "%" }),
  C({ id: "growth.roe", profilo: "growth", nome: "ROE", metrica: "roe", tipo: ">", param: "fond.growth.roe.min", direzione: "alto", unita: "%" }),
  C({ id: "growth.roa", profilo: "growth", nome: "ROA", metrica: "roa", tipo: ">", param: "fond.growth.roa.min", direzione: "alto", unita: "%" }),
  C({ id: "growth.debito", profilo: "growth", nome: "Debito/patrimonio", metrica: "debito", tipo: "<", param: "fond.growth.debito.max", direzione: "basso", nonApplicabile: ["Financial", "Real Estate", "Utilities"], unita: "" }),
  C({ id: "growth.quick", profilo: "growth", nome: "Quick ratio", metrica: "quick", tipo: ">", param: "fond.growth.quick.min", direzione: "alto", nonApplicabile: ["Financial"], unita: "" }),
  C({ id: "growth.peBanda", profilo: "growth", nome: "P/E rispetto alla media a 5 anni", metrica: "peBanda", tipo: "banda", param: "fond.growth.peBanda", direzione: "basso", unita: "dev. std" }),
  C({ id: "value.roe", profilo: "value", nome: "ROE", metrica: "roe", tipo: ">", param: "fond.value.roe.min", direzione: "alto", unita: "%" }),
  C({ id: "value.margine", profilo: "value", nome: "Margine netto", metrica: "margine", tipo: ">", param: "fond.value.margine.min", direzione: "alto", unita: "%" }),
  C({ id: "value.ricavi5a", profilo: "value", nome: "Crescita ricavi 5 anni", metrica: "ricavi5a", tipo: ">", param: "fond.value.ricavi5a.min", direzione: "alto", unita: "%" }),
  C({ id: "value.eps5a", profilo: "value", nome: "Crescita EPS 5 anni", metrica: "eps5a", tipo: ">", param: "fond.value.eps5a.min", direzione: "alto", unita: "%" }),
  C({ id: "value.epsProssimo", profilo: "value", nome: "Crescita EPS prossimo anno (stima)", metrica: "epsProssimo", tipo: ">", param: "fond.value.epsProssimo.min", direzione: "alto", unita: "%" }),
  C({ id: "value.epsProssimi5", profilo: "value", nome: "Crescita EPS prossimi 5 anni (stima)", metrica: "epsProssimi5", tipo: ">", param: "fond.value.epsProssimi5.min", direzione: "alto", unita: "%" }),
  C({ id: "value.pfcf", profilo: "value", nome: "Prezzo / free cash flow", metrica: "pfcf", tipo: "<", param: "fond.value.pfcf.max", direzione: "basso", unita: "" }),
  C({ id: "value.pe", profilo: "value", nome: "P/E", metrica: "pe", tipo: "<", param: "fond.value.pe.max", direzione: "basso", unita: "" }),
  C({ id: "value.peg", profilo: "value", nome: "PEG", metrica: "peg", tipo: "<", param: "fond.value.peg.max", direzione: "basso", unita: "" }),
  C({ id: "value.quick", profilo: "value", nome: "Quick ratio", metrica: "quick", tipo: ">", param: "fond.value.quick.min", direzione: "alto", nonApplicabile: ["Financial"], unita: "" }),
  C({ id: "div.cap", profilo: "dividendo", nome: "Capitalizzazione (mln $)", metrica: "cap", tipo: ">", param: "fond.div.cap.min", direzione: "alto", unita: "mln $" }),
  C({ id: "div.yield", profilo: "dividendo", nome: "Dividend yield", metrica: "yield", tipo: ">", param: "fond.div.yield.min", direzione: "alto", unita: "%" }),
  C({ id: "div.payout", profilo: "dividendo", nome: "Payout ratio", metrica: "payout", tipo: "tra", param: "fond.div.payout.min", paramMax: "fond.div.payout.max", direzione: "centro", nonDisponibileIn: ["Real Estate"], unita: "%" }),
  C({ id: "div.quick", profilo: "dividendo", nome: "Quick ratio", metrica: "quick", tipo: ">", param: "fond.div.quick.min", direzione: "alto", nonApplicabile: ["Financial", "Real Estate"], unita: "" }),
  C({ id: "div.roe", profilo: "dividendo", nome: "ROE", metrica: "roe", tipo: ">", param: "fond.div.roe.min", direzione: "alto", unita: "%" }),
  C({ id: "div.margine", profilo: "dividendo", nome: "Margine netto", metrica: "margine", tipo: ">", param: "fond.div.margine.min", direzione: "alto", unita: "%" }),
];

export interface ValutazioneCriterio {
  id: string;
  nome: string;
  valore: number | null;
  /** Valore usato nella classifica (es. |z| per la banda del P/E). */
  valoreClassifica: number | null;
  soglia: string;
  esito: Esito;
  campo: string | null;
  nota?: string;
  /** Per la zona grigia: distanza dalla soglia in passi (≤ 1 = entro un passo). null = non calcolabile. */
  passiDallaSoglia: number | null;
}

export interface ValutazioneProfilo {
  profilo: Profilo;
  criteri: ValutazioneCriterio[];
  applicabili: number;
  valutabili: number;
  minimiValutabili: number;
  coperturaOk: boolean;
  superato: boolean;
  /** Ha mancato un solo criterio, entro un passo dalla soglia (zona grigia). */
  zonaGrigia: boolean;
}

/** Valori grezzi del titolo: metriche Finnhub e serie del P/E. */
export interface DatiFondamentali {
  metric: Record<string, unknown>;
  peSerie: number[];
}

export function datiDa(m: FinnhubMetric | null): DatiFondamentali {
  const metric = (m?.metric ?? {}) as Record<string, unknown>;
  const raw = (m?.series?.[SERIE_PE.gruppo] ?? {}) as Record<string, { period: string; v: number }[]>;
  let serie: { period: string; v: number }[] = [];
  for (const c of SERIE_PE.campi) if (Array.isArray(raw[c]) && raw[c]!.length) { serie = raw[c]!; break; }
  const peSerie = [...serie].filter((x) => typeof x?.v === "number" && Number.isFinite(x.v)).sort((a, b) => (a.period < b.period ? 1 : -1)).slice(0, 5).map((x) => x.v);
  return { metric, peSerie };
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
const passo = (k: string) => PARAM_BY_KEY.get(k)?.passo ?? 1;

export function valutaCriterio(c: CriterioDef, d: DatiFondamentali, settore: Settore, P: Params): ValutazioneCriterio {
  const base = { id: c.id, nome: c.nome } as const;
  const x = P.n(c.param);
  const xMax = c.paramMax ? P.n(c.paramMax) : null;
  const soglia = c.tipo === ">" ? `> ${fmt(x)}` : c.tipo === "<" ? `< ${fmt(x)}` : c.tipo === "tra" ? `tra ${fmt(x)} e ${fmt(xMax!)}` : `entro ±${fmt(x)} dev. std`;
  if (c.nonApplicabile?.includes(settore)) return { ...base, valore: null, valoreClassifica: null, soglia, esito: "non applicabile", campo: null, passiDallaSoglia: null };
  if (c.nonDisponibileIn?.includes(settore)) return { ...base, valore: null, valoreClassifica: null, soglia, esito: "non disponibile", campo: null, nota: "per i REIT si valuta sull'FFO, non disponibile", passiDallaSoglia: null };

  if (c.metrica === "peBanda") {
    const pe = leggiCampo(d.metric, "pe");
    const eps = leggiCampo(d.metric, "epsAnnuo");
    if (pe.valore !== null && pe.valore <= 0) return { ...base, valore: pe.valore, valoreClassifica: null, soglia, esito: "non superato", campo: pe.campo, nota: "utili negativi", passiDallaSoglia: null };
    if (pe.valore === null) return { ...base, valore: null, valoreClassifica: null, soglia, esito: "non disponibile", campo: null, nota: eps.valore !== null && eps.valore < 0 ? "P/E assente" : undefined, passiDallaSoglia: null };
    const s = d.peSerie.filter((v) => v > 0);
    if (s.length < 3) return { ...base, valore: pe.valore, valoreClassifica: null, soglia, esito: "non disponibile", campo: pe.campo, nota: "serie storica del P/E insufficiente", passiDallaSoglia: null };
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length - 1));
    const z = std > 0 ? Math.abs(pe.valore - mean) / std : pe.valore === mean ? 0 : Infinity;
    const ok = z <= x;
    return { ...base, valore: pe.valore, valoreClassifica: z, soglia, esito: ok ? "superato" : "non superato", campo: pe.campo, nota: `media 5 anni ${fmt(mean)}, dev. std ${fmt(std)}, distanza ${Number.isFinite(z) ? z.toFixed(2) : "∞"} dev. std`, passiDallaSoglia: ok ? 0 : Number.isFinite(z) ? (z - x) / passo(c.param) : null };
  }

  let { valore, campo } = leggiCampo(d.metric, c.metrica);
  let nota: string | undefined;
  if (c.metrica === "peg" && valore === null) {
    const pe = leggiCampo(d.metric, "pe").valore;
    const g = leggiCampo(d.metric, "eps5a").valore;
    if (pe !== null && g !== null) {
      if (pe <= 0 || g <= 0) return { ...base, valore: null, valoreClassifica: null, soglia, esito: "non superato", campo: "peTTM/epsGrowth5Y", nota: "PEG storico non significativo: utili o crescita negativi", passiDallaSoglia: null };
      valore = pe / g;
      campo = "P/E ÷ crescita EPS 5 anni";
      nota = "PEG storico";
    }
  }
  if (valore === null) {
    const n = CAMPI_FINNHUB[c.metrica].nota;
    return { ...base, valore: null, valoreClassifica: null, soglia, esito: "non disponibile", campo: null, nota: CAMPI_FINNHUB[c.metrica].campi.length === 0 ? n : undefined, passiDallaSoglia: null };
  }
  if ((c.metrica === "pe" || c.metrica === "pfcf") && valore <= 0)
    return { ...base, valore, valoreClassifica: null, soglia, esito: "non superato", campo, nota: c.metrica === "pe" ? "utili negativi" : "free cash flow negativo", passiDallaSoglia: null };

  let ok: boolean;
  let passi: number;
  if (c.tipo === ">") {
    ok = valore > x;
    passi = ok ? 0 : (x - valore) / passo(c.param);
  } else if (c.tipo === "<") {
    ok = valore < x;
    passi = ok ? 0 : (valore - x) / passo(c.param);
  } else {
    ok = valore >= x && valore <= xMax!;
    passi = ok ? 0 : valore < x ? (x - valore) / passo(c.param) : (valore - xMax!) / passo(c.paramMax!);
  }
  const center = c.tipo === "tra" ? (x + xMax!) / 2 : null;
  return { ...base, valore, valoreClassifica: center !== null ? Math.abs(valore - center) : valore, soglia, esito: ok ? "superato" : "non superato", campo, nota, passiDallaSoglia: passi };
}

export function valutaProfilo(profilo: Profilo, d: DatiFondamentali, settore: Settore, P: Params): ValutazioneProfilo {
  const criteri = CRITERI.filter((c) => c.profilo === profilo).map((c) => valutaCriterio(c, d, settore, P));
  const applicabili = criteri.filter((c) => c.esito !== "non applicabile").length;
  const valutabili = criteri.filter((c) => c.esito === "superato" || c.esito === "non superato").length;
  const minimiValutabili = Math.ceil(P.n("fond.copertura") * applicabili - 1e-9);
  const coperturaOk = applicabili > 0 && valutabili >= minimiValutabili;
  const falliti = criteri.filter((c) => c.esito === "non superato");
  const superato = coperturaOk && falliti.length === 0;
  const zonaGrigia = coperturaOk && falliti.length === 1 && falliti[0]!.passiDallaSoglia !== null && falliti[0]!.passiDallaSoglia <= 1 + 1e-9;
  return { profilo, criteri, applicabili, valutabili, minimiValutabili, coperturaOk, superato, zonaGrigia };
}
