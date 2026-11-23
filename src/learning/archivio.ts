// Archivio delle review (state/reviews/) e delle proposte (state/proposte.json).
import * as fs from "node:fs";
import * as path from "node:path";
import type { Paths } from "../config/paths.ts";
import { readJsonOr, readJsonSafe } from "../util/atomic.ts";

export interface ReviewSalvata {
  id: string;
  data: string;
  creata: string;
  paramsVersione: string;
  campionePiccolo: boolean;
  primaRiga: string;
  testo: string;
  sintesi: string;
  statistiche: unknown;
  proposte: string[];
  nonValutati: string[];
  cervello: string;
}

export function listaReview(paths: Paths): ReviewSalvata[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(paths.reviews).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: ReviewSalvata[] = [];
  for (const f of files) {
    const r = readJsonSafe<ReviewSalvata>(path.join(paths.reviews, f));
    if (r.ok) out.push(r.value);
  }
  return out;
}

export function ultimaReview(paths: Paths): ReviewSalvata | null {
  return listaReview(paths).at(-1) ?? null;
}

export interface Proposta {
  id: string;
  reviewId: string;
  chiave: string;
  da: number | string;
  a: number | string;
  direzione: "su" | "giu" | "cambio";
  effettoR: number;
  n: number;
  ic: { primi: [number, number]; ultimi: [number, number] };
  descrizione: string;
  stato: "in attesa" | "approvata" | "rifiutata" | "scaduta";
  creata: string;
  scade: string;
  decisa: string | null;
  decisaDa: string | null;
  versioneCreata: string | null;
  nota?: string;
}

export function leggiProposte(paths: Paths): Proposta[] {
  return readJsonOr<Proposta[]>(paths.proposte, []);
}
