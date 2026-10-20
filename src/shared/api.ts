// Shapes of the HTTP API (contracts/http-api.md), shared by the server and the panel. No imports:
// the panel type-checks this file too. Times are UTC milliseconds; costs are USD.

export type CandidateState =
  | "detected"
  | "discarded"
  | "pending"
  | "investigating"
  | "investigated"
  | "error"
  | "pending_no_model"
  | "pending_budget";
export type VerdictValue = "coverage_gap" | "likely_dark" | "inconclusive";
export type Confidence = "high" | "medium" | "low";
export type ProfileName = "local" | "haiku" | "sonnet";
export type DiscardReason = "own_outage" | "left_region" | "berth";
export type StepKind = "model_call" | "tool_call" | "nudge" | "error";

export interface Point {
  lat: number;
  lon: number;
}

export interface CandidateSummary {
  id: number;
  mmsi: number;
  name: string | null;
  ais_class: "A" | "B";
  gap_start: number;
  /** Null while the vessel is still silent. */
  gap_end: number | null;
  duration_min: number | null;
  start: Point;
  end: Point | null;
  state: CandidateState;
  discard_reason: DiscardReason | null;
  trigger_at: number | null;
  /** The newest dossier, if there is one. */
  dossier: {
    version: number;
    verdict: VerdictValue;
    confidence: Confidence;
    profile: ProfileName;
    escalated: boolean;
    cost_usd: number;
  } | null;
}

export interface CandidateList {
  items: CandidateSummary[];
  total: number;
  page: number;
  page_size: number;
}

/** What a vessel says about itself in its AIS static data, and its flag from the MMSI. */
export interface VesselInfo {
  name: string | null;
  flag: string | null;
  type_label: string | null;
  ais_class: "A" | "B";
  callsign: string | null;
  imo: number | null;
  length_m: number | null;
  destination: string | null;
}

export interface TraceStep {
  idx: number;
  kind: StepKind;
  tool: string | null;
  /** JSON as the tool or model received it. */
  input_json: string;
  output_summary: string;
  /** JSON of the tool's result, cut at 32 KB; null for model calls, nudges and errors. */
  output_json: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  ts: number;
}

export interface Evidence {
  step: number;
  claim: string;
}

export interface Dossier {
  id: number;
  version: number;
  verdict: VerdictValue;
  confidence: Confidence;
  explanation: string;
  profile: ProfileName;
  escalated: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  agent_version: string;
  created_at: number;
  evidence: Evidence[];
  steps: TraceStep[];
}

export interface CandidateDetail {
  candidate: CandidateSummary & { nav_status_start: number | null; created_at: number; vessel: VesselInfo };
  /** Oldest version first. */
  dossiers: Dossier[];
}

export interface Reinvestigation {
  queued: true;
  profile: ProfileName;
  /** 1 means next. */
  position: number;
}

export interface Meta {
  mode: "live" | "replay" | "public";
  /** The default model; `available` is null where nobody checks it (replay, public) or before the first check. */
  model: { profile: ProfileName; available: boolean | null; reason: string | null };
  /** Live only: whether ANTHROPIC_API_KEY is set, so the paid profiles can be asked for. */
  paid_ready: boolean;
  budget: { month: string; spent_usd: number; cap_usd: number };
  notice: string;
  attribution: string;
}

export interface ApiError {
  error: { code: string; message: string };
}

// GET /api/stream (SSE). In replay each viewer has their own clock: `?at=<ms>&speed=1|10|60|300`;
// to change speed the panel reconnects at the time it is showing.

/** [mmsi, lat, lon, sog, cog] */
export type VesselTick = [number, number, number, number | null, number | null];

export interface StreamEvents {
  /** First event of a connection. `range` and `speed` only in replay. */
  hello: { mode: Meta["mode"]; t: number; range: { start: number; end: number } | null; speed: number | null };
  /** Every second: the last position of each vessel heard from in the last 10 minutes. */
  positions: { t: number; vessels: VesselTick[] };
  /** A gap the detector flagged, where the vessel went silent. */
  candidate: { id: number; mmsi: number; lat: number; lon: number; gap_start: number };
  /** The verdict of a case: its newest dossier. */
  dossier: { candidate_id: number; version: number; verdict: VerdictValue; confidence: Confidence };
  /** Each closed ingest minute. */
  health: { minute: number; connected: boolean; msg_count: number };
  /** The replay went back to the start: drop the marks drawn so far. */
  reset: { t: number };
}

/** GET /api/coverage?hour= */
export interface CoverageLayer {
  hour: number;
  /** The 7 days the ratios come from; null before the first computation. */
  window: { start: number; end: number } | null;
  cell_deg: number;
  /** Cells with fewer expected minutes than this are too thin to judge. */
  sample_min: number;
  /** [lat_min, lon_min, ratio, expected_min]: the south-west corner of each cell with traffic. */
  cells: [number, number, number, number][];
}

/** [ts, lat, lon] */
export type TrackPoint = [number, number, number];

/** GET /api/vessels/:mmsi?at=&hours= */
export interface VesselDetail extends VesselInfo {
  mmsi: number;
  /** The positions of the `hours` before `at`, oldest first. */
  track: TrackPoint[];
}
