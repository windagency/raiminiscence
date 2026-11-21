import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMemory, writeMemory } from "#src/core/storage.js";
import { BASE_HALF_LIFE_DAYS, CURRENT_SCHEMA_VERSION } from "#src/core/types.js";
import type { Memory } from "#src/core/types.js";

describe("storage", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-storage-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("round-trips frontmatter through write/read unchanged", () => {
    const memory: Memory = {
      frontmatter: {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        schemaVersion: CURRENT_SCHEMA_VERSION,
        kind: "episodic",
        confidence: "observed",
        isError: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastRecalledAt: null,
        recallCount: 0,
        consolidationSurvivalCount: 0,
        baseHalfLifeDays: BASE_HALF_LIFE_DAYS.episodic,
        retractedAt: null,
        retractReason: null,
        source: { client: "claude-code" },
        scope: "project",
        originatingProject: null,
        promotedFrom: null,
        relatedFiles: null,
        staleAt: null,
        staleReason: null,
        positiveFeedbackCount: 0,
        negativeFeedbackCount: 0,
      },
      body: "Chose Postgres for the write model.\nRationale: strongest transactional guarantees for this workload.",
    };

    writeMemory(storageRoot, memory);
    const roundTripped = readMemory(storageRoot, "episodic", memory.frontmatter.id);

    expect(roundTripped).not.toBeNull();
    expect(roundTripped?.frontmatter).toEqual(memory.frontmatter);
    expect(roundTripped?.body).toBe(memory.body);
  });

  it("returns null for a missing memory", () => {
    expect(readMemory(storageRoot, "episodic", "does-not-exist")).toBeNull();
  });
});
