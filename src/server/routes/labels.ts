import { userInfo } from "node:os";
import { z } from "zod";
import type { Database } from "../../db";
import { LABEL_VALUES, LABELABLE, labelProgress, nextToLabel } from "../../eval/labels";
import { listReports } from "../../eval/report";
import type * as Api from "../../shared/api";
import { CASE_TRACK, caseContext } from "../case-context";
import { HttpError, readJson, type Route } from "../http";
import { vesselInfo } from "./map";
import { parse } from "./parse";

// Blind labelling (FR-018): the case comes without anything the agent said, and the verdict is
// only given back once the label is saved.

/** How much of the track the labelling view shows around the gap. */
export const LABEL_TRACK = CASE_TRACK;

interface CaseRow {
  id: number;
  mmsi: number;
  gap_start: number;
  gap_end: number | null;
  start_lat: number;
  start_lon: number;
  end_lat: number | null;
  end_lon: number | null;
  nav_status_start: number | null;
}

async function labelCase(db: Database, id: number): Promise<Api.LabelCase> {
  const c = db
    .query<CaseRow, [number]>(
      "SELECT id, mmsi, gap_start, gap_end, start_lat, start_lon, end_lat, end_lon, nav_status_start FROM candidates WHERE id = ?",
    )
    .get(id)!;
  const context = await caseContext(db, id);
  return {
    id: c.id,
    mmsi: c.mmsi,
    gap_start: c.gap_start,
    gap_end: c.gap_end,
    duration_min: c.gap_end === null ? null : Math.round((c.gap_end - c.gap_start) / 60_000),
    start: { lat: c.start_lat, lon: c.start_lon },
    end: c.end_lat === null || c.end_lon === null ? null : { lat: c.end_lat, lon: c.end_lon },
    nav_status_start: c.nav_status_start,
    vessel: vesselInfo(db, c.mmsi)!,
    track: context.track,
    context,
  };
}

const next: Route = {
  method: "GET",
  path: "/api/label/next",
  handler: async ({ app }) => {
    const id = nextToLabel(app.db);
    const body: Api.LabelNext = { case: id === null ? null : await labelCase(app.db, id), progress: labelProgress(app.db) };
    return Response.json(body);
  },
};

const LabelBody = z
  .object({
    candidate_id: z.number().int().positive(),
    value: z.enum(LABEL_VALUES),
    note: z
      .string()
      .trim()
      .max(500)
      .transform((s) => (s === "" ? null : s))
      .nullable()
      .default(null),
  })
  .strict();

const save: Route = {
  method: "POST",
  path: "/api/labels",
  write: true,
  handler: async ({ req, app }) => {
    const body = parse(LabelBody, await readJson(req), "body");
    const db = app.db;
    const c = db.query<{ state: string }, [number]>("SELECT state FROM candidates WHERE id = ?").get(body.candidate_id);
    if (c === null) throw new HttpError(404, "not_found", `candidate ${body.candidate_id} does not exist`);
    const labelable = db.query(`SELECT 1 FROM candidates c WHERE c.id = ? AND ${LABELABLE}`).get(body.candidate_id) !== null;
    if (!labelable) throw new HttpError(409, "invalid_state", `a ${c.state} candidate is not in the sample`);
    // Once the verdict is shown, a second label would no longer be blind.
    if (db.query("SELECT 1 FROM labels WHERE candidate_id = ?").get(body.candidate_id) !== null) {
      throw new HttpError(409, "already_labeled", `candidate ${body.candidate_id} is labelled already`);
    }
    const label = { candidate_id: body.candidate_id, value: body.value, note: body.note, author: userInfo().username, created_at: Date.now() };
    db.query("INSERT INTO labels (candidate_id, value, note, author, created_at) VALUES (?, ?, ?, ?, ?)").run(
      label.candidate_id,
      label.value,
      label.note,
      label.author,
      label.created_at,
    );
    const dossier = db
      .query<NonNullable<Api.LabelSaved["dossier"]>, [number]>(
        "SELECT version, verdict, confidence, explanation, profile FROM dossiers WHERE candidate_id = ? ORDER BY version DESC LIMIT 1",
      )
      .get(body.candidate_id);
    const out: Api.LabelSaved = { label, dossier, progress: labelProgress(db) };
    return Response.json(out, { status: 201 });
  },
};

const reports: Route = {
  method: "GET",
  path: "/api/eval/reports",
  handler: ({ app }) => {
    const body: Api.EvalReports = { items: listReports(app.db) };
    return Response.json(body);
  },
};

export const LABEL_ROUTES: Route[] = [next, save, reports];
