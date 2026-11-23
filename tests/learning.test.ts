import { describe, expect, test } from "bun:test";
import { valutaProposte } from "../src/learning/proposte.ts";
import { bootstrapMedia, confidenzaBonferroni } from "../src/learning/bootstrap.ts";
import { decidiProposta, maybeRunReview, statoReview } from "../src/learning/review.ts";
import { leggiProposte, type Proposta } from "../src/learning/archivio.ts";
import { leggiPulsanti } from "../src/telegram/poller.ts";
import { loadParams } from "../src/params/params.ts";
import { paramSim } from "../src/journal/operazioni.ts";
import { simula } from "../src/journal/simulatore.ts";
import { PARAM_BY_KEY } from "../src/config/parametri.ts";
import { FakeTelegram } from "../src/telegram/client.ts";
import { FakeBrain } from "../src/brain/fake.ts";
import { mulberry32, gaussian } from "../src/data/fake.ts";
import { writeJsonAtomic } from "../src/util/atomic.ts";
import { appendJournal } from "../src/journal/journal.ts";
import { addDays } from "../src/util/time.ts";
import type { Scheda } from "../src/journal/schede.ts";
import type { CompactBar } from "../src/data/bars.ts";
import { makeCtx } from "./ctx.ts";
import { rmRoot, tempRoot } from "./helpers.ts";

const P = (() => {
  const p = tempRoot("lp");
  const r = loadParams(p).params;
  rmRoot(p);
  return r;
})();

function walk(rnd: () => number, start: string, n: number, p0: number, drift = 0): CompactBar[] {
  const out: CompactBar[] = [];
  let p = p0;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p * (1 + drift + gaussian(rnd) * 0.02);
    out.push([addDays(start, i), o, Math.max(o, c) * 1.01, Math.min(o, c) * 0.99, c, 1000]);
    p = c;
  }
  return out;
}

/** Scheda ombra sintetica con caratteristiche casuali. R imposto (rOverride) o simulato su un percorso casuale. */
function scheda(i: number, rnd: () => number, rOverride?: (adx: number) => number): Scheda {
  const data = addDays("2025-01-01", i);
  const adx = 17 + rnd() * 23;
  const nConf = 1 + Math.floor(rnd() * 3);
  const storia = walk(rnd, addDays(data, -40), 40, 50);
  const percorso = walk(rnd, data, 80, storia.at(-1)![4]);
  const ingresso = percorso[0]![1];
  const sim = (m: "bracket" | "trailing") => simula(m, [], percorso.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })), ingresso, ingresso * 0.1, paramSim(P));
  const br = sim("bracket"), tr = sim("trailing");
  if (rOverride) {
    br.R = rOverride(adx) + gaussian(rnd) * 0.5;
    br.stato = "chiusa";
  }
  return {
    tradeId: `S-${i}`, reale: false, prezzoIngresso: ingresso, dataIngresso: data, quantitaEseguita: null, uscita: null, annullata: null, nonEntrata: null,
    candeleDopo: percorso, simulazione: { bracket: br, trailing: tr, inCorso: false }, trimestrale: false, manuale: false, eventi: [], stato: "chiusa",
    ingresso: {
      tradeId: `S-${i}`, simbolo: `X${i}`, runId: "r", dataSegnale: addDays(data, -1), seduta: data, profilo: "growth", settore: "Technology",
      forzaSettore: { periodo: 63, rendimenti: { 21: gaussian(rnd) * 0.05, 63: gaussian(rnd) * 0.05, 126: gaussian(rnd) * 0.05 }, spy: { 21: 0, 63: 0, 126: 0 }, forte: true },
      criteri: [{ id: "growth.roe", nome: "ROE", valore: 10 + rnd() * 20, valoreClassifica: null, soglia: "> 15", esito: "superato", campo: "roeTTM", passiDallaSoglia: 0 }],
      segnale: { adx, pdi: 30, mdi: 10, nConferme: nConf, conferme: { donchian: nConf >= 1, volume: nConf >= 2, resistenza: false, candela: nConf >= 3 }, rapportoVolume: 1 + rnd() * 1.5 } as any,
      punteggio: 50, posizioneClassifica: 1, motivazione: null, paramsVersione: "v1", prezzo: null, quantita: null, piano: null, modalita: "bracket",
      stopPct: 10, tpPct: 20, trailPct: 10, candele: storia, candeleSplit: storia, ordineId: null, categoria: "quasi",
    },
  };
}

describe("bootstrap", () => {
  test("intervallo della media e correzione di Bonferroni", () => {
    const x = Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : 0));
    const [lo, hi] = bootstrapMedia(x, 0.9, 2000, 1);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
    expect(confidenzaBonferroni(0.9, 10)).toBeCloseTo(0.99, 10);
  });
});

describe("proposte (test 27)", () => {
  test("dati casuali senza vantaggio: nessuna proposta nella grande maggioranza dei casi", () => {
    let conProposte = 0;
    const prove = 40;
    for (let k = 0; k < prove; k++) {
      const rnd = mulberry32(1000 + k);
      const schede = Array.from({ length: 250 }, (_, i) => scheda(i, rnd));
      const ev = valutaProposte(schede, P, { realiChiuse: 100, paramSim: paramSim(P), seed: k });
      if (ev.candidate.length) conProposte++;
      expect(ev.candidate.length).toBeLessThanOrEqual(2);
    }
    expect(conProposte / prove).toBeLessThanOrEqual(0.1);
  }, 120_000);
  test("con un vantaggio reale e robusto la proposta arriva, di un passo solo", () => {
    const rnd = mulberry32(7);
    // le operazioni con ADX sotto 22 perdono, le altre guadagnano poco: alzare l'ADX minimo di un passo aiuta
    const schede = Array.from({ length: 600 }, (_, i) => scheda(i, rnd, (adx) => (adx < 22 ? -1 : 0.1)));
    const ev = valutaProposte(schede, P, { realiChiuse: 100, paramSim: paramSim(P), seed: 3 });
    const adx = ev.candidate.find((c) => c.chiave === "segnali.adxMin");
    expect(adx).toBeDefined();
    expect(adx!.a).toBe(22);
    for (const c of ev.candidate) {
      const def = PARAM_BY_KEY.get(c.chiave)!;
      if (typeof c.da === "number") expect(Math.abs((c.a as number) - c.da)).toBeCloseTo(def.passo!, 6);
      expect(c.effettoR!).toBeGreaterThanOrEqual(0.1);
      expect(c.icPrimi![0]).toBeGreaterThan(0);
      expect(c.icUltimi![0]).toBeGreaterThan(0);
    }
    expect(ev.candidate.length).toBeLessThanOrEqual(2);
  }, 60_000);
  test("campione piccolo: nessuna proposta anche con un vantaggio", () => {
    const rnd = mulberry32(7);
    const schede = Array.from({ length: 600 }, (_, i) => scheda(i, rnd, (adx) => (adx < 22 ? -1 : 0.1)));
    const ev = valutaProposte(schede, P, { realiChiuse: 29, paramSim: paramSim(P), seed: 3 });
    expect(ev.campionePiccolo).toBe(true);
    expect(ev.candidate).toEqual([]);
  });
  test("i parametri di sicurezza non si propongono mai, e lo dice", () => {
    const rnd = mulberry32(9);
    const ev = valutaProposte(Array.from({ length: 50 }, (_, i) => scheda(i, rnd)), P, { realiChiuse: 100, paramSim: paramSim(P) });
    expect(ev.candidate.some((c) => PARAM_BY_KEY.get(c.chiave)!.categoria === "sicurezza")).toBe(false);
    expect(ev.nonValutati.some((x) => x.includes("sicurezza"))).toBe(true);
  });
});

describe("quando fare la review (test 26)", () => {
  test("non prima di 20 sedute; a 40 anche con poche operazioni; sotto 30 operazioni solo resoconto", async () => {
    const brain = new FakeBrain();
    const ctx = makeCtx({ now: "2026-11-21T10:00:00Z", brain });
    writeJsonAtomic(ctx.paths.freno, { avvio: "2026-10-26", ultimoSblocco: null, attivo: false, scattatoIl: null });
    expect((await statoReview(ctx, P)).dovuta).toBe(false); // 19 sedute
    expect((await maybeRunReview(ctx, { force: false })).eseguita).toBe(false);
    writeJsonAtomic(ctx.paths.freno, { avvio: "2026-09-20", ultimoSblocco: null, attivo: false, scattatoIl: null });
    const r = await maybeRunReview(ctx, { force: false });
    expect(r.eseguita).toBe(true);
    expect(r.review!.campionePiccolo).toBe(true);
    expect(r.review!.proposte).toEqual([]);
    expect(r.review!.testo).toContain("Campione piccolo");
    rmRoot(ctx.paths);
  });
});

function proposta(id: string, over: Partial<Proposta> = {}): Proposta {
  return { id, reviewId: "r-1", chiave: "segnali.adxMin", da: 20, a: 22, direzione: "su", effettoR: 0.3, n: 40, ic: { primi: [0.1, 0.5], ultimi: [0.1, 0.4] }, descrizione: "ADX", stato: "in attesa", creata: "2026-11-21T10:00:00Z", scade: "2026-11-28T10:00:00Z", decisa: null, decisaDa: null, versioneCreata: null, ...over };
}

describe("conferma delle proposte (test 28, 41)", () => {
  test("pulsante da un'altra chat → ignorato; approvazione → nuova versione; doppia approvazione → un solo effetto", async () => {
    const tg = new FakeTelegram();
    const ctx = makeCtx({ now: "2026-11-22T10:00:00Z", tg });
    loadParams(ctx.paths);
    writeJsonAtomic(ctx.paths.proposte, [proposta("r-1-p1")]);
    tg.queue = [{ updateId: 5, callback: { id: "c1", data: "rv:a:r-1-p1", chatId: "999", messageId: 1, from: "999" } }];
    const a = await leggiPulsanti(ctx);
    expect(a.ignorati).toBe(1);
    expect(leggiProposte(ctx.paths)[0]!.stato).toBe("in attesa");
    tg.queue = [{ updateId: 6, callback: { id: "c2", data: "rv:a:r-1-p1", chatId: "42", messageId: 1, from: "42" } }];
    await leggiPulsanti(ctx);
    expect(leggiProposte(ctx.paths)[0]!.stato).toBe("approvata");
    const P2 = loadParams(ctx.paths).params;
    expect(P2.versione).toBe("v2");
    expect(P2.n("segnali.adxMin")).toBe(22);
    // la stessa approvazione dalla dashboard: nessun effetto
    const d = decidiProposta(ctx, "r-1-p1", true, "dashboard");
    expect(d.ok).toBe(false);
    expect(loadParams(ctx.paths).params.versione).toBe("v2");
    // l'offset avanza: il clic non si rilegge
    tg.queue = [{ updateId: 6, callback: { id: "c2", data: "rv:a:r-1-p1", chatId: "42", messageId: 1, from: "42" } }];
    expect((await leggiPulsanti(ctx)).letti).toBe(0);
    rmRoot(ctx.paths);
  });
  test("proposta scaduta dopo 7 giorni; sicurezza nella direzione meno prudente rifiutata dal codice", () => {
    const ctx = makeCtx({ now: "2026-12-01T10:00:00Z" });
    loadParams(ctx.paths);
    writeJsonAtomic(ctx.paths.proposte, [proposta("p-old"), proposta("p-sic", { chiave: "rischio.peso", da: 0.15, a: 0.2, scade: "2026-12-30T00:00:00Z" })]);
    expect(decidiProposta(ctx, "p-old", true, "dashboard").messaggio).toContain("scaduta");
    expect(decidiProposta(ctx, "p-sic", true, "dashboard").messaggio).toContain("meno prudente");
    expect(loadParams(ctx.paths).params.versione).toBe("v1");
    rmRoot(ctx.paths);
  });
});
