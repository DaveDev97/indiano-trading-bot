import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { eseguiSveglia } from "../src/run/sveglia.ts";
import { leggiPiani, aggiornaPiani } from "../src/run/piani.ts";
import { schedeReali } from "../src/journal/schede.ts";
import { readJournal } from "../src/journal/journal.ts";
import { saveParams, loadParams } from "../src/params/params.ts";
import { readUsage } from "../src/brain/usage.ts";
import { leggiSegnali } from "../src/signals/sessione.ts";
import { FakeTelegram } from "../src/telegram/client.ts";
import { writeJsonAtomic } from "../src/util/atomic.ts";
import { scenario, scriviWatchlist, SIMBOLI } from "./scenario.ts";
import { rmRoot } from "./helpers.ts";

const buys = (sc: ReturnType<typeof scenario>) => sc.ctx.broker.createdOrders((o) => o.side === "buy");

describe("sveglia: acquisti e affidabilità", () => {
  test("apertura: compra nei posti liberi, massimo 2 per settore, ogni acquisto con piano e scheda (test 24, 34)", async () => {
    const sc = scenario();
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    const r = await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    expect(r.eseguita).toBe(true);
    const b = buys(sc);
    expect(b.length).toBe(5);
    expect(b.filter((x) => ["AAA", "BBB"].includes(x.symbol)).length).toBe(2);
    // dimensionamento: 20% del patrimonio a testa, cash mai negativo
    expect(sc.ctx.broker.state.cash).toBeGreaterThanOrEqual(0);
    const piani = leggiPiani(sc.ctx.paths).piani;
    expect(Object.keys(piani).length).toBe(5);
    const schede = schedeReali(sc.ctx.paths);
    expect(schede.length).toBe(5);
    expect(schede[0]!.ingresso.candele.length).toBe(300);
    expect(schede[0]!.ingresso.candeleSplit.length).toBe(300);
    expect(schede[0]!.ingresso.criteri.length).toBeGreaterThan(0);
    expect(schede[0]!.ingresso.segnale.ingresso).toBe(true);
    // ogni posizione ha la protezione per l'intera quantità
    for (const p of await sc.ctx.broker.getPositions()) {
      const st = sc.ctx.broker.openOrders(p.symbol).find((o) => o.type === "stop")!;
      expect(st.qty).toBe(p.qty);
    }
    rmRoot(sc.ctx.paths);
  });
  test("due acquisti con poco cash: il secondo usa il cash meno il primo (test 34)", async () => {
    const sc = scenario({ cash: 25_000 });
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    const spent = buys(sc).reduce((a, o) => a + o.filledQty * (o.filledAvgPrice ?? 0), 0);
    expect(spent).toBeLessThanOrEqual(25_000);
    expect(sc.ctx.broker.state.cash).toBeGreaterThanOrEqual(0);
    rmRoot(sc.ctx.paths);
  });
  test("stessa sveglia lanciata due volte → un solo ordine per titolo (test 1)", async () => {
    const sc = scenario();
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    const per = new Map<string, number>();
    for (const o of buys(sc)) per.set(o.symbol, (per.get(o.symbol) ?? 0) + 1);
    expect([...per.values()].every((n) => n === 1)).toBe(true);
    rmRoot(sc.ctx.paths);
  });
  test("due sveglie in contemporanea → ne procede una (test 2)", async () => {
    const sc = scenario();
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    const [a, b] = await Promise.all([eseguiSveglia(sc.ctx, { slot: s, forzata: false }), eseguiSveglia(sc.ctx, { slot: s, forzata: false })]);
    expect([a.eseguita, b.eseguita].filter(Boolean).length).toBe(1);
    expect([a.motivo, b.motivo]).toContain("sveglia già in corso");
    expect(buys(sc).length).toBe(5);
    rmRoot(sc.ctx.paths);
  });
  test("processo ucciso dopo il primo ordine → la sveglia dopo riconcilia e non ricompra (test 3)", async () => {
    const sc = scenario();
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    // la sveglia "morta": ha inviato l'acquisto di AAA, poi il processo è morto lasciando il lock
    await sc.ctx.broker.submitOrder({ clientOrderId: `${ap.id}-AAA-buy`, symbol: "AAA", side: "buy", type: "market", qty: 10, tif: "gtc", orderClass: "bracket", takeProfit: { limitPrice: 999 }, stopLoss: { stopPrice: 1 } });
    fs.mkdirSync(sc.ctx.paths.state, { recursive: true });
    const t = sc.ctx.now().toISOString();
    fs.writeFileSync(sc.ctx.paths.runLock, JSON.stringify({ pid: 999_991, procStart: 1, holder: "sveglia", runId: ap.id, started: t, heartbeat: t, pendingOrderIds: [`${ap.id}-AAA-buy`] }));
    const meta = sc.slot("meta");
    sc.setNowAt(meta);
    const r = await eseguiSveglia(sc.ctx, { slot: meta, forzata: false });
    expect(r.eseguita).toBe(true);
    expect(r.allarmi.join()).toContain("interrotta");
    expect(r.allarmi.join()).toContain("arrivato");
    expect(buys(sc).filter((o) => o.symbol === "AAA").length).toBe(1);
    rmRoot(sc.ctx.paths);
  });
  test("cervello in timeout o risposta non valida → protezioni eseguite, nessun acquisto, allarme (test 8)", async () => {
    for (const mode of ["timeout", "non valida"] as const) {
      const sc = scenario();
      sc.ctx.broker.seedPosition("ZZZ", 10, 50, { price: 51 });
      aggiornaPiani(sc.ctx.paths, (p) => (p.ZZZ = { simbolo: "ZZZ", tradeId: "T-x", modalita: "bracket", stop: 45, takeProfit: 60, trailingPct: null, trailPrice: null, massimo: 51, ingresso: 50, quantita: 10, origine: "iniziale", creato: sc.ctx.now().toISOString(), aggiornato: sc.ctx.now().toISOString(), chiudiAllApertura: null, paramsVersione: "v1" }));
      sc.brain.mode = mode;
      const s = sc.slot("apertura");
      sc.setNowAt(s);
      const r = await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
      expect(r.eseguita).toBe(true);
      expect(buys(sc).length).toBe(0);
      expect(r.allarmi.join()).toContain("cervello");
      expect(sc.ctx.broker.openOrders("ZZZ").some((o) => o.type === "stop")).toBe(true);
      expect(readUsage(sc.ctx.paths).length).toBe(1);
      rmRoot(sc.ctx.paths);
    }
  });
  test("Telegram irraggiungibile → la sveglia finisce e lo scrive nel log (test 9)", async () => {
    const sc = scenario();
    const tg = new FakeTelegram();
    tg.down = true;
    sc.ctx.tg = tg;
    // un telegram vero che fallisce scrive "telegram non raggiungibile" nel log: qui verifichiamo che la sveglia non si fermi
    const s = sc.slot("briefing");
    sc.setNowAt(s);
    const r = await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    expect(r.eseguita).toBe(true);
    expect(sc.ctx.log.righe.some((l) => l.includes("non inviato"))).toBe(true);
    rmRoot(sc.ctx.paths);
  });
});

describe("sveglia: regole di ingresso", () => {
  test("briefing: nessun ordine; metà seduta e chiusura usano i segnali salvati al briefing (test 37)", async () => {
    const sc = scenario();
    const br = sc.slot("briefing");
    sc.setNowAt(br);
    await eseguiSveglia(sc.ctx, { slot: br, forzata: false });
    expect(buys(sc).length).toBe(0);
    const prima = leggiSegnali(sc.ctx, sc.seduta)!;
    expect(prima.ultimaCandela).toBe("2026-11-23");
    // cambiano le candele: i segnali della seduta non si ricalcolano
    sc.ctx.data.barOverrides.set("AAA", sc.ctx.data.barOverrides.get("AAA")!.map((b) => ({ ...b, c: b.c * 0.5 })));
    const ch = sc.slot("chiusura");
    sc.setNowAt(ch);
    await eseguiSveglia(sc.ctx, { slot: ch, forzata: false });
    expect(leggiSegnali(sc.ctx, sc.seduta)!.titoli.AAA!.chiusura).toBe(prima.titoli.AAA!.chiusura);
    expect(buys(sc).length).toBe(0);
    rmRoot(sc.ctx.paths);
  });
  test("un acquisto proposto al briefing e rifiutato dalla gabbia non blocca l'acquisto all'apertura", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    sc.brain.override = { decisions: [{ simbolo: "AAA", azione: "compra", perche: "x" }], reasoning: "r", planNext: "p" };
    const br = sc.slot("briefing");
    sc.setNowAt(br);
    const r1 = await eseguiSveglia(sc.ctx, { slot: br, forzata: false });
    expect(r1.rifiuti[0]!.codice).toBe("sveglia-senza-ingressi");
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    const r2 = await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    expect(r2.candidati).toEqual(["AAA"]);
    expect(buys(sc).length).toBe(1);
    rmRoot(sc.ctx.paths);
  });
  test("trimestrale entro 5 sedute, o data non verificabile → nessun ingresso, con il motivo (test 17)", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"], ["CCC", "Energy"]] });
    sc.ctx.data.specs.get("AAA")!.earningsInDays = 3;
    sc.ctx.data.failEarnings.add("CCC");
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    const r = await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    expect(buys(sc).length).toBe(0);
    expect(r.candidati).toEqual([]);
    rmRoot(sc.ctx.paths);
  });
  test("freno d'emergenza → nessun ingresso, allarme (test 18)", async () => {
    const sc = scenario();
    const s = sc.slot("apertura");
    // massimo 100.000 registrato ieri, oggi il patrimonio è a 80.000
    sc.ctx.setNow("2026-11-23T21:00:00Z");
    await sc.ctx.broker.getAccount();
    writeJsonAtomic(sc.ctx.paths.freno, { avvio: "2026-11-20", ultimoSblocco: null, attivo: false, scattatoIl: null });
    sc.ctx.broker.state.cash = 80_000;
    sc.setNowAt(s);
    const r = await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    expect(buys(sc).length).toBe(0);
    expect(r.allarmi.join()).toContain("Freno");
    rmRoot(sc.ctx.paths);
  });
  test("nessun settore forte → zero acquisti, dichiarato (test 20)", async () => {
    const sc = scenario();
    scriviWatchlist(sc.ctx, { forti: [] });
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    const r = await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    expect(buys(sc).length).toBe(0);
    expect(r.messaggio).toContain("nessun settore forte");
    rmRoot(sc.ctx.paths);
  });
  test("watchlist più vecchia di 8 giorni → allarme e nessun acquisto", async () => {
    const sc = scenario();
    scriviWatchlist(sc.ctx, { generata: "2026-11-10T09:00:00Z" });
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    const r = await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    expect(buys(sc).length).toBe(0);
    expect(r.allarmi.join()).toContain("watchlist vecchia");
    rmRoot(sc.ctx.paths);
  });
  test("stop su un titolo → non si ricompra per 10 sedute, anche cancellando il testimone (test 16)", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    expect(buys(sc).length).toBe(1);
    // va in stop
    const stop = sc.ctx.broker.openOrders("AAA").find((o) => o.type === "stop")!.stopPrice!;
    sc.ctx.data.priceOverrides.set("AAA", stop - 1);
    sc.ctx.broker.step();
    expect(await sc.ctx.broker.getPositions()).toEqual([]);
    sc.ctx.data.priceOverrides.set("AAA", stop + 5);
    fs.rmSync(sc.ctx.paths.baton, { force: true });
    fs.rmSync(sc.ctx.paths.history, { recursive: true, force: true });
    // il giorno dopo: AAA è ancora primo in classifica con i segnali, ma è in pausa
    const sc2 = sc.slot("apertura", "2026-11-25");
    sc.setNowAt(sc2);
    const r = await eseguiSveglia(sc.ctx, { slot: sc2, forzata: false });
    expect(buys(sc).length).toBe(1);
    expect(r.candidati).toEqual([]);
    rmRoot(sc.ctx.paths);
  });
  test("modalità trailing: processo morto tra l'acquisto e lo stop mobile → la sveglia dopo lo crea (test 19)", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    saveParams(sc.ctx.paths, { "uscita.modalita": "trailing" }, { autore: "test", versioneAttesa: loadParams(sc.ctx.paths).params.file.versione });
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    sc.ctx.broker.faults.marketNeverFills = true; // l'acquisto non si esegue entro 30 s: niente stop mobile
    await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    sc.ctx.broker.faults.marketNeverFills = false;
    sc.ctx.broker.step(); // ora si esegue
    expect((await sc.ctx.broker.getPositions()).length).toBe(1);
    expect(sc.ctx.broker.openOrders("AAA").some((o) => o.type === "trailing_stop")).toBe(false);
    const m = sc.slot("meta");
    sc.setNowAt(m);
    await eseguiSveglia(sc.ctx, { slot: m, forzata: false });
    const tr = sc.ctx.broker.openOrders("AAA").find((o) => o.type === "trailing_stop");
    expect(tr).toBeDefined();
    expect(tr!.qty).toBe((await sc.ctx.broker.getPositions())[0]!.qty);
    rmRoot(sc.ctx.paths);
  });
  test("budget superato in modalità \"sospendi\" → nessuna chiamata al cervello, protezioni eseguite, lo dice (test 46)", async () => {
    const sc = scenario();
    saveParams(sc.ctx.paths, { "ai.budgetMensile": 1, "ai.azioneBudget": "sospendi il cervello" }, { autore: "test", versioneAttesa: 1 });
    sc.brain.costo = 2;
    const br = sc.slot("briefing");
    sc.setNowAt(br);
    await eseguiSveglia(sc.ctx, { slot: br, forzata: false }); // questa chiamata supera il budget
    const n = sc.brain.calls.length;
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    const r = await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    expect(sc.brain.calls.length).toBe(n);
    expect(buys(sc).length).toBe(0);
    expect(r.allarmi.join()).toContain("sospeso");
    rmRoot(sc.ctx.paths);
  });
});

describe("sveglia: diario e simulazioni", () => {
  test("uscita completa la scheda; la simulazione resta \"in corso\" e si chiude da sola (test 24)", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    const s = sc.slot("apertura");
    sc.setNowAt(s);
    await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    const tp = sc.ctx.broker.openOrders("AAA").find((o) => o.type === "limit")!.limitPrice!;
    // il titolo sale al take profit durante la seduta
    sc.ctx.data.priceOverrides.set("AAA", tp + 1);
    sc.ctx.broker.step();
    const ch = sc.slot("chiusura");
    sc.setNowAt(ch);
    await eseguiSveglia(sc.ctx, { slot: ch, forzata: false });
    const sch = schedeReali(sc.ctx.paths)[0]!;
    expect(sch.uscita?.motivo).toBe("take profit");
    expect(sch.uscita!.R).toBeGreaterThan(1.5);
    expect(sch.stato).toBe("simulazione in corso");
    // nei giorni seguenti arrivano le candele chiuse: la simulazione si completa da sola
    const base = sc.ctx.data.barOverrides.get("AAA")!;
    const last = base.at(-1)!;
    const extra = [
      { t: "2026-11-24", o: last.c, h: last.c * 1.25, l: last.c * 0.99, c: last.c * 1.22, v: 1000 },
      { t: "2026-11-25", o: last.c * 1.22, h: last.c * 1.23, l: last.c * 0.5, c: last.c * 0.55, v: 5000 },
    ];
    sc.ctx.data.barOverrides.set("AAA", [...base, ...extra]);
    const ch2 = sc.slot("chiusura", "2026-11-27");
    sc.setNowAt(ch2);
    await eseguiSveglia(sc.ctx, { slot: ch2, forzata: false });
    const fin = schedeReali(sc.ctx.paths)[0]!;
    expect(fin.simulazione?.inCorso).toBe(false);
    expect(fin.simulazione?.bracket?.uscita?.motivo).toBe("take profit");
    expect(fin.simulazione?.trailing?.stato).toBe("chiusa");
    expect(fin.stato).toBe("completa");
    rmRoot(sc.ctx.paths);
  });
  test("chiusura: registra operazioni ombra separate dal diario reale", async () => {
    const sc = scenario();
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    const ch = sc.slot("chiusura");
    sc.setNowAt(ch);
    await eseguiSveglia(sc.ctx, { slot: ch, forzata: false });
    const files = fs.readdirSync(sc.ctx.paths.journal);
    expect(files.some((f) => f.startsWith("ombra-"))).toBe(true);
    expect(readJournal(sc.ctx.paths).some((e) => e.tipo === "scheda-ingresso" && String(e.tradeId).startsWith("S-"))).toBe(false);
    rmRoot(sc.ctx.paths);
  });
});
