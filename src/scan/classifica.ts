// Classifica per percentili dentro settore e profilo, e costruzione della watchlist (§4.4).
import type { Settore } from "../config/settori.ts";
import { CRITERI, PROFILI, type Profilo, type ValutazioneProfilo } from "./profili.ts";

export interface TitoloValutato {
  simbolo: string;
  nome: string;
  settore: Settore;
  industria: string;
  capitalizzazione: number | null;
  prezzo: number;
  controvalore: number;
  profili: Record<Profilo, ValutazioneProfilo>;
}

export interface VoceClassifica {
  simbolo: string;
  nome: string;
  settore: Settore;
  industria: string;
  profilo: Profilo;
  punteggio: number;
  percentili: Record<string, number>;
  posizioneSettore: number;
  posizioneGenerale?: number;
  criteri: ValutazioneProfilo["criteri"];
  capitalizzazione: number | null;
  prezzo: number;
  /** Messo nella lista a mano dalla dashboard (dalla zona grigia), non dalla classifica. */
  override?: "aggiunto";
}

/** Percentile (0–100) di v tra i valori, con la direzione indicata. Uguaglianze a metà. */
export function percentile(v: number, values: number[], direzione: "alto" | "basso" | "centro"): number {
  if (values.length <= 1) return 50;
  let below = 0, equal = 0;
  for (const x of values) {
    if (x === v) equal++;
    else if (direzione === "alto" ? x < v : x > v) below++;
  }
  // escludo il titolo stesso dagli uguali
  return (100 * (below + 0.5 * (equal - 1))) / (values.length - 1);
}

/**
 * Punteggio per ogni titolo che passa un profilo = media dei percentili delle metriche valutabili, confrontato con
 * gli altri titoli dello stesso settore e profilo (se meno di `minConfronto`, con tutto il profilo).
 * Se un titolo passa più profili vale il punteggio migliore.
 */
export function classifica(titoli: TitoloValutato[], minConfronto: number): VoceClassifica[] {
  const best = new Map<string, VoceClassifica>();
  for (const prof of PROFILI) {
    const passing = titoli.filter((t) => t.profili[prof].superato);
    const crit = CRITERI.filter((c) => c.profilo === prof);
    for (const t of passing) {
      const peersSector = passing.filter((x) => x.settore === t.settore);
      const peers = peersSector.length >= minConfronto ? peersSector : passing;
      const percentili: Record<string, number> = {};
      for (const c of crit) {
        const mine = t.profili[prof].criteri.find((x) => x.id === c.id);
        if (!mine || mine.esito !== "superato" || mine.valoreClassifica === null) continue;
        const vals = peers
          .map((p) => p.profili[prof].criteri.find((x) => x.id === c.id))
          .filter((x) => x && x.esito === "superato" && x.valoreClassifica !== null)
          .map((x) => x!.valoreClassifica!);
        const dir = c.direzione === "centro" || c.tipo === "banda" ? "basso" : c.direzione;
        percentili[c.id] = percentile(mine.valoreClassifica, vals, dir);
      }
      const ps = Object.values(percentili);
      const punteggio = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
      const prev = best.get(t.simbolo);
      if (!prev || punteggio > prev.punteggio) {
        best.set(t.simbolo, {
          simbolo: t.simbolo, nome: t.nome, settore: t.settore, industria: t.industria, profilo: prof, punteggio: Math.round(punteggio * 10) / 10,
          percentili, posizioneSettore: 0, criteri: t.profili[prof].criteri, capitalizzazione: t.capitalizzazione, prezzo: t.prezzo,
        });
      }
    }
  }
  const all = [...best.values()].sort((a, b) => b.punteggio - a.punteggio || a.simbolo.localeCompare(b.simbolo));
  const perSettore = new Map<string, number>();
  for (const v of all) {
    const n = (perSettore.get(v.settore) ?? 0) + 1;
    perSettore.set(v.settore, n);
    v.posizioneSettore = n;
  }
  return all;
}
