import { z } from "zod";
import { HttpError } from "../http";

/** Validates a query, a path parameter or a body; a failure is a 400. */
export function parse<S extends z.ZodType>(schema: S, value: unknown, what: string): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "invalid_request", `invalid ${what}: ${z.prettifyError(r.error)}`);
  return r.data;
}
