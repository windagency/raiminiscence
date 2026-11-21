import { describe, expect, it } from "vitest";
import {
  FIX_NUDGE_STDERR_TAIL_LINES,
  fixNudge,
  fixNudgeText,
  fixNudgeTransition,
  matchWatchedCommands,
  truncateStderrTail,
  type FixNudgeStateStore,
  type OpenFailureState,
} from "#src/fix-nudge.js";

function fakeStore(seed: Record<string, OpenFailureState> = {}): FixNudgeStateStore {
  const state = { ...seed };
  return {
    read: (sessionId) => state[sessionId],
    write: (sessionId, value) => {
      state[sessionId] = value;
    },
  };
}

describe("matchWatchedCommands", () => {
  it("matches a command against a configured substring pattern", () => {
    expect(matchWatchedCommands("tsc --noEmit", ["tsc"])).toEqual(["tsc"]);
  });

  it("ignores a command matching no configured pattern entirely", () => {
    expect(matchWatchedCommands("grep foo bar.txt", ["tsc", "pytest"])).toEqual([]);
  });

  it("tracks a command matching two different patterns under both independently", () => {
    expect(matchWatchedCommands("npx tsc && pytest", ["tsc", "pytest"])).toEqual(["tsc", "pytest"]);
  });

  it("matches via regex, regardless of the exact arguments used", () => {
    expect(matchWatchedCommands("tsc --noEmit src/one.ts", ["tsc.*--noEmit"])).toEqual(["tsc.*--noEmit"]);
  });

  it("falls back to a plain substring test when a pattern isn't valid regex syntax", () => {
    expect(matchWatchedCommands("run [unclosed bracket] now", ["[unclosed"])).toEqual(["[unclosed"]);
  });
});

describe("truncateStderrTail", () => {
  it("keeps stderr at or under the line limit whole", () => {
    const stderr = Array.from({ length: FIX_NUDGE_STDERR_TAIL_LINES }, (_, i) => `line ${i}`).join("\n");
    expect(truncateStderrTail(stderr)).toBe(stderr);
  });

  it("truncates stderr longer than the line limit to only its last lines", () => {
    const lines = Array.from({ length: FIX_NUDGE_STDERR_TAIL_LINES + 10 }, (_, i) => `line ${i}`);
    const truncated = truncateStderrTail(lines.join("\n"));
    expect(truncated).toBe(lines.slice(-FIX_NUDGE_STDERR_TAIL_LINES).join("\n"));
    expect(truncated).not.toContain("line 0\n");
  });
});

describe("fixNudgeTransition", () => {
  it("no-prior-state -> failure: stores the record and never nudges", () => {
    const result = fixNudgeTransition(undefined, { command: "tsc", exitCode: 1, stderr: "boom" });
    expect(result.record).toEqual({ command: "tsc", stderrTail: "boom" });
    expect(result.nudge).toBeUndefined();
  });

  it("failure -> failure: updates the record to the latest failure's details and never nudges", () => {
    const previous = { command: "tsc", stderrTail: "old error" };
    const result = fixNudgeTransition(previous, { command: "tsc", exitCode: 2, stderr: "new error" });
    expect(result.record).toEqual({ command: "tsc", stderrTail: "new error" });
    expect(result.nudge).toBeUndefined();
  });

  it("failure -> success: nudges exactly once and clears the record", () => {
    const previous = { command: "tsc", stderrTail: "boom" };
    const result = fixNudgeTransition(previous, { command: "tsc", exitCode: 0, stderr: "" });
    expect(result.record).toBeUndefined();
    expect(result.nudge).toEqual({ failedCommand: "tsc", stderrTail: "boom" });
  });

  it("success -> success: never nudges", () => {
    const result = fixNudgeTransition(undefined, { command: "tsc", exitCode: 0, stderr: "" });
    expect(result.record).toBeUndefined();
    expect(result.nudge).toBeUndefined();
  });

  it("truncates stderr to the last 40 lines before storing it on a failure", () => {
    const lines = Array.from({ length: FIX_NUDGE_STDERR_TAIL_LINES + 5 }, (_, i) => `line ${i}`);
    const result = fixNudgeTransition(undefined, { command: "tsc", exitCode: 1, stderr: lines.join("\n") });
    expect(result.record?.stderrTail).toBe(lines.slice(-FIX_NUDGE_STDERR_TAIL_LINES).join("\n"));
  });
});

describe("fixNudgeText", () => {
  it("contains the failed command, the truncated stderr, and an explicit isError: true instruction", () => {
    const text = fixNudgeText({ failedCommand: "tsc --noEmit", stderrTail: "TS2322: boom" }, "tsc --noEmit src/one.ts");
    expect(text).toContain("tsc --noEmit");
    expect(text).toContain("TS2322: boom");
    expect(text).toContain("isError: true");
    expect(text).toContain("tsc --noEmit src/one.ts");
  });
});

describe("fixNudge (stateful production entrypoint)", () => {
  it("ignores a command matching no configured pattern entirely, writing no state", () => {
    const store = fakeStore();
    const output = fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc"],
      command: "grep foo bar.txt",
      exitCode: 1,
      stderr: "no match",
      stateStore: store,
    });
    expect(output).toEqual({});
    expect(store.read("s1")).toBeUndefined();
  });

  it("does not nudge on a first failure, and stores the Open Failure record", () => {
    const store = fakeStore();
    const output = fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc"],
      command: "tsc --noEmit",
      exitCode: 1,
      stderr: "TS2322: boom",
      stateStore: store,
    });
    expect(output).toEqual({});
    expect(store.read("s1")).toEqual({ tsc: { command: "tsc --noEmit", stderrTail: "TS2322: boom" } });
  });

  it("nudges on a failure->success transition and clears the record afterward", () => {
    const store = fakeStore();
    fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc"],
      command: "tsc --noEmit",
      exitCode: 1,
      stderr: "TS2322: boom",
      stateStore: store,
    });

    const output = fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc"],
      command: "tsc --noEmit",
      exitCode: 0,
      stderr: "",
      stateStore: store,
    }) as { hookSpecificOutput: { additionalContext: string } };

    expect(output.hookSpecificOutput.additionalContext).toContain("tsc --noEmit");
    expect(output.hookSpecificOutput.additionalContext).toContain("TS2322: boom");
    expect(output.hookSpecificOutput.additionalContext).toContain("isError: true");
    expect(store.read("s1")).toEqual({});
  });

  it("does not re-nudge on a subsequent success once the record is already cleared", () => {
    const store = fakeStore();
    fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc"],
      command: "tsc",
      exitCode: 1,
      stderr: "boom",
      stateStore: store,
    });
    fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc"],
      command: "tsc",
      exitCode: 0,
      stderr: "",
      stateStore: store,
    });

    const output = fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc"],
      command: "tsc",
      exitCode: 0,
      stderr: "",
      stateStore: store,
    });
    expect(output).toEqual({});
  });

  it("tracks two configured patterns independently: fixing one doesn't affect the other's open failure", () => {
    const store = fakeStore();
    fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc", "pytest"],
      command: "tsc",
      exitCode: 1,
      stderr: "tsc boom",
      stateStore: store,
    });
    fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc", "pytest"],
      command: "pytest",
      exitCode: 1,
      stderr: "pytest boom",
      stateStore: store,
    });

    const output = fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc", "pytest"],
      command: "tsc",
      exitCode: 0,
      stderr: "",
      stateStore: store,
    }) as { hookSpecificOutput: { additionalContext: string } };

    expect(output.hookSpecificOutput.additionalContext).toContain("tsc");
    expect(output.hookSpecificOutput.additionalContext).not.toContain("pytest boom");
    expect(store.read("s1")).toEqual({ pytest: { command: "pytest", stderrTail: "pytest boom" } });
  });

  it("returns {} (never throws) if the state store itself throws", () => {
    const brokenStore: FixNudgeStateStore = {
      read: () => {
        throw new Error("disk exploded");
      },
      write: () => {},
    };
    const output = fixNudge({
      storageRoot: "/tmp/does-not-matter",
      sessionId: "s1",
      watchedCommands: ["tsc"],
      command: "tsc",
      exitCode: 0,
      stderr: "",
      stateStore: brokenStore,
    });
    expect(output).toEqual({});
  });
});
