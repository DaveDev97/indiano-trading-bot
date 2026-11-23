// Intervallo di confidenza bootstrap (percentili) della media, con generatore deterministico.
import { mulberry32 } from "../data/fake.ts";

export function bootstrapMedia(x: number[], confidenza: number, ricampionamenti: number, seed = 12345): [number, number] {
  if (x.length === 0) return [NaN, NaN];
  const rnd = mulberry32(seed);
  const medie = new Float64Array(ricampionamenti);
  for (let b = 0; b < ricampionamenti; b++) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[Math.floor(rnd() * x.length)]!;
    medie[b] = s / x.length;
  }
  medie.sort();
  const alpha = 1 - confidenza;
  const q = (p: number) => medie[Math.min(ricampionamenti - 1, Math.max(0, Math.floor(p * ricampionamenti)))]!;
  return [q(alpha / 2), q(1 - alpha / 2)];
}

/** Confidenza corretta con Bonferroni per m confronti: alpha / m. */
export function confidenzaBonferroni(confidenza: number, m: number): number {
  return 1 - (1 - confidenza) / Math.max(1, m);
}
