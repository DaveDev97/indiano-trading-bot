// Schede delle operazioni (§7.1): si completano nel tempo con eventi solo in aggiunta e si ricostruiscono dal diario.
import type { Paths } from "../config/paths.ts";
import type { Settore } from "../config/settori.ts";
import type { CompactBar } from "../data/bars.ts";
import type { SegnaleTitolo } from "../signals/rules.ts";
import type { ValutazioneCriterio } from "../scan/profili.ts";
import type { PianoUscita } from "../run/piani.ts";
import type { RisultatoSim } from "./simulatore.ts";
import { readJournal, readShadowJournal, type EventoDiario } from "./journal.ts";

export type CategoriaOmbra = "non comprata" | "quasi" | "zona grigia" | "settore debole";

export interface IngressoScheda {
  tradeId: string;
  simbolo: string;
  nome?: string;
  runId: string;
  /** Data della candela del segnale (ultima chiusa prima dell'ingresso). */
  dataSegnale: string;
  /** Seduta di ingresso (reale: seduta dell'acquisto; ombra: seduta dopo il segnale). */
  seduta: string;
  profilo: string | null;
  settore: Settore | null;
  forzaSettore: { periodo: number; rendimenti: Record<string, number | null>; spy: Record<string, number | null>; forte: boolean } | null;
  criteri: ValutazioneCriterio[];
  segnale: SegnaleTitolo;
  punteggio: number | null;
  posizioneClassifica: number | null;
  motivazione: string | null;
  paramsVersione: string;
  /** Prezzo al momento della decisione (reale) o null per l'ombra in attesa. */
  prezzo: number | null;
  quantita: number | null;
  piano: PianoUscita | null;
  modalita: "bracket" | "trailing";
  /** Parametri di uscita all'ingresso (per la simulazione e l'unità di R). */
  stopPct: number;
  tpPct: number;
  trailPct: number;
  candele: CompactBar[];
  candeleSplit: CompactBar[];
  ordineId: string | null;
  categoria?: CategoriaOmbra;
  motivoOmbra?: string;
}

export interface UscitaScheda {
  motivo: string;
  prezzo: number;
  data: string;
  durataSedute: number;
  risultatoUsd: number;
  risultatoPct: number;
  R: number | null;
  mfe: number | null;
  mae: number | null;
  spyRendimento: number | null;
  attraversoTrimestrale: boolean;
}

export interface Scheda {
  tradeId: string;
  reale: boolean;
  ingresso: IngressoScheda;
  /** Prezzo eseguito (reale) o apertura + slittamento (ombra). */
  prezzoIngresso: number | null;
  dataIngresso: string | null;
  quantitaEseguita: number | null;
  uscita: UscitaScheda | null;
  annullata: string | null;
  candeleDopo: CompactBar[];
  simulazione: { bracket: RisultatoSim | null; trailing: RisultatoSim | null; inCorso: boolean } | null;
  trimestrale: boolean;
  manuale: boolean;
  eventi: EventoDiario[];
  stato: "aperta" | "chiusa" | "simulazione in corso" | "completa" | "annullata" | "in attesa di ingresso" | "non entrata";
  nonEntrata: string | null;
}

export function piegaSchede(eventi: EventoDiario[], reale: boolean): Scheda[] {
  const map = new Map<string, Scheda>();
  for (const e of eventi) {
    const id = e.tradeId as string | undefined;
    if (!id) continue;
    if (e.tipo === "scheda-ingresso") {
      const ing = e.ingresso as IngressoScheda;
      map.set(id, { tradeId: id, reale, ingresso: ing, prezzoIngresso: reale ? null : null, dataIngresso: null, quantitaEseguita: null, uscita: null, annullata: null, candeleDopo: [], simulazione: null, trimestrale: false, manuale: false, eventi: [e], stato: reale ? "aperta" : "in attesa di ingresso", nonEntrata: null });
      continue;
    }
    const s = map.get(id);
    if (!s) continue;
    s.eventi.push(e);
    switch (e.tipo) {
      case "esecuzione":
        if (typeof e.prezzo === "number") s.prezzoIngresso = e.prezzo;
        if (typeof e.data === "string") s.dataIngresso = e.data;
        if (typeof e.quantita === "number") s.quantitaEseguita = e.quantita;
        if (e.nonEntrata) s.nonEntrata = String(e.nonEntrata);
        if (e.annullata) s.annullata = String(e.annullata);
        break;
      case "scheda-uscita":
        s.uscita = e.uscita as UscitaScheda;
        break;
      case "scheda-candele": {
        const have = new Set(s.candeleDopo.map((b) => b[0]));
        for (const b of (e.candele as CompactBar[]) ?? []) if (!have.has(b[0])) s.candeleDopo.push(b);
        s.candeleDopo.sort((a, b) => (a[0] < b[0] ? -1 : 1));
        break;
      }
      case "scheda-simulazione":
        s.simulazione = { bracket: (e.bracket as RisultatoSim) ?? null, trailing: (e.trailing as RisultatoSim) ?? null, inCorso: !!e.inCorso };
        break;
      case "scheda-trimestrale":
        s.trimestrale = true;
        break;
      case "scheda-manuale":
      case "manuale":
        s.manuale = true;
        break;
    }
  }
  for (const s of map.values()) {
    if (s.annullata) s.stato = "annullata";
    else if (s.nonEntrata) s.stato = "non entrata";
    else if (!reale && s.prezzoIngresso === null) s.stato = "in attesa di ingresso";
    else if (reale && !s.uscita) s.stato = "aperta";
    else if (!s.simulazione || s.simulazione.inCorso) s.stato = reale ? "simulazione in corso" : "aperta";
    else s.stato = reale ? "completa" : "chiusa";
  }
  return [...map.values()];
}

/** Cache in memoria per non rileggere il diario a ogni richiesta (dashboard). */
let cacheReali: { key: string; schede: Scheda[] } | null = null;
let cacheOmbra: { key: string; schede: Scheda[] } | null = null;

export function schedeReali(paths: Paths): Scheda[] {
  const ev = readJournal(paths);
  const key = `${paths.root}|${ev.length}|${ev.at(-1)?.ts ?? ""}`;
  if (cacheReali?.key === key) return cacheReali.schede;
  const schede = piegaSchede(ev, true);
  cacheReali = { key, schede };
  return schede;
}

export function schedeOmbra(paths: Paths): Scheda[] {
  const ev = readShadowJournal(paths);
  const key = `${paths.root}|${ev.length}|${ev.at(-1)?.ts ?? ""}`;
  if (cacheOmbra?.key === key) return cacheOmbra.schede;
  const schede = piegaSchede(ev, false);
  cacheOmbra = { key, schede };
  return schede;
}

/** R dell'operazione reale: unità = prezzo d'ingresso × stop% all'ingresso. */
export function unitaR(s: Scheda): number | null {
  const p = s.prezzoIngresso ?? s.ingresso.prezzo;
  return p ? (p * s.ingresso.stopPct) / 100 : null;
}
