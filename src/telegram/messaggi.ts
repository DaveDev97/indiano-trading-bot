// Messaggi Telegram di fine sveglia e allarmi (§9). Ogni messaggio porta l'id della sveglia, lo stesso del log.
import type { Account, Position } from "../broker/types.ts";
import type { Params } from "../params/params.ts";
import type { Rifiuto, TipoSveglia } from "../cage/gabbia.ts";
import type { Piani } from "../run/piani.ts";
import { livelloStop } from "../run/piani.ts";
import type { SlotPrevisto } from "../run/calendario.ts";
import { NOME_SVEGLIA } from "../run/calendario.ts";
import type { Scheda } from "../journal/schede.ts";
import { esc, fmtNum, fmtPct, fmtUsd } from "./format.ts";
import { formatRome } from "../util/time.ts";

const ICONA: Record<TipoSveglia, string> = { briefing: "☀", apertura: "🔔", meta: "🕧", chiusura: "🌙" };

export interface DatiMessaggio {
  runId: string;
  tipo: TipoSveglia;
  P: Params;
  account: Account;
  posizioni: Position[];
  piani: Piani;
  prezzi: Record<string, number>;
  spyOggi: number | null;
  inviati: { simbolo: string; azione: string; id: string; stato: string }[];
  rifiuti: Rifiuto[];
  ragionamento: string;
  cervelloOk: boolean;
  cervelloMotivo: string | null;
  postiLiberi: number;
  maxPos: number;
  prossima: SlotPrevisto | null;
  nonProtette: string[];
  note: string[];
  chiuse: Scheda[];
  blocco: string | null;
}

function dueRighe(s: string): string {
  const frasi = s.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return frasi.slice(0, 2).join(" ").slice(0, 400);
}

export function messaggioFineSveglia(d: DatiMessaggio): string {
  const L: string[] = [];
  L.push(`<b>${ICONA[d.tipo]} ${esc(NOME_SVEGLIA[d.tipo][0]!.toUpperCase() + NOME_SVEGLIA[d.tipo].slice(1))}</b> · run ${esc(d.runId)} · parametri ${esc(d.P.versione)}`);
  if (d.nonProtette.length) L.push(`⚠ <b>NON PROTETTE: ${esc(d.nonProtette.join(", "))}</b>`);
  L.push("");
  if (d.inviati.length) {
    L.push("<b>Ordini</b>:");
    for (const x of d.inviati) L.push(`• ${esc(x.azione)} ${esc(x.simbolo)} — ${esc(x.stato)}`);
  } else L.push("Nessun ordine inviato.");
  if (d.rifiuti.length) {
    L.push("<b>Rifiutati</b>:");
    for (const x of d.rifiuti.slice(0, 10)) L.push(`• ${esc(x.azione)} ${esc(x.simbolo)}: ${esc(x.motivo)}`);
  }
  if (d.blocco) L.push(`Acquisti bloccati: ${esc(d.blocco)}.`);
  for (const c of d.chiuse) {
    const u = c.uscita!;
    L.push(`✔ Chiusa ${esc(c.ingresso.simbolo)}: ${fmtPct(u.risultatoPct)} (${fmtUsd(u.risultatoUsd)}, ${u.R !== null ? fmtNum(u.R, 2) + " R" : "R n/d"}), ${esc(u.motivo)}. SPY nello stesso periodo ${fmtPct(u.spyRendimento)}.`);
  }
  L.push("");
  L.push(`<b>Motivazione</b>: ${d.cervelloOk ? esc(dueRighe(d.ragionamento)) : `cervello non disponibile (${esc(d.cervelloMotivo ?? "")}): nessun acquisto.`}`);
  if (d.P.b("notifiche.posizioniNelResoconto") && d.posizioni.length) {
    L.push("");
    L.push("<b>Posizioni</b>:");
    for (const p of d.posizioni) {
      const pr = d.prezzi[p.symbol] ?? p.currentPrice;
      const pnl = pr ? pr / p.avgEntryPrice - 1 : null;
      const usd = pr ? (pr - p.avgEntryPrice) * p.qty : null;
      const pl = d.piani[p.symbol];
      const lv = pl ? livelloStop(pl) : null;
      const prot = d.nonProtette.includes(p.symbol) ? " ⚠ <b>non protetta</b>" : "";
      L.push(`• ${esc(p.symbol)} ${fmtPct(pnl)} (${fmtUsd(usd, 0)}) · stop ${fmtNum(lv)}${pl?.takeProfit ? ` · tp ${fmtNum(pl.takeProfit)}` : pl?.modalita === "trailing" ? " · stop mobile" : ""}${prot}`);
    }
  }
  L.push("");
  const giorno = d.account.lastEquity ? d.account.equity / d.account.lastEquity - 1 : null;
  L.push(`<b>Patrimonio</b> ${fmtUsd(d.account.equity, 0)} · oggi ${fmtPct(giorno)} (SPY ${fmtPct(d.spyOggi)})`);
  L.push(`Posti liberi: ${d.postiLiberi} su ${d.maxPos}`);
  if (d.prossima) L.push(`Prossima sveglia: ${esc(NOME_SVEGLIA[d.prossima.tipo])}, ${esc(formatRome(d.prossima.at))}`);
  if (d.note.length) {
    L.push("");
    for (const n of d.note.slice(0, 8)) L.push(`<i>${esc(n)}</i>`);
  }
  return L.join("\n");
}

export function messaggioAllarmi(runId: string, allarmi: string[]): string {
  return [`<b>⚠ Allarmi</b> · run ${esc(runId)}`, ...allarmi.map((a) => `• ${esc(a)}`)].join("\n");
}
