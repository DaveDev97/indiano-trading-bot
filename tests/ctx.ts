// Contesto finto per i test: broker, dati, cervello e Telegram finti, tempo controllabile.
import { FakeBroker } from "../src/broker/fake.ts";
import { FakeMarket, type FakeSymbolSpec } from "../src/data/fake.ts";
import type { Ctx } from "../src/run/context.ts";
import type { Brain } from "../src/brain/types.ts";
import type { Telegram } from "../src/telegram/types.ts";
import { memoryLogger } from "../src/util/log.ts";
import type { ProcessProbe } from "../src/util/process.ts";
import { tempRoot } from "./helpers.ts";
import { makePaths } from "../src/config/paths.ts";

export interface TestCtx extends Ctx {
  broker: FakeBroker;
  data: FakeMarket;
  fund: FakeMarket;
  clock: { t: Date };
  sent: string[];
  setNow(iso: string): void;
}

export function stubTelegram(sent: string[]): Telegram {
  return {
    name: "finto",
    async send(html) {
      sent.push(html);
      return { ok: true };
    },
    async getUpdates() {
      return { updates: [] };
    },
    async answerCallback() {},
  };
}

export const aliveProbe = (alive: Set<number> = new Set([process.pid])): ProcessProbe => ({
  pidExists: (pid) => alive.has(pid),
  isAlive: async (pid) => alive.has(pid),
});

export function makeCtx(opts: { now: string; specs?: FakeSymbolSpec[]; brain?: Brain; tg?: Telegram; cash?: number; root?: string; brokerSuFile?: boolean; probe?: ProcessProbe } = { now: "2026-11-23T15:00:00Z" }): TestCtx {
  const paths = opts.root ? makePaths(opts.root) : tempRoot("ctx");
  const clock = { t: new Date(opts.now) };
  const now = () => clock.t;
  const market = new FakeMarket(now, opts.specs);
  const broker = new FakeBroker({ now, initialCash: opts.cash ?? 100_000, priceProvider: (s) => market.currentPrice(s), file: opts.brokerSuFile ? paths.fakeBroker : undefined });
  broker.state.assets = market.assets();
  const sent: string[] = [];
  const ctx: TestCtx = {
    paths,
    fake: true,
    now,
    broker,
    data: market,
    fund: market,
    brain: opts.brain ?? ({ name: "finto", run: async () => { throw new Error("cervello non configurato nel test"); } } as Brain),
    tg: opts.tg ?? stubTelegram(sent),
    probe: opts.probe ?? aliveProbe(),
    log: memoryLogger(),
    sleep: async () => {},
    chatId: "42",
    clock,
    sent,
    setNow(iso: string) {
      clock.t = new Date(iso);
    },
  };
  return ctx;
}
