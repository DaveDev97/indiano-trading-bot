// Indicatori tecnici (§4.5). Array allineati alle candele: NaN dove l'indicatore non è ancora definito.
import type { Bar } from "../data/types.ts";

export function sma(values: number[], n: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (n <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= n) sum -= values[i - n]!;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** True range: dalla seconda candela (serve la chiusura precedente). TR[0] = NaN. */
export function trueRange(bars: Bar[]): number[] {
  return bars.map((b, i) => {
    if (i === 0) return NaN;
    const pc = bars[i - 1]!.c;
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  });
}

/** ATR di Wilder: primo valore = media dei primi n TR (indici 1..n), poi (ATR·(n−1) + TR)/n. */
export function atrWilder(bars: Bar[], n: number): number[] {
  const tr = trueRange(bars);
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length <= n) return out;
  let s = 0;
  for (let i = 1; i <= n; i++) s += tr[i]!;
  out[n] = s / n;
  for (let i = n + 1; i < bars.length; i++) out[i] = (out[i - 1]! * (n - 1) + tr[i]!) / n;
  return out;
}

export interface AdxSeries {
  adx: number[];
  pdi: number[];
  mdi: number[];
}

/**
 * ADX(n) con +DI e −DI, metodo di Wilder:
 * - +DM = su se su > giù e su > 0, altrimenti 0 (su = H − H prec., giù = L prec. − L); −DM simmetrico;
 * - TRn, +DMn, −DMn: prima somma dei primi n valori (indici 1..n), poi S − S/n + x;
 * - +DI = 100·(+DMn/TRn), −DI = 100·(−DMn/TRn), DX = 100·|+DI − −DI|/(+DI + −DI);
 * - primo ADX = media dei primi n DX (indici n..2n−1), poi (ADX·(n−1) + DX)/n.
 */
export function adxWilder(bars: Bar[], n: number): AdxSeries {
  const len = bars.length;
  const adx = new Array<number>(len).fill(NaN);
  const pdi = new Array<number>(len).fill(NaN);
  const mdi = new Array<number>(len).fill(NaN);
  if (len <= 2 * n) return { adx, pdi, mdi };
  const tr = trueRange(bars);
  const pdm = new Array<number>(len).fill(0);
  const mdm = new Array<number>(len).fill(0);
  for (let i = 1; i < len; i++) {
    const up = bars[i]!.h - bars[i - 1]!.h;
    const down = bars[i - 1]!.l - bars[i]!.l;
    pdm[i] = up > down && up > 0 ? up : 0;
    mdm[i] = down > up && down > 0 ? down : 0;
  }
  let sTr = 0, sP = 0, sM = 0;
  for (let i = 1; i <= n; i++) {
    sTr += tr[i]!;
    sP += pdm[i]!;
    sM += mdm[i]!;
  }
  const dx = new Array<number>(len).fill(NaN);
  for (let i = n; i < len; i++) {
    if (i > n) {
      sTr = sTr - sTr / n + tr[i]!;
      sP = sP - sP / n + pdm[i]!;
      sM = sM - sM / n + mdm[i]!;
    }
    const p = sTr > 0 ? (100 * sP) / sTr : 0;
    const m = sTr > 0 ? (100 * sM) / sTr : 0;
    pdi[i] = p;
    mdi[i] = m;
    dx[i] = p + m > 0 ? (100 * Math.abs(p - m)) / (p + m) : 0;
  }
  let s = 0;
  for (let i = n; i <= 2 * n - 1; i++) s += dx[i]!;
  adx[2 * n - 1] = s / n;
  for (let i = 2 * n; i < len; i++) adx[i] = (adx[i - 1]! * (n - 1) + dx[i]!) / n;
  return { adx, pdi, mdi };
}

/** Canale di Donchian sulle n sedute PRECEDENTI alla candela i (la candela i è esclusa). */
export function donchianPrev(bars: Bar[], i: number, n: number): { alto: number; basso: number } | null {
  if (i - n < 0) return null;
  let hi = -Infinity, lo = Infinity;
  for (let j = i - n; j < i; j++) {
    hi = Math.max(hi, bars[j]!.h);
    lo = Math.min(lo, bars[j]!.l);
  }
  return { alto: hi, basso: lo };
}

/** Media del volume delle n sedute precedenti alla candela i. */
export function volumeAvgPrev(bars: Bar[], i: number, n: number): number | null {
  if (i - n < 0) return null;
  let s = 0;
  for (let j = i - n; j < i; j++) s += bars[j]!.v;
  return s / n;
}

/** Linea di forza relativa: chiusura del titolo ÷ chiusura di SPY alla stessa data. NaN se SPY manca. */
export function rsLine(bars: Bar[], spy: Bar[]): number[] {
  const m = new Map(spy.map((b) => [b.t, b.c]));
  return bars.map((b) => {
    const s = m.get(b.t);
    return s && s > 0 ? b.c / s : NaN;
  });
}

export interface Resistenza {
  livello: number;
  massimi: number;
  ultimoIndice: number;
}

/**
 * Resistenze: gruppi di almeno 2 massimi locali (finestra di `barre` candele centrata) delle ultime
 * `finestra` sedute prima della candela i, con prezzi entro `tolleranzaPct` l'uno dall'altro.
 * Livello = massimo del gruppo.
 */
export function resistenze(bars: Bar[], i: number, finestra: number, barre: number, tolleranzaPct: number): Resistenza[] {
  const k = Math.floor(barre / 2);
  const start = Math.max(k, i - finestra);
  const pivots: { idx: number; p: number }[] = [];
  for (let j = start; j + k <= i - 1; j++) {
    let isMax = true;
    for (let d = -k; d <= k && isMax; d++) {
      if (d === 0) continue;
      const hj = bars[j + d]!.h;
      if (hj > bars[j]!.h || (d < 0 && hj === bars[j]!.h)) isMax = false;
    }
    if (isMax) pivots.push({ idx: j, p: bars[j]!.h });
  }
  pivots.sort((a, b) => a.p - b.p);
  const out: Resistenza[] = [];
  let s = 0;
  while (s < pivots.length) {
    let e = s;
    while (e + 1 < pivots.length && pivots[e + 1]!.p / pivots[s]!.p - 1 <= tolleranzaPct / 100) e++;
    if (e > s) {
      const grp = pivots.slice(s, e + 1);
      out.push({ livello: Math.max(...grp.map((g) => g.p)), massimi: grp.length, ultimoIndice: Math.max(...grp.map((g) => g.idx)) });
      s = e + 1;
    } else s++;
  }
  return out;
}

/**
 * Rottura di resistenza alla candela i: chiusura ≥ livello × (1 + rottura%), e nessuna chiusura dopo l'ultimo
 * massimo del gruppo (fino alla candela precedente) l'aveva già superato. Restituisce il livello più alto rotto.
 */
export function rotturaResistenza(bars: Bar[], i: number, res: Resistenza[], rotturaPct: number): Resistenza | null {
  const c = bars[i]!.c;
  let best: Resistenza | null = null;
  for (const r of res) {
    const soglia = r.livello * (1 + rotturaPct / 100);
    if (c < soglia) continue;
    let giaRotta = false;
    for (let j = r.ultimoIndice + 1; j < i; j++) if (bars[j]!.c >= soglia) giaRotta = true;
    if (giaRotta) continue;
    if (!best || r.livello > best.livello) best = r;
  }
  return best;
}
