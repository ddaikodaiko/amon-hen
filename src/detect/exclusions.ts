import { REGION, type Region } from "../config";
import { berthAt, headingOut, type Port } from "../geo/polygons";
import type { Fix } from "./gaps";

// Gaps that are not candidates (FR-006). Anchorages are not excluded: transfers and bunkering
// happen there (clarification 3).

export type DiscardReason = "own_outage" | "left_region" | "berth";

export interface Outage {
  start_ts: number;
  end_ts: number | null;
}

/** True if any outage of our own ingest overlaps the silence (from, to). */
export function overlapsOutage(outages: readonly Outage[], from: number, to: number): boolean {
  return outages.some((o) => o.start_ts < to && (o.end_ts === null || o.end_ts > from));
}

/** The reasons that depend only on where the silence began, so they are known at once. */
export function startExclusion(start: Fix, ports: Port[], region: Region = REGION): "left_region" | "berth" | null {
  if (headingOut(start.lat, start.lon, start.cog, region)) return "left_region";
  if (berthAt(start.lat, start.lon, ports) !== null) return "berth";
  return null;
}
