import { spawn } from "node:child_process";

/**
 * ADR-0040: starts `command` in its own process group with no stdio, and
 * lets this process exit without waiting for it. A spawn failure is
 * dropped: nothing waits on the child.
 */
export function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
