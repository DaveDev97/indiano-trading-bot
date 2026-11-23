// Controllo delle protezioni a ogni sveglia (§4.6): ogni posizione deve avere un ordine di uscita aperto,
// per l'intera quantità, coerente con il suo piano. Si modifica con PATCH quando si può; altrimenti si ricrea.
import { isOpenStatus, type Order, type Position } from "../broker/types.ts";
import { arrotondaGiu, arrotondaSu } from "../cage/prezzi.ts";
import type { TipoSveglia } from "../cage/gabbia.ts";
import type { Esecutore } from "./esecutore.ts";
import { livelloStop, type PianoUscita, type Piani } from "./piani.ts";

export interface EsitoProtezione {
  simbolo: string;
  stato: "ok" | "modificata" | "ricreata" | "venduta" | "vendita all'apertura" | "non protetta" | "in vendita";
  dettagli: string;
  allarme?: string;
}

export interface OpzioniProtezioni {
  runId: string;
  tipo: TipoSveglia;
  mercatoAperto: boolean;
  tentativi: number;
  maxGiorni: number;
  attesaCancMs: number;
  now: Date;
}

const eq = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && Math.abs(a - b) < 0.0051;

function eta(o: Order, now: Date): number {
  const t = Date.parse(o.createdAt);
  return Number.isFinite(t) ? (now.getTime() - t) / 86_400_000 : 0;
}

/** Ordini di vendita aperti del simbolo, divisi per ruolo. */
export function classificaProtezioni(sells: Order[], qty: number) {
  const open = sells.filter((o) => isOpenStatus(o.status) && o.side === "sell");
  const stops = open.filter((o) => o.type === "stop" || o.type === "stop_limit");
  const trailing = open.filter((o) => o.type === "trailing_stop");
  const limits = open.filter((o) => o.type === "limit");
  const uscitaInCoda = open.find((o) => o.type === "market" && o.qty - o.filledQty === qty) ?? null;
  return { open, stops, trailing, limits, uscitaInCoda };
}

export interface ContestoProtezioni {
  esecutore: Esecutore;
  piani: Piani;
  prezzi: Record<string, number>;
  aggiornaPiano: (simbolo: string, p: Partial<PianoUscita>, nota: string) => void;
  motivoUscita: (p: PianoUscita, prezzo: number) => string;
}

export async function controllaProtezioni(posizioni: Position[], aperti: Order[], c: ContestoProtezioni, o: OpzioniProtezioni): Promise<EsitoProtezione[]> {
  const out: EsitoProtezione[] = [];
  for (const pos of posizioni) {
    if (pos.side !== "long" || pos.qty <= 0) continue;
    const s = pos.symbol;
    const piano = c.piani[s];
    const prezzo = c.prezzi[s] ?? pos.currentPrice ?? null;
    if (!piano) {
      out.push({ simbolo: s, stato: "non protetta", dettagli: "piano di uscita mancante", allarme: `${s}: piano di uscita mancante` });
      continue;
    }
    const sells = aperti.filter((x) => x.symbol === s && x.side === "sell");
    const k = classificaProtezioni(sells, pos.qty);
    if (k.uscitaInCoda) {
      out.push({ simbolo: s, stato: "in vendita", dettagli: "vendita a mercato in coda per l'intera quantità" });
      continue;
    }
    // prezzo oltre lo stop: si vende (subito se il mercato è aperto e non è il briefing; altrimenti all'apertura)
    const livello = livelloStop(piano);
    if (prezzo !== null && livello !== null && prezzo <= livello) {
      if (o.mercatoAperto && o.tipo !== "briefing") {
        const r = await c.esecutore.vendi(s, `${o.runId}-${s}-sell`, "prezzo oltre lo stop", o.attesaCancMs);
        if (r.stato === "venduto" || r.stato === "niente da vendere") {
          out.push({ simbolo: s, stato: "venduta", dettagli: `prezzo ${prezzo.toFixed(2)} oltre lo stop ${livello.toFixed(2)}: ${r.stato} (${c.motivoUscita(piano, prezzo)})` });
          continue;
        }
        out.push({ simbolo: s, stato: "non protetta", dettagli: `vendita non riuscita: ${r.stato}`, allarme: `${s}: prezzo oltre lo stop ma vendita non riuscita (${r.stato}); protezione lasciata com'è` });
        continue;
      }
      if (k.stops.length || k.trailing.length) {
        // la protezione esistente resta finché non si vende
        out.push({ simbolo: s, stato: "vendita all'apertura", dettagli: `prezzo ${prezzo.toFixed(2)} oltre lo stop ${livello.toFixed(2)}: si vende alla sveglia di apertura` });
        continue;
      }
    }

    let valida = false;
    let dettagli = "";
    if (piano.modalita === "bracket") {
      const st = k.stops.find((x) => x.qty - x.filledQty === pos.qty);
      const lim = k.limits.find((x) => x.qty - x.filledQty === pos.qty && (!st || (x.parentId ?? x.id) === (st.parentId ?? st.id) || x.id === st.parentId || st.id === x.parentId));
      const quantitaOk = !!st && k.stops.length === 1 && k.trailing.length === 0;
      if (quantitaOk && st) {
        valida = true;
        const vecchia = eta(st, o.now) > o.maxGiorni;
        if (vecchia && o.tipo === "apertura") valida = false;
        else if (o.tipo === "briefing" && ((piano.stop !== null && !eq(st.stopPrice, piano.stop)) || (piano.takeProfit !== null && lim && !eq(lim.limitPrice, piano.takeProfit)))) {
          out.push({ simbolo: s, stato: "ok", dettagli: "livelli diversi dal piano: si allineano alla sveglia di apertura (il briefing non modifica ordini)" });
          continue;
        } else {
          if (!eq(st.stopPrice, piano.stop) && piano.stop !== null) {
            const r = await c.esecutore.modifica(st, { stopPrice: arrotondaGiu(piano.stop) }, "protezione");
            dettagli += r.ok ? `stop portato a ${piano.stop}` : `modifica dello stop fallita (${r.errore})`;
            if (!r.ok) valida = false;
          }
          if (valida && piano.takeProfit !== null && lim && !eq(lim.limitPrice, piano.takeProfit)) {
            const r = await c.esecutore.modifica(lim, { limitPrice: arrotondaSu(piano.takeProfit) }, "protezione");
            dettagli += (dettagli ? "; " : "") + (r.ok ? `take profit portato a ${piano.takeProfit}` : `modifica del take profit fallita (${r.errore})`);
            if (!r.ok) valida = false;
          }
          if (valida && piano.takeProfit !== null && !lim) valida = false; // manca la gamba di take profit
          if (valida) {
            out.push({ simbolo: s, stato: dettagli ? "modificata" : "ok", dettagli: dettagli || (vecchia ? `protezione con più di ${o.maxGiorni} giorni: si ricrea all'apertura` : "protezione coerente con il piano") });
            continue;
          }
        }
      }
    } else {
      const tr = k.trailing.find((x) => x.qty - x.filledQty === pos.qty);
      if (tr && k.trailing.length === 1 && k.stops.length === 0) {
        valida = true;
        const vecchia = eta(tr, o.now) > o.maxGiorni;
        if (vecchia && o.tipo === "apertura") valida = false;
        else {
          const want = piano.trailPrice ?? piano.trailingPct;
          const have = piano.trailPrice != null ? tr.trailPrice : tr.trailPercent;
          if (want != null && !eq(have, want) && o.tipo === "briefing") {
            out.push({ simbolo: s, stato: "ok", dettagli: "stop mobile diverso dal piano: si allinea alla sveglia di apertura" });
            continue;
          }
          if (want != null && !eq(have, want)) {
            const r = await c.esecutore.modifica(tr, { trail: want }, "protezione");
            if (!r.ok) valida = false;
            dettagli = r.ok ? `stop mobile portato a ${want}${piano.trailPrice != null ? " $" : "%"}` : `modifica dello stop mobile fallita (${r.errore})`;
          }
          if (valida) {
            if (tr.hwm != null && tr.hwm > piano.massimo) c.aggiornaPiano(s, { massimo: tr.hwm }, "massimo aggiornato dal broker");
            out.push({ simbolo: s, stato: dettagli ? "modificata" : "ok", dettagli: dettagli || "stop mobile coerente con il piano" });
            continue;
          }
        }
      }
    }
    // protezione mancante, di quantità sbagliata, vecchia o non modificabile: cancella e ricrea
    out.push(await ricrea(pos, piano, prezzo, k.open, c, o));
  }
  return out;
}

async function ricrea(pos: Position, piano: PianoUscita, prezzo: number | null, esistenti: Order[], c: ContestoProtezioni, o: OpzioniProtezioni): Promise<EsitoProtezione> {
  const s = pos.symbol;
  if (esistenti.length) {
    const canc = await c.esecutore.cancellaEAttendi(esistenti, o.attesaCancMs);
    if (!canc.ok) return { simbolo: s, stato: "non protetta", dettagli: "cancellazione delle vecchie protezioni non confermata", allarme: `${s}: protezione incoerente e cancellazione non confermata` };
  }
  const posNow = await c.esecutore.posizione(s).catch(() => null);
  const qty = posNow ? Math.floor(posNow.qty) : 0;
  if (qty <= 0) return { simbolo: s, stato: "venduta", dettagli: "posizione chiusa durante la riparazione (una gamba si è eseguita)" };
  if (prezzo === null) return { simbolo: s, stato: "non protetta", dettagli: "prezzo attuale non disponibile", allarme: `${s}: prezzo non disponibile, impossibile ricreare la protezione` };
  let ultimoErrore = "";
  for (let t = 1; t <= o.tentativi; t++) {
    const id = `${o.runId}-${s}-protect${t > 1 ? t : ""}`;
    let esito;
    if (piano.modalita === "bracket") {
      if (piano.stop === null || piano.takeProfit === null) return { simbolo: s, stato: "non protetta", dettagli: "piano senza livelli", allarme: `${s}: piano senza livelli` };
      const stop = arrotondaGiu(piano.stop);
      const tp = arrotondaSu(Math.max(piano.takeProfit, prezzo + 0.01));
      if (stop > prezzo - 0.01) return { simbolo: s, stato: "vendita all'apertura", dettagli: "stop sopra il prezzo: impossibile ricreare l'OCO, si vende appena il mercato apre", allarme: `${s}: NON PROTETTA, prezzo sotto lo stop` };
      esito = await c.esecutore.invia({ clientOrderId: id, symbol: s, side: "sell", type: "limit", qty, tif: "gtc", orderClass: "oco", takeProfit: { limitPrice: tp }, stopLoss: { stopPrice: stop } }, "protect");
    } else {
      const lvl = livelloStop(piano);
      if (lvl === null) return { simbolo: s, stato: "non protetta", dettagli: "piano senza stop mobile", allarme: `${s}: piano senza stop mobile` };
      if (prezzo <= lvl) return { simbolo: s, stato: "vendita all'apertura", dettagli: "prezzo già sotto il livello dello stop mobile", allarme: `${s}: NON PROTETTA, prezzo sotto lo stop mobile` };
      // lo stop mobile ricreato riparte dal massimo registrato: trail_price che riproduce lo stesso livello
      const trail = arrotondaGiu(prezzo - lvl);
      const useTrailPrice = piano.massimo > prezzo + 1e-9 || piano.trailPrice != null;
      esito = await c.esecutore.invia(
        useTrailPrice
          ? { clientOrderId: id, symbol: s, side: "sell", type: "trailing_stop", qty, tif: "gtc", trailPrice: Math.max(0.01, trail) }
          : { clientOrderId: id, symbol: s, side: "sell", type: "trailing_stop", qty, tif: "gtc", trailPercent: piano.trailingPct! },
        "protect",
      );
      if (esito.stato === "inviato" && useTrailPrice) c.aggiornaPiano(s, { trailPrice: Math.max(0.01, trail) }, `stop mobile ricreato dal massimo ${piano.massimo.toFixed(2)} con trail_price ${trail}`);
    }
    if (esito.stato === "inviato" || esito.stato === "già presente") {
      if (qty !== piano.quantita) c.aggiornaPiano(s, { quantita: qty }, "quantità aggiornata");
      return { simbolo: s, stato: "ricreata", dettagli: `protezione ricreata (${esito.id})`, allarme: `${s}: protezione ricreata` };
    }
    ultimoErrore = esito.errore ?? esito.stato;
    if (esito.stato === "esito sconosciuto") break; // non si rimanda alla cieca
  }
  return { simbolo: s, stato: "non protetta", dettagli: `ricreazione fallita: ${ultimoErrore}`, allarme: `${s}: NON PROTETTA, ricreazione fallita dopo ${o.tentativi} tentativi (${ultimoErrore})` };
}
