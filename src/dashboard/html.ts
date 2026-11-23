// HTML scritto a mano con escape automatico: ogni valore interpolato viene convertito, salvo frammenti già sicuri.

export class Safe {
  constructor(readonly s: string) {}
  toString() {
    return this.s;
  }
}

export function escHtml(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function part(v: unknown): string {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  if (v === null || v === undefined || v === false) return "";
  return escHtml(v);
}

export function html(strings: TemplateStringsArray, ...vals: unknown[]): Safe {
  let out = strings[0]!;
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1]!;
  return new Safe(out);
}

export const raw = (s: string) => new Safe(s);

export const CSS = `
/* hallmark · v2.0.0 · theme: vantage (by request) · colourway: steel · shape: app screen · scope: app · font: Geologica locale (OFL), nessun CDN · data: reale */
/* critique: schermata di lavoro, tabelle prima delle card; un solo segnale lime per azione primaria, stato attivo e serie del bot; SPY sempre in grigio di riferimento */
/* waive 16: sloplint non eseguito (node non installato su questo PC; per CLAUDE.md non si installa nulla) · waive pill 48px: controlli 36px, misura da app screen */
@font-face{font-family:"Geologica";src:url("/font/geologica.ttf") format("truetype");font-weight:100 900;font-display:swap}
:root{color-scheme:dark;
--color-paper:oklch(13.5% 0.012 235);--color-paper-2:oklch(17% 0.014 235);--color-paper-3:oklch(21% 0.016 235);
--color-ink:oklch(95% 0.006 230);--color-ink-2:oklch(82% 0.012 230);--color-muted:oklch(66% 0.016 230);
--color-rule:oklch(27% 0.014 235);--color-rule-2:oklch(34% 0.016 235);
--color-accent:oklch(89% 0.19 126);--color-accent-hi:oklch(93% 0.17 126);--color-accent-ink:oklch(19% 0.04 126);--color-focus:oklch(89% 0.19 126);
--color-up:oklch(80% 0.11 160);--color-down:oklch(72% 0.15 25);--color-crit:oklch(66% 0.18 25);--color-warn:oklch(82% 0.14 80);
--font-body:"Geologica",ui-sans-serif,system-ui,sans-serif;
--radius-card:4px;--radius-pill:999px;--rule-hair:1px;--tick:10px;--dur-micro:80ms;--dur-short:160ms;--ease-out:cubic-bezier(.2,.7,.2,1);
/* alias usati dalle pagine e dai grafici: la serie 1 è il bot (lime), la 2 è SPY (riferimento, grigio); le altre sono una scala di luminosità sul lime */
--bg:var(--color-paper);--surface:var(--color-paper-2);--ink:var(--color-ink);--ink2:var(--color-ink-2);--muted:var(--color-muted);--grid:var(--color-rule);--axis:var(--color-rule-2);--line:var(--color-rule);
--accent:var(--color-accent);--s1:var(--color-accent);--s2:var(--color-muted);
--r1:oklch(89% 0.19 126);--r2:oklch(76% 0.16 126);--r3:oklch(64% 0.13 126);--r4:oklch(53% 0.11 126);--r5:oklch(43% 0.09 126);--r6:oklch(93% 0.06 126);
--s3:oklch(78% 0.15 126);--s4:oklch(66% 0.13 126);--s5:oklch(54% 0.11 126);--s6:oklch(44% 0.09 126);--s7:oklch(90% 0.06 126);--s8:oklch(36% 0.07 126);
--good:var(--color-up);--goodtext:var(--color-up);--warn:var(--color-warn);--serious:var(--color-warn);--crit:var(--color-crit);--badtext:var(--color-down)}
*{box-sizing:border-box}html,body{overflow-x:clip}
body{margin:0;background:var(--color-paper);color:var(--color-ink-2);font:300 16px/1.55 var(--font-body);font-variation-settings:"SHRP" 0;-webkit-font-smoothing:antialiased}
a{color:var(--color-ink);text-decoration-color:var(--color-rule-2);text-underline-offset:3px;transition:color var(--dur-micro) var(--ease-out)}a:hover{color:var(--color-accent-hi)}
:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px;transition:none}
header{display:flex;flex-wrap:wrap;gap:6px 20px;align-items:center;padding:10px 16px;border-bottom:var(--rule-hair) solid var(--color-rule);background:var(--color-paper);position:sticky;top:0;z-index:5}
header b{color:var(--color-ink);font-weight:400;font-variation-settings:"SHRP" 100;letter-spacing:-0.02em;margin-right:8px}
nav{display:flex;flex-wrap:wrap;gap:2px 4px}nav a{padding:6px 10px;border-radius:var(--radius-pill);text-decoration:none;color:var(--color-muted);font-weight:400;font-size:14px}
nav a:hover{color:var(--color-ink)}nav a.on{color:var(--color-accent-ink);background:var(--color-accent)}
main{max-width:1200px;margin:0 auto;padding:20px 16px 48px}
h1,h2,h3{color:var(--color-ink);font-weight:300;font-variation-settings:"SHRP" 100;letter-spacing:-0.03em;line-height:1.05;overflow-wrap:break-word;min-width:0}
h1{font-size:30px;margin:8px 0 18px}h2{font-size:21px;margin:30px 0 10px;font-weight:400;letter-spacing:-0.02em}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr))}
.card{position:relative;background:var(--color-paper-2);border-radius:var(--radius-card);padding:14px 16px}
.card::before{content:"";position:absolute;inset:0;pointer-events:none;border:var(--rule-hair) solid var(--color-rule-2);border-radius:var(--radius-card);
-webkit-mask:conic-gradient(at var(--tick) var(--tick),transparent 75%,#000 0) 0 0/calc(100% - var(--tick)) calc(100% - var(--tick));mask:conic-gradient(at var(--tick) var(--tick),transparent 75%,#000 0) 0 0/calc(100% - var(--tick)) calc(100% - var(--tick))}
a.card{transition:background var(--dur-short) var(--ease-out)}a.card:hover{background:var(--color-paper-3)}
.tile .v{color:var(--color-ink);font-size:26px;font-weight:200;font-variant-numeric:tabular-nums;letter-spacing:-0.02em;line-height:1.15}.tile .k{color:var(--color-muted);font-size:14px;font-weight:400}
.muted{color:var(--color-muted)}.small{font-size:13.5px}b,strong{color:var(--color-ink);font-weight:500}
.pnl{font-size:20px;font-weight:300;font-variant-numeric:tabular-nums;margin:4px 0}tr.totale td{color:var(--color-ink);font-weight:400;border-top:var(--rule-hair) solid var(--color-rule-2)}
.up{color:var(--color-up)}.down{color:var(--color-down)}
table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px 10px;border-bottom:var(--rule-hair) solid var(--color-rule);vertical-align:top}
th{color:var(--color-muted);font-weight:400}td{color:var(--color-ink-2)}td.n,th.n{text-align:right}tr:hover td{background:color-mix(in oklch,var(--color-paper-3) 60%,transparent)}
.scroll{overflow-x:auto}
.badge{display:inline-block;padding:1px 8px;border-radius:var(--radius-pill);font-size:12.5px;font-weight:400;color:var(--color-ink-2);box-shadow:inset 0 0 0 var(--rule-hair) var(--color-rule-2)}
.b-crit{color:var(--color-down);box-shadow:inset 0 0 0 var(--rule-hair) var(--color-crit)}.b-good{color:var(--color-accent-ink);background:var(--color-accent);box-shadow:none}.b-warn{color:var(--color-warn);box-shadow:inset 0 0 0 var(--rule-hair) var(--color-warn)}
.alarm{border-left:2px solid var(--color-crit);padding:10px 14px;background:var(--color-paper-2);margin:8px 0;color:var(--color-ink)}
.note{border-left:2px solid var(--color-rule-2);padding:10px 14px;background:var(--color-paper-2);margin:8px 0}
form.inline{display:inline-block;margin:4px 6px 4px 0}
button,.btn{display:inline-flex;align-items:center;min-height:36px;font:400 14px/1 var(--font-body);padding:0 16px;border-radius:var(--radius-pill);border:0;background:transparent;color:var(--color-ink);
box-shadow:inset 0 0 0 var(--rule-hair) var(--color-rule-2);cursor:pointer;text-decoration:none;transition:background var(--dur-short) var(--ease-out),color var(--dur-short) var(--ease-out)}
button:hover,.btn:hover{background:var(--color-paper-3);color:var(--color-ink)}button:active,.btn:active{transform:translateY(1px)}
button:disabled{opacity:.45;cursor:not-allowed}.btn[aria-current]{color:var(--color-ink);box-shadow:inset 0 0 0 var(--rule-hair) var(--color-accent)}.btn.on{color:var(--color-ink);box-shadow:inset 0 0 0 var(--rule-hair) var(--color-accent)}
button.primary{background:var(--color-accent);color:var(--color-accent-ink);box-shadow:none}button.primary:hover{background:var(--color-accent-hi);color:var(--color-accent-ink)}
button.danger{color:var(--color-down);box-shadow:inset 0 0 0 var(--rule-hair) var(--color-crit)}
input,select{font:300 15px/1.2 var(--font-body);min-height:36px;padding:6px 10px;border:var(--rule-hair) solid var(--color-rule-2);border-radius:var(--radius-card);background:var(--color-paper);color:var(--color-ink);caret-color:var(--color-accent);max-width:100%}
input:focus-visible,select:focus-visible{outline:2px solid var(--color-focus);outline-offset:0}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:10px 0}.filters label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--color-muted)}
.bar{position:relative;height:6px;border-radius:3px;background:var(--color-rule);margin:12px 0 6px}.bar i{position:absolute;top:-5px;width:2px;height:16px;background:var(--color-accent);border-radius:1px}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--color-muted);margin:4px 0 6px}.legend span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;background:var(--c)}
svg text{fill:var(--color-muted);font:400 11px var(--font-body);font-variant-numeric:tabular-nums}svg .gl{stroke:var(--color-rule);stroke-width:1}svg .ax{stroke:var(--color-rule-2);stroke-width:1}
.tip{position:fixed;pointer-events:none;background:var(--color-paper-3);color:var(--color-ink);border-radius:var(--radius-card);box-shadow:inset 0 0 0 var(--rule-hair) var(--color-rule-2);padding:7px 10px;font-size:12.5px;font-variant-numeric:tabular-nums;display:none;z-index:20;white-space:pre}
details summary{cursor:pointer;color:var(--color-ink-2)}pre{font:300 12.5px/1.5 var(--font-body)}
.sep{color:var(--color-rule-2);margin:0 6px}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
@media (max-width:600px){main{padding:14px 16px 40px}h1{font-size:24px}.tile .v{font-size:21px}}
`;

/** JS della pagina: tooltip sui grafici e finestre di conferma per le azioni. Nessuna libreria esterna. */
export const JS = `
(function(){
var tip=document.createElement('div');tip.className='tip';document.body.appendChild(tip);
document.addEventListener('mousemove',function(e){var t=e.target.closest&&e.target.closest('[data-tip]');if(!t){tip.style.display='none';return;}
tip.textContent=t.getAttribute('data-tip');tip.style.display='block';var x=e.clientX+14,y=e.clientY+14;if(x+tip.offsetWidth>innerWidth)x=e.clientX-tip.offsetWidth-10;tip.style.left=x+'px';tip.style.top=y+'px';});
document.addEventListener('submit',function(e){var f=e.target;var m=f.getAttribute('data-confirm');if(m&&!confirm(m)){e.preventDefault();return;}
var b=f.querySelector('button[type=submit],button:not([type])');if(b){setTimeout(function(){b.disabled=true;b.textContent='Attendere…';},0);}});
})();
`;

export function pagina(titolo: string, attiva: string, corpo: Safe, opts: { csrf?: string; stato?: Safe } = {}): string {
  const voci: [string, string][] = [["/", "Panoramica"], ["/storico", "Storico"], ["/ombra", "Ombra"], ["/review", "Review"], ["/impostazioni", "Impostazioni"], ["/consumi", "Consumi AI"]];
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(titolo)} · Indiano Trading</title><link rel="stylesheet" href="/style.css"></head><body>
<header><b>Indiano Trading</b><nav>${voci.map(([u, n]) => `<a href="${u}"${attiva === u ? ' class="on"' : ""}>${n}</a>`).join("")}</nav>
<span class="small muted">Paper trading${opts.stato ? `<span class="sep">/</span>${opts.stato.s}` : ""}</span>
${opts.csrf ? `<form class="inline" method="post" action="/esci" style="margin-left:auto"><input type="hidden" name="csrf" value="${escHtml(opts.csrf)}"><button>Esci</button></form>` : ""}</header>
<main>${corpo.s}</main><script src="/app.js"></script></body></html>`;
}

/** Formatta senza mostrare "−0,00": il segno si decide sul valore già arrotondato. */
function segno(v: number, d: number): number {
  const r = Number(v.toFixed(d));
  return r === 0 ? 0 : r;
}
export const pct = (x: number | null | undefined, d = 2) => {
  if (x == null || !Number.isFinite(x)) return "n/d";
  const r = segno(x * 100, d);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
};
/** Percentuale senza segno (soglie, quote). */
export const quota = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? "n/d" : `${(x * 100).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
export const usd = (x: number | null | undefined, d = 2) => {
  if (x == null || !Number.isFinite(x)) return "n/d";
  const r = segno(x, d);
  return `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d })} $`;
};
export const num = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "n/d" : segno(x, d).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }));
/** Classe colore: neutra se il valore arrotondato al centesimo di punto è zero. */
export const cls = (x: number | null | undefined) => (x == null || Math.abs(x) < 5e-5 ? "" : x > 0 ? "up" : "down");
