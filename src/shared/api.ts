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

export interface VesselInfo {
  name: string | null;
  flag: string | null;
  type_label: string | null;
  callsign: string | null;
  imo: number | null;
  length_m: number | null;
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
  model: { profile: ProfileName; available: boolean | null };
  budget: { month: string; spent_usd: number; cap_usd: number };
  notice: string;
  attribution: string;
}

export interface ApiError {
  error: { code: string; message: string };
}
