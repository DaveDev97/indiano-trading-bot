import { describe, expect, test } from "bun:test";
import { applicaOverride, leggiOverride, modificaOverride } from "../src/scan/override.ts";
import { eseguiSveglia } from "../src/run/sveglia.ts";
import { schedeReali } from "../src/journal/schede.ts";
import { readJournal } from "../src/journal/journal.ts";
import { readJsonSafe, writeJsonAtomic } from "../src/util/atomic.ts";
import type { Watchlist } from "../src/scan/scan.ts";
import { scenario } from "./scenario.ts";
import { makeCtx } from "./ctx.ts";
import { rmRoot } from "./helpers.ts";

/** Sposta un simbolo dagli acquistabili alla zona grigia (come se avesse mancato un criterio di poco). */
function inZonaGrigia(wl: Watchlist, sym: string): Watchlist {
  const v = wl.acquistabili.find((x) => x.simbolo === sym)!;
  return {
    ...wl,
    acquistabili: wl.acquistabili.filter((x) => x.simbolo !== sym),
    zonaGrigia: [...wl.zonaGrigia, { simbolo: v.simbolo, nome: v.nome, settore: v.settore, industria: v.industria, profilo: v.profilo, criterioMancato: { id: "growth.roe", nome: "ROE", valore: 14, soglia: "> 15", passi: 0.7 }, criteri: v.criteri }],
  };
}

describe("override della selezione", () => {
  test("rimossi esclusi, aggiunti dalla zona grigia inclusi e marcati; un aggiunto fuori zona grigia è sospeso", () => {
    const sc = scenario({ simboli: [["AAA", "Technology"], ["CCC", "Energy"], ["DDD", "Financial"]] });
    const wl = inZonaGrigia(readJsonSafe<Watchlist>(sc.ctx.paths.watchlist).value as Watchlist, "CCC");
    const r = applicaOverride(wl, { rimossi: { AAA: { quando: "x", nota: null } }, aggiunti: { CCC: { quando: "x", nota: null }, ZZZ: { quando: "x", nota: null } } });
    expect(r.wl.acquistabili.map((v) => v.simbolo)).toEqual(["DDD", "CCC"]);
    expect(r.wl.acquistabili.find((v) => v.simbolo === "CCC")!.override).toBe("aggiunto");
    expect(r.tolti.map((v) => v.simbolo)).toEqual(["AAA"]);
    expect(r.sospesi.map((s) => s.simbolo)).toEqual(["ZZZ"]);
    // la watchlist di partenza non cambia
    expect(wl.acquistabili.map((v) => v.simbolo)).toEqual(["AAA", "DDD"]);
    rmRoot(sc.ctx.paths);
  });

  test("aggiungi solo dalla zona grigia; rimuovi; annulla; ogni azione va nel diario", () => {
    const ctx = makeCtx({ now: "2026-11-24T10:00:00Z" });
    const sc = scenario({ root: ctx.paths.root, simboli: [["AAA", "Technology"], ["CCC", "Energy"]] });
    const wl = inZonaGrigia(readJsonSafe<Watchlist>(sc.ctx.paths.watchlist).value as Watchlist, "CCC");
    const now = new Date("2026-11-24T10:00:00Z");
    expect(modificaOverride(sc.ctx.paths, "aggiungi", "AAA", wl, now).ok).toBe(false); // è già acquistabile, non in zona grigia
    expect(modificaOverride(sc.ctx.paths, "aggiungi", "CCC", wl, now).ok).toBe(true);
    expect(modificaOverride(sc.ctx.paths, "aggiungi", "CCC", wl, now).ok).toBe(false); // doppio clic
    expect(modificaOverride(sc.ctx.paths, "rimuovi", "AAA", wl, now).ok).toBe(true);
    expect(leggiOverride(sc.ctx.paths)).toEqual({ aggiunti: { CCC: { quando: now.toISOString(), nota: null } }, rimossi: { AAA: { quando: now.toISOString(), nota: null } } });
    expect(modificaOverride(sc.ctx.paths, "annulla", "AAA", wl, now).ok).toBe(true);
    expect(modificaOverride(sc.ctx.paths, "annulla", "AAA", wl, now).ok).toBe(false);
    expect(readJournal(sc.ctx.paths).filter((e) => e.tipo === "override-selezione").length).toBe(3);
    rmRoot(sc.ctx.paths);
  });

  test("sveglia di apertura: compra l'aggiunto dalla zona grigia (marcato nella scheda), non compra il tolto", async () => {
    const sc = scenario({ simboli: [["AAA", "Technology"], ["CCC", "Energy"]] });
    const wl = inZonaGrigia(readJsonSafe<Watchlist>(sc.ctx.paths.watchlist).value as Watchlist, "CCC");
    writeJsonAtomic(sc.ctx.paths.watchlist, wl);
    const now = new Date("2026-11-24T10:00:00Z");
    modificaOverride(sc.ctx.paths, "rimuovi", "AAA", wl, now);
    modificaOverride(sc.ctx.paths, "aggiungi", "CCC", wl, now);
    const ap = sc.slot("apertura");
    sc.setNowAt(ap);
    const r = await eseguiSveglia(sc.ctx, { slot: ap, forzata: false });
    expect(r.candidati).toEqual(["CCC"]);
    const comprati = r.inviati.filter((x) => x.azione === "compra").map((x) => x.simbolo);
    expect(comprati).toContain("CCC");
    expect(comprati).not.toContain("AAA");
    expect(schedeReali(sc.ctx.paths).find((s) => s.ingresso.simbolo === "CCC")!.ingresso.override).toBe("aggiunto");
    rmRoot(sc.ctx.paths);
  });
});
