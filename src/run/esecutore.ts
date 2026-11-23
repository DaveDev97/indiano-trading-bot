// Esecutore degli ordini (§6.8, §8.6): unico punto da cui partono gli ordini, per sveglie e dashboard.
// - id deterministico, verificato PRIMA dell'invio: un id già presente su Alpaca, in qualsiasi stato, non si rimanda;
// - timeout sull'invio: nessun nuovo tentativo, verifica per id;
// - vendita: cancella le protezioni, attende la conferma (max 10 s), rilegge la posizione, vende solo la quantità disponibile.
import { BrokerError, flattenOrders, isOpenStatus, type Broker, type Order, type OrderRequest, type ReplaceRequest } from "../broker/types.ts";
import type { HeldLock } from "./lock.ts";
import type { Logger } from "../util/log.ts";
import { errText } from "../util/redact.ts";

export type StatoInvio = "inviato" | "già presente" | "rifiutato" | "esito sconosciuto";

export interface EsitoInvio {
  stato: StatoInvio;
  id: string;
  ordine: Order | null;
  errore?: string;
  codice?: string;
  /** true se l'ordine sicuramente NON è partito (es. verifica per id impossibile prima dell'invio). */
  nonInviato?: boolean;
}

export interface EventoEsecutore {
  tipo: "ordine" | "rifiuto" | "errore" | "esecuzione";
  simbolo: string;
  azione: string;
  id?: string;
  stato?: string;
  motivo?: string;
  codice?: string;
  dettagli?: Record<string, unknown>;
}

export class Esecutore {
  readonly eventi: EventoEsecutore[] = [];
  constructor(
    private readonly broker: Broker,
    private readonly lock: HeldLock | null,
    private readonly log: Logger,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  posizione(simbolo: string) {
    return this.broker.getPosition(simbolo);
  }

  async trovaPerId(id: string): Promise<Order | null> {
    return this.broker.getOrderByClientId(id);
  }

  async invia(req: OrderRequest, azione: string): Promise<EsitoInvio> {
    const id = req.clientOrderId;
    if (id.length > 128) return { stato: "rifiutato", id, ordine: null, errore: "id oltre 128 caratteri", codice: "id-lungo" };
    let esistente: Order | null;
    try {
      esistente = await this.trovaPerId(id);
    } catch (e) {
      // non si può verificare: non si invia (prudenza)
      const errore = `verifica per id impossibile: ${errText(e)}`;
      this.eventi.push({ tipo: "errore", simbolo: req.symbol, azione, id, motivo: errore, codice: "verifica-id" });
      return { stato: "esito sconosciuto", id, ordine: null, errore, nonInviato: true };
    }
    if (esistente) {
      this.eventi.push({ tipo: "ordine", simbolo: req.symbol, azione, id, stato: `già presente (${esistente.status})`, motivo: "id già presente su Alpaca: non si rimanda" });
      return { stato: "già presente", id, ordine: esistente };
    }
    this.lock?.addPending([id]);
    try {
      const o = await this.broker.submitOrder(req);
      this.eventi.push({ tipo: "ordine", simbolo: req.symbol, azione, id, stato: o.status, dettagli: riassunto(req) });
      return { stato: "inviato", id, ordine: o };
    } catch (e) {
      if (e instanceof BrokerError && (e.kind === "timeout" || e.kind === "rete")) {
        // l'ordine può essere arrivato comunque: verifica per id, senza rimandarlo
        for (let i = 0; i < 3; i++) {
          await this.sleep(2_000 * (i + 1));
          try {
            const o = await this.trovaPerId(id);
            if (o) {
              this.eventi.push({ tipo: "ordine", simbolo: req.symbol, azione, id, stato: o.status, motivo: "arrivato nonostante il timeout", dettagli: riassunto(req) });
              return { stato: "inviato", id, ordine: o };
            }
          } catch {}
        }
        const errore = `invio senza risposta (${e.kind}); ordine non trovato per id: non lo rimando`;
        this.eventi.push({ tipo: "errore", simbolo: req.symbol, azione, id, motivo: errore, codice: `broker-${e.kind}` });
        return { stato: "esito sconosciuto", id, ordine: null, errore };
      }
      const codice = e instanceof BrokerError ? `broker-${e.status ?? e.kind}` : "broker-errore";
      const errore = errText(e);
      this.eventi.push({ tipo: "rifiuto", simbolo: req.symbol, azione, id, motivo: errore, codice });
      return { stato: "rifiutato", id, ordine: null, errore, codice };
    }
  }

  async modifica(o: Order, r: ReplaceRequest, azione = "modifica"): Promise<{ ok: boolean; ordine?: Order; errore?: string }> {
    try {
      const nu = await this.broker.replaceOrder(o.id, r);
      this.eventi.push({ tipo: "ordine", simbolo: o.symbol, azione, id: nu.clientOrderId || nu.id, stato: "modificato", dettagli: { ...r, da: { stop: o.stopPrice, limit: o.limitPrice, trailPct: o.trailPercent, trailPrice: o.trailPrice } } });
      return { ok: true, ordine: nu };
    } catch (e) {
      const errore = errText(e);
      this.eventi.push({ tipo: "errore", simbolo: o.symbol, azione, id: o.id, motivo: `modifica fallita: ${errore}`, codice: "modifica" });
      return { ok: false, errore };
    }
  }

  /** Ordini di vendita aperti (protezioni o vendite in coda) sul simbolo. */
  async venditeAperte(simbolo: string): Promise<Order[]> {
    return flattenOrders(await this.broker.listOrders({ status: "open", symbols: [simbolo] })).filter((o) => o.symbol === simbolo && o.side === "sell" && isOpenStatus(o.status));
  }

  /** Cancella gli ordini e attende la conferma (stato finale) fino a timeoutMs. */
  async cancellaEAttendi(ordini: Order[], timeoutMs: number): Promise<{ ok: boolean; nonConfermati: string[]; eseguiti: Order[] }> {
    for (const o of ordini) {
      try {
        await this.broker.cancelOrder(o.id);
      } catch (e) {
        if (!(e instanceof BrokerError && (e.status === 422 || e.kind === "non-trovato"))) this.log.warn("cancellazione non accettata", { id: o.id, errore: errText(e) });
      }
    }
    const deadline = Date.now() + timeoutMs;
    let pending = ordini.map((o) => o.id);
    const eseguiti: Order[] = [];
    for (let giro = 0; ; giro++) {
      const still: string[] = [];
      for (const id of pending) {
        let cur: Order | null = null;
        try {
          cur = await this.broker.getOrder(id);
        } catch {}
        if (!cur) continue;
        if (cur.status === "filled") eseguiti.push(cur);
        if (isOpenStatus(cur.status)) still.push(id);
      }
      pending = still;
      if (!pending.length || Date.now() >= deadline || giro > 50) break;
      await this.sleep(500);
    }
    return { ok: pending.length === 0, nonConfermati: pending, eseguiti };
  }

  /**
   * Procedura di vendita (§4.6) a mercato aperto: 1) cancella le protezioni; 2) attende la conferma;
   * 3) rilegge la posizione e vende solo la quantità disponibile.
   */
  async vendi(simbolo: string, id: string, motivo: string, attesaMs: number): Promise<{ stato: "venduto" | "niente da vendere" | "cancellazione non confermata" | "errore"; quantita: number; esito?: EsitoInvio; errore?: string }> {
    const gia = await this.trovaPerId(id).catch(() => null);
    if (gia) {
      this.eventi.push({ tipo: "ordine", simbolo, azione: "vendi", id, stato: `già presente (${gia.status})`, motivo: "vendita già inviata con questo id" });
      return { stato: "venduto", quantita: gia.qty, esito: { stato: "già presente", id, ordine: gia } };
    }
    let aperte: Order[];
    try {
      aperte = await this.venditeAperte(simbolo);
    } catch (e) {
      return { stato: "errore", quantita: 0, errore: errText(e) };
    }
    if (aperte.length) {
      const c = await this.cancellaEAttendi(aperte, attesaMs);
      if (!c.ok) {
        this.eventi.push({ tipo: "errore", simbolo, azione: "vendi", id, motivo: `cancellazione delle protezioni non confermata entro ${attesaMs / 1000} s: niente vendita, protezione lasciata com'è`, codice: "cancellazione-non-confermata" });
        return { stato: "cancellazione non confermata", quantita: 0 };
      }
    }
    let pos;
    try {
      pos = await this.broker.getPosition(simbolo);
    } catch (e) {
      return { stato: "errore", quantita: 0, errore: errText(e) };
    }
    const qty = pos && pos.side === "long" ? Math.floor(Math.min(pos.qty, pos.qtyAvailable ?? pos.qty)) : 0;
    if (qty <= 0) {
      this.eventi.push({ tipo: "ordine", simbolo, azione: "vendi", id, stato: "niente da vendere", motivo: "quantità disponibile zero (una gamba può essersi eseguita durante la cancellazione)" });
      return { stato: "niente da vendere", quantita: 0 };
    }
    const esito = await this.invia({ clientOrderId: id, symbol: simbolo, side: "sell", type: "market", qty, tif: "day" }, "vendi");
    if (esito.stato === "inviato" || esito.stato === "già presente") return { stato: "venduto", quantita: qty, esito };
    this.eventi.push({ tipo: "errore", simbolo, azione: "vendi", id, motivo: `vendita non riuscita (${motivo}): ${esito.errore ?? esito.stato}`, codice: esito.codice ?? "vendita" });
    return { stato: "errore", quantita: qty, esito, errore: esito.errore };
  }
}

function riassunto(r: OrderRequest): Record<string, unknown> {
  return { lato: r.side, tipo: r.type, qty: r.qty, classe: r.orderClass ?? "simple", stop: r.stopLoss?.stopPrice ?? r.stopPrice, tp: r.takeProfit?.limitPrice ?? r.limitPrice, trailPct: r.trailPercent, trailPrice: r.trailPrice };
}
