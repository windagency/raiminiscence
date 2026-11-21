#!/usr/bin/env node
// Checks test-first commit order on a pull request (CODING_RULES/01-principles.md): every commit touching
// implementation must follow an earlier test-only commit, and newly added test files must fail at the
// commit that adds them. A commit carrying a `TDD-Exempt: <reason>` trailer is skipped.
//
//   node scripts/check-tdd-order.mjs <base-sha> <head-sha>
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error("usage: node scripts/check-tdd-order.mjs <base-sha> <head-sha>");
  process.exit(2);
}

const git = (args, options = {}) => execFileSync("git", args, { encoding: "utf8", ...options });

// Mirrors vitest.config.ts's `include` for the workspace packages.
const isTestFile = (file) => /^(packages\/[^/]+\/(test|__tests__)|__tests__)\/.+\.test\.ts$/.test(file);
const isSourceFile = (file) => /^packages\/[^/]+\/src\/.+\.ts$/.test(file) && !file.endsWith(".d.ts");

const commits = git(["rev-list", "--reverse", "--no-merges", `${base}..${head}`])
  .split("\n")
  .filter(Boolean);

const describe = (sha) => git(["log", "-1", "--format=%h %s", sha]).trim();
const isExempt = (sha) => /^TDD-Exempt:\s*\S/m.test(git(["log", "-1", "--format=%B", sha]));

const changesOf = (sha) => {
  const tokens = git(["diff-tree", "--no-commit-id", "-r", "--name-status", "--no-renames", "-z", sha]).split("\0").filter(Boolean);
  const changes = [];
  for (let i = 0; i < tokens.length; i += 2) {
    changes.push({ status: tokens[i], file: tokens[i + 1] });
  }
  return changes;
};

// Tests in one package import its siblings through their built dist/, so the commit gets its own install
// (offline, from the store CI's install already filled) and build before its new tests run.
const runNewTestsAt = (sha, files) => {
  const worktree = mkdtempSync(path.join(os.tmpdir(), "tdd-order-"));
  const run = (command, args) => execFileSync(command, args, { cwd: worktree, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git(["worktree", "add", "--detach", worktree, sha], { stdio: "ignore" });
    try {
      run("pnpm", ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"]);
      run("pnpm", ["run", "build"]);
    } catch (error) {
      return { status: "setup", output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    }
    try {
      const output = run("pnpm", ["exec", "vitest", "run", ...files]);
      return { status: 0, output };
    } catch (error) {
      return { status: error.status, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    }
  } finally {
    git(["worktree", "remove", "--force", worktree], { stdio: "ignore" });
    rmSync(worktree, { recursive: true, force: true });
  }
};

const violations = [];
let earlierTestOnlyCommit = false;

for (const sha of commits) {
  const changes = changesOf(sha);
  const touchesTests = changes.some((change) => isTestFile(change.file));
  const touchesSource = changes.some((change) => isSourceFile(change.file));
  const exempt = isExempt(sha);
  const label = describe(sha);

  if (touchesSource && !exempt) {
    if (touchesTests) {
      violations.push(`${label}: tests and implementation share one commit; split them, test commit first`);
    } else if (!earlierTestOnlyCommit) {
      violations.push(`${label}: implementation has no earlier test-only commit`);
    }
  }

  if (touchesTests && !touchesSource) {
    earlierTestOnlyCommit = true;

    const addedTests = changes.filter((change) => change.status === "A" && isTestFile(change.file)).map((change) => change.file);

    if (addedTests.length > 0 && !exempt) {
      const result = runNewTestsAt(sha, addedTests);
      if (result.status === "setup") {
        violations.push(`${label}: install or build failed at this commit, so its new tests could not run`);
      } else if (result.status === 0) {
        violations.push(`${label}: new tests pass before implementation; they must fail first`);
      } else if (result.output.includes("No test files found")) {
        violations.push(`${label}: new test files are not matched by vitest.config.ts's include`);
      } else if (result.status !== 1) {
        violations.push(`${label}: vitest exited ${result.status} at this commit, expected a test failure`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("tdd-order: violations found");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  console.error("Exempt a commit with a 'TDD-Exempt: <reason>' trailer when TDD does not apply.");
  process.exitCode = 1;
} else {
  console.log(`tdd-order: ${commits.length} commit(s) checked, no violations`);
}
