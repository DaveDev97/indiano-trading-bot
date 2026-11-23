import { describe, expect, test } from "bun:test";
import { loadParams } from "../src/params/params.ts";
import { datiDa, valutaProfilo } from "../src/scan/profili.ts";
import { percentile } from "../src/scan/classifica.ts";
import { calcolaForza } from "../src/scan/forza-settori.ts";
import { costruisciWatchlist, runScan } from "../src/scan/scan.ts";
import { readJsonSafe } from "../src/util/atomic.ts";
import { makeCtx } from "./ctx.ts";
import { rmRoot, tempRoot } from "./helpers.ts";
import type { Watchlist } from "../src/scan/scan.ts";

const P = (() => {
  const p = tempRoot("scanp");
  const r = loadParams(p).params;
  rmRoot(p);
  return r;
})();

// valori nelle unità reali di Finnhub (verificate dalla sonda): percentuali come numeri, rapporti puri
const metricDiv = { currentDividendYieldTTM: 4.5, payoutRatioTTM: 60, quickRatioQuarterly: 0.9, roeTTM: 18, netProfitMarginTTM: 20, marketCapitalization: 50_000 };

describe("screener (test 21)", () => {
  test("payout 120% → escluso dal profilo dividendo", () => {
    const v = valutaProfilo("dividendo", datiDa({ metric: { ...metricDiv, payoutRatioTTM: 120 } }), "Industrials", P);
    expect(v.superato).toBe(false);
    expect(v.criteri.find((c) => c.id === "div.payout")!.esito).toBe("non superato");
    const ok = valutaProfilo("dividendo", datiDa({ metric: metricDiv }), "Industrials", P);
    expect(ok.superato).toBe(true);
  });
  test("debito/patrimonio ignorato per una banca", () => {
    const m = { epsGrowthTTMYoy: 10, revenueGrowthQuarterlyYoy: 25, epsGrowthQuarterlyYoy: 8, roeTTM: 18, roaTTM: 12, "totalDebt/totalEquityQuarterly": 3.3, peTTM: 12 };
    const banca = valutaProfilo("growth", { metric: m, peSerie: [11, 12, 13, 12, 12.5] }, "Financial", P);
    expect(banca.criteri.find((c) => c.id === "growth.debito")!.esito).toBe("non applicabile");
    expect(banca.criteri.find((c) => c.id === "growth.quick")!.esito).toBe("non applicabile");
    expect(banca.superato).toBe(true);
    const ind = valutaProfilo("growth", { metric: m, peSerie: [11, 12, 13, 12, 12.5] }, "Industrials", P);
    expect(ind.criteri.find((c) => c.id === "growth.debito")!.esito).toBe("non superato");
  });
  test("criterio mancante → \"non disponibile\", non conta", () => {
    const { margine: _, ...rest } = { margine: 1, ...metricDiv };
    const { netProfitMarginTTM: __, ...m } = metricDiv;
    const v = valutaProfilo("dividendo", datiDa({ metric: m }), "Industrials", P);
    expect(v.criteri.find((c) => c.id === "div.margine")!.esito).toBe("non disponibile");
    expect(v.valutabili).toBe(5);
    expect(v.superato).toBe(true); // 5 su 6 ≥ ceil(0,7 × 6) = 5
  });
  test("meno del 70% dei criteri valutabili → il profilo non passa", () => {
    const v = valutaProfilo("dividendo", datiDa({ metric: { currentDividendYieldTTM: 4.5, roeTTM: 18, marketCapitalization: 50_000 } }), "Industrials", P);
    expect(v.valutabili).toBe(3);
    expect(v.minimiValutabili).toBe(5);
    expect(v.superato).toBe(false);
  });
  test("value: le stime degli analisti sono sempre non disponibili; PEG storico se manca il PEG", () => {
    const m = { roeTTM: 20, netProfitMarginTTM: 25, revenueGrowth5Y: 8, epsGrowth5Y: 15, pfcfShareTTM: 20, peTTM: 18, quickRatioQuarterly: 1.4 };
    const v = valutaProfilo("value", datiDa({ metric: m }), "Technology", P);
    expect(v.criteri.find((c) => c.id === "value.epsProssimo")!.esito).toBe("non disponibile");
    const peg = v.criteri.find((c) => c.id === "value.peg")!;
    expect(peg.nota).toBe("PEG storico");
    expect(peg.valore).toBeCloseTo(1.2, 6);
    expect(v.superato).toBe(true);
  });
  test("P/E con utili negativi: banda non superata", () => {
    const v = valutaProfilo("growth", { metric: { peTTM: -5 }, peSerie: [20, 22, 21] }, "Technology", P);
    expect(v.criteri.find((c) => c.id === "growth.peBanda")!.esito).toBe("non superato");
  });
  test("zona grigia: un solo criterio mancato entro un passo", () => {
    const v = valutaProfilo("dividendo", datiDa({ metric: { ...metricDiv, roeTTM: 14 } }), "Industrials", P); // soglia 15, passo 1,5
    expect(v.superato).toBe(false);
    expect(v.zonaGrigia).toBe(true);
    const w = valutaProfilo("dividendo", datiDa({ metric: { ...metricDiv, roeTTM: 12 } }), "Industrials", P);
    expect(w.zonaGrigia).toBe(false);
  });
});

describe("classifica", () => {
  test("percentile con direzione", () => {
    expect(percentile(10, [1, 5, 10], "alto")).toBe(100);
    expect(percentile(10, [1, 5, 10], "basso")).toBe(0);
    expect(percentile(5, [5], "alto")).toBe(50);
  });
  test("nessun settore forte → zero acquistabili, dichiarato (test 20)", () => {
    const bars = (k: number) => Array.from({ length: 200 }, (_, i) => ({ t: `d${String(i).padStart(3, "0")}`, o: 1, h: 1, l: 1, c: 100 + i * k, v: 1 }));
    const forza = calcolaForza({ SPY: bars(1), XLK: bars(0.5), XLF: bars(0.2) }, 63);
    expect(forza.forti).toEqual([]);
    const wl = costruisciWatchlist([], forza, P, { data: "2026-11-21", generata: "", conteggi: { universo: 0, prefiltro: 0, conDati: 0, valutati: 0, profili: { growth: 0, value: 0, dividendo: 0 }, esclusi: {} }, industrieNonMappate: {} });
    expect(wl.acquistabili).toEqual([]);
    expect(wl.avvisi.join()).toContain("Nessun settore forte");
  });
});

describe("scansione completa con dati finti", () => {
  test("produce la watchlist e riparte dalla cache (test 23)", async () => {
    const ctx = makeCtx({ now: "2026-11-21T09:00:00Z" }); // sabato 10:00 Roma
    const r = await runScan(ctx);
    expect(r.ok).toBe(true);
    const wl = readJsonSafe<Watchlist>(ctx.paths.watchlist);
    expect(wl.ok).toBe(true);
    if (!wl.ok) return;
    expect(wl.value.conteggi.valutati).toBe(33);
    expect(wl.value.acquistabili.every((v) => wl.value.forza.forti.includes(v.settore))).toBe(true);
    expect(Object.keys(wl.value.criteriNonDisponibili).some((k) => k.includes("epsProssimo"))).toBe(true);
    const callsFirst = ctx.fund.calls.metric + ctx.fund.calls.profile;
    expect(callsFirst).toBeGreaterThan(0);
    // seconda scansione (come dopo un'interruzione): nessuna nuova richiesta a Finnhub
    const r2 = await runScan(ctx);
    expect(r2.ok).toBe(true);
    expect(ctx.fund.calls.metric + ctx.fund.calls.profile).toBe(callsFirst);
    rmRoot(ctx.paths);
  });
  test("scansione interrotta a metà: la ripresa chiede solo i titoli mancanti", async () => {
    const ctx = makeCtx({ now: "2026-11-21T09:00:00Z" });
    let n = 0;
    const orig = ctx.fund.getMetrics.bind(ctx.fund);
    ctx.fund.getMetrics = async (s: string) => {
      if (++n > 10) throw new Error("rete caduta");
      return orig(s);
    };
    await runScan(ctx);
    ctx.fund.getMetrics = orig;
    const before = ctx.fund.calls.metric;
    await runScan(ctx);
    expect(ctx.fund.calls.metric - before).toBe(33 - 10);
    rmRoot(ctx.paths);
  });
});
