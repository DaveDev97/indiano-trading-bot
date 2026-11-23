import { describe, expect, test } from "bun:test";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { crc32, creaTarGz, creaZip } from "../src/util/archivi.ts";

const voci = [
  { nome: "pkg/a.txt", dati: new TextEncoder().encode("ciao àèì\n".repeat(50)), modo: 0o644 },
  { nome: "pkg/start.sh", dati: new TextEncoder().encode("#!/usr/bin/env bash\necho ok\n"), modo: 0o755 },
  { nome: `pkg/${"cartella-lunga/".repeat(8)}file.ts`, dati: new Uint8Array([1, 2, 3, 0, 255]), modo: 0o644 },
];

describe("archivi dei pacchetti", () => {
  test("crc32 di riferimento", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  test("zip: la directory centrale punta a dati che si decomprimono uguali", () => {
    const z = creaZip(voci);
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    const fine = z.byteLength - 22;
    expect(dv.getUint32(fine, true)).toBe(0x06054b50);
    const n = dv.getUint16(fine + 10, true);
    let p = dv.getUint32(fine + 16, true);
    expect(n).toBe(3);
    for (let i = 0; i < n; i++) {
      expect(dv.getUint32(p, true)).toBe(0x02014b50);
      const comp = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
      const nome = new TextDecoder().decode(z.subarray(p + 46, p + 46 + nlen));
      const v = voci.find((x) => x.nome === nome)!;
      const dati = inflateRawSync(z.subarray(off + 30 + nlen, off + 30 + nlen + comp));
      expect(new Uint8Array(dati)).toEqual(v.dati);
      expect(crc32(new Uint8Array(dati))).toBe(dv.getUint32(p + 16, true));
      p += 46 + nlen;
    }
  });
  test("tar.gz: nomi lunghi con prefisso, permessi, contenuto", () => {
    const t = new Uint8Array(gunzipSync(creaTarGz(voci)));
    let o = 0;
    const letti: { nome: string; modo: number; dati: Uint8Array }[] = [];
    while (t[o] !== 0) {
      const h = t.subarray(o, o + 512);
      const s = (a: number, l: number) => new TextDecoder().decode(h.subarray(a, a + l)).replace(/\0.*$/s, "");
      const somma = h.reduce((a, b, i) => a + (i >= 148 && i < 156 ? 32 : b), 0);
      expect(parseInt(s(148, 8), 8)).toBe(somma);
      const size = parseInt(s(124, 12), 8);
      const prefisso = s(345, 155);
      letti.push({ nome: prefisso ? `${prefisso}/${s(0, 100)}` : s(0, 100), modo: parseInt(s(100, 8), 8), dati: t.slice(o + 512, o + 512 + size) });
      o += 512 + Math.ceil(size / 512) * 512;
    }
    expect(letti.map((x) => x.nome)).toEqual(voci.map((x) => x.nome));
    expect(letti[1]!.modo).toBe(0o755);
    letti.forEach((x, i) => expect(x.dati).toEqual(voci[i]!.dati));
  });
});
