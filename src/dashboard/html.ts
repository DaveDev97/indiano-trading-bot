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
/* hallmark · v2.0.0 · theme: dusk (by request) · dusk: -/periwinkle-apricot/glass · shape: app screen · scope: app · font: Wix Madefor Display + Text locali (OFL), nessun CDN · data: reale */
/* critique: schermata di lavoro su ardesia; pervinca = fatto, attivo, il bot; albicocca = aperto, da guardare, le perdite; SPY in grigio di riferimento; cifre in righe e in un conteggio rigato, non in riquadri */
/* waive 16: sloplint non eseguito (node non installato; per CLAUDE.md non si installa nulla) · waive hour: nessuna fotografia, è una schermata applicativa */
@font-face{font-family:"Wix Madefor Display";src:url("/font/display.ttf") format("truetype");font-weight:400 800;font-display:swap}
@font-face{font-family:"Wix Madefor Text";src:url("/font/text.ttf") format("truetype");font-weight:400 800;font-display:swap}
:root{color-scheme:dark;
--color-paper:oklch(17.5% 0.014 268);--color-paper-2:oklch(21% 0.016 268);--color-paper-3:oklch(25% 0.017 268);
--color-ink:oklch(96% 0.006 75);--color-ink-2:oklch(85% 0.010 262);--color-muted:oklch(70% 0.016 262);
--color-rule:oklch(30% 0.016 266);--color-light:oklch(100% 0 0);--color-shade:oklch(10% 0.022 268);
--color-accent:oklch(77% 0.10 274);--color-accent-ink:oklch(19% 0.035 274);--color-accent-hi:oklch(84% 0.085 274);
--color-accent-deep:oklch(44% 0.13 274);--color-accent-soft:oklch(91% 0.038 274);--color-focus:oklch(80% 0.10 274);
--color-accent-2:oklch(83% 0.095 62);
--glass:oklch(22% 0.018 268 / 0.72);--glass-blur:22px;
--glass-hi:inset 0 1px 0 oklch(100% 0 0 / 0.10),inset 0 0 0 1px oklch(100% 0 0 / 0.06);
--shadow-card:0 1px 0 oklch(100% 0 0 / 0.06) inset,0 40px 80px -32px oklch(8% 0.02 268 / 0.7);
--font-display:"Wix Madefor Display",ui-sans-serif,system-ui,sans-serif;--font-body:"Wix Madefor Text",ui-sans-serif,system-ui,sans-serif;
--radius-card:18px;--radius-inner:10px;--radius-pill:999px;--rule-hair:1px;--tracking-display:-0.022em;
--dur-micro:90ms;--dur-short:180ms;--ease-out:cubic-bezier(.2,.7,.2,1);
/* alias usati da pagine e grafici */
--bg:var(--color-paper);--surface:var(--color-paper-2);--ink:var(--color-ink);--ink2:var(--color-ink-2);--muted:var(--color-muted);--grid:var(--color-rule);--axis:oklch(36% 0.016 266);--line:var(--color-rule);
--accent:var(--color-accent);--s1:var(--color-accent);--s2:var(--color-muted);
--r1:oklch(84% 0.085 274);--r2:oklch(72% 0.11 274);--r3:oklch(60% 0.12 274);--r4:oklch(50% 0.12 274);--r5:oklch(91% 0.038 274);--r6:oklch(42% 0.10 274);
--good:var(--color-accent);--goodtext:var(--color-accent-hi);--warn:var(--color-accent-2);--serious:var(--color-accent-2);--crit:var(--color-accent-2);--badtext:var(--color-accent-2)}
*{box-sizing:border-box}html,body{overflow-x:clip}
body{margin:0;background:var(--color-paper);color:var(--color-ink-2);font:400 16px/1.55 var(--font-body);-webkit-font-smoothing:antialiased}
a{color:var(--color-accent-hi);text-decoration-color:color-mix(in oklab,var(--color-accent) 40%,transparent);text-underline-offset:3px}
a:hover{color:var(--color-accent-soft)}
:focus-visible{outline:2px solid var(--color-focus);outline-offset:2px}
h1,h2,h3{font-family:var(--font-display);font-weight:500;letter-spacing:var(--tracking-display);line-height:1.08;color:var(--color-ink);overflow-wrap:break-word;min-width:0}
h1{font-size:30px;margin:8px 0 20px}h2{font-size:20px;margin:32px 0 12px}h3{font-size:16px;margin:0 0 8px}
/* testata: vetro ardesia, menu che su telefono diventa un elenco a scomparsa (solo CSS) */
header{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 20px;background:var(--glass);-webkit-backdrop-filter:blur(var(--glass-blur)) saturate(1.35);backdrop-filter:blur(var(--glass-blur)) saturate(1.35);box-shadow:var(--glass-hi)}
.brand{display:flex;align-items:center;gap:10px;color:var(--color-ink);font:500 16px/1 var(--font-display);text-decoration:none;letter-spacing:-0.01em}
.brand::before{content:"";width:10px;height:10px;border-radius:50%;background:radial-gradient(circle at 35% 35%,var(--color-accent-soft),var(--color-accent-deep))}
header nav{display:flex;flex-wrap:wrap;gap:2px}
header nav a{padding:7px 13px;border-radius:var(--radius-pill);color:var(--color-ink-2);text-decoration:none;font-weight:500;font-size:14.5px;transition:background var(--dur-short) var(--ease-out),color var(--dur-short) var(--ease-out)}
header nav a:hover{background:oklch(100% 0 0 / 0.05);color:var(--color-ink)}
header nav a.on{color:var(--color-accent-ink);background:var(--color-accent)}
.stato{color:var(--color-muted);font-size:13.5px}.testata-dx{margin-left:auto;display:flex;align-items:center;gap:12px}
.menu-t{position:absolute;opacity:0;pointer-events:none}.menu-l{display:none}
@media (max-width:820px){
  header{padding:10px 16px}
  .menu-l{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border-radius:var(--radius-pill);color:var(--color-ink);box-shadow:inset 0 0 0 1px var(--color-rule);cursor:pointer;font-weight:500;font-size:14.5px;order:2;margin-left:auto}
  .menu-l::before{content:"";width:16px;height:10px;border-top:2px solid currentColor;border-bottom:2px solid currentColor;background:linear-gradient(currentColor,currentColor) center/100% 2px no-repeat}
  .menu-t:focus-visible+.menu-l{outline:2px solid var(--color-focus);outline-offset:2px}
  header nav{order:4;flex-basis:100%;flex-direction:column;gap:2px;display:none;padding:6px 0 4px}
  header nav a{padding:12px 14px;font-size:16px}
  .menu-t:checked~nav{display:flex}
  .testata-dx{order:3;margin-left:0}.stato{display:none}
}
main{max-width:1440px;margin:0 auto;padding:24px 32px 56px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))}
.due{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));align-items:start}
.card{background:var(--color-paper-2);border-radius:var(--radius-card);padding:20px 24px;box-shadow:var(--glass-hi),var(--shadow-card)}
.card>h3{margin-bottom:12px}
a.card{display:block;text-decoration:none;color:inherit;transition:background var(--dur-short) var(--ease-out)}a.card:hover{background:var(--color-paper-3)}
/* conteggio rigato: le cifre principali in una riga, separate da filetti */
.tally{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--color-paper-2);border-radius:var(--radius-card);box-shadow:var(--glass-hi),var(--shadow-card);overflow:hidden}
.tally>div{padding:16px 24px;border-left:1px solid var(--color-rule)}.tally>div:first-child{border-left:0}
.tally .k{color:var(--color-muted);font-size:13.5px;font-weight:500}.tally .v{color:var(--color-ink);font:500 28px/1.2 var(--font-display);font-variant-numeric:tabular-nums;letter-spacing:-0.01em;margin-top:4px}
.tally .s{font-size:13px;color:var(--color-muted);margin-top:2px}
@media (max-width:700px){.tally{grid-template-columns:repeat(2,minmax(0,1fr))}.tally>div:nth-child(3){border-left:0}.tally>div:nth-child(n+3){border-top:1px solid var(--color-rule)}.tally .v{font-size:22px}}
.tile .v{color:var(--color-ink);font:500 24px/1.2 var(--font-display);font-variant-numeric:tabular-nums}.tile .k{color:var(--color-muted);font-size:13.5px;font-weight:500}
.muted{color:var(--color-muted)}.small{font-size:13.5px}b,strong{color:var(--color-ink);font-weight:600}
.up{color:var(--color-accent-hi)}.down{color:var(--color-accent-2)}
.pnl{font:500 20px/1.2 var(--font-display);font-variant-numeric:tabular-nums;margin:4px 0}
table{border-collapse:collapse;width:100%;font-size:14.5px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--color-rule);vertical-align:top}
th{color:var(--color-muted);font-weight:500;font-size:13.5px}td{color:var(--color-ink-2)}td.n,th.n{text-align:right}
tbody tr:hover td,table tr:hover td{background:oklch(100% 0 0 / 0.025)}tr.totale td{color:var(--color-ink);font-weight:600;border-top:1px solid var(--axis)}
tr.link{cursor:pointer}
.scroll{overflow-x:auto}
.badge{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:var(--radius-pill);font-size:12.5px;font-weight:500;color:var(--color-ink-2);background:oklch(100% 0 0 / 0.05)}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--color-muted)}
.b-good{color:var(--color-accent-hi)}.b-good::before{background:var(--color-accent)}
.b-crit,.b-warn{color:var(--color-accent-2)}.b-crit::before,.b-warn::before{background:var(--color-accent-2)}
.alarm{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;margin:8px 0;border-radius:var(--radius-inner);color:var(--color-ink);background:color-mix(in oklab,var(--color-accent-2) 12%,var(--color-paper-2));box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--color-accent-2) 35%,transparent)}
.alarm::before{content:"";flex:none;width:8px;height:8px;margin-top:8px;border-radius:50%;background:var(--color-accent-2)}
.note{padding:12px 16px;margin:8px 0;border-radius:var(--radius-inner);background:var(--color-paper-2);box-shadow:var(--glass-hi)}
form.inline{display:inline-block;margin:4px 8px 4px 0}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 18px;border:0;border-radius:var(--radius-pill);background:oklch(100% 0 0 / 0.05);color:var(--color-ink);font:500 14.5px/1 var(--font-body);cursor:pointer;text-decoration:none;box-shadow:inset 0 0 0 1px var(--color-rule);transition:background var(--dur-short) var(--ease-out),color var(--dur-short) var(--ease-out),box-shadow var(--dur-short) var(--ease-out)}
button:hover,.btn:hover{background:oklch(100% 0 0 / 0.09);color:var(--color-ink)}button:active,.btn:active{transform:translateY(1px)}
button:disabled{opacity:.45;cursor:not-allowed}
.btn[aria-current]{box-shadow:inset 0 0 0 1.5px var(--color-accent);color:var(--color-accent-hi)}
button.primary{background:var(--color-accent);color:var(--color-accent-ink);font-weight:600;box-shadow:inset 0 1px 0 color-mix(in oklab,var(--color-light) 35%,transparent)}
button.primary:hover{background:var(--color-accent-hi);box-shadow:0 0 0 4px color-mix(in oklab,var(--color-accent) 25%,transparent)}
button.danger{color:var(--color-accent-2);box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--color-accent-2) 55%,transparent)}
input,select{font:400 15px/1.2 var(--font-body);min-height:40px;padding:8px 12px;border:0;border-radius:var(--radius-inner);background:var(--color-shade);color:var(--color-ink);box-shadow:inset 0 0 0 1px var(--color-rule);caret-color:var(--color-accent);max-width:100%}
input:focus-visible,select:focus-visible{outline:2px solid var(--color-focus);outline-offset:1px}
.filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:12px 0}.filters label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:500;color:var(--color-muted)}
.bar{position:relative;height:6px;border-radius:3px;background:var(--color-rule);margin:12px 0 6px}.bar i{position:absolute;top:-5px;width:3px;height:16px;margin-left:-1px;background:var(--color-accent);border-radius:2px}
.bar b{position:absolute;top:0;bottom:0;border-radius:3px;background:color-mix(in oklab,var(--color-accent) 45%,transparent)}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--color-muted);margin:0 0 8px}.legend>span::before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:var(--c)}
svg text{fill:var(--color-muted);font:500 11px var(--font-body);font-variant-numeric:tabular-nums}svg .gl{stroke:var(--color-rule);stroke-width:1}svg .ax{stroke:var(--axis);stroke-width:1}
svg .lbl{fill:var(--color-ink-2);font-size:12px}
.tip{position:fixed;pointer-events:none;background:var(--color-paper-3);color:var(--color-ink);border-radius:var(--radius-inner);box-shadow:var(--glass-hi),0 12px 30px -10px oklch(8% 0.02 268 / 0.8);padding:8px 11px;font-size:12.5px;font-variant-numeric:tabular-nums;display:none;z-index:30;white-space:pre}
details summary{cursor:pointer;color:var(--color-ink-2)}pre{font:400 12.5px/1.5 var(--font-body)}
.sep{color:var(--color-rule);margin:0 6px}
/* elenco tipo "conti": righe con iniziale tonda, stato e cifre allineate a destra */
.lista{background:var(--color-paper-2);border-radius:var(--radius-card);box-shadow:var(--glass-hi),var(--shadow-card);overflow:hidden}
.riga{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:16px;align-items:center;padding:16px 20px;border-top:1px solid oklch(100% 0 0 / 0.07);text-decoration:none;color:inherit;transition:background var(--dur-short) var(--ease-out)}
.riga:first-child{border-top:0}a.riga:hover{background:oklch(100% 0 0 / 0.035)}
.iniziale{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:oklch(100% 0 0 / 0.06);color:var(--color-ink);font:600 13px/1 var(--font-display)}
.riga .bar{display:block;max-width:340px}.riga .t{color:var(--color-ink);font-weight:600}.riga .d{font-size:13px;color:var(--color-muted)}.riga .n{text-align:right;font-variant-numeric:tabular-nums}
.riga .n .v{font:500 17px/1.2 var(--font-display);color:var(--color-ink)}
.riga.aperta{background:color-mix(in oklab,var(--color-accent-2) 8%,transparent)}
@media (max-width:560px){.riga{grid-template-columns:32px minmax(0,1fr);}.riga .n{grid-column:2;text-align:left}.iniziale{width:30px;height:30px}}
/* schede: elenco rigato con un punto, mai pulsanti a segmenti */
.schede{display:grid;grid-template-columns:230px minmax(0,1fr);gap:28px;align-items:start}
.tabs{list-style:none;margin:0;padding:0;position:sticky;top:76px}
.tabs a{display:flex;align-items:center;gap:10px;padding:11px 4px 11px 18px;border-top:1px solid var(--color-rule);color:var(--color-ink-2);text-decoration:none;font-weight:500;position:relative}
.tabs li:first-child a{border-top:0}.tabs a:hover{color:var(--color-ink)}
.tabs a[aria-current]{color:var(--color-ink)}.tabs a[aria-current]::before{content:"";position:absolute;left:2px;width:7px;height:7px;border-radius:50%;background:var(--color-accent)}
.tabs .c{margin-left:auto;font-size:12.5px;color:var(--color-muted)}
@media (max-width:820px){.schede{grid-template-columns:minmax(0,1fr);gap:12px}.tabs{position:static;display:flex;overflow-x:auto;gap:4px;padding-bottom:6px;border-bottom:1px solid var(--color-rule)}
  .tabs a{border-top:0;padding:10px 14px 10px 20px;white-space:nowrap}.tabs a[aria-current]::before{left:7px}}
/* parametri: una riga per parametro, con la "i" che apre la spiegazione */
.param{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,220px);gap:8px 20px;align-items:center;padding:16px 0;border-top:1px solid var(--color-rule)}
.param:first-of-type{border-top:0}
.param .nome{color:var(--color-ink);font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.param .meta{grid-column:1/-1;font-size:13px;color:var(--color-muted);margin-top:-4px}
.param input,.param select{width:100%}
.info{display:inline-block}.info summary{list-style:none;display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;font:600 12px/1 var(--font-display);color:var(--color-accent-hi);background:oklch(100% 0 0 / 0.06);box-shadow:inset 0 0 0 1px var(--color-rule)}
.info summary::-webkit-details-marker{display:none}.info[open] summary{background:var(--color-accent);color:var(--color-accent-ink)}
.info p{display:block;margin:8px 0 2px;padding:10px 14px;border-radius:var(--radius-inner);background:var(--color-shade);color:var(--color-ink-2);font-size:14px;font-weight:400;max-width:640px}
.info[open]{flex-basis:100%}
@media (max-width:560px){.param{grid-template-columns:minmax(0,1fr)}}
.introduzione{color:var(--color-ink-2);max-width:760px;margin:0 0 18px}
.principale .testa{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;margin-bottom:8px}.principale .testa h3{margin:0}.principale .filters{margin:0}
.ritmo{display:grid;gap:16px;grid-template-columns:minmax(0,2fr) minmax(280px,1fr);margin:16px 0;align-items:stretch}@media (max-width:900px){.ritmo{grid-template-columns:minmax(0,1fr)}}
.legenda-lista{list-style:none;margin:16px 0 0;padding:0}.legenda-lista li{display:grid;grid-template-columns:12px minmax(0,1fr) auto 48px;gap:8px 12px;align-items:center;padding:4px 0;font-size:14px}.legenda-lista .pallino{width:10px;height:10px;border-radius:3px}.legenda-lista .n{text-align:right;font-variant-numeric:tabular-nums}
.classifica{list-style:none;margin:0 0 12px;padding:0}
.classifica li{display:grid;grid-template-columns:minmax(120px,200px) minmax(0,1fr) 64px 104px;gap:16px;align-items:center;padding:8px 0;border-top:1px solid oklch(100% 0 0 / 0.06)}
.classifica li:first-child{border-top:0}.classifica .nome{color:var(--color-ink-2)}.classifica li.forte .nome{color:var(--color-ink)}
.classifica .traccia{position:relative;height:4px;border-radius:2px;background:oklch(100% 0 0 / 0.06)}.classifica .riempi{position:absolute;top:0;bottom:0;border-radius:2px;background:var(--color-accent)}
.classifica li:not(.forte) .riempi{background:var(--color-accent-2)}.classifica .v{text-align:right;font-variant-numeric:tabular-nums}.classifica .stato{font-size:13px;color:var(--color-muted)}
@media (max-width:560px){.classifica li{grid-template-columns:minmax(0,1fr) 64px;row-gap:4px}.classifica .traccia{grid-column:1/-1;grid-row:2}.classifica .stato{display:none}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
@media (max-width:600px){main{padding:16px 16px 44px}h1{font-size:25px}}
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
  const on = (u: string) => (u === "/" ? attiva === "/" : attiva.startsWith(u));
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(titolo)} · Indiano Trading</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/client.css"></head><body>
<header><a class="brand" href="/">Indiano Trading</a>
<input type="checkbox" id="menu" class="menu-t" aria-label="Apri il menu"><label for="menu" class="menu-l">Menu</label>
<nav aria-label="Pagine">${voci.map(([u, n]) => `<a href="${u}"${on(u) ? ' class="on" aria-current="page"' : ""}>${n}</a>`).join("")}</nav>
<div class="testata-dx"><span class="stato">Paper trading${opts.stato ? `<span class="sep">/</span>${opts.stato.s}` : ""}</span>
${opts.csrf ? `<form class="inline" method="post" action="/esci"><input type="hidden" name="csrf" value="${escHtml(opts.csrf)}"><button>Esci</button></form>` : ""}</div></header>
<main>${corpo.s}</main><script src="/app.js"></script><script type="module" src="/client.js"></script></body></html>`;
}

/** Formatta senza mostrare "−0,00": il segno si decide sul valore già arrotondato. */
function segno(v: number, d: number): number {
  const r = Number(v.toFixed(d));
  return r === 0 ? 0 : r;
}
export const pct = (x: number | null | undefined, d = 2) => {
  if (x == null || !Number.isFinite(x)) return "n/d";
  const r = segno(x * 100, d);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" } as Intl.NumberFormatOptions)}%`;
};
/** Percentuale senza segno (soglie, quote). */
export const quota = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? "n/d" : `${(x * 100).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" } as Intl.NumberFormatOptions)}%`);
export const usd = (x: number | null | undefined, d = 2) => {
  if (x == null || !Number.isFinite(x)) return "n/d";
  const r = segno(x, d);
  return `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" } as Intl.NumberFormatOptions)} $`;
};
export const num = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "n/d" : segno(x, d).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: "always" } as Intl.NumberFormatOptions));
/** Classe colore: neutra se il valore arrotondato al centesimo di punto è zero. */
export const cls = (x: number | null | undefined) => (x == null || Math.abs(x) < 5e-5 ? "" : x > 0 ? "up" : "down");

/**
 * Un grafico bklit montato dal browser (src/dashboard/client/main.tsx) con i dati in JSON.
 * Dentro c'è il grafico SVG del server come riserva: si vede se il JavaScript non parte.
 */
export function isola(tipo: "linee" | "barre" | "impilate" | "torta", props: unknown, riserva: Safe): Safe {
  return new Safe(`<div class="isola" data-bklit="${tipo}" data-props="${escHtml(JSON.stringify(props))}"><div class="riserva">${riserva.s}</div></div>`);
}
