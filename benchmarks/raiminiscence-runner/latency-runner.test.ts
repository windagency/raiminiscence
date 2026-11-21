import { describe, expect, it } from "vitest";
import { shimContext } from "./latency-runner.js";

describe("shimContext", () => {
  it("returns the context the hook injected", () => {
    const stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "recalled" } });

    expect(shimContext(stdout)).toBe("recalled");
  });

  it("refuses an empty context, which is how the hook reports a recall that failed or timed out", () => {
    expect(() => shimContext(JSON.stringify({ hookSpecificOutput: { additionalContext: "" } }))).toThrow(/no context/);
    expect(() => shimContext("{}")).toThrow(/no context/);
  });
});
