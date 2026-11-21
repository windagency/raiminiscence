import { setTimeout as sleep } from "node:timers/promises";

/**
 * ADR-0040: the warm process's entry point, spawned detached by the
 * per-turn hook from the project's working directory. Never run by hand.
 *
 * usage: node dist/warm.js <storageRoot> <hookPid>
 */

/** The longest it waits for the hook that started it to exit. */
const HOOK_EXIT_WAIT_MS = 10_000;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const [storageRoot, hookPid] = process.argv.slice(2);
  // Load nothing heavy until the hook has exited, so this process's model load never slows the prompt that started it.
  const deadline = Date.now() + HOOK_EXIT_WAIT_MS;
  while (hookPid && isRunning(Number(hookPid)) && Date.now() < deadline) await sleep(10);

  const { startWarmProcessFromConfig } = await import("./core/warm-process-main.js");
  await startWarmProcessFromConfig(storageRoot);
  process.exit(0);
}

main().catch(() => process.exit(1));
