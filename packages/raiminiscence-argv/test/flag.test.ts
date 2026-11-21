import { describe, expect, it } from "vitest";
import { flag } from "#src/flag.js";

describe("flag", () => {
  it("returns the value of a matching --name=value argument", () => {
    expect(flag(["--client=cursor", "--scope=user"], "client")).toBe("cursor");
  });

  it("returns undefined when the flag isn't present", () => {
    expect(flag(["--scope=user"], "client")).toBeUndefined();
  });

  it("returns an empty string for --name= with no value", () => {
    expect(flag(["--client="], "client")).toBe("");
  });

  it("keeps everything after the first = as the value, including a literal = inside it", () => {
    expect(flag(["--query=why did retries=3 fail"], "query")).toBe("why did retries=3 fail");
  });
});
