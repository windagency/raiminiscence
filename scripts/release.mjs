#!/usr/bin/env node
// Lockstep release helper for semantic-release (release.config.js runs it through @semantic-release/exec).
// Every workspace package ships under the one version semantic-release computes, so a release is one tag,
// one CHANGELOG.md section and one GitHub Release for all four packages (ADR-0026).
//
//   node scripts/release.mjs prepare <version>  writes <version> into the root and every package.json, then
//                                                packs each package into release-tarball/ with `pnpm pack`
//                                                (which rewrites `workspace:*` to <version>; `npm pack` would not)
//   node scripts/release.mjs publish <dist-tag> stages every packed tarball with `npm stage publish --provenance`
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARBALL_DIR = join(ROOT, "release-tarball");

// Dependencies before dependents. Staging doesn't resolve dependencies, but if a run stops partway, the
// packages already staged are ones the rest can depend on.
const PACKAGES = ["raiminiscence-mcp", "raiminiscence-argv", "raiminiscence-hooks", "raiminiscence-cli"];

const [command, arg] = process.argv.slice(2);

const writeVersion = (manifestPath, version) => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const prepare = (version) => {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) throw new Error(`prepare: not a SemVer version: ${version}`);
  writeVersion(join(ROOT, "package.json"), version);
  for (const name of PACKAGES) writeVersion(join(ROOT, "packages", name, "package.json"), version);

  rmSync(TARBALL_DIR, { recursive: true, force: true });
  mkdirSync(TARBALL_DIR);
  for (const name of PACKAGES) {
    execFileSync("pnpm", ["pack", "--pack-destination", TARBALL_DIR], { cwd: join(ROOT, "packages", name), stdio: "inherit" });
  }
};

const publish = (distTag) => {
  if (!distTag) throw new Error("publish: missing dist-tag");
  const tarballs = readdirSync(TARBALL_DIR);
  for (const name of PACKAGES) {
    const tarball = tarballs.find((file) => file.startsWith(`${name}-`) && file.endsWith(".tgz"));
    if (!tarball) throw new Error(`publish: no tarball for ${name} in ${TARBALL_DIR}`);
    execFileSync("npm", ["stage", "publish", join(TARBALL_DIR, tarball), "--provenance", "--tag", distTag], { stdio: "inherit" });
  }
};

if (command === "prepare") prepare(arg);
else if (command === "publish") publish(arg);
else {
  console.error("usage: node scripts/release.mjs prepare <version> | publish <dist-tag>");
  process.exit(2);
}
