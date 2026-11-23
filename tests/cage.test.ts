import { describe, expect, test } from "bun:test";
import { arrotondaGiu, arrotondaSu, livelliBracket } from "../src/cage/prezzi.ts";
import { CassaSveglia, quantita } from "../src/cage/dimensionamento.ts";
import { applicaGabbia, type StatoGabbia } from "../src/cage/gabbia.ts";
import { pauseDaRifiuti, pauseDaUscite, usciteRecenti } from "../src/cage/pause.ts";
import { sbloccaFreno, valutaFreno } from "../src/cage/freno.ts";
import { fakeCalendar } from "../src/data/calendario-finto.ts";
import { FakeBroker } from "../src/broker/fake.ts";
import { rmRoot, tempRoot } from "./helpers.ts";

describe("prezzi (test 38)", () => {
  test("stop per difetto, take profit per eccesso, 2 decimali sopra 1 $ e 4 sotto", () => {
    expect(arrotondaGiu(90.129)).toBe(90.12);
    expect(arrotondaSu(120.121)).toBe(120.13);
    expect(arrotondaSu(120.12)).toBe(120.12);
    expect(arrotondaGiu(0.98765)).toBe(0.9876);
    expect(arrotondaGiu(1.004)).toBe(1);
    const l = livelliBracket(100.33, 10, 20);
    expect(l).toEqual({ stop: 90.29, takeProfit: 120.4 });
  });
  test("stop non almeno 0,01 $ sotto il prezzo: errore", () => {
    expect("errore" in livelliBracket(0.005, 0.1, 20)).toBe(true);
  });
});

describe("dimensionamento (test 34)", () => {
  test("peso 20% del patrimonio, limitato dal cash", () => {
    expect(quantita(50, 100_000, 100_000, 0.2, 0.99)).toBe(400);
    expect(quantita(50, 100_000, 10_000, 0.2, 0.99)).toBe(198);
    expect(quantita(500, 1_000, 1_000, 0.2, 0.99)).toBe(0);
  });
  test("due acquisti nella stessa sveglia: il secondo usa il cash meno il primo; mai sotto zero", () => {
    const cassa = new CassaSveglia(25_000, 0);
    const q1 = quantita(100, 100_000, cassa.disponibile, 0.2, 0.99);
    expect(q1).toBe(200);
    cassa.impegna(q1 * 100);
    const q2 = quantita(100, 100_000, cassa.disponibile, 0.2, 0.99);
    expect(q2).toBe(49);
    cassa.impegna(q2 * 100);
    cassa.impegna(1_000_000);
    expect(cassa.disponibile).toBe(0);
  });
});

const baseStato = (over: Partial<StatoGabbia> = {}): StatoGabbia => ({
  tipo: "apertura",
  mercatoAperto: true,
  candidati: new Map([["AAA", { settore: "Technology" }], ["BBB", { settore: "Technology" }], ["CCC", { settore: "Energy" }]]),
  posizioni: new Map(),
  acquistiAperti: new Map(),
  usciteDeboli: new Set(),
  maxPosizioni: 5,
  maxPerSettore: 2,
  bloccoAcquisti: null,
  postoLiberatoOggi: false,
  ...over,
});
const compra = (s: string) => ({ simbolo: s, azione: "compra" as const, perche: "" });

describe("gabbia (test 13)", () => {
  test("simbolo fuori dai candidati → rifiutato", () => {
    const r = applicaGabbia([compra("ZZZ")], baseStato());
    expect(r.acquisti).toEqual([]);
    expect(r.rifiuti[0]!.codice).toBe("fuori-candidati");
  });
  test("6ª posizione → rifiutata", () => {
    const pos = new Map([["P1", "Energy"], ["P2", "Utilities"], ["P3", "Financial"], ["P4", "Healthcare"]] as const);
    const r = applicaGabbia([compra("CCC"), compra("AAA")], baseStato({ posizioni: new Map(pos) }));
    expect(r.acquisti.map((a) => a.simbolo)).toEqual(["CCC"]);
    expect(r.rifiuti[0]!.codice).toBe("posti-esauriti");
  });
  test("3ª nello stesso settore → rifiutata (anche contando un acquisto aperto)", () => {
    const r = applicaGabbia([compra("AAA"), compra("BBB")], baseStato({ acquistiAperti: new Map([["XXX", "Technology"]]) }));
    expect(r.acquisti.map((a) => a.simbolo)).toEqual(["AAA"]);
    expect(r.rifiuti[0]!.codice).toBe("limite-settore");
  });
  test("briefing e chiusura non comprano; metà seduta solo se si è liberato un posto", () => {
    expect(applicaGabbia([compra("AAA")], baseStato({ tipo: "briefing" })).acquisti).toEqual([]);
    expect(applicaGabbia([compra("AAA")], baseStato({ tipo: "chiusura" })).acquisti).toEqual([]);
    expect(applicaGabbia([compra("AAA")], baseStato({ tipo: "meta" })).rifiuti[0]!.codice).toBe("meta-senza-posto-liberato");
    expect(applicaGabbia([compra("AAA")], baseStato({ tipo: "meta", postoLiberatoOggi: true })).acquisti.length).toBe(1);
  });
  test("cervello fallito o freno → nessun acquisto", () => {
    const r = applicaGabbia([compra("AAA")], baseStato({ bloccoAcquisti: "cervello non disponibile" }));
    expect(r.acquisti).toEqual([]);
  });
  test("vendite: solo in portafoglio, solo uscite deboli segnalate, solo all'apertura; decisioni doppie una volta", () => {
    const st = baseStato({ posizioni: new Map([["AAA", "Technology"], ["BBB", "Technology"]]), usciteDeboli: new Set(["AAA"]) });
    const v = (s: string) => ({ simbolo: s, azione: "vendi" as const, perche: "" });
    const r = applicaGabbia([v("AAA"), v("AAA"), v("BBB"), v("ZZZ")], st);
    expect(r.vendite.map((x) => x.simbolo)).toEqual(["AAA"]);
    expect(r.rifiuti.map((x) => x.codice).sort()).toEqual(["duplicata", "nessun-segnale-uscita", "non-in-portafoglio"]);
  });
});

describe("pause (test 16)", () => {
  test("stop in perdita → 10 sedute di pausa, ricostruite dagli ordini chiusi di Alpaca", async () => {
    let now = new Date("2026-11-02T15:00:00Z");
    const b = new FakeBroker({ now: () => now });
    b.state.prices.ABC = 100;
    await b.submitOrder({ clientOrderId: "b", symbol: "ABC", side: "buy", type: "market", qty: 10, tif: "gtc", orderClass: "bracket", takeProfit: { limitPrice: 120 }, stopLoss: { stopPrice: 90 } });
    now = new Date("2026-11-04T15:00:00Z");
    b.setPrice("ABC", 89);
    const cal = fakeCalendar("2026-10-01", "2026-12-31");
    const u = await usciteRecenti(b, new Date("2026-11-10T15:00:00Z"));
    expect(u[0]!.inPerdita).toBe(true);
    const p = pauseDaUscite(u, cal, "2026-11-10", 10, 3);
    expect(p[0]!.simbolo).toBe("ABC");
    expect(p[0]!.finoA).toBe("2026-11-18"); // 10 sedute dopo il 4/11 (il 26/11 è festa ma non serve qui)
    expect(pauseDaUscite(u, cal, "2026-11-18", 10, 3).length).toBe(1);
    expect(pauseDaUscite(u, cal, "2026-11-19", 10, 3).length).toBe(0);
  });
  test("rifiuti: stessa seduta bloccata; 2 rifiuti per lo stesso motivo → 5 sedute", () => {
    const cal = fakeCalendar("2026-10-01", "2026-12-31");
    const ev = (seduta: string) => ({ ts: `${seduta}T15:00:00Z`, tipo: "rifiuto" as const, simbolo: "ABC", azione: "compra", codice: "broker-422", motivo: "rifiutato", seduta });
    expect(pauseDaRifiuti([ev("2026-11-10")], cal, "2026-11-10", 2, 5)[0]!.motivo).toContain("oggi");
    expect(pauseDaRifiuti([ev("2026-11-10")], cal, "2026-11-11", 2, 5)).toEqual([]);
    const two = [ev("2026-11-09"), ev("2026-11-10")];
    expect(pauseDaRifiuti(two, cal, "2026-11-17", 2, 5).length).toBe(1);
    expect(pauseDaRifiuti(two, cal, "2026-11-18", 2, 5).length).toBe(0);
    // rifiuti strutturali della gabbia: nessuna pausa
    expect(pauseDaRifiuti([{ ...ev("2026-11-10"), codice: "gabbia-sveglia-senza-ingressi" }], cal, "2026-11-10", 2, 5)).toEqual([]);
  });
});

describe("freno d'emergenza (test 18)", () => {
  test("sotto l'85% del massimo scatta e resta attivo; lo sblocco riporta il massimo al patrimonio attuale", async () => {
    const paths = tempRoot("freno");
    let now = new Date("2026-11-02T20:00:00Z");
    const b = new FakeBroker({ now: () => now, initialCash: 100_000 });
    await b.getAccount();
    let v = await valutaFreno(paths, b, 100_000, 0.85, now);
    expect(v.attivo).toBe(false);
    now = new Date("2026-11-03T20:00:00Z");
    b.state.cash = 80_000;
    await b.getAccount();
    v = await valutaFreno(paths, b, 80_000, 0.85, now);
    expect(v.attivo).toBe(true);
    expect(v.appenaScattato).toBe(true);
    // anche se il patrimonio risale un po', resta attivo finché non si sblocca dalla dashboard
    b.state.cash = 86_000;
    now = new Date("2026-11-04T20:00:00Z");
    await b.getAccount();
    expect((await valutaFreno(paths, b, 86_000, 0.85, now)).attivo).toBe(true);
    now = new Date("2026-11-04T20:30:00Z");
    sbloccaFreno(paths, 86_000, now);
    v = await valutaFreno(paths, b, 86_000, 0.85, now);
    expect(v.attivo).toBe(false);
    expect(v.massimo).toBe(86_000);
    rmRoot(paths);
  });
});
