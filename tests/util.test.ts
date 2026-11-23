import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { addDays, dateInTz, formatRome, hhmmInTz, TZ_NY, TZ_ROME, weekdayOf, zonedToUtc } from "../src/util/time.ts";
import { _resetSecretsForTest, errText, redact, registerSecret } from "../src/util/redact.ts";
import { readJsonSafe, writeJsonAtomic } from "../src/util/atomic.ts";
import { withShortLock } from "../src/util/shortlock.ts";
import { appendJsonl, readJsonl } from "../src/util/jsonl.ts";
import { parseArgs } from "../src/util/args.ts";
import { createLogger } from "../src/util/log.ts";
import { rmRoot, tempRoot } from "./helpers.ts";
import * as path from "node:path";

describe("tempo", () => {
  test("apertura NY in ora di Roma con ora legale disallineata (16 marzo 2026)", () => {
    // USA in ora legale dall'8 marzo 2026, Europa dal 29 marzo: differenza di 5 ore invece di 6.
    const open = zonedToUtc("2026-03-16", "09:30", TZ_NY);
    expect(open.toISOString()).toBe("2026-03-16T13:30:00.000Z");
    expect(hhmmInTz(new Date(open.getTime() + 10 * 60_000), TZ_ROME)).toBe("1440");
  });
  test("apertura in un giorno normale (24 settembre 2026) → 15:40 Roma", () => {
    const open = zonedToUtc("2026-09-24", "09:30", TZ_NY);
    expect(hhmmInTz(new Date(open.getTime() + 10 * 60_000), TZ_ROME)).toBe("1540");
  });
  test("inverno (23 novembre 2026)", () => {
    expect(zonedToUtc("2026-11-23", "09:30", TZ_NY).toISOString()).toBe("2026-11-23T14:30:00.000Z");
    expect(zonedToUtc("2026-11-23", "09:30", TZ_ROME).toISOString()).toBe("2026-11-23T08:30:00.000Z");
  });
  test("mezzanotte di Roma nel giorno del cambio d'ora", () => {
    // 29 marzo 2026: alle 02:00 Roma passa a +2. 00:30 è ancora +1.
    const t = zonedToUtc("2026-03-29", "00:30", TZ_ROME);
    expect(t.toISOString()).toBe("2026-03-28T23:30:00.000Z");
    expect(dateInTz(t, TZ_ROME)).toBe("2026-03-29");
    // 25 ottobre 2026: torna a +1. 00:30 è ancora +2.
    const u = zonedToUtc("2026-10-25", "00:30", TZ_ROME);
    expect(u.toISOString()).toBe("2026-10-24T22:30:00.000Z");
  });
  test("aritmetica di calendario", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-11-23")).toBe(1);
    expect(formatRome(new Date("2026-11-23T14:40:00Z"))).toBe("23/11/2026 15:40");
  });
});

describe("redact", () => {
  test("oscura i segreti registrati e il token di Telegram anche in un URL", () => {
    _resetSecretsForTest();
    registerSecret("PKSEGRETO123456");
    const t = "123456789:AAH_abcdefghijklmnopqrstuvwxyz012345";
    const s = redact(`errore fetch https://api.telegram.org/bot${t}/sendMessage chiave PKSEGRETO123456`);
    expect(s).not.toContain("PKSEGRETO123456");
    expect(s).not.toContain("AAH_abcdefghij");
    expect(s).toContain("[OSCURATO]");
  });
  test("errText include la causa e la oscura", () => {
    _resetSecretsForTest();
    registerSecret("segretissimo-xyz");
    const e = new Error("fallito", { cause: new Error("connessione a segretissimo-xyz") });
    expect(errText(e)).not.toContain("segretissimo-xyz");
  });
  test("il logger non scrive segreti", () => {
    _resetSecretsForTest();
    registerSecret("chiave-molto-segreta");
    const p = tempRoot("log");
    const f = path.join(p.logs, "x.log");
    const log = createLogger(f);
    log.error("prova", { msg: "boom chiave-molto-segreta" });
    expect(fs.readFileSync(f, "utf8")).not.toContain("chiave-molto-segreta");
    rmRoot(p);
  });
});

describe("file", () => {
  test("scrittura atomica e lettura di un file corrotto", () => {
    const p = tempRoot("atomic");
    const f = path.join(p.state, "a.json");
    writeJsonAtomic(f, { x: 1 });
    expect(readJsonSafe<any>(f)).toEqual({ ok: true, value: { x: 1 } });
    fs.writeFileSync(f, "{ rotto");
    const r = readJsonSafe(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("corrotto");
    expect(readJsonSafe(path.join(p.state, "manca.json"))).toEqual({ ok: false, reason: "assente" });
    rmRoot(p);
  });
  test("lock breve: rilascio e rimozione di un lock di un processo morto", () => {
    const p = tempRoot("lock");
    fs.mkdirSync(p.state, { recursive: true });
    expect(withShortLock(p.journalLock, () => 42)).toBe(42);
    expect(fs.existsSync(p.journalLock)).toBe(false);
    fs.writeFileSync(p.journalLock, JSON.stringify({ pid: 999999, procStart: 0, at: Date.now(), token: "x" }));
    expect(withShortLock(p.journalLock, () => "ok", 3000)).toBe("ok");
    rmRoot(p);
  });
  test("lock breve di un processo vivo: timeout", () => {
    const p = tempRoot("lock2");
    fs.mkdirSync(p.state, { recursive: true });
    fs.writeFileSync(p.journalLock, JSON.stringify({ pid: process.pid, procStart: 0, at: Date.now(), token: "y" }));
    expect(() => withShortLock(p.journalLock, () => 1, 200)).toThrow();
    rmRoot(p);
  });
  test("JSONL: righe corrotte saltate e contate", () => {
    const p = tempRoot("jsonl");
    const f = path.join(p.state, "j.jsonl");
    appendJsonl(f, p.journalLock, [{ a: 1 }, { a: 2 }]);
    fs.appendFileSync(f, "{rotta\n");
    appendJsonl(f, p.journalLock, [{ a: 3 }]);
    const r = readJsonl(f);
    expect(r.rows.map((x: any) => x.a)).toEqual([1, 2, 3]);
    expect(r.corrupt).toBe(1);
    rmRoot(p);
  });
  test("argomenti", () => {
    const a = parseArgs(["--slot", "briefing", "--force", "--fake"]);
    expect(a.values.get("slot")).toBe("briefing");
    expect(a.flags.has("force")).toBe(true);
    expect(a.flags.has("fake")).toBe(true);
  });
});

import { linuxStartMs } from "../src/util/process.ts";
describe("processi su Linux", () => {
  test("ora di avvio da /proc/<pid>/stat, anche con spazi e parentesi nel nome", () => {
    // 52 campi; il 22° (starttime) vale 123456 tick = 1234,56 s dopo l'accensione
    const campi = ["S", "1", "1234", "1234", "0", "-1", "4194560", "100", "0", "0", "0", "1", "1", "0", "0", "20", "0", "1", "0", "123456", "1000", "100"];
    const stat = `4321 (bun (worker) x) ${campi.join(" ")} 0 0 0`;
    const files: Record<string, string> = { "/proc/4321/stat": stat, "/proc/stat": "cpu 1 2 3\nbtime 1764000000\nprocesses 9\n" };
    expect(linuxStartMs(4321, 100, (p) => files[p]!)).toBe(Math.round((1764000000 + 1234.56) * 1000));
    expect(linuxStartMs(4321, 100, () => { throw new Error("assente"); })).toBeNull();
  });
});
