import Anthropic from "@anthropic-ai/sdk";
import type { Profile, ProfileName } from "../config";

// The model behind the agent (R1): one code path for Ollama's /v1/messages and the Anthropic
// API, on client.messages.create (not the beta). FakeClient plays a script, for the tests.

/** What the loop sends: everything but the model, which the client knows. */
export type ModelParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "model">;

export interface ModelClient {
  readonly profile: ProfileName;
  readonly model: string;
  /** Anthropic profiles take `strict: true` tools; Ollama does not. */
  readonly strictTools: boolean;
  /** Null when the model can be reached, or why not. Quick: a PC that is off must not hang the queue. */
  unavailable(): Promise<string | null>;
  create(params: ModelParams): Promise<Anthropic.Message>;
}

const PROBE_MS = 3_000;

export class AnthropicClient implements ModelClient {
  readonly profile: ProfileName;
  readonly model: string;
  readonly strictTools: boolean;
  private readonly client: Anthropic;

  constructor(private readonly p: Profile) {
    this.profile = p.name;
    this.model = p.model;
    this.strictTools = p.paid;
    this.client = new Anthropic({
      baseURL: p.baseURL,
      apiKey: p.apiKey,
      // Ollama takes ~2 min to load the model cold (R1); the API answers well within this.
      timeout: 300_000,
      maxRetries: p.paid ? 2 : 1,
    });
  }

  async unavailable(): Promise<string | null> {
    // The API is assumed up; its errors still end as "no model". Ollama is a PC that may be off,
    // and over Tailscale a request to it hangs instead of failing.
    if (this.p.paid) return null;
    try {
      const res = await fetch(new URL("/api/version", this.p.baseURL), { signal: AbortSignal.timeout(PROBE_MS) });
      return res.ok ? null : `Ollama answered HTTP ${res.status}`;
    } catch {
      return `Ollama at ${this.p.baseURL} did not answer in ${PROBE_MS / 1000} s`;
    }
  }

  async create(params: ModelParams): Promise<Anthropic.Message> {
    // Ollama only takes thinking enabled or disabled, and an 8B model thinking out loud fills its
    // context; the 5.5 models think adaptively when `thinking` is left out.
    const thinking: Pick<Anthropic.MessageCreateParamsNonStreaming, "thinking"> = this.p.paid
      ? {}
      : { thinking: { type: "disabled" } };
    const m = await this.client.messages.create({ ...thinking, ...params, model: this.model });
    // Ollama sometimes answers with no content at all (qwen3:8b, 2026-10-20): the loop takes it
    // as a reply without a tool call, which gets the nudge.
    return m.content == null ? { ...m, content: [] } : m;
  }
}

/** A content block as a script writes it; FakeClient fills in what the SDK type also asks for. */
export type ScriptedBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

/** One scripted reply: the content and usage of a Message, or a dropped connection. */
export type ScriptedReply =
  | { content: ScriptedBlock[]; usage: { input_tokens: number; output_tokens: number }; stop_reason?: Anthropic.StopReason }
  | { error: "connection" };

const toBlock = (b: ScriptedBlock): Anthropic.ContentBlock =>
  b.type === "text" ? { ...b, citations: null } : { ...b, caller: { type: "direct" } };

export class FakeClient implements ModelClient {
  readonly model: string;
  readonly strictTools = false;
  /** Every request received, in order, for the tests to look at. */
  readonly calls: ModelParams[] = [];
  private next = 0;

  constructor(
    private readonly script: readonly ScriptedReply[],
    readonly profile: ProfileName = "local",
  ) {
    this.model = `fake-${profile}`;
  }

  /** Set it to make the model unreachable. */
  down: string | null = null;

  async unavailable(): Promise<string | null> {
    return this.down;
  }

  get remaining(): number {
    return this.script.length - this.next;
  }

  async create(params: ModelParams): Promise<Anthropic.Message> {
    this.calls.push(structuredClone(params));
    const reply = this.script[this.next++];
    if (reply === undefined) throw new Error(`FakeClient: the script has no reply for call ${this.next}`);
    if ("error" in reply) throw new Anthropic.APIConnectionError({ message: "scripted connection error" });
    return {
      id: `msg_fake_${this.next}`,
      type: "message",
      role: "assistant",
      model: this.model,
      content: reply.content.map(toBlock),
      stop_reason: reply.stop_reason ?? (reply.content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
      stop_sequence: null,
      stop_details: null,
      container: null,
      diagnostics: null,
      usage: {
        input_tokens: reply.usage.input_tokens,
        output_tokens: reply.usage.output_tokens,
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        inference_geo: null,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: null,
        speed: null,
      },
    };
  }
}
