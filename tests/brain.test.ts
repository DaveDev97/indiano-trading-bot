import { describe, expect, test } from "bun:test";
import { buildArgs, interpretaUscita } from "../src/brain/claude.ts";
import { chiamaCervello, SCHEMA_DECISIONE, SYSTEM_DECISIONE, validaDecisione } from "../src/brain/cervello.ts";
import { FakeBrain } from "../src/brain/fake.ts";
import { readUsage } from "../src/brain/usage.ts";
import { loadParams, saveParams } from "../src/params/params.ts";
import { makeCtx } from "./ctx.ts";
import { rmRoot } from "./helpers.ts";

const ok = JSON.stringify({
  type: "result", subtype: "success", is_error: false, duration_ms: 5000, duration_api_ms: 4000, num_turns: 2, total_cost_usd: 0.031,
  usage: { input_tokens: 10, output_tokens: 5 },
  modelUsage: { "claude-sonnet-5-5": { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 500, cacheCreationInputTokens: 100, costUSD: 0.03 }, "claude-haiku-5-5": { inputTokens: 50, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.001 } },
  structured_output: { decisions: [], reasoning: "x", planNext: "y" },
});

describe("uscita di claude -p (test 43, 45)", () => {
  test("riuscita: token e costo da modelUsage e total_cost_usd", () => {
    const r = interpretaUscita(0, ok, false, 5100);
    expect(r.esito).toBe("ok");
    expect(r.consumi.costoUsd).toBe(0.031);
    expect(r.consumi.token).toEqual({ input: 1050, output: 210, cacheLettura: 500, cacheScrittura: 100 });
  });
  test("timeout: non misurato, mai zero", () => {
    const r = interpretaUscita(null, "", true, 180_000);
    expect(r.esito).toBe("timeout");
    expect(r.consumi.costoUsd).toBeNull();
    expect(r.consumi.token).toBeNull();
  });
  test("oltre il tetto: budget superato, costo = total_cost_usd (include la risposta oltre il tetto)", () => {
    const j = JSON.parse(ok);
    j.subtype = "error_max_budget_usd";
    j.is_error = true;
    j.total_cost_usd = 1.07;
    j.usage = { input_tokens: 0, output_tokens: 0 };
    delete j.structured_output;
    const r = interpretaUscita(1, JSON.stringify(j), false, 1000);
    expect(r.esito).toBe("budget superato");
    expect(r.consumi.costoUsd).toBe(1.07);
  });
  test("errore con costi azzerati: non misurato", () => {
    const r = interpretaUscita(1, JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, total_cost_usd: 0, modelUsage: {} }), false, 1000);
    expect(r.esito).toBe("errore");
    expect(r.consumi.costoUsd).toBeNull();
  });
  test("structured_output assente: risposta non valida", () => {
    const j = JSON.parse(ok);
    delete j.structured_output;
    expect(interpretaUscita(0, JSON.stringify(j), false, 1).esito).toBe("risposta non valida");
  });
  test("argomenti: niente --max-turns se l'help non lo elenca; niente --model con il predefinito; mai --bare", () => {
    const a = buildArgs("claude", { versione: "x", flags: ["--tools", "--max-budget-usd", "--setting-sources", "--system-prompt", "--bare"] }, { schema: {}, systemPrompt: "s", model: "predefinito", maxBudgetUsd: 1 });
    expect(a).not.toContain("--max-turns");
    expect(a).not.toContain("--model");
    expect(a).not.toContain("--bare");
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    expect(a[a.indexOf("--max-budget-usd") + 1]).toBe("1.00");
  });
});

describe("validatore della decisione", () => {
  test("accetta una risposta corretta e normalizza i simboli", () => {
    const v = validaDecisione({ decisions: [{ simbolo: "aapl", azione: "compra", perche: "x" }], reasoning: "r", planNext: "p" });
    expect(v.ok && v.valore.decisions[0]!.simbolo).toBe("AAPL");
  });
  test("rifiuta azioni sconosciute, quantità e strutture sbagliate", () => {
    expect(validaDecisione({ decisions: [{ simbolo: "AAPL", azione: "short", perche: "x" }], reasoning: "r", planNext: "p" }).ok).toBe(false);
    expect(validaDecisione({ decisions: "no", reasoning: "r", planNext: "p" }).ok).toBe(false);
    expect(validaDecisione(null).ok).toBe(false);
    expect(validaDecisione({ decisions: [], planNext: "p" }).ok).toBe(false);
  });
});

function req(runId: string) {
  return { task: "decisione-apertura", runId, forzata: false, systemPrompt: SYSTEM_DECISIONE, istruzioni: "Decidi.", dati: { candidati: [], posizioni: [], postiLiberi: 0 }, schema: SCHEMA_DECISIONE, valida: validaDecisione, modello: "predefinito", tetto: 1 };
}

describe("chiamata al cervello e consumi (test 43, 45, 46)", () => {
  test("ogni chiamata registra una riga, anche se fallisce", async () => {
    const brain = new FakeBrain();
    const ctx = makeCtx({ now: "2026-11-23T15:00:00Z", brain });
    const { params: P } = loadParams(ctx.paths);
    expect((await chiamaCervello(ctx, P, req("r1"))).ok).toBe(true);
    brain.mode = "timeout";
    expect((await chiamaCervello(ctx, P, req("r2"))).ok).toBe(false);
    brain.mode = "non valida";
    expect((await chiamaCervello(ctx, P, req("r3"))).ok).toBe(false);
    brain.mode = "errore azzerato";
    await chiamaCervello(ctx, P, req("r4"));
    const rows = readUsage(ctx.paths);
    expect(rows.map((r) => r.esito)).toEqual(["ok", "timeout", "risposta non valida", "errore"]);
    expect(rows[1]!.token).toBeNull();
    expect(rows[1]!.costoUsd).toBeNull();
    expect(rows[3]!.costoUsd).toBeNull();
    expect(rows[2]!.costoUsd).toBe(0.012);
    rmRoot(ctx.paths);
  });
  test("2 chiamate di fila oltre il tetto → allarme \"tetto per chiamata troppo basso\"", async () => {
    const brain = new FakeBrain();
    brain.mode = "budget";
    const ctx = makeCtx({ now: "2026-11-23T15:00:00Z", brain });
    const { params: P } = loadParams(ctx.paths);
    const a = await chiamaCervello(ctx, P, req("r1"));
    const b = await chiamaCervello(ctx, P, req("r2"));
    expect(a.ok).toBe(false);
    expect(a.allarmi.join()).not.toContain("troppo basso");
    expect(b.allarmi.join()).toContain("troppo basso");
    rmRoot(ctx.paths);
  });
  test("budget all'80%: un solo avviso nel mese; in modalità \"sospendi\" il cervello non viene chiamato", async () => {
    const brain = new FakeBrain();
    brain.costo = 9;
    const ctx = makeCtx({ now: "2026-11-23T15:00:00Z", brain });
    loadParams(ctx.paths);
    saveParams(ctx.paths, { "ai.budgetMensile": 20, "ai.azioneBudget": "sospendi il cervello" }, { autore: "test", versioneAttesa: 1 });
    const P = loadParams(ctx.paths).params;
    const a1 = await chiamaCervello(ctx, P, req("r1")); // 9 $
    const a2 = await chiamaCervello(ctx, P, req("r2")); // 18 $ → 90%
    const a3 = await chiamaCervello(ctx, P, req("r3")); // 27 $ → oltre il 100%
    expect(a1.allarmi).toEqual([]);
    expect(a2.allarmi.filter((x) => x.includes("80%")).length).toBe(1);
    expect(a3.allarmi.filter((x) => x.includes("80%")).length).toBe(0);
    expect(a3.allarmi.some((x) => x.includes("SOSPESO"))).toBe(true);
    const n = brain.calls.length;
    const a4 = await chiamaCervello(ctx, P, req("r4"));
    expect(a4.ok).toBe(false);
    if (!a4.ok) expect(a4.sospeso).toBe(true);
    expect(brain.calls.length).toBe(n);
    rmRoot(ctx.paths);
  });
});

import { eseguiSveglia } from "../src/run/sveglia.ts";
import { scenario } from "./scenario.ts";
describe("modelli per tipo di compito", () => {
  test("apertura e metà seduta usano il modello delle decisioni complesse, briefing e chiusura quello semplice", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"]] });
    for (const t of ["briefing", "apertura", "meta", "chiusura"] as const) {
      const s = sc.slot(t);
      sc.setNowAt(s);
      await eseguiSveglia(sc.ctx, { slot: s, forzata: false });
    }
    expect(sc.brain.calls.map((c) => `${c.task}:${c.model}`)).toEqual([
      "decisione-briefing:claude-sonnet-5-5", "decisione-apertura:claude-opus-5-5", "decisione-meta:claude-opus-5-5", "decisione-chiusura:claude-sonnet-5-5",
    ]);
    rmRoot(sc.ctx.paths);
  });
});
