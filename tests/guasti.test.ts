// Avvocato del diavolo: guasti veri, uno alla volta, con broker e cervello finti.
// 1, 2 e 5 usano processi bun veri, uccisi per PID (SIGKILL / TerminateProcess), non con Ctrl-C.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempRoot, rmRoot } from "./helpers.ts";
import { makePaths, type Paths } from "../src/config/paths.ts";
import { pidExists } from "../src/util/process.ts";
import { readLock } from "../src/run/lock.ts";
import { schedeReali } from "../src/journal/schede.ts";
import { leggiTestimone } from "../src/run/baton.ts";
import { scenario, SIMBOLI } from "./scenario.ts";
import { eseguiSveglia } from "../src/run/sveglia.ts";
import { tick, once } from "../src/run/tick.ts";
import { aggiornaPiani } from "../src/run/piani.ts";
import { interpretaUscita } from "../src/brain/claude.ts";
import { readUsage } from "../src/brain/usage.ts";
import { BrokerError } from "../src/broker/types.ts";
import { quantita } from "../src/cage/dimensionamento.ts";
import type { Brain } from "../src/brain/types.ts";

const FIGLIO = path.join(import.meta.dir, "guasti", "figlio.ts");
const APERTURA = "2026-11-24T14:41:00Z"; // martedì 24/11/2026, 15:41 Roma: un minuto dopo la sveglia di apertura

function lancia(root: string, ora: string, modo: string) {
  const proc = Bun.spawn([process.execPath, FIGLIO], { env: { ...process.env, GUASTO_ROOT: root, GUASTO_ORA: ora, GUASTO_MODO: modo }, stdout: "pipe", stderr: "pipe" });
  let out = "";
  const dec = new TextDecoder();
  const reader = proc.stdout.getReader();
  const pompa = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
  })();
  return {
    proc,
    testo: () => out,
    async attendi(segno: string, ms = 45_000) {
      const t0 = Date.now();
      while (!out.includes(segno)) {
        if (Date.now() - t0 > ms) throw new Error(`il figlio non ha stampato ${segno}. Uscita: ${out}\n${await new Response(proc.stderr).text()}`);
        await Bun.sleep(20);
      }
    },
    async fine() {
      await proc.exited;
      await pompa;
      const r = /ESITO (.*)/.exec(out);
      if (!r) throw new Error(`nessun esito dal figlio. Uscita: ${out}\n${await new Response(proc.stderr).text()}`);
      return JSON.parse(r[1]!) as { pid: number; fatto: string; eseguita: boolean; motivo: string | null; allarmi: string[] };
    },
  };
}

function ordiniSulBroker(p: Paths) {
  const st = JSON.parse(fs.readFileSync(p.fakeBroker, "utf8"));
  return st.orders as { clientOrderId: string; symbol: string; side: string; type: string; qty: number; status: string; parentId: string | null }[];
}
function acquistiPerSimbolo(p: Paths): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of ordiniSulBroker(p)) if (o.side === "buy" && !o.parentId) m.set(o.symbol, (m.get(o.symbol) ?? 0) + 1);
  return m;
}
function posizioniSulBroker(p: Paths): Record<string, { qty: number }> {
  return JSON.parse(fs.readFileSync(p.fakeBroker, "utf8")).positions;
}

describe("guasti", () => {
  test("1. morte a metà: kill del PID subito dopo il primo ordine, poi rilancio", async () => {
    const paths = tempRoot("morte");
    const a = lancia(paths.root, APERTURA, "ferma-dopo-primo-ordine");
    await a.attendi("PRIMO_ORDINE");
    const pidMorto = a.proc.pid;
    a.proc.kill(9); // SIGKILL su Linux, TerminateProcess su Windows: nessuna pulizia
    await a.proc.exited;
    expect(pidExists(pidMorto)).toBe(false);
    expect(readLock(paths.runLock)?.pid).toBe(pidMorto); // il lock è rimasto
    expect([...acquistiPerSimbolo(paths).values()].reduce((x, y) => x + y, 0)).toBe(1);
    console.log(`[1] processo ${pidMorto} ucciso dopo ${a.testo().trim()}; ordini di acquisto sul broker: 1; lock rimasto: sì`);

    const b = await lancia(paths.root, "2026-11-24T14:44:00Z", "normale").fine();
    expect(b.eseguita).toBe(true);
    expect(b.allarmi.join(" ")).toContain("interrotta");
    console.log(`[1] rilancio: ${b.fatto}; allarme: ${b.allarmi.find((x) => x.includes("interrotta"))}`);
    const per = acquistiPerSimbolo(paths);
    // ogni titolo comprato una volta sola, al massimo 5 posizioni
    expect([...per.values()].every((n) => n === 1)).toBe(true);
    expect(per.size).toBe(5);
    // ogni posizione ha la sua protezione per l'intera quantità e la sua scheda nel diario
    const pos = posizioniSulBroker(paths);
    const ordini = ordiniSulBroker(paths);
    const schede = schedeReali(paths);
    for (const [s, p] of Object.entries(pos)) {
      expect(ordini.some((o) => o.symbol === s && o.side === "sell" && o.type === "stop" && o.qty === p.qty && ["held", "new", "accepted"].includes(o.status))).toBe(true);
      expect(schede.some((c) => c.ingresso.simbolo === s && !c.annullata)).toBe(true);
    }
    // un terzo lancio nella stessa finestra non fa niente
    const c = await lancia(paths.root, "2026-11-24T14:46:00Z", "normale").fine();
    expect(c.fatto).toContain("nessuna sveglia dovuta");
    expect([...acquistiPerSimbolo(paths).values()].reduce((x, y) => x + y, 0)).toBe(5);
    rmRoot(paths);
  }, 120_000);

  test("2. doppio lancio: due sveglie della stessa ora a mezzo secondo di distanza", async () => {
    const paths = tempRoot("doppio");
    const a = lancia(paths.root, APERTURA, "lento");
    await Bun.sleep(500);
    const b = lancia(paths.root, APERTURA, "lento");
    const [ra, rb] = await Promise.all([a.fine(), b.fine()]);
    expect([ra.eseguita, rb.eseguita].filter(Boolean).length).toBe(1);
    const perdente = ra.eseguita ? rb : ra;
    console.log(`[2] primo: ${ra.fatto} | secondo (0,5 s dopo): ${rb.fatto}`);
    expect(perdente.fatto).toMatch(/già in corso|nessuna sveglia dovuta/);
    const per = acquistiPerSimbolo(paths);
    expect([...per.values()].every((n) => n === 1)).toBe(true);
    expect(per.size).toBe(5);
    expect(fs.existsSync(paths.runLock)).toBe(false);
    rmRoot(paths);
  }, 120_000);

  test("2b. doppio lancio, sequenza peggiore: la seconda arriva al lock dopo che la prima l'ha già eseguita e rilasciata", async () => {
    const sc = scenario();
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    // la seconda istanza ha già deciso che la sveglia è da fare (stato letto prima che la prima finisse)…
    const a = await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    const chiamate = sc.brain.calls.length;
    const messaggi = sc.ctx.sent.length;
    // …e prende il lock solo ora
    const b = await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    expect(a.eseguita).toBe(true);
    expect(b.eseguita).toBe(false);
    expect(b.motivo).toBe("sveglia già eseguita");
    expect(sc.brain.calls.length).toBe(chiamate); // nessuna seconda chiamata al cervello
    expect(sc.ctx.sent.length).toBe(messaggi); // nessun messaggio doppio
    rmRoot(sc.ctx.paths);
  });

  for (const variante of ["arrivato", "perso"] as const) {
    test(`3. broker che non risponde per 30 secondi durante l'invio (ordine ${variante})`, async () => {
      const sc = scenario({ simboli: [["AAA", "Technology"], ["CCC", "Energy"]] });
      sc.ctx.sleep = async (ms) => {
        sc.ctx.clock.t = new Date(sc.ctx.clock.t.getTime() + ms);
      };
      const b = sc.ctx.broker as any;
      let finoA = 0;
      const giu = () => sc.ctx.now().getTime() < finoA;
      const timeout = () => new BrokerError("timeout", null, "timeout: Alpaca non risponde");
      for (const m of ["getAccount", "getAccountConfig", "getPositions", "getPosition", "listOrders", "getOrder", "getOrderByClientId", "replaceOrder", "cancelOrder", "getClock", "getCalendar", "getPortfolioHistory", "patchAccountConfig"]) {
        const orig = b[m].bind(b);
        b[m] = async (...x: unknown[]) => {
          if (giu()) throw timeout();
          return orig(...x);
        };
      }
      const submit = b.submitOrder.bind(b);
      b.submitOrder = async (r: any) => {
        if (finoA === 0) {
          finoA = sc.ctx.now().getTime() + 30_000; // da qui Alpaca resta muto per 30 secondi
          if (variante === "arrivato") await submit(r);
          throw timeout();
        }
        if (giu()) throw timeout();
        return submit(r);
      };
      const ap = sc.slot("apertura");
      sc.setNowAt(ap);
      const r1 = await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
      // AAA: inviato senza risposta (non si sa se è arrivato); CCC: mai partito, e l'allarme deve dirlo
      expect(r1.allarmi.join(" ")).toContain("AAA: acquisto senza risposta");
      expect(r1.allarmi.join(" ")).toContain("CCC: broker non raggiungibile, acquisto NON inviato");
      const dopo1 = sc.ctx.broker.createdOrders((o) => o.side === "buy");
      expect(dopo1.length).toBe(variante === "arrivato" ? 1 : 0); // nessun reinvio alla cieca
      console.log(`[3 ${variante}] ordini sul broker dopo il blackout: ${dopo1.length}; chiamate di invio: ${sc.ctx.broker.submittedCount()}; allarmi: ${r1.allarmi.join(" / ")}`);
      // il giorno dopo, broker di nuovo in linea
      const ap2 = sc.slot("apertura", "2026-11-25");
      sc.setNowAt(ap2);
      await eseguiSveglia(sc.ctx, { slot: ap2, forzata: false });
      const per = new Map<string, number>();
      for (const o of sc.ctx.broker.createdOrders((o) => o.side === "buy")) per.set(o.symbol, (per.get(o.symbol) ?? 0) + 1);
      expect(per.get("AAA")).toBe(1);
      expect(per.get("CCC")).toBe(1);
      for (const p of await sc.ctx.broker.getPositions()) expect(sc.ctx.broker.openOrders(p.symbol).some((o) => o.type === "stop" && o.qty === p.qty)).toBe(true);
      rmRoot(sc.ctx.paths);
    }, 60_000);
  }

  const risposte: [string, string][] = [
    ["JSON troncato", '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.02,"modelUsage":{"m":{"inputTokens":10,"outputTokens":5,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"costUSD":0.02}},"structured_output":{"decisions":[{"simbolo":"AAA","azione":"comp'],
    ["campo mancante", JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.02, modelUsage: { m: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.02 } }, structured_output: { decisions: [{ simbolo: "AAA", azione: "compra", perche: "x" }], planNext: "p" } })],
  ];
  for (const [nome, stdout] of risposte) {
    test(`4. il modello risponde male: ${nome} → nessun acquisto, protezioni eseguite, allarme, consumo registrato`, async () => {
      const sc = scenario({ simboli: [["AAA", "Technology"]] });
      sc.ctx.brain = { name: "claude", run: async () => interpretaUscita(0, stdout, false, 1000) } satisfies Brain;
      sc.ctx.broker.seedPosition("ZZZ", 10, 50, { price: 51 });
      aggiornaPiani(sc.ctx.paths, (p) => (p.ZZZ = { simbolo: "ZZZ", tradeId: "T-z", modalita: "bracket", stop: 45, takeProfit: 60, trailingPct: null, trailPrice: null, massimo: 51, ingresso: 50, quantita: 10, origine: "iniziale", creato: sc.ctx.now().toISOString(), aggiornato: sc.ctx.now().toISOString(), chiudiAllApertura: null, paramsVersione: "v1" }));
      const ap = sc.slot("apertura");
      sc.setNowAt(ap);
      const r = await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
      expect(r.eseguita).toBe(true);
      expect(sc.ctx.broker.createdOrders((o) => o.side === "buy").length).toBe(0);
      expect(r.allarmi.join(" ")).toContain("cervello");
      expect(sc.ctx.broker.openOrders("ZZZ").some((o) => o.type === "stop")).toBe(true);
      const u = readUsage(sc.ctx.paths);
      expect(u.length).toBe(1);
      expect(u[0]!.esito).not.toBe("ok");
      rmRoot(sc.ctx.paths);
    });
  }
  test("4. il modello risponde male: quantità negativa → ignorata, la quantità la calcola il codice", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    const stdout = JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.02, modelUsage: {}, structured_output: { decisions: [{ simbolo: "AAA", azione: "compra", perche: "x", quantita: -5 }], reasoning: "r", planNext: "p" } });
    sc.ctx.brain = { name: "claude", run: async () => interpretaUscita(0, stdout, false, 1000) } satisfies Brain;
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    const buys = sc.ctx.broker.createdOrders((o) => o.side === "buy");
    expect(buys.length).toBe(1);
    const prezzo = sc.ctx.data.currentPrice("AAA")!;
    expect(buys[0]!.qty).toBe(quantita(prezzo, 100_000, 100_000, 0.2, 0.99));
    expect(buys[0]!.qty).toBeGreaterThan(0);
    rmRoot(sc.ctx.paths);
  });

  test("5. testimone scritto a metà: il processo muore mentre salva state/baton.json", async () => {
    const paths = tempRoot("testimone");
    for (const ms of [120, 260, 410, 555, 700, 880]) {
      const f = lancia(paths.root, APERTURA, "testimone");
      await f.attendi("SCRIVO");
      await Bun.sleep(ms);
      f.proc.kill(9);
      await f.proc.exited;
      const r = leggiTestimone(paths);
      expect(r.testimone).not.toBeNull();
      expect(r.allarme ?? "").not.toContain("corrotto");
      expect(() => JSON.parse(fs.readFileSync(paths.baton, "utf8"))).not.toThrow();
    }
    const avanzi = fs.readdirSync(paths.state).filter((x) => x.includes(".tmp-"));
    // il salvataggio è atomico: al massimo restano file temporanei, mai un testimone a metà
    console.log(`file temporanei rimasti dopo 6 kill: ${avanzi.length}`);
    rmRoot(paths);
  }, 120_000);

  function giornata6() {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    return sc;
  }
  async function primaParte(sc: ReturnType<typeof scenario>) {
    for (const t of ["briefing", "apertura"] as const) {
      const s = sc.slot(t);
      sc.setNowAt(s);
      await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    }
    // una posizione con il prezzo già sotto lo stop: a mercato aperto verrebbe venduta
    sc.ctx.broker.seedPosition("ZZZ", 10, 50, { price: 40 });
    sc.ctx.data.priceOverrides.set("ZZZ", 40);
    aggiornaPiani(sc.ctx.paths, (p) => (p.ZZZ = { simbolo: "ZZZ", tradeId: "T-z", modalita: "bracket", stop: 45, takeProfit: 60, trailingPct: null, trailPrice: null, massimo: 51, ingresso: 50, quantita: 10, origine: "iniziale", creato: sc.ctx.now().toISOString(), aggiornato: sc.ctx.now().toISOString(), chiudiAllApertura: null, paramsVersione: "v1" }));
    return sc.ctx.broker.createdOrders().length;
  }
  test("6a. orologio, solo pianificatore: il tick delle 22:05 non recupera la chiusura; il briefing dopo la segnala saltata", async () => {
    const sc = giornata6();
    const prima = await primaParte(sc);
    sc.ctx.setNow("2026-11-24T21:05:00Z"); // 22:05 Roma = 16:05 New York: mercato chiuso, chiusura prevista alle 21:30
    const t = await tick(sc.ctx, { echo: false });
    expect(t.fatto).toContain("nessuna sveglia dovuta");
    expect(sc.ctx.broker.createdOrders().length).toBe(prima);
    sc.ctx.setNow("2026-11-25T08:31:00Z");
    const b = await tick(sc.ctx, { echo: false });
    expect(b.esito?.allarmi.join(" ")).toMatch(/Sveglie saltate:.*chiusura/);
    // e la mattina dopo la vendita si rimanda all'apertura: il briefing non vende mai
    expect((await sc.ctx.broker.getPositions()).some((p) => p.symbol === "ZZZ")).toBe(true);
    rmRoot(sc.ctx.paths);
  }, 60_000);
  test("6b. orologio, lanciata a mano alle 22:05: nessun ordine a mercato chiuso; la chiusura saltata si segnala una volta", async () => {
    const sc = giornata6();
    const prima = await primaParte(sc);
    sc.ctx.setNow("2026-11-24T21:05:00Z");
    const o = await once(sc.ctx, "chiusura", false);
    expect(o.ok).toBe(true);
    expect(o.esito!.allarmi.join(" ")).toMatch(/Sveglie saltate:.*chiusura/);
    expect(sc.ctx.broker.createdOrders().slice(prima).filter((x) => x.type === "market").length).toBe(0);
    expect((await sc.ctx.broker.getPositions()).some((p) => p.symbol === "ZZZ")).toBe(true);
    sc.ctx.setNow("2026-11-25T08:31:00Z");
    const b = await tick(sc.ctx, { echo: false });
    expect(b.esito?.allarmi.join(" ") ?? "").not.toMatch(/Sveglie saltate:.*chiusura/); // già segnalata: non si ripete
    rmRoot(sc.ctx.paths);
  }, 60_000);
});
