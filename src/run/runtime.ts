// Costruzione del contesto per i comandi: reale (Alpaca paper, Finnhub, claude -p, Telegram) o finto (--fake).
import * as path from "node:path";
import { FAKE_ROOT, makePaths, PROJECT_ROOT } from "../config/paths.ts";
import { assertPaperSafety, loadSecrets, type Secrets } from "../config/segreti.ts";
import { AlpacaBroker } from "../broker/alpaca.ts";
import { FakeBroker } from "../broker/fake.ts";
import { AlpacaData } from "../data/alpaca-data.ts";
import { FinnhubClient } from "../data/finnhub.ts";
import { FakeMarket } from "../data/fake.ts";
import { ClaudeBrain } from "../brain/real.ts";
import { FakeBrain } from "../brain/fake.ts";
import { FakeTelegram, TelegramClient } from "../telegram/client.ts";
import { createLogger, type Logger } from "../util/log.ts";
import { realProcessProbe } from "../util/process.ts";
import { sleep } from "../util/time.ts";
import type { Ctx } from "./context.ts";

export interface Runtime {
  ctx: Ctx;
  secrets: Secrets | null;
}

export async function buildRuntime(opts: { fake: boolean; logFile?: (paths: ReturnType<typeof makePaths>) => string | null; echo?: boolean; nowOverride?: string }): Promise<Runtime> {
  const now = opts.nowOverride ? (() => {
    const start = Date.parse(opts.nowOverride!);
    const t0 = Date.now();
    return () => new Date(start + (Date.now() - t0));
  })() : () => new Date();
  if (opts.fake) {
    const paths = makePaths(FAKE_ROOT);
    const log = createLogger(opts.logFile?.(paths) ?? null, opts.echo ?? true);
    const market = new FakeMarket(now);
    const broker = new FakeBroker({ now, file: paths.fakeBroker, priceProvider: (s) => market.currentPrice(s) });
    broker.state.assets = market.assets();
    const ctx: Ctx = { paths, fake: true, now, broker, data: market, fund: market, brain: new FakeBrain(), tg: new FakeTelegram(paths.telegramFake), probe: realProcessProbe, log, sleep, chatId: "finto" };
    return { ctx, secrets: null };
  }
  const secrets = await loadSecrets();
  if (!secrets) throw new Error("secrets.ts non trovato: copia secrets.example.ts in secrets.ts e compila i valori.");
  assertPaperSafety(secrets);
  const paths = makePaths(PROJECT_ROOT);
  const log: Logger = createLogger(opts.logFile?.(paths) ?? null, opts.echo ?? true);
  const ctx: Ctx = {
    paths,
    fake: false,
    now,
    broker: new AlpacaBroker(secrets.alpaca.keyId, secrets.alpaca.secretKey),
    data: new AlpacaData(secrets.alpaca.keyId, secrets.alpaca.secretKey, fetch, now),
    fund: new FinnhubClient(secrets.finnhub.apiKey),
    brain: new ClaudeBrain(secrets.claude.oauthToken || null, paths.cache),
    tg: secrets.telegram.botToken && secrets.telegram.chatId ? new TelegramClient(secrets.telegram.botToken, secrets.telegram.chatId, log) : new FakeTelegram(path.join(paths.logs, "telegram-non-configurato.log")),
    probe: realProcessProbe,
    log,
    sleep,
    chatId: secrets.telegram.chatId || null,
  };
  return { ctx, secrets };
}
