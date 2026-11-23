// Scenario finto controllato per i test della sveglia: candele con rottura, watchlist scritta a mano.
import type { Bar } from "../src/data/types.ts";
import { fakeCalendar } from "../src/data/calendario-finto.ts";
import { mulberry32, gaussian, type FakeSymbolSpec } from "../src/data/fake.ts";
import { writeJsonAtomic } from "../src/util/atomic.ts";
import { FakeBrain } from "../src/brain/fake.ts";
import type { Watchlist } from "../src/scan/scan.ts";
import type { VoceClassifica } from "../src/scan/classifica.ts";
import type { Settore } from "../src/config/settori.ts";
import { makeCtx, type TestCtx } from "./ctx.ts";
import { slotsDelGiorno, type SlotPrevisto } from "../src/run/calendario.ts";
import { loadParams } from "../src/params/params.ts";
import { addDays } from "../src/util/time.ts";

/** Candele su sedute vere, in trend, con rottura con volume all'ultima seduta (`fino`). */
export function barsSessioni(fino: string, seed: number, breakout = true, n = 330): Bar[] {
  const days = fakeCalendar(addDays(fino, -700), fino).slice(-n);
  const r = mulberry32(seed);
  const out: Bar[] = [];
  let p = 40 + seed;
  for (let i = 0; i < days.length - 1; i++) {
    const c = p * (1 + 0.003 + gaussian(r) * 0.004);
    out.push({ t: days[i]!.date, o: p, h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1000 });
    p = c;
  }
  const last = days[days.length - 1]!.date;
  if (breakout) {
    const hi = Math.max(...out.slice(-20).map((b) => b.h));
    const c = hi * 1.03;
    out.push({ t: last, o: p, h: c * 1.001, l: p * 0.999, c, v: 3000 });
  } else out.push({ t: last, o: p, h: p * 1.004, l: p * 0.996, c: p * 1.001, v: 1000 });
  return out.map((b) => ({ ...b, o: r2(b.o), h: r2(b.h), l: r2(b.l), c: r2(b.c) }));
}
const r2 = (x: number) => Math.round(x * 100) / 100;

export function flatBars(like: Bar[], price = 100): Bar[] {
  return like.map((b) => ({ t: b.t, o: price, h: price, l: price, c: price, v: 1e6 }));
}

export interface Scenario {
  ctx: TestCtx;
  brain: FakeBrain;
  slot(tipo: SlotPrevisto["tipo"], seduta?: string): SlotPrevisto;
  setNowAt(s: SlotPrevisto, minuti?: number): void;
  seduta: string;
}

export const SIMBOLI: [string, Settore][] = [
  ["AAA", "Technology"], ["BBB", "Technology"], ["CCC", "Energy"], ["DDD", "Financial"], ["EEE", "Healthcare"], ["FFF", "Industrials"], ["GGG", "Utilities"],
];

function voce(s: string, settore: Settore, i: number): VoceClassifica {
  return { simbolo: s, nome: `Società ${s}`, settore, industria: "x", profilo: "growth", punteggio: 90 - i, percentili: {}, posizioneSettore: 1, posizioneGenerale: i + 1, criteri: [{ id: "growth.roe", nome: "ROE", valore: 25, valoreClassifica: 25, soglia: "> 15", esito: "superato", campo: "roeTTM", passiDallaSoglia: 0 }], capitalizzazione: 50_000, prezzo: 50 };
}

export function scriviWatchlist(ctx: TestCtx, opts: { simboli?: [string, Settore][]; forti?: Settore[]; generata?: string } = {}): void {
  const sim = opts.simboli ?? SIMBOLI;
  const forti = opts.forti ?? [...new Set(sim.map((x) => x[1]))];
  const wl: Watchlist = {
    data: "2026-11-21", generata: opts.generata ?? "2026-11-21T09:30:00Z", paramsVersione: "v1",
    forza: { data: "2026-11-20", periodo: 63, spy: { 21: 0.01, 63: 0.02, 126: 0.03 }, settori: forti.map((s) => ({ settore: s, etf: "XL", rendimenti: { 21: 0.02, 63: 0.05, 126: 0.06 }, forte: true })), forti },
    acquistabili: sim.map(([s, set], i) => voce(s, set, i)),
    zonaGrigia: [], settoriDeboli: [],
    conteggi: { universo: 0, prefiltro: 0, conDati: 0, valutati: 0, profili: { growth: 0, value: 0, dividendo: 0 }, esclusi: {} },
    criteriNonDisponibili: {}, industrieNonMappate: {}, avvisi: [], completa: true,
  };
  writeJsonAtomic(ctx.paths.watchlist, wl);
}

/** Scenario: seduta di martedì 24/11/2026, candele chiuse fino a lunedì 23 con rottura su tutti i simboli. */
export function scenario(opts: { seduta?: string; simboli?: [string, Settore][]; breakout?: boolean; cash?: number; root?: string; brokerSuFile?: boolean; probe?: import("../src/util/process.ts").ProcessProbe } = {}): Scenario {
  const seduta = opts.seduta ?? "2026-11-24";
  const prevSeduta = fakeCalendar(addDays(seduta, -10), addDays(seduta, -1)).at(-1)!.date;
  const sim = opts.simboli ?? SIMBOLI;
  const specs: FakeSymbolSpec[] = sim.map(([s]) => ({ symbol: s, name: `Società ${s}`, industry: "x", exchange: "NYSE", drift: 0, vol: 0, start: 50, volume: 1, metrics: {}, earningsInDays: 30 }));
  specs.push({ symbol: "SPY", name: "SPY", industry: null, exchange: "ARCA", drift: 0, vol: 0, start: 100, volume: 1, metrics: {}, isEtf: true });
  const brain = new FakeBrain();
  const ctx = makeCtx({ now: `${seduta}T08:30:00Z`, specs, brain, cash: opts.cash, root: opts.root, brokerSuFile: opts.brokerSuFile, probe: opts.probe });
  if (opts.brokerSuFile) ctx.broker.state.assets = ctx.data.assets();
  let spy: Bar[] = [];
  sim.forEach(([s], i) => {
    const b = barsSessioni(prevSeduta, i + 3, opts.breakout ?? true);
    ctx.data.barOverrides.set(s, b);
    ctx.data.priceOverrides.set(s, r2(b.at(-1)!.c * 1.002));
    spy = flatBars(b);
  });
  ctx.data.barOverrides.set("SPY", spy);
  ctx.data.priceOverrides.set("SPY", 100);
  if (!require("node:fs").existsSync(ctx.paths.watchlist)) scriviWatchlist(ctx, { simboli: sim });
  const P = loadParams(ctx.paths).params;
  const cal = fakeCalendar(seduta, seduta)[0]!;
  return {
    ctx, brain, seduta,
    slot: (tipo, d = seduta) => slotsDelGiorno(fakeCalendar(d, d)[0]!, P).find((x) => x.tipo === tipo)!,
    setNowAt: (s, minuti = 1) => ctx.setNow(new Date(s.at.getTime() + minuti * 60_000).toISOString()),
  };
}
