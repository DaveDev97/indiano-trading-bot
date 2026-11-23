// Segnali della seduta (§4.5): calcolati una volta, alla prima sveglia del giorno, su candele chiuse.
// Salvati in state/segnali/<seduta>.json; tutte le sveglie della seduta usano gli stessi.
import * as path from "node:path";
import type { Ctx } from "../run/context.ts";
import type { Params } from "../params/params.ts";
import type { CalendarDay } from "../broker/types.ts";
import { BENCHMARK } from "../config/settori.ts";
import { closedBars, compactBars, type CompactBar } from "../data/bars.ts";
import type { Bar } from "../data/types.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { addDays } from "../util/time.ts";
import { errText } from "../util/redact.ts";
import { calcolaSegnali, parametriSegnali, type SegnaleTitolo } from "./rules.ts";

export interface SegnaliSeduta {
  seduta: string;
  calcolatiIl: string;
  runId: string;
  paramsVersione: string;
  ultimaCandela: string | null;
  titoli: Record<string, SegnaleTitolo>;
  mancanti: string[];
  errore?: string;
}

export interface CandeleSeduta {
  all: Record<string, CompactBar[]>;
  split: Record<string, CompactBar[]>;
}

export function fileSegnali(ctx: Ctx, seduta: string) {
  return { segnali: path.join(ctx.paths.segnali, `${seduta}.json`), candele: path.join(ctx.paths.segnali, `${seduta}-candele.json`) };
}

export function leggiSegnali(ctx: Ctx, seduta: string): SegnaliSeduta | null {
  const r = readJsonSafe<SegnaliSeduta>(fileSegnali(ctx, seduta).segnali, (v) => v && v.seduta === seduta && v.titoli);
  return r.ok ? r.value : null;
}

export function leggiCandele(ctx: Ctx, seduta: string): CandeleSeduta {
  const r = readJsonSafe<CandeleSeduta>(fileSegnali(ctx, seduta).candele);
  return r.ok ? r.value : { all: {}, split: {} };
}

/** Restituisce i segnali della seduta: letti se già calcolati, altrimenti calcolati ora e salvati. */
export async function segnaliDellaSeduta(ctx: Ctx, P: Params, seduta: string, simboli: string[], runId: string, cal: CalendarDay[]): Promise<{ segnali: SegnaliSeduta; calcolati: boolean }> {
  // segnali calcolati con un'altra versione dei parametri (es. soglie cambiate a metà giornata): si ricalcolano tutti,
  // sulle stesse candele chiuse, altrimenti la sveglia userebbe soglie che non sono più quelle attive
  const letti = leggiSegnali(ctx, seduta);
  const gia = letti && letti.paramsVersione === P.versione ? letti : null;
  if (letti && !gia) ctx.log.info("segnali ricalcolati: parametri cambiati", { da: letti.paramsVersione, a: P.versione });
  const mancanti = gia ? simboli.filter((s) => !gia.titoli[s] && !gia.mancanti.includes(s)) : simboli;
  if (gia && mancanti.length === 0) return { segnali: gia, calcolati: false };
  // prima sveglia della seduta, oppure titoli nuovi (es. una posizione aperta a mano): si calcolano solo quelli
  const daFare = gia ? mancanti : simboli;
  const now = ctx.now();
  const start = addDays(seduta, -540);
  const ps = parametriSegnali(P);
  const out: SegnaliSeduta = gia ?? { seduta, calcolatiIl: now.toISOString(), runId, paramsVersione: P.versione, ultimaCandela: null, titoli: {}, mancanti: [] };
  const cand = gia ? leggiCandele(ctx, seduta) : { all: {}, split: {} };
  try {
    const syms = [...new Set([BENCHMARK, ...daFare])];
    const [rawAll, rawSplit] = await Promise.all([
      ctx.data.getDailyBars(syms, { start, end: now, adjustment: "all" }),
      ctx.data.getDailyBars(daFare, { start, end: now, adjustment: "split" }),
    ]);
    const closed = (b: Bar[] | undefined) => closedBars(b ?? [], now, cal).filter((x) => x.t < seduta);
    const spy = closed(rawAll[BENCHMARK]);
    out.ultimaCandela = spy.at(-1)?.t ?? out.ultimaCandela;
    for (const s of daFare) {
      const b = closed(rawAll[s]);
      if (b.length < 30) {
        out.mancanti.push(s);
        continue;
      }
      out.titoli[s] = calcolaSegnali(s, b, spy, ps);
      cand.all[s] = compactBars(b.slice(-300));
      cand.split[s] = compactBars(closed(rawSplit[s]).slice(-300));
    }
  } catch (e) {
    out.errore = `candele non disponibili: ${errText(e)}`;
    ctx.log.error("segnali non calcolati", { errore: out.errore });
    return { segnali: out, calcolati: false };
  }
  const f = fileSegnali(ctx, seduta);
  writeJsonAtomic(f.candele, cand);
  writeJsonAtomic(f.segnali, out);
  return { segnali: out, calcolati: true };
}
