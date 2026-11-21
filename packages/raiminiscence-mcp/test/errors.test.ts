import { describe, expect, it } from "vitest";
import { OperationalError } from "#src/core/errors.js";

describe("OperationalError", () => {
  it("is an instanceof Error", () => {
    expect(new OperationalError("bad input")).toBeInstanceOf(Error);
  });

  it("round-trips a cause", () => {
    const cause = new Error("underlying reason");
    const error = new OperationalError("bad input", { cause });
    expect(error.cause).toBe(cause);
  });
});
