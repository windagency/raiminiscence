import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryStoreDir } from "#src/core/storage.js";
import { readAllRecords, readRecord, recordKeys, removeRecord, withRecord, writeRecord, writeRecordIfUnchanged } from "#src/core/record-index.js";

const INDEX_NAME = "test-records";

describe("recordIndex", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-record-index-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("reads a missing record as undefined, not a throw", () => {
    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toBeUndefined();
  });

  it("writes and reads back a record", () => {
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 2 });
    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toEqual({ weight: 2 });
  });

  it("two different records never touch each other's file", () => {
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 2 });
    writeRecord(storageRoot, INDEX_NAME, "c|d", { weight: 4 });

    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toEqual({ weight: 2 });
    expect(readRecord(storageRoot, INDEX_NAME, "c|d")).toEqual({ weight: 4 });

    const dir = join(memoryStoreDir(storageRoot), INDEX_NAME);
    expect(readdirSync(dir).sort()).toEqual(["a__b.json", "c__d.json"]);
  });

  it("throws a descriptive error for a corrupt record file", () => {
    const dir = join(memoryStoreDir(storageRoot), INDEX_NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a__b.json"), "{ not valid json", "utf8");

    expect(() => readRecord(storageRoot, INDEX_NAME, "a|b")).toThrow(/corrupt/);
  });

  it("removeRecord deletes the file; a subsequent read is undefined", () => {
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 2 });
    removeRecord(storageRoot, INDEX_NAME, "a|b");
    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toBeUndefined();
  });

  it("recordKeys lists every key currently on disk, decoded back to original form", () => {
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 2 });
    writeRecord(storageRoot, INDEX_NAME, "c|d", { weight: 4 });
    expect(recordKeys(storageRoot, INDEX_NAME).sort()).toEqual(["a|b", "c|d"]);
  });

  it("recordKeys returns an empty array when the index directory doesn't exist yet", () => {
    expect(recordKeys(storageRoot, INDEX_NAME)).toEqual([]);
  });

  it("readAllRecords assembles every record into one map", () => {
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 2 });
    writeRecord(storageRoot, INDEX_NAME, "c|d", { weight: 4 });
    expect(readAllRecords(storageRoot, INDEX_NAME)).toEqual({ "a|b": { weight: 2 }, "c|d": { weight: 4 } });
  });

  it("withRecord mutates an existing record and persists the result", () => {
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 2 });
    withRecord<{ weight: number }>(storageRoot, INDEX_NAME, "a|b", (current) => ({ weight: (current?.weight ?? 0) + 1 }));
    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toEqual({ weight: 3 });
  });

  it("withRecord creates a record from an absent one", () => {
    withRecord<{ weight: number }>(storageRoot, INDEX_NAME, "a|b", (current) => ({ weight: (current?.weight ?? 0) + 1 }));
    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toEqual({ weight: 1 });
  });

  it("withRecord deletes the record when the mutator returns undefined", () => {
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 2 });
    withRecord<{ weight: number }>(storageRoot, INDEX_NAME, "a|b", () => undefined);
    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toBeUndefined();
  });

  it("writeRecordIfUnchanged applies the write when expectedUpdatedAt matches the on-disk state", () => {
    const applied = writeRecordIfUnchanged(storageRoot, INDEX_NAME, "a|b", undefined, { weight: 1, updatedAt: "t1" });
    expect(applied).toBe(true);
    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toEqual({ weight: 1, updatedAt: "t1" });
  });

  it("writeRecordIfUnchanged refuses the write when the on-disk updatedAt has moved on", () => {
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 1, updatedAt: "t1" });
    // Someone else wrote to the record after t1.
    writeRecord(storageRoot, INDEX_NAME, "a|b", { weight: 2, updatedAt: "t2" });

    const applied = writeRecordIfUnchanged(storageRoot, INDEX_NAME, "a|b", "t1", { weight: 99, updatedAt: "t3" });

    expect(applied).toBe(false);
    expect(readRecord(storageRoot, INDEX_NAME, "a|b")).toEqual({ weight: 2, updatedAt: "t2" });
  });
});
