// Dati per la dashboard, con una piccola cache (30 s) per non interrogare Alpaca a ogni clic.
import type { Ctx } from "../run/context.ts";
import { flattenOrders, type Account, type Order, type Position } from "../broker/types.ts";
import { leggiFreno, type StatoFreno } from "../cage/freno.ts";
import { leggiPiani, type Piani } from "../run/piani.ts";
import { leggiStatoSveglie } from "../run/sveglia.ts";
import { situazione, type SlotPrevisto } from "../run/calendario.ts";
import { loadParams, type Params } from "../params/params.ts";
import { readJsonOr, readJsonSafe } from "../util/atomic.ts";
import { addDays, dateInTz, TZ_NY } from "../util/time.ts";
import { closedBars } from "../data/bars.ts";
import { BENCHMARK } from "../config/settori.ts";
import type { Watchlist } from "../scan/scan.ts";
import { variazioneDaChiusura } from "../data/types.ts";
import { errText } from "../util/redact.ts";

const cache = new Map<string, { t: number; v: unknown }>();
export async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.t < ms) return c.v as T;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
export function svuotaCache(): void {
  cache.clear();
}

export interface Conto {
  account: Account;
  posizioni: Position[];
  aperti: Order[];
  mercatoAperto: boolean;
  prezzi: Record<string, number>;
  spyOggi: number | null;
}

export async function conto(ctx: Ctx): Promise<Conto> {
  return cached("conto", 30_000, async () => {
    const [account, posizioni, aperti, clock] = await Promise.all([ctx.broker.getAccount(), ctx.broker.getPositions(), ctx.broker.listOrders({ status: "open" }).then(flattenOrders), ctx.broker.getClock()]);
    const prezzi: Record<string, number> = {};
    let spyOggi: number | null = null;
    try {
      const s = await ctx.data.getSnapshots([...posizioni.map((p) => p.symbol), BENCHMARK]);
      for (const [k, v] of Object.entries(s)) prezzi[k] = v.price;
      spyOggi = variazioneDaChiusura(s[BENCHMARK], dateInTz(ctx.now(), TZ_NY));
    } catch {}
    for (const p of posizioni) if (prezzi[p.symbol] === undefined && p.currentPrice) prezzi[p.symbol] = p.currentPrice;
    return { account, posizioni, aperti, mercatoAperto: clock.isOpen, prezzi, spyOggi };
  });
}

export interface Storia {
  avvio: string;
  patrimonio: { data: string; v: number }[];
  spy: { data: string; v: number }[];
}

export async function storia(ctx: Ctx): Promise<Storia> {
  return cached("storia", 60_000, async () => {
    const avvio = leggiFreno(ctx.paths, ctx.now()).stato.avvio;
    const h = await ctx.broker.getPortfolioHistory(avvio);
    const patrimonio = h.timestamps.map((t, i) => ({ data: dateInTz(new Date(t * 1000), TZ_NY), v: h.equity[i] })).filter((x): x is { data: string; v: number } => typeof x.v === "number" && x.v > 0);
    let spy: { data: string; v: number }[] = [];
    try {
      const cal = await ctx.broker.getCalendar(addDays(avvio, -10), dateInTz(ctx.now(), TZ_NY));
      const raw = await ctx.data.getDailyBars([BENCHMARK], { start: addDays(avvio, -10), end: ctx.now(), adjustment: "all" });
      spy = closedBars(raw[BENCHMARK] ?? [], ctx.now(), cal).map((b) => ({ data: b.t, v: b.c }));
    } catch {}
    return { avvio, patrimonio, spy };
  });
}

/** Rendimento tra la chiusura prima di `da` e l'ultimo valore. */
export function rendimentoDa(serie: { data: string; v: number }[], da: string, ultimo?: number): number | null {
  const base = serie.filter((x) => x.data < da).at(-1) ?? serie.find((x) => x.data >= da);
  const fine = ultimo ?? serie.at(-1)?.v;
  return base && fine ? fine / base.v - 1 : null;
}

export interface StatoBot {
  P: Params;
  freno: StatoFreno;
  pausaAcquisti: boolean;
  allarmi: { runId: string; ts: string; allarmi: string[]; nonProtette: string[] } | null;
  ultima: { id: string; tipo: string; eseguitaIl: string } | null;
  prossima: SlotPrevisto | null;
  watchlist: Watchlist | null;
  etaWatchlist: number | null;
  piani: Piani;
  erroreCalendario?: string;
}

export async function statoBot(ctx: Ctx): Promise<StatoBot> {
  const P = loadParams(ctx.paths, ctx.now()).params;
  const st = leggiStatoSveglie(ctx);
  const ultima = st.eseguite.at(-1) ?? null;
  let prossima: SlotPrevisto | null = null;
  let erroreCalendario: string | undefined;
  try {
    const oggi = dateInTz(ctx.now(), TZ_NY);
    const cal = await cached("cal", 3_600_000, () => ctx.broker.getCalendar(oggi, addDays(oggi, 10)));
    prossima = situazione(cal, P, ctx.now(), new Set(st.eseguite.map((x) => x.id)), null).prossima;
  } catch (e) {
    erroreCalendario = errText(e);
  }
  const wl = readJsonSafe<Watchlist>(ctx.paths.watchlist);
  return {
    P,
    freno: leggiFreno(ctx.paths, ctx.now()).stato,
    pausaAcquisti: readJsonOr<{ attiva: boolean }>(ctx.paths.pausaAcquisti, { attiva: false }).attiva,
    allarmi: readJsonOr(ctx.paths.allarmi, null),
    ultima: ultima ? { id: ultima.id, tipo: ultima.tipo, eseguitaIl: ultima.eseguitaIl } : null,
    prossima,
    watchlist: wl.ok ? wl.value : null,
    etaWatchlist: wl.ok ? Math.floor((ctx.now().getTime() - Date.parse(wl.value.generata)) / 86_400_000) : null,
    piani: leggiPiani(ctx.paths).piani,
    erroreCalendario,
  };
}
