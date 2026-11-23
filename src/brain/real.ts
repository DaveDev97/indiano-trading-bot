// Cervello vero: claude -p.
import { callClaude, type ClaudeResult } from "./claude.ts";
import type { Brain, BrainRequest } from "./types.ts";

export class ClaudeBrain implements Brain {
  readonly name = "claude" as const;
  constructor(
    private readonly oauthToken: string | null,
    private readonly cacheDir: string,
  ) {}
  run(req: BrainRequest): Promise<ClaudeResult> {
    return callClaude({ prompt: req.prompt, schema: req.schema, systemPrompt: req.systemPrompt, model: req.model, maxBudgetUsd: req.maxBudgetUsd, timeoutMs: req.timeoutMs, oauthToken: this.oauthToken, cacheDir: this.cacheDir });
  }
}
