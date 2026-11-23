// Contesto di esecuzione: tutto ciò che un comando usa, iniettabile nei test.
import type { Paths } from "../config/paths.ts";
import type { Broker } from "../broker/types.ts";
import type { Fundamentals, MarketData } from "../data/types.ts";
import type { Brain } from "../brain/types.ts";
import type { Telegram } from "../telegram/types.ts";
import type { ProcessProbe } from "../util/process.ts";
import type { Logger } from "../util/log.ts";

export interface Ctx {
  paths: Paths;
  fake: boolean;
  now: () => Date;
  broker: Broker;
  data: MarketData;
  fund: Fundamentals;
  brain: Brain;
  tg: Telegram;
  probe: ProcessProbe;
  log: Logger;
  sleep: (ms: number) => Promise<void>;
  /** Chat autorizzata per i pulsanti. */
  chatId: string | null;
}
