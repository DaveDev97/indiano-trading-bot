// Archivi .zip e .tar.gz scritti a mano (zero dipendenze): servono a `bun run build`.
import { deflateRawSync, gzipSync } from "node:zlib";

export interface VoceArchivio {
  /** Percorso dentro l'archivio, con "/". */
  nome: string;
  dati: Uint8Array;
  /** Permessi Unix (es. 0o755 per gli script). */
  modo?: number;
  mtime?: Date;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** ZIP con compressione deflate (metodo 8) e nomi UTF-8. */
export function creaZip(voci: VoceArchivio[]): Uint8Array {
  const parti: Uint8Array[] = [];
  const centrale: Uint8Array[] = [];
  let offset = 0;
  for (const v of voci) {
    const nome = new TextEncoder().encode(v.nome);
    const comp = new Uint8Array(deflateRawSync(v.dati, { level: 9 }));
    const crc = crc32(v.dati);
    const { time, date } = dosTime(v.mtime ?? new Date());
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true);
    loc.setUint16(4, 20, true);
    loc.setUint16(6, 0x0800, true); // nomi in UTF-8
    loc.setUint16(8, 8, true);
    loc.setUint16(10, time, true);
    loc.setUint16(12, date, true);
    loc.setUint32(14, crc, true);
    loc.setUint32(18, comp.length, true);
    loc.setUint32(22, v.dati.length, true);
    loc.setUint16(26, nome.length, true);
    loc.setUint16(28, 0, true);
    parti.push(new Uint8Array(loc.buffer), nome, comp);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, (3 << 8) | 20, true); // creato su Unix: conserva i permessi negli attributi esterni
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 8, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, comp.length, true);
    cen.setUint32(24, v.dati.length, true);
    cen.setUint16(28, nome.length, true);
    cen.setUint32(38, (((v.modo ?? 0o644) | 0o100000) << 16) >>> 0, true);
    cen.setUint32(42, offset, true);
    centrale.push(new Uint8Array(cen.buffer), nome);
    offset += 30 + nome.length + comp.length;
  }
  const dimCentrale = centrale.reduce((a, b) => a + b.length, 0);
  const fine = new DataView(new ArrayBuffer(22));
  fine.setUint32(0, 0x06054b50, true);
  fine.setUint16(8, voci.length, true);
  fine.setUint16(10, voci.length, true);
  fine.setUint32(12, dimCentrale, true);
  fine.setUint32(16, offset, true);
  return concat([...parti, ...centrale, new Uint8Array(fine.buffer)]);
}

function concat(xs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(xs.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

function campo(h: Uint8Array, off: number, len: number, s: string): void {
  const b = new TextEncoder().encode(s);
  if (b.length > len) throw new Error(`campo tar troppo lungo: ${s}`);
  h.set(b, off);
}
const ottale = (n: number, len: number) => n.toString(8).padStart(len - 1, "0") + "\0";

/** TAR (formato ustar) compresso con gzip. Conserva i permessi (gli script .sh restano eseguibili). */
export function creaTarGz(voci: VoceArchivio[]): Uint8Array {
  const blocchi: Uint8Array[] = [];
  for (const v of voci) {
    const h = new Uint8Array(512);
    let nome = v.nome, prefisso = "";
    if (new TextEncoder().encode(nome).length > 100) {
      const i = nome.lastIndexOf("/", 155);
      prefisso = nome.slice(0, i);
      nome = nome.slice(i + 1);
    }
    campo(h, 0, 100, nome);
    campo(h, 100, 8, ottale(v.modo ?? 0o644, 8));
    campo(h, 108, 8, ottale(0, 8));
    campo(h, 116, 8, ottale(0, 8));
    campo(h, 124, 12, ottale(v.dati.length, 12));
    campo(h, 136, 12, ottale(Math.floor((v.mtime ?? new Date()).getTime() / 1000), 12));
    h.fill(0x20, 148, 156); // somma di controllo calcolata con il campo a spazi
    h[156] = 0x30; // file normale
    campo(h, 257, 6, "ustar\0");
    campo(h, 263, 2, "00");
    campo(h, 345, 155, prefisso);
    const somma = h.reduce((a, b) => a + b, 0);
    campo(h, 148, 8, somma.toString(8).padStart(6, "0") + "\0 ");
    blocchi.push(h, v.dati);
    const pad = (512 - (v.dati.length % 512)) % 512;
    if (pad) blocchi.push(new Uint8Array(pad));
  }
  blocchi.push(new Uint8Array(1024));
  return new Uint8Array(gzipSync(concat(blocchi), { level: 9 }));
}
