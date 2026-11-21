import { createMemory, applyOutcome, calculateStrength } from "hippo-memory";

/**
 * The one module in `hippo-memory-runner/` allowed to import the
 * `hippo-memory` npm package's in-process API directly. Every other
 * interaction with hippo-memory in this directory goes through the
 * CLI-subprocess boundary (`hippo-cli.ts`) instead, but
 * `feedback-formula-runner.ts` needs the real, unmodified
 * `createMemory`/`applyOutcome`/`calculateStrength` formula functions
 * themselves — not a CLI round-trip — to stress-test them directly. This
 * thin re-export is that call's adapter seam, per the
 * no-direct-third-party-import-outside-`adapters/` non-negotiable
 * (`CONTRIBUTING.md`).
 */
export { createMemory, applyOutcome, calculateStrength };
