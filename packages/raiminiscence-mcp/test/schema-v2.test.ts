import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forget, remember } from "#src/core/engine.js";
import type { RememberParams } from "#src/core/engine.js";
import { readMemory, writeMemory } from "#src/core/storage.js";
import { CURRENT_SCHEMA_VERSION } from "#src/core/types.js";
import type { ConfidenceTier } from "#src/core/types.js";

/** Bypasses `remember`'s narrowed TS type to exercise its runtime rejection. */
function rememberWithConfidence(params: Omit<RememberParams, "confidence"> & { confidence: ConfidenceTier }) {
  return remember(params as RememberParams);
}

describe("schema v2 / Confidence Tier tightening", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-schema-v2-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("rejects a direct remember with confidence: stale", async () => {
    await expect(rememberWithConfidence({ content: "x", client: "claude-code", storageRoot, confidence: "stale" })).rejects.toThrow(/stale/);
  });

  it("rejects a direct remember with confidence: retracted", async () => {
    await expect(rememberWithConfidence({ content: "x", client: "claude-code", storageRoot, confidence: "retracted" })).rejects.toThrow(/retracted/);
  });

  it("forget on an already-stale memory transitions it to retracted while preserving staleAt/staleReason", async () => {
    const remembered = await remember({ content: "A decision anchored to a file.", kind: "decision", client: "claude-code", storageRoot });

    const memory = readMemory(storageRoot, "decision", remembered.id)!;
    memory.frontmatter.confidence = "stale";
    memory.frontmatter.staleAt = "2026-01-01T00:00:00.000Z";
    memory.frontmatter.staleReason = "Related file(s) changed: src/foo.ts";
    writeMemory(storageRoot, memory);

    const result = forget({ id: remembered.id, reason: "confirmed obsolete", storageRoot });

    expect(result).toEqual({ id: remembered.id, alreadyRetracted: false });

    const after = readMemory(storageRoot, "decision", remembered.id)!;
    expect(after.frontmatter.confidence).toBe("retracted");
    expect(after.frontmatter.retractedAt).not.toBeNull();
    expect(after.frontmatter.retractReason).toBe("confirmed obsolete");
    expect(after.frontmatter.staleAt).toBe("2026-01-01T00:00:00.000Z");
    expect(after.frontmatter.staleReason).toBe("Related file(s) changed: src/foo.ts");
  });

  it("a pre-existing v1-shaped memory (missing the five new fields) round-trips through read/write unchanged", () => {
    const v1Frontmatter = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      schemaVersion: 1,
      kind: "episodic" as const,
      confidence: "observed" as const,
      isError: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastRecalledAt: null,
      recallCount: 0,
      consolidationSurvivalCount: 0,
      baseHalfLifeDays: 7,
      retractedAt: null,
      retractReason: null,
      source: { client: "claude-code" },
      scope: "project" as const,
      originatingProject: null,
      promotedFrom: null,
    };
    // @ts-expect-error intentionally writing a v1-shaped (pre-v2-field) frontmatter to disk
    writeMemory(storageRoot, { frontmatter: v1Frontmatter, body: "A v1 memory." });

    const read = readMemory(storageRoot, "episodic", v1Frontmatter.id)!;
    expect(read.frontmatter.id).toBe(v1Frontmatter.id);
    expect(read.frontmatter.schemaVersion).toBe(1);
    expect(read.frontmatter.relatedFiles).toBeUndefined();
    expect(read.frontmatter.staleAt).toBeUndefined();
    expect(read.body).toBe("A v1 memory.");
  });

  it("bumped the schema version to 2 for this v2 change (later bumped again to 3 by v11's writer field)", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
  });

  it("a pre-v11 memory (schemaVersion 2, missing the writer field) round-trips through read/write unchanged", () => {
    const v2Frontmatter = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FBW",
      schemaVersion: 2,
      kind: "episodic" as const,
      confidence: "observed" as const,
      isError: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastRecalledAt: null,
      recallCount: 0,
      consolidationSurvivalCount: 0,
      baseHalfLifeDays: 7,
      retractedAt: null,
      retractReason: null,
      source: { client: "claude-code" },
      scope: "project" as const,
      originatingProject: null,
      promotedFrom: null,
      relatedFiles: null,
      staleAt: null,
      staleReason: null,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
    };
    // Intentionally writing a v2-shaped (pre-writer-field) frontmatter to disk; `writer` is optional, so it type-checks.
    writeMemory(storageRoot, { frontmatter: v2Frontmatter, body: "A pre-v11 memory." });

    const read = readMemory(storageRoot, "episodic", v2Frontmatter.id)!;
    expect(read.frontmatter.schemaVersion).toBe(2);
    expect(read.frontmatter.writer).toBeUndefined();
    expect(read.body).toBe("A pre-v11 memory.");
  });
});
