// Budget AI (§8.7): avvisi all'80% e al 100% una volta per soglia e per mese; sospensione opzionale;
// allarme "tetto per chiamata troppo basso" dopo 2 chiamate di fila oltre il tetto.
import type { Paths } from "../config/paths.ts";
import { readJsonOr, writeJsonAtomic } from "../util/atomic.ts";
import { withShortLock } from "../util/shortlock.ts";
import { monthRome } from "../util/time.ts";
import { readUsage, type RigaConsumo } from "./usage.ts";

interface StatoAi {
  avvisi: Record<string, number[]>;
  oltreTettoDiFila: number;
}

export function spesaMese(righe: RigaConsumo[], mese: string): { costo: number; nonMisurate: number; chiamate: number } {
  let costo = 0, nonMisurate = 0, chiamate = 0;
  for (const r of righe) {
    if (monthRome(new Date(r.ts)) !== mese) continue;
    chiamate++;
    if (r.costoUsd === null) nonMisurate++;
    else costo += r.costoUsd;
  }
  return { costo, nonMisurate, chiamate };
}

export function cervelloSospeso(paths: Paths, budget: number, azione: string, now: Date): { sospeso: boolean; spesa: number } {
  const s = spesaMese(readUsage(paths), monthRome(now));
  return { sospeso: azione === "sospendi il cervello" && s.costo >= budget, spesa: s.costo };
}

/** Da chiamare dopo ogni registrazione di consumo. Restituisce gli allarmi da mandare. */
export function controllaBudget(paths: Paths, riga: RigaConsumo, budget: number, azione: string, tetto: number, now: Date): string[] {
  return withShortLock(paths.paramsLock, () => {
    const st = readJsonOr<StatoAi>(paths.aiState, { avvisi: {}, oltreTettoDiFila: 0 });
    const out: string[] = [];
    const mese = monthRome(now);
    const { costo } = spesaMese(readUsage(paths), mese);
    const fatti = new Set(st.avvisi[mese] ?? []);
    for (const soglia of [80, 100]) {
      if (costo >= (budget * soglia) / 100 && !fatti.has(soglia)) {
        fatti.add(soglia);
        out.push(
          soglia === 100
            ? `Budget AI mensile stimato superato: ${costo.toFixed(2)} $ su ${budget.toFixed(2)} $. ${azione === "sospendi il cervello" ? "Cervello SOSPESO fino a fine mese: niente acquisti, protezioni e uscite forti continuano." : "Modalità \"solo avviso\": il cervello continua."}`
            : `Budget AI mensile stimato all'80%: ${costo.toFixed(2)} $ su ${budget.toFixed(2)} $.`,
        );
      }
    }
    st.avvisi[mese] = [...fatti];
    if (riga.esito === "budget superato") {
      st.oltreTettoDiFila++;
      if (st.oltreTettoDiFila === 2) out.push(`Tetto per chiamata troppo basso: 2 chiamate di fila l'hanno superato (tetto ${tetto.toFixed(2)} $, costo osservato ${riga.costoUsd !== null ? riga.costoUsd.toFixed(3) + " $" : "non misurato"}).`);
    } else st.oltreTettoDiFila = 0;
    writeJsonAtomic(paths.aiState, st);
    return out;
  });
}
