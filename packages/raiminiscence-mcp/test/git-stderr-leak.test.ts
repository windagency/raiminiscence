import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FIXTURE_PATH = fileURLToPath(new URL("./git-stderr-leak-fixture.ts", import.meta.url));

/**
 * `git.ts`'s `gitFileChangeTimestamps`/`gitCommitSubjects` and
 * `writer-identity.ts`'s `gitConfigValue` are all documented as "never
 * throws" against a non-git `storageRoot` — but before `stdio: ["ignore",
 * "pipe", "ignore"]` was added to their `execFileSync` calls, the
 * catch-and-degrade only suppressed the thrown error, not git's own `fatal:
 * not a git repository` line, which — left unconfigured — `execFileSync`
 * inherits straight to the real process's stderr fd, bypassing Node's own
 * `process.stderr` stream object entirely. Observing that requires a real
 * subprocess boundary: this fixture runs in its own process (via `tsx`,
 * spawned with piped stdio), so anything git would have inherited from it
 * lands in this test's own captured `stderr`, not the real terminal.
 */
describe("git stderr leak: a non-git storageRoot degrades silently", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "raiminiscence-git-stderr-"));
  });

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("remember (writer-identity.ts's gitConfigValue) and consolidate (git.ts's timestamp/subject lookups) never leak git's fatal: text to stderr", () => {
    const result = spawnSync("npx", ["tsx", FIXTURE_PATH, storageRoot], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("fatal:");
  });
});
