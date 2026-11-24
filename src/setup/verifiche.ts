// Verifiche delle chiavi durante la configurazione guidata: una chiamata di sola lettura per servizio.
// Ogni valore viene registrato per redact() prima di qualsiasi chiamata, così un errore non lo mostra mai.
// Alpaca: solo l'endpoint paper (costante), e una chiave live (AK…) si rifiuta senza nemmeno chiamare.
import { FINNHUB_URL, PAPER_TRADING_URL, TELEGRAM_URL } from "../config/costanti.ts";
import { redact, registerSecret } from "../util/redact.ts";
import { errText } from "../util/redact.ts";
import { findClaude } from "../brain/claude.ts";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Esito<T = Record<string, unknown>> = { ok: true; info: T } | { ok: false; errore: string };

const TIMEOUT_MS = 15_000;

async function chiama(f: Fetch, url: string, init: RequestInit = {}): Promise<Response> {
  return f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}
const motivo = (e: unknown) => redact(errText(e)).replace(/TimeoutError.*|The operation timed out.*/i, "il servizio non ha risposto entro 15 secondi");

export async function verificaAlpaca(keyId: string, secretKey: string, f: Fetch = fetch): Promise<Esito<{ stato: string; patrimonio: number | null; valuta: string | null }>> {
  const k = keyId.trim(), s = secretKey.trim();
  registerSecret(k);
  registerSecret(s);
  if (!k || !s) return { ok: false, errore: "Servono entrambe le chiavi: Key ID e Secret." };
  if (k.toUpperCase().startsWith("AK")) return { ok: false, errore: "Questa è una chiave del conto REALE (inizia con AK). Il bot lavora solo sul conto paper: in Alpaca passa a «Paper Trading» e genera lì le chiavi (iniziano con PK)." };
  if (!k.toUpperCase().startsWith("PK")) return { ok: false, errore: "La Key ID del conto paper inizia con PK. Controlla di aver copiato la chiave giusta." };
  try {
    const r = await chiama(f, `${PAPER_TRADING_URL}/v2/account`, { headers: { "APCA-API-KEY-ID": k, "APCA-API-SECRET-KEY": s } });
    if (r.status === 401 || r.status === 403) return { ok: false, errore: "Alpaca ha rifiutato le chiavi: controlla di averle copiate per intero, senza spazi. Se le hai rigenerate, quelle vecchie non valgono più." };
    if (!r.ok) return { ok: false, errore: `Alpaca ha risposto con un errore (HTTP ${r.status}). Riprova tra poco.` };
    const a = (await r.json()) as { status?: string; equity?: string; currency?: string };
    return { ok: true, info: { stato: String(a.status ?? "sconosciuto"), patrimonio: a.equity ? Number(a.equity) : null, valuta: a.currency ?? null } };
  } catch (e) {
    return { ok: false, errore: `Alpaca non raggiungibile: ${motivo(e)}` };
  }
}

export async function verificaFinnhub(apiKey: string, f: Fetch = fetch): Promise<Esito<{ esempio: string }>> {
  const k = apiKey.trim();
  registerSecret(k);
  if (!k) return { ok: false, errore: "Inserisci la chiave Finnhub." };
  try {
    const r = await chiama(f, `${FINNHUB_URL}/stock/profile2?symbol=AAPL&token=${encodeURIComponent(k)}`);
    if (r.status === 401 || r.status === 403) return { ok: false, errore: "Finnhub ha rifiutato la chiave: copiala di nuovo dalla tua dashboard Finnhub." };
    if (r.status === 429) return { ok: false, errore: "Finnhub dice che hai superato il limite di richieste: aspetta un minuto e riprova." };
    if (!r.ok) return { ok: false, errore: `Finnhub ha risposto con un errore (HTTP ${r.status}).` };
    const p = (await r.json()) as { name?: string };
    if (!p || !p.name) return { ok: false, errore: "Finnhub ha risposto, ma senza dati: la chiave potrebbe non essere attiva. Riprova tra qualche minuto." };
    return { ok: true, info: { esempio: String(p.name) } };
  } catch (e) {
    return { ok: false, errore: `Finnhub non raggiungibile: ${motivo(e)}` };
  }
}

const FORMATO_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/;

export async function verificaTelegram(botToken: string, f: Fetch = fetch): Promise<Esito<{ username: string; nome: string }>> {
  const t = botToken.trim();
  registerSecret(t);
  if (!FORMATO_TOKEN.test(t)) return { ok: false, errore: "Il token non ha il formato giusto (numeri, due punti, poi una lunga sequenza di lettere): copialo per intero dal messaggio di BotFather." };
  try {
    const r = await chiama(f, `${TELEGRAM_URL}/bot${t}/getMe`);
    if (r.status === 401 || r.status === 404) return { ok: false, errore: "Telegram non riconosce il token: copialo di nuovo dal messaggio di BotFather (o chiedi /token a BotFather)." };
    const j = (await r.json()) as { ok?: boolean; result?: { username?: string; first_name?: string } };
    if (!j.ok || !j.result?.username) return { ok: false, errore: "Telegram ha risposto con un errore: riprova tra poco." };
    return { ok: true, info: { username: j.result.username, nome: j.result.first_name ?? j.result.username } };
  } catch (e) {
    return { ok: false, errore: `Telegram non raggiungibile: ${motivo(e)}` };
  }
}

/** Cerca le chat private che hanno scritto al bot (il messaggio più recente per primo). */
export async function trovaChat(botToken: string, f: Fetch = fetch): Promise<Esito<{ chat: { id: string; nome: string }[] }>> {
  const t = botToken.trim();
  registerSecret(t);
  try {
    const r = await chiama(f, `${TELEGRAM_URL}/bot${t}/getUpdates?allowed_updates=${encodeURIComponent('["message"]')}`);
    const j = (await r.json()) as { ok?: boolean; description?: string; result?: { message?: { chat?: { id?: number; type?: string; first_name?: string; last_name?: string; username?: string; title?: string } } }[] };
    if (!j.ok) return { ok: false, errore: r.status === 409 ? "Un altro programma sta già leggendo i messaggi di questo bot: chiudi l'altra dashboard e riprova." : "Telegram ha risposto con un errore: riprova tra poco." };
    const visti = new Map<string, string>();
    for (const u of [...(j.result ?? [])].reverse()) {
      const c = u.message?.chat;
      if (!c?.id || c.type !== "private" || visti.has(String(c.id))) continue;
      visti.set(String(c.id), [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.username ? `@${c.username}` : "chat privata"));
    }
    if (!visti.size) return { ok: false, errore: "Non trovo ancora nessun messaggio: apri il bot su Telegram, premi «Avvia» (o scrivi /start) e poi riprova. Telegram conserva i messaggi per 24 ore." };
    return { ok: true, info: { chat: [...visti].map(([id, nome]) => ({ id, nome })) } };
  } catch (e) {
    return { ok: false, errore: `Telegram non raggiungibile: ${motivo(e)}` };
  }
}

export async function messaggioProva(botToken: string, chatId: string, f: Fetch = fetch): Promise<Esito<{}>> {
  const t = botToken.trim();
  registerSecret(t);
  if (!/^-?\d{1,20}$/.test(chatId.trim())) return { ok: false, errore: "L'id della chat è un numero (per i gruppi inizia con il segno meno)." };
  try {
    const r = await chiama(f, `${TELEGRAM_URL}/bot${t}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId.trim(), text: "✅ Indiano Trading è collegato a questa chat. Da qui riceverai i resoconti delle sveglie, gli allarmi e la review con i pulsanti Approva / Rifiuta." }),
    });
    const j = (await r.json()) as { ok?: boolean };
    return j.ok ? { ok: true, info: {} } : { ok: false, errore: "Telegram non ha consegnato il messaggio: controlla di aver premuto «Avvia» nella chat con il bot." };
  } catch (e) {
    return { ok: false, errore: `Telegram non raggiungibile: ${motivo(e)}` };
  }
}

export type EseguiComando = (cmd: string[]) => Promise<{ codice: number; uscita: string }>;

const eseguiVero: EseguiComando = async (cmd) => {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const t = setTimeout(() => p.kill(), 15_000);
    const [out, , codice] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    clearTimeout(t);
    return { codice, uscita: out.trim() };
  } catch {
    return { codice: -1, uscita: "" };
  }
};

/** Claude Code installato? Serve al "cervello"; senza, il bot non compra (protezioni e uscite continuano). */
export async function verificaClaude(esegui: EseguiComando = eseguiVero, trova: () => string | null = findClaude): Promise<Esito<{ versione: string }>> {
  const bin = trova();
  if (!bin) return { ok: false, errore: "Claude Code non è installato o non è nel PATH." };
  const r = await esegui([bin, "--version"]);
  if (r.codice !== 0 || !r.uscita) return { ok: false, errore: "Claude Code non è installato o non è nel PATH." };
  return { ok: true, info: { versione: r.uscita.split(/\r?\n/)[0]!.slice(0, 80) } };
}
