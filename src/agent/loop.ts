import Anthropic from "@anthropic-ai/sdk";
import type { Profile } from "../config";
import type { Database } from "../db";
import { canSpend, costUsd, estimateTokens, record, worstCaseUsd } from "./budget";
import type { ModelClient, ModelParams } from "./model";
import { runTool, toolDefinitions } from "./tools";
import type { Verdict } from "./tools/submit_verdict";

// The manual tool loop (R3): call the model, run the tools it asks for, append the whole
// response.content without editing the history, and repeat until submit_verdict. Every model
// call and every tool call is a trace step, with its tokens, cost and duration (principle II).

export const LIMITS = {
  tools: 10,
  nudges: 1,
  /** Retries after an invalid verdict: three invalid ones end the investigation. */
  verdictRetries: 2,
  maxTokens: 16_000,
} as const;

const MAX_OUTPUT_JSON = 32 * 1024;

export type StepKind = "model_call" | "tool_call" | "nudge" | "error";

export interface TraceStep {
  idx: number;
  kind: StepKind;
  tool: string | null;
  input_json: string;
  output_summary: string;
  output_json: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  ts: number;
}

export type LoopEnd =
  | { kind: "verdict"; verdict: Verdict }
  /** The model did not produce a valid verdict within the limits. */
  | { kind: "failed"; reason: string }
  /** The next call could go over the monthly cap. */
  | { kind: "budget" }
  /** The model cannot be reached. */
  | { kind: "no_model"; reason: string };

export interface LoopConfig {
  db: Database;
  client: ModelClient;
  profile: Profile;
  capUsd: number;
  system: string;
  /** The first user message: the gap to investigate. */
  briefing: string;
  /** The vessel under investigation. */
  mmsi: number;
  /** Index of the first step, when this run continues a trace (escalation). */
  firstIdx?: number;
  now?: () => number;
}

const NUDGE =
  "You ended your turn without calling submit_verdict. Every investigation ends with submit_verdict, citing " +
  "as evidence the step numbers of the tool results you received.";
const TOOL_LIMIT = `You have used the ${LIMITS.tools} tool calls of this investigation. Call submit_verdict now with the evidence you have.`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function describeReply(content: Anthropic.ContentBlock[]): string {
  const text = content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text.trim())
    .filter((t) => t !== "")
    .join(" ");
  const calls = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use").map((b) => b.name);
  const asks = calls.length > 0 ? `Calls ${calls.join(", ")}.` : "";
  return [clip(text, 280), asks].filter((s) => s !== "").join(" ") || "Empty reply.";
}

/** A dropped connection or a server error means "no model now"; the case waits for it to come back. */
export function unreachable(err: unknown): string | null {
  if (err instanceof Anthropic.APIConnectionError) return err.message;
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return `HTTP ${err.status}: ${err.message}`;
  return null;
}

export async function runLoop(cfg: LoopConfig): Promise<{ end: LoopEnd; steps: TraceStep[] }> {
  const now = cfg.now ?? Date.now;
  const steps: TraceStep[] = [];
  const citable = new Set<number>();
  const tools = toolDefinitions({ strict: cfg.client.strictTools });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: cfg.briefing }];
  let toolCalls = 0;
  let nudges = 0;
  let badVerdicts = 0;
  let overLimit = false;

  const push = (s: Omit<TraceStep, "idx" | "ts" | "model" | "input_tokens" | "output_tokens" | "cost_usd"> & Partial<TraceStep>) => {
    const step: TraceStep = { model: null, input_tokens: 0, output_tokens: 0, cost_usd: 0, ts: now(), ...s, idx: (cfg.firstIdx ?? 0) + steps.length };
    steps.push(step);
    return step.idx;
  };

  for (;;) {
    const params: ModelParams = {
      system: cfg.system,
      tools,
      tool_choice: { type: "auto" },
      max_tokens: LIMITS.maxTokens,
      messages,
    };
    const worst = worstCaseUsd(cfg.profile, estimateTokens(JSON.stringify(params)), LIMITS.maxTokens);
    if (!canSpend(cfg.db, cfg.profile, worst, cfg.capUsd, now())) return { end: { kind: "budget" }, steps };

    const t0 = performance.now();
    let response: Anthropic.Message;
    try {
      response = await cfg.client.create(params);
    } catch (err) {
      const reason = unreachable(err);
      if (reason !== null) return { end: { kind: "no_model", reason }, steps };
      if (err instanceof Anthropic.APIError) return { end: { kind: "failed", reason: `model error: ${err.message}` }, steps };
      throw err;
    }
    const cost = costUsd(response.usage, cfg.profile);
    record(cfg.db, cost, cfg.capUsd, now());
    push({
      kind: "model_call",
      tool: null,
      input_json: JSON.stringify({ messages: messages.length, max_tokens: LIMITS.maxTokens }),
      output_summary: describeReply(response.content),
      output_json: null,
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_usd: cost,
      duration_ms: Math.round(performance.now() - t0),
    });
    if (response.content.length > 0) messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") return { end: { kind: "failed", reason: "the model refused" }, steps };
    const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) {
      if (nudges >= LIMITS.nudges) return { end: { kind: "failed", reason: "ended without submit_verdict after the nudge" }, steps };
      nudges++;
      push({ kind: "nudge", tool: null, input_json: "{}", output_summary: NUDGE, output_json: null, duration_ms: 0 });
      messages.push({ role: "user", content: NUDGE });
      continue;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const input_json = JSON.stringify(use.input);
      if (use.name !== "submit_verdict" && ++toolCalls > LIMITS.tools) {
        if (overLimit) return { end: { kind: "failed", reason: `asked for more tools after the limit of ${LIMITS.tools}` }, steps };
        push({ kind: "error", tool: use.name, input_json, output_summary: TOOL_LIMIT, output_json: null, duration_ms: 0 });
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: TOOL_LIMIT });
        continue;
      }
      const t1 = performance.now();
      const r = await runTool(use.name, use.input, { db: cfg.db, mmsi: cfg.mmsi, citable });
      const duration_ms = Math.round(performance.now() - t1);
      if (r.isError) {
        const idx = push({ kind: "error", tool: use.name, input_json, output_summary: r.summary, output_json: null, duration_ms });
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: JSON.stringify({ step: idx, error: r.summary }) });
        if (use.name === "submit_verdict" && ++badVerdicts > LIMITS.verdictRetries) {
          return { end: { kind: "failed", reason: `the verdict did not validate ${badVerdicts} times` }, steps };
        }
        continue;
      }
      const output = clip(JSON.stringify(r.data), MAX_OUTPUT_JSON);
      const idx = push({ kind: "tool_call", tool: use.name, input_json, output_summary: r.summary, output_json: output, duration_ms });
      if (use.name === "submit_verdict") return { end: { kind: "verdict", verdict: r.data as Verdict }, steps };
      citable.add(idx);
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ step: idx, summary: r.summary, data: r.data }) });
    }
    if (toolCalls > LIMITS.tools) overLimit = true;
    messages.push({ role: "user", content: results });
  }
}
