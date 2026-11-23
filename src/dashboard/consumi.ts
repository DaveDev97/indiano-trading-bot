// Aggregazioni dei consumi AI (§8.7). Tutti i periodi in ora di Roma, da mezzanotte a mezzanotte.
// Le chiamate "non misurate" si contano ma non si sommano nei token né nei costi.
import type { RigaConsumo } from "../brain/usage.ts";
import { AI_TASKS, nomeTask } from "../config/ai-task.ts";
import { addDays, dateInTz, TZ_ROME, weekdayOf } from "../util/time.ts";

export interface Aggregato {
  chiamate: number;
  fallite: number;
  nonMisurate: number;
  input: number;
  output: number;
  cacheLettura: number;
  cacheScrittura: number;
  token: number;
  costo: number;
  durataMedia: number | null;
  quotaCache: number | null;
  costoMedio: number | null;
  pctErrori: number | null;
}

export const giornoRoma = (ts: string) => dateInTz(new Date(ts), TZ_ROME);

export function aggrega(rows: RigaConsumo[]): Aggregato {
  const a: Aggregato = { chiamate: 0, fallite: 0, nonMisurate: 0, input: 0, output: 0, cacheLettura: 0, cacheScrittura: 0, token: 0, costo: 0, durataMedia: null, quotaCache: null, costoMedio: null, pctErrori: null };
  let dur = 0, misurateCosto = 0;
  for (const r of rows) {
    a.chiamate++;
    if (r.esito !== "ok") a.fallite++;
    dur += r.durataMs;
    if (r.token === null) a.nonMisurate++;
    else {
      a.input += r.token.input;
      a.output += r.token.output;
      a.cacheLettura += r.token.cacheLettura;
      a.cacheScrittura += r.token.cacheScrittura;
    }
    if (r.costoUsd !== null) {
      a.costo += r.costoUsd;
      misurateCosto++;
    }
  }
  a.token = a.input + a.output + a.cacheLettura + a.cacheScrittura;
  a.durataMedia = a.chiamate ? dur / a.chiamate : null;
  const inTot = a.input + a.cacheLettura + a.cacheScrittura;
  a.quotaCache = inTot ? a.cacheLettura / inTot : null;
  a.costoMedio = misurateCosto ? a.costo / misurateCosto : null;
  a.pctErrori = a.chiamate ? a.fallite / a.chiamate : null;
  return a;
}

export type PeriodoId = "oggi" | "7g" | "30g" | "mese" | "mese-prec" | "tutto" | "intervallo" | "settimana";
export const PERIODI: { id: PeriodoId; nome: string }[] = [
  { id: "oggi", nome: "Oggi" },
  { id: "7g", nome: "Ultimi 7 giorni" },
  { id: "30g", nome: "Ultimi 30 giorni" },
  { id: "mese", nome: "Mese corrente" },
  { id: "mese-prec", nome: "Mese precedente" },
  { id: "tutto", nome: "Dall'inizio" },
  { id: "intervallo", nome: "Intervallo di date" },
];

/** Estremi (date di Roma, inclusi) di un periodo. */
export function estremi(id: PeriodoId, now: Date, da?: string, a?: string): { da: string; a: string } {
  const oggi = dateInTz(now, TZ_ROME);
  switch (id) {
    case "oggi":
      return { da: oggi, a: oggi };
    case "settimana": {
      const wd = (weekdayOf(oggi) + 6) % 7; // lunedì = 0
      return { da: addDays(oggi, -wd), a: oggi };
    }
    case "7g":
      return { da: addDays(oggi, -6), a: oggi };
    case "30g":
      return { da: addDays(oggi, -29), a: oggi };
    case "mese":
      return { da: oggi.slice(0, 8) + "01", a: oggi };
    case "mese-prec": {
      const primo = oggi.slice(0, 8) + "01";
      const fine = addDays(primo, -1);
      return { da: fine.slice(0, 8) + "01", a: fine };
    }
    case "intervallo":
      return { da: da && /^\d{4}-\d{2}-\d{2}$/.test(da) ? da : "2000-01-01", a: a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : oggi };
    default:
      return { da: "2000-01-01", a: oggi };
  }
}

export function filtra(rows: RigaConsumo[], f: { da: string; a: string; task?: string; esito?: string }): RigaConsumo[] {
  return rows.filter((r) => {
    const g = giornoRoma(r.ts);
    return g >= f.da && g <= f.a && (!f.task || r.task === f.task) && (!f.esito || r.esito === f.esito);
  });
}

export interface RigaSpaccato {
  chiave: string;
  nome: string;
  agg: Aggregato;
}

/** Spaccato per tipologia di task: righe per ogni tipologia nota + eventuali sconosciute; totale = somma. */
export function spaccatoTask(rows: RigaConsumo[]): { righe: RigaSpaccato[]; totale: Aggregato } {
  const ids = [...AI_TASKS.map((t) => t.id as string), ...new Set(rows.map((r) => r.task).filter((t) => !AI_TASKS.some((x) => x.id === t)))];
  const righe = ids.map((id) => ({ chiave: id, nome: nomeTask(id), agg: aggrega(rows.filter((r) => r.task === id)) }));
  return { righe, totale: aggrega(rows) };
}

/** Spaccato per modello, dal dettaglio per modello del risultato. */
export function spaccatoModello(rows: RigaConsumo[]): { righe: { modello: string; chiamate: number; token: number; costo: number; costoMedio: number | null }[]; nonAttribuite: number } {
  const m = new Map<string, { chiamate: number; token: number; costo: number }>();
  let nonAttribuite = 0;
  for (const r of rows) {
    const mods = Object.entries(r.perModello ?? {});
    if (!mods.length) {
      nonAttribuite++;
      continue;
    }
    for (const [k, u] of mods) {
      const x = m.get(k) ?? { chiamate: 0, token: 0, costo: 0 };
      x.chiamate++;
      x.token += u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
      x.costo += u.costUSD;
      m.set(k, x);
    }
  }
  return { righe: [...m].map(([modello, x]) => ({ modello, ...x, costoMedio: x.chiamate ? x.costo / x.chiamate : null })).sort((a, b) => b.costo - a.costo), nonAttribuite };
}

export type Grana = "giorno" | "settimana" | "mese";
export function secchio(giorno: string, g: Grana): string {
  if (g === "mese") return giorno.slice(0, 7);
  if (g === "settimana") return addDays(giorno, -((weekdayOf(giorno) + 6) % 7));
  return giorno;
}

export function csvSpaccato(rows: RigaConsumo[], periodo: string): string {
  const { righe, totale } = spaccatoTask(rows);
  const head = ["periodo", "tipologia", "chiamate", "fallite", "non_misurate", "token", "costo_stimato_usd", "costo_medio_usd", "durata_media_s", "percentuale_errori"];
  const fmt = (n: string, a: Aggregato) => [periodo, n, a.chiamate, a.fallite, a.nonMisurate, a.token, a.costo.toFixed(4), a.costoMedio?.toFixed(4) ?? "", a.durataMedia ? (a.durataMedia / 1000).toFixed(1) : "", a.pctErrori !== null ? (a.pctErrori * 100).toFixed(1) : ""];
  const lines = [head, ...righe.map((r) => fmt(r.nome, r.agg)), fmt("TOTALE", totale)];
  return lines.map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\r\n") + "\r\n";
}
