import { error } from "@sveltejs/kit";
import { ApiError, api } from "#lib/api.ts";
import type { PageLoad } from "./$types";

/** The spans offered, in hours; 24 by default. The underscore lets a route module export it. */
export const _SPANS = [6, 24, 168] as const;

export const load: PageLoad = async ({ fetch, url }) => {
  const hours = _SPANS.find((h) => String(h) === url.searchParams.get("hours")) ?? 24;
  try {
    const meta = await api.meta(fetch);
    // First the default day, to learn up to where the ingest has closed; then the span asked for.
    const latest = await api.health({}, fetch);
    const to = latest.closed_until ?? latest.to;
    const health = hours === 24 ? latest : await api.health({ from: to - hours * 3_600_000, to }, fetch);
    return { meta, health, hours };
  } catch (err) {
    if (err instanceof ApiError) error(err.status, err.message);
    throw err;
  }
};
