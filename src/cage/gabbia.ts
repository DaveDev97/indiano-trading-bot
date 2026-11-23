// Gabbia (§6.7): si compra solo tra i candidati ammessi di questa sveglia, si vende solo ciò che è in portafoglio.
// Ogni rifiuto ha un motivo leggibile e un codice stabile (per le lezioni e le pause).
import type { Settore } from "../config/settori.ts";

export type TipoSveglia = "briefing" | "apertura" | "meta" | "chiusura";
export type Azione = "compra" | "vendi" | "tieni";

export interface Decisione {
  simbolo: string;
  azione: Azione;
  perche: string;
}

export interface Rifiuto {
  simbolo: string;
  azione: Azione;
  motivo: string;
  codice: string;
}

export interface StatoGabbia {
  tipo: TipoSveglia;
  mercatoAperto: boolean;
  /** Candidati ammessi in questa sveglia (già filtrati: watchlist, settore forte, segnali, prezzo, trimestrale, pause). */
  candidati: Map<string, { settore: Settore }>;
  /** Simboli in portafoglio, con il settore (null = sconosciuto). */
  posizioni: Map<string, Settore | null>;
  /** Acquisti ancora aperti (contano come posizioni). */
  acquistiAperti: Map<string, Settore | null>;
  /** Simboli con un'uscita debole segnalata (solo questi si possono vendere su richiesta del modello). */
  usciteDeboli: Set<string>;
  maxPosizioni: number;
  maxPerSettore: number;
  /** Se gli acquisti sono bloccati per tutta la sveglia (cervello fallito, freno, pausa, watchlist vecchia…). */
  bloccoAcquisti: string | null;
  /** Metà seduta: si entra solo se in giornata si è liberato un posto. */
  postoLiberatoOggi: boolean;
}

export interface EsitoGabbia {
  acquisti: Decisione[];
  vendite: Decisione[];
  rifiuti: Rifiuto[];
}

export function applicaGabbia(decisioni: Decisione[], s: StatoGabbia): EsitoGabbia {
  const out: EsitoGabbia = { acquisti: [], vendite: [], rifiuti: [] };
  const rif = (d: Decisione, codice: string, motivo: string) => out.rifiuti.push({ simbolo: d.simbolo, azione: d.azione, motivo, codice });
  const visti = new Set<string>();
  const uniche: Decisione[] = [];
  let occupati = s.posizioni.size + [...s.acquistiAperti.keys()].filter((k) => !s.posizioni.has(k)).length;
  const perSettore = new Map<string, number>();
  for (const sett of [...s.posizioni.values(), ...[...s.acquistiAperti].filter(([k]) => !s.posizioni.has(k)).map(([, v]) => v)]) {
    if (sett) perSettore.set(sett, (perSettore.get(sett) ?? 0) + 1);
  }
  // prima le vendite: liberano posti solo dalla sveglia successiva (prudenza: gli ordini non sono ancora eseguiti)
  for (const d of decisioni) {
    const k = `${d.simbolo}|${d.azione}`;
    if (visti.has(k)) {
      rif(d, "duplicata", "decisione ripetuta nella stessa risposta");
      continue;
    }
    visti.add(k);
    uniche.push(d);
    if (d.azione !== "vendi") continue;
    if (!s.posizioni.has(d.simbolo)) rif(d, "non-in-portafoglio", "non è in portafoglio");
    else if (!s.usciteDeboli.has(d.simbolo)) rif(d, "nessun-segnale-uscita", "nessun segnale di uscita debole su questo titolo: il modello può vendere solo tra le uscite segnalate");
    else if (s.tipo !== "apertura") rif(d, "uscite-solo-apertura", "le uscite deboli si eseguono alla sveglia di apertura");
    else if (!s.mercatoAperto) rif(d, "mercato-chiuso", "mercato chiuso");
    else out.vendite.push(d);
  }
  for (const d of uniche) {
    if (d.azione !== "compra") continue;
    const c = s.candidati.get(d.simbolo);
    if (s.tipo === "briefing" || s.tipo === "chiusura") rif(d, "sveglia-senza-ingressi", `la sveglia di ${s.tipo} non fa ingressi`);
    else if (s.bloccoAcquisti) rif(d, "acquisti-bloccati", s.bloccoAcquisti);
    else if (!s.mercatoAperto) rif(d, "mercato-chiuso", "mercato chiuso");
    else if (s.tipo === "meta" && !s.postoLiberatoOggi) rif(d, "meta-senza-posto-liberato", "a metà seduta si entra solo se in giornata si è liberato un posto");
    else if (!c) rif(d, "fuori-candidati", "non è tra i candidati ammessi di questa sveglia");
    else if (s.posizioni.has(d.simbolo) || s.acquistiAperti.has(d.simbolo)) rif(d, "gia-in-portafoglio", "già in portafoglio o con un acquisto aperto");
    else if (occupati >= s.maxPosizioni) rif(d, "posti-esauriti", `già ${occupati} posizioni su ${s.maxPosizioni}`);
    else if ((perSettore.get(c.settore) ?? 0) >= s.maxPerSettore) rif(d, "limite-settore", `già ${perSettore.get(c.settore)} posizioni nel settore ${c.settore} (massimo ${s.maxPerSettore})`);
    else {
      out.acquisti.push(d);
      occupati++;
      perSettore.set(c.settore, (perSettore.get(c.settore) ?? 0) + 1);
    }
  }
  return out;
}
