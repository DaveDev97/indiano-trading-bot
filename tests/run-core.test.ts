import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { loadParams } from "../src/params/params.ts";
import { situazione, slotsDelGiorno } from "../src/run/calendario.ts";
import { fakeCalendar } from "../src/data/calendario-finto.ts";
import { acquireLock, readLock } from "../src/run/lock.ts";
import { Esecutore } from "../src/run/esecutore.ts";
import { controllaProtezioni, type ContestoProtezioni } from "../src/run/protezioni.ts";
import type { PianoUscita } from "../src/run/piani.ts";
import { FakeBroker } from "../src/broker/fake.ts";
import { flattenOrders } from "../src/broker/types.ts";
import { memoryLogger } from "../src/util/log.ts";
import { leggiTestimone, scriviTestimone, type Testimone } from "../src/run/baton.ts";
import { aliveProbe } from "./ctx.ts";
import { rmRoot, tempRoot } from "./helpers.ts";

const P = (() => {
  const p = tempRoot("rcp");
  const r = loadParams(p).params;
  rmRoot(p);
  return r;
})();

describe("calendario delle sveglie", () => {
  test("16 marzo 2026 (ora legale disallineata): apertura alle 14:40 Roma (test 6)", () => {
    const s = slotsDelGiorno(fakeCalendar("2026-03-16", "2026-03-16")[0]!, P);
    expect(s.map((x) => `${x.tipo} ${x.id}`)).toEqual(["briefing 2026-03-16-0930", "apertura 2026-03-16-1440", "meta 2026-03-16-1730", "chiusura 2026-03-16-2030"]);
  });
  test("giorno normale: 09:30, 15:40, 18:30, 21:30", () => {
    const s = slotsDelGiorno(fakeCalendar("2026-09-24", "2026-09-24")[0]!, P);
    expect(s.map((x) => x.id)).toEqual(["2026-09-24-0930", "2026-09-24-1540", "2026-09-24-1830", "2026-09-24-2130"]);
  });
  test("mezza giornata: una sola sveglia tra metà seduta e chiusura (test 5)", () => {
    const s = slotsDelGiorno(fakeCalendar("2026-11-27", "2026-11-27")[0]!, P);
    expect(s.map((x) => x.tipo)).toEqual(["briefing", "apertura", "chiusura"]);
  });
  test("weekend e festivi non risultano saltati (test 5)", () => {
    const cal = fakeCalendar("2026-11-20", "2026-11-30");
    // ultima sveglia eseguita: chiusura di mercoledì 25; ora è lunedì 30 alle 09:35 Roma (giovedì 26 è festa)
    const done = new Set(["2026-11-25-2130", "2026-11-27-0930", "2026-11-27-1540", "2026-11-27-1830"]);
    const st = situazione(cal, P, new Date("2026-11-30T08:35:00Z"), new Set([...done, ...["2026-11-27-1830"]]), new Date("2026-11-27T17:30:00Z"));
    expect(st.saltate).toEqual([]);
    expect(st.dovuta?.id).toBe("2026-11-30-0930");
  });
  test("testimone delle 09:30 e poi niente fino alle 21:40: apertura e metà seduta saltate (test 4)", () => {
    const cal = fakeCalendar("2026-11-23", "2026-11-24");
    const st = situazione(cal, P, new Date("2026-11-23T20:40:00Z"), new Set(["2026-11-23-0930"]), new Date("2026-11-23T08:30:00Z"));
    expect(st.dovuta?.tipo).toBe("chiusura");
    expect(st.saltate.map((s) => s.tipo)).toEqual(["apertura", "meta"]);
  });
  test("oltre 20 minuti: la sveglia non è più dovuta", () => {
    const cal = fakeCalendar("2026-11-23", "2026-11-23");
    expect(situazione(cal, P, new Date("2026-11-23T08:49:00Z"), new Set(), null).dovuta?.tipo).toBe("briefing");
    expect(situazione(cal, P, new Date("2026-11-23T08:51:00Z"), new Set(), null).dovuta).toBeNull();
  });
});

describe("lock (test 2, 36)", () => {
  test("due processi in contemporanea: ne procede uno", async () => {
    const p = tempRoot("lk");
    const probe = aliveProbe(new Set([1001, 1002]));
    const [a, b] = await Promise.all([
      acquireLock(p.runLock, { holder: "sveglia", runId: "x", probe, identity: { pid: 1001, procStart: 1 } }),
      acquireLock(p.runLock, { holder: "sveglia", runId: "x", probe, identity: { pid: 1002, procStart: 2 } }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    if (a.ok) a.lock.release();
    if (b.ok) b.lock.release();
    rmRoot(p);
  });
  test("processo vivo con battito fermo da più di 15 minuti: nessun subentro, \"bloccata\"", async () => {
    const p = tempRoot("lk2");
    fs.mkdirSync(p.state, { recursive: true });
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    fs.writeFileSync(p.runLock, JSON.stringify({ pid: 2001, procStart: 5, holder: "sveglia", runId: "vecchia", started: old, heartbeat: old, pendingOrderIds: [] }));
    const r = await acquireLock(p.runLock, { holder: "sveglia", runId: "nuova", probe: aliveProbe(new Set([2001])) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bloccata");
    expect(readLock(p.runLock)!.runId).toBe("vecchia");
    rmRoot(p);
  });
  test("due processi che recuperano insieme un lock morto: ne vince uno, con gli id da riconciliare", async () => {
    const p = tempRoot("lk3");
    fs.mkdirSync(p.state, { recursive: true });
    const t = new Date().toISOString();
    fs.writeFileSync(p.runLock, JSON.stringify({ pid: 3001, procStart: 7, holder: "sveglia", runId: "morta", started: t, heartbeat: t, pendingOrderIds: ["2026-11-23-1540-AAA-buy"] }));
    const probe = aliveProbe(new Set([3002, 3003])); // 3001 è morto
    const [a, b] = await Promise.all([
      acquireLock(p.runLock, { holder: "sveglia", runId: "A", probe, identity: { pid: 3002, procStart: 1 } }),
      acquireLock(p.runLock, { holder: "sveglia", runId: "B", probe, identity: { pid: 3003, procStart: 2 } }),
    ]);
    const winners = [a, b].filter((x) => x.ok);
    expect(winners.length).toBe(1);
    const w = winners[0]!;
    if (w.ok) {
      expect(w.recovered?.content.pendingOrderIds).toEqual(["2026-11-23-1540-AAA-buy"]);
      w.lock.release();
    }
    expect(fs.readdirSync(p.state).some((f) => f.startsWith("run.lock.morto-"))).toBe(true);
    rmRoot(p);
  });
  test("la dashboard aspetta fino al rilascio", async () => {
    const p = tempRoot("lk4");
    const probe = aliveProbe(new Set([4001, 4002]));
    const a = await acquireLock(p.runLock, { holder: "sveglia", runId: "x", probe, identity: { pid: 4001, procStart: 1 } });
    expect(a.ok).toBe(true);
    setTimeout(() => a.ok && a.lock.release(), 300);
    const b = await acquireLock(p.runLock, { holder: "dashboard", runId: "d", probe, identity: { pid: 4002, procStart: 1 }, waitMs: 5_000 });
    expect(b.ok).toBe(true);
    if (b.ok) b.lock.release();
    rmRoot(p);
  });
});

describe("testimone (test 7)", () => {
  const t = (runId: string): Testimone => ({ runId, tipo: "briefing", seduta: "2026-11-23", eseguitaIl: "2026-11-23T08:30:00Z", paramsVersione: "v1", ordiniProposti: [], ordiniInviati: [], rifiuti: [], errori: [], ragionamento: "", piano: "p", lezioni: [], testo: "" });
  test("corrotto → ultima copia valida + allarme; senza copie si va avanti", () => {
    const p = tempRoot("bt");
    fs.mkdirSync(p.state, { recursive: true });
    fs.writeFileSync(p.baton, "{rotto");
    expect(leggiTestimone(p).testimone).toBeNull();
    expect(leggiTestimone(p).allarme).toContain("nessuna copia");
    scriviTestimone(p, t("2026-11-23-0930"));
    fs.writeFileSync(p.baton, "{rotto");
    const r = leggiTestimone(p);
    expect(r.testimone?.runId).toBe("2026-11-23-0930");
    expect(r.allarme).toContain("corrotto");
    rmRoot(p);
  });
});

const OPEN = new Date("2026-11-23T15:00:00Z");
function exe(b: FakeBroker) {
  return new Esecutore(b, null, memoryLogger(), async () => {});
}
const bracketReq = (id: string) => ({ clientOrderId: id, symbol: "ABC", side: "buy" as const, type: "market" as const, qty: 10, tif: "gtc" as const, orderClass: "bracket" as const, takeProfit: { limitPrice: 120 }, stopLoss: { stopPrice: 90 } });

describe("esecutore", () => {
  test("stesso id due volte → un solo ordine (test 1, 29)", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    const e = exe(b);
    expect((await e.invia(bracketReq("2026-11-23-1540-ABC-buy"), "compra")).stato).toBe("inviato");
    expect((await e.invia(bracketReq("2026-11-23-1540-ABC-buy"), "compra")).stato).toBe("già presente");
    expect(b.createdOrders((o) => o.side === "buy").length).toBe(1);
  });
  test("timeout con ordine arrivato: trovato per id, nessun reinvio", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    b.faults.submitTimeoutAccepted = () => true;
    const r = await exe(b).invia(bracketReq("x1"), "compra");
    expect(r.stato).toBe("inviato");
    expect(b.submittedCount()).toBe(1);
  });
  test("timeout con ordine perso: esito sconosciuto, nessun reinvio", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    b.faults.submitTimeoutLost = () => true;
    const r = await exe(b).invia(bracketReq("x2"), "compra");
    expect(r.stato).toBe("esito sconosciuto");
    expect(b.submittedCount()).toBe(1);
  });
  test("vendita con protezione aperta: prima la cancellazione, poi la vendita, nessun 403 (test 15)", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    const e = exe(b);
    await e.invia(bracketReq("b1"), "compra");
    const r = await e.vendi("ABC", "s1", "prova", 10_000);
    expect(r.stato).toBe("venduto");
    expect(r.quantita).toBe(10);
    expect(await b.getPositions()).toEqual([]);
    const calls = b.calls.map((c) => c.method);
    expect(calls.indexOf("cancelOrder")).toBeLessThan(calls.lastIndexOf("submitOrder"));
  });
  test("cancellazione non confermata entro 10 s: nessuna vendita (test 33)", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    const e = exe(b);
    await e.invia(bracketReq("b1"), "compra");
    b.faults.cancelNeverConfirms = true;
    const r = await e.vendi("ABC", "s1", "prova", 10_000);
    expect(r.stato).toBe("cancellazione non confermata");
    expect((await b.getPositions())[0]!.qty).toBe(10);
  });
  test("gamba eseguita durante la cancellazione: quantità riletta zero, nessuno short (test 33)", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    await b.patchAccountConfig({ noShorting: true, maxMarginMultiplier: "1" });
    const e = exe(b);
    await e.invia(bracketReq("b1"), "compra");
    b.faults.fillOnCancel = new Set(["ABC"]);
    const r = await e.vendi("ABC", "s1", "prova", 10_000);
    expect(r.stato).toBe("niente da vendere");
    expect(await b.getPositions()).toEqual([]);
    expect(b.createdOrders((o) => o.side === "sell" && o.type === "market").length).toBe(0);
  });
});

function piano(over: Partial<PianoUscita> = {}): PianoUscita {
  return { simbolo: "ABC", tradeId: "T-1", modalita: "bracket", stop: 90, takeProfit: 120, trailingPct: null, trailPrice: null, massimo: 100, ingresso: 100, quantita: 10, origine: "iniziale", creato: OPEN.toISOString(), aggiornato: OPEN.toISOString(), chiudiAllApertura: null, paramsVersione: "v1", ...over };
}

async function check(b: FakeBroker, p: PianoUscita, o: Partial<Parameters<typeof controllaProtezioni>[3]> = {}) {
  const updates: Partial<PianoUscita>[] = [];
  const c: ContestoProtezioni = {
    esecutore: exe(b),
    piani: { ABC: p },
    prezzi: { ABC: b.state.prices.ABC! },
    aggiornaPiano: (_s, x) => {
      updates.push(x);
      Object.assign(p, x);
    },
    motivoUscita: () => "stop",
  };
  const r = await controllaProtezioni(await b.getPositions(), flattenOrders(await b.listOrders({ status: "open" })), c, { runId: "2026-11-23-1540", tipo: "apertura", mercatoAperto: true, tentativi: 3, maxGiorni: 80, attesaCancMs: 10_000, now: b["opts"].now(), ...o });
  return { r, updates };
}

describe("protezioni", () => {
  test("posizione senza protezione → OCO ricreata secondo il piano (test 14)", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.seedPosition("ABC", 10, 100, { price: 101 });
    const { r } = await check(b, piano());
    expect(r[0]!.stato).toBe("ricreata");
    const oo = b.openOrders("ABC");
    expect(oo.find((o) => o.type === "stop")!.stopPrice).toBe(90);
    expect(oo.find((o) => o.type === "limit")!.limitPrice).toBe(120);
  });
  test("prezzo già oltre lo stop → venduta (test 14); al briefing no", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.seedPosition("ABC", 10, 100, { price: 89 });
    const br = await check(b, piano(), { tipo: "briefing" });
    expect(br.r[0]!.stato).toBe("vendita all'apertura");
    expect((await b.getPositions()).length).toBe(1);
    const { r } = await check(b, piano());
    expect(r[0]!.stato).toBe("venduta");
    expect(await b.getPositions()).toEqual([]);
  });
  test("stop modificato a mano: si segue il piano, non i valori iniziali (test 35)", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.state.prices.ABC = 100;
    await exe(b).invia(bracketReq("b1"), "compra"); // stop 90 sul broker
    const p = piano({ stop: 95, origine: "manuale" });
    const { r } = await check(b, p);
    expect(r[0]!.stato).toBe("modificata");
    expect(b.openOrders("ABC").find((o) => o.type === "stop")!.stopPrice).toBe(95);
    const again = await check(b, p);
    expect(again.r[0]!.stato).toBe("ok");
  });
  test("protezione gtc con più di 80 giorni → ricreata all'apertura (test 40)", async () => {
    let now = new Date("2026-08-20T15:00:00Z");
    const b = new FakeBroker({ now: () => now });
    b.state.prices.ABC = 100;
    await exe(b).invia(bracketReq("b1"), "compra");
    now = OPEN; // 95 giorni dopo
    const { r } = await check(b, piano(), { now });
    expect(r[0]!.stato).toBe("ricreata");
    const stop = b.openOrders("ABC").find((o) => o.type === "stop")!;
    expect(stop.createdAt).toBe(OPEN.toISOString());
  });
  test("stop mobile ricreato riparte dal massimo registrato, non dal prezzo attuale (test 40, 19)", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.seedPosition("ABC", 10, 100, { price: 110 });
    const p = piano({ modalita: "trailing", stop: null, takeProfit: null, trailingPct: 10, massimo: 120 });
    const { r } = await check(b, p);
    expect(r[0]!.stato).toBe("ricreata");
    const tr = b.openOrders("ABC").find((o) => o.type === "trailing_stop")!;
    expect(tr.trailPrice).toBe(2); // 110 − 120 × 0,9 = 2
    b.setPrice("ABC", 107.9);
    expect(await b.getPositions()).toEqual([]);
  });
  test("stop mobile con prezzo già sotto massimo × (1 − %): si vende", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.seedPosition("ABC", 10, 100, { price: 107 });
    const { r } = await check(b, piano({ modalita: "trailing", stop: null, takeProfit: null, trailingPct: 10, massimo: 120 }));
    expect(r[0]!.stato).toBe("venduta");
  });
  test("ricreazione fallita 3 volte → \"non protetta\" con allarme", async () => {
    const b = new FakeBroker({ now: () => OPEN });
    b.seedPosition("ABC", 10, 100, { price: 101 });
    b.faults.rejectSubmit = () => "rifiuto finto";
    const { r } = await check(b, piano());
    expect(r[0]!.stato).toBe("non protetta");
    expect(r[0]!.allarme).toContain("NON PROTETTA");
    expect(b.submittedCount()).toBe(3);
  });
});
