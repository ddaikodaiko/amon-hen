import { z } from "zod";
import { coverageAround, SAMPLE_MIN } from "../../coverage/compute";
import { defineTool, latInput, lonInput, round, ToolError } from "./tool";

const pct = (r: number | null) => (r === null ? "n/a" : `${Math.round(r * 100)}%`);

export const getCoverage = defineTool({
  name: "get_coverage",
  description:
    "How well the receivers hear vessels in the ~2.5 km grid cell around a point at one UTC hour of the day, " +
    "over the last 7 days: the share of expected vessel-minutes (vessels under way, above 3 knots) that " +
    `arrived, and the same for the cells around it. Fewer than ${SAMPLE_MIN} expected minutes is too small a ` +
    "sample. The vessel under investigation is left out, so its own gap does not count.",
  input: z.object({ lat: latInput, lon: lonInput, hour_utc: z.number().int().min(0).max(23) }),
  run({ lat, lon, hour_utc }, { db, mmsi }) {
    const around = coverageAround(db, lat, lon, hour_utc, { excludeMmsi: mmsi });
    if (around === null) throw new ToolError("the point is outside the region");
    const { cell, neighbors } = around;
    const nExpected = neighbors.reduce((s, c) => s + c.expected_min, 0);
    const nReceived = neighbors.reduce((s, c) => s + c.received_min, 0);
    const nRatio = nExpected > 0 ? nReceived / nExpected : null;
    const data = {
      cell_id: cell.cell_id,
      hour_utc,
      ratio: cell.ratio === null ? null : round(cell.ratio, 3),
      expected_min: cell.expected_min,
      sample_ok: cell.sample_ok,
      neighbors_avg_ratio: nRatio === null ? null : round(nRatio, 3),
      neighbors_expected_min: nExpected,
      neighbors_sample_ok: nExpected >= SAMPLE_MIN,
    };
    const here =
      cell.expected_min === 0
        ? `no vessel under way crossed this cell at ${hour_utc} UTC in the last 7 days`
        : `${pct(cell.ratio)} of ${cell.expected_min} expected vessel-minutes arrived in this cell at ${hour_utc} UTC` +
          (cell.sample_ok ? "" : " (too small a sample)");
    const near =
      nExpected === 0
        ? "nor around it"
        : `the cells around it: ${pct(nRatio)} of ${nExpected}` + (data.neighbors_sample_ok ? "" : " (too small a sample)");
    return { summary: `Coverage: ${here}; ${near}.`, data };
  },
});
