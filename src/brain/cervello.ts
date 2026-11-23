// Il cervello "propone": riceve un JSON costruito dal codice e sceglie tra opzioni già ammesse.
// Ogni chiamata, riuscita o no, registra i consumi. La risposta si valida comunque nel codice.
import type { Ctx } from "../run/context.ts";
import type { Params } from "../params/params.ts";
import { appendUsage, rigaDaRisultato } from "./usage.ts";
import { cervelloSospeso, controllaBudget } from "./budget.ts";
import type { Azione, Decisione } from "../cage/gabbia.ts";

export const SYSTEM_DECISIONE = [
  "Sei il \"cervello\" di un bot di paper trading su azioni USA (conto simulato). Rispondi sempre in italiano.",
  "Il codice ha già selezionato i titoli, calcolato indicatori, quantità e rischi, e applica una gabbia di regole.",
  "Tu scegli SOLO tra le opzioni presenti nei DATI:",
  "- compra: solo simboli dell'elenco `candidati`, al massimo quanti sono i `postiLiberi`;",
  "- vendi: solo posizioni con `usciteDeboli` non vuote (le uscite forti le esegue il codice da solo);",
  "- tieni: per le posizioni che restano.",
  "Non indicare quantità né prezzi. Non inventare dati: se un dato manca, è non disponibile.",
  "Tieni conto delle lezioni (errori e rifiuti passati) e delle ultime conclusioni della review.",
  "Per ogni decisione scrivi il perché in una frase. `reasoning`: 3–5 frasi. `planNext`: cosa osservare alla prossima sveglia. `lezione`: facoltativa, una frase.",
].join("\n");

export const SCHEMA_DECISIONE = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { simbolo: { type: "string" }, azione: { type: "string", enum: ["compra", "vendi", "tieni"] }, perche: { type: "string" } },
        required: ["simbolo", "azione", "perche"],
      },
    },
    reasoning: { type: "string" },
    planNext: { type: "string" },
    lezione: { type: "string" },
  },
  required: ["decisions", "reasoning", "planNext"],
};

export interface RispostaDecisione {
  decisions: Decisione[];
  reasoning: string;
  planNext: string;
  lezione: string | null;
}

/** Validatore scritto a mano (lo schema di claude -p non basta). */
export function validaDecisione(v: unknown): { ok: true; valore: RispostaDecisione } | { ok: false; errore: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, errore: "la risposta non è un oggetto" };
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.decisions)) return { ok: false, errore: "decisions non è un array" };
  if (o.decisions.length > 30) return { ok: false, errore: "troppe decisioni" };
  const out: Decisione[] = [];
  for (const [i, d] of o.decisions.entries()) {
    if (!d || typeof d !== "object") return { ok: false, errore: `decisione ${i} non valida` };
    const x = d as Record<string, unknown>;
    if (typeof x.simbolo !== "string" || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(x.simbolo.trim().toUpperCase())) return { ok: false, errore: `decisione ${i}: simbolo non valido` };
    if (x.azione !== "compra" && x.azione !== "vendi" && x.azione !== "tieni") return { ok: false, errore: `decisione ${i}: azione non valida` };
    if (typeof x.perche !== "string") return { ok: false, errore: `decisione ${i}: perché mancante` };
    out.push({ simbolo: x.simbolo.trim().toUpperCase(), azione: x.azione as Azione, perche: x.perche.slice(0, 400) });
  }
  if (typeof o.reasoning !== "string" || !o.reasoning.trim()) return { ok: false, errore: "reasoning mancante" };
  if (typeof o.planNext !== "string") return { ok: false, errore: "planNext mancante" };
  if (o.lezione !== undefined && typeof o.lezione !== "string") return { ok: false, errore: "lezione non valida" };
  return { ok: true, valore: { decisions: out, reasoning: o.reasoning.slice(0, 2000), planNext: o.planNext.slice(0, 1000), lezione: typeof o.lezione === "string" && o.lezione.trim() ? o.lezione.slice(0, 400) : null } };
}

export type EsitoCervello<T> =
  | { ok: true; valore: T; allarmi: string[] }
  | { ok: false; motivo: string; allarmi: string[]; sospeso: boolean };

export interface RichiestaCervello<T> {
  task: string;
  runId: string;
  forzata: boolean;
  systemPrompt: string;
  istruzioni: string;
  dati: unknown;
  schema: object;
  valida: (v: unknown) => { ok: true; valore: T } | { ok: false; errore: string };
  modello: string;
  tetto: number;
}

export async function chiamaCervello<T>(ctx: Ctx, P: Params, r: RichiestaCervello<T>): Promise<EsitoCervello<T>> {
  const now = ctx.now();
  const budget = P.n("ai.budgetMensile");
  const azione = P.s("ai.azioneBudget");
  const sosp = cervelloSospeso(ctx.paths, budget, azione, now);
  if (sosp.sospeso) return { ok: false, motivo: `cervello sospeso: budget mensile stimato superato (${sosp.spesa.toFixed(2)} $ su ${budget.toFixed(2)} $)`, allarmi: [], sospeso: true };
  const prompt = `${r.istruzioni}\n\nDATI:\n${JSON.stringify(r.dati)}`;
  const modello = r.modello === "predefinito" ? null : r.modello;
  const res = await ctx.brain.run({ task: r.task, systemPrompt: r.systemPrompt, prompt, schema: r.schema, model: modello, maxBudgetUsd: r.tetto, timeoutMs: P.n("ai.timeoutSec") * 1000 });
  let esito = res.esito;
  let valore: T | null = null;
  let errore = res.errore;
  if (esito === "ok") {
    const v = r.valida(res.structured);
    if (v.ok) valore = v.valore;
    else {
      esito = "risposta non valida";
      errore = v.errore;
    }
  }
  const riga = rigaDaRisultato({ ...res, esito, errore }, { runId: r.runId, task: r.task, promptByte: Buffer.byteLength(prompt), forzata: r.forzata, modelloRichiesto: r.modello }, now);
  let allarmi: string[] = [];
  try {
    appendUsage(ctx.paths, riga);
    allarmi = controllaBudget(ctx.paths, riga, budget, azione, r.tetto, now);
  } catch (e) {
    ctx.log.warn("registro consumi AI non aggiornato", { errore: String(e) });
  }
  if (valore !== null) return { ok: true, valore, allarmi };
  return { ok: false, motivo: `cervello: ${esito}${errore ? ` (${errore})` : ""}`, allarmi, sospeso: false };
}
