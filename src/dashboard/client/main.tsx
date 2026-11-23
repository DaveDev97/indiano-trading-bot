// Lato browser della dashboard: monta i grafici bklit (React + motion + d3) nelle "isole" generate dal server
// e anima l'ingresso di card e righe con motion. Compilato da `bun run client` in src/dashboard/assets/client.js.
// Senza JavaScript la pagina resta completa: dentro ogni isola c'è il grafico SVG di riserva fatto dal server.
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import NumberFlow from "@number-flow/react";
import { animate, stagger } from "motion";
import { LineChart } from "@/charts/line-chart";
import { Line } from "@/charts/line";
import { Grid } from "@/charts/grid";
import { XAxis } from "@/charts/x-axis";
import { YAxis } from "@/charts/y-axis";
import { BarChart } from "@/charts/bar-chart";
import { Bar } from "@/charts/bar";
import { BarXAxis } from "@/charts/bar-x-axis";
import { BarYAxis } from "@/charts/bar-y-axis";
import { PieChart } from "@/charts/pie-chart";
import { PieSlice } from "@/charts/pie-slice";
import { PieCenter } from "@/charts/pie-center";
import { ChartTooltip } from "@/charts/tooltip";
import { curveMonotoneX } from "d3-shape";

type Formato = "pct" | "usd" | "usd0" | "indice" | "prezzo" | "numero";

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat("it-IT", { useGrouping: "always", ...o } as Intl.NumberFormatOptions);
const FORMATI: Record<Formato, (v: number) => string> = {
  pct: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(v * 100))}%`,
  usd: (v) => `${v < 0 ? "−" : ""}${nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v))} $`,
  usd0: (v) => `${v < 0 ? "−" : ""}${nf({ maximumFractionDigits: 0 }).format(Math.abs(v))} $`,
  indice: (v) => nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v),
  prezzo: (v) => nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v),
  numero: (v) => nf({ maximumFractionDigits: 0 }).format(v),
};
const fmt = (f: Formato | undefined, v: unknown) => (typeof v === "number" && Number.isFinite(v) ? FORMATI[f ?? "numero"](v) : "n/d");
const dataIt = (d: string) => new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

interface PropsLinee {
  serie: { chiave: string; nome: string; colore: string; tratteggiata?: boolean }[];
  punti: Record<string, number | string | null>[];
  formato?: Formato;
  rapporto?: string;
}

function Linee(p: PropsLinee): ReactNode {
  const data = p.punti.map((r) => ({ ...r, date: new Date(`${r.data}T12:00:00Z`) }));
  const etichette = p.punti.map((r) => dataIt(String(r.data)));
  return (
    <LineChart data={data} aspectRatio={p.rapporto ?? "16 / 9"} margin={{ left: 46, right: 12, top: 12, bottom: 28 }}>
      <Grid horizontal />
      {p.serie.map((s) => (
        <Line key={s.chiave} dataKey={s.chiave} stroke={s.colore} strokeWidth={s.tratteggiata ? 1.5 : 2.25} dashFromIndex={s.tratteggiata ? 0 : undefined} curve={curveMonotoneX} />
      ))}
      <XAxis numTicks={4} labels={etichette} />
      <YAxis numTicks={4} formatValue={(v) => fmt(p.formato, v)} />
      <ChartTooltip
        dateLabels={etichette}
        rows={(pt) => p.serie.map((s) => ({ color: s.colore, label: s.nome, value: fmt(p.formato, pt[s.chiave]) }))}
      />
    </LineChart>
  );
}

interface PropsBarre {
  righe: { etichetta: string; valore: number; nota?: string }[];
  formato?: Formato;
  orientamento?: "horizontal" | "vertical";
  rapporto?: string;
}

/** Barre con il colore del segno: due serie impilate ("sopra zero" in pervinca, "sotto zero" in albicocca). */
function Barre(p: PropsBarre): ReactNode {
  const data = p.righe.map((r) => ({ nome: r.etichetta, su: r.valore >= 0 ? r.valore : 0, giu: r.valore < 0 ? r.valore : 0, valore: r.valore, nota: r.nota ?? "" }));
  const orizzontale = p.orientamento === "horizontal";
  return (
    <BarChart data={data} xDataKey="nome" orientation={p.orientamento ?? "vertical"} stacked aspectRatio={p.rapporto ?? (orizzontale ? `16 / ${Math.max(4, p.righe.length * 1.6)}` : "16 / 7")} margin={orizzontale ? { left: 96, right: 16, top: 6, bottom: 22 } : { left: 46, right: 8, top: 8, bottom: 26 }} barGap={0.3}>
      <Grid horizontal={!orizzontale} vertical={orizzontale} />
      <Bar dataKey="su" fill="var(--chart-positive)" lineCap="round" />
      <Bar dataKey="giu" fill="var(--chart-negative)" lineCap="round" />
      {orizzontale ? <BarYAxis showAllLabels /> : <BarXAxis maxLabels={6} />}
      <ChartTooltip rows={(pt) => [{ color: Number(pt.valore) >= 0 ? "var(--chart-positive)" : "var(--chart-negative)", label: String(pt.nota || pt.nome), value: fmt(p.formato, pt.valore) }]} />
    </BarChart>
  );
}

interface PropsImpilate {
  categorie: string[];
  serie: { chiave: string; nome: string; colore: string }[];
  valori: Record<string, number>[];
  formato?: Formato;
}

function Impilate(p: PropsImpilate): ReactNode {
  const data = p.categorie.map((c, i) => ({ nome: c, ...p.valori[i] }));
  return (
    <BarChart data={data} xDataKey="nome" stacked aspectRatio="16 / 6" margin={{ left: 52, right: 8, top: 8, bottom: 26 }} barGap={0.35}>
      <Grid horizontal />
      {p.serie.map((s) => (
        <Bar key={s.chiave} dataKey={s.chiave} fill={s.colore} lineCap="round" />
      ))}
      <BarXAxis maxLabels={8} />
      <ChartTooltip rows={(pt) => p.serie.map((s) => ({ color: s.colore, label: s.nome, value: fmt(p.formato, pt[s.chiave] ?? 0) }))} />
    </BarChart>
  );
}

interface PropsTorta {
  fette: { nome: string; valore: number; colore: string }[];
  formato?: Formato;
  centro: string;
}

function Torta(p: PropsTorta): ReactNode {
  const data = p.fette.filter((f) => f.valore > 0).map((f) => ({ label: f.nome, value: f.valore, color: f.colore }));
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <PieChart data={data} size={230} innerRadius={80} padAngle={0.025} cornerRadius={6}>
        {data.map((_, i) => (
          <PieSlice key={i} index={i} />
        ))}
        <PieCenter defaultLabel={p.centro}>
          {({ value, label, isHovered }) => (
            <div style={{ textAlign: "center" }}>
              <div style={{ font: "500 26px/1.1 var(--font-display)", color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}>{FORMATI.usd0(value)}</div>
              <div style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 4 }}>{isHovered ? label : p.centro}</div>
            </div>
          )}
        </PieCenter>
      </PieChart>
    </div>
  );
}

const COMPONENTI: Record<string, (p: any) => ReactNode> = { linee: Linee, barre: Barre, impilate: Impilate, torta: Torta };

function montaIsole(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-bklit]")) {
    const C = COMPONENTI[el.dataset.bklit ?? ""];
    if (!C || el.dataset.montata) continue;
    let props: unknown;
    try {
      props = JSON.parse(el.dataset.props ?? "{}");
    } catch {
      continue;
    }
    const dove = document.createElement("div");
    el.appendChild(dove);
    try {
      createRoot(dove).render(<StrictMode>{C(props)}</StrictMode>);
      el.dataset.montata = "1";
    } catch (e) {
      dove.remove(); // resta il grafico di riserva
      console.error("grafico non montato", e);
    }
  }
}

/** Cifre del conteggio che scorrono al nuovo valore (NumberFlow). */
function montaNumeri(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-numero]")) {
    const v = Number(el.dataset.numero);
    if (!Number.isFinite(v)) continue;
    const dove = document.createElement("span");
    el.replaceChildren(dove);
    createRoot(dove).render(<NumberFlow value={v} locales="it-IT" format={{ maximumFractionDigits: 0, useGrouping: "always" } as Intl.NumberFormatOptions} suffix={el.dataset.formato === "usd0" ? " $" : ""} />);
  }
}

/** Ingresso delle card e delle righe, una volta sola. Con "riduci movimento" tutto resta fermo. */
function animaIngresso(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const el = document.querySelectorAll("main .card, main .tally, main .lista > .riga, main .alarm, main .note");
  if (!el.length) return;
  animate(el, { opacity: [0, 1], transform: ["translateY(10px)", "translateY(0)"] }, { duration: 0.42, delay: stagger(0.035, { startDelay: 0.04 }), ease: [0.2, 0.7, 0.2, 1] });
}

function avvia(): void {
  document.documentElement.dataset.js = "1";
  montaIsole();
  montaNumeri();
  animaIngresso();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
else avvia();
