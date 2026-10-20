import type { Config, Mode } from "../config";
import type { Database } from "../db";
import type { Investigator } from "./investigator";

export interface AppContext {
  db: Database;
  config: Config;
  mode: Mode;
  /** Whether the investigation model answers; null while unknown. */
  modelAvailable: () => boolean | null;
  /** Takes the investigations asked for from the panel; only in live mode. */
  investigator?: Investigator;
}

export interface RequestContext {
  req: Request;
  url: URL;
  params: Record<string, string>;
  app: AppContext;
}

export interface Route {
  method: "GET" | "POST";
  /** Segments starting with ":" are parameters, e.g. /api/candidates/:id. */
  path: string;
  /** ✎ in contracts/http-api.md: changes state, so it is refused in replay and public. */
  write?: boolean;
  handler: (ctx: RequestContext) => Response | Promise<Response>;
}

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 405 | 409 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "the request body is not valid JSON");
  }
}

/** The JSON body, or `empty` when there is none. */
export async function readOptionalJson(req: Request, empty: unknown): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === "") return empty;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "the request body is not valid JSON");
  }
}

/** Params of `path` if `pattern` matches it. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i]!;
    const g = got[i]!;
    if (w.startsWith(":")) {
      if (g === "") return null;
      params[w.slice(1)] = decodeURIComponent(g);
    } else if (w !== g) return null;
  }
  return params;
}
