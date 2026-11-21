import { describe, expect, it } from "vitest";
import { StallError, runWatched, waitForQuietHost, withStallRetry } from "./benchmark-gate-guard.js";

const quiet = { log: () => {} };
// Wide enough for a node child to start on a loaded host; a stall test waits this long once.
const SILENCE_MS = 3000;

async function exits(pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

describe("waitForQuietHost", () => {
  it("polls until the load average drops to the threshold", async () => {
    const loads = [14, 11, 8];
    const waits: number[] = [];

    await waitForQuietHost({ maxLoad: 10, pollMs: 5, load: () => loads.shift()!, sleep: async (ms) => void waits.push(ms), ...quiet });

    expect(waits).toEqual([5, 5]);
    expect(loads).toEqual([]);
  });

  it("returns at once on a quiet host", async () => {
    const waits: number[] = [];

    await waitForQuietHost({ maxLoad: 10, pollMs: 5, load: () => 3, sleep: async (ms) => void waits.push(ms), ...quiet });

    expect(waits).toEqual([]);
  });
});

describe("runWatched", () => {
  it("returns stdout of a command that keeps talking and exits cleanly", async () => {
    const script = "for (let i = 0; i < 3; i++) { console.log(i); await new Promise((r) => setTimeout(r, 50)); }";

    await expect(runWatched("node", ["--input-type=module", "-e", script], { silenceMs: SILENCE_MS, echo: false })).resolves.toBe("0\n1\n2\n");
  });

  // The guard kills a POSIX process group, which Windows does not have.
  it.skipIf(process.platform === "win32")("kills a command that goes silent, with its children, and reports a stall", async () => {
    // The child starts a grandchild that sleeps, prints its pid, then hangs: both must die.
    const script = [
      "import { spawn } from 'node:child_process';",
      "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
      "console.log(grandchild.pid);",
      "setTimeout(() => {}, 60000);",
    ].join("\n");
    let grandchildPid = 0;

    const failure = await runWatched("node", ["--input-type=module", "-e", script], {
      silenceMs: SILENCE_MS,
      echo: false,
      onStdout: (text) => (grandchildPid ||= Number(text.trim())),
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(StallError);
    expect(grandchildPid).toBeGreaterThan(0);
    expect(await exits(grandchildPid)).toBe(true);
  });

  it("rejects a command that exits non-zero, without calling it a stall", async () => {
    const failure = await runWatched("node", ["-e", "process.exit(3)"], { silenceMs: SILENCE_MS, echo: false }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(StallError);
    expect((failure as Error).message).toMatch(/exited with 3/);
  });
});

describe("withStallRetry", () => {
  it("retries a stalled body once, after the pre-retry wait", async () => {
    const calls: string[] = [];
    let attempts = 0;

    const result = await withStallRetry(
      async () => {
        calls.push("body");
        if (++attempts === 1) throw new StallError("silent");
        return "done";
      },
      async () => void calls.push("wait"),
      quiet.log,
    );

    expect(result).toBe("done");
    expect(calls).toEqual(["body", "wait", "body"]);
  });

  it("gives up on a second stall", async () => {
    const body = async () => {
      throw new StallError("silent");
    };

    await expect(withStallRetry(body, async () => {}, quiet.log)).rejects.toBeInstanceOf(StallError);
  });

  it("does not retry an ordinary failure", async () => {
    let attempts = 0;
    const body = async () => {
      attempts++;
      throw new Error("broken");
    };

    await expect(withStallRetry(body, async () => {}, quiet.log)).rejects.toThrow("broken");
    expect(attempts).toBe(1);
  });
});
