import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectMemory, inspectQuery, recall, remember } from "#src/core/engine.js";

describe("detail carries the whole Memory body (ADR-0033)", () => {
  let storageRoot: string;
  const body = `Kafka consumer lag runbook\n${"Step: check the partition offsets and restart the stuck consumer. ".repeat(80)}`;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-detail-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("returns a long body untruncated from recall", async () => {
    await remember({ content: body, client: "claude-code", storageRoot, triggerConsolidation: false });

    const result = await recall({ query: "kafka consumer lag", storageRoot, triggerConsolidation: false });

    expect(result.results[0]?.detail).toBe(body);
  });

  it("returns a long body untruncated from inspectQuery and inspectMemory", async () => {
    const remembered = await remember({ content: body, client: "claude-code", storageRoot, triggerConsolidation: false });

    const queried = await inspectQuery({ query: "kafka consumer lag", storageRoot });

    expect(queried.results[0]?.detail).toBe(body);
    expect(inspectMemory({ id: remembered.id, storageRoot }).detail).toBe(body);
  });
});
