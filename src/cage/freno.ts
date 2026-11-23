// Freno d'emergenza (§4.6): patrimonio sotto la soglia × massimo dall'avvio o dall'ultimo sblocco.
import type { Paths } from "../config/paths.ts";
import type { Broker } from "../broker/types.ts";
import { appendJournal, readJournal } from "../journal/journal.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { dateInTz, TZ_NY } from "../util/time.ts";
import { withShortLock } from "../util/shortlock.ts";

export interface StatoFreno {
  avvio: string; // data NY
  ultimoSblocco: { data: string; ts: string; valore: number } | null;
  attivo: boolean;
  scattatoIl: string | null;
}

export interface ValutazioneFreno {
  attivo: boolean;
  appenaScattato: boolean;
  massimo: number | null;
  soglia: number;
  patrimonio: number;
  rapporto: number | null;
  inizio: string;
}

function ricostruisci(paths: Paths): StatoFreno | null {
  const ev = readJournal(paths).filter((e) => e.tipo === "freno");
  if (!ev.length) return null;
  let s: StatoFreno = { avvio: "", ultimoSblocco: null, attivo: false, scattatoIl: null };
  for (const e of ev) {
    if (e.azione === "avvio") s.avvio = String(e.data);
    if (e.azione === "scattato") s = { ...s, attivo: true, scattatoIl: e.ts };
    if (e.azione === "sblocco") s = { ...s, attivo: false, scattatoIl: null, ultimoSblocco: { data: String(e.data), ts: e.ts, valore: Number(e.valore) } };
  }
  return s.avvio ? s : null;
}

/** Stato del freno: dal file, altrimenti dal diario, altrimenti nuovo (data di avvio = oggi). */
export function leggiFreno(paths: Paths, now: Date): { stato: StatoFreno; nota?: string } {
  const r = readJsonSafe<StatoFreno>(paths.freno, (v) => typeof v?.avvio === "string");
  if (r.ok) return { stato: r.value };
  const rec = ricostruisci(paths);
  if (rec) {
    writeJsonAtomic(paths.freno, rec);
    return { stato: rec, nota: `state/freno.json ${r.reason}: ricostruito dal diario` };
  }
  const nuovo: StatoFreno = { avvio: dateInTz(now, TZ_NY), ultimoSblocco: null, attivo: false, scattatoIl: null };
  writeJsonAtomic(paths.freno, nuovo);
  appendJournal(paths, { tipo: "freno", azione: "avvio", data: nuovo.avvio }, now);
  return { stato: nuovo };
}

/** Massimo del patrimonio da una data esplicita (avvio o ultimo sblocco), con l'eventuale valore di sblocco e il valore attuale. */
export async function valutaFreno(paths: Paths, broker: Broker, patrimonio: number, soglia: number, now: Date): Promise<ValutazioneFreno> {
  const { stato } = leggiFreno(paths, now);
  const inizio = stato.ultimoSblocco && stato.ultimoSblocco.data > stato.avvio ? stato.ultimoSblocco.data : stato.avvio;
  const h = await broker.getPortfolioHistory(inizio);
  const vals = h.equity.filter((v): v is number => typeof v === "number" && v > 0);
  // con lo sblocco il massimo riparte dal patrimonio al momento dello sblocco: ignora le sedute precedenti
  const sbloccoTs = stato.ultimoSblocco ? Date.parse(stato.ultimoSblocco.ts) / 1000 : null;
  const utili = sbloccoTs ? h.timestamps.map((t, i) => (t >= sbloccoTs ? h.equity[i] : null)).filter((v): v is number => typeof v === "number" && v > 0) : vals;
  const candidati = [...utili, patrimonio];
  if (stato.ultimoSblocco) candidati.push(stato.ultimoSblocco.valore);
  const massimo = candidati.length ? Math.max(...candidati) : null;
  const rapporto = massimo ? patrimonio / massimo : null;
  const sotto = rapporto !== null && rapporto < soglia;
  let appenaScattato = false;
  if (sotto && !stato.attivo) {
    appenaScattato = true;
    withShortLock(paths.paramsLock, () => {
      const cur = leggiFreno(paths, now).stato;
      writeJsonAtomic(paths.freno, { ...cur, attivo: true, scattatoIl: now.toISOString() });
    });
    appendJournal(paths, { tipo: "freno", azione: "scattato", patrimonio, massimo, soglia }, now);
  }
  return { attivo: stato.attivo || sotto, appenaScattato, massimo, soglia, patrimonio, rapporto, inizio };
}

/** Sblocco dalla dashboard: il massimo di riferimento torna al patrimonio attuale. */
export function sbloccaFreno(paths: Paths, patrimonio: number, now: Date): StatoFreno {
  return withShortLock(paths.paramsLock, () => {
    const cur = leggiFreno(paths, now).stato;
    const s: StatoFreno = { ...cur, attivo: false, scattatoIl: null, ultimoSblocco: { data: dateInTz(now, TZ_NY), ts: now.toISOString(), valore: patrimonio } };
    writeJsonAtomic(paths.freno, s);
    appendJournal(paths, { tipo: "freno", azione: "sblocco", data: s.ultimoSblocco!.data, valore: patrimonio }, now);
    return s;
  });
}
