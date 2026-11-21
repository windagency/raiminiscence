import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { feedback, remember } from "#src/core/engine.js";
import { readMemory, writeMemory } from "#src/core/storage.js";

describe("feedback", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-feedback-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("increments positiveFeedbackCount and never changes Confidence Tier", async () => {
    const remembered = await remember({ content: "A helpful memory.", client: "claude-code", storageRoot });

    const result = feedback({ id: remembered.id, wasHelpful: true, storageRoot });

    expect(result).toEqual({ id: remembered.id, wasHelpful: true });
    const after = readMemory(storageRoot, "episodic", remembered.id)!;
    expect(after.frontmatter.positiveFeedbackCount).toBe(1);
    expect(after.frontmatter.negativeFeedbackCount).toBe(0);
    expect(after.frontmatter.confidence).toBe("observed");
  });

  it("increments negativeFeedbackCount and never changes Confidence Tier", async () => {
    const remembered = await remember({ content: "An unhelpful memory.", client: "claude-code", storageRoot });

    feedback({ id: remembered.id, wasHelpful: false, storageRoot });

    const after = readMemory(storageRoot, "episodic", remembered.id)!;
    expect(after.frontmatter.negativeFeedbackCount).toBe(1);
    expect(after.frontmatter.positiveFeedbackCount).toBe(0);
    expect(after.frontmatter.confidence).toBe("observed");
  });

  it("compounds across repeated feedback calls, with no cap", async () => {
    const remembered = await remember({ content: "Repeatedly useful.", client: "claude-code", storageRoot });

    feedback({ id: remembered.id, wasHelpful: true, storageRoot });
    feedback({ id: remembered.id, wasHelpful: true, storageRoot });
    feedback({ id: remembered.id, wasHelpful: true, storageRoot });

    const after = readMemory(storageRoot, "episodic", remembered.id)!;
    expect(after.frontmatter.positiveFeedbackCount).toBe(3);
  });

  it("succeeds quietly on a memory that's already stale or retracted", async () => {
    const remembered = await remember({ content: "Already stale.", client: "claude-code", storageRoot });
    const memory = readMemory(storageRoot, "episodic", remembered.id)!;
    memory.frontmatter.confidence = "stale";
    writeMemory(storageRoot, memory);

    const result = feedback({ id: remembered.id, wasHelpful: true, storageRoot });

    expect(result).toEqual({ id: remembered.id, wasHelpful: true });
    const after = readMemory(storageRoot, "episodic", remembered.id)!;
    expect(after.frontmatter.positiveFeedbackCount).toBe(1);
    expect(after.frontmatter.confidence).toBe("stale");
  });

  it("returns a real tool error for a genuinely nonexistent id", () => {
    expect(() => feedback({ id: "nonexistent-id", wasHelpful: true, storageRoot })).toThrow(/nonexistent-id/);
  });
});
