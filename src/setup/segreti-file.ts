// Stato della configurazione e scrittura di secrets.ts da parte della configurazione guidata.
// I valori non si stampano mai: qui si ragiona solo su "c'è / non c'è".
import * as fs from "node:fs";
import * as path from "node:path";
import { PROJECT_ROOT } from "../config/paths.ts";
import type { Secrets } from "../config/segreti.ts";

export const FILE_SEGRETI = path.join(PROJECT_ROOT, "secrets.ts");
/** Codice d'uscita con cui un processo chiede di essere riavviato subito (dopo la configurazione). */
export const CODICE_RIAVVIO = 75;
export const PASSWORD_MIN = 12;

export interface Valori {
  alpacaKeyId: string;
  alpacaSecretKey: string;
  finnhubApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  dashboardPassword: string;
  claudeOauthToken: string;
}

const pieno = (v: unknown) => typeof v === "string" && v.trim().length > 0;

/** Campi indispensabili che mancano (nomi leggibili, mai i valori). Telegram e il token di Claude sono facoltativi. */
export function campiMancanti(s: Secrets | null): string[] {
  const m: string[] = [];
  if (!pieno(s?.alpaca?.keyId)) m.push("chiave Alpaca (Key ID)");
  if (!pieno(s?.alpaca?.secretKey)) m.push("chiave Alpaca (Secret)");
  if (!pieno(s?.finnhub?.apiKey)) m.push("chiave Finnhub");
  if (!(typeof s?.dashboard?.password === "string" && s.dashboard.password.length >= PASSWORD_MIN)) m.push("password della dashboard");
  return m;
}

export const configurato = (s: Secrets | null) => campiMancanti(s).length === 0;

/** Al motore bastano Alpaca e Finnhub; la password serve solo alla dashboard. */
export const mancantiPerMotore = (s: Secrets | null) => campiMancanti(s).filter((x) => !x.startsWith("password"));

export class NonConfigurato extends Error {
  constructor(readonly mancano: string[]) {
    super(`Il bot non è ancora configurato (mancano: ${mancano.join(", ")}). Lancia «start avvia» e completa la configurazione guidata nella dashboard.`);
    this.name = "NonConfigurato";
  }
}

export function valoriDa(s: Secrets | null): Valori {
  const v = (x: unknown) => (typeof x === "string" ? x : "");
  return {
    alpacaKeyId: v(s?.alpaca?.keyId), alpacaSecretKey: v(s?.alpaca?.secretKey), finnhubApiKey: v(s?.finnhub?.apiKey),
    telegramBotToken: v(s?.telegram?.botToken), telegramChatId: v(s?.telegram?.chatId), dashboardPassword: v(s?.dashboard?.password), claudeOauthToken: v(s?.claude?.oauthToken),
  };
}

// U+2028 e U+2029 sono validi in JSON, ma in un sorgente JS vanno scritti con la loro sequenza di escape
const SEP_RIGA = new RegExp(String.fromCharCode(0x2028), "g");
const SEP_PARAGRAFO = new RegExp(String.fromCharCode(0x2029), "g");
const sicuro = (json: string) => json.replace(SEP_RIGA, "\\u2028").replace(SEP_PARAGRAFO, "\\u2029");

/** Testo di secrets.ts. I valori passano da JSON.stringify: virgolette, barre e a capo non possono rompere il file. */
export function testoSegreti(v: Valori, now = new Date()): string {
  const q = (x: string) => sicuro(JSON.stringify(x.trim()));
  return `// secrets.ts: creato dalla configurazione guidata della dashboard il ${now.toISOString().slice(0, 10)}.
// Contiene le tue chiavi: non condividerlo. È escluso da git (.gitignore).
// Per rifare la configurazione da zero: chiudi il bot, rinomina o cancella questo file e riavvia (start avvia).

export const secrets = {
  alpaca: {
    keyId: ${q(v.alpacaKeyId)},
    secretKey: ${q(v.alpacaSecretKey)},
  },
  telegram: {
    botToken: ${q(v.telegramBotToken)},
    chatId: ${q(v.telegramChatId)},
  },
  finnhub: {
    apiKey: ${q(v.finnhubApiKey)},
  },
  dashboard: {
    password: ${sicuro(JSON.stringify(v.dashboardPassword))},
  },
  claude: {
    oauthToken: ${q(v.claudeOauthToken)},
  },
};
`;
}

/** Scrittura atomica (file temporaneo e rinomina); su Linux leggibile solo dal proprietario. */
export function scriviSegreti(v: Valori, file = FILE_SEGRETI, now = new Date()): void {
  // il temporaneo si chiama secrets.ts.<pid>.tmp: è escluso da git (secrets.ts.*) e si cancella se qualcosa va storto
  const tmp = `${file}.${process.pid}.tmp`;
  // un secrets.ts incompleto già presente (magari con commenti o campi in più) si conserva accanto, anch'esso fuori da git
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, `${file}.prima-della-configurazione`);
    } catch {}
  }
  try {
    fs.writeFileSync(tmp, testoSegreti(v, now), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {}
  }
}

export function mtimeSegreti(file = FILE_SEGRETI): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}
