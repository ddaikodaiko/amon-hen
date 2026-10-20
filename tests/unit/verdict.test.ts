import { describe, expect, test } from "bun:test";
import { openDb } from "../../src/db";
import { runTool, toolDefinitions } from "../../src/agent/tools";

// Steps 1 and 3 are tool results the verdict may cite.
const ctx = { db: openDb(":memory:"), mmsi: 230000101, citable: new Set([1, 3]) };

const valid = {
  verdict: "coverage_gap",
  confidence: "medium",
  explanation: "The cell had poor reception at that hour and neighbours went silent too.",
  evidence: [
    { step: 1, claim: "Coverage in the cell at 17 UTC is 41% over 7 days." },
    { step: 3, claim: "6 of 9 neighbours were also silent during the gap." },
  ],
};

const submit = (input: unknown) => runTool("submit_verdict", input, ctx);

describe("submit_verdict", () => {
  test("accepts a valid verdict and gives it back", async () => {
    const r = await submit(valid);
    expect(r.isError).toBe(false);
    expect(r.isError === false && r.data).toEqual(valid);
  });

  test("rejects a verdict without evidence, or with more than 5 pieces", async () => {
    expect((await submit({ ...valid, evidence: [] })).isError).toBe(true);
    const six = Array.from({ length: 6 }, () => valid.evidence[0]);
    expect((await submit({ ...valid, evidence: six })).isError).toBe(true);
  });

  test("rejects a step that is not a tool result in the trace, and says which", async () => {
    const r = await submit({ ...valid, evidence: [{ step: 2, claim: "Something the model made up." }] });
    expect(r).toMatchObject({ isError: true });
    expect(r.summary).toContain("2");
  });

  test("rejects values outside their lists", async () => {
    expect((await submit({ ...valid, verdict: "dark" })).isError).toBe(true);
    expect((await submit({ ...valid, confidence: "certain" })).isError).toBe(true);
  });

  test("rejects a claim longer than 160 characters", async () => {
    const r = await submit({ ...valid, evidence: [{ step: 1, claim: "x".repeat(161) }] });
    expect(r.isError).toBe(true);
    expect((await submit({ ...valid, evidence: [{ step: 1, claim: "x".repeat(160) }] })).isError).toBe(false);
  });

  test("an unknown tool is an error, not a crash", async () => {
    expect(await runTool("get_crew", {}, ctx)).toMatchObject({ isError: true });
  });
});

describe("tool definitions", () => {
  const verdictTool = (strict: boolean) => toolDefinitions({ strict }).find((t) => t.name === "submit_verdict")!;

  test("every object forbids extra properties", () => {
    const schema = JSON.stringify(verdictTool(false).input_schema);
    expect(schema).toContain('"additionalProperties":false');
    expect(verdictTool(false).input_schema).not.toHaveProperty("$schema");
  });

  test("strict definitions leave out the constraints strict mode does not take; the others keep them", () => {
    const strict = verdictTool(true);
    expect(strict.strict).toBe(true);
    expect(JSON.stringify(strict.input_schema)).not.toMatch(/maxLength|minLength|minItems|maxItems|minimum|maximum/);
    const loose = verdictTool(false);
    expect(loose.strict).toBeUndefined();
    expect(JSON.stringify(loose.input_schema)).toContain('"maxLength":160');
  });
});
