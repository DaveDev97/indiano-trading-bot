// Recupero delle sveglie saltate: il bot riparte a orari diversi della giornata e deve fare la cosa prudente.
import { describe, expect, test } from "bun:test";
import { daRecuperare, slotsDelGiorno } from "../src/run/calendario.ts";
import { tick } from "../src/run/tick.ts";
import { leggiStatoSveglie } from "../src/run/sveglia.ts";
import { loadParams } from "../src/params/params.ts";
import { fakeCalendar } from "../src/data/calendario-finto.ts";
import { scenario } from "./scenario.ts";
import { rmRoot, tempRoot } from "./helpers.ts";

const P = (() => {
  const p = tempRoot("rec");
  const r = loadParams(p).params;
  rmRoot(p);
  return r;
})();
const SEDUTA = "2026-11-24"; // martedì: briefing 09:30, apertura 15:40, metà 18:30, chiusura 21:30 (ora di Roma)
const cal = fakeCalendar("2026-11-20", "2026-11-30");
const slot = (tipo: string) => slotsDelGiorno(cal.find((d) => d.date === SEDUTA)!, P).find((s) => s.tipo === tipo)!;
const roma = (hhmm: string, giorno = SEDUTA) => {
  // novembre: Roma = UTC+1
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(Number(giorno.slice(0, 4)), Number(giorno.slice(5, 7)) - 1, Number(giorno.slice(8, 10)), h! - 1, m!));
};
const nessuna = new Set<string>();

describe("quale sveglia recuperare (regole)", () => {
  test("avvio alle 11:00: si recupera il briefing (mercato non ancora aperto)", () => {
    expect(daRecuperare(cal, P, roma("11:00"), nessuna, nessuna)?.slot.tipo).toBe("briefing");
  });
  test("avvio alle 17:00: si recupera l'apertura, non il briefing", () => {
    const r = daRecuperare(cal, P, roma("17:00"), nessuna, nessuna);
    expect(r?.slot.tipo).toBe("apertura");
    expect(r?.slot.id).toBe(slot("apertura").id); // stesso id della sveglia prevista: non si confonde con le forzate
  });
  test("avvio alle 19:30 (apertura e metà saltate): si recupera l'apertura, che fa anche le uscite", () => {
    expect(daRecuperare(cal, P, roma("19:30"), nessuna, nessuna)?.slot.tipo).toBe("apertura");
  });
  test("avvio alle 21:55 e alle 23:30: dopo l'orario della chiusura solo la chiusura, mai un acquisto", () => {
    expect(daRecuperare(cal, P, roma("21:55"), nessuna, nessuna)?.slot.tipo).toBe("chiusura");
    expect(daRecuperare(cal, P, roma("23:30"), nessuna, nessuna)?.slot.tipo).toBe("chiusura");
  });
  test("mancano meno di 30 minuti alla prossima sveglia: si lascia fare a lei", () => {
    expect(daRecuperare(cal, P, roma("15:15"), nessuna, nessuna)).toBeNull(); // apertura alle 15:40
    expect(daRecuperare(cal, P, roma("18:10"), nessuna, nessuna)).toBeNull(); // metà alle 18:30
  });
  test("una sveglia successiva già eseguita: non si torna indietro", () => {
    expect(daRecuperare(cal, P, roma("19:30"), new Set([slot("meta").id]), nessuna)).toBeNull();
  });
  test("già tentato o già eseguito: niente", () => {
    expect(daRecuperare(cal, P, roma("17:00"), nessuna, new Set([slot("apertura").id]))).toBeNull();
    expect(daRecuperare(cal, P, roma("17:00"), new Set([slot("apertura").id]), nessuna)).toBeNull();
  });
  test("sabato, domenica e prima delle sveglie: niente da recuperare", () => {
    expect(daRecuperare(cal, P, roma("12:00", "2026-11-28"), nessuna, nessuna)).toBeNull();
    expect(daRecuperare(cal, P, roma("12:00", "2026-11-29"), nessuna, nessuna)).toBeNull();
    expect(daRecuperare(cal, P, roma("08:00"), nessuna, nessuna)).toBeNull();
  });
  test("dopo mezzanotte a Roma la seduta di New York è ancora quella di ieri: si recupera la sua chiusura", () => {
    expect(daRecuperare(cal, P, roma("00:30", "2026-11-25"), nessuna, nessuna)?.slot.id).toBe(slot("chiusura").id);
  });
});

describe("recupero dentro il tick", () => {
  test("avvio alle 17:00: il primo tick recupera l'apertura e compra; il secondo non rifà niente", async () => {
    const sc = scenario();
    sc.ctx.setNow(roma("17:00").toISOString());
    const r1 = await tick(sc.ctx, { echo: false });
    expect(r1.fatto).toContain("recupero della sveglia");
    expect(r1.esito?.eseguita).toBe(true);
    expect(r1.esito?.inviati.some((x) => x.azione === "compra")).toBe(true);
    const st = leggiStatoSveglie(sc.ctx);
    expect(st.eseguite.find((x) => x.id === slot("apertura").id)?.recupero).toBe(true);
    const ordini = (await sc.ctx.broker.listOrders({ status: "all" })).length;
    sc.ctx.setNow(roma("17:01").toISOString());
    const r2 = await tick(sc.ctx, { echo: false });
    expect(r2.fatto).toBe("nessuna sveglia dovuta");
    expect((await sc.ctx.broker.listOrders({ status: "all" })).length).toBe(ordini);
    // la metà seduta poi parte regolarmente
    sc.ctx.setNow(roma("18:31").toISOString());
    expect((await tick(sc.ctx, { echo: false })).fatto).toContain(slot("meta").id);
    rmRoot(sc.ctx.paths);
  });
  test("il resoconto dice che è un recupero", async () => {
    const sc = scenario();
    sc.ctx.setNow(roma("17:00").toISOString());
    await tick(sc.ctx, { echo: false });
    expect(sc.ctx.sent.join("\n")).toContain("Recupero della sveglia di apertura prevista alle 15:40");
    rmRoot(sc.ctx.paths);
  });
  test("broker giù durante il recupero: non si ritenta a ogni tick (al massimo un tentativo)", async () => {
    const sc = scenario();
    // il calendario risponde (il tick decide), poi il conto no: la sveglia di recupero fallisce a metà
    const conto = sc.ctx.broker.getAccount.bind(sc.ctx.broker);
    sc.ctx.broker.getAccount = async () => {
      throw new Error("rete non raggiungibile (finto)");
    };
    sc.ctx.setNow(roma("17:00").toISOString());
    const r1 = await tick(sc.ctx, { echo: false });
    expect(r1.esito?.eseguita).toBe(false);
    sc.ctx.broker.getAccount = conto;
    sc.ctx.setNow(roma("17:01").toISOString());
    expect((await tick(sc.ctx, { echo: false })).fatto).toBe("nessuna sveglia dovuta");
    expect(leggiStatoSveglie(sc.ctx).recuperiTentati).toContain(slot("apertura").id);
    rmRoot(sc.ctx.paths);
  });
  test("due motori avviati insieme alle 17:00: una sola esecuzione, nessun ordine doppio", async () => {
    const sc = scenario();
    sc.ctx.setNow(roma("17:00").toISOString());
    const [a, b] = await Promise.all([tick(sc.ctx, { echo: false }), tick(sc.ctx, { echo: false })]);
    expect([a, b].filter((x) => x.esito?.eseguita).length).toBe(1);
    const ids = (await sc.ctx.broker.listOrders({ status: "all" })).map((o) => o.clientOrderId);
    expect(new Set(ids).size).toBe(ids.length);
    rmRoot(sc.ctx.paths);
  });
  test("broker giù già quando il tick decide: nessun tentativo consumato, il recupero parte quando torna", async () => {
    const sc = scenario();
    sc.ctx.broker.faults.down = true;
    sc.ctx.setNow(roma("17:00").toISOString());
    await expect(tick(sc.ctx, { echo: false })).rejects.toThrow();
    sc.ctx.broker.faults.down = false;
    sc.ctx.setNow(roma("17:05").toISOString());
    const r = await tick(sc.ctx, { echo: false });
    expect(r.esito?.eseguita).toBe(true);
    rmRoot(sc.ctx.paths);
  });
  test("avvio alle 22:30: si recupera la chiusura e non parte nessun acquisto", async () => {
    const sc = scenario();
    sc.ctx.setNow(roma("22:30").toISOString());
    const r = await tick(sc.ctx, { echo: false });
    expect(r.esito?.tipo).toBe("chiusura");
    expect(r.esito?.inviati.filter((x) => x.azione === "compra")).toEqual([]);
    rmRoot(sc.ctx.paths);
  });
});
