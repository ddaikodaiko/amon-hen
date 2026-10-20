import { describe, expect, spyOn, test } from "bun:test";
import { FakeClient } from "../../src/agent/model";
import { loadConfig } from "../../src/config";
import { openDb } from "../../src/db";
import { runDetector } from "../../src/detect/run";
import { SerialInvestigator } from "../../src/server/investigator";
import { END, PORTS, play, T0 } from "../fixtures/ais/gaps";

// An investigation that blows up (on 2026-10-20 Ollama answered with null content and the loop
// threw) must not leave its case marked as running, nor stop the queue behind it.

describe("SerialInvestigator", () => {
  test("a case whose investigation throws ends in error, and the next one still runs", async () => {
    const db = openDb(":memory:");
    play(db, T0, END);
    runDetector(db, END, { ports: PORTS });
    const [a, b] = db.query<{ id: number }, []>("SELECT id FROM candidates WHERE state = 'pending' ORDER BY id").all();
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    // An empty script: the first call to the model throws a plain Error, not an API error.
    const investigator = new SerialInvestigator(db, loadConfig({}), (p) => new FakeClient([], p.name), () => END);
    investigator.enqueue(a!.id, "local");
    investigator.enqueue(b!.id, "local");
    await investigator.idle();
    quiet.mockRestore();
    const state = db.query<{ state: string }, [number]>("SELECT state FROM candidates WHERE id = ?");
    expect(state.get(a!.id)?.state).toBe("error");
    expect(state.get(b!.id)?.state).toBe("error");
    expect(investigator.busy).toBe(false);
  });
});
