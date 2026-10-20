import { z } from "zod";
import type { Database } from "../../db";

// What every agent tool looks like (contracts/agent-tools.md). Names, descriptions and outputs
// are in English (FR-030); inputs are checked with zod before anything runs.

export interface Investigation {
  db: Database;
  /** The vessel under investigation: its own minutes are left out of coverage (R6). */
  mmsi: number;
  /** Trace steps a verdict may cite: the tool results that succeeded so far. */
  citable: ReadonlySet<number>;
}

export interface ToolOutput {
  /** One sentence, as an analyst would say it: what the panel shows for this step. */
  summary: string;
  /** What the model gets back. */
  data: unknown;
}

export interface AgentTool<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(input: z.output<S>, ctx: Investigation): ToolOutput | Promise<ToolOutput>;
}

/** Thrown by a tool when the input has the right shape but cannot be answered; the model sees the message. */
export class ToolError extends Error {}

export const defineTool = <S extends z.ZodType>(tool: AgentTool<S>): AgentTool<S> => tool;

// Inputs shared by several tools.
export const mmsiInput = z.number().int().min(100_000_000).max(999_999_999).describe("9-digit MMSI");
export const latInput = z.number().min(-90).max(90);
export const lonInput = z.number().min(-180).max(180);
/**
 * ISO 8601 date-time → ms. Without an offset it is taken as UTC, not local time: local models
 * often leave the Z out. (z.iso.datetime would put a long regex in every schema the model sees.)
 */
export const instantInput = z
  .string()
  .meta({ format: "date-time", description: "ISO 8601 date-time, UTC" })
  .transform((s, ctx) => {
    const t = /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s) ? Date.parse(/(z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`) : Number.NaN;
    if (Number.isNaN(t)) {
      ctx.addIssue({ code: "custom", message: "expected an ISO 8601 date-time such as 2026-10-19T17:20:00Z" });
      return z.NEVER;
    }
    return t;
  });

export const iso = (ts: number) => new Date(ts).toISOString().replace(/\.000Z$/, "Z");
/** HH:MM UTC, for summaries. */
export const hhmm = (ts: number) => new Date(ts).toISOString().slice(11, 16);
export const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
