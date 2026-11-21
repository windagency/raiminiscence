#!/usr/bin/env node
import { resolveStorageRoot } from "raiminiscence-mcp";
import { runInspectCli } from "./run.js";

async function main(): Promise<void> {
  const output = await runInspectCli(process.argv.slice(2), {
    storageRoot: resolveStorageRoot(),
  });
  console.log(output);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
