// Server della dashboard (§8): solo 127.0.0.1, password, cookie di sessione HttpOnly + SameSite=Strict, CSRF.
// È anche l'unico lettore dei pulsanti di Telegram (ogni 30 secondi, 7 giorni su 7).
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Ctx } from "../run/context.ts";
import { DASHBOARD_HOST } from "../config/costanti.ts";
import { loadParams, restoreInitial, restoreVersion, saveParams } from "../params/params.ts";
import { sbloccaFreno } from "../cage/freno.ts";
import { appendJournal } from "../journal/journal.ts";
import { decidiProposta, scadiProposte } from "../learning/review.ts";
import { leggiPulsanti } from "../telegram/poller.ts";
import { readUsage } from "../brain/usage.ts";
import { readJsonSafe, writeJsonAtomic } from "../util/atomic.ts";
import { errText, redact } from "../util/redact.ts";
import { esc } from "../telegram/format.ts";
import { CSS, JS, escHtml, pagina, html } from "./html.ts";
import { paginaLogin, paginaOmbra, paginaPanoramica, paginaPosizione, paginaStorico } from "./pagine.ts";
import { leggiModuloParametri, paginaConsumi, paginaImpostazioni, paginaReview, paginaReviewDettaglio } from "./pagine-gestione.ts";
import { chiudi, errore, modificaLivelli, passaATrailing } from "./azioni.ts";
import { csvSpaccato, estremi, filtra, PERIODI, type PeriodoId } from "./consumi.ts";
import { svuotaCache } from "./dati.ts";
import { paginaSelezione, paginaSelezioneDettaglio } from "./pagine-selezione.ts";
import { paginaGuida } from "./pagine-guida.ts";
import { CHIAVI_IMPATTO, stimaImpatto } from "./impatto-universo.ts";
import { lanciaScansione, statoScansione } from "./scansione-manuale.ts";
import { modificaOverride } from "../scan/override.ts";
import type { Watchlist } from "../scan/scan.ts";

interface Sessione {
  csrf: string;
  creata: number;
  vista: number;
  flash: { ok: boolean; testo: string } | null;
}

const rand = (n = 32) => Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("hex");
const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export interface OpzioniServer {
  password: string;
  porta: number;
  pollerMs?: number | null;
  /** Lancio della scansione manuale; nei test si sostituisce, per non avviare processi veri. */
  lanciaScansione?: (ctx: Ctx) => Promise<{ ok: boolean; messaggio: string }>;
}

export function avviaDashboard(ctx: Ctx, o: OpzioniServer) {
  if (!o.password || o.password.length < 12) throw new Error("La password della dashboard in secrets.ts deve avere almeno 12 caratteri.");
  const sessioni = new Map<string, Sessione>();
  const pwd = digest(o.password);
  let tentativiFalliti = 0;
  let bloccoFino = 0;
  const hostOk = new Set([`127.0.0.1:${o.porta}`, `localhost:${o.porta}`]);
  const SCADENZA = 12 * 3600_000;

  const cookie = (req: Request) => {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.get("cookie") ?? "");
    return m ? m[1]! : null;
  };
  const sessione = (req: Request) => {
    const sid = cookie(req);
    const s = sid ? sessioni.get(sid) : undefined;
    if (!s || Date.now() - s.vista > SCADENZA) return null;
    s.vista = Date.now();
    return { sid: sid!, s };
  };
  const htmlResp = (body: string, status = 200, extra: Record<string, string> = {}) =>
    new Response(body, {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        // same-origin: con no-referrer i browser inviano "Origin: null" sui moduli e l'accesso veniva rifiutato
        "referrer-policy": "same-origin",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        ...extra,
      },
    });
  const redirect = (to: string, extra: Record<string, string> = {}) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", ...extra } });

  async function gestisci(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // protezione dal DNS rebinding: solo host locali
    if (!hostOk.has(req.headers.get("host") ?? "")) return new Response("Host non ammesso", { status: 421 });
    if (url.pathname === "/style.css") return new Response(CSS, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "max-age=300" } });
    const FONT: Record<string, string> = { "/font/display.ttf": "WixMadeforDisplay.ttf", "/font/text.ttf": "WixMadeforText.ttf" };
    if (FONT[url.pathname]) return new Response(Bun.file(path.join(import.meta.dir, "assets", FONT[url.pathname]!)), { headers: { "content-type": "font/ttf", "cache-control": "max-age=86400" } });
    if (url.pathname === "/client.js" || url.pathname === "/client.css") {
      const file = Bun.file(path.join(import.meta.dir, "assets", url.pathname.slice(1)));
      if (!(await file.exists())) return new Response("", { status: 404 });
      return new Response(file, { headers: { "content-type": url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8", "cache-control": "max-age=300" } });
    }
    if (url.pathname === "/app.js") return new Response(JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=300" } });

    if (req.method === "POST") {
      const origin = req.headers.get("origin");
      // "null" arriva da alcuni browser sui moduli: si accetta solo se il browser stesso dichiara la richiesta same-origin
      const stessoSito = req.headers.get("sec-fetch-site") === "same-origin";
      const origineOk = !origin || hostOk.has(origin.replace(/^https?:\/\//, "")) || (origin === "null" && stessoSito);
      if (!origineOk) return new Response("Origine non ammessa", { status: 403 });
    }

    if (url.pathname === "/accedi" && req.method === "POST") {
      if (Date.now() < bloccoFino) return htmlResp(paginaLogin("Troppi tentativi: riprova tra qualche minuto."), 429);
      const form = new URLSearchParams(await req.text());
      const ok = timingSafeEqual(digest(form.get("password") ?? ""), pwd);
      if (!ok) {
        tentativiFalliti++;
        if (tentativiFalliti >= 10) {
          bloccoFino = Date.now() + 5 * 60_000;
          tentativiFalliti = 0;
        }
        await Bun.sleep(800);
        return htmlResp(paginaLogin("Password errata."), 401);
      }
      tentativiFalliti = 0;
      const sid = rand();
      sessioni.set(sid, { csrf: rand(), creata: Date.now(), vista: Date.now(), flash: null });
      return redirect("/", { "set-cookie": `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
    }

    const ss = sessione(req);
    if (!ss) return htmlResp(paginaLogin(), 401);
    const { s } = ss;

    if (req.method === "POST") {
      const body = await req.text();
      const form = new URLSearchParams(body);
      const tok = form.get("csrf") ?? req.headers.get("x-csrf-token") ?? "";
      if (tok.length !== s.csrf.length || !timingSafeEqual(Buffer.from(tok), Buffer.from(s.csrf))) return htmlResp(pagina("Errore", "", html`<h1>Richiesta rifiutata</h1><p>Token anti-CSRF mancante o non valido. Ricarica la pagina.</p>`), 403);
      return await azione(url.pathname, form, ss.sid, s);
    }

    const flash = s.flash;
    s.flash = null;
    const p = url.pathname;
    if (p === "/") return htmlResp(await paginaPanoramica(ctx, s.csrf, url.searchParams, flash));
    if (p.startsWith("/posizione/")) return htmlResp(await paginaPosizione(ctx, s.csrf, decodeURIComponent(p.slice(11)).toUpperCase().replace(/[^A-Z0-9.\-]/g, ""), flash));
    if (p === "/guida") return htmlResp(paginaGuida(ctx, s.csrf));
    if (p === "/selezione") return htmlResp(paginaSelezione(ctx, s.csrf, flash, await statoScansione(ctx)));
    if (p.startsWith("/selezione/")) return htmlResp(await paginaSelezioneDettaglio(ctx, s.csrf, decodeURIComponent(p.slice(11)).toUpperCase().replace(/[^A-Z0-9.-]/g, ""), url.searchParams, flash));
    if (p === "/storico") return htmlResp(paginaStorico(ctx, s.csrf, url.searchParams));
    if (p === "/ombra") return htmlResp(paginaOmbra(ctx, s.csrf));
    if (p === "/review") return htmlResp(paginaReview(ctx, s.csrf, flash));
    if (p.startsWith("/review/")) return htmlResp(paginaReviewDettaglio(ctx, s.csrf, decodeURIComponent(p.slice(8))));
    if (p === "/impostazioni") return htmlResp(paginaImpostazioni(ctx, s.csrf, flash, undefined, url.searchParams.get("scheda")));
    if (p === "/consumi") return htmlResp(await paginaConsumi(ctx, s.csrf, url.searchParams));
    if (p === "/consumi.csv") {
      const q = url.searchParams;
      const periodo = (PERIODI.some((x) => x.id === q.get("periodo")) ? q.get("periodo") : "30g") as PeriodoId;
      const ext = estremi(periodo, ctx.now(), q.get("da") ?? undefined, q.get("a") ?? undefined);
      const rows = filtra(readUsage(ctx.paths), { ...ext, task: q.get("task") || undefined, esito: q.get("esito") || undefined });
      return new Response(csvSpaccato(rows, `${ext.da}..${ext.a}`), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="consumi-ai-${ext.da}-${ext.a}.csv"`, "cache-control": "no-store" } });
    }
    if (p.startsWith("/log/")) {
      const id = decodeURIComponent(p.slice(5)).replace(/[^A-Za-z0-9\-]/g, "");
      const f = path.join(ctx.paths.logs, `${id}.log`);
      const txt = fs.existsSync(f) ? redact(fs.readFileSync(f, "utf8")).slice(-200_000) : "Log non trovato.";
      return htmlResp(pagina(`Log ${id}`, "", html`<h1>Log ${id}</h1><pre class="card small" style="white-space:pre-wrap;overflow-x:auto">${txt}</pre>`, { csrf: s.csrf }));
    }
    return htmlResp(pagina("Non trovato", "", html`<h1>Pagina non trovata</h1>`, { csrf: s.csrf }), 404);
  }

  async function azione(p: string, f: URLSearchParams, sid: string, s: Sessione): Promise<Response> {
    const flash = (ok: boolean, testo: string, to = "/") => {
      s.flash = { ok, testo };
      svuotaCache();
      return redirect(to);
    };
    const sim = (f.get("simbolo") ?? "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
    try {
      switch (p) {
        case "/esci":
          sessioni.delete(sid);
          return redirect("/", { "set-cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
        case "/azione/chiudi": {
          const r = await chiudi(ctx, sim, f.get("codice") ?? "");
          return flash(r.ok, r.messaggio, `/posizione/${encodeURIComponent(sim)}`);
        }
        case "/azione/livelli": {
          const r = await modificaLivelli(ctx, sim, Number(f.get("stop")), f.get("tp") ? Number(f.get("tp")) : null);
          return flash(r.ok, r.messaggio, `/posizione/${encodeURIComponent(sim)}`);
        }
        case "/azione/trailing": {
          const r = await passaATrailing(ctx, sim, Number(f.get("pct")), f.get("codice") ?? "");
          return flash(r.ok, r.messaggio, `/posizione/${encodeURIComponent(sim)}`);
        }
        case "/azione/proposta": {
          const r = decidiProposta(ctx, f.get("id") ?? "", f.get("esito") === "approva", "dashboard");
          if (r.ok) await notifica(`proposta ${f.get("id")}: ${r.messaggio}`);
          return flash(r.ok, r.messaggio, "/review");
        }
        case "/azione/ripristina-versione": {
          const r = restoreVersion(ctx.paths, Number(f.get("versione")), Number(f.get("attesa")), "utente", ctx.now());
          if (r.ok) await notifica(`ripristinati i valori della v${f.get("versione")}: nuova versione ${r.params.versione}`);
          return flash(r.ok, r.ok ? `Creata la ${r.params.versione} con i valori della v${f.get("versione")}.` : r.errori.join(" "), "/review");
        }
        case "/azione/ripristina-iniziali": {
          const r = restoreInitial(ctx.paths, Number(f.get("attesa")), ctx.now());
          if (r.ok) await notifica(`ripristinati i valori iniziali: ${r.params.versione}`);
          return flash(r.ok, r.ok ? `Valori iniziali ripristinati (${r.params.versione}).` : r.errori.join(" "), "/impostazioni");
        }
        case "/azione/pausa": {
          const attiva = f.get("attiva") === "si";
          writeJsonAtomic(ctx.paths.pausaAcquisti, { attiva, da: ctx.now().toISOString() });
          appendJournal(ctx.paths, { tipo: "manuale", azione: attiva ? "pausa acquisti" : "ripresa acquisti" }, ctx.now());
          await notifica(attiva ? "acquisti in pausa" : "acquisti ripresi");
          return flash(true, attiva ? "Acquisti in pausa. Protezioni e uscite continuano." : "Acquisti ripresi.", "/impostazioni");
        }
        case "/azione/freno": {
          const acc = await ctx.broker.getAccount();
          sbloccaFreno(ctx.paths, acc.equity, ctx.now());
          await notifica(`freno d'emergenza sbloccato; nuovo massimo di riferimento ${acc.equity.toFixed(0)} $`);
          return flash(true, `Freno sbloccato. Massimo di riferimento: ${acc.equity.toFixed(0)} $.`, "/impostazioni");
        }
        case "/azione/selezione": {
          // override della lista: nessun ordine, la sveglia lo legge alla prossima esecuzione
          const az = f.get("azione");
          const torna = (f.get("torna") ?? "").startsWith("/selezione") ? f.get("torna")! : "/selezione";
          if (az !== "aggiungi" && az !== "rimuovi" && az !== "annulla") return flash(false, "Azione non riconosciuta.", torna);
          if (!sim) return flash(false, "Simbolo mancante.", torna);
          const wlr = readJsonSafe<Watchlist>(ctx.paths.watchlist);
          const r = modificaOverride(ctx.paths, az, sim, wlr.ok ? wlr.value : null, ctx.now());
          if (r.ok) await notifica(`override della selezione: ${az} ${sim}`);
          return flash(r.ok, r.messaggio, torna);
        }
        case "/azione/scansione": {
          const r = await (o.lanciaScansione ?? lanciaScansione)(ctx);
          if (r.ok) await notifica("scansione manuale avviata dalla dashboard");
          return flash(r.ok, r.messaggio, "/selezione");
        }
        case "/azione/parametri/anteprima": {
          const P = loadParams(ctx.paths, ctx.now()).params;
          const a = leggiModuloParametri(f, P.valori());
          const impatto = a.errori.length ? null : await stimaImpatto(ctx, P, a.modifiche);
          return htmlResp(paginaImpostazioni(ctx, s.csrf, null, a, f.get("scheda"), impatto));
        }
        case "/azione/parametri/salva": {
          const P = loadParams(ctx.paths, ctx.now()).params;
          const a = leggiModuloParametri(f, P.valori());
          const torna = `/impostazioni?scheda=${encodeURIComponent(f.get("scheda") ?? "")}`;
          if (a.errori.length) return flash(false, a.errori.join(" "), torna);
          // un cambio che incide sul consumo AI si salva solo dopo aver visto la stima dell'impatto nell'anteprima
          if (Object.keys(a.modifiche).some((k) => CHIAVI_IMPATTO.includes(k)) && f.get("impattoVisto") !== "1") return flash(false, "Questo cambio incide su scansione e consumo AI: apri l'anteprima e conferma dopo aver visto la stima.", torna);
          const r = saveParams(ctx.paths, a.modifiche, { autore: "utente", versioneAttesa: Number(f.get("attesa")), now: ctx.now() });
          if (!r.ok) return flash(false, r.errori.join(" "), torna);
          await notifica(`parametri cambiati (${r.params.versione}): ${r.modifiche.map((m) => `${m.chiave} ${m.da} → ${m.a}`).join("; ")}`);
          return flash(true, `Salvata la ${r.params.versione}: vale dalla prossima sveglia.`, torna);
        }
      }
      return htmlResp(pagina("Non trovato", "", html`<h1>Azione sconosciuta</h1>`), 404);
    } catch (e) {
      const r = errore(e);
      ctx.log.error("azione della dashboard fallita", { azione: p, errore: r.messaggio });
      return flash(false, r.messaggio);
    }
  }

  async function notifica(testo: string): Promise<void> {
    const P = loadParams(ctx.paths, ctx.now()).params;
    if (P.b("notifiche.telegram")) await ctx.tg.send(`⚙ <b>Dashboard</b>: ${esc(testo)}`);
  }

  const server = Bun.serve({
    hostname: DASHBOARD_HOST,
    port: o.porta,
    fetch: (req) =>
      gestisci(req).catch((e) => {
        ctx.log.error("errore della dashboard", { errore: errText(e) });
        return htmlResp(`<!doctype html><meta charset="utf-8"><p>Errore interno: ${escHtml(errText(e))}</p>`, 500);
      }),
  });

  let poller: ReturnType<typeof setInterval> | null = null;
  if (o.pollerMs !== null) {
    const giro = async () => {
      try {
        scadiProposte(ctx);
        const r = await leggiPulsanti(ctx);
        if (r.errore) ctx.log.warn("lettura dei pulsanti Telegram fallita", { errore: r.errore });
      } catch (e) {
        ctx.log.warn("lettore dei pulsanti", { errore: errText(e) });
      }
    };
    poller = setInterval(giro, o.pollerMs ?? 30_000);
    void giro();
  }
  return {
    server,
    url: `http://${DASHBOARD_HOST}:${server.port}`,
    stop() {
      if (poller) clearInterval(poller);
      server.stop(true);
    },
  };
}
