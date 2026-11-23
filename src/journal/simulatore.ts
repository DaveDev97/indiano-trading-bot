// Simulatore delle uscite (§7.2), unico per operazioni reali e ombra. Candele rettificate solo per gli split.
// Ogni seduta: 1) uscita con i livelli della seduta precedente; 2) aggiornamento del massimo con la seduta corrente.
// Stop: min(apertura, stop). Take profit: max(apertura, tp). Stop e tp nella stessa seduta: vale lo stop.
// Uscita forte (chiusura < minimo Donchian e volume ≥ mult × media): si esce all'apertura della seduta dopo.
import type { Bar } from "../data/types.ts";
import { donchianPrev, volumeAvgPrev } from "../signals/indicators.ts";

export type ModalitaSim = "bracket" | "trailing";

export interface ParamSim {
  stopPct: number;
  tpPct: number;
  trailPct: number;
  donchian: number;
  volumeMult: number;
  volumeMedia: number;
  maxSedute: number;
}

export interface RisultatoSim {
  modalita: ModalitaSim;
  stato: "aperta" | "chiusa";
  ingresso: { data: string; prezzo: number };
  uscita: { data: string; prezzo: number; motivo: "stop" | "take profit" | "stop mobile" | "uscita forte" | "scadenza" } | null;
  /** Risultato in multipli del rischio iniziale (unità fissata dall'operazione). */
  R: number | null;
  rendimento: number | null;
  mfe: number;
  mae: number;
  sedute: number;
  /** Ultima chiusura nota (per le operazioni ancora aperte). */
  ultimaChiusura: number;
}

/**
 * @param storia candele PRIMA della seduta di ingresso (per l'uscita forte)
 * @param percorso candele dalla seduta di ingresso in poi
 * @param ingresso prezzo di ingresso (reale: prezzo eseguito; ombra: apertura × (1 + slittamento))
 * @param unitaR rischio iniziale per azione (fisso per l'operazione)
 */
export function simula(modalita: ModalitaSim, storia: Bar[], percorso: Bar[], ingresso: number, unitaR: number, p: ParamSim): RisultatoSim {
  const out: RisultatoSim = { modalita, stato: "aperta", ingresso: { data: percorso[0]?.t ?? "", prezzo: ingresso }, uscita: null, R: null, rendimento: null, mfe: 0, mae: 0, sedute: 0, ultimaChiusura: ingresso };
  if (!percorso.length || !(ingresso > 0)) return out;
  const stop = ingresso * (1 - p.stopPct / 100);
  const tp = ingresso * (1 + p.tpPct / 100);
  let massimo = ingresso;
  let forteDomani = false;
  const all = [...storia, ...percorso];
  const off = storia.length;
  const chiudi = (data: string, prezzo: number, motivo: NonNullable<RisultatoSim["uscita"]>["motivo"], sedute: number) => {
    out.stato = "chiusa";
    out.uscita = { data, prezzo, motivo };
    out.rendimento = prezzo / ingresso - 1;
    out.R = unitaR > 0 ? (prezzo - ingresso) / unitaR : null;
    out.sedute = sedute;
    return out;
  };
  for (let d = 0; d < percorso.length; d++) {
    const b = percorso[d]!;
    const o = d === 0 ? ingresso : b.o; // il giorno dell'ingresso si entra all'apertura
    if (forteDomani) return chiudi(b.t, b.o, "uscita forte", d);
    out.mfe = Math.max(out.mfe, b.h / ingresso - 1);
    out.mae = Math.min(out.mae, b.l / ingresso - 1);
    if (modalita === "bracket") {
      const hitStop = b.l <= stop;
      const hitTp = b.h >= tp;
      if (hitStop) return chiudi(b.t, Math.min(o, stop), "stop", d);
      if (hitTp) return chiudi(b.t, Math.max(o, tp), "take profit", d);
    } else {
      const livello = massimo * (1 - p.trailPct / 100);
      if (b.l <= livello) return chiudi(b.t, Math.min(o, livello), "stop mobile", d);
      massimo = Math.max(massimo, b.h);
    }
    out.ultimaChiusura = b.c;
    out.sedute = d + 1;
    // uscita forte sulla chiusura di oggi → vendita all'apertura di domani
    const i = off + d;
    const don = donchianPrev(all, i, p.donchian);
    const va = volumeAvgPrev(all, i, p.volumeMedia);
    forteDomani = !!don && va !== null && va > 0 && b.c < don.basso && b.v >= p.volumeMult * va;
    if (d + 1 >= p.maxSedute) return chiudi(b.t, b.c, "scadenza", d + 1);
  }
  return out;
}
