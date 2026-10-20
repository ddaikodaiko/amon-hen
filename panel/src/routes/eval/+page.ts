import { error } from "@sveltejs/kit";
import { ApiError, api } from "#lib/api.ts";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
  try {
    return { reports: (await api.evalReports(fetch)).items };
  } catch (err) {
    if (err instanceof ApiError) error(err.status, err.message);
    throw err;
  }
};
