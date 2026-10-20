import type { ProfileName } from "../config";
import type { CostSummary, EvalScores, LabelValue } from "../shared/api";
import { wilson } from "./wilson";

// likely_dark against the rest (R12). Cases labelled undeterminable are left out of the matrix
// and counted apart.

export interface Judged {
  label: LabelValue;
  /** What the agent or the rule said: likely_dark or not. */
  dark: boolean;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export function confusion(cases: Judged[]): Confusion {
  const m = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const c of cases) {
    if (c.label === "undeterminable") continue;
    const truth = c.label === "likely_dark";
    if (c.dark && truth) m.tp++;
    else if (c.dark) m.fp++;
    else if (truth) m.fn++;
    else m.tn++;
  }
  return m;
}

export function scores(cases: Judged[]): EvalScores {
  const m = confusion(cases);
  return {
    ...m,
    precision: wilson(m.tp, m.tp + m.fp),
    recall: wilson(m.tp, m.tp + m.fn),
    undeterminable: cases.filter((c) => c.label === "undeterminable").length,
  };
}

export function costs(dossiers: { profile: ProfileName; cost_usd: number }[]): CostSummary {
  const by: CostSummary["by_profile"] = {};
  for (const d of dossiers) {
    const p = (by[d.profile] ??= { cases: 0, mean_usd: 0 });
    p.mean_usd += (d.cost_usd - p.mean_usd) / ++p.cases;
  }
  const total = dossiers.reduce((s, d) => s + d.cost_usd, 0);
  return { mean_usd_per_case: dossiers.length === 0 ? null : total / dossiers.length, by_profile: by };
}
