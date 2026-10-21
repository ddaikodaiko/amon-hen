import { error } from "@sveltejs/kit";
import { ApiError, api, type CandidateFilters, type CandidateState, type VerdictValue } from "#lib/api.ts";
import { STATE_LABEL, VERDICT_LABEL } from "#lib/format.ts";
import type { PageLoad } from "./$types";

const DAY = /^\d{4}-\d\d-\d\d$/;

/**
 * The quick filters over the list, and how many alerts each one holds in the chosen dates. The
 * underscore: a route module may export only SvelteKit's own names and those that start with one.
 */
export const _PRESETS: { key: string; label: string; filters: Pick<CandidateFilters, "state" | "verdict"> }[] = [
  { key: "all", label: "All", filters: {} },
  { key: "dark", label: "Suspicious", filters: { verdict: "likely_dark" } },
  { key: "unclear", label: "Unclear", filters: { verdict: "inconclusive" } },
  { key: "range", label: "Out of range", filters: { verdict: "coverage_gap" } },
  { key: "waiting", label: "Awaiting AI", filters: { state: ["pending", "pending_no_model", "pending_budget", "investigating", "error"] } },
  { key: "ignored", label: "Ignored", filters: { state: ["discarded"] } },
];

/** The filters in the URL; anything the API would refuse is left out. */
function filtersFrom(q: URLSearchParams): CandidateFilters {
  const states = (q.get("state") ?? "").split(",").filter((s): s is CandidateState => s in STATE_LABEL);
  const verdict = q.get("verdict");
  const page = Number(q.get("page") ?? "1");
  const day = (k: string) => (DAY.test(q.get(k) ?? "") ? q.get(k)! : undefined);
  return {
    state: states.length > 0 ? states : undefined,
    verdict: verdict !== null && verdict in VERDICT_LABEL ? (verdict as VerdictValue) : undefined,
    from: day("from"),
    to: day("to"),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export const load: PageLoad = async ({ url, fetch }) => {
  const filters = filtersFrom(url.searchParams);
  try {
    const dates = { from: filters.from, to: filters.to };
    const [list, ...totals] = await Promise.all([
      api.candidates(filters, fetch),
      ..._PRESETS.map((p) => api.candidates({ ...dates, ...p.filters }, fetch).then((l) => l.total)),
    ]);
    return { filters, list, counts: Object.fromEntries(_PRESETS.map((p, i) => [p.key, totals[i]!])) };
  } catch (err) {
    if (err instanceof ApiError) error(err.status, err.message);
    throw err;
  }
};
