import { describe, expect, it } from "vitest";
import { parseArgs } from "#src/args.js";

describe("parseArgs", () => {
  it("treats a bare positional argument as an id lookup", () => {
    expect(parseArgs(["mem_123"])).toEqual({ mode: "id", id: "mem_123", detailed: false });
  });

  it("treats --query=... as query-explain mode", () => {
    expect(parseArgs(["--query=why did retries fail"])).toEqual({
      mode: "query",
      query: "why did retries fail",
      detailed: false,
    });
  });

  it("treats --list as browse mode, with no filters by default", () => {
    expect(parseArgs(["--list"])).toEqual({ mode: "list", filters: {}, detailed: false });
  });

  it("--detailed toggles full verbosity on the id mode", () => {
    expect(parseArgs(["mem_123", "--detailed"])).toEqual({ mode: "id", id: "mem_123", detailed: true });
  });

  it("--detailed toggles full verbosity on query mode", () => {
    expect(parseArgs(["--query=x", "--detailed"])).toEqual({ mode: "query", query: "x", detailed: true });
  });

  it("--detailed toggles full verbosity on list mode", () => {
    expect(parseArgs(["--list", "--detailed"])).toEqual({ mode: "list", filters: {}, detailed: true });
  });

  it("combines --list with --kind, --tier, --min-strength/--max-strength, --scope, --since/--until", () => {
    const result = parseArgs([
      "--list",
      "--kind=decision",
      "--tier=stale",
      "--min-strength=0.1",
      "--max-strength=0.9",
      "--scope=global",
      "--since=2026-01-01",
      "--until=2026-06-01",
    ]);

    expect(result).toEqual({
      mode: "list",
      detailed: false,
      filters: {
        kind: "decision",
        confidenceTier: "stale",
        minStrength: 0.1,
        maxStrength: 0.9,
        scope: "global",
        since: "2026-01-01",
        until: "2026-06-01",
      },
    });
  });

  it("rejects a bare id combined with --list", () => {
    expect(() => parseArgs(["mem_123", "--list"])).toThrow(/exactly one/);
  });

  it("rejects a bare id combined with --query", () => {
    expect(() => parseArgs(["mem_123", "--query=x"])).toThrow(/exactly one/);
  });

  it("rejects --query combined with --list", () => {
    expect(() => parseArgs(["--query=x", "--list"])).toThrow(/exactly one/);
  });

  it("rejects no mode at all", () => {
    expect(() => parseArgs([])).toThrow(/exactly one/);
  });

  it("rejects an unknown --kind value", () => {
    expect(() => parseArgs(["--list", "--kind=bogus"])).toThrow(/Unknown --kind/);
  });

  it("rejects an unknown --tier value", () => {
    expect(() => parseArgs(["--list", "--tier=bogus"])).toThrow(/Unknown --tier/);
  });

  it("rejects an unknown --scope value", () => {
    expect(() => parseArgs(["--list", "--scope=bogus"])).toThrow(/Unknown --scope/);
  });

  it("rejects a non-numeric --min-strength", () => {
    expect(() => parseArgs(["--list", "--min-strength=abc"])).toThrow(/must be a number/);
  });

  it("rejects an unparseable --since", () => {
    expect(() => parseArgs(["--list", "--since=not-a-date"])).toThrow(/must be a valid date/);
  });

  it("rejects an unparseable --until", () => {
    expect(() => parseArgs(["--list", "--until=not-a-date"])).toThrow(/must be a valid date/);
  });
});
