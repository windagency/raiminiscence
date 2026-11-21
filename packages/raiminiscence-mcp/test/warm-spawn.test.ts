import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recallSocketPath } from "#src/core/recall-socket.js";
import { claimWarmSpawn, spawnWarmProcess, WARM_SPAWN_INTERVAL_MS, warmMarkerPath } from "#src/core/warm-spawn.js";

const IDENTITY = { provider: "embedded", model: "nomic-ai/nomic-embed-text-v1" };

describe("warmMarkerPath (ADR-0040)", () => {
  it("sits next to the recall socket, with the same hash", () => {
    const marker = warmMarkerPath("/work/project", IDENTITY, "/home/u");
    const socket = recallSocketPath("/work/project", IDENTITY, "/home/u");

    expect(dirname(marker)).toBe(dirname(socket));
    expect(basename(marker)).toBe(
      basename(socket)
        .replace(/^recall-/, "warm-")
        .replace(/\.sock$/, ".spawned"),
    );
  });
});

describe("the warm process spawn throttle (ADR-0040)", () => {
  let home: string;
  let marker: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rai-warm-spawn-"));
    marker = warmMarkerPath(join(home, "project"), IDENTITY, home);
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("claims the first spawn and leaves a marker in an owner-only directory", () => {
    expect(claimWarmSpawn(marker)).toBe(true);
    expect(existsSync(marker)).toBe(true);
    expect(statSync(dirname(marker)).mode & 0o777).toBe(0o700);
  });

  it("refuses a second spawn within the interval", () => {
    claimWarmSpawn(marker);

    expect(claimWarmSpawn(marker)).toBe(false);
  });

  it("claims again once the interval has passed", () => {
    claimWarmSpawn(marker);

    expect(claimWarmSpawn(marker, Date.now() + WARM_SPAWN_INTERVAL_MS + 1)).toBe(true);
  });

  it("spawns the entry point with the storage root and its own pid, once per interval", () => {
    const spawns: { command: string; args: string[] }[] = [];
    const request = {
      storageRoot: join(home, "project"),
      identity: IDENTITY,
      entry: "/pkg/dist/warm.js",
      home,
      spawn: (command: string, args: string[]) => spawns.push({ command, args }),
    };

    expect(spawnWarmProcess(request)).toBe(true);
    expect(spawnWarmProcess(request)).toBe(false);
    expect(spawns).toEqual([{ command: process.execPath, args: ["/pkg/dist/warm.js", join(home, "project"), String(process.pid)] }]);
  });

  it("never throws, even when the spawn does", () => {
    const request = {
      storageRoot: join(home, "project"),
      identity: IDENTITY,
      entry: "/pkg/dist/warm.js",
      home,
      spawn: () => {
        throw new Error("EAGAIN");
      },
    };

    expect(spawnWarmProcess(request)).toBe(false);
  });
});
