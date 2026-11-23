import { describe, expect, test } from "bun:test";
import { FakeBroker } from "../src/broker/fake.ts";
import { orderBody, parseOrder, AlpacaBroker } from "../src/broker/alpaca.ts";
import { flattenOrders, isOpenStatus } from "../src/broker/types.ts";
import { paperSafetyProblems, assertPaperSafety, type Secrets } from "../src/config/segreti.ts";
import { closedBars } from "../src/data/bars.ts";
import { fakeCalendar } from "../src/data/calendario-finto.ts";
import { FakeMarket } from "../src/data/fake.ts";
import { RateLimiter } from "../src/util/ratelimit.ts";
import { httpJson, HttpError } from "../src/util/http.ts";
import { _resetSecretsForTest, registerSecret } from "../src/util/redact.ts";

const OPEN = new Date("2026-11-23T15:00:00Z"); // lunedì, 10:00 NY
const CLOSED = new Date("2026-11-23T03:00:00Z");

function mkSecrets(over: Partial<Secrets["alpaca"]> = {}): Secrets {
  return { alpaca: { keyId: "PKTEST123456", secretKey: "s".repeat(20), ...over }, telegram: { botToken: "", chatId: "" }, finnhub: { apiKey: "" }, dashboard: { password: "" }, claude: { oauthToken: "" } };
}

describe("sicurezza paper (test 10)", () => {
  test("chiave AK → il programma non parte", () => {
    expect(() => assertPaperSafety(mkSecrets({ keyId: "AKLIVE123456" }), {})).toThrow(/LIVE/);
  });
  test("URL live in secrets.ts o nell'ambiente → non parte", () => {
    expect(paperSafetyProblems(mkSecrets({ baseUrl: "https://api.alpaca.markets" }), {}).length).toBeGreaterThan(0);
    expect(paperSafetyProblems(mkSecrets(), { APCA_API_BASE_URL: "https://api.alpaca.markets" }).length).toBeGreaterThan(0);
    expect(paperSafetyProblems(mkSecrets(), { QUALCOSA: "https://api.alpaca.markets/v2" }).length).toBeGreaterThan(0);
  });
  test("configurazione paper → nessun problema", () => {
    expect(paperSafetyProblems(mkSecrets(), { APCA_API_BASE_URL: "https://paper-api.alpaca.markets" })).toEqual([]);
  });
  test("AlpacaBroker rifiuta una chiave live anche se costruito direttamente", () => {
    expect(() => new AlpacaBroker("AKXXXX", "y")).toThrow();
  });
});

describe("Alpaca: conversioni", () => {
  test("parseOrder converte numeri e gambe", () => {
    const o = parseOrder({ id: "1", client_order_id: "c", symbol: "X", side: "buy", type: "market", qty: "3", filled_qty: "0", status: "new", order_class: "bracket", time_in_force: "gtc", created_at: "2026-01-01T00:00:00Z", legs: [{ id: "2", side: "sell", type: "stop", stop_price: "9.5", qty: "3", filled_qty: "0", status: "held" }] });
    expect(o.qty).toBe(3);
    expect(o.legs[0]!.stopPrice).toBe(9.5);
    expect(flattenOrders([o]).map((x) => x.id)).toEqual(["1", "2"]);
    expect(flattenOrders([o])[1]!.parentId).toBe("1");
  });
  test("orderBody: prezzi con 2 decimali sopra 1 $ e 4 sotto", () => {
    const b = orderBody({ clientOrderId: "x", symbol: "X", side: "buy", type: "market", qty: 1, tif: "gtc", orderClass: "bracket", takeProfit: { limitPrice: 12 }, stopLoss: { stopPrice: 0.5 } });
    expect(b.take_profit).toEqual({ limit_price: "12.00" });
    expect(b.stop_loss).toEqual({ stop_price: "0.5000" });
  });
  test("stati aperti", () => {
    for (const s of ["new", "partially_filled", "accepted", "pending_new", "held", "pending_cancel", "pending_replace", "done_for_day"]) expect(isOpenStatus(s)).toBe(true);
    for (const s of ["filled", "canceled", "expired", "replaced", "rejected"]) expect(isOpenStatus(s)).toBe(false);
  });
});

describe("broker finto", () => {
  test("bracket: acquisto eseguito, gambe attive, stop eseguito cancella il take profit", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    await b.submitOrder({ clientOrderId: "b1", symbol: "ABC", side: "buy", type: "market", qty: 10, tif: "gtc", orderClass: "bracket", takeProfit: { limitPrice: 120 }, stopLoss: { stopPrice: 90 } });
    expect((await b.getPositions())[0]!.qty).toBe(10);
    const open = flattenOrders(await b.listOrders({ status: "open" }));
    expect(open.filter((o) => o.side === "sell").map((o) => o.status).sort()).toEqual(["held", "new"]);
    b.setPrice("ABC", 89);
    expect(await b.getPositions()).toEqual([]);
    expect(b.openOrders("ABC")).toEqual([]);
  });
  test("id duplicato → 422; vendita con protezioni aperte → 403", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    const r = { clientOrderId: "b1", symbol: "ABC", side: "buy" as const, type: "market" as const, qty: 10, tif: "gtc" as const, orderClass: "bracket" as const, takeProfit: { limitPrice: 120 }, stopLoss: { stopPrice: 90 } };
    await b.submitOrder(r);
    await expect(b.submitOrder(r)).rejects.toMatchObject({ status: 422 });
    await expect(b.submitOrder({ clientOrderId: "s1", symbol: "ABC", side: "sell", type: "market", qty: 10, tif: "day" })).rejects.toMatchObject({ status: 403 });
  });
  test("prezzi sotto il centesimo rifiutati, non arrotondati", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    await expect(b.submitOrder({ clientOrderId: "b1", symbol: "ABC", side: "buy", type: "market", qty: 1, tif: "gtc", orderClass: "bracket", takeProfit: { limitPrice: 120.005 }, stopLoss: { stopPrice: 90 } })).rejects.toMatchObject({ status: 422 });
  });
  test("trailing stop: segue il massimo e scatta", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.seedPosition("ABC", 5, 100);
    await b.submitOrder({ clientOrderId: "t1", symbol: "ABC", side: "sell", type: "trailing_stop", qty: 5, tif: "gtc", trailPercent: 10 });
    b.setPrice("ABC", 120);
    b.setPrice("ABC", 109);
    expect((await b.getPositions()).length).toBe(1);
    b.setPrice("ABC", 107.9);
    expect(await b.getPositions()).toEqual([]);
  });
  test("a mercato chiuso un acquisto resta in coda", async () => {
    const b = new FakeBroker({ now: () => CLOSED });
    b.state.prices.ABC = 50;
    const o = await b.submitOrder({ clientOrderId: "m1", symbol: "ABC", side: "buy", type: "market", qty: 1, tif: "day" });
    expect(o.status).toBe("accepted");
    expect(await b.getPositions()).toEqual([]);
  });
  test("conto paper nuovo: short e margine attivi finché non si correggono", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    expect((await b.getAccountConfig()).noShorting).toBe(false);
    await b.patchAccountConfig({ noShorting: true, maxMarginMultiplier: "1" });
    expect(await b.getAccountConfig()).toEqual({ noShorting: true, maxMarginMultiplier: "1" });
  });
  test("persistenza su file", async () => {
    const f = `${require("node:os").tmpdir()}/fake-broker-${Date.now()}.json`;
    const b = new FakeBroker({ now: () => OPEN, file: f });
    b.seedPosition("ABC", 3, 10);
    const b2 = new FakeBroker({ now: () => OPEN, file: f });
    expect((await b2.getPositions())[0]!.qty).toBe(3);
    b2.wipeFile();
  });
});

describe("candele", () => {
  test("la candela della seduta in corso non si usa mai (test 37)", async () => {
    const m = new FakeMarket(() => OPEN);
    const r = await m.getDailyBars(["SPY"], { start: "2026-11-01", end: OPEN, adjustment: "all" });
    const bars = r.SPY!;
    expect(bars.at(-1)!.t).toBe("2026-11-23"); // il finto restituisce la candela parziale…
    const cal = fakeCalendar("2026-11-01", "2026-11-30");
    const closed = closedBars(bars, OPEN, cal);
    expect(closed.at(-1)!.t).toBe("2026-11-20"); // …che closedBars scarta
    // a 10 minuti dalla chiusura: ancora scartata (ritardo SIP di 16 minuti)
    const justClosed = new Date("2026-11-23T21:10:00Z");
    expect(closedBars(bars, justClosed, cal).at(-1)!.t).toBe("2026-11-20");
    expect(closedBars(bars, new Date("2026-11-23T21:17:00Z"), cal).at(-1)!.t).toBe("2026-11-23");
  });
  test("calendario finto: weekend, festivi, mezze giornate", () => {
    const c = fakeCalendar("2026-11-23", "2026-11-30");
    expect(c.map((d) => d.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27", "2026-11-30"]);
    expect(c.find((d) => d.date === "2026-11-27")!.close).toBe("13:00");
  });
});

describe("rete", () => {
  test("limitatore: non supera il limite al minuto", async () => {
    let t = 0;
    const waits: number[] = [];
    const rl = new RateLimiter([{ max: 3, windowMs: 1000 }], () => t, async (ms) => { waits.push(ms); t += ms; });
    for (let i = 0; i < 7; i++) await rl.take();
    expect(waits.length).toBeGreaterThanOrEqual(2);
    expect(t).toBeGreaterThanOrEqual(2000);
  });
  test("errore di rete su URL di Telegram: il token non compare (test 11)", async () => {
    _resetSecretsForTest();
    const token = "123456789:AAH_segretissimo_abcdefghijklmnopqrstuv";
    registerSecret(token);
    const failing = async () => { throw new TypeError(`fetch failed for https://api.telegram.org/bot${token}/sendMessage`); };
    try {
      await httpJson(failing as any, `https://api.telegram.org/bot${token}/sendMessage`);
      throw new Error("doveva fallire");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect(String((e as Error).message)).not.toContain("segretissimo");
    }
  });
});

import { variazioneDaChiusura } from "../src/data/types.ts";
describe("variazione di oggi (prova reale del 23/11/2026)", () => {
  test("prima dell'apertura il riferimento è l'ultima chiusura, non la seduta prima", () => {
    // lunedì mattina: candela del giorno = venerdì 690,68, precedente = giovedì 715,84, ultimo scambio 693,89
    const s = { price: 693.89, time: "", dailyOpen: null, prevClose: 715.84, dailyDate: "2026-11-20", dailyClose: 690.68 };
    expect(variazioneDaChiusura(s, "2026-11-23")!).toBeCloseTo(693.89 / 690.68 - 1, 10);
    // a seduta aperta la candela del giorno è di oggi: riferimento = chiusura precedente
    expect(variazioneDaChiusura({ ...s, dailyDate: "2026-11-23", prevClose: 690.68 }, "2026-11-23")!).toBeCloseTo(693.89 / 690.68 - 1, 10);
  });
});
