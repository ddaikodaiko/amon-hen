import { z } from "zod";
import { HttpError } from "../http";

/** An ISO date (2026-10-19, from midnight UTC) or date-time (Z assumed), as milliseconds. */
export const instant = z
  .string()
  .regex(/^\d{4}-\d\d-\d\d(T\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)?)?$/, "an ISO 8601 date or date-time")
  .transform((s, ctx) => {
    const ts = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : /Z|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
    if (Number.isNaN(ts)) ctx.addIssue({ code: "custom", message: "not a valid date" });
    return ts;
  });

/** Validates a query, a path parameter or a body; a failure is a 400. */
export function parse<S extends z.ZodType>(schema: S, value: unknown, what: string): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "invalid_request", `invalid ${what}: ${z.prettifyError(r.error)}`);
  return r.data;
}
