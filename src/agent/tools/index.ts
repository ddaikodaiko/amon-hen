import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getCoverage } from "./get_coverage";
import { getIngestHealth } from "./get_ingest_health";
import { getNearby } from "./get_nearby";
import { getTrack } from "./get_track";
import { getVessel } from "./get_vessel";
import { submitVerdict } from "./submit_verdict";
import { type AgentTool, type Investigation, ToolError } from "./tool";

// The tools the model can call, by name. Each input is checked with its zod schema; the JSON
// schema the model sees comes from the same zod schema.

export const TOOLS: readonly AgentTool[] = [getTrack, getVessel, getCoverage, getNearby, getIngestHealth, submitVerdict];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// Strict tool use does not take these; zod still checks them here (shared/tool-use-concepts.md).
const NOT_IN_STRICT = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "default",
]);

type Json = Record<string, unknown>;

function clean(node: unknown, strict: boolean): unknown {
  if (Array.isArray(node)) return node.map((n) => clean(n, strict));
  if (typeof node !== "object" || node === null) return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema" || (strict && NOT_IN_STRICT.has(k))) continue;
    // zod writes the safe-integer range on every int; it says nothing to the model.
    if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
    out[k] = clean(v, strict);
  }
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/** `strict: true` only for the Anthropic profiles; Ollama gets the full schema without it. */
export function toolDefinitions(opts: { strict: boolean }): Anthropic.Tool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: clean(z.toJSONSchema(t.input, { io: "input" }), opts.strict) as Anthropic.Tool.InputSchema,
    ...(opts.strict ? { strict: true } : {}),
  }));
}

export type ToolResult = { isError: false; summary: string; data: unknown } | { isError: true; summary: string };

/** Runs a tool call from the model. Bad input, an unknown tool or a ToolError come back as is_error, with the reason. */
export async function runTool(name: string, input: unknown, ctx: Investigation): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (tool === undefined) return { isError: true, summary: `unknown tool ${name}; the tools are ${[...BY_NAME.keys()].join(", ")}` };
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return { isError: true, summary: `invalid input for ${name}: ${z.prettifyError(parsed.error)}` };
  try {
    return { isError: false, ...(await tool.run(parsed.data, ctx)) };
  } catch (err) {
    if (err instanceof ToolError) return { isError: true, summary: err.message };
    throw err;
  }
}
