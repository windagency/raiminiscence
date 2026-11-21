import { describe, expect, it } from "vitest";
import { parseCheckpointNudgeState, parseOpenFailureState } from "#src/hook-state-schema.js";

describe("parseCheckpointNudgeState", () => {
  it("accepts a persisted debounce state", () => {
    const state = { lastNudgeAt: "2026-01-01T00:00:00.000Z", turnsSinceNudge: 3 };
    expect(parseCheckpointNudgeState(state)).toEqual(state);
  });

  it.each([
    ["a missing lastNudgeAt", { turnsSinceNudge: 3 }],
    ["a string turn count", { lastNudgeAt: "2026-01-01T00:00:00.000Z", turnsSinceNudge: "3" }],
    ["a non-object", 42],
  ])("rejects %s", (_label, payload) => {
    expect(parseCheckpointNudgeState(payload)).toBeUndefined();
  });
});

describe("parseOpenFailureState", () => {
  it("accepts Open Failure records keyed by Watched Command pattern", () => {
    const state = { "pnpm test": { command: "pnpm test --run", stderrTail: "1 failed" } };
    expect(parseOpenFailureState(state)).toEqual(state);
  });

  it.each([
    ["a record missing stderrTail", { "pnpm test": { command: "pnpm test" } }],
    ["a non-object record", { "pnpm test": "failed" }],
    ["an array", []],
  ])("rejects %s", (_label, payload) => {
    expect(parseOpenFailureState(payload)).toBeUndefined();
  });
});
