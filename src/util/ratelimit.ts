// Limitatore a finestre scorrevoli (es. Finnhub: < 50/minuto e < 30/secondo).

export class RateLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly limits: { max: number; windowMs: number }[],
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      const longest = Math.max(...this.limits.map((l) => l.windowMs));
      this.stamps = this.stamps.filter((s) => t - s < longest);
      let wait = 0;
      for (const l of this.limits) {
        const inWin = this.stamps.filter((s) => t - s < l.windowMs);
        if (inWin.length >= l.max) wait = Math.max(wait, l.windowMs - (t - inWin[0]!) + 5);
      }
      if (wait <= 0) {
        this.stamps.push(t);
        return;
      }
      await this.sleep(wait);
    }
  }
}
