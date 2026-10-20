import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeClient } from "../../src/agent/model";
import { loadConfig, type Mode } from "../../src/config";
import { openDb } from "../../src/db";
import { createApp, ROUTES } from "../../src/server/app";
import type { Route } from "../../src/server/http";
import { ModelStatus } from "../../src/server/model-status";

const writeRoute: Route = { method: "POST", path: "/api/test-write", write: true, handler: () => Response.json({ ok: true }) };
const paramRoute: Route = {
  method: "GET",
  path: "/api/things/:id",
  handler: ({ params }) => Response.json({ id: params.id }),
};

const panelDir = mkdtempSync(join(tmpdir(), "vigia-panel-"));
mkdirSync(join(panelDir, "_app"));
writeFileSync(join(panelDir, "index.html"), "<!doctype html><title>Vigía</title>");
writeFileSync(join(panelDir, "_app", "main.js"), "console.log(1)");
afterAll(() => rmSync(panelDir, { recursive: true, force: true }));

function app(mode: Mode) {
  return createApp(
    { db: openDb(":memory:"), config: loadConfig({ VIGIA_BUDGET_USD: "5" }), mode },
    { panelDir, routes: [...ROUTES, writeRoute, paramRoute] },
  );
}

const call = (mode: Mode, method: string, path: string) =>
  app(mode)(new Request(`http://localhost${path}`, { method }));

describe("mode guard", () => {
  test("a ✎ route works in live and is refused in replay and public", async () => {
    expect((await call("live", "POST", "/api/test-write")).status).toBe(200);
    for (const mode of ["replay", "public"] as const) {
      const res = await call(mode, "POST", "/api/test-write");
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("read_only");
    }
  });
});

describe("routing", () => {
  test("GET /api/meta: mode, budget and notice", async () => {
    const res = await call("public", "GET", "/api/meta");
    expect(await res.json()).toMatchObject({
      mode: "public",
      model: { profile: "local", available: null },
      paid_ready: false,
      budget: { spent_usd: 0, cap_usd: 5 },
      notice: "Educational project, no warranty",
    });
  });

  test("GET /api/meta in live: the model check, and whether a key is set", async () => {
    const client = new FakeClient([]);
    client.down = "Ollama did not answer";
    const model = new ModelStatus(client);
    await model.check();
    const handler = createApp({ db: openDb(":memory:"), config: loadConfig({ ANTHROPIC_API_KEY: "sk-test" }), mode: "live", model });
    expect(await (await handler(new Request("http://localhost/api/meta"))).json()).toMatchObject({
      model: { available: false, reason: "Ollama did not answer" },
      paid_ready: true,
    });
  });

  test("path parameters", async () => {
    expect(await (await call("live", "GET", "/api/things/42")).json()).toEqual({ id: "42" });
  });

  test("errors are JSON: unknown route 404, wrong method 405", async () => {
    const res = await call("live", "GET", "/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "no route for /api/nope" } });
    expect((await call("live", "GET", "/api/test-write")).status).toBe(405);
  });
});

describe("panel files", () => {
  test("serves built files and falls back to index.html for client routes", async () => {
    expect(await (await call("public", "GET", "/_app/main.js")).text()).toBe("console.log(1)");
    expect(await (await call("public", "GET", "/cases/12")).text()).toContain("<title>Vigía</title>");
  });

  test("never serves files outside the panel directory", async () => {
    const res = await call("public", "GET", "/%2e%2e/%2e%2e/etc/passwd");
    expect(await res.text()).toContain("<title>Vigía</title>");
  });
});
