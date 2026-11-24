// Regressioni dei problemi trovati dalla revisione esterna (24/11/2026): ognuno ha il suo test, così non torna.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { tick, once } from "../src/run/tick.ts";
import { eseguiSveglia, leggiStatoSveglie } from "../src/run/sveglia.ts";
import { slotsDelGiorno } from "../src/run/calendario.ts";
import { fakeCalendar } from "../src/data/calendario-finto.ts";
import { loadParams } from "../src/params/params.ts";
import { leggiOverride, modificaOverride } from "../src/scan/override.ts";
import { loadSecrets } from "../src/config/segreti.ts";
import { scriviSegreti } from "../src/setup/segreti-file.ts";
import { avviaConfigurazione } from "../src/setup/server-configurazione.ts";
import { readJsonSafe, writeJsonAtomic } from "../src/util/atomic.ts";
import type { Watchlist } from "../src/scan/scan.ts";
import { scenario } from "./scenario.ts";
import { aliveProbe } from "./ctx.ts";
import { rmRoot } from "./helpers.ts";

const SEDUTA = "2026-11-24";
const roma = (hhmm: string, giorno = SEDUTA) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(Number(giorno.slice(0, 4)), Number(giorno.slice(5, 7)) - 1, Number(giorno.slice(8, 10)), h! - 1, m!));
};
const slot = (sc: ReturnType<typeof scenario>, tipo: string) => slotsDelGiorno(fakeCalendar(SEDUTA, SEDUTA)[0]!, loadParams(sc.ctx.paths).params).find((s) => s.tipo === tipo)!;
const acquisti = async (sc: ReturnType<typeof scenario>) => (await sc.ctx.broker.listOrders({ status: "all" })).filter((o) => o.side === "buy").length;

describe("recupero: problemi della revisione", () => {
  test("avvio alle 19:30: si recupera l'apertura e basta, la metà seduta non segue a ruota", async () => {
    const sc = scenario();
    sc.ctx.setNow(roma("19:30").toISOString());
    expect((await tick(sc.ctx, { echo: false })).esito?.tipo).toBe("apertura");
    sc.ctx.setNow(roma("19:31").toISOString());
    expect((await tick(sc.ctx, { echo: false })).fatto).toBe("nessuna sveglia dovuta");
    expect(leggiStatoSveglie(sc.ctx).eseguite.map((x) => x.tipo)).toEqual(["apertura"]);
    rmRoot(sc.ctx.paths);
  });
  test("apertura lanciata a mano alle 17:00 (once): il tick dopo non la recupera, niente secondo giro di acquisti", async () => {
    const sc = scenario();
    sc.ctx.setNow(roma("17:00").toISOString());
    const o = await once(sc.ctx, "apertura", false);
    expect(o.esito?.runId.endsWith("f")).toBe(true); // id forzato distinto da quello previsto
    const dopoOnce = await acquisti(sc);
    sc.ctx.setNow(roma("17:01").toISOString());
    expect((await tick(sc.ctx, { echo: false })).fatto).toBe("nessuna sveglia dovuta");
    expect(await acquisti(sc)).toBe(dopoOnce);
    rmRoot(sc.ctx.paths);
  });
  test("una sveglia forzata alle 15:40 non prende l'id dell'apertura prevista", async () => {
    const sc = scenario();
    sc.ctx.setNow(roma("15:40").toISOString());
    const o = await once(sc.ctx, "meta", true);
    expect(o.esito?.runId).not.toBe(slot(sc, "apertura").id);
    rmRoot(sc.ctx.paths);
  });
  test("lock bloccato (processo vivo, battito fermo): il recupero non manda un allarme a ogni tick", async () => {
    const sc = scenario({ probe: aliveProbe(new Set([process.pid, 4242])) });
    const vecchio = roma("16:00").toISOString();
    fs.mkdirSync(path.dirname(sc.ctx.paths.runLock), { recursive: true });
    fs.writeFileSync(sc.ctx.paths.runLock, JSON.stringify({ pid: 4242, procStart: 1, holder: "sveglia", runId: "appesa", started: vecchio, heartbeat: vecchio, pendingOrderIds: [] }));
    for (const m of ["17:00", "17:01", "17:02"]) {
      sc.ctx.setNow(roma(m).toISOString());
      expect((await tick(sc.ctx, { echo: false })).esito?.motivo).toBe("bloccata");
    }
    expect(sc.ctx.sent.length).toBe(0);
    rmRoot(sc.ctx.paths);
  });
  test("recupero interrotto da un processo ucciso: si riprende una volta, poi basta", async () => {
    const sc = scenario();
    const id = slot(sc, "apertura").id;
    // come se un recupero fosse partito e il processo fosse morto prima della fine (tentato, non concluso)
    writeJsonAtomic(sc.ctx.paths.sveglie, { eseguite: [], saltateSegnalate: [], recuperiTentati: [id] });
    sc.ctx.setNow(roma("17:00").toISOString());
    const r = await tick(sc.ctx, { echo: false });
    expect(r.esito?.eseguita).toBe(true);
    // due avvii registrati: un terzo non ci sarà, anche se cancellassi l'esecuzione
    const st = leggiStatoSveglie(sc.ctx);
    expect(st.recuperiTentati!.filter((x) => x === id).length).toBe(2);
    writeJsonAtomic(sc.ctx.paths.sveglie, { ...st, eseguite: [], recuperiConclusi: [] });
    sc.ctx.setNow(roma("17:05").toISOString());
    expect((await tick(sc.ctx, { echo: false })).fatto).toBe("nessuna sveglia dovuta");
    rmRoot(sc.ctx.paths);
  });
});

describe("override: file illeggibile", () => {
  test("niente acquisti con un allarme, e la dashboard non lo sovrascrive cancellando gli altri override", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    fs.writeFileSync(sc.ctx.paths.overrideSelezione, "{ rotto");
    expect(leggiOverride(sc.ctx.paths).errore).toBeTruthy();
    const wl = readJsonSafe<Watchlist>(sc.ctx.paths.watchlist).value as Watchlist;
    expect(modificaOverride(sc.ctx.paths, "rimuovi", "AAA", wl, new Date()).ok).toBe(false);
    expect(fs.readFileSync(sc.ctx.paths.overrideSelezione, "utf8")).toBe("{ rotto");
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    const r = await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    expect(r.inviati.filter((x) => x.azione === "compra")).toEqual([]);
    expect(r.allarmi.join(" ")).toContain("override");
    rmRoot(sc.ctx.paths);
  });
});

describe("configurazione: problemi della revisione", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "indiano-rev-"));
  test("un secrets.ts che importa un file mancante non è «assente»: si segnala e non si sovrascrive", async () => {
    const d = dir();
    const f = path.join(d, "secrets.ts");
    fs.writeFileSync(f, `import { chiavi } from "./chiavi-private.ts";\nexport const secrets = chiavi;\n`);
    await expect(loadSecrets(f)).rejects.toThrow("non leggibile");
    expect(await loadSecrets(path.join(d, "non-esiste.ts"))).toBeNull();
    fs.rmSync(d, { recursive: true, force: true });
  });
  test("riscrivendo un secrets.ts incompleto resta una copia di prima, e nessun file temporaneo", () => {
    const d = dir();
    const f = path.join(d, "secrets.ts");
    fs.writeFileSync(f, "// mio commento\nexport const secrets = {};\n");
    scriviSegreti({ alpacaKeyId: "PK1", alpacaSecretKey: "s", finnhubApiKey: "f", telegramBotToken: "", telegramChatId: "", dashboardPassword: "una password lunga", claudeOauthToken: "" }, f);
    expect(fs.readFileSync(`${f}.prima-della-configurazione`, "utf8")).toContain("mio commento");
    expect(fs.readdirSync(d).sort()).toEqual(["secrets.ts", "secrets.ts.prima-della-configurazione"]);
    fs.rmSync(d, { recursive: true, force: true });
  });

  async function server() {
    const d = dir();
    const porta = 30000 + Math.floor(Math.random() * 20000);
    const c = avviaConfigurazione({ porta, esistenti: null, file: path.join(d, "secrets.ts"), fetch: async () => new Response("{}"), codice: "ABCD-EFGH", alTermine: () => {} });
    const base = `http://127.0.0.1:${porta}`;
    return { base, ferma: () => { c.stop(); fs.rmSync(d, { recursive: true, force: true }); } };
  }
  const entra = async (base: string, codice = "ABCD-EFGH") => {
    const r = await fetch(`${base}/configurazione?codice=${encodeURIComponent(codice)}`, { redirect: "manual", headers: { "sec-fetch-site": "none", "sec-fetch-dest": "document" } });
    return { status: r.status, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0]! };
  };
  test("un'altra pagina web (immagine o link da un altro sito) non consuma i tentativi e non blocca il codice", async () => {
    const s = await server();
    for (let i = 0; i < 15; i++) await fetch(`${s.base}/configurazione?codice=X${i}`, { headers: { "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" } });
    expect((await entra(s.base)).status).toBe(303);
    s.ferma();
  });
  test("cento codici sbagliati in parallelo fanno scattare il blocco anche per quello giusto", async () => {
    const s = await server();
    await Promise.all(Array.from({ length: 100 }, (_, i) => fetch(`${s.base}/configurazione/codice`, { method: "POST", body: new URLSearchParams({ codice: `X${i}` }), headers: { "content-type": "application/x-www-form-urlencoded" } })));
    const r = await fetch(`${s.base}/configurazione/codice`, { method: "POST", redirect: "manual", body: new URLSearchParams({ codice: "ABCD-EFGH" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.status).toBe(401);
    s.ferma();
  });
  test("codice con caratteri non ASCII: rifiutato, non un errore 500; metodi diversi da GET e POST: 405", async () => {
    const s = await server();
    expect((await entra(s.base, "ÀBCD-EFGH")).status).toBe(401);
    expect((await fetch(`${s.base}/configurazione`, { method: "PUT" })).status).toBe(405);
    s.ferma();
  });
  test("rientrare con il codice non butta fuori la sessione già aperta", async () => {
    const s = await server();
    const a = await entra(s.base);
    await entra(s.base);
    const pagina = await (await fetch(`${s.base}/configurazione/password`, { headers: { cookie: a.cookie } })).text();
    expect(pagina).toContain('name="csrf"');
    s.ferma();
  });
});
