import { error } from "@sveltejs/kit";
import { ApiError, api } from "#lib/api.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) error(404, "No such case");
  try {
    const [detail, meta] = await Promise.all([api.candidate(id, fetch), api.meta(fetch)]);
    return { detail, meta };
  } catch (err) {
    if (err instanceof ApiError) error(err.status, err.message);
    throw err;
  }
};
