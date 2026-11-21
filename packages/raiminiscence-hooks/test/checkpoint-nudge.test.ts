import { describe, expect, it } from "vitest";
import {
  CHECKPOINT_NUDGE_INTERVAL_MS,
  CHECKPOINT_NUDGE_TURN_THRESHOLD,
  checkpointNudge,
  checkpointNudgeOutput,
  isCheckpointNudgeDue,
  type NudgeStateStore,
} from "#src/checkpoint-nudge.js";

function fakeStore(seed: Record<string, { lastNudgeAt: string; turnsSinceNudge: number }> = {}): NudgeStateStore {
  const state = { ...seed };
  return {
    read: (sessionId) => state[sessionId],
    write: (sessionId, value) => {
      state[sessionId] = value;
    },
  };
}

describe("isCheckpointNudgeDue", () => {
  it("is not due before either threshold is crossed", () => {
    expect(isCheckpointNudgeDue({ elapsedMs: CHECKPOINT_NUDGE_INTERVAL_MS - 1, turnsSinceNudge: CHECKPOINT_NUDGE_TURN_THRESHOLD - 1 })).toBe(false);
  });

  it("is due exactly at the time threshold", () => {
    expect(isCheckpointNudgeDue({ elapsedMs: CHECKPOINT_NUDGE_INTERVAL_MS, turnsSinceNudge: 0 })).toBe(true);
  });

  it("is due past the time threshold", () => {
    expect(isCheckpointNudgeDue({ elapsedMs: CHECKPOINT_NUDGE_INTERVAL_MS + 1, turnsSinceNudge: 0 })).toBe(true);
  });

  it("is due exactly at the turn threshold", () => {
    expect(isCheckpointNudgeDue({ elapsedMs: 0, turnsSinceNudge: CHECKPOINT_NUDGE_TURN_THRESHOLD })).toBe(true);
  });

  it("is due past the turn threshold", () => {
    expect(isCheckpointNudgeDue({ elapsedMs: 0, turnsSinceNudge: CHECKPOINT_NUDGE_TURN_THRESHOLD + 1 })).toBe(true);
  });

  it("is due when either threshold alone is crossed, whichever comes first", () => {
    expect(isCheckpointNudgeDue({ elapsedMs: CHECKPOINT_NUDGE_INTERVAL_MS, turnsSinceNudge: 1 })).toBe(true);
    expect(isCheckpointNudgeDue({ elapsedMs: 1, turnsSinceNudge: CHECKPOINT_NUDGE_TURN_THRESHOLD })).toBe(true);
  });
});

describe("checkpointNudgeOutput", () => {
  const dueState = { elapsedMs: CHECKPOINT_NUDGE_INTERVAL_MS, turnsSinceNudge: 0 };
  const notDueState = { elapsedMs: 0, turnsSinceNudge: 1 };

  it("returns {} when not due, for both clients", () => {
    expect(checkpointNudgeOutput("claude-code", notDueState)).toEqual({});
    expect(checkpointNudgeOutput("cursor", notDueState)).toEqual({});
  });

  it("returns Claude Code's block/reason shape when due", () => {
    const output = checkpointNudgeOutput("claude-code", dueState);
    expect(output.decision).toBe("block");
    expect(output.reason).toMatch(/checkpoint/i);
    expect(output.followup_message).toBeUndefined();
  });

  it("returns Cursor's followup_message shape when due", () => {
    const output = checkpointNudgeOutput("cursor", dueState);
    expect(output.followup_message).toMatch(/checkpoint/i);
    expect(output.decision).toBeUndefined();
  });

  it("never nudges when stopHookActive is true, even if otherwise due", () => {
    expect(checkpointNudgeOutput("claude-code", dueState, { stopHookActive: true })).toEqual({});
  });
});

describe("checkpointNudge (stateful production entrypoint)", () => {
  it("does not nudge on a session's very first Stop event", () => {
    const store = fakeStore();
    const output = checkpointNudge({ storageRoot: "/tmp/does-not-matter", sessionId: "s1", client: "claude-code", stateStore: store });
    expect(output).toEqual({});
  });

  it("nudges once 20 turns have passed with no prior nudge in this session", () => {
    const store = fakeStore();
    let output: ReturnType<typeof checkpointNudge> = {};
    for (let turn = 0; turn < CHECKPOINT_NUDGE_TURN_THRESHOLD; turn++) {
      output = checkpointNudge({ storageRoot: "/tmp/does-not-matter", sessionId: "s1", client: "claude-code", stateStore: store });
    }
    expect(output.decision).toBe("block");
  });

  it("nudges once 15 minutes have passed since session start, even with few turns", () => {
    const store = fakeStore();
    const sessionStart = new Date("2026-01-01T00:00:00.000Z");
    checkpointNudge({ storageRoot: "/tmp/does-not-matter", sessionId: "s1", client: "claude-code", now: sessionStart, stateStore: store });

    const output = checkpointNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      client: "claude-code",
      now: new Date(sessionStart.getTime() + CHECKPOINT_NUDGE_INTERVAL_MS),
      stateStore: store,
    });

    expect(output.decision).toBe("block");
  });

  it("does not immediately re-nudge on the very next Stop event after one just fired", () => {
    const store = fakeStore();
    const now = new Date("2026-01-01T00:00:00.000Z");
    let output: ReturnType<typeof checkpointNudge> = {};
    for (let turn = 0; turn < CHECKPOINT_NUDGE_TURN_THRESHOLD; turn++) {
      output = checkpointNudge({ storageRoot: "/tmp/does-not-matter", sessionId: "s1", client: "claude-code", now, stateStore: store });
    }
    expect(output.decision).toBe("block");

    const immediateNext = checkpointNudge({ storageRoot: "/tmp/does-not-matter", sessionId: "s1", client: "claude-code", now, stateStore: store });
    expect(immediateNext).toEqual({});
  });

  it("never nudges while stop_hook_active reports this Stop as a hook-triggered continuation", () => {
    const store = fakeStore();
    let output: ReturnType<typeof checkpointNudge> = {};
    for (let turn = 0; turn < CHECKPOINT_NUDGE_TURN_THRESHOLD; turn++) {
      output = checkpointNudge({
        storageRoot: "/tmp/does-not-matter",
        sessionId: "s1",
        client: "claude-code",
        stopHookActive: true,
        stateStore: store,
      });
    }
    expect(output).toEqual({});
  });

  it("tracks turn counts independently per session", () => {
    const store = fakeStore();
    for (let turn = 0; turn < CHECKPOINT_NUDGE_TURN_THRESHOLD - 1; turn++) {
      checkpointNudge({ storageRoot: "/tmp/does-not-matter", sessionId: "s1", client: "claude-code", stateStore: store });
    }
    const otherSession = checkpointNudge({ storageRoot: "/tmp/does-not-matter", sessionId: "s2", client: "claude-code", stateStore: store });
    expect(otherSession).toEqual({});
  });

  it("returns {} (never throws) if the state store itself throws", () => {
    const brokenStore: NudgeStateStore = {
      read: () => {
        throw new Error("disk exploded");
      },
      write: () => {},
    };
    const output = checkpointNudge({ storageRoot: "/tmp/does-not-matter", sessionId: "s1", client: "claude-code", stateStore: brokenStore });
    expect(output).toEqual({});
  });
});
