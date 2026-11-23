// Grafici SVG scritti a mano: linee (un solo asse), prezzo con livelli, barre impilate. Tooltip via data-tip.
import { escHtml, raw, type Safe } from "./html.ts";

export interface Serie {
  nome: string;
  colore: string; // variabile CSS, es. "var(--s1)"
  punti: { x: string; y: number | null }[];
}

const W0 = 760;

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

export function graficoLinee(serie: Serie[], opts: { altezza?: number; fmt: (v: number) => string; titolo: string; livelli?: { y: number; nome: string; colore: string }[]; larghezza?: number }): Safe {
  const W = opts.larghezza ?? W0;
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

export function barreImpilate(categorie: string[], pile: Pila[], valori: (cat: string, pila: string) => number, opts: { fmt: (v: number) => string; titolo: string; altezza?: number; larghezza?: number }): Safe {
  const W = opts.larghezza ?? W0;
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

export interface VoceBarra {
  nome: string;
  valore: number;
  nota?: string;
}

/** Barre orizzontali con lo zero come base: sopra lo zero in pervinca, sotto in albicocca. Riferimento opzionale (es. SPY). */
export function barreOrizzontali(voci: VoceBarra[], opts: { fmt: (v: number) => string; titolo: string; riferimento?: { valore: number; nome: string }; larghezza?: number }): Safe {
  const W = opts.larghezza ?? W0;
  if (!voci.length) return raw(`<p class="muted small">${escHtml(opts.titolo)}: nessun dato.</p>`);
  const riga = 30, padT = 8, padB = opts.riferimento ? 22 : 8, lab = 120, val = 72;
  const H = padT + padB + voci.length * riga;
  const vals = [...voci.map((v) => v.valore), 0, ...(opts.riferimento ? [opts.riferimento.valore] : [])];
  const min = Math.min(...vals), max = Math.max(...vals);
  const X = scala(min, max === min ? min + 1 : max, lab + (min < 0 ? val : 0), W - val);
  const x0 = X(0);
  let g = `<line class="ax" x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="${padT - 4}" y2="${H - padB + 4}"/>`;
  voci.forEach((v, i) => {
    const y = padT + i * riga + 6;
    const x1 = X(v.valore);
    const xa = Math.min(x0, x1), w = Math.max(2, Math.abs(x1 - x0));
    const col = v.valore >= 0 ? "var(--color-accent)" : "var(--color-accent-2)";
    g += `<text class="lbl" x="${lab - 10}" y="${y + 13}" text-anchor="end">${escHtml(v.nome)}</text>`;
    g += `<rect x="${xa.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="18" rx="3" fill="${col}"/>`;
    const tx = v.valore >= 0 ? xa + w + 6 : xa - 6;
    g += `<text x="${tx.toFixed(1)}" y="${y + 13}" text-anchor="${v.valore >= 0 ? "start" : "end"}" style="fill:var(--color-ink-2)">${escHtml(opts.fmt(v.valore))}</text>`;
    g += `<rect x="0" y="${y - 6}" width="${W}" height="${riga}" fill="transparent" data-tip="${escHtml(`${v.nome}: ${opts.fmt(v.valore)}${v.nota ? `\n${v.nota}` : ""}`)}"/>`;
  });
  if (opts.riferimento) {
    const xr = X(opts.riferimento.valore);
    g += `<line x1="${xr.toFixed(1)}" x2="${xr.toFixed(1)}" y1="${padT - 4}" y2="${H - padB + 2}" stroke="var(--color-muted)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    g += `<text x="${xr.toFixed(1)}" y="${H - 6}" text-anchor="middle">${escHtml(`${opts.riferimento.nome} ${opts.fmt(opts.riferimento.valore)}`)}</text>`;
  }
  return raw(`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escHtml(opts.titolo)}">${g}</svg>`);
}

/** Composizione di un totale in una barra orizzontale (parti di un intero), con legenda e valori. */
export function composizione(parti: { nome: string; valore: number; colore: string }[], opts: { fmt: (v: number) => string; titolo: string; larghezza?: number }): Safe {
  const W = opts.larghezza ?? W0;
  const tot = parti.reduce((a, p) => a + Math.max(0, p.valore), 0);
  if (!(tot > 0)) return raw(`<p class="muted small">${escHtml(opts.titolo)}: nessun dato.</p>`);
  const H = 26;
  let x = 0, g = "";
  const vis = parti.filter((p) => p.valore > 0);
  vis.forEach((p, i) => {
    const w = (p.valore / tot) * W;
    const gap = i < vis.length - 1 ? 2 : 0;
    g += `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(1, w - gap).toFixed(1)}" height="${H}" rx="${i === 0 || i === vis.length - 1 ? 5 : 0}" fill="${p.colore}" data-tip="${escHtml(`${p.nome}: ${opts.fmt(p.valore)} (${((p.valore / tot) * 100).toFixed(1).replace(".", ",")}%)`)}"/>`;
    x += w;
  });
  const legenda = `<div class="legend">${vis.map((p) => `<span style="--c:${p.colore}">${escHtml(p.nome)} ${escHtml(opts.fmt(p.valore))} <span class="muted">(${((p.valore / tot) * 100).toFixed(0)}%)</span></span>`).join("")}</div>`;
  return raw(`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="${escHtml(opts.titolo)}">${g}</svg>${legenda}`);
}

/** Una barra sottile per giorno attorno allo zero: sopra in pervinca, sotto in albicocca. */
export function striscia(giorni: { data: string; valore: number | null }[], opts: { fmt: (v: number) => string; titolo: string; larghezza?: number }): Safe {
  const W = opts.larghezza ?? W0;
  const pts = giorni.filter((g) => g.valore !== null) as { data: string; valore: number }[];
  if (pts.length < 2) return raw(`<p class="muted small">${escHtml(opts.titolo)}: servono almeno due sedute di storia.</p>`);
  const H = 120, padT = 8, padB = 22;
  const m = Math.max(...pts.map((p) => Math.abs(p.valore)), 1e-9);
  const Y = scala(-m, m, H - padB, padT);
  const slot = W / giorni.length, bw = Math.max(3, Math.min(14, slot * 0.6));
  let g = `<line class="ax" x1="0" x2="${W}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`;
  giorni.forEach((d, i) => {
    const x = slot * i + (slot - bw) / 2;
    if (d.valore === null) return;
    const y1 = Y(Math.max(0, d.valore)), y2 = Y(Math.min(0, d.valore));
    g += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, y2 - y1).toFixed(1)}" rx="${(bw / 2).toFixed(1)}" fill="${d.valore >= 0 ? "var(--color-accent)" : "var(--color-accent-2)"}"/>`;
    g += `<rect x="${(slot * i).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H - padB}" fill="transparent" data-tip="${escHtml(`${d.data}: ${opts.fmt(d.valore)}`)}"/>`;
  });
  g += `<text x="0" y="${H - 6}">${escHtml(giorni[0]!.data)}</text><text x="${W}" y="${H - 6}" text-anchor="end">${escHtml(giorni.at(-1)!.data)}</text>`;
  return raw(`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escHtml(opts.titolo)}">${g}</svg>`);
}
