import { describe, expect, test } from "bun:test";
import { loadConfig, REGION } from "../../src/config";

describe("config", () => {
  test("defaults: no budget, no escalation, local model on the home PC", () => {
    const c = loadConfig({});
    expect(c.budgetUsd).toBe(0);
    expect(c.escalateProfile).toBe("none");
    expect(c.mode).toBeUndefined();
    expect(c.dbPath).toBe("data/vigia.sqlite");
    expect(c.briefHour).toBe(8);
    expect(c.profiles.local).toMatchObject({ baseURL: "http://pc-casa:11434", model: "qwen3:8b", paid: false });
    expect(c.profiles.haiku.baseURL).toBeUndefined();
  });

  test("empty values in .env count as unset", () => {
    expect(loadConfig({ VIGIA_BUDGET_USD: "", VIGIA_MODE: "", VIGIA_LOCAL_URL: "" }).budgetUsd).toBe(0);
  });

  test("reads and coerces the environment", () => {
    const c = loadConfig({ VIGIA_BUDGET_USD: "10", VIGIA_MODE: "public", VIGIA_ESCALATE_PROFILE: "haiku" });
    expect(c.budgetUsd).toBe(10);
    expect(c.mode).toBe("public");
    expect(c.escalateProfile).toBe("haiku");
  });

  test("rejects invalid values instead of guessing", () => {
    expect(() => loadConfig({ VIGIA_MODE: "prod" })).toThrow(/VIGIA_MODE/);
    expect(() => loadConfig({ VIGIA_BUDGET_USD: "-1" })).toThrow(/VIGIA_BUDGET_USD/);
  });

  test("the region is the Gulf of Finland", () => {
    expect(REGION).toMatchObject({ lat_min: 59.2, lat_max: 60.8, lon_min: 22.5, lon_max: 30.4 });
  });
});
