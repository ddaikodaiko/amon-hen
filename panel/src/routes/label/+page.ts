import { error } from "@sveltejs/kit";
import { ApiError, api } from "#lib/api.ts";
import type { PageLoad } from "./$types";

// Only /api/label/next: the case without anything the agent said (FR-018).
export const load: PageLoad = async ({ fetch }) => {
  try {
    const [next, meta] = await Promise.all([api.labelNext(fetch), api.meta(fetch)]);
    return { next, meta };
  } catch (err) {
    if (err instanceof ApiError) error(err.status, err.message);
    throw err;
  }
};
