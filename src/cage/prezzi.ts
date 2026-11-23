// Prezzi degli ordini (§4.6): 2 decimali da 1 $ in su, 4 sotto. Stop per difetto, take profit per eccesso.

const scale = (p: number) => (p >= 1 ? 100 : 10_000);

export function arrotondaGiu(p: number): number {
  let s = scale(p);
  let r = Math.floor(p * s + 1e-7) / s;
  if (r < 1 && s === 100) {
    s = 10_000;
    r = Math.floor(p * s + 1e-7) / s;
  }
  return r;
}

export function arrotondaSu(p: number): number {
  const s = scale(p);
  return Math.ceil(p * s - 1e-7) / s;
}

export function arrotonda(p: number): number {
  const s = scale(p);
  return Math.round(p * s) / s;
}

export interface LivelliBracket {
  stop: number;
  takeProfit: number;
}

/** Livelli iniziali dal prezzo di base. Errore se lo stop non sta almeno 0,01 $ sotto il prezzo. */
export function livelliBracket(base: number, stopPct: number, tpPct: number): LivelliBracket | { errore: string } {
  const stop = arrotondaGiu(base * (1 - stopPct / 100));
  const takeProfit = arrotondaSu(base * (1 + tpPct / 100));
  if (!(stop <= base - 0.01)) return { errore: `stop ${stop} non almeno 0,01 $ sotto il prezzo ${base}` };
  if (!(takeProfit >= base + 0.01)) return { errore: `take profit ${takeProfit} non sopra il prezzo ${base}` };
  if (stop <= 0) return { errore: "stop non positivo" };
  return { stop, takeProfit };
}
