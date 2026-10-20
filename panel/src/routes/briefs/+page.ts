import { error } from "@sveltejs/kit";
import { ApiError, api } from "#lib/api.ts";
import type { PageLoad } from "./$types";

// The list, and the brief of ?date= (the newest without it).
export const load: PageLoad = async ({ fetch, url }) => {
  try {
    const list = await api.briefs(fetch);
    const date = url.searchParams.get("date") ?? list.items[0]?.date;
    const brief = date === undefined ? null : await api.brief(date, fetch);
    return { list: list.items, brief };
  } catch (err) {
    if (err instanceof ApiError) error(err.status, err.message);
    throw err;
  }
};
