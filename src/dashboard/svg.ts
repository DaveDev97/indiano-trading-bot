// Grafici SVG scritti a mano: linee (un solo asse), prezzo con livelli, barre impilate. Tooltip via data-tip.
import { escHtml, raw, type Safe } from "./html.ts";

export interface Serie {
  nome: string;
  colore: string; // variabile CSS, es. "var(--s1)"
  punti: { x: string; y: number | null }[];
}

const W = 760;

function scala(min: number, max: number, a: number, b: number) {
  const d = max - min || 1;
  return (v: number) => a + ((v - min) / d) * (b - a);
}

function ticks(min: number, max: number, n = 4): number[] {
  const step = (max - min) / n || 1;
  const mag = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= step) ?? step;
  const out: number[] = [];
  for (let v = Math.ceil(min / nice) * nice; v <= max + 1e-9; v += nice) out.push(Number(v.toFixed(10)));
  return out;
}

export function graficoLinee(serie: Serie[], opts: { altezza?: number; fmt: (v: number) => string; titolo: string; livelli?: { y: number; nome: string; colore: string }[] }): Safe {
  const H = opts.altezza ?? 240;
  const pad = { l: 56, r: 72, t: 12, b: 28 };
  const xs = [...new Set(serie.flatMap((s) => s.punti.map((p) => p.x)))].sort();
  const ys = [...serie.flatMap((s) => s.punti.map((p) => p.y).filter((y): y is number => y !== null)), ...(opts.livelli ?? []).map((l) => l.y)];
  if (xs.length < 2 || !ys.length) return raw(`<p class="muted small">${escHtml(opts.titolo)}: dati insufficienti per il grafico.</p>`);
  let min = Math.min(...ys), max = Math.max(...ys);
  const m = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  min -= m;
  max += m;
  const X = scala(0, xs.length - 1, pad.l, W - pad.r);
  const Y = scala(min, max, H - pad.b, pad.t);
  const xi = new Map(xs.map((x, i) => [x, i]));
  let g = "";
  for (const t of ticks(min, max)) g += `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text x="${pad.l - 6}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${escHtml(opts.fmt(t))}</text>`;
  g += `<line class="ax" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>`;
  const lab = [0, Math.floor((xs.length - 1) / 2), xs.length - 1];
  for (const i of [...new Set(lab)]) g += `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === xs.length - 1 ? "end" : "middle"}">${escHtml(xs[i]!)}</text>`;
  for (const l of opts.livelli ?? []) {
    g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(l.y).toFixed(1)}" y2="${Y(l.y).toFixed(1)}" stroke="${l.colore}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    g += `<text x="${W - pad.r + 4}" y="${(Y(l.y) + 4).toFixed(1)}" style="fill:var(--ink2)">${escHtml(l.nome)}</text>`;
  }
  for (const s of serie) {
    const pts = s.punti.filter((p) => p.y !== null).map((p) => `${X(xi.get(p.x)!).toFixed(1)},${Y(p.y!).toFixed(1)}`);
    if (pts.length < 2) continue;
    g += `<polyline fill="none" stroke="${s.colore}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}"/>`;
    const last = s.punti.filter((p) => p.y !== null).at(-1)!;
    if (serie.length > 1) g += `<text x="${W - pad.r + 4}" y="${(Y(last.y!) + 4).toFixed(1)}" style="fill:var(--ink2)">${escHtml(s.nome)}</text>`;
  }
  // bande verticali invisibili per il tooltip (bersaglio più grande del segno)
  const bw = (W - pad.l - pad.r) / Math.max(1, xs.length - 1);
  xs.forEach((x, i) => {
    const righe = serie.map((s) => {
      const p = s.punti.find((q) => q.x === x);
      return `${s.nome}: ${p && p.y !== null ? opts.fmt(p.y) : "n/d"}`;
    });
    g += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${H - pad.t - pad.b}" fill="transparent" data-tip="${escHtml(`${x}\n${righe.join("\n")}`)}"/>`;
  });
  const legenda = serie.length > 1 ? `<div class="legend">${serie.map((s) => `<span style="--c:${s.colore}">${escHtml(s.nome)}</span>`).join("")}</div>` : "";
  return raw(`${legenda}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escHtml(opts.titolo)}">${g}</svg>`);
}

export interface Pila {
  nome: string;
  colore: string;
}

export function barreImpilate(categorie: string[], pile: Pila[], valori: (cat: string, pila: string) => number, opts: { fmt: (v: number) => string; titolo: string; altezza?: number }): Safe {
  const H = opts.altezza ?? 220;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  if (!categorie.length) return raw(`<p class="muted small">Nessun dato nel periodo.</p>`);
  const tot = categorie.map((c) => pile.reduce((a, p) => a + valori(c, p.nome), 0));
  const max = Math.max(...tot, 0) * 1.08 || 1;
  const Y = scala(0, max, H - pad.b, pad.t);
  const slot = (W - pad.l - pad.r) / categorie.length;
  const bw = Math.max(3, Math.min(36, slot * 0.7));
  let g = "";
  for (const t of ticks(0, max)) g += `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text x="${pad.l - 6}" y="${(Y(t) + 4).toFixed(1)}" text-anchor="end">${escHtml(opts.fmt(t))}</text>`;
  categorie.forEach((c, i) => {
    const x = pad.l + slot * i + (slot - bw) / 2;
    let base = 0;
    const segs = pile.map((p) => ({ p, v: valori(c, p.nome) })).filter((s) => s.v > 0);
    segs.forEach((s, k) => {
      const y0 = Y(base), y1 = Y(base + s.v);
      const h = Math.max(0, y0 - y1 - (k < segs.length - 1 ? 2 : 0)); // 2 px di spazio tra i segmenti
      const top = k === segs.length - 1;
      g += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${top ? 3 : 0}" fill="${s.p.colore}"/>`;
      base += s.v;
    });
    const righe = pile.map((p) => `${p.nome}: ${opts.fmt(valori(c, p.nome))}`).join("\n");
    g += `<rect x="${(pad.l + slot * i).toFixed(1)}" y="${pad.t}" width="${slot.toFixed(1)}" height="${H - pad.t - pad.b}" fill="transparent" data-tip="${escHtml(`${c}\ntotale ${opts.fmt(tot[i]!)}\n${righe}`)}"/>`;
  });
  g += `<line class="ax" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>`;
  const step = Math.ceil(categorie.length / 6);
  categorie.forEach((c, i) => {
    if (i % step === 0 || i === categorie.length - 1) g += `<text x="${(pad.l + slot * i + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${escHtml(c)}</text>`;
  });
  const legenda = `<div class="legend">${pile.map((p) => `<span style="--c:${p.colore}">${escHtml(p.nome)}</span>`).join("")}</div>`;
  return raw(`${legenda}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escHtml(opts.titolo)}">${g}</svg>`);
}
