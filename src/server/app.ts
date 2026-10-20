import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { type AppContext, errorResponse, HttpError, matchPath, type Route } from "./http";
import { BRIEF_ROUTES } from "./routes/briefs";
import { CANDIDATE_ROUTES } from "./routes/candidates";
import { HEALTH_ROUTES } from "./routes/health";
import { LABEL_ROUTES } from "./routes/labels";
import { MAP_ROUTES } from "./routes/map";
import { streamRoute } from "./stream";

export const NOTICE = "Educational project, no warranty";
export const ATTRIBUTION = "Source: Fintraffic / digitraffic.fi, CC BY 4.0";

const metaRoute: Route = {
  method: "GET",
  path: "/api/meta",
  handler: ({ app }) => {
    const month = new Date().toISOString().slice(0, 7);
    const spent =
      app.db.query<{ spent_usd: number }, [string]>("SELECT spent_usd FROM budget WHERE month = ?").get(month)
        ?.spent_usd ?? 0;
    return Response.json({
      mode: app.mode,
      model: { profile: "local", ...(app.model?.state ?? { available: null, reason: null }) },
      // Only live says whether the paid profiles could run; the public demo does not tell.
      paid_ready: app.mode === "live" && app.config.profiles.haiku.apiKey !== undefined,
      budget: { month, spent_usd: spent, cap_usd: app.config.budgetUsd },
      notice: NOTICE,
      attribution: ATTRIBUTION,
    });
  },
};

export const ROUTES: Route[] = [metaRoute, streamRoute, ...CANDIDATE_ROUTES, ...MAP_ROUTES, ...LABEL_ROUTES, ...HEALTH_ROUTES, ...BRIEF_ROUTES];

export interface AppOptions {
  /** Built panel (panel/build). Missing → the API still works. */
  panelDir?: string;
  routes?: Route[];
}

function guard(route: Route, app: AppContext): void {
  if (!route.write || app.mode === "live") return;
  throw new HttpError(403, "read_only", `${route.method} ${route.path} is not allowed in ${app.mode} mode`);
}

function serveStatic(panelDir: string, pathname: string): Response {
  const root = resolve(panelDir);
  const file = resolve(join(root, decodeURIComponent(pathname)));
  if ((file === root || file.startsWith(root + sep)) && existsSync(file) && statSync(file).isFile()) {
    return new Response(Bun.file(file));
  }
  // Client-side routes (/cases/12) all load the SPA shell.
  const index = join(root, "index.html");
  if (existsSync(index)) return new Response(Bun.file(index));
  return errorResponse(404, "panel_not_built", "the panel is not built: bun run --cwd panel build");
}

/** The request handler, separate from Bun.serve so tests can call it directly. */
export function createApp(app: AppContext, opts: AppOptions = {}): (req: Request) => Promise<Response> {
  const routes = opts.routes ?? ROUTES;
  return async (req) => {
    const url = new URL(req.url);
    try {
      let pathMatched = false;
      for (const route of routes) {
        const params = matchPath(route.path, url.pathname);
        if (params === null) continue;
        pathMatched = true;
        if (route.method !== req.method) continue;
        guard(route, app);
        return await route.handler({ req, url, params, app });
      }
      if (pathMatched) throw new HttpError(405, "method_not_allowed", `${req.method} is not allowed on ${url.pathname}`);
      if (url.pathname.startsWith("/api/")) throw new HttpError(404, "not_found", `no route for ${url.pathname}`);
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "method_not_allowed", "static files are read-only");
      return opts.panelDir === undefined
        ? errorResponse(404, "panel_not_built", "no panel directory configured")
        : serveStatic(opts.panelDir, url.pathname);
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message);
      console.error(err);
      return errorResponse(500, "internal", "internal error");
    }
  };
}
