import { describe, expect, it, vi } from "vitest";
import { runSharedMemorySessionEnd, sharedMemorySessionStartNote } from "#src/shared-memory-sync.js";

describe("sharedMemorySessionStartNote", () => {
  it("returns '' without touching setup/pull when Shared Memory isn't enabled for this project", () => {
    const ensureWorktree = vi.fn();
    const pull = vi.fn();

    const note = sharedMemorySessionStartNote({
      storageRoot: "/tmp/does-not-matter",
      sharedMemoryEnabled: () => false,
      ensureWorktree,
      pull,
    });

    expect(note).toBe("");
    expect(ensureWorktree).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
  });

  it("returns '' for a clean pull with nothing to reconcile", () => {
    const note = sharedMemorySessionStartNote({
      storageRoot: "/tmp/does-not-matter",
      sharedMemoryEnabled: () => true,
      ensureWorktree: () => undefined,
      pull: () => ({ pulled: true, autoResolvedFiles: [] }),
    });

    expect(note).toBe("");
  });

  it("names the auto-resolved files when the merge driver actually had to resolve something", () => {
    const note = sharedMemorySessionStartNote({
      storageRoot: "/tmp/does-not-matter",
      sharedMemoryEnabled: () => true,
      ensureWorktree: () => undefined,
      pull: () => ({ pulled: true, autoResolvedFiles: ["co-access/a__b.json"] }),
    });

    expect(note).toContain("co-access/a__b.json");
  });

  it("never throws: a setup/pull failure is swallowed to ''", () => {
    const note = sharedMemorySessionStartNote({
      storageRoot: "/tmp/does-not-matter",
      sharedMemoryEnabled: () => true,
      ensureWorktree: () => {
        throw new Error("git unavailable");
      },
      pull: () => ({ pulled: false, autoResolvedFiles: [] }),
    });

    expect(note).toBe("");
  });
});

describe("runSharedMemorySessionEnd", () => {
  it("v19 (ADR-0025): calls consolidate with awaitPush: true unconditionally, not gated on Shared Memory being enabled", async () => {
    const consolidate = vi.fn().mockResolvedValue({});

    await runSharedMemorySessionEnd({
      storageRoot: "/tmp/does-not-matter",
      settleOpportunisticConsolidation: vi.fn().mockResolvedValue(undefined),
      consolidate,
    });

    expect(consolidate).toHaveBeenCalledWith(expect.objectContaining({ storageRoot: "/tmp/does-not-matter", awaitPush: true }));
  });

  it("awaits any in-flight opportunistic pass, then its pending push, before forcing the new one, so the two can't race", async () => {
    const order: string[] = [];
    const settleOpportunisticConsolidation = vi.fn().mockImplementation(async () => {
      order.push("pass settled");
    });
    const settlePendingSharedMemoryPush = vi.fn().mockImplementation(async () => {
      order.push("push settled");
    });
    const consolidate = vi.fn().mockImplementation(async () => {
      order.push("consolidated");
      return {};
    });

    await runSharedMemorySessionEnd({
      storageRoot: "/tmp/does-not-matter",
      settleOpportunisticConsolidation,
      settlePendingSharedMemoryPush,
      consolidate,
    });

    expect(order).toEqual(["pass settled", "push settled", "consolidated"]);
  });

  it("passes now through to consolidate when provided", async () => {
    const consolidate = vi.fn().mockResolvedValue({});
    const now = new Date("2026-01-01T00:00:00.000Z");

    await runSharedMemorySessionEnd({
      storageRoot: "/tmp/does-not-matter",
      now,
      settleOpportunisticConsolidation: vi.fn().mockResolvedValue(undefined),
      consolidate,
    });

    expect(consolidate).toHaveBeenCalledWith(expect.objectContaining({ now }));
  });

  it("never throws: a consolidate failure — including a failed or unreachable git push — is swallowed", async () => {
    await expect(
      runSharedMemorySessionEnd({
        storageRoot: "/tmp/does-not-matter",
        settleOpportunisticConsolidation: vi.fn().mockResolvedValue(undefined),
        consolidate: vi.fn().mockRejectedValue(new Error("push failed")),
      }),
    ).resolves.toBeUndefined();
  });

  it("never throws: a settle failure is also swallowed", async () => {
    await expect(
      runSharedMemorySessionEnd({
        storageRoot: "/tmp/does-not-matter",
        settleOpportunisticConsolidation: vi.fn().mockRejectedValue(new Error("in-flight pass failed")),
        consolidate: vi.fn().mockResolvedValue({}),
      }),
    ).resolves.toBeUndefined();
  });

  it("never throws: a pending-push settle failure is also swallowed", async () => {
    await expect(
      runSharedMemorySessionEnd({
        storageRoot: "/tmp/does-not-matter",
        settleOpportunisticConsolidation: vi.fn().mockResolvedValue(undefined),
        settlePendingSharedMemoryPush: vi.fn().mockRejectedValue(new Error("prior push failed")),
        consolidate: vi.fn().mockResolvedValue({}),
      }),
    ).resolves.toBeUndefined();
  });
});
