// Percorsi di stato, log e cache. La modalità --fake usa una radice separata (fake/).
import * as path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
export const FAKE_ROOT = path.join(PROJECT_ROOT, "fake");

export interface Paths {
  root: string;
  state: string;
  logs: string;
  cache: string;
  runLock: string;
  scanLock: string;
  paramsLock: string;
  journalLock: string;
  baton: string;
  history: string;
  params: string;
  paramsHistory: string;
  watchlist: string;
  segnali: string;
  piani: string;
  freno: string;
  journal: string;
  aiUsage: string;
  aiState: string;
  proposte: string;
  reviews: string;
  telegramOffset: string;
  sveglie: string;
  allarmi: string;
  fakeBroker: string;
  scanHistory: string;
  scanState: string;
  pausaAcquisti: string;
  telegramFake: string;
  finnhubCache: string;
  dashboardCodes: string;
}

export function makePaths(root: string): Paths {
  const state = path.join(root, "state");
  const logs = path.join(root, "logs");
  const cache = path.join(root, "cache");
  return {
    root,
    state,
    logs,
    cache,
    runLock: path.join(state, "run.lock"),
    scanLock: path.join(state, "scan.lock"),
    paramsLock: path.join(state, "params.lock"),
    journalLock: path.join(state, "journal.lock"),
    baton: path.join(state, "baton.json"),
    history: path.join(state, "history"),
    params: path.join(state, "params.json"),
    paramsHistory: path.join(state, "params-history"),
    watchlist: path.join(state, "watchlist.json"),
    segnali: path.join(state, "segnali"),
    piani: path.join(state, "piani-uscita.json"),
    freno: path.join(state, "freno.json"),
    journal: path.join(state, "journal"),
    aiUsage: path.join(state, "ai-usage"),
    aiState: path.join(state, "ai-stato.json"),
    proposte: path.join(state, "proposte.json"),
    reviews: path.join(state, "reviews"),
    telegramOffset: path.join(state, "telegram-offset.json"),
    sveglie: path.join(state, "sveglie.json"),
    allarmi: path.join(state, "allarmi.json"),
    fakeBroker: path.join(state, "fake-broker.json"),
    scanHistory: path.join(state, "scan-storico.json"),
    scanState: path.join(state, "scan-stato.json"),
    pausaAcquisti: path.join(state, "pausa-acquisti.json"),
    telegramFake: path.join(logs, "telegram-finto.log"),
    finnhubCache: path.join(cache, "finnhub"),
    dashboardCodes: path.join(state, "codici-azioni.json"),
  };
}
