import type { z } from "zod";
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
