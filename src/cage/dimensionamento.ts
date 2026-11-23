// Dimensionamento (§4.6): parte intera di min(peso × patrimonio, cash disponibile × 0,99) ÷ prezzo.
import type { Order } from "../broker/types.ts";

export function quantita(prezzo: number, patrimonio: number, cashDisponibile: number, peso: number, margineCash: number): number {
  if (!(prezzo > 0) || !(patrimonio > 0)) return 0;
  const budget = Math.min(peso * patrimonio, Math.max(0, cashDisponibile) * margineCash);
  return Math.max(0, Math.floor(budget / prezzo + 1e-9));
}

/** Impegno stimato degli acquisti ancora aperti (Alpaca aggiorna il cash solo a esecuzione avvenuta). */
export function impegnoAcquistiAperti(openOrders: Order[], prezzo: (s: string) => number | null): number {
  let tot = 0;
  for (const o of openOrders) {
    if (o.side !== "buy" || o.parentId) continue;
    const resto = o.qty - o.filledQty;
    if (resto <= 0) continue;
    const p = o.limitPrice ?? prezzo(o.symbol) ?? 0;
    tot += resto * p * 1.01; // margine per lo slittamento dell'ordine a mercato
  }
  return tot;
}

/** Cash che si può ancora spendere in questa sveglia. Mai sotto zero. */
export class CassaSveglia {
  private speso = 0;
  constructor(
    private readonly cash: number,
    private readonly impegnato: number,
  ) {}
  get disponibile(): number {
    return Math.max(0, this.cash - this.impegnato - this.speso);
  }
  impegna(importo: number): void {
    this.speso += Math.max(0, importo);
  }
}
