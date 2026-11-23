import { describe, expect, test } from "bun:test";
import { avviaDashboard } from "../src/dashboard/server.ts";
import { chiudi, nuovoCodice } from "../src/dashboard/azioni.ts";
import { aggrega, csvSpaccato, filtra, spaccatoTask, estremi } from "../src/dashboard/consumi.ts";
import { acquireLock } from "../src/run/lock.ts";
import { eseguiSveglia } from "../src/run/sveglia.ts";
import { leggiPiani } from "../src/run/piani.ts";
import { appendUsage, readUsage, type RigaConsumo } from "../src/brain/usage.ts";
import { _resetSecretsForTest, registerSecret } from "../src/util/redact.ts";
import { scenario } from "./scenario.ts";
import { makeCtx } from "./ctx.ts";
import { rmRoot } from "./helpers.ts";

const PWD = "password-di-prova-123";

async function avvia(ctx = makeCtx({ now: "2026-11-24T15:00:00Z" })) {
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const d = avviaDashboard(ctx, { password: PWD, porta, pollerMs: null });
  const base = `http://127.0.0.1:${porta}`;
  const login = async () => {
    const r = await fetch(`${base}/accedi`, { method: "POST", body: new URLSearchParams({ password: PWD }), redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" } });
    const sid = /sid=([a-f0-9]+)/.exec(r.headers.get("set-cookie") ?? "")![1]!;
    const page = await (await fetch(`${base}/impostazioni`, { headers: { cookie: `sid=${sid}` } })).text();
    const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(page)![1]!;
    return { sid, csrf, cookie: `sid=${sid}` };
  };
  return { ctx, d, base, login };
}

describe("dashboard: sicurezza (test 12, 47, 11)", () => {
  test("senza sessione → 401; senza token CSRF → 403; ascolta solo su 127.0.0.1", async () => {
    const { d, base, login, ctx } = await avvia();
    expect(d.server.hostname).toBe("127.0.0.1");
    expect((await fetch(`${base}/`)).status).toBe(401);
    expect((await fetch(`${base}/consumi`)).status).toBe(401);
    expect((await fetch(`${base}/consumi.csv`)).status).toBe(401);
    expect((await fetch(`${base}/azione/pausa`, { method: "POST", body: "attiva=si" })).status).toBe(401);
    const s = await login();
    expect((await fetch(`${base}/`, { headers: { cookie: s.cookie } })).status).toBe(200);
    const noCsrf = await fetch(`${base}/azione/pausa`, { method: "POST", body: new URLSearchParams({ attiva: "si" }), headers: { cookie: s.cookie, "content-type": "application/x-www-form-urlencoded" }, redirect: "manual" });
    expect(noCsrf.status).toBe(403);
    const ok = await fetch(`${base}/azione/pausa`, { method: "POST", body: new URLSearchParams({ attiva: "si", csrf: s.csrf }), headers: { cookie: s.cookie, "content-type": "application/x-www-form-urlencoded" }, redirect: "manual" });
    expect(ok.status).toBe(303);
    // host non locale (DNS rebinding) → rifiutato
    expect((await fetch(`${base}/`, { headers: { host: "evil.example:80" } })).status).toBe(421);
    d.stop();
    rmRoot(ctx.paths);
  });
  test("accesso da un browser vero: Origin null (same-origin) ammesso, origini estranee rifiutate", async () => {
    const { d, base, ctx } = await avvia();
    const post = (h: Record<string, string>) => fetch(`${base}/accedi`, { method: "POST", redirect: "manual", body: new URLSearchParams({ password: PWD }), headers: { "content-type": "application/x-www-form-urlencoded", ...h } }).then((r) => r.status);
    expect(await post({ origin: "null", "sec-fetch-site": "same-origin" })).toBe(303);
    expect(await post({ origin: base, "sec-fetch-site": "same-origin" })).toBe(303);
    expect(await post({ origin: "null", "sec-fetch-site": "cross-site" })).toBe(403);
    expect(await post({ origin: "http://evil.example", "sec-fetch-site": "cross-site" })).toBe(403);
    const pagina = await fetch(`${base}/`);
    expect(pagina.headers.get("referrer-policy")).toBe("same-origin");
    d.stop();
    rmRoot(ctx.paths);
  });
  test("password sbagliata → 401; il cookie è HttpOnly e SameSite=Strict", async () => {
    const { d, base, ctx } = await avvia();
    const r = await fetch(`${base}/accedi`, { method: "POST", body: new URLSearchParams({ password: "no" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.status).toBe(401);
    const ok = await fetch(`${base}/accedi`, { method: "POST", body: new URLSearchParams({ password: PWD }), redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(ok.headers.get("set-cookie")).toContain("HttpOnly");
    expect(ok.headers.get("set-cookie")).toContain("SameSite=Strict");
    d.stop();
    rmRoot(ctx.paths);
  });
  test("nessun segreto nelle pagine, anche con un errore che lo contiene", async () => {
    _resetSecretsForTest();
    registerSecret(PWD);
    registerSecret("PKSEGRETISSIMA99");
    const { d, base, login, ctx } = await avvia();
    ctx.broker.faults.down = true;
    const s = await login();
    ctx.log.error("prova", { msg: "errore con PKSEGRETISSIMA99" });
    for (const p of ["/", "/selezione", "/storico", "/ombra", "/review", "/impostazioni", "/consumi"]) {
      const t = await (await fetch(`${base}${p}`, { headers: { cookie: s.cookie } })).text();
      expect(t).not.toContain(PWD);
      expect(t).not.toContain("PKSEGRETISSIMA99");
    }
    d.stop();
    rmRoot(ctx.paths);
  });
  test("tutte le pagine si aprono con una posizione e dati reali finti", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    const { d, base, login } = await avvia(sc.ctx);
    const s = await login();
    for (const p of ["/", "/posizione/AAA", "/selezione", "/selezione/AAA", "/storico", "/ombra", "/review", "/impostazioni", "/consumi", `/log/${ap.id}`]) {
      const r = await fetch(`${base}${p}`, { headers: { cookie: s.cookie } });
      expect(r.status).toBe(200);
      const t = await r.text();
      expect(t).not.toContain("Errore interno");
    }
    const pan = await (await fetch(`${base}/`, { headers: { cookie: s.cookie } })).text();
    expect(pan).toContain("AAA");
    expect(pan).toContain("SPY");
    d.stop();
    rmRoot(sc.ctx.paths);
  });
});

describe("azioni manuali (test 29, 30, 42)", () => {
  test("doppio clic su \"Chiudi ora\" → un solo ordine", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    const ap = sc.slot("apertura");
    sc.setNowAt(ap, 30);
    await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    const codice = nuovoCodice(sc.ctx.now());
    const [a, b] = await Promise.all([chiudi(sc.ctx, "AAA", codice), chiudi(sc.ctx, "AAA", codice)]);
    expect(a.ok || b.ok).toBe(true);
    expect(sc.ctx.broker.createdOrders((o) => o.side === "sell" && o.type === "market").length).toBe(1);
    expect(await sc.ctx.broker.getPositions()).toEqual([]);
    // lo stesso modulo inviato di nuovo più tardi: nessun nuovo ordine
    const c = await chiudi(sc.ctx, "AAA", codice);
    expect(c.messaggio).toMatch(/già/);
    expect(sc.ctx.broker.createdOrders((o) => o.side === "sell" && o.type === "market").length).toBe(1);
    rmRoot(sc.ctx.paths);
  });
  test("azione manuale durante una sveglia → \"bot occupato\"", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    sc.ctx.broker.seedPosition("AAA", 5, 50, { price: 51 });
    const lk = await acquireLock(sc.ctx.paths.runLock, { holder: "sveglia", runId: "x", probe: sc.ctx.probe, now: sc.ctx.now });
    expect(lk.ok).toBe(true);
    const r = await chiudi(sc.ctx, "AAA", nuovoCodice(sc.ctx.now()), 200);
    expect(r.messaggio).toContain("Bot occupato");
    if (lk.ok) lk.lock.release();
    rmRoot(sc.ctx.paths);
  });
  test("\"Chiudi ora\" a mercato chiuso → chiudi all'apertura; protezione attiva; vendita all'apertura", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    sc.ctx.setNow("2026-11-24T23:00:00Z"); // sera: mercato chiuso
    const r = await chiudi(sc.ctx, "AAA", nuovoCodice(sc.ctx.now()));
    expect(r.ok).toBe(true);
    expect(r.messaggio).toContain("apertura");
    expect(leggiPiani(sc.ctx.paths).piani.AAA!.chiudiAllApertura).not.toBeNull();
    expect(sc.ctx.broker.openOrders("AAA").some((o) => o.type === "stop")).toBe(true);
    expect((await sc.ctx.broker.getPositions()).length).toBe(1);
    const ap2 = sc.slot("apertura", "2026-11-25");
    sc.setNowAt(ap2);
    await eseguiSveglia(sc.ctx, { slot: ap2, forzata: false });
    expect(await sc.ctx.broker.getPositions()).toEqual([]);
    expect(sc.ctx.broker.createdOrders((o) => o.clientOrderId.includes("-manual-")).length).toBe(1);
    rmRoot(sc.ctx.paths);
  });
});

function riga(ts: string, task: string, costo: number | null, esito: RigaConsumo["esito"] = "ok"): RigaConsumo {
  return { ts, runId: "r", task, modello: "m", esito, durataMs: 1000, durataApiMs: 800, turni: 2, token: costo === null ? null : { input: 100, output: 50, cacheLettura: 30, cacheScrittura: 20 }, costoUsd: costo, perModello: costo === null ? {} : { m: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 30, cacheCreationInputTokens: 20, costUSD: costo } }, promptByte: 10, forzata: false, subtype: null };
}

describe("consumi AI (test 44, 47)", () => {
  test("00:30 ora di Roma va nel giorno giusto anche nei giorni di cambio dell'ora", () => {
    // 29/03/2026 00:30 Roma = 28/03 23:30 UTC; 25/10/2026 00:30 Roma = 24/10 22:30 UTC
    const rows = [riga("2026-03-28T23:30:00Z", "decisione-apertura", 0.1), riga("2026-10-24T22:30:00Z", "decisione-apertura", 0.1)];
    expect(filtra(rows, { da: "2026-03-29", a: "2026-03-29" }).length).toBe(1);
    expect(filtra(rows, { da: "2026-10-25", a: "2026-10-25" }).length).toBe(1);
    expect(filtra(rows, { da: "2026-03-28", a: "2026-03-28" }).length).toBe(0);
  });
  test("la somma delle tipologie coincide con il totale; le non misurate si contano ma non si sommano", () => {
    const rows = [riga("2026-11-20T10:00:00Z", "decisione-apertura", 0.1), riga("2026-11-20T11:00:00Z", "review", 0.5), riga("2026-11-21T11:00:00Z", "decisione-briefing", null, "timeout"), riga("2026-11-21T12:00:00Z", "probe", 0.02)];
    const sp = spaccatoTask(rows);
    const somma = sp.righe.reduce((a, r) => ({ c: a.c + r.agg.chiamate, t: a.t + r.agg.token, k: a.k + r.agg.costo }), { c: 0, t: 0, k: 0 });
    expect(somma.c).toBe(sp.totale.chiamate);
    expect(somma.t).toBe(sp.totale.token);
    expect(somma.k).toBeCloseTo(sp.totale.costo, 10);
    expect(sp.totale.nonMisurate).toBe(1);
    expect(sp.totale.token).toBe(3 * 200);
    expect(aggrega(rows).fallite).toBe(1);
  });
  test("l'esportazione CSV riporta gli stessi numeri della tabella", async () => {
    const ctx = makeCtx({ now: "2026-11-24T15:00:00Z" });
    for (const r of [riga("2026-11-20T10:00:00Z", "decisione-apertura", 0.1234), riga("2026-11-23T11:00:00Z", "review", 0.5), riga("2026-11-23T12:00:00Z", "decisione-meta", null, "timeout")]) appendUsage(ctx.paths, r);
    const { d, base, login } = await avvia(ctx);
    const s = await login();
    const csv = await (await fetch(`${base}/consumi.csv?periodo=30g`, { headers: { cookie: s.cookie } })).text();
    const rows = filtra(readUsage(ctx.paths), estremi("30g", ctx.now()));
    expect(csv).toBe(csvSpaccato(rows, `${estremi("30g", ctx.now()).da}..${estremi("30g", ctx.now()).a}`));
    expect(csv).toContain('"TOTALE";"3";"1";"1";"400";"0.6234"');
    const page = await (await fetch(`${base}/consumi?periodo=30g`, { headers: { cookie: s.cookie } })).text();
    expect(page).toContain("0,623");
    d.stop();
    rmRoot(ctx.paths);
  });
});

import { maybeRunReview } from "../src/learning/review.ts";
import { FakeBrain } from "../src/brain/fake.ts";
import { saveParams, loadParams } from "../src/params/params.ts";
describe("dashboard: review cliccabili, impostazioni a schede, modello usato", () => {
  test("la review si apre dal suo elenco e mostra cosa è stato fatto", async () => {
    const ctx = makeCtx({ now: "2026-11-24T15:00:00Z", brain: new FakeBrain() });
    const rv = (await maybeRunReview(ctx, { force: true })).review!;
    const { d, base, login } = await avvia(ctx);
    const s = await login();
    const elenco = await (await fetch(`${base}/review`, { headers: { cookie: s.cookie } })).text();
    expect(elenco).toContain(`href="/review/${rv.id}"`);
    const r = await fetch(`${base}/review/${rv.id}`, { headers: { cookie: s.cookie } });
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).toContain("Cosa dice la review");
    expect(t).toContain("Cosa è stato provato");
    expect(t).toContain("Campione piccolo");
    d.stop();
    rmRoot(ctx.paths);
  });
  test("impostazioni: una scheda alla volta, con spiegazione della scheda e una «i» per parametro", async () => {
    const { d, base, login, ctx } = await avvia();
    const s = await login();
    const t = await (await fetch(`${base}/impostazioni?scheda=rischio`, { headers: { cookie: s.cookie } })).text();
    expect(t).toContain('name="p:rischio.peso"');
    expect(t).not.toContain('name="p:segnali.adxMin"'); // altra scheda: non c'è
    expect(t).toContain("Quanto si rischia");
    expect((t.match(/class="info"/g) ?? []).length).toBe(12);
    expect(t).toContain('aria-current="page">Rischio');
    // salvare dalla scheda torna alla stessa scheda
    const r = await fetch(`${base}/azione/parametri/salva`, { method: "POST", redirect: "manual", body: new URLSearchParams({ csrf: s.csrf, attesa: "1", scheda: "rischio", "p:rischio.gapMaxAtr": "1.5" }), headers: { cookie: s.cookie, "content-type": "application/x-www-form-urlencoded" } });
    expect(r.headers.get("location")).toBe("/impostazioni?scheda=rischio");
    expect(loadParams(ctx.paths).params.n("rischio.gapMaxAtr")).toBe(1.5);
    d.stop();
    rmRoot(ctx.paths);
  });
  test("modelli AI: Opus per le decisioni, Sonnet per i compiti semplici; con «predefinito» dice quale ha usato", async () => {
    const { d, base, login, ctx } = await avvia();
    const s = await login();
    let t = await (await fetch(`${base}/impostazioni?scheda=ai`, { headers: { cookie: s.cookie } })).text();
    expect(t).toContain("usa claude-opus-5-5");
    expect(t).toContain("usa claude-sonnet-5-5");
    saveParams(ctx.paths, { "ai.modelloSemplici": "predefinito" }, { autore: "test", versioneAttesa: loadParams(ctx.paths).params.file.versione });
    t = await (await fetch(`${base}/impostazioni?scheda=ai`, { headers: { cookie: s.cookie } })).text();
    expect(t).toContain("modello non ancora noto");
    appendUsage(ctx.paths, { ...riga("2026-11-24T08:31:00Z", "decisione-briefing", 0.01), perModello: { "claude-haiku-5-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.0001 }, "claude-sonnet-5-5": { inputTokens: 900, outputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.009 } } });
    t = await (await fetch(`${base}/impostazioni?scheda=ai`, { headers: { cookie: s.cookie } })).text();
    expect(t).toContain("predefinito: ha usato claude-sonnet-5-5");
    d.stop();
    rmRoot(ctx.paths);
  });
  test("menu: su telefono c'è il pulsante che apre l'elenco delle pagine", async () => {
    const { d, base, login, ctx } = await avvia();
    const s = await login();
    const t = await (await fetch(`${base}/`, { headers: { cookie: s.cookie } })).text();
    expect(t).toContain('class="menu-t"');
    expect(t).toContain('<label for="menu" class="menu-l">Menu</label>');
    const css = await (await fetch(`${base}/style.css`)).text();
    expect(css).toContain(".menu-t:checked~nav{display:flex}");
    expect((await fetch(`${base}/font/text.ttf`)).headers.get("content-type")).toBe("font/ttf");
    d.stop();
    rmRoot(ctx.paths);
  });
});

describe("dashboard: grafici bklit e motion", () => {
  test("il bundle del browser è servito e le pagine contengono le isole con il grafico di riserva", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    const { d, base, login } = await avvia(sc.ctx);
    const s = await login();
    const js = await fetch(`${base}/client.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await js.text()).length).toBeGreaterThan(100_000);
    expect((await fetch(`${base}/client.css`)).status).toBe(200);
    const t = await (await fetch(`${base}/`, { headers: { cookie: s.cookie } })).text();
    expect(t).toContain('<script type="module" src="/client.js"></script>');
    expect(t).toContain('data-bklit="torta"');
    expect(t).toMatch(/<div class="isola" data-bklit="[a-z]+" data-props="[^"]+"><div class="riserva"><svg/);
    d.stop();
    rmRoot(sc.ctx.paths);
  });
});

import { runScan } from "../src/scan/scan.ts";
import { readJsonSafe } from "../src/util/atomic.ts";
import type { Watchlist } from "../src/scan/scan.ts";
describe("dashboard: selezione dei titoli", () => {
  test("elenco con imbuto e settori; dettaglio con motivi, criteri, segnali e grafico (segnali calcolati sul momento)", async () => {
    const ctx = makeCtx({ now: "2026-11-21T09:00:00Z" });
    expect((await runScan(ctx)).ok).toBe(true);
    const wl = readJsonSafe<Watchlist>(ctx.paths.watchlist);
    if (!wl.ok) throw new Error("watchlist");
    const { d, base, login } = await avvia(ctx);
    const s = await login();
    const el = await (await fetch(`${base}/selezione`, { headers: { cookie: s.cookie } })).text();
    expect(el).toContain("Dall'universo agli acquistabili");
    expect(el).toContain("battono SPY");
    const primo = wl.value.acquistabili[0]!;
    expect(el).toContain(`href="/selezione/${primo.simbolo}"`);
    const r = await fetch(`${base}/selezione/${primo.simbolo}`, { headers: { cookie: s.cookie } });
    expect(r.status).toBe(200);
    const det = await r.text();
    expect(det).toContain("Perché è stato scelto");
    expect(det).toContain(primo.criteri[0]!.nome);
    expect(det).toContain("Segnali tecnici");
    expect(det).toContain("calcolati ora sulle candele chiuse");
    expect(det).toContain('data-bklit="linee"');
    expect(det).not.toContain("Errore interno");
    // titolo fuori selezione: pagina chiara, non un errore
    const fuori = await (await fetch(`${base}/selezione/ZZZZ`, { headers: { cookie: s.cookie } })).text();
    expect(fuori).toContain("non è nella selezione");
    d.stop();
    rmRoot(ctx.paths);
  });
});
