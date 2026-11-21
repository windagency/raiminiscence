import { describe, expect, it } from "vitest";
import { createFrontmatter } from "#src/core/create-frontmatter.js";
import { retractMemory, staleMemory } from "#src/core/confidence-tier-fsm.js";
import type { ConfidenceTier, Memory } from "#src/core/types.js";

function memoryAt(confidence: ConfidenceTier): Memory {
  return {
    frontmatter: createFrontmatter({
      kind: "episodic",
      confidence,
      createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
      source: { client: "test" },
      scope: "project",
    }),
    body: "A test memory.",
  };
}

const STARTING_TIERS: ConfidenceTier[] = ["verified", "observed", "inferred"];
const now = new Date("2024-06-01T00:00:00.000Z");

describe("confidenceTierFsm", () => {
  describe("staleMemory: {verified, observed, inferred} → stale", () => {
    for (const tier of STARTING_TIERS) {
      it(`accepts "${tier}" → "stale", setting staleAt/staleReason`, () => {
        const memory = memoryAt(tier);
        staleMemory(memory, now, "a staling reason");
        expect(memory.frontmatter.confidence).toBe("stale");
        expect(memory.frontmatter.staleAt).toBe(now.toISOString());
        expect(memory.frontmatter.staleReason).toBe("a staling reason");
      });
    }

    it('"stale" → "stale" is a no-op: no fields are overwritten', () => {
      const memory = memoryAt("verified");
      staleMemory(memory, now, "first staling");
      const firstStaleAt = memory.frontmatter.staleAt;

      staleMemory(memory, new Date("2024-07-01T00:00:00.000Z"), "second staling attempt");

      expect(memory.frontmatter.confidence).toBe("stale");
      expect(memory.frontmatter.staleAt).toBe(firstStaleAt);
      expect(memory.frontmatter.staleReason).toBe("first staling");
    });

    it('rejects "retracted" → "stale": retracted has no outgoing transitions', () => {
      const memory = memoryAt("retracted");
      expect(() => staleMemory(memory, now, "should not apply")).toThrow(/retracted/);
      expect(memory.frontmatter.confidence).toBe("retracted");
    });
  });

  describe("retractMemory: {verified, observed, inferred, stale} → retracted", () => {
    for (const tier of [...STARTING_TIERS, "stale"] as ConfidenceTier[]) {
      it(`accepts "${tier}" → "retracted", setting retractedAt/retractReason`, () => {
        const memory = memoryAt(tier);
        const result = retractMemory(memory, now, "a retraction reason");
        expect(result).toEqual({ alreadyRetracted: false });
        expect(memory.frontmatter.confidence).toBe("retracted");
        expect(memory.frontmatter.retractedAt).toBe(now.toISOString());
        expect(memory.frontmatter.retractReason).toBe("a retraction reason");
      });
    }

    it('"retracted" → "retracted" is a no-op: reports alreadyRetracted, doesn\'t overwrite existing fields', () => {
      const memory = memoryAt("verified");
      retractMemory(memory, now, "first retraction");
      const firstRetractedAt = memory.frontmatter.retractedAt;

      const second = retractMemory(memory, new Date("2024-07-01T00:00:00.000Z"), "second retraction attempt");

      expect(second).toEqual({ alreadyRetracted: true });
      expect(memory.frontmatter.retractedAt).toBe(firstRetractedAt);
      expect(memory.frontmatter.retractReason).toBe("first retraction");
    });

    it("accepts a null reason", () => {
      const memory = memoryAt("observed");
      retractMemory(memory, now, null);
      expect(memory.frontmatter.retractReason).toBeNull();
    });
  });
});
