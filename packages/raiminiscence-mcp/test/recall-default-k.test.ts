import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recall, remember } from "#src/core/engine.js";

describe("recall's default k (ADR-0034)", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-default-k-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  async function rememberRetryNotes(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await remember({
        content: `Retry note ${i}: the payment client retries timeouts`,
        client: "claude-code",
        storageRoot,
        triggerConsolidation: false,
      });
    }
  }

  it("returns three results when k is not given", async () => {
    await rememberRetryNotes(5);

    const result = await recall({ query: "payment client retries", storageRoot, triggerConsolidation: false });

    expect(result.results).toHaveLength(3);
  });

  it("still returns more when k asks for more", async () => {
    await rememberRetryNotes(5);

    const result = await recall({ query: "payment client retries", k: 5, storageRoot, triggerConsolidation: false });

    expect(result.results).toHaveLength(5);
  });
});
