// Proposte di modifica dei parametri (§7.3, §7.4), con le regole contro l'overfitting:
// campione non piccolo, ≥ 30 operazioni nel gruppo della differenza, effetto ≥ 0,1 R,
// IC bootstrap al 90% (corretto Bonferroni) che esclude lo zero sia nei primi 2/3 sia nell'ultimo terzo,
// al massimo 2 parametri, un passo ciascuno, sicurezza solo nella direzione prudente.
import { PARAM_BY_KEY, PARAM_DEFS, type ParamDef, type Valore } from "../config/parametri.ts";
import type { Params } from "../params/params.ts";
import type { Bar } from "../data/types.ts";
import { expandBars } from "../data/bars.ts";
import { CRITERI } from "../scan/profili.ts";
import type { Scheda } from "../journal/schede.ts";
import { simula, type ModalitaSim, type ParamSim } from "../journal/simulatore.ts";
import { donchianPrev } from "../signals/indicators.ts";
import { bootstrapMedia, confidenzaBonferroni } from "./bootstrap.ts";

export interface Osservazione {
  id: string;
  reale: boolean;
  data: string;
  Rsim: Record<ModalitaSim, number | null>;
  scheda: Scheda;
  storia: Bar[];
  percorso: Bar[];
  candele: Bar[];
  ingresso: number;
  unitaR: number;
}

export function osservazioni(schede: Scheda[]): Osservazione[] {
  const out: Osservazione[] = [];
  for (const s of schede) {
    if (s.manuale || s.annullata || s.nonEntrata || s.prezzoIngresso === null) continue;
    const sim = s.simulazione;
    const ingresso = s.prezzoIngresso;
    const da = s.dataIngresso ?? s.ingresso.seduta;
    out.push({
      id: s.tradeId,
      reale: s.reale,
      data: da,
      Rsim: { bracket: sim?.bracket?.stato === "chiusa" ? sim.bracket.R : null, trailing: sim?.trailing?.stato === "chiusa" ? sim.trailing.R : null },
      scheda: s,
      storia: expandBars(s.ingresso.candeleSplit).filter((b) => b.t < da),
      percorso: expandBars(s.candeleDopo).filter((b) => b.t >= da),
      candele: expandBars(s.ingresso.candele),
      ingresso,
      unitaR: (ingresso * s.ingresso.stopPct) / 100,
    });
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : 1));
}

export interface Valutazione {
  chiave: string;
  descrizione: string;
  da: Valore;
  a: Valore;
  direzione: "su" | "giu" | "cambio";
  n: number;
  effettoR: number | null;
  icPrimi: [number, number] | null;
  icUltimi: [number, number] | null;
  ammessa: boolean;
  motivo: string;
}

export interface EsitoProposte {
  valutazioni: Valutazione[];
  candidate: Valutazione[];
  nonValutati: string[];
  confronti: number;
  campionePiccolo: boolean;
}

type Passa = (o: Osservazione, v: Valore) => boolean | null;

function passaFiltro(def: ParamDef, P: Params): Passa | null {
  const confMin = P.n("segnali.confermeMin");
  switch (def.valutazione) {
    case "filtro-adx":
      return (o, v) => {
        const s = o.scheda.ingresso.segnale;
        return s.adx === null || s.pdi === null || s.mdi === null ? null : s.adx >= (v as number) && s.pdi > s.mdi;
      };
    case "filtro-conferme":
      return (o, v) => o.scheda.ingresso.segnale.nConferme >= (v as number);
    case "filtro-volume":
      return (o, v) => {
        const s = o.scheda.ingresso.segnale;
        if (s.rapportoVolume === null) return null;
        const n = s.nConferme - (s.conferme.volume ? 1 : 0) + (s.rapportoVolume >= (v as number) ? 1 : 0);
        return n >= confMin;
      };
    case "filtro-donchian":
      return (o, v) => {
        const s = o.scheda.ingresso.segnale;
        const b = o.candele;
        const i = b.length - 1;
        const d = donchianPrev(b, i, v as number);
        if (!d || i < 0) return null;
        const n = s.nConferme - (s.conferme.donchian ? 1 : 0) + (b[i]!.c > d.alto ? 1 : 0);
        return n >= confMin;
      };
    case "settori-periodo":
      return (o, v) => {
        const f = o.scheda.ingresso.forzaSettore;
        const r = f?.rendimenti[String(v)];
        const sp = f?.spy[String(v)];
        return r == null || sp == null ? null : r > sp;
      };
    case "filtro-fondamentale": {
      const crit = CRITERI.filter((c) => c.param === def.chiave || c.paramMax === def.chiave);
      return (o, v) => {
        const cr = o.scheda.ingresso.criteri.find((x) => crit.some((c) => c.id === x.id));
        if (!cr) return true; // il criterio non riguarda il profilo dell'operazione: non cambia nulla
        const c = crit.find((x) => x.id === cr.id)!;
        if (cr.esito === "non disponibile" || cr.esito === "non applicabile") return true;
        const val = c.tipo === "banda" ? cr.valoreClassifica : cr.valore;
        if (val === null) return cr.esito === "superato";
        const x = v as number;
        if (c.tipo === ">") return val > x;
        if (c.tipo === "<") return val < x && val > 0;
        if (c.tipo === "banda") return val <= x;
        // "tra": cambia il minimo o il massimo
        const lo = c.param === def.chiave ? x : P.n(c.param);
        const hi = c.paramMax === def.chiave ? x : P.n(c.paramMax!);
        return val >= lo && val <= hi;
      };
    }
  }
  return null;
}

function passi(def: ParamDef, cur: Valore): { a: Valore; direzione: "su" | "giu" | "cambio" }[] {
  if (def.opzioni) {
    const i = def.opzioni.indexOf(cur as any);
    const out: { a: Valore; direzione: "su" | "giu" | "cambio" }[] = [];
    if (def.chiave === "uscita.modalita") return def.opzioni.filter((x) => x !== cur).map((a) => ({ a, direzione: "cambio" as const }));
    if (i > 0) out.push({ a: def.opzioni[i - 1]!, direzione: "giu" });
    if (i >= 0 && i < def.opzioni.length - 1) out.push({ a: def.opzioni[i + 1]!, direzione: "su" });
    return out;
  }
  const c = cur as number;
  const st = def.passo ?? 1;
  const r = (x: number) => Number(x.toFixed(6));
  const out: { a: Valore; direzione: "su" | "giu" | "cambio" }[] = [];
  if (def.max === undefined || c + st <= def.max + 1e-9) out.push({ a: r(c + st), direzione: "su" });
  if (def.min === undefined || c - st >= def.min - 1e-9) out.push({ a: r(c - st), direzione: "giu" });
  return out;
}

/**
 * R simulato su un percorso. Le operazioni ancora aperte si valutano all'ultima chiusura (prezzo di mercato):
 * escluderle distorcerebbe il confronto, perché un livello più largo lascia aperte proprio le operazioni migliori.
 */
function simR(o: Osservazione, mod: ModalitaSim, ps: ParamSim): number | null {
  if (!(o.unitaR > 0)) return null;
  const r = simula(mod, o.storia, o.percorso, o.ingresso, o.unitaR, ps);
  return r.stato === "chiusa" ? r.R : (r.ultimaChiusura - o.ingresso) / o.unitaR;
}

export function valutaProposte(schede: Scheda[], P: Params, opts: { realiChiuse: number; paramSim: ParamSim; seed?: number }): EsitoProposte {
  const obs = osservazioni(schede);
  const modo = P.s("uscita.modalita") as ModalitaSim;
  const campionePiccolo = opts.realiChiuse < P.n("appr.campionePiccolo");
  const nonValutati: string[] = [];
  const grezze: { def: ParamDef; da: Valore; a: Valore; direzione: "su" | "giu" | "cambio"; x: { data: string; v: number }[] }[] = [];
  for (const def of PARAM_DEFS) {
    if (def.categoria === "sicurezza") {
      nonValutati.push(`${def.descrizione}: parametro di sicurezza, nessun metodo di valutazione sulle operazioni (si cambia solo dalle impostazioni)`);
      continue;
    }
    if (def.categoria !== "strategia" || !def.valutazione) continue;
    const cur = P.get(def.chiave);
    for (const st of passi(def, cur)) {
      const x: { data: string; v: number }[] = [];
      if (def.valutazione.startsWith("uscita-")) {
        for (const o of obs) {
          if (!o.percorso.length) continue;
          let a: number | null, b: number | null;
          if (def.valutazione === "uscita-modalita") {
            a = simR(o, modo, opts.paramSim);
            b = simR(o, st.a as ModalitaSim, opts.paramSim);
          } else {
            const k = def.valutazione === "uscita-stop" ? "stopPct" : def.valutazione === "uscita-tp" ? "tpPct" : "trailPct";
            const mod: ModalitaSim = def.valutazione === "uscita-trailing" ? "trailing" : "bracket";
            a = simR(o, mod, opts.paramSim);
            b = simR(o, mod, { ...opts.paramSim, [k]: st.a as number });
          }
          if (a !== null && b !== null) x.push({ data: o.data, v: b - a });
        }
      } else {
        const fn = passaFiltro(def, P)!;
        for (const o of obs) {
          const R = o.Rsim[modo];
          if (R === null) continue;
          const pc = fn(o, cur), pn = fn(o, st.a);
          if (pc === null || pn === null || pc === pn) continue;
          x.push({ data: o.data, v: pn ? R : -R }); // aggiunte: +R; escluse: −R (si guadagna se erano in perdita)
        }
      }
      if (!x.length) {
        nonValutati.push(`${def.descrizione} ${st.direzione === "su" ? "↑" : st.direzione === "giu" ? "↓" : "→"} ${st.a}: nessuna operazione nel gruppo della differenza${def.valutazione.startsWith("filtro") || def.valutazione === "settori-periodo" ? " (per allentare servono operazioni ombra \"quasi\" o in zona grigia che coprano il passo)" : ""}`);
        continue;
      }
      grezze.push({ def, da: cur, a: st.a, direzione: st.direzione, x: x.sort((p, q) => (p.data < q.data ? -1 : 1)) });
    }
  }
  const minGruppo = P.n("appr.minGruppo");
  const testabili = grezze.filter((g) => g.x.length >= minGruppo);
  const confronti = testabili.length;
  const conf = confidenzaBonferroni(P.n("appr.confidenza"), confronti);
  const B = P.n("appr.bootstrap");
  const effMin = P.n("appr.effettoMinR");
  const valutazioni: Valutazione[] = grezze.map((g, idx) => {
    const v = g.x.map((y) => y.v);
    const eff = v.reduce((a, b) => a + b, 0) / v.length;
    const base: Valutazione = { chiave: g.def.chiave, descrizione: g.def.descrizione, da: g.da, a: g.a, direzione: g.direzione, n: v.length, effettoR: eff, icPrimi: null, icUltimi: null, ammessa: false, motivo: "" };
    if (campionePiccolo) return { ...base, motivo: "campione piccolo: nessuna proposta" };
    if (v.length < minGruppo) return { ...base, motivo: `solo ${v.length} operazioni nel gruppo della differenza (servono ${minGruppo})` };
    const cut = Math.floor((v.length * 2) / 3);
    const primi = v.slice(0, cut), ultimi = v.slice(cut);
    const icP = bootstrapMedia(primi, conf, B, (opts.seed ?? 1) + idx * 7919);
    const icU = bootstrapMedia(ultimi, conf, B, (opts.seed ?? 1) + idx * 7919 + 1);
    const r = { ...base, icPrimi: icP, icUltimi: icU };
    if (eff < effMin) return { ...r, motivo: `effetto ${eff.toFixed(3)} R sotto il minimo ${effMin} R` };
    if (!(icP[0] > 0) || !(icU[0] > 0)) return { ...r, motivo: `intervallo al ${(conf * 100).toFixed(2)}% che comprende lo zero in almeno una parte del periodo` };
    const def = PARAM_BY_KEY.get(g.def.chiave)!;
    if (def.categoria === "sicurezza") return { ...r, motivo: "parametro di sicurezza" };
    return { ...r, ammessa: true, motivo: "supera tutti i controlli" };
  });
  const scelte: Valutazione[] = [];
  for (const v of valutazioni.filter((x) => x.ammessa).sort((a, b) => b.effettoR! - a.effettoR!)) {
    if (scelte.length >= P.n("appr.maxProposte")) break;
    if (scelte.some((s) => s.chiave === v.chiave)) continue;
    scelte.push(v);
  }
  return { valutazioni, candidate: scelte, nonValutati, confronti, campionePiccolo };
}
