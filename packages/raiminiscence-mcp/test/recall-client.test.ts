import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { servedRecall, startWarmProcess } from "#src/recall-client.js";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every `src/` file `entry` reaches through static imports, as paths relative to `src/`. */
function staticImportClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(SRC, file), "utf8");
    for (const [, specifier] of source.matchAll(/^(?:import|export)\s(?!type\b)[^;]*?from\s+"([^"]+)"/gms)) {
      const target = specifier!.startsWith("#src/")
        ? specifier!.slice("#src/".length)
        : specifier!.startsWith(".")
          ? join(dirname(file), specifier!)
          : undefined;
      if (target) pending.push(target.replace(/\.js$/, ".ts"));
    }
  }
  return seen;
}

describe("the light recall client (ADR-0039)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never statically imports the engine", () => {
    const closure = staticImportClosure("recall-client.ts");

    for (const heavy of [
      "core/engine.ts",
      "core/recall.ts",
      "core/remember.ts",
      "core/cached-query.ts",
      "core/warm-process.ts",
      "server.ts",
      "warm.ts",
    ]) {
      expect(closure).not.toContain(heavy);
    }
  });

  it("asks no server when RAIMINISCENCE_WARM_EMBED is off", async () => {
    vi.stubEnv("RAIMINISCENCE_WARM_EMBED", "off");

    expect(await servedRecall({ storageRoot: "/nowhere", query: "q", k: 10 })).toBeNull();
  });

  it("starts no warm process when RAIMINISCENCE_WARM_EMBED is off", () => {
    vi.stubEnv("RAIMINISCENCE_WARM_EMBED", "off");

    expect(startWarmProcess({ storageRoot: "/nowhere" })).toBe(false);
  });
});
