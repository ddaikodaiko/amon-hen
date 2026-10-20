import { z } from "zod";
import { defineTool, ToolError } from "./tool";

export const VERDICTS = ["coverage_gap", "likely_dark", "inconclusive"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
export const MAX_EVIDENCE = 5;
export const MAX_CLAIM = 160;

export const VerdictInput = z.object({
  verdict: z.enum(VERDICTS),
  confidence: z.enum(CONFIDENCES),
  explanation: z.string().trim().min(1).max(800).describe("1 to 4 sentences, in the tone of an analyst's note."),
  evidence: z
    .array(
      z.object({
        step: z.number().int().min(0).describe("The step number shown in a tool result of this investigation."),
        claim: z.string().trim().min(1).max(MAX_CLAIM).describe(`What that step shows, in ${MAX_CLAIM} characters at most.`),
      }),
    )
    .min(1)
    .max(MAX_EVIDENCE)
    .describe(`1 to ${MAX_EVIDENCE} pieces of evidence, each citing a tool result.`),
});
export type Verdict = z.output<typeof VerdictInput>;

export const submitVerdict = defineTool({
  name: "submit_verdict",
  description:
    "Ends the investigation with your verdict on this AIS gap. Cite as evidence the steps of the tool results " +
    "that support it. coverage_gap: the receivers could not hear the vessel there and then. likely_dark: " +
    "coverage was good and neighbours kept reporting, so the transponder was probably switched off. " +
    "inconclusive: the evidence does not decide it.",
  input: VerdictInput,
  run(input, ctx) {
    const unknown = input.evidence.map((e) => e.step).filter((s) => !ctx.citable.has(s));
    if (unknown.length > 0) {
      const allowed = [...ctx.citable].join(", ") || "none yet: call a tool first";
      throw new ToolError(`step ${unknown.join(", ")} is not a tool result of this investigation; you can cite: ${allowed}`);
    }
    return { summary: `Verdict: ${input.verdict}, ${input.confidence} confidence.`, data: input };
  },
});
