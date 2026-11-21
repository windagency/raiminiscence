import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerLogger } from "#src/adapters/logger.js";

const warnings: { fields: Record<string, unknown>; msg?: string }[] = [];
const stubLogger: ServerLogger = {
  debug: () => {},
  info: () => {},
  warn: (fields, msg) => warnings.push({ fields, msg }),
  error: () => {},
};

vi.mock("#src/adapters/logger.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fallbackLogger: () => stubLogger,
}));

const { findMemoryById, kindDir, readAllMemories, readMemory, writeMemory } = await import("#src/core/storage.js");
const { parseMemoryFrontmatter } = await import("#src/core/memory-frontmatter-schema.js");

const VALID_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const INVALID_ID = "01ARZ3NDEKTSV4RRFFQ69G5FBX";

function frontmatterYaml(id: string, kind: string): string {
  return [
    "---",
    `id: ${id}`,
    "schemaVersion: 3",
    `kind: ${kind}`,
    "confidence: observed",
    "isError: false",
    "createdAt: '2026-01-01T00:00:00.000Z'",
    "lastRecalledAt: null",
    "recallCount: 0",
    "consolidationSurvivalCount: 0",
    "baseHalfLifeDays: 7",
    "retractedAt: null",
    "retractReason: null",
    "source:",
    "  client: claude-code",
    "scope: project",
    "originatingProject: null",
    "promotedFrom: null",
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
}

describe("Memory frontmatter validation", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-frontmatter-validation-"));
    warnings.length = 0;
    const dir = kindDir(storageRoot, "episodic");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${VALID_ID}.md`), frontmatterYaml(VALID_ID, "episodic"));
    // A file altered outside the tools, or badly merged: `kind` isn't a Memory Kind.
    writeFileSync(join(dir, `${INVALID_ID}.md`), frontmatterYaml(INVALID_ID, "bogus"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("readAllMemories skips a file whose frontmatter fails validation and keeps the valid ones", () => {
    const ids = readAllMemories(storageRoot).map((m) => m.frontmatter.id);
    expect(ids).toEqual([VALID_ID]);
  });

  it("logs a structured warning naming the skipped file", () => {
    readAllMemories(storageRoot);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.fields.path).toBe(join(kindDir(storageRoot, "episodic"), `${INVALID_ID}.md`));
    expect(warnings[0]!.msg).toMatch(/failed validation/);
  });

  it("readMemory and findMemoryById treat an invalid file as absent, with a warning", () => {
    expect(readMemory(storageRoot, "episodic", INVALID_ID)).toBeNull();
    expect(findMemoryById(storageRoot, INVALID_ID)).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("emits no warning when every file is valid", () => {
    expect(readMemory(storageRoot, "episodic", VALID_ID)).not.toBeNull();
    expect(warnings).toEqual([]);
  });

  it("keeps fields this version doesn't know about through a read/write round trip", () => {
    const path = join(kindDir(storageRoot, "episodic"), `${VALID_ID}.md`);
    writeFileSync(path, frontmatterYaml(VALID_ID, "episodic").replace("promotedFrom: null", "promotedFrom: null\nfutureField: kept"));

    const memory = readMemory(storageRoot, "episodic", VALID_ID)!;
    writeMemory(storageRoot, memory);

    expect(readFileSync(path, "utf8")).toContain("futureField: kept");
  });
});

describe("parseMemoryFrontmatter", () => {
  const v1 = {
    id: VALID_ID,
    schemaVersion: 1,
    kind: "episodic",
    confidence: "observed",
    isError: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastRecalledAt: null,
    recallCount: 0,
    consolidationSurvivalCount: 0,
    baseHalfLifeDays: 7,
    retractedAt: null,
    retractReason: null,
    source: { client: "claude-code" },
    scope: "project",
    originatingProject: null,
    promotedFrom: null,
  };

  it("accepts a v1 frontmatter missing every field added since", () => {
    expect(parseMemoryFrontmatter(v1)).not.toBeNull();
  });

  it.each([
    ["a missing id", { ...v1, id: undefined }],
    ["an unknown confidence tier", { ...v1, confidence: "certain" }],
    ["a non-numeric recallCount", { ...v1, recallCount: "3" }],
    ["a createdAt YAML parsed as a date, not a string", { ...v1, createdAt: new Date("2026-01-01T00:00:00.000Z") }],
    ["a source without a client", { ...v1, source: {} }],
    ["an unknown scope", { ...v1, scope: "team" }],
    ["a writer without a sessionId", { ...v1, writer: { gitName: "x" } }],
    ["a non-object", "not frontmatter"],
  ])("rejects %s", (_label, payload) => {
    expect(parseMemoryFrontmatter(payload)).toBeNull();
  });
});
