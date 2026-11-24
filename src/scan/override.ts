// Override manuali della selezione, decisi dall'utente dalla dashboard:
// - "aggiunti": titoli della zona grigia messi tra gli acquistabili, valgono finché il titolo resta in zona grigia;
// - "rimossi": titoli tolti dagli acquistabili, valgono anche per le scansioni successive, finché non li annulli.
// Un override cambia solo la lista: segnali tecnici, settore forte e gabbia restano gli stessi per tutti.
// Le posizioni già aperte non cambiano: protezioni e uscite continuano.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Paths } from "../config/paths.ts";
import type { Watchlist } from "./scan.ts";
import type { VoceClassifica } from "./classifica.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { withShortLock } from "../util/shortlock.ts";
import { appendJournal } from "../journal/journal.ts";

export interface VoceOverride {
  quando: string;
  nota: string | null;
}

export interface OverrideSelezione {
  aggiunti: Record<string, VoceOverride>;
  rimossi: Record<string, VoceOverride>;
  /** Il file c'è ma non si legge: la sveglia non compra (un titolo tolto a mano non deve tornare comprabile in silenzio). */
  errore?: string;
}

const vuoto = (): OverrideSelezione => ({ aggiunti: {}, rimossi: {} });

export function leggiOverride(paths: Paths): OverrideSelezione {
  if (!fs.existsSync(paths.overrideSelezione)) return vuoto();
  const r = readJsonSafe<OverrideSelezione>(paths.overrideSelezione, (v) => v && typeof v.aggiunti === "object" && v.aggiunti !== null && typeof v.rimossi === "object" && v.rimossi !== null);
  return r.ok ? r.value : { ...vuoto(), errore: `il file degli override della selezione (${path.basename(paths.overrideSelezione)}) non si legge` };
}

export type AzioneOverride = "aggiungi" | "rimuovi" | "annulla";

/** Applica un'azione dell'utente. Restituisce il messaggio da mostrare; registra l'evento nel diario. */
export function modificaOverride(paths: Paths, azione: AzioneOverride, simbolo: string, wl: Watchlist | null, now: Date, nota: string | null = null): { ok: boolean; messaggio: string } {
  return withShortLock(`${paths.overrideSelezione}.lock`, () => {
    const ov = leggiOverride(paths);
    // sovrascrivere un file illeggibile cancellerebbe per sempre gli altri override
    if (ov.errore) return { ok: false, messaggio: `Non modifico niente: ${ov.errore}. Correggilo o cancellalo (state/override-selezione.json) e riprova.` };
    let messaggio: string;
    if (azione === "aggiungi") {
      if (!wl?.zonaGrigia.some((v) => v.simbolo === simbolo)) return { ok: false, messaggio: `${simbolo} non è in zona grigia nell'ultima scansione: non si può aggiungere.` };
      if (ov.aggiunti[simbolo]) return { ok: false, messaggio: `${simbolo} è già nella lista per un override.` };
      delete ov.rimossi[simbolo];
      ov.aggiunti[simbolo] = { quando: now.toISOString(), nota };
      const v = wl.zonaGrigia.find((x) => x.simbolo === simbolo)!;
      const forte = wl.forza.forti.includes(v.settore);
      messaggio = `${simbolo} aggiunto alla lista. Si compra solo con il segnale tecnico e se la gabbia lo permette${forte ? "" : "; il suo settore oggi non è forte, quindi finché resta così non verrà comprato"}.`;
    } else if (azione === "rimuovi") {
      if (ov.rimossi[simbolo]) return { ok: false, messaggio: `${simbolo} è già tolto dalla lista.` };
      if (ov.aggiunti[simbolo]) {
        delete ov.aggiunti[simbolo];
        messaggio = `${simbolo} tolto dalla lista (era stato aggiunto a mano).`;
      } else {
        ov.rimossi[simbolo] = { quando: now.toISOString(), nota };
        messaggio = `${simbolo} tolto dalla lista: il bot non lo comprerà finché non annulli l'override, anche dopo le prossime scansioni. Una posizione già aperta resta protetta e segue le sue regole di uscita.`;
      }
    } else {
      const c = !!ov.aggiunti[simbolo] || !!ov.rimossi[simbolo];
      delete ov.aggiunti[simbolo];
      delete ov.rimossi[simbolo];
      if (!c) return { ok: false, messaggio: `Nessun override attivo per ${simbolo}.` };
      messaggio = `Override di ${simbolo} annullato: vale di nuovo la selezione della scansione.`;
    }
    writeJsonAtomic(paths.overrideSelezione, ov);
    appendJournal(paths, { tipo: "override-selezione", azione, simbolo, nota, override: ov }, now);
    return { ok: true, messaggio };
  });
}

export interface StatoOverride {
  wl: Watchlist;
  /** Aggiunti che non si applicano più: il titolo non è più in zona grigia (o è già acquistabile). */
  sospesi: { simbolo: string; motivo: string }[];
  /** Tolti dalla lista che oggi sarebbero acquistabili. */
  tolti: VoceClassifica[];
}

/** Watchlist con gli override applicati. Non modifica il file: lo fa la sveglia ogni volta che la legge. */
export function applicaOverride(wl: Watchlist, ov: OverrideSelezione): StatoOverride {
  const tolti = wl.acquistabili.filter((v) => ov.rimossi[v.simbolo]);
  const acquistabili: VoceClassifica[] = wl.acquistabili.filter((v) => !ov.rimossi[v.simbolo]);
  const sospesi: StatoOverride["sospesi"] = [];
  for (const sym of Object.keys(ov.aggiunti)) {
    if (acquistabili.some((v) => v.simbolo === sym)) {
      sospesi.push({ simbolo: sym, motivo: "è già acquistabile per la scansione" });
      continue;
    }
    const g = wl.zonaGrigia.find((v) => v.simbolo === sym);
    if (!g) {
      sospesi.push({ simbolo: sym, motivo: `non è più in zona grigia nella scansione del ${wl.data}` });
      continue;
    }
    acquistabili.push({
      simbolo: g.simbolo, nome: g.nome, settore: g.settore, industria: g.industria, profilo: g.profilo, punteggio: 0, percentili: {}, posizioneSettore: 0,
      criteri: g.criteri, capitalizzazione: null, prezzo: 0, override: "aggiunto",
    });
  }
  // la posizione in classifica resta quella della scansione; gli aggiunti a mano non ne hanno una
  return { wl: { ...wl, acquistabili }, sospesi, tolti };
}
