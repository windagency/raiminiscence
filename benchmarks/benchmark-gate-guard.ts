import { spawn, type SpawnOptions } from "node:child_process";
import { loadavg } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * What keeps a day-long benchmark-gate run from stalling unnoticed: a wait for
 * a quiet host before each step, and a watchdog that kills a command gone
 * silent so its step can be retried. On 2026-11-10 a saturated host starved
 * Ollama and one step hung for six hours with no output.
 */

/** A command that printed nothing for its whole silence window and was killed. */
export class StallError extends Error {
  override name = "StallError";
}

export interface QuietHostOptions {
  maxLoad: number;
  pollMs: number;
  load?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  log?: (line: string) => void;
}

/** Waits until the one-minute load average is at or below `maxLoad`, logging each wait so the run's log shows why it paused. */
export async function waitForQuietHost({ maxLoad, pollMs, load = () => loadavg()[0]!, sleep: wait = sleep, log = console.log }: QuietHostOptions) {
  for (let current = load(); current > maxLoad; current = load()) {
    log(`waiting: load average ${current.toFixed(1)} is above ${maxLoad}`);
    await wait(pollMs);
  }
}

export interface WatchedOptions extends Omit<SpawnOptions, "stdio" | "detached"> {
  silenceMs: number;
  /** Copies the command's output to this process's own; on by default. */
  echo?: boolean;
  onStdout?: (text: string) => void;
}

// Each command runs in its own process group so a stall kills its workers too, which leaves them outside the
// terminal's group: an interrupt or termination of this process is passed on to them by hand.
const liveGroups = new Set<number>();
let forwarding = false;

function killGroup(pid: number) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group already exited.
  }
}

function forwardSignals() {
  if (forwarding) return;
  forwarding = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      for (const pid of liveGroups) killGroup(pid);
      process.exit(128 + (signal === "SIGINT" ? 2 : 15));
    });
  }
}

/** Runs a command and resolves its stdout; kills its whole process group and rejects with a `StallError` after `silenceMs` without output. */
export function runWatched(command: string, args: string[], { silenceMs, echo = true, onStdout, ...options }: WatchedOptions): Promise<string> {
  forwardSignals();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const pid = child.pid;
    if (pid !== undefined) liveGroups.add(pid);
    let stdout = "";
    let stalled = false;
    let timer: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        if (pid !== undefined) killGroup(pid);
      }, silenceMs);
    };
    child.stdout.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
      if (echo) process.stdout.write(text);
      onStdout?.(text);
      arm();
    });
    child.stderr.setEncoding("utf8").on("data", (text: string) => {
      if (echo) process.stderr.write(text);
      arm();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (pid !== undefined) {
        liveGroups.delete(pid);
        // Workers that outlived the command would hold its store or its port.
        killGroup(pid);
      }
      const shown = `${command} ${args.join(" ")}`;
      if (stalled) reject(new StallError(`${shown} printed nothing for ${Math.round(silenceMs / 60_000)} min and was killed`));
      else if (code === 0) resolve(stdout);
      else reject(new Error(`${shown} exited with ${code ?? signal}`));
    });
    arm();
  });
}

/** Runs `body`; on a stall, waits through `beforeRetry` and runs it once more. A second stall, or any other failure, propagates. */
export async function withStallRetry<T>(
  body: () => Promise<T>,
  beforeRetry: () => Promise<void>,
  log: (line: string) => void = console.log,
): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (!(error instanceof StallError)) throw error;
    log(`${error.message}; retrying once`);
    await beforeRetry();
    return body();
  }
}
