import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { listVersions, loadParams, restoreVersion, saveParams } from "../src/params/params.ts";
import { PARAM_DEFS } from "../src/config/parametri.ts";
import { readJournal } from "../src/journal/journal.ts";
import { rmRoot, tempRoot } from "./helpers.ts";

describe("parametri", () => {
  test("crea v1 con i valori iniziali", () => {
    const p = tempRoot("par");
    const { params, allarme } = loadParams(p);
    expect(allarme).toBeUndefined();
    expect(params.versione).toBe("v1");
    expect(params.n("segnali.adxMin")).toBe(20);
    expect(params.s("uscita.modalita")).toBe("bracket");
    expect(params.n("rischio.maxPosizioni")).toBe(5);
    rmRoot(p);
  });
  test("ogni parametro numerico iniziale è dentro il suo intervallo", () => {
    for (const d of PARAM_DEFS) {
      if (typeof d.iniziale === "number" && d.min !== undefined) expect(d.iniziale).toBeGreaterThanOrEqual(d.min);
      if (typeof d.iniziale === "number" && d.max !== undefined) expect(d.iniziale).toBeLessThanOrEqual(d.max);
    }
  });
  test("salvataggio: nuova versione, diario, storico", () => {
    const p = tempRoot("par2");
    loadParams(p);
    const r = saveParams(p, { "segnali.adxMin": 22 }, { autore: "utente", versioneAttesa: 1 });
    expect(r.ok).toBe(true);
    const { params } = loadParams(p);
    expect(params.versione).toBe("v2");
    expect(params.n("segnali.adxMin")).toBe(22);
    expect(listVersions(p).map((v) => v.versione)).toEqual([1, 2]);
    expect(readJournal(p).some((e) => e.tipo === "parametri")).toBe(true);
    rmRoot(p);
  });
  test("valore fuori intervallo: rifiutato con messaggio chiaro, nessuna nuova versione (test 31)", () => {
    const p = tempRoot("par3");
    loadParams(p);
    const r = saveParams(p, { "segnali.adxMin": 50 }, { autore: "utente", versioneAttesa: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errori[0]).toContain("sopra il massimo");
    expect(loadParams(p).params.versione).toBe("v1");
    const r2 = saveParams(p, { "rischio.maxPosizioni": 6 }, { autore: "utente", versioneAttesa: 1 });
    expect(r2.ok).toBe(false);
    rmRoot(p);
  });
  test("due salvataggi contemporanei sulla stessa versione: uno solo vince (test 41)", () => {
    const p = tempRoot("par4");
    loadParams(p);
    const a = saveParams(p, { "segnali.adxMin": 22 }, { autore: "utente", versioneAttesa: 1 });
    const b = saveParams(p, { "segnali.adxMin": 24 }, { autore: "utente", versioneAttesa: 1 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.conflitto).toBe(true);
    expect(listVersions(p).length).toBe(2);
    rmRoot(p);
  });
  test("ripristino di una versione precedente (test 28)", () => {
    const p = tempRoot("par5");
    loadParams(p);
    saveParams(p, { "segnali.adxMin": 22 }, { autore: "utente", versioneAttesa: 1 });
    const r = restoreVersion(p, 1, 2);
    expect(r.ok).toBe(true);
    const { params } = loadParams(p);
    expect(params.versione).toBe("v3");
    expect(params.n("segnali.adxMin")).toBe(20);
    rmRoot(p);
  });
  test("params.json corrotto: ultima versione valida dello storico + allarme", () => {
    const p = tempRoot("par6");
    loadParams(p);
    saveParams(p, { "segnali.adxMin": 22 }, { autore: "utente", versioneAttesa: 1 });
    fs.writeFileSync(p.params, "{{{");
    const { params, allarme } = loadParams(p);
    expect(params.versione).toBe("v2");
    expect(allarme).toContain("storico");
    rmRoot(p);
  });
});
