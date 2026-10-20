import { z } from "zod";
import { readBrief } from "../../brief/sections";
import type * as Api from "../../shared/api";
import { HttpError, type Route } from "../http";
import { parse } from "./parse";

// The daily briefs (FR-023), the newest first.

const list: Route = {
  method: "GET",
  path: "/api/briefs",
  handler: ({ app }) => {
    const rows = app.db
      .query<{ date: string; generated_at: number; narrative_state: Api.NarrativeState; verdicts: string }, []>(
        "SELECT date, generated_at, narrative_state, json_extract(sections_json, '$.verdicts') AS verdicts FROM briefs ORDER BY date DESC",
      )
      .all();
    const body: Api.BriefList = { items: rows.map((r) => ({ ...r, verdicts: JSON.parse(r.verdicts) as Api.BriefSections["verdicts"] })) };
    return Response.json(body);
  },
};

const date = z.string().regex(/^\d{4}-\d\d-\d\d$/, "a date, YYYY-MM-DD");

const one: Route = {
  method: "GET",
  path: "/api/briefs/:date",
  handler: ({ params, app }) => {
    const d = parse(date, params.date, "date");
    const brief = readBrief(app.db, d);
    if (brief === null) throw new HttpError(404, "not_found", `there is no brief for ${d}`);
    return Response.json(brief satisfies Api.Brief);
  },
};

export const BRIEF_ROUTES: Route[] = [list, one];
