// Statistiche dei risultati (§7.3): in R, in % e in $. Reali e ombra sempre separati.

export interface Risultato {
  id: string;
  data: string;
  R: number | null;
  pct: number | null;
  usd: number | null;
  spy: number | null;
  durata: number | null;
  gruppi: Record<string, string>;
}

export interface Statistiche {
  n: number;
  nConR: number;
  vincenti: number;
  quotaVincenti: number | null;
  guadagnoMedioPct: number | null;
  perditaMediaPct: number | null;
  attesaR: number | null;
  fattoreProfitto: number | null;
  maxDrawdownPct: number | null;
  rendimentoMedioPct: number | null;
  spyMedioPct: number | null;
  totaleUsd: number | null;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function statistiche(rs: Risultato[]): Statistiche {
  const pcts = rs.map((r) => r.pct).filter((x): x is number => x !== null);
  const Rs = rs.map((r) => r.R).filter((x): x is number => x !== null);
  const win = pcts.filter((x) => x > 0);
  const loss = pcts.filter((x) => x <= 0);
  const gp = win.reduce((a, b) => a + b, 0);
  const gl = -loss.reduce((a, b) => a + b, 0);
  // drawdown sulla curva composta delle operazioni in ordine di uscita (a peso uguale)
  let eq = 1, peak = 1, dd = 0;
  for (const r of [...rs].sort((a, b) => (a.data < b.data ? -1 : 1))) {
    if (r.pct === null) continue;
    eq *= 1 + r.pct;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq / peak - 1);
  }
  const usd = rs.map((r) => r.usd).filter((x): x is number => x !== null);
  return {
    n: rs.length,
    nConR: Rs.length,
    vincenti: win.length,
    quotaVincenti: pcts.length ? win.length / pcts.length : null,
    guadagnoMedioPct: mean(win),
    perditaMediaPct: mean(loss),
    attesaR: mean(Rs),
    fattoreProfitto: gl > 0 ? gp / gl : gp > 0 ? Infinity : null,
    maxDrawdownPct: pcts.length ? dd : null,
    rendimentoMedioPct: mean(pcts),
    spyMedioPct: mean(rs.map((r) => r.spy).filter((x): x is number => x !== null)),
    totaleUsd: usd.length ? usd.reduce((a, b) => a + b, 0) : null,
  };
}

export function perGruppo(rs: Risultato[], chiave: string): Record<string, Statistiche> {
  const m = new Map<string, Risultato[]>();
  for (const r of rs) {
    const k = r.gruppi[chiave] ?? "n/d";
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return Object.fromEntries([...m].sort().map(([k, v]) => [k, statistiche(v)]));
}

export function fasciaAdx(adx: number | null | undefined): string {
  if (adx == null) return "n/d";
  if (adx < 20) return "< 20";
  if (adx < 25) return "20–25";
  if (adx < 30) return "25–30";
  if (adx < 40) return "30–40";
  return "≥ 40";
}

export function fasciaDurata(d: number | null): string {
  if (d == null) return "n/d";
  if (d <= 5) return "≤ 5 sedute";
  if (d <= 20) return "6–20 sedute";
  if (d <= 60) return "21–60 sedute";
  return "> 60 sedute";
}
