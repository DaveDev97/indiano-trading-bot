// Indicatori: valori di riferimento.
// Fonti: definizioni di J. Welles Wilder, "New Concepts in Technical Trading Systems" (1978), come documentate da
// StockCharts ChartSchool ("Average True Range (ATR)", "Average Directional Index (ADX)").
// I valori attesi sono (a) calcolati a mano su serie piccole, (b) analitici su serie costruite apposta,
// (c) confrontati con un'implementazione indipendente nella forma "a medie" di Wilder (diversa dalla forma "a somme" del codice).
import { describe, expect, test } from "bun:test";
import type { Bar } from "../src/data/types.ts";
import { adxWilder, atrWilder, donchianPrev, resistenze, rotturaResistenza, rsLine, sma, trueRange, volumeAvgPrev } from "../src/signals/indicators.ts";
import { calcolaSegnali, controlloPrezzo, type ParametriSegnali } from "../src/signals/rules.ts";
import { mulberry32, gaussian } from "../src/data/fake.ts";
import { addDays } from "../src/util/time.ts";

const bar = (t: string, o: number, h: number, l: number, c: number, v = 1000): Bar => ({ t, o, h, l, c, v });

export const P0: ParametriSegnali = {
  candeleMin: 300, smaBreve: 20, smaMedia: 50, smaLunga: 200, atrPeriodo: 14, adxPeriodo: 14, adxMin: 20, confermeMin: 2,
  volumeMult: 1.5, donchianPeriodo: 20, volumeMediaPeriodo: 20, rsMediaPeriodo: 50, resistenzaFinestra: 120, resistenzaBarre: 5,
  resistenzaTolleranza: 1.5, rotturaMin: 0.5, candelaCorpoAtr: 1.5, candelaQuarto: 0.75, quasiAdx: 3,
};

function dates(n: number, start = "2025-01-01"): string[] {
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

function randomBars(n: number, seed = 7): Bar[] {
  const r = mulberry32(seed);
  let p = 50;
  return dates(n).map((t) => {
    const o = p * (1 + gaussian(r) * 0.005);
    const c = p * (1 + gaussian(r) * 0.02);
    const h = Math.max(o, c) * (1 + Math.abs(gaussian(r)) * 0.01);
    const l = Math.min(o, c) * (1 - Math.abs(gaussian(r)) * 0.01);
    p = c;
    return bar(t, o, h, l, c, 1000 + Math.round(r() * 1000));
  });
}

/** Implementazione indipendente, forma "a medie" di Wilder: ogni serie lisciata è media, non somma. */
function adxReference(bars: Bar[], n: number) {
  const tr: number[] = [], pdm: number[] = [], mdm: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!, p = bars[i - 1]!;
    tr.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
    const up = b.h - p.h, dn = p.l - b.l;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  const wilder = (x: number[]) => {
    const out: number[] = [];
    let a = x.slice(0, n).reduce((s, v) => s + v, 0) / n;
    out[n - 1] = a;
    for (let i = n; i < x.length; i++) out[i] = a = a + (x[i]! - a) / n;
    return out;
  };
  const atr = wilder(tr), ap = wilder(pdm), am = wilder(mdm);
  const dx: number[] = [], pdi: number[] = [], mdi: number[] = [];
  for (let i = n - 1; i < tr.length; i++) {
    pdi[i] = (100 * ap[i]!) / atr[i]!;
    mdi[i] = (100 * am[i]!) / atr[i]!;
    dx[i] = (100 * Math.abs(pdi[i]! - mdi[i]!)) / (pdi[i]! + mdi[i]!);
  }
  const adx: number[] = [];
  let a = 0;
  for (let i = n - 1; i < 2 * n - 1; i++) a += dx[i]!;
  a /= n;
  adx[2 * n - 2] = a;
  for (let i = 2 * n - 1; i < tr.length; i++) adx[i] = a = (a * (n - 1) + dx[i]!) / n;
  // riallinea agli indici delle candele (tr[i] corrisponde alla candela i+1)
  return { atr: (i: number) => atr[i - 1], pdi: (i: number) => pdi[i - 1], mdi: (i: number) => mdi[i - 1], adx: (i: number) => adx[i - 1] };
}

describe("medie e range", () => {
  test("SMA calcolata a mano", () => {
    const s = sma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
    expect(Number.isNaN(s[1]!)).toBe(true);
    expect(s[2]).toBe(2);
    expect(s[9]).toBe(9);
  });
  test("ATR(3) calcolato a mano", () => {
    const d = dates(5);
    const bars = [bar(d[0]!, 9, 10, 8, 9), bar(d[1]!, 10, 11, 9, 10), bar(d[2]!, 10, 12, 9, 11), bar(d[3]!, 11, 11, 10, 10.5), bar(d[4]!, 11, 13, 10, 12)];
    expect(trueRange(bars).slice(1)).toEqual([2, 3, 1, 3]);
    const a = atrWilder(bars, 3);
    expect(a[3]).toBeCloseTo(2, 10);
    expect(a[4]).toBeCloseTo(7 / 3, 10);
  });
  test("Donchian e volume medio escludono la candela corrente", () => {
    const d = dates(4);
    const bars = [bar(d[0]!, 1, 5, 1, 2, 100), bar(d[1]!, 1, 6, 2, 3, 200), bar(d[2]!, 1, 4, 0.5, 3, 300), bar(d[3]!, 1, 99, 0.1, 50, 900)];
    expect(donchianPrev(bars, 3, 3)).toEqual({ alto: 6, basso: 0.5 });
    expect(volumeAvgPrev(bars, 3, 3)).toBe(200);
  });
  test("linea RS allineata per data", () => {
    const d = dates(3);
    const a = [bar(d[0]!, 1, 1, 1, 10), bar(d[1]!, 1, 1, 1, 12), bar(d[2]!, 1, 1, 1, 9)];
    const spy = [bar(d[0]!, 1, 1, 1, 100), bar(d[2]!, 1, 1, 1, 90)];
    const rs = rsLine(a, spy);
    expect(rs[0]).toBe(0.1);
    expect(Number.isNaN(rs[1]!)).toBe(true);
    expect(rs[2]).toBe(0.1);
  });
});

describe("ADX di Wilder", () => {
  test("serie sempre crescente: −DI = 0, +DI = 66,67, ADX = 100 (valori analitici)", () => {
    const bars = dates(60).map((t, i) => bar(t, i + 0.5, i + 1, i, i + 0.5));
    const { adx, pdi, mdi } = adxWilder(bars, 14);
    expect(mdi[59]).toBe(0);
    expect(pdi[59]).toBeCloseTo(100 / 1.5, 8);
    expect(adx[59]).toBeCloseTo(100, 8);
    expect(Number.isNaN(adx[26]!)).toBe(true);
    expect(adx[27]).toBeCloseTo(100, 8);
  });
  test("coincide con l'implementazione indipendente su una serie casuale", () => {
    const bars = randomBars(320);
    const ref = adxReference(bars, 14);
    const { adx, pdi, mdi } = adxWilder(bars, 14);
    const atr = atrWilder(bars, 14);
    for (const i of [27, 50, 150, 319]) {
      expect(adx[i]).toBeCloseTo(ref.adx(i)!, 8);
      expect(pdi[i]).toBeCloseTo(ref.pdi(i)!, 8);
      expect(mdi[i]).toBeCloseTo(ref.mdi(i)!, 8);
      expect(atr[i]).toBeCloseTo(ref.atr(i)!, 8);
    }
  });
});

describe("resistenze", () => {
  test("due massimi entro l'1,5% formano una resistenza; la rottura vale con +0,5%", () => {
    const d = dates(40);
    const hs = [90, 91, 92, 93, 100, 93, 92, 91, 92, 93, 100.8, 94, 93, 92, 93, 94, 95, 96, 97, 98];
    const bars: Bar[] = hs.map((h, i) => bar(d[i]!, h - 2, h, h - 3, h - 1));
    bars.push(bar(d[20]!, 99, 102, 98.5, 101.4));
    const res = resistenze(bars, 20, 120, 5, 1.5);
    expect(res.length).toBe(1);
    expect(res[0]!.livello).toBe(100.8);
    // soglia 100,8 × 1,005 = 101,304: la chiusura 101,4 la supera → rotta
    expect(rotturaResistenza(bars, 20, res, 0.5)?.livello).toBe(100.8);
    // con chiusura 101,2 (sotto la soglia) non è una rottura
    bars[20]!.c = 101.2;
    expect(rotturaResistenza(bars, 20, res, 0.5)).toBeNull();
  });
});

/** Serie con trend crescente e una rottura finale con volume. */
export function trendBars(n = 320, breakout = true, start = "2025-01-01"): Bar[] {
  const r = mulberry32(11);
  const out: Bar[] = [];
  let p = 50;
  const ds = dates(n, start);
  for (let i = 0; i < n - 1; i++) {
    const c = p * (1 + 0.003 + gaussian(r) * 0.004);
    const o = p;
    out.push(bar(ds[i]!, o, Math.max(o, c) * 1.004, Math.min(o, c) * 0.996, c, 1000));
    p = c;
  }
  if (breakout) {
    const hi = Math.max(...out.slice(-20).map((b) => b.h));
    const o = p;
    const c = hi * 1.03;
    out.push(bar(ds[n - 1]!, o, c * 1.001, o * 0.999, c, 3000));
  } else out.push(bar(ds[n - 1]!, p, p * 1.004, p * 0.996, p * 1.001, 1000));
  return out;
}
export const flatSpy = (bars: Bar[]) => bars.map((b) => bar(b.t, 100, 100, 100, 100));

describe("regole", () => {
  test("ingresso: trend, ADX, RS e conferme Donchian + volume", () => {
    const bars = trendBars();
    const s = calcolaSegnali("X", bars, flatSpy(bars), P0);
    expect(s.obbligatorie).toEqual({ trend: true, adx: true, rs: true });
    expect(s.conferme.donchian).toBe(true);
    expect(s.conferme.volume).toBe(true);
    expect(s.ingresso).toBe(true);
    expect(s.livelloRotto).not.toBeNull();
  });
  test("meno di 300 candele: nessun ingresso", () => {
    const bars = trendBars(250);
    expect(calcolaSegnali("X", bars, flatSpy(bars), P0).ingresso).toBe(false);
  });
  test("una conferma sola: non entra ma è \"quasi\"", () => {
    const bars = trendBars();
    const last = bars[bars.length - 1]!;
    last.v = 1000; // niente volume
    last.o = last.c * 0.999; // niente candela lunga
    const s = calcolaSegnali("X", bars, flatSpy(bars), { ...P0, confermeMin: 2 });
    expect(s.conferme.volume).toBe(false);
    expect(s.conferme.candela).toBe(false);
    expect(s.nConferme).toBe(s.conferme.resistenza ? 2 : 1);
    expect(s.ingresso).toBe(s.nConferme >= 2);
    expect(s.quasi).toBe(s.nConferme === 1);
  });
  test("uscita forte: chiusura sotto il minimo a 20 sedute con volume", () => {
    const bars = trendBars(320, false);
    const lo = Math.min(...bars.slice(-21, -1).map((b) => b.l));
    const last = bars[bars.length - 1]!;
    Object.assign(last, { o: last.o, c: lo * 0.97, l: lo * 0.96, v: 5000 });
    const s = calcolaSegnali("X", bars, flatSpy(bars), P0);
    expect(s.uscitaForte).toBe(true);
  });
  test("controllo del prezzo: gap oltre 1 ATR, sotto SMA50 o sotto il livello rotto → no (test 39)", () => {
    const bars = trendBars();
    const s = calcolaSegnali("X", bars, flatSpy(bars), P0);
    expect(controlloPrezzo(s, s.chiusura * 1.001, 1).ok).toBe(true);
    expect(controlloPrezzo(s, s.chiusura + 2 * s.atr!, 1).motivi.join()).toContain("ATR");
    expect(controlloPrezzo(s, s.livelloRotto! * 0.999, 5).motivi.join()).toContain("livello rotto");
    expect(controlloPrezzo(s, s.sma50! * 0.99, 50).motivi.join()).toContain("SMA50");
  });
});

describe("segnali della seduta e versione dei parametri", () => {
  test("parametri cambiati a metà giornata: i segnali si ricalcolano con la nuova versione", async () => {
    const { makeCtx } = await import("./ctx.ts");
    const { rmRoot } = await import("./helpers.ts");
    const { loadParams, saveParams } = await import("../src/params/params.ts");
    const { segnaliDellaSeduta } = await import("../src/signals/sessione.ts");
    const ctx = makeCtx({ now: "2026-11-23T15:00:00Z" });
    const cal = await ctx.broker.getCalendar("2025-01-01", "2026-12-31");
    const simboli = ctx.data.assets().slice(0, 5).map((a) => a.symbol);
    const P1 = loadParams(ctx.paths).params;
    const a = await segnaliDellaSeduta(ctx, P1, "2026-11-23", simboli, "r1", cal);
    expect(a.calcolati).toBe(true);
    expect(a.segnali.paramsVersione).toBe("v1");
    // stessa versione: si riusano
    expect((await segnaliDellaSeduta(ctx, P1, "2026-11-23", simboli, "r2", cal)).calcolati).toBe(false);
    const s = saveParams(ctx.paths, { "segnali.confermeMin": 1 }, { autore: "utente", versioneAttesa: 1 });
    expect(s.ok).toBe(true);
    const P2 = loadParams(ctx.paths).params;
    const b = await segnaliDellaSeduta(ctx, P2, "2026-11-23", simboli, "r3", cal);
    expect(b.calcolati).toBe(true);
    expect(b.segnali.paramsVersione).toBe("v2");
    for (const sym of Object.keys(b.segnali.titoli)) {
      const t = b.segnali.titoli[sym]!;
      if (t.candeleSufficienti && t.obbligatorie.trend && t.obbligatorie.adx && t.obbligatorie.rs) expect(t.ingresso).toBe(t.nConferme >= 1);
    }
    rmRoot(ctx.paths);
  });
  test("motivo ADX: dice quale condizione manca", () => {
    const bars: Bar[] = Array.from({ length: 320 }, (_, i) => ({ t: addDays("2025-06-01", i), o: 200 - i * 0.3, h: 201 - i * 0.3, l: 199 - i * 0.3, c: 200 - i * 0.3 - 0.2, v: 1000 }));
    const p = { candeleMin: 300, smaBreve: 20, smaMedia: 50, smaLunga: 200, atrPeriodo: 14, adxPeriodo: 14, adxMin: 20, confermeMin: 2, volumeMult: 1.5, donchianPeriodo: 20, volumeMediaPeriodo: 20, rsMediaPeriodo: 50, resistenzaFinestra: 120, resistenzaBarre: 5, resistenzaTolleranza: 1.5, rotturaMin: 0.5, candelaCorpoAtr: 1.5, candelaQuarto: 0.75, quasiAdx: 3 } as ParametriSegnali;
    const sg = calcolaSegnali("GIU", bars, bars, p);
    const m = sg.motivi.find((x) => x.startsWith("ADX"))!;
    expect(sg.adx!).toBeGreaterThan(20); // discesa regolare: ADX alto ma −DI sopra +DI
    expect(m).toContain("forte, ma +DI");
    expect(m).not.toContain("sotto 20");
  });
});
