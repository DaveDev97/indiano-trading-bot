// Messaggi Telegram di fine sveglia e allarmi (§9). Ogni messaggio porta l'id della sveglia, lo stesso del log.
import type { Account, Position } from "../broker/types.ts";
import type { Params } from "../params/params.ts";
import type { Rifiuto, TipoSveglia } from "../cage/gabbia.ts";
import type { Piani, PianoUscita } from "../run/piani.ts";
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
  // a fine giornata le posizioni ci sono sempre, con la distanza da stop e take profit; nelle altre sveglie se richiesto
  const fineGiornata = d.tipo === "chiusura";
  if (d.posizioni.length && (fineGiornata || d.P.b("notifiche.posizioniNelResoconto"))) {
    L.push("");
    L.push(fineGiornata ? `<b>Posizioni aperte a fine giornata</b> (${d.posizioni.length}), distanza da stop e take profit al prezzo attuale:` : "<b>Posizioni</b>:");
    for (const p of d.posizioni) L.push(...righePosizione(p, d.prezzi[p.symbol] ?? p.currentPrice ?? null, d.piani[p.symbol], d.nonProtette.includes(p.symbol)));
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

/** Una posizione: risultato dall'ingresso e distanza dai livelli di uscita, in % e in $ dal prezzo attuale. */
export function righePosizione(p: Position, pr: number | null, pl: PianoUscita | undefined, nonProtetta: boolean): string[] {
  const ing = p.avgEntryPrice;
  const qty = p.qty;
  const risultato = pr ? `${fmtPct(pr / ing - 1)} (${fmtUsd((pr - ing) * qty, 0)})` : "n/d";
  const testa = `• <b>${esc(p.symbol)}</b> ${fmtNum(qty, 0)} az. · ${pr ? fmtUsd(pr) : "prezzo n/d"} · ${risultato} dall'ingresso a ${fmtUsd(ing)}${nonProtetta ? " ⚠ <b>non protetta</b>" : ""}`;
  if (!pl) return [testa, "   piano di uscita non trovato: la prossima sveglia ricostruisce la protezione"];
  if (!pr) return [testa, "   prezzo attuale non disponibile: distanze non calcolabili"];
  const out = [testa];
  const stop = livelloStop(pl);
  const tp = pl.modalita === "bracket" ? pl.takeProfit : null;
  if (stop === null) out.push("   stop non noto");
  else if (pr <= stop) out.push(`   ⚠ prezzo sotto lo stop ${fmtNum(stop)}: se la protezione non è scattata, si vende alla prossima sveglia a mercato aperto`);
  else {
    const daIng = stop / ing - 1;
    out.push(`   ↓ ${pl.modalita === "trailing" ? "stop mobile" : "stop"} ${fmtNum(stop)}: ${fmtPct(stop / pr - 1)} da qui (${fmtUsd((stop - pr) * qty, 0)}), ${daIng >= 0 ? `garantisce ${fmtPct(daIng)} dall'ingresso` : `${fmtPct(daIng)} dall'ingresso`}`);
  }
  if (tp !== null) {
    if (pr >= tp) out.push(`   ↑ prezzo oltre il take profit ${fmtNum(tp)}: l'ordine limite dovrebbe eseguirsi`);
    else out.push(`   ↑ take profit ${fmtNum(tp)}: ${fmtPct(tp / pr - 1)} da qui (+${fmtUsd((tp - pr) * qty, 0)})`);
    if (stop !== null && tp > stop) {
      const f = Math.min(1, Math.max(0, (pr - stop) / (tp - stop)));
      const n = Math.round(f * 10);
      out.push(`   stop ${"▰".repeat(n)}${"▱".repeat(10 - n)} tp · al ${Math.round(f * 100)}% del percorso`);
    }
  } else if (pl.modalita === "trailing") {
    out.push(`   nessun take profit: lo stop mobile segue il massimo raggiunto (${fmtNum(pl.massimo)}) a ${pl.trailingPct != null ? `${fmtNum(pl.trailingPct, 0)}%` : fmtUsd(pl.trailPrice)}`);
  }
  return out;
}

export function messaggioAllarmi(runId: string, allarmi: string[]): string {
  return [`<b>⚠ Allarmi</b> · run ${esc(runId)}`, ...allarmi.map((a) => `• ${esc(a)}`)].join("\n");
}
