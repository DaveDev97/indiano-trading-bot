// Configurazione guidata al primo avvio: avvocato del diavolo su file, verifiche e server.
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { campiMancanti, mancantiPerMotore, scriviSegreti, testoSegreti, valoriDa, type Valori } from "../src/setup/segreti-file.ts";
import { messaggioProva, trovaChat, verificaAlpaca, verificaClaude, verificaFinnhub, verificaTelegram, type EseguiComando, type Fetch } from "../src/setup/verifiche.ts";
import { interpretaUscita } from "../src/brain/claude.ts";
import { avviaConfigurazione } from "../src/setup/server-configurazione.ts";
import { redact } from "../src/util/redact.ts";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "indiano-cfg-"));
const KEY = "PKTESTCHIAVE1234567890";
const SECRET = "segreto-alpaca-moltolungo-123456";
const FINN = "finnhubchiave123456";
const TOKEN = "123456789:AAHsegretissimoTokenDiProva_abcdefghij";
const PWD = 'pass "con" \\ barre ${x} </script> e accenti è';

const valori = (p: Partial<Valori> = {}): Valori => ({ alpacaKeyId: KEY, alpacaSecretKey: SECRET, finnhubApiKey: FINN, telegramBotToken: TOKEN, telegramChatId: "424242", dashboardPassword: PWD, claudeOauthToken: "", ...p });

/** Fetch finto: risponde come i servizi veri e registra le chiamate. */
function finto(opt: { alpaca?: number; finnhub?: number; aggiornamenti?: unknown[]; getMe?: boolean; rete?: boolean } = {}) {
  const chiamate: string[] = [];
  const f: Fetch = async (url, init) => {
    chiamate.push(url);
    if (opt.rete) throw new Error(`connessione rifiutata verso ${url}`);
    const j = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
    if (url.includes("paper-api.alpaca.markets")) {
      const h = new Headers(init?.headers);
      if ((opt.alpaca ?? 200) !== 200 || h.get("APCA-API-KEY-ID") !== KEY) return j(opt.alpaca ?? 401, { message: "forbidden" });
      return j(200, { status: "ACTIVE", equity: "100000", currency: "USD" });
    }
    if (url.includes("finnhub.io")) return (opt.finnhub ?? 200) === 200 ? j(200, { name: "Apple Inc" }) : j(opt.finnhub!, { error: "x" });
    if (url.includes("/getMe")) return opt.getMe === false ? j(401, { ok: false }) : j(200, { ok: true, result: { username: "prova_bot", first_name: "Prova" } });
    if (url.includes("/getUpdates")) return j(200, { ok: true, result: opt.aggiornamenti ?? [] });
    if (url.includes("/sendMessage")) return j(200, { ok: true });
    return j(404, {});
  };
  return { f, chiamate };
}
/** `claude` finto: risponde a --version, auth status, -p --help e alla domanda di prova. Mai il comando vero. */
function claudeFinto(opt: { loggedIn?: boolean; risposta?: unknown } = {}) {
  const chiamate: { cmd: string[]; env?: Record<string, string>; cwd?: string }[] = [];
  const esegui: EseguiComando = async (cmd, o = {}) => {
    chiamate.push({ cmd, env: o.env, cwd: o.cwd });
    if (cmd[1] === "--version") return { codice: 0, uscita: "2.1.330 (Claude Code)\naltro" };
    if (cmd[1] === "auth") return { codice: opt.loggedIn === false ? 1 : 0, uscita: JSON.stringify({ loggedIn: opt.loggedIn ?? true, authMethod: "claude.ai" }) };
    if (cmd[2] === "--help") return { codice: 0, uscita: "--tools <tools>  --no-session-persistence  --max-turns" };
    const r = (opt.risposta ?? { type: "result", subtype: "success", is_error: false, result: "ok" }) as { is_error?: boolean };
    return { codice: r.is_error ? 1 : 0, uscita: JSON.stringify(r) };
  };
  return { esegui, chiamate };
}
const msg = (id: number, nome: string, type = "private") =>({ message: { chat: { id, type, first_name: nome } } });

describe("file dei segreti", () => {
  test("campi mancanti: nomi leggibili, Telegram e Claude facoltativi, password di almeno 12 caratteri", () => {
    expect(campiMancanti(null).length).toBe(4);
    const s = { alpaca: { keyId: KEY, secretKey: SECRET }, telegram: { botToken: "", chatId: "" }, finnhub: { apiKey: FINN }, dashboard: { password: "corta" }, claude: { oauthToken: "" } };
    expect(campiMancanti(s)).toEqual(["password della dashboard"]);
    expect(mancantiPerMotore(s)).toEqual([]);
    expect(campiMancanti({ ...s, alpaca: { keyId: "   ", secretKey: SECRET } })).toContain("chiave Alpaca (Key ID)");
  });
  test("valori ostili (virgolette, barre, ${}, </script>, a capo Unicode) non rompono il file e tornano identici", async () => {
    const d = dir();
    const file = path.join(d, "secrets.ts");
    const v = valori({ claudeOauthToken: "tok" + String.fromCharCode(0x2028) + "en" });
    scriviSegreti(v, file);
    const mod = await import(file);
    expect(mod.secrets.dashboard.password).toBe(PWD);
    expect(mod.secrets.alpaca.keyId).toBe(KEY);
    expect(mod.secrets.claude.oauthToken).toBe("tok" + String.fromCharCode(0x2028) + "en");
    expect(valoriDa(mod.secrets)).toEqual(v);
    expect(fs.readdirSync(d)).toEqual(["secrets.ts"]); // niente file temporanei rimasti
    fs.rmSync(d, { recursive: true, force: true });
  });
  test("gli spazi attorno alle chiavi si tolgono, quelli della password no", () => {
    const t = testoSegreti(valori({ alpacaKeyId: `  ${KEY}\n`, dashboardPassword: "  spazi dentro e fuori  " }));
    expect(t).toContain(`keyId: "${KEY}"`);
    expect(t).toContain(`password: "  spazi dentro e fuori  "`);
  });
});

describe("verifiche delle chiavi", () => {
  test("Alpaca: chiave live (AK) rifiutata senza chiamare la rete; chiave non PK rifiutata; 401 spiegato", async () => {
    const a = finto();
    const live = await verificaAlpaca("AKLIVE123", SECRET, a.f);
    expect(live.ok).toBe(false);
    expect(a.chiamate).toEqual([]);
    expect((await verificaAlpaca("XX123", SECRET, a.f)).ok).toBe(false);
    const no = await verificaAlpaca(KEY, SECRET, finto({ alpaca: 401 }).f);
    expect(!no.ok && no.errore).toContain("rifiutato");
    const si = await verificaAlpaca(KEY, SECRET, a.f);
    expect(si.ok && si.info.stato).toBe("ACTIVE");
    expect(a.chiamate.every((u) => u.startsWith("https://paper-api.alpaca.markets/"))).toBe(true);
  });
  test("errore di rete: il messaggio non contiene mai la chiave (Finnhub la mette nell'URL)", async () => {
    const r = await verificaFinnhub(FINN, finto({ rete: true }).f);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errore).not.toContain(FINN);
      expect(redact(r.errore)).toBe(r.errore);
    }
    const t = await verificaTelegram(TOKEN, finto({ rete: true }).f);
    expect(!t.ok && t.errore).not.toContain(TOKEN);
  });
  test("Finnhub: 401, 429 e risposta vuota hanno ciascuno il suo messaggio", async () => {
    for (const [s, parola] of [[401, "rifiutato"], [429, "limite"]] as const) {
      const r = await verificaFinnhub(FINN, finto({ finnhub: s }).f);
      expect(!r.ok && r.errore).toContain(parola);
    }
  });
  test("Telegram: formato del token, chat private trovate (la più recente prima), gruppi ignorati, nessun messaggio spiegato", async () => {
    expect((await verificaTelegram("non-un-token", finto().f)).ok).toBe(false);
    expect((await verificaTelegram(TOKEN, finto({ getMe: false }).f)).ok).toBe(false);
    const vuoto = await trovaChat(TOKEN, finto().f);
    expect(!vuoto.ok && vuoto.errore).toContain("Avvia");
    const r = await trovaChat(TOKEN, finto({ aggiornamenti: [msg(1, "Anna"), msg(-100, "Gruppo", "group"), msg(2, "Bruno"), msg(1, "Anna")] }).f);
    expect(r.ok && r.info.chat).toEqual([{ id: "1", nome: "Anna" }, { id: "2", nome: "Bruno" }]);
    expect((await messaggioProva(TOKEN, "abc", finto().f)).ok).toBe(false);
    expect((await messaggioProva(TOKEN, "-1001234", finto().f)).ok).toBe(true);
  });
  test("Claude Code: assente, presente e con la domanda di prova riuscita", async () => {
    expect((await verificaClaude({ esegui: claudeFinto().esegui, trova: () => null })).ok).toBe(false);
    const f = claudeFinto();
    const ok = await verificaClaude({ esegui: f.esegui, trova: () => "claude" });
    expect(ok.ok && ok.info.versione).toBe("2.1.330 (Claude Code)");
    const prova = f.chiamate.find((c) => c.cmd[1] === "-p" && c.cmd[2] !== "--help")!;
    expect(prova.cmd).toContain("--tools");
    expect(prova.cwd).toBeTruthy(); // cartella vuota del cervello, fuori dal progetto
  });
  test("Claude Code installato ma senza accesso (come l'estensione di VS Code senza il comando collegato): errore con le istruzioni, senza domanda di prova", async () => {
    const f = claudeFinto({ loggedIn: false });
    const r = await verificaClaude({ esegui: f.esegui, trova: () => "claude" });
    expect(!r.ok && r.errore).toContain("claude auth login");
    expect(f.chiamate.some((c) => c.cmd[1] === "-p")).toBe(false);
  });
  test("token incollato: va nell'ambiente del processo; se Claude lo rifiuta, errore di accesso (auth status da solo direbbe «loggedIn»)", async () => {
    const f = claudeFinto({ risposta: { type: "result", subtype: "success", is_error: true, result: "Invalid API key · Please run /login" } });
    const r = await verificaClaude({ token: "sk-ant-oat01-finto", esegui: f.esegui, trova: () => "claude" });
    expect(!r.ok && r.errore).toContain("non accetta l'accesso con il token");
    expect(!r.ok && r.errore).not.toContain("sk-ant-oat01-finto");
    expect(f.chiamate.filter((c) => c.cmd[1] === "auth" || (c.cmd[1] === "-p" && c.cmd[2] !== "--help")).every((c) => c.env?.CLAUDE_CODE_OAUTH_TOKEN === "sk-ant-oat01-finto")).toBe(true);
  });
  test("solo controlli veloci (apertura della pagina): niente domanda di prova", async () => {
    const f = claudeFinto();
    expect((await verificaClaude({ esegui: f.esegui, trova: () => "claude", prova: false })).ok).toBe(true);
    expect(f.chiamate.some((c) => c.cmd[1] === "-p")).toBe(false);
  });
  test("il cervello senza accesso: l'allarme dice cosa fare", () => {
    const r = interpretaUscita(1, JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }), false, 10);
    expect(r.esito).toBe("errore");
    expect(r.errore).toContain("claude auth login");
  });
});

describe("server della configurazione", () => {
  async function avvia(opt: { esistenti?: any; fetch?: Fetch } = {}) {
    const d = dir();
    const file = path.join(d, "secrets.ts");
    const porta = 30000 + Math.floor(Math.random() * 20000);
    let finito = 0;
    const net = finto({ aggiornamenti: [msg(424242, "Io")] });
    const c = avviaConfigurazione({ porta, esistenti: opt.esistenti ?? null, file, fetch: opt.fetch ?? net.f, codice: "ABCD-EFGH", esegui: claudeFinto().esegui, trovaClaude: () => "claude", alTermine: () => finito++ });
    const base = `http://127.0.0.1:${porta}`;
    const corpi: string[] = [];
    let cookie = "";
    const get = async (p: string) => {
      const r = await fetch(`${base}${p}`, { headers: { cookie }, redirect: "manual" });
      const sc = r.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0]!;
      const t = await r.text();
      corpi.push(t);
      return { r, t };
    };
    const csrf = async (p = "/configurazione/password") => /name="csrf" value="([a-f0-9]+)"/.exec((await get(p)).t)?.[1] ?? "";
    const post = async (p: string, campi: Record<string, string>, h: Record<string, string> = {}) => {
      const r = await fetch(`${base}${p}`, { method: "POST", redirect: "manual", body: new URLSearchParams(campi), headers: { cookie, "content-type": "application/x-www-form-urlencoded", ...h } });
      const t = await r.text();
      corpi.push(t);
      return { r, t };
    };
    return { c, d, file, base, get, post, csrf, corpi, net, finiti: () => finito, ferma: () => { c.stop(); fs.rmSync(d, { recursive: true, force: true }); } };
  }

  test("senza codice non si imposta niente; codice sbagliato rifiutato; host e origine estranei rifiutati", async () => {
    const s = await avvia();
    expect((await s.get("/configurazione")).t).toContain("codice di configurazione");
    expect((await s.post("/configurazione/password", { pwd: "x".repeat(20), pwd2: "x".repeat(20) })).r.status).toBe(401);
    expect((await s.post("/configurazione/codice", { codice: "SBAGLIATO" })).r.status).toBe(401);
    expect((await fetch(`${s.base}/configurazione`, { headers: { host: "evil.example" } })).status).toBe(421);
    expect((await s.post("/configurazione/codice", { codice: "ABCD-EFGH" }, { origin: "http://evil.example" })).r.status).toBe(403);
    expect(fs.existsSync(s.file)).toBe(false);
    s.ferma();
  });

  test("percorso completo: codice, password, Alpaca, Finnhub, Telegram con chat trovata, Claude, salvataggio", async () => {
    const s = await avvia();
    expect((await s.get("/configurazione?codice=abcd-efgh")).r.status).toBe(303); // il codice si accetta anche minuscolo
    let t = await s.csrf();
    expect((await s.post("/configurazione/password", { pwd: PWD, pwd2: PWD })).r.status).toBe(403); // senza token CSRF
    expect((await s.post("/configurazione/password", { csrf: t, pwd: "corta", pwd2: "corta" })).r.status).toBe(400);
    expect((await s.post("/configurazione/password", { csrf: t, pwd: PWD, pwd2: PWD + "x" })).r.status).toBe(400);
    expect((await s.post("/configurazione/password", { csrf: t, pwd: PWD, pwd2: PWD })).r.status).toBe(303);
    // salvare troppo presto non si può
    expect((await s.post("/configurazione/salva", { csrf: t })).r.status).toBe(400);
    expect((await s.post("/configurazione/alpaca", { csrf: t, keyId: "AKLIVE", secretKey: SECRET })).r.status).toBe(400);
    expect((await s.post("/configurazione/alpaca", { csrf: t, keyId: KEY, secretKey: SECRET })).r.status).toBe(303);
    expect((await s.post("/configurazione/finnhub", { csrf: t, apiKey: FINN })).r.status).toBe(303);
    expect((await s.post("/configurazione/telegram", { csrf: t, azione: "cerca" })).r.status).toBe(400); // prima il token
    expect((await s.post("/configurazione/telegram", { csrf: t, azione: "token", token: TOKEN })).r.status).toBe(303);
    expect((await s.post("/configurazione/telegram", { csrf: t, azione: "cerca" })).r.status).toBe(303);
    expect(s.net.chiamate.some((u) => u.includes("/sendMessage"))).toBe(true);
    expect((await s.get("/configurazione/claude")).t).toContain("Claude Code trovato");
    expect((await s.get("/configurazione/riepilogo")).t).toContain("da controllare"); // senza la domanda di prova non è «pronto»
    expect((await s.post("/configurazione/claude", { csrf: t })).r.headers.get("location")).toBe("/configurazione/riepilogo");
    expect((await s.get("/configurazione/claude")).t).toContain("domanda di prova è riuscita");
    expect((await s.get("/configurazione/riepilogo")).t).toContain("Salva e avvia il bot");
    expect((await s.post("/configurazione/salva", { csrf: t })).r.status).toBe(200);
    const mod = await import(s.file);
    expect(mod.secrets.telegram.chatId).toBe("424242");
    expect(mod.secrets.dashboard.password).toBe(PWD);
    expect(campiMancanti(mod.secrets)).toEqual([]);
    await Bun.sleep(1500);
    expect(s.finiti()).toBe(1);
    // dopo il salvataggio la configurazione non accetta più niente
    expect((await s.post("/configurazione/password", { csrf: t, pwd: "y".repeat(20), pwd2: "y".repeat(20) })).t).toContain("Configurazione salvata");
    // nessuna pagina ha mai rimandato al browser una chiave o la password
    for (const c of s.corpi) for (const x of [KEY, SECRET, FINN, TOKEN, "segretissimo"]) expect(c).not.toContain(x);
    s.ferma();
  });

  test("secrets.ts incompleto: i valori presenti restano se lasci i campi vuoti, ma si verificano lo stesso", async () => {
    const s = await avvia({ esistenti: { alpaca: { keyId: KEY, secretKey: SECRET }, telegram: { botToken: "", chatId: "" }, finnhub: { apiKey: FINN }, dashboard: { password: "" }, claude: { oauthToken: "" } } });
    await s.get("/configurazione?codice=ABCD-EFGH");
    const t = await s.csrf();
    await s.post("/configurazione/password", { csrf: t, pwd: "una password lunga", pwd2: "una password lunga" });
    expect((await s.post("/configurazione/alpaca", { csrf: t, keyId: "", secretKey: "" })).r.status).toBe(303);
    expect((await s.post("/configurazione/finnhub", { csrf: t, apiKey: "" })).r.status).toBe(303);
    await s.post("/configurazione/telegram", { csrf: t, azione: "salta" });
    expect((await s.post("/configurazione/salva", { csrf: t })).r.status).toBe(200);
    const mod = await import(s.file);
    expect(mod.secrets.alpaca.secretKey).toBe(SECRET);
    expect(mod.secrets.telegram.botToken).toBe("");
    s.ferma();
  });

  test("chiavi rifiutate da Alpaca: niente salvataggio, e un secondo browser non ruba la sessione già aperta", async () => {
    const s = await avvia({ fetch: finto({ alpaca: 401 }).f });
    await s.get("/configurazione?codice=ABCD-EFGH");
    const t = await s.csrf();
    await s.post("/configurazione/password", { csrf: t, pwd: "una password lunga", pwd2: "una password lunga" });
    expect((await s.post("/configurazione/alpaca", { csrf: t, keyId: KEY, secretKey: SECRET })).r.status).toBe(400);
    expect((await s.post("/configurazione/salva", { csrf: t })).r.status).toBe(400);
    expect(fs.existsSync(s.file)).toBe(false);
    // un altro che non ha il codice non entra
    const altro = await fetch(`${s.base}/configurazione/riepilogo`, { redirect: "manual" });
    expect(await altro.text()).toContain("codice di configurazione");
    s.ferma();
  });

  test("dieci codici sbagliati bloccano i tentativi per qualche minuto", async () => {
    const s = await avvia();
    for (let i = 0; i < 10; i++) await s.post("/configurazione/codice", { codice: `X${i}` });
    const r = await s.post("/configurazione/codice", { codice: "ABCD-EFGH" });
    expect(r.r.status).toBe(401);
    expect(r.t).toContain("Troppi tentativi");
    s.ferma();
  }, 20_000);
});
