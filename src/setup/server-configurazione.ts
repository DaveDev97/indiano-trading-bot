// Configurazione guidata al primo avvio: password della dashboard, chiavi Alpaca (paper), Finnhub, bot Telegram
// creato con BotFather, Claude Code. Parte al posto della dashboard quando secrets.ts manca o è incompleto.
// Sicurezza: solo 127.0.0.1, host e origine controllati, token CSRF, e un codice monouso stampato nel terminale
// (chi apre la pagina senza il codice non può impostare niente). I valori non tornano mai al browser.
import * as path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { DASHBOARD_HOST } from "../config/costanti.ts";
import type { Secrets } from "../config/segreti.ts";
import { paperSafetyProblems } from "../config/segreti.ts";
import { CSS, JS, html, raw, type Safe } from "../dashboard/html.ts";
import { registerSecret } from "../util/redact.ts";
import { campiMancanti, FILE_SEGRETI, PASSWORD_MIN, scriviSegreti, valoriDa, type Valori } from "./segreti-file.ts";
import { messaggioProva, trovaChat, verificaAlpaca, verificaClaude, verificaFinnhub, verificaTelegram, type EseguiComando, type Fetch } from "./verifiche.ts";

export interface OpzioniConfigurazione {
  porta: number;
  esistenti: Secrets | null;
  file?: string;
  fetch?: Fetch;
  esegui?: EseguiComando;
  trovaClaude?: () => string | null;
  /** Solo per i test: codice monouso fisso. */
  codice?: string;
  /** Chiamata dopo il salvataggio: il processo si riavvia e parte la dashboard normale. */
  alTermine: () => void;
}

type Passo = "password" | "alpaca" | "finnhub" | "telegram" | "claude" | "riepilogo";
const PASSI: [Passo, string][] = [["password", "Password"], ["alpaca", "Alpaca"], ["finnhub", "Finnhub"], ["telegram", "Telegram"], ["claude", "Claude"], ["riepilogo", "Riepilogo"]];

interface Stato {
  v: Valori;
  alpaca: { stato: string; patrimonio: number | null; valuta: string | null } | null;
  finnhub: boolean;
  telegram: { username: string; nome: string } | null;
  chat: { id: string; nome: string }[] | null;
  chatProvata: boolean;
  telegramSaltato: boolean;
  /** ok = installato e con l'accesso fatto; provato = anche la domanda di prova a `claude -p` è riuscita. */
  claude: { ok: boolean; provato: boolean; testo: string } | null;
  salvato: boolean;
}

const rand = (n: number) => randomBytes(n).toString("hex");
const nuovoCodice = () => {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(8);
  const s = [...b].map((x) => alfabeto[x % alfabeto.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};
const uguali = (a: string, b: string) => {
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

export function avviaConfigurazione(o: OpzioniConfigurazione) {
  const file = o.file ?? FILE_SEGRETI;
  const f = o.fetch ?? fetch;
  const codice = o.codice ?? nuovoCodice();
  const hostOk = new Set<string>();
  const impostaHost = (porta: number) => {
    for (const h of ["127.0.0.1", "localhost"]) {
      hostOk.add(`${h}:${porta}`);
      if (porta === 80) hostOk.add(h);
    }
  };
  const sessioni = new Map<string, { csrf: string; creata: number }>();
  let tentativi = 0;
  let bloccoFino = 0;
  const v0 = valoriDa(o.esistenti);
  for (const x of Object.values(v0)) if (x) registerSecret(x);
  const st: Stato = { v: v0, alpaca: null, finnhub: false, telegram: null, chat: null, chatProvata: false, telegramSaltato: false, claude: null, salvato: false };
  // valori già presenti in secrets.ts (incompleto): valgono finché non li cambi, ma vanno comunque verificati
  const presente = (k: keyof Valori) => st.v[k].trim().length > 0;

  const intestazioni = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  };
  const risposta = (corpo: string, status = 200, extra: Record<string, string> = {}) => new Response(corpo, { status, headers: { ...intestazioni, ...extra } });
  const vai = (to: string, extra: Record<string, string> = {}) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", ...extra } });

  const completati = (): Record<Passo, boolean> => ({
    password: st.v.dashboardPassword.length >= PASSWORD_MIN,
    alpaca: !!st.alpaca,
    finnhub: st.finnhub,
    telegram: (!!st.telegram && !!st.v.telegramChatId && st.chatProvata) || st.telegramSaltato,
    claude: !!st.claude?.provato,
    riepilogo: st.salvato,
  });

  function pagina(titolo: string, passo: Passo | null, corpo: Safe, csrf: string | null, refresh?: string): string {
    const c = completati();
    const passi = passo ? html`<ol class="passi-config">${PASSI.map(([p, n], i) => html`<li class="${p === passo ? "qui" : c[p] ? "fatto" : ""}"><a href="/configurazione/${p}">${c[p] && p !== passo ? "✓ " : `${i + 1}. `}${n}</a></li>`)}</ol>` : raw("");
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ""}
<title>${titolo} · Configurazione · Indiano Trading</title><link rel="stylesheet" href="/style.css"></head><body>
<header><a class="brand" href="/configurazione">Indiano Trading</a><div class="testata-dx"><span class="stato">Configurazione iniziale</span></div></header>
<main class="configurazione">${passi.s}${corpo.s}</main><script src="/app.js"></script></body></html>`;
  }
  const errore = (e: string | null | undefined) => (e ? html`<div class="alarm">${e}</div>` : raw(""));
  const nota = (e: string | null | undefined) => (e ? html`<div class="note">${e}</div>` : raw(""));
  const avanti = (csrf: string, passo: Passo, testo = "Avanti") => html`<input type="hidden" name="csrf" value="${csrf}"><button class="primary">${testo}</button>`;
  const prossimo = (p: Passo): Passo => PASSI[Math.min(PASSI.length - 1, PASSI.findIndex((x) => x[0] === p) + 1)]![0];

  function vista(passo: Passo, csrf: string, msg: { errore?: string; nota?: string } = {}): string {
    const e = errore(msg.errore), n = nota(msg.nota);
    switch (passo) {
      case "password":
        return pagina("Password", passo, html`<h1>1. La password della dashboard</h1>
<p class="introduzione">Serve per entrare nella dashboard, la pagina da cui guardi e governi il bot. La dashboard si apre solo da questo computer (127.0.0.1). Scegli almeno ${PASSWORD_MIN} caratteri: una frase di quattro parole va benissimo.</p>${e}${n}
${completati().password ? html`<div class="note">Password già impostata. Puoi cambiarla qui sotto, oppure andare avanti.</div>` : ""}
<form method="post" action="/configurazione/password" class="card modulo"><label>Password<br><input type="password" name="pwd" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label>
<label>Ripeti la password<br><input type="password" name="pwd2" autocomplete="new-password" minlength="${PASSWORD_MIN}" required></label>${avanti(csrf, passo, "Salva la password")}</form>
${completati().password ? html`<p><a class="btn" href="/configurazione/alpaca">Avanti →</a></p>` : ""}`, csrf);
      case "alpaca":
        return pagina("Alpaca", passo, html`<h1>2. Il conto Alpaca (paper)</h1>
<p class="introduzione">Alpaca è il broker. Il bot usa solo il <b>conto paper</b>: soldi finti, mercato vero. Non serve versare niente.</p>
<ol class="guida-passi">
<li>Vai su <a href="https://alpaca.markets" target="_blank" rel="noopener noreferrer">alpaca.markets</a> e crea un account gratuito (bastano email e password).</li>
<li>Nella dashboard di Alpaca, in alto a sinistra, scegli il conto <b>Paper</b> (c'è scritto «Paper Trading»).</li>
<li>Nella pagina del conto paper trovi il riquadro <b>API Keys</b>: premi «Generate New Keys».</li>
<li>Copia la <b>Key ID</b> (inizia con <code>PK</code>) e la <b>Secret Key</b>. La Secret si vede una volta sola: se la perdi, rigenera le chiavi.</li></ol>
<p class="small muted">Le chiavi del conto reale iniziano con <code>AK</code>: il bot le rifiuta sempre.</p>${e}${n}
${st.alpaca ? html`<div class="note">✓ Chiavi verificate: conto paper ${st.alpaca.stato}${st.alpaca.patrimonio !== null ? html`, patrimonio ${st.alpaca.patrimonio.toLocaleString("it-IT")} ${st.alpaca.valuta ?? ""}` : ""}.</div>` : presente("alpacaKeyId") ? html`<div class="note">Ci sono già delle chiavi salvate: lascia i campi vuoti per verificarle così come sono.</div>` : ""}
<form method="post" action="/configurazione/alpaca" class="card modulo"><label>Key ID<br><input name="keyId" autocomplete="off" spellcheck="false" placeholder="PK…"></label>
<label>Secret Key<br><input type="password" name="secretKey" autocomplete="off" spellcheck="false"></label>${avanti(csrf, passo, "Verifica le chiavi")}</form>
${st.alpaca ? html`<p><a class="btn" href="/configurazione/finnhub">Avanti →</a></p>` : ""}`, csrf);
      case "finnhub":
        return pagina("Finnhub", passo, html`<h1>3. La chiave Finnhub</h1>
<p class="introduzione">Finnhub fornisce i bilanci delle società (utili, ricavi, debito…) che il bot usa per scegliere i titoli. Il piano gratuito basta.</p>
<ol class="guida-passi">
<li>Vai su <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer">finnhub.io</a> e registrati («Get free API key»).</li>
<li>Nella tua dashboard Finnhub trovi la voce <b>API Key</b>: copiala.</li></ol>${e}${n}
${st.finnhub ? html`<div class="note">✓ Chiave verificata.</div>` : presente("finnhubApiKey") ? html`<div class="note">C'è già una chiave salvata: lascia il campo vuoto per verificarla così com'è.</div>` : ""}
<form method="post" action="/configurazione/finnhub" class="card modulo"><label>API Key<br><input type="password" name="apiKey" autocomplete="off" spellcheck="false"></label>${avanti(csrf, passo, "Verifica la chiave")}</form>
${st.finnhub ? html`<p><a class="btn" href="/configurazione/telegram">Avanti →</a></p>` : ""}`, csrf);
      case "telegram": {
        const chat = st.chat;
        return pagina("Telegram", passo, html`<h1>4. Il bot Telegram</h1>
<p class="introduzione">Su Telegram ricevi i resoconti delle sveglie, gli allarmi e la review con i pulsanti Approva / Rifiuta. Il bot lo crei tu in un paio di minuti con <b>BotFather</b>, il bot ufficiale di Telegram per creare bot. È facoltativo: puoi saltare questo passo e farlo dopo.</p>
<ol class="guida-passi">
<li>Apri Telegram (sul telefono o sul computer) e cerca <b>@BotFather</b>, quello con la spunta blu, oppure apri <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">t.me/BotFather</a>.</li>
<li>Premi <b>Avvia</b> e scrivi <code>/newbot</code>.</li>
<li>Scegli un nome a piacere (ad esempio «Indiano Trading») e poi uno username che finisca con <code>bot</code> (ad esempio <code>indiano_mario_bot</code>).</li>
<li>BotFather risponde con il <b>token</b>, una riga come <code>123456789:AAH…</code>. Copialo nel campo qui sotto. Il token è come una password: non condividerlo.</li></ol>${e}${n}
<form method="post" action="/configurazione/telegram" class="card modulo"><input type="hidden" name="azione" value="token">
${st.telegram ? html`<div class="note">✓ Token verificato: il tuo bot è <b>@${st.telegram.username}</b>.</div>` : presente("telegramBotToken") ? html`<div class="note">C'è già un token salvato: lascia il campo vuoto per verificarlo così com'è.</div>` : ""}
<label>Token di BotFather<br><input type="password" name="token" autocomplete="off" spellcheck="false" placeholder="123456789:AA…"></label>${avanti(csrf, passo, "Verifica il token")}</form>
${st.telegram ? html`<div class="card"><h3>Collega la tua chat</h3>
<ol class="guida-passi"><li>Apri il tuo bot: <a href="https://t.me/${st.telegram.username}" target="_blank" rel="noopener noreferrer">t.me/${st.telegram.username}</a>.</li>
<li>Premi <b>Avvia</b> (o scrivi <code>/start</code>). Così il bot conosce la tua chat: è anche l'unica da cui accetterà i pulsanti.</li>
<li>Torna qui e premi «Trova la mia chat».</li></ol>
<form method="post" action="/configurazione/telegram" class="inline"><input type="hidden" name="azione" value="cerca">${avanti(csrf, passo, "Trova la mia chat")}</form>
${chat && chat.length > 1 && !st.chatProvata ? html`<form method="post" action="/configurazione/telegram" class="modulo" style="margin-top:12px"><input type="hidden" name="azione" value="scegli"><p>Hanno scritto al bot più chat: scegli la tua.</p>${chat.map((c, i) => html`<label class="riga-scelta"><input type="radio" name="chat" value="${c.id}"${i === 0 ? raw(" checked") : ""}> ${c.nome}</label>`)}${avanti(csrf, passo, "Usa questa chat")}</form>` : ""}
${st.chatProvata ? html`<div class="note" style="margin-top:12px">✓ Collegato alla chat di <b>${(chat ?? []).find((c) => c.id === st.v.telegramChatId)?.nome ?? "una chat"}</b>: ti ho mandato un messaggio di prova.</div>` : ""}</div>` : ""}
<form method="post" action="/configurazione/telegram" class="inline" style="margin-top:12px"><input type="hidden" name="azione" value="salta"><input type="hidden" name="csrf" value="${csrf}"><button>Salta Telegram per ora</button></form>
${completati().telegram ? html` <a class="btn" href="/configurazione/claude">Avanti →</a>` : ""}`, csrf);
      }
      case "claude":
        return pagina("Claude", passo, html`<h1>5. Il cervello: Claude Code</h1>
<p class="introduzione">Il «cervello» del bot è Claude Code, chiamato dal computer. Sceglie tra i titoli che il codice ha già ammesso e spiega il perché. Senza Claude Code il bot non compra niente, ma protezioni e uscite continuano.</p>
<div class="note">Il bot parte con il <b>modello predefinito</b> del tuo account Claude, che funziona con qualunque piano. Se il tuo piano include Opus, dopo l'avvio puoi sceglierlo in Impostazioni → AI: conviene per le decisioni di acquisto e per la review.</div>
${st.claude?.provato ? html`<div class="note">✓ Claude Code risponde (${st.claude.testo}): la domanda di prova è riuscita.</div>` : st.claude?.ok ? html`<div class="note">Claude Code trovato (${st.claude.testo}) e l'accesso risulta fatto. Premi «Controlla Claude Code» qui sotto: fa una domanda di prova, l'unico modo di essere sicuri che il cervello risponda.</div>` : st.claude ? html`<div class="alarm">${st.claude.testo}</div>` : ""}${e}${n}
<div class="card"><h3>Se non è installato o non hai fatto l'accesso</h3>
<p>Windows (PowerShell): <code>irm https://claude.ai/install.ps1 | iex</code><br>Linux, Raspberry Pi, macOS: <code>curl -fsSL https://claude.ai/install.sh | bash</code></p>
<p>Poi apri un terminale nuovo e scrivi <code>claude auth login</code>: si apre il browser, accedi con il tuo account Claude. L'estensione di VS Code ha un accesso suo: anche se lì sei collegato, il comando <code>claude</code> va collegato a parte. Infine premi «Controlla Claude Code».</p></div>
<form method="post" action="/configurazione/claude" class="card modulo"><input type="hidden" name="azione" value="token">
<p><b>Token (facoltativo, consigliato)</b>. Se il bot parte dall'Utilità di pianificazione o dai timer di Linux, il login del terminale a volte non basta. Genera un token con <code>claude setup-token</code> e incollalo qui; si salva solo se la domanda di prova funziona.${presente("claudeOauthToken") ? " C'è già un token salvato: lascia vuoto per tenerlo." : ""}</p>
<label>Token di Claude<br><input type="password" name="oauthToken" autocomplete="off" spellcheck="false"></label>
<p class="small muted">Il controllo chiede a Claude di rispondere «ok»: servono da 5 a 30 secondi, e consuma pochissimo del tuo piano.</p>${avanti(csrf, passo, "Controlla Claude Code")}</form>`, csrf);
      case "riepilogo": {
        const c = completati();
        const mancano = (["password", "alpaca", "finnhub"] as Passo[]).filter((p) => !c[p]);
        const riga = (n: string, ok: boolean, d: string) => html`<tr><td>${n}</td><td>${ok ? html`<span class="badge b-good">pronto</span>` : html`<span class="badge b-warn">da fare</span>`}</td><td class="small muted">${d}</td></tr>`;
        return pagina("Riepilogo", passo, html`<h1>6. Riepilogo</h1>${e}${n}
<div class="card scroll"><table><tr><th>Cosa</th><th>Stato</th><th></th></tr>
${riga("Password della dashboard", c.password, "almeno 12 caratteri")}
${riga("Alpaca (paper)", c.alpaca, st.alpaca ? `conto ${st.alpaca.stato}` : "chiavi da verificare")}
${riga("Finnhub", c.finnhub, "bilanci delle società")}
${riga("Telegram", c.telegram, st.telegramSaltato ? "saltato: niente messaggi finché non lo configuri" : st.telegram ? `@${st.telegram.username}` : "facoltativo")}
${riga("Claude Code", !!st.claude?.provato, st.claude?.provato ? `${st.claude.testo}, risponde` : "da controllare: senza, il bot non compra")}</table></div>
${mancano.length ? html`<div class="alarm">Prima di salvare completa: ${mancano.map((p) => PASSI.find((x) => x[0] === p)![1]).join(", ")}.</div>` : html`<form method="post" action="/configurazione/salva" data-confirm="Salvare la configurazione e avviare il bot? Le chiavi vengono scritte in secrets.ts, su questo computer."><p>Le chiavi vengono scritte nel file <code>secrets.ts</code> di questo computer, escluso da git. Poi il bot si riavvia e trovi la pagina di accesso: entra con la password che hai scelto.</p>${avanti(csrf, passo, "Salva e avvia il bot")}</form>`}`, csrf);
      }
    }
  }

  function benvenuto(errore?: string): string {
    return pagina("Benvenuto", null, html`<h1>Benvenuto in Indiano Trading</h1>
<p class="introduzione">È il primo avvio: in pochi passi scegli la password della dashboard e colleghi Alpaca, Finnhub, Telegram e Claude Code. Le chiavi restano su questo computer.</p>
${errore ? html`<div class="alarm">${errore}</div>` : ""}
<form method="post" action="/configurazione/codice" class="card modulo"><p>Per sicurezza serve il <b>codice di configurazione</b> scritto nel terminale dove hai avviato il bot (riga «Configurazione iniziale»). Se hai aperto il link del terminale è già compilato.</p>
<label>Codice<br><input name="codice" autocomplete="off" spellcheck="false" placeholder="ABCD-1234" required></label><button class="primary">Inizia</button></form>`, null);
  }

  async function gestisci(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!hostOk.has(req.headers.get("host") ?? "")) return new Response("Host non ammesso", { status: 421 });
    if (req.method !== "GET" && req.method !== "POST") return new Response("Metodo non ammesso", { status: 405, headers: { allow: "GET, POST" } });
    if (url.pathname === "/style.css") return new Response(CSS + CSS_CONFIG, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" } });
    if (url.pathname === "/app.js") return new Response(JS, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    const FONT: Record<string, string> = { "/font/display.ttf": "WixMadeforDisplay.ttf", "/font/text.ttf": "WixMadeforText.ttf" };
    if (FONT[url.pathname]) return new Response(Bun.file(path.join(import.meta.dir, "..", "dashboard", "assets", FONT[url.pathname]!)), { headers: { "content-type": "font/ttf" } });
    if (req.method === "POST") {
      const origin = req.headers.get("origin");
      const stessoSito = req.headers.get("sec-fetch-site") === "same-origin";
      if (!(!origin || hostOk.has(origin.replace(/^https?:\/\//, "")) || (origin === "null" && stessoSito))) return new Response("Origine non ammessa", { status: 403 });
    }
    if (st.salvato) return risposta(pagina("Fatto", null, html`<h1>Configurazione salvata</h1><p>Il bot si sta riavviando: tra qualche secondo questa pagina diventa la pagina di accesso.</p>`, null, "8;url=/"));

    const sid = /(?:^|;\s*)cfg=([a-f0-9]{64})/.exec(req.headers.get("cookie") ?? "")?.[1];
    const s = sid ? sessioni.get(sid) : undefined;

    const entra = () => {
      const nuovo = rand(32);
      // chi rientra con il codice non butta fuori una sessione già aperta; si tengono le ultime 3
      for (const k of [...sessioni.keys()].slice(0, Math.max(0, sessioni.size - 2))) sessioni.delete(k);
      sessioni.set(nuovo, { csrf: rand(32), creata: Date.now() });
      return vai("/configurazione/password", { "set-cookie": `cfg=${nuovo}; HttpOnly; SameSite=Strict; Path=/` });
    };
    const codiceOk = async (c: string | null) => {
      if (Date.now() < bloccoFino) return false;
      const ok = !!c && uguali(c.trim().toUpperCase(), codice);
      if (!ok) {
        // il conteggio avviene prima dell'attesa: cento tentativi in parallelo non passano tutti il controllo
        if (++tentativi >= 10) {
          bloccoFino = Date.now() + 5 * 60_000;
          tentativi = 0;
        }
        await Bun.sleep(400);
      }
      return ok;
    };

    if (url.pathname === "/configurazione/codice" && req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      return (await codiceOk(form.get("codice"))) ? entra() : risposta(benvenuto(Date.now() < bloccoFino ? "Troppi tentativi: riprova tra qualche minuto." : "Codice non valido: copialo dal terminale."), 401);
    }
    if (!s) {
      if (req.method === "GET" && url.searchParams.has("codice")) {
        // un'immagine o un link da un altro sito non deve poter consumare i tentativi e bloccare la configurazione
        const sito = req.headers.get("sec-fetch-site");
        const dest = req.headers.get("sec-fetch-dest");
        if ((sito && sito !== "none" && sito !== "same-origin") || (dest && dest !== "document")) return risposta(benvenuto());
        return (await codiceOk(url.searchParams.get("codice"))) ? entra() : risposta(benvenuto("Codice non valido: copialo dal terminale."), 401);
      }
      if (req.method === "POST") return risposta(benvenuto("Sessione scaduta: inserisci di nuovo il codice."), 401);
      return risposta(benvenuto());
    }

    const passo = url.pathname.replace(/^\/configurazione\/?/, "") as Passo;
    if (req.method === "GET") {
      if (!PASSI.some((p) => p[0] === passo)) return vai("/configurazione/password");
      if (passo === "claude" && !st.claude) {
        // all'apertura della pagina solo i controlli veloci (installato, accesso fatto); la domanda di prova parte dal pulsante
        const c = await verificaClaude({ token: st.v.claudeOauthToken, esegui: o.esegui, trova: o.trovaClaude, prova: false });
        st.claude = c.ok ? { ok: true, provato: false, testo: c.info.versione } : { ok: false, provato: false, testo: c.errore };
      }
      return risposta(vista(passo, s.csrf));
    }

    // POST: token CSRF della sessione
    const form = new URLSearchParams(await req.text());
    const tok = form.get("csrf") ?? "";
    if (!uguali(tok, s.csrf)) return risposta(pagina("Errore", null, html`<h1>Richiesta rifiutata</h1><p>Token di sicurezza mancante o non valido: ricarica la pagina.</p>`, null), 403);
    const campo = (k: string) => (form.get(k) ?? "").trim();

    switch (url.pathname) {
      case "/configurazione/password": {
        const p1 = form.get("pwd") ?? "", p2 = form.get("pwd2") ?? "";
        if (p1.length < PASSWORD_MIN) return risposta(vista("password", s.csrf, { errore: `La password deve avere almeno ${PASSWORD_MIN} caratteri.` }), 400);
        if (!p1.trim()) return risposta(vista("password", s.csrf, { errore: "La password non può essere fatta solo di spazi." }), 400);
        if (p1 !== p2) return risposta(vista("password", s.csrf, { errore: "Le due password non coincidono." }), 400);
        if (/[\r\n]/.test(p1)) return risposta(vista("password", s.csrf, { errore: "La password non può contenere a capo." }), 400);
        registerSecret(p1);
        st.v.dashboardPassword = p1;
        return vai(`/configurazione/${prossimo("password")}`);
      }
      case "/configurazione/alpaca": {
        const k = campo("keyId") || st.v.alpacaKeyId, sk = campo("secretKey") || st.v.alpacaSecretKey;
        const r = await verificaAlpaca(k, sk, f);
        if (!r.ok) {
          st.alpaca = null;
          return risposta(vista("alpaca", s.csrf, { errore: r.errore }), 400);
        }
        st.v.alpacaKeyId = k.trim();
        st.v.alpacaSecretKey = sk.trim();
        st.alpaca = r.info;
        return vai(`/configurazione/${prossimo("alpaca")}`);
      }
      case "/configurazione/finnhub": {
        const k = campo("apiKey") || st.v.finnhubApiKey;
        const r = await verificaFinnhub(k, f);
        if (!r.ok) {
          st.finnhub = false;
          return risposta(vista("finnhub", s.csrf, { errore: r.errore }), 400);
        }
        st.v.finnhubApiKey = k.trim();
        st.finnhub = true;
        return vai(`/configurazione/${prossimo("finnhub")}`);
      }
      case "/configurazione/telegram": {
        const az = form.get("azione");
        if (az === "salta") {
          st.telegramSaltato = true;
          st.telegram = null;
          st.chat = null;
          st.chatProvata = false;
          st.v.telegramBotToken = "";
          st.v.telegramChatId = "";
          return vai("/configurazione/claude");
        }
        if (az === "token") {
          const t = campo("token") || st.v.telegramBotToken;
          const r = await verificaTelegram(t, f);
          if (!r.ok) return risposta(vista("telegram", s.csrf, { errore: r.errore }), 400);
          if (t.trim() !== st.v.telegramBotToken) {
            st.v.telegramChatId = "";
            st.chatProvata = false;
            st.chat = null;
          }
          st.v.telegramBotToken = t.trim();
          st.telegram = r.info;
          st.telegramSaltato = false;
          return vai("/configurazione/telegram");
        }
        if (!st.telegram) return risposta(vista("telegram", s.csrf, { errore: "Prima verifica il token del bot." }), 400);
        let scelta: string | null = null;
        if (az === "cerca") {
          const r = await trovaChat(st.v.telegramBotToken, f);
          if (!r.ok) return risposta(vista("telegram", s.csrf, { errore: r.errore }), 400);
          st.chat = r.info.chat;
          st.chatProvata = false;
          if (r.info.chat.length > 1) return risposta(vista("telegram", s.csrf, { nota: "Ho trovato più chat: scegli la tua qui sotto." }));
          scelta = r.info.chat[0]!.id;
        } else if (az === "scegli") {
          scelta = form.get("chat");
          if (!scelta || !(st.chat ?? []).some((c) => c.id === scelta)) return risposta(vista("telegram", s.csrf, { errore: "Scegli una delle chat trovate." }), 400);
        } else return risposta(vista("telegram", s.csrf, { errore: "Azione non riconosciuta." }), 400);
        const prova = await messaggioProva(st.v.telegramBotToken, scelta, f);
        if (!prova.ok) return risposta(vista("telegram", s.csrf, { errore: prova.errore }), 400);
        st.v.telegramChatId = scelta;
        st.chatProvata = true;
        return vai("/configurazione/telegram");
      }
      case "/configurazione/claude": {
        const t = campo("oauthToken");
        if (t && /\s/.test(t)) return risposta(vista("claude", s.csrf, { errore: "Il token non contiene spazi: copialo per intero dall'uscita di claude setup-token." }), 400);
        if (t) registerSecret(t);
        // controllo completo, con una domanda di prova: un token incollato si tiene solo se funziona
        const c = await verificaClaude({ token: t || st.v.claudeOauthToken, esegui: o.esegui, trova: o.trovaClaude, prova: true });
        if (c.ok && t) st.v.claudeOauthToken = t;
        st.claude = c.ok ? { ok: true, provato: true, testo: c.info.versione } : { ok: false, provato: false, testo: c.errore };
        return vai(`/configurazione/${c.ok ? "riepilogo" : "claude"}`);
      }
      case "/configurazione/salva": {
        const c = completati();
        if (!c.password || !c.alpaca || !c.finnhub) return risposta(vista("riepilogo", s.csrf, { errore: "Mancano dei passi obbligatori." }), 400);
        const prob = paperSafetyProblems({ alpaca: { keyId: st.v.alpacaKeyId, secretKey: st.v.alpacaSecretKey }, telegram: { botToken: st.v.telegramBotToken, chatId: st.v.telegramChatId }, finnhub: { apiKey: st.v.finnhubApiKey }, dashboard: { password: st.v.dashboardPassword }, claude: { oauthToken: st.v.claudeOauthToken } }, {});
        if (prob.length) return risposta(vista("riepilogo", s.csrf, { errore: `Non salvo: ${prob.join(" ")}` }), 400);
        const finale = { alpaca: { keyId: st.v.alpacaKeyId, secretKey: st.v.alpacaSecretKey }, telegram: { botToken: st.v.telegramBotToken, chatId: st.v.telegramChatId }, finnhub: { apiKey: st.v.finnhubApiKey }, dashboard: { password: st.v.dashboardPassword }, claude: { oauthToken: st.v.claudeOauthToken } } as Secrets;
        if (campiMancanti(finale).length) return risposta(vista("riepilogo", s.csrf, { errore: `Mancano: ${campiMancanti(finale).join(", ")}.` }), 400);
        try {
          scriviSegreti(st.v, file);
        } catch {
          return risposta(vista("riepilogo", s.csrf, { errore: "Non riesco a scrivere secrets.ts nella cartella del bot: controlla i permessi della cartella." }), 500);
        }
        st.salvato = true;
        sessioni.clear();
        setTimeout(() => o.alTermine(), 1200);
        return risposta(pagina("Fatto", null, html`<h1>Configurazione salvata</h1>
<p>Le chiavi sono in <code>secrets.ts</code>. Il bot si riavvia: tra qualche secondo questa pagina diventa la pagina di accesso, dove entri con la password che hai scelto.</p>
<p class="small muted">Se stai usando <code>start dashboard</code> o <code>start avvia</code> il riavvio è automatico. Se la pagina non si aggiorna, rilancia <code>start avvia</code>.</p>`, null, "8;url=/"));
      }
    }
    return vai("/configurazione/password");
  }

  const server = Bun.serve({ hostname: DASHBOARD_HOST, port: o.porta, fetch: (req) => gestisci(req).catch(() => risposta("<h1>Errore interno della configurazione</h1>", 500)) });
  impostaHost(server.port ?? o.porta);
  const urlBase = `http://${DASHBOARD_HOST}:${server.port}`;
  return { server, url: `${urlBase}/configurazione?codice=${codice}`, codice, stop: () => server.stop(true) };
}

const CSS_CONFIG = `
main.configurazione{max-width:820px}
.passi-config{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px;padding:0}
.passi-config li a{display:inline-flex;padding:6px 14px;border-radius:var(--radius-pill);background:oklch(100% 0 0 / 0.05);color:var(--color-muted);text-decoration:none;font-size:14px}
.passi-config li.fatto a{color:var(--color-accent-hi)}.passi-config li.qui a{background:var(--color-accent);color:var(--color-accent-ink);font-weight:600}
.guida-passi{line-height:1.65;padding-left:22px}.guida-passi li{padding:2px 0}
form.modulo{display:flex;flex-direction:column;gap:14px;align-items:flex-start;margin:16px 0}form.modulo label{width:100%;max-width:460px}form.modulo input:not([type=radio]){width:100%}
.riga-scelta{display:flex;gap:8px;align-items:center}
`;
