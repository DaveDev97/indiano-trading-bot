// Oscuramento dei segreti. Ogni testo che va in log, messaggi, dashboard o console passa da qui.

const secrets: string[] = [];

/** Registra un valore segreto da oscurare ovunque. Valori troppo corti non si registrano (falsi positivi). */
export function registerSecret(value: unknown): void {
  if (typeof value !== "string") return;
  const v = value.trim();
  if (v.length < 6) return;
  if (!secrets.includes(v)) {
    secrets.push(v);
    secrets.sort((a, b) => b.length - a.length);
  }
}

/** Solo per i test. */
export function _resetSecretsForTest(): void {
  secrets.length = 0;
}

const PATTERNS: [RegExp, string][] = [
  // token di bot Telegram, anche dentro un URL (bot<TOKEN>/metodo)
  [/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, "bot[OSCURATO]"],
  [/\b\d{5,}:[A-Za-z0-9_-]{30,}\b/g, "[OSCURATO]"],
  // header Alpaca eventualmente serializzati
  [/(APCA-API-(?:KEY-ID|SECRET-KEY)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[OSCURATO]"],
  // token OAuth di Claude Code
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, "[OSCURATO]"],
  // token= o password= in querystring o testo
  [/((?:token|password|secret|apikey|api_key)=)[^&\s"']+/gi, "$1[OSCURATO]"],
];

export function redact(text: string): string {
  let out = String(text);
  for (const s of secrets) {
    if (out.includes(s)) out = out.split(s).join("[OSCURATO]");
  }
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Testo di un errore, già oscurato. Include la causa (fetch su Bun la mette spesso lì). */
export function errText(e: unknown): string {
  if (e == null) return "errore sconosciuto";
  if (e instanceof Error) {
    let s = `${e.name}: ${e.message}`;
    const c = (e as any).cause;
    if (c) s += ` (causa: ${c instanceof Error ? c.message : String(c)})`;
    return redact(s);
  }
  try {
    return redact(typeof e === "string" ? e : JSON.stringify(e));
  } catch {
    return redact(String(e));
  }
}

/** JSON oscurato. */
export function redactJson(obj: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(obj);
  } catch {
    s = String(obj);
  }
  return redact(s);
}
