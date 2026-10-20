import { error } from "@sveltejs/kit";
import { ApiError, api, type CandidateFilters, type CandidateState, type VerdictValue } from "#lib/api.ts";
import { STATE_LABEL, VERDICT_LABEL } from "#lib/format.ts";
import type { PageLoad } from "./$types";

const DAY = /^\d{4}-\d\d-\d\d$/;

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
    return { filters, list: await api.candidates(filters, fetch) };
  } catch (err) {
    if (err instanceof ApiError) error(err.status, err.message);
    throw err;
  }
};
