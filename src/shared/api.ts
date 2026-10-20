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

export type LabelValue = "coverage_gap" | "likely_dark" | "undeterminable";

/** A proportion with its 95 % Wilson interval. */
export interface Interval {
  p: number;
  low: number;
  high: number;
}

/** Where the labelled sample stands against the stopping rule (FR-021). */
export interface StoppingState {
  met: boolean;
  /** `rare_positives`: 300 cases without 15 likely_dark; published, saying so. */
  status: "enough" | "rare_positives" | "insufficient";
  missing_cases: number;
  missing_positives: number;
}

export interface LabelProgress {
  labeled: number;
  positives: number;
  undeterminable: number;
  /** Cases waiting for a label. */
  remaining: number;
  stopping: StoppingState;
}

/** The case to label: the gap, the vessel and its track, and nothing the agent said, not even the state. */
export interface LabelCase {
  id: number;
  mmsi: number;
  gap_start: number;
  gap_end: number | null;
  duration_min: number | null;
  start: Point;
  end: Point | null;
  nav_status_start: number | null;
  vessel: VesselInfo;
  /** From 3 h before the gap to 2 h after it ends, oldest first. */
  track: TrackPoint[];
}

/** GET /api/label/next */
export interface LabelNext {
  /** Null when every case is labelled. */
  case: LabelCase | null;
  progress: LabelProgress;
}

/** POST /api/labels → 201 */
export interface LabelSaved {
  label: { candidate_id: number; value: LabelValue; note: string | null; author: string; created_at: number };
  /** The agent's newest dossier, now that it can be shown; null if the case was not investigated. */
  dossier: { version: number; verdict: VerdictValue; confidence: Confidence; explanation: string; profile: ProfileName } | null;
  progress: LabelProgress;
}

/** likely_dark against the rest, without the cases labelled undeterminable. */
export interface EvalScores {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** Of the cases called likely_dark, how many were; null if none was called so. */
  precision: Interval | null;
  /** Of the likely_dark cases, how many were called so; null if there were none. */
  recall: Interval | null;
  undeterminable: number;
}

export interface CostSummary {
  /** Over the dossiers the report used. */
  mean_usd_per_case: number | null;
  by_profile: Partial<Record<ProfileName, { cases: number; mean_usd: number }>>;
}

export interface EvalMetrics {
  /** Over the labelled cases with a dossier. */
  agent: EvalScores;
  /** The 60-minute rule, over every labelled case. */
  naive: EvalScores;
  cost: CostSummary;
  stopping: StoppingState;
  /** Labelled cases the agent has no dossier for (or none of the profile asked for). */
  not_investigated: number;
  /** Gaps the detector threw out over the labelled period, by reason: they are not in the sample. */
  discarded: Record<DiscardReason, number>;
}

export interface EvalReport {
  id: number;
  created_at: number;
  /** Several, comma-separated, when the dossiers come from different versions. */
  agent_version: string;
  /** The profile the eval ran; null when it took each case's newest dossier. */
  profile: ProfileName | null;
  n_labeled: number;
  n_positive: number;
  n_undeterminable: number;
  stopping_rule_met: boolean;
  metrics: EvalMetrics;
}

/** GET /api/eval/reports */
export interface EvalReports {
  /** The newest first. */
  items: EvalReport[];
}
