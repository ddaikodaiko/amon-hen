import { z } from "zod";
import regionJson from "../data/region.json";

export const MODES = ["live", "replay", "public"] as const;
export type Mode = (typeof MODES)[number];

export const PROFILE_NAMES = ["local", "haiku", "sonnet"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

export const PORT = 4250;

const RegionSchema = z.object({
  name: z.string(),
  lat_min: z.number(),
  lat_max: z.number(),
  lon_min: z.number(),
  lon_max: z.number(),
  border_margin_nm: z.number().positive(),
});
export type Region = z.infer<typeof RegionSchema>;
export const REGION: Region = RegionSchema.parse(regionJson);

const MIN = 60_000;

/** Detector, health and storage thresholds (spec Assumptions, R5, R8). */
export const THRESHOLDS = {
  gapClassAMs: 30 * MIN,
  gapClassBMs: 60 * MIN,
  naiveRuleMs: 60 * MIN,
  triggerMs: 6 * 60 * MIN,
  /** This many consecutive minutes without messages, or disconnected, are an own outage. */
  outageMinutes: 2,
  /** At most one stored position per vessel in this interval. */
  positionEveryMs: 30_000,
} as const;

export interface Profile {
  name: ProfileName;
  /** Undefined means the Anthropic API. */
  baseURL: string | undefined;
  apiKey: string | undefined;
  model: string;
  usdPerMTokIn: number;
  usdPerMTokOut: number;
  paid: boolean;
  /** The model's context in tokens: a conversation never grows past it (src/agent/loop.ts). */
  contextTokens: number;
}

export interface Config {
  mode: Mode | undefined;
  dbPath: string;
  briefHour: number;
  budgetUsd: number;
  escalateProfile: ProfileName | "none";
  gfwToken: string | undefined;
  profiles: Record<ProfileName, Profile>;
}

// `VAR=` in .env arrives as "", which means "not set".
const blank = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  GFW_TOKEN: z.preprocess(blank, z.string().optional()),
  ANTHROPIC_API_KEY: z.preprocess(blank, z.string().optional()),
  VIGIA_LOCAL_URL: z.preprocess(blank, z.url().default("http://pc-casa:11434")),
  VIGIA_LOCAL_MODEL: z.preprocess(blank, z.string().default("qwen3:8b")),
  // Ollama's own default; raise both together (OLLAMA_CONTEXT_LENGTH on the PC).
  VIGIA_LOCAL_CONTEXT: z.preprocess(blank, z.coerce.number().int().min(2048).default(4096)),
  VIGIA_ESCALATE_PROFILE: z.preprocess(blank, z.enum(["none", "haiku", "sonnet"]).default("none")),
  VIGIA_BUDGET_USD: z.preprocess(blank, z.coerce.number().min(0).default(0)),
  VIGIA_MODE: z.preprocess(blank, z.enum(MODES).optional()),
  VIGIA_DB: z.preprocess(blank, z.string().default("data/vigia.sqlite")),
  VIGIA_BRIEF_HOUR: z.preprocess(blank, z.coerce.number().int().min(0).max(23).default(8)),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid environment: ${issues}`);
  }
  const e = parsed.data;
  return {
    mode: e.VIGIA_MODE,
    dbPath: e.VIGIA_DB,
    briefHour: e.VIGIA_BRIEF_HOUR,
    budgetUsd: e.VIGIA_BUDGET_USD,
    escalateProfile: e.VIGIA_ESCALATE_PROFILE,
    gfwToken: e.GFW_TOKEN,
    // Prices per million tokens, from research.md R1. Haiku's applies to prompts up to 100k.
    profiles: {
      local: {
        name: "local",
        baseURL: e.VIGIA_LOCAL_URL,
        apiKey: "ollama",
        model: e.VIGIA_LOCAL_MODEL,
        usdPerMTokIn: 0,
        usdPerMTokOut: 0,
        paid: false,
        contextTokens: e.VIGIA_LOCAL_CONTEXT,
      },
      haiku: {
        name: "haiku",
        baseURL: undefined,
        apiKey: e.ANTHROPIC_API_KEY,
        model: "claude-haiku-5-5",
        usdPerMTokIn: 0.1,
        usdPerMTokOut: 0.5,
        paid: true,
        contextTokens: 200_000,
      },
      sonnet: {
        name: "sonnet",
        baseURL: undefined,
        apiKey: e.ANTHROPIC_API_KEY,
        model: "claude-sonnet-5-5",
        usdPerMTokIn: 2,
        usdPerMTokOut: 10,
        paid: true,
        contextTokens: 200_000,
      },
    },
  };
}
