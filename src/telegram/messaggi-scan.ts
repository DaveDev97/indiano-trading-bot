// Messaggio Telegram della scansione del sabato (§9).
import { NOME_SETTORE } from "../config/settori.ts";
import type { Watchlist } from "../scan/scan.ts";
import { esc, fmtPct } from "./format.ts";
import { formatDateIt } from "../util/time.ts";

export function messaggioScan(wl: Watchlist): string {
  const L: string[] = [];
  L.push(`<b>🔎 Scansione del ${esc(formatDateIt(wl.data))}</b> · parametri ${esc(wl.paramsVersione)}`);
  if (!wl.completa) L.push("⚠ <b>Scansione incompleta</b>: rilanciala per riprendere dalla cache.");
  L.push("");
  const p = wl.forza.periodo;
  L.push(`<b>Settori forti</b> (battono SPY su ${p} sedute, SPY ${fmtPct(wl.forza.spy[p] ?? null, 1)}):`);
  if (!wl.forza.forti.length) L.push("nessuno: <b>niente acquisti nuovi</b> finché non cambia.");
  for (const s of wl.forza.settori.filter((x) => x.forte)) L.push(`• ${esc(NOME_SETTORE[s.settore])} (${esc(s.etf)} ${fmtPct(s.rendimenti[p] ?? null, 1)})`);
  L.push("");
  L.push("<b>Migliori 3 per settore forte</b>:");
  for (const s of wl.forza.forti) {
    const top = wl.acquistabili.filter((v) => v.settore === s).slice(0, 3);
    L.push(`• ${esc(NOME_SETTORE[s])}: ${top.length ? top.map((v) => `${esc(v.simbolo)} (${esc(v.profilo)}, ${v.punteggio.toFixed(0)})`).join(", ") : "nessun titolo passa i profili"}`);
  }
  L.push("");
  const c = wl.conteggi;
  L.push(`<b>Conteggi</b>: universo ${c.universo}, dopo prezzo e liquidità ${c.prefiltro}, valutati ${c.valutati}.`);
  L.push(`Passano: growth ${c.profili.growth} · value ${c.profili.value} · dividendo ${c.profili.dividendo}. Zona grigia ${wl.zonaGrigia.length}.`);
  const nd = Object.entries(wl.criteriNonDisponibili).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (nd.length) {
    L.push("");
    L.push("<b>Criteri non disponibili</b> (titoli):");
    L.push(nd.map(([k, n]) => `${esc(k)} ${n}`).join(" · "));
  }
  if (wl.avvisi.length) {
    L.push("");
    for (const a of wl.avvisi) L.push(`⚠ ${esc(a)}`);
  }
  return L.join("\n");
}
