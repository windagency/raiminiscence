#!/usr/bin/env node
import { runInstallCli } from "./run-install-cli.js";

function main(): void {
  for (const line of runInstallCli(process.argv.slice(2))) {
    console.log(line);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
