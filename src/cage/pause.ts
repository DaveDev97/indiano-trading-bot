// Pause (§4.6, §6.10): dopo le uscite (dagli ordini chiusi su Alpaca, non dal testimone) e dopo rifiuti ripetuti.
import type { Broker, CalendarDay, Order } from "../broker/types.ts";
import type { EventoDiario } from "../journal/journal.ts";
import { addDays, dateInTz, TZ_NY } from "../util/time.ts";

export interface Pausa {
  simbolo: string;
  motivo: string;
  finoA: string | null; // ultima seduta di pausa (inclusa)
  sedute: number;
}

/** Sedute di borsa con data > da e ≤ a. */
export function seduteTra(calendar: CalendarDay[], da: string, a: string): number {
  return calendar.filter((c) => c.date > da && c.date <= a).length;
}

/** Data della N-esima seduta dopo `da` (null se oltre il calendario disponibile). */
export function ennesimaSeduta(calendar: CalendarDay[], da: string, n: number): string | null {
  const after = calendar.filter((c) => c.date > da).map((c) => c.date);
  return after[n - 1] ?? null;
}

export interface UscitaBroker {
  simbolo: string;
  data: string;
  prezzo: number;
  tipo: string;
  inPerdita: boolean | null;
  ordine: Order;
}

/** Uscite (vendite eseguite) degli ultimi 30 giorni, con il prezzo dell'ultimo acquisto precedente per capire se in perdita. */
export async function usciteRecenti(broker: Broker, now: Date): Promise<UscitaBroker[]> {
  const after = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const closed = await broker.listOrders({ status: "closed", after });
  const sells = closed.filter((o) => o.side === "sell" && o.status === "filled" && o.filledAt && o.filledAvgPrice);
  if (!sells.length) return [];
  const syms = [...new Set(sells.map((s) => s.symbol))];
  const buysAll = await broker.listOrders({ status: "closed", after: new Date(now.getTime() - 400 * 86_400_000).toISOString(), symbols: syms });
  const buys = buysAll.filter((o) => o.side === "buy" && o.filledAt && o.filledAvgPrice && o.filledQty > 0);
  return sells.map((s) => {
    const prev = buys.filter((b) => b.symbol === s.symbol && b.filledAt! <= s.filledAt!).sort((a, b) => (a.filledAt! < b.filledAt! ? 1 : -1))[0];
    return {
      simbolo: s.symbol,
      data: dateInTz(new Date(s.filledAt!), TZ_NY),
      prezzo: s.filledAvgPrice!,
      tipo: s.type,
      inPerdita: prev ? s.filledAvgPrice! < prev.filledAvgPrice! : null,
      ordine: s,
    };
  });
}

/**
 * Pause dopo le uscite: 10 sedute dopo uno stop in perdita, 3 dopo qualsiasi altra uscita.
 * Prudenza: uno stop con prezzo di acquisto sconosciuto vale come stop in perdita.
 */
export function pauseDaUscite(uscite: UscitaBroker[], calendar: CalendarDay[], oggi: string, dopoStop: number, dopoAltro: number): Pausa[] {
  const out = new Map<string, Pausa>();
  for (const u of uscite) {
    const isStop = u.tipo === "stop" || u.tipo === "trailing_stop" || u.tipo === "stop_limit";
    const stopPerdita = isStop && u.inPerdita !== false;
    const n = stopPerdita ? dopoStop : dopoAltro;
    if (n <= 0) continue;
    const trascorse = seduteTra(calendar, u.data, oggi);
    if (trascorse > n) continue;
    const p: Pausa = { simbolo: u.simbolo, motivo: stopPerdita ? `stop in perdita il ${u.data}` : `uscita il ${u.data}`, finoA: ennesimaSeduta(calendar, u.data, n), sedute: n };
    const prev = out.get(u.simbolo);
    if (!prev || (p.finoA ?? "9") > (prev.finoA ?? "9") || (prev.finoA !== null && p.finoA === null)) out.set(u.simbolo, p);
  }
  return [...out.values()];
}

export interface Lezione {
  tipo: string;
  simbolo: string;
  motivo: string;
  codice: string;
  volte: number;
  ultima: string;
  ultimaSeduta: string;
}

/** Lezioni dagli ultimi rifiuti ed errori del diario (gli ultimi 20 gruppi tipo/simbolo/motivo). */
export function lezioniDalDiario(eventi: EventoDiario[], limite = 20): Lezione[] {
  const map = new Map<string, Lezione>();
  for (const e of eventi) {
    if (e.tipo !== "rifiuto" && e.tipo !== "errore") continue;
    const simbolo = String(e.simbolo ?? "-");
    const codice = String(e.codice ?? e.motivo ?? "errore");
    const k = `${e.tipo}|${simbolo}|${codice}`;
    const l = map.get(k) ?? { tipo: e.tipo, simbolo, motivo: String(e.motivo ?? ""), codice, volte: 0, ultima: e.ts, ultimaSeduta: String(e.seduta ?? e.ts.slice(0, 10)) };
    l.volte++;
    l.ultima = e.ts;
    l.motivo = String(e.motivo ?? l.motivo);
    l.ultimaSeduta = String(e.seduta ?? e.ts.slice(0, 10));
    map.set(k, l);
  }
  return [...map.values()].sort((a, b) => (a.ultima < b.ultima ? 1 : -1)).slice(0, limite);
}

/**
 * Blocchi dai rifiuti: un ordine rifiutato non si ripropone nella stessa seduta; dopo N rifiuti per lo stesso
 * motivo resta in pausa per M sedute dopo l'ultimo.
 */
export function pauseDaRifiuti(eventi: EventoDiario[], calendar: CalendarDay[], seduta: string, soglia: number, sedutePausa: number): Pausa[] {
  const out: Pausa[] = [];
  const perChiave = new Map<string, { simbolo: string; codice: string; motivo: string; sedute: string[] }>();
  for (const e of eventi) {
    if (e.tipo !== "rifiuto" || !e.simbolo || e.azione !== "compra") continue;
    // i rifiuti strutturali della gabbia (sveglia senza ingressi, posti esauriti, limite di settore…) non dicono nulla
    // sull'ordine: restano nel diario e nelle lezioni, ma non fanno scattare la pausa
    if (String(e.codice ?? "").startsWith("gabbia-")) continue;
    const k = `${e.simbolo}|${e.codice ?? e.motivo}`;
    const g = perChiave.get(k) ?? { simbolo: String(e.simbolo), codice: String(e.codice ?? ""), motivo: String(e.motivo ?? ""), sedute: [] };
    g.sedute.push(String(e.seduta ?? ""));
    perChiave.set(k, g);
  }
  for (const g of perChiave.values()) {
    const ultima = g.sedute.sort().at(-1)!;
    if (ultima === seduta) {
      out.push({ simbolo: g.simbolo, motivo: `rifiutato oggi: ${g.motivo}`, finoA: seduta, sedute: 0 });
      continue;
    }
    if (g.sedute.length >= soglia && seduteTra(calendar, ultima, seduta) <= sedutePausa) {
      out.push({ simbolo: g.simbolo, motivo: `rifiutato ${g.sedute.length} volte per lo stesso motivo (${g.motivo})`, finoA: ennesimaSeduta(calendar, ultima, sedutePausa), sedute: sedutePausa });
    }
  }
  return out;
}

export function calendarioPer(oggi: string): { start: string; end: string } {
  return { start: addDays(oggi, -60), end: addDays(oggi, 30) };
}
