// Cervello finto, deterministico: compra i primi candidati nei posti liberi, vende le uscite deboli.
// Si può forzare a fallire (timeout, risposta non valida, budget, errore) per i test.
import type { ClaudeResult, Consumi } from "./claude.ts";
import type { Brain, BrainRequest } from "./types.ts";

export type FakeBrainMode = "ok" | "timeout" | "non valida" | "budget" | "errore" | "errore azzerato" | "tieni";

export function estraiDati(prompt: string): any {
  const i = prompt.lastIndexOf("DATI:");
  if (i < 0) return {};
  try {
    return JSON.parse(prompt.slice(i + 5));
  } catch {
    return {};
  }
}

const consumiFinti = (costo = 0.012): Consumi => ({
  costoUsd: costo,
  token: { input: 1200, output: 300, cacheLettura: 800, cacheScrittura: 200 },
  perModello: { "modello-finto": { inputTokens: 1200, outputTokens: 300, cacheReadInputTokens: 800, cacheCreationInputTokens: 200, costUSD: costo } },
  durataApiMs: 900,
  turni: 2,
  subtype: "success",
});

export class FakeBrain implements Brain {
  readonly name = "finto" as const;
  mode: FakeBrainMode = "ok";
  calls: BrainRequest[] = [];
  /** Risposta imposta dai test (sostituisce quella calcolata). */
  override: unknown = null;
  costo = 0.012;

  async run(req: BrainRequest): Promise<ClaudeResult> {
    this.calls.push(req);
    const base = { durataMs: 1000, testo: null, modello: "modello-finto" };
    switch (this.mode) {
      case "timeout":
        return { ...base, esito: "timeout", structured: null, consumi: { costoUsd: null, token: null, perModello: {}, durataApiMs: null, turni: null, subtype: null }, errore: "timeout: processo terminato", modello: null };
      case "non valida":
        return { ...base, esito: "ok", structured: { decisions: "non è un array" }, consumi: consumiFinti(this.costo) };
      case "budget":
        return { ...base, esito: "budget superato", structured: null, consumi: { ...consumiFinti(this.costo), subtype: "error_max_budget_usd" }, errore: "tetto per chiamata superato" };
      case "errore":
        return { ...base, esito: "errore", structured: null, consumi: consumiFinti(this.costo), errore: "errore finto" };
      case "errore azzerato":
        return { ...base, esito: "errore", structured: null, consumi: { costoUsd: null, token: null, perModello: {}, durataApiMs: 0, turni: 0, subtype: "error_during_execution" }, errore: "error_during_execution" };
    }
    if (this.override) return { ...base, esito: "ok", structured: this.override, consumi: consumiFinti(this.costo) };
    const d = estraiDati(req.prompt);
    if (req.task === "review") {
      return { ...base, esito: "ok", structured: { testo: "Review di prova (cervello finto): numeri calcolati dal codice, nessuna valutazione del modello.", proposteScelte: (d.proposteCandidate ?? []).map((p: any) => p.id), affidabilita: "bassa" }, consumi: consumiFinti(this.costo) };
    }
    const decisions: any[] = [];
    for (const p of d.posizioni ?? []) {
      if ((p.usciteDeboli ?? []).length && this.mode !== "tieni") decisions.push({ simbolo: p.simbolo, azione: "vendi", perche: `uscita debole: ${p.usciteDeboli[0]}` });
      else decisions.push({ simbolo: p.simbolo, azione: "tieni", perche: "nessun segnale di uscita" });
    }
    let liberi = Number(d.postiLiberi ?? 0);
    for (const c of d.candidati ?? []) {
      if (liberi <= 0 || this.mode === "tieni" || d.acquistiAmmessi === false) break;
      decisions.push({ simbolo: c.simbolo, azione: "compra", perche: `primo per punteggio (${c.punteggio})` });
      liberi--;
    }
    return {
      ...base,
      esito: "ok",
      structured: { decisions, reasoning: "Decisione del cervello finto: segue l'ordine di punteggio. Nessuna valutazione discrezionale. Serve solo alle prove.", planNext: "Continuare a seguire le regole.", lezione: "" },
      consumi: consumiFinti(this.costo),
    };
  }
}
