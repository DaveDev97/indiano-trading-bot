// Interfaccia del cervello: chiamata grezza (vero = claude -p, finto = deterministico).
import type { ClaudeResult } from "./claude.ts";

export interface BrainRequest {
  task: string;
  systemPrompt: string;
  /** Istruzioni + "DATI:" + JSON costruito dal codice. */
  prompt: string;
  schema: object;
  model: string | null;
  maxBudgetUsd: number;
  timeoutMs: number;
}

export interface Brain {
  readonly name: "claude" | "finto";
  run(req: BrainRequest): Promise<ClaudeResult>;
}
