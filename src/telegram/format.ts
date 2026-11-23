// Formattazione HTML per Telegram: conversione dei caratteri speciali e spezzatura oltre 4096 caratteri.

export const TG_MAX = 4096;

/** Converte &, <, > in tutti i testi variabili. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const strip = (s: string) => s.replace(/<[^>]+>/g, "");

/**
 * Spezza un messaggio HTML in parti ≤ max caratteri, tagliando tra le righe (i tag non attraversano le righe).
 * Una riga troppo lunga si taglia senza tag.
 */
export function splitMessage(html: string, max = TG_MAX): string[] {
  const out: string[] = [];
  let cur = "";
  for (let line of html.split("\n")) {
    if (line.length > max) {
      line = esc(strip(line).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
      while (line.length > max) {
        // non spezzare un'entità &…;
        let cut = max;
        const amp = line.lastIndexOf("&", cut);
        if (amp > cut - 6) cut = amp;
        if (cur) {
          out.push(cur);
          cur = "";
        }
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    const candidate = cur ? `${cur}\n${line}` : line;
    if (candidate.length > max) {
      out.push(cur);
      cur = line;
    } else cur = candidate;
  }
  if (cur) out.push(cur);
  return out.filter((p) => p.trim().length > 0);
}

export const fmtUsd = (x: number | null | undefined, d = 2): string =>
  x === null || x === undefined || !Number.isFinite(x) ? "n/d" : `${x < 0 ? "−" : ""}${Math.abs(x).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d })} $`;

export const fmtPct = (x: number | null | undefined, d = 2): string =>
  x === null || x === undefined || !Number.isFinite(x) ? "n/d" : Number((x * 100).toFixed(d)) === 0 ? `${(0).toLocaleString("it-IT", { minimumFractionDigits: d })}%` : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;

export const fmtNum = (x: number | null | undefined, d = 2): string =>
  x === null || x === undefined || !Number.isFinite(x) ? "n/d" : x.toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d });
