import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forget, recall, remember } from "#src/core/engine.js";

describe("forget", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-forget-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("excludes a forgotten memory from a subsequent recall in the same run", async () => {
    const remembered = await remember({ content: "A mistaken observation about caching.", client: "claude-code", storageRoot });

    const result = forget({ id: remembered.id, reason: "turned out to be wrong", storageRoot });
    expect(result).toEqual({ id: remembered.id, alreadyRetracted: false });

    const recalled = await recall({ query: "mistaken observation caching", storageRoot });
    expect(recalled.results).toEqual([]);
  });

  it("is idempotent when forgetting an already-retracted id", async () => {
    const remembered = await remember({ content: "Something to retract.", client: "claude-code", storageRoot });

    forget({ id: remembered.id, storageRoot });
    const second = forget({ id: remembered.id, storageRoot });

    expect(second).toEqual({ id: remembered.id, alreadyRetracted: true });
  });

  it("returns a descriptive tool error for an unknown id, not a crash", () => {
    expect(() => forget({ id: "nonexistent-id", storageRoot })).toThrow(/nonexistent-id/);
  });
});
