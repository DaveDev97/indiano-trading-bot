// Regole di ingresso e uscita (§4.5) e controllo del prezzo al momento dell'acquisto (§4.6).
import type { Bar } from "../data/types.ts";
import type { Params } from "../params/params.ts";
import { adxWilder, atrWilder, donchianPrev, resistenze, rotturaResistenza, rsLine, sma, volumeAvgPrev } from "./indicators.ts";

export interface ParametriSegnali {
  candeleMin: number;
  smaBreve: number;
  smaMedia: number;
  smaLunga: number;
  atrPeriodo: number;
  adxPeriodo: number;
  adxMin: number;
  confermeMin: number;
  volumeMult: number;
  donchianPeriodo: number;
  volumeMediaPeriodo: number;
  rsMediaPeriodo: number;
  resistenzaFinestra: number;
  resistenzaBarre: number;
  resistenzaTolleranza: number;
  rotturaMin: number;
  candelaCorpoAtr: number;
  candelaQuarto: number;
  quasiAdx: number;
}

export function parametriSegnali(P: Params): ParametriSegnali {
  const k = (s: string) => P.n(`segnali.${s}`);
  return {
    candeleMin: k("candeleMin"),
    smaBreve: k("smaBreve"),
    smaMedia: k("smaMedia"),
    smaLunga: k("smaLunga"),
    atrPeriodo: k("atrPeriodo"),
    adxPeriodo: k("adxPeriodo"),
    adxMin: k("adxMin"),
    confermeMin: k("confermeMin"),
    volumeMult: k("volumeMult"),
    donchianPeriodo: k("donchianPeriodo"),
    volumeMediaPeriodo: k("volumeMediaPeriodo"),
    rsMediaPeriodo: k("rsMediaPeriodo"),
    resistenzaFinestra: k("resistenzaFinestra"),
    resistenzaBarre: k("resistenzaBarre"),
    resistenzaTolleranza: k("resistenzaTolleranza"),
    rotturaMin: k("rotturaMin"),
    candelaCorpoAtr: k("candelaCorpoAtr"),
    candelaQuarto: k("candelaQuarto"),
    quasiAdx: k("quasiAdx"),
  };
}

export interface Conferme {
  donchian: boolean;
  volume: boolean;
  resistenza: boolean;
  candela: boolean;
}

export interface SegnaleTitolo {
  simbolo: string;
  /** Data dell'ultima candela chiusa usata. */
  data: string;
  candele: number;
  candeleSufficienti: boolean;
  chiusura: number;
  apertura: number;
  massimo: number;
  minimo: number;
  volume: number;
  chiusuraPrec: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr: number | null;
  adx: number | null;
  pdi: number | null;
  mdi: number | null;
  donchianAlto: number | null;
  donchianBasso: number | null;
  volumeMedio: number | null;
  rapportoVolume: number | null;
  rs: number | null;
  rsMedia: number | null;
  resistenza: number | null;
  obbligatorie: { trend: boolean; adx: boolean; rs: boolean };
  conferme: Conferme;
  nConferme: number;
  ingresso: boolean;
  /** Candidato "quasi" per le operazioni ombra. */
  quasi: boolean;
  quasiMotivo: string | null;
  /** Livello rotto (Donchian o resistenza) da verificare al momento dell'acquisto. */
  livelloRotto: number | null;
  uscitaForte: boolean;
  usciteDeboli: string[];
  motivi: string[];
}

const fin = (x: number | undefined): number | null => (x !== undefined && Number.isFinite(x) ? x : null);

/** Calcola i segnali sull'ultima candela di `bars` (tutte chiuse, rettificate split+dividendi). */
export function calcolaSegnali(simbolo: string, bars: Bar[], spy: Bar[], p: ParametriSegnali): SegnaleTitolo {
  const i = bars.length - 1;
  const b = bars[i]!;
  const closes = bars.map((x) => x.c);
  const s20 = sma(closes, p.smaBreve), s50 = sma(closes, p.smaMedia), s200 = sma(closes, p.smaLunga);
  const atr = atrWilder(bars, p.atrPeriodo);
  const { adx, pdi, mdi } = adxWilder(bars, p.adxPeriodo);
  const don = donchianPrev(bars, i, p.donchianPeriodo);
  const vAvg = volumeAvgPrev(bars, i, p.volumeMediaPeriodo);
  const rs = rsLine(bars, spy);
  // media della RS solo sui valori definiti (date in comune con SPY)
  const rsDef = rs.map((x) => (Number.isFinite(x) ? x : NaN));
  const rsS = sma(rsDef, p.rsMediaPeriodo);
  const res = resistenze(bars, i, p.resistenzaFinestra, p.resistenzaBarre, p.resistenzaTolleranza);
  const rott = rotturaResistenza(bars, i, res, p.rotturaMin);

  const v = {
    sma20: fin(s20[i]), sma50: fin(s50[i]), sma200: fin(s200[i]), atr: fin(atr[i]),
    adx: fin(adx[i]), pdi: fin(pdi[i]), mdi: fin(mdi[i]), rs: fin(rs[i]), rsMedia: fin(rsS[i]),
  };
  const motivi: string[] = [];
  const sufficienti = bars.length >= p.candeleMin;
  if (!sufficienti) motivi.push(`solo ${bars.length} sedute chiuse (servono ${p.candeleMin})`);

  const trend = v.sma50 !== null && v.sma200 !== null && b.c > v.sma50 && v.sma50 > v.sma200;
  const adxOk = v.adx !== null && v.pdi !== null && v.mdi !== null && v.adx >= p.adxMin && v.pdi > v.mdi;
  const rsOk = v.rs !== null && v.rsMedia !== null && v.rs > v.rsMedia;
  if (!trend) motivi.push("trend non crescente (chiusura > SMA50 > SMA200 non verificato)");
  if (!adxOk) motivi.push(v.adx === null ? "ADX non calcolabile" : `ADX ${v.adx.toFixed(1)} sotto ${p.adxMin} o +DI ≤ −DI`);
  if (!rsOk) motivi.push("forza relativa sotto la sua media");

  const rapportoVolume = vAvg && vAvg > 0 ? b.v / vAvg : null;
  const body = b.c - b.o;
  const range = b.h - b.l;
  const conferme: Conferme = {
    donchian: don !== null && b.c > don.alto,
    volume: rapportoVolume !== null && rapportoVolume >= p.volumeMult,
    resistenza: rott !== null,
    candela: v.atr !== null && body > 0 && body >= p.candelaCorpoAtr * v.atr && range > 0 && b.c >= b.l + p.candelaQuarto * range,
  };
  const nConferme = Object.values(conferme).filter(Boolean).length;
  if (nConferme < p.confermeMin) motivi.push(`${nConferme} conferme su ${p.confermeMin} richieste`);

  const ingresso = sufficienti && trend && adxOk && rsOk && nConferme >= p.confermeMin;
  let quasi = false;
  let quasiMotivo: string | null = null;
  if (!ingresso && sufficienti) {
    const adxQuasi = v.adx !== null && v.pdi !== null && v.mdi !== null && v.pdi > v.mdi && v.adx < p.adxMin && v.adx >= p.adxMin - p.quasiAdx;
    if (trend && rsOk && adxQuasi && nConferme >= p.confermeMin) {
      quasi = true;
      quasiMotivo = `ADX ${v.adx!.toFixed(1)} entro ${p.quasiAdx} punti dalla soglia`;
    } else if (trend && adxOk && rsOk && nConferme === p.confermeMin - 1) {
      quasi = true;
      quasiMotivo = "mancava una sola conferma";
    }
  }

  const livelli: number[] = [];
  if (conferme.donchian && don) livelli.push(don.alto);
  if (conferme.resistenza && rott) livelli.push(rott.livello);

  const uscitaForte = don !== null && b.c < don.basso && rapportoVolume !== null && rapportoVolume >= p.volumeMult;
  const deboli: string[] = [];
  if (v.sma50 !== null && b.c < v.sma50) deboli.push("chiusura sotto la SMA50");
  if (v.rs !== null && v.rsMedia !== null && v.rs < v.rsMedia) deboli.push("forza relativa sotto la sua media");
  const prev = bars[i - 1];
  if (v.atr !== null && b.o - b.c >= p.candelaCorpoAtr * v.atr && prev && b.v > prev.v) deboli.push("candela rossa lunga con volume in aumento");

  return {
    simbolo,
    data: b.t,
    candele: bars.length,
    candeleSufficienti: sufficienti,
    chiusura: b.c,
    apertura: b.o,
    massimo: b.h,
    minimo: b.l,
    volume: b.v,
    chiusuraPrec: prev?.c ?? null,
    ...v,
    donchianAlto: don?.alto ?? null,
    donchianBasso: don?.basso ?? null,
    volumeMedio: vAvg,
    rapportoVolume,
    resistenza: rott?.livello ?? null,
    obbligatorie: { trend, adx: adxOk, rs: rsOk },
    conferme,
    nConferme,
    ingresso,
    quasi,
    quasiMotivo,
    livelloRotto: livelli.length ? Math.max(...livelli) : null,
    uscitaForte,
    usciteDeboli: deboli,
    motivi,
  };
}

export interface ControlloPrezzo {
  ok: boolean;
  motivi: string[];
}

/**
 * Controllo del prezzo al momento dell'acquisto (§4.6), uguale per le operazioni ombra:
 * prezzo ancora sopra la SMA50 e sopra il livello rotto; scostamento dalla chiusura precedente entro gapMaxAtr × ATR.
 * `riferimento` è la chiusura della candela del segnale (la seduta precedente all'acquisto).
 */
export function controlloPrezzo(s: SegnaleTitolo, prezzo: number, gapMaxAtr: number): ControlloPrezzo {
  const motivi: string[] = [];
  if (!Number.isFinite(prezzo) || prezzo <= 0) return { ok: false, motivi: ["prezzo attuale non disponibile"] };
  if (s.sma50 === null || prezzo <= s.sma50) motivi.push(`prezzo ${prezzo.toFixed(2)} non sopra la SMA50 ${s.sma50?.toFixed(2) ?? "n/d"}`);
  if (s.livelloRotto !== null && prezzo <= s.livelloRotto) motivi.push(`prezzo ${prezzo.toFixed(2)} tornato sotto il livello rotto ${s.livelloRotto.toFixed(2)}`);
  if (s.atr === null) motivi.push("ATR non disponibile");
  else {
    const gap = Math.abs(prezzo - s.chiusura);
    if (gap > gapMaxAtr * s.atr) motivi.push(`scostamento di ${gap.toFixed(2)} dalla chiusura precedente oltre ${gapMaxAtr} ATR (${(gapMaxAtr * s.atr).toFixed(2)})`);
  }
  return { ok: motivi.length === 0, motivi };
}
