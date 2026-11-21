#!/usr/bin/env node
// Generates THIRD_PARTY_LICENSES.md from `pnpm licenses list --prod --json --recursive` plus each
// package's own licence file (read from node_modules, never hand-typed) so the doc can never
// drift from what's actually installed. Run `node scripts/generate-third-party-licenses.mjs` to
// write it, or `--check` (what CI runs) to fail without writing if the committed file is stale.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "THIRD_PARTY_LICENSES.md");
const CHECK = process.argv.includes("--check");

// SPDX ids with no copyleft or "contact the author" obligations. Anything outside this list
// fails the generator instead of silently shipping an unreviewed licence into the doc.
const PERMISSIVE_ALLOWLIST = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "Python-2.0",
  "Unlicense",
]);

// Prebuilt native binaries published once per platform (the package declares `os`/`cpu` and carries the
// platform in its name). pnpm installs only the current machine's variant, so listing them by name would
// make this file differ between a macOS laptop and the Linux CI runner. They're rendered from this fixed,
// reviewed list instead; a platform package matching no entry fails the generator until it's reviewed.
const PLATFORM_PACKAGES = [
  {
    pattern: /^@img\/sharp-libvips-/,
    label: "@img/sharp-libvips-<platform>",
    license: "LGPL-3.0-or-later",
    note: "The libvips image library, prebuilt and loaded at runtime by `sharp`. Pulled in by `@huggingface/transformers` (the Embedded Provider). LGPL applies to libvips itself; it is not linked into, or redistributed with, this project's own code.",
  },
  {
    pattern: /^@img\/sharp-/,
    label: "@img/sharp-<platform>",
    license: "Apache-2.0",
    note: "The prebuilt native `sharp` binding for the current platform.",
  },
];

const LICENSE_FILENAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "LICENCE.txt", "License"];

function readLicenseFile(packageDir) {
  const entries = readdirSync(packageDir);
  const match = LICENSE_FILENAMES.find((name) => entries.includes(name));
  if (!match) return null;
  // Some packages ship CRLF licence files. .gitattributes commits THIRD_PARTY_LICENSES.md as LF, so
  // copying CRLF verbatim makes --check fail on every fresh checkout.
  return readFileSync(join(packageDir, match), "utf8").replace(/\r\n/g, "\n").trimEnd();
}

// An SPDX `OR` expression is acceptable when any one alternative is allowlisted; the first allowlisted
// alternative is the one this project relies on.
function resolveLicense(expression) {
  const alternatives = expression.replace(/^\(|\)$/g, "").split(/\s+OR\s+/);
  return alternatives.find((id) => PERMISSIVE_ALLOWLIST.has(id));
}

// A representative package's LICENSE file still carries *that* package's own copyright line(s) -
// fine when it's the only package under that SPDX id (reproduced verbatim), wrong when it's
// standing in for a whole group. For a group, cut the file at its first standard clause and
// prepend a generic placeholder instead of the one representative's actual copyright line.
const GENERIC_ANCHORS = {
  MIT: {
    anchor: "Permission is hereby granted",
    header: "MIT License\n\nCopyright (c) <year> <copyright holder>\n\n",
  },
  ISC: {
    anchor: "Permission to use,",
    header: "Copyright (c) <copyright holder>\n\n",
  },
  "BSD-2-Clause": {
    anchor: "Redistribution and use in source",
    header: "Copyright (c) <year> <copyright holder>\nAll rights reserved.\n\n",
  },
  "BSD-3-Clause": {
    anchor: "Redistribution and use in source",
    header: "Copyright (c) <year> <copyright holder>\nAll rights reserved.\n\n",
  },
};

function genericize(text, license) {
  const rule = GENERIC_ANCHORS[license];
  if (!rule) return text;
  const index = text.indexOf(rule.anchor);
  if (index === -1) return text;
  return rule.header + text.slice(index);
}

function escapeCell(value) {
  return value.replaceAll("|", "\\|");
}

function toTable(rows) {
  const header = "| Package | Version | License | Copyright |\n| --- | --- | --- | --- |";
  const body = rows
    .map((r) => `| ${escapeCell(r.name)} | ${escapeCell(r.versions.join(","))} | ${r.license} | ${escapeCell(r.author || "-")} |`)
    .join("\n");
  return `${header}\n${body}`;
}

function isPlatformVariant(packageDir, name) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const platformValues = [...(manifest.os ?? []), ...(manifest.cpu ?? [])].map((value) => value.replace(/^!/, ""));
  return platformValues.some((value) => name.includes(value));
}

// --recursive: the root package is private and has only devDependencies, so from pnpm 12 a root-only
// listing is empty; the shipped packages' production trees live in the workspace packages.
const raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json", "--recursive"], {
  cwd: ROOT,
  encoding: "utf8",
});
const grouped = JSON.parse(raw);

const packages = [];
const unreviewed = [];
for (const [expression, entries] of Object.entries(grouped)) {
  for (const entry of entries) {
    const path = entry.paths[0];
    if (isPlatformVariant(path, entry.name)) {
      const known = PLATFORM_PACKAGES.find((p) => p.pattern.test(entry.name));
      if (!known || known.license !== expression) unreviewed.push(`${entry.name} (${expression}, platform-specific)`);
      continue;
    }
    const license = resolveLicense(expression);
    if (!license) {
      unreviewed.push(`${entry.name} (${expression})`);
      continue;
    }
    packages.push({ name: entry.name, versions: entry.versions, license, author: entry.author, path });
  }
}
packages.sort((a, b) => a.license.localeCompare(b.license) || a.name.localeCompare(b.name));

if (unreviewed.length > 0) {
  console.error(
    `Found non-allowlisted license(s) in the production dependency tree:\n${unreviewed.map((p) => `  ${p}`).join("\n")}\n` +
      "Review the package(s) by hand, then add the SPDX id to PERMISSIVE_ALLOWLIST (or a platform binary to " +
      "PLATFORM_PACKAGES) in scripts/generate-third-party-licenses.mjs once reviewed.",
  );
  process.exit(1);
}

// Direct dependencies are the published packages' own, minus the workspace links between them.
const workspacePackages = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const directNames = new Set(
  workspacePackages.flatMap((dir) => {
    // Peer dependencies count: npm and pnpm both install them, and @huggingface/transformers is one.
    const manifest = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));
    return Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })
      .filter(([, range]) => !range.startsWith("workspace:"))
      .map(([name]) => name);
  }),
);
const directRows = packages.filter((p) => directNames.has(p.name));

const licenseGroups = new Map();
for (const p of packages) {
  if (!licenseGroups.has(p.license)) licenseGroups.set(p.license, []);
  licenseGroups.get(p.license).push(p);
}

const NAME_LIST_THRESHOLD = 6;
const appendixSections = [...licenseGroups.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([license, entries]) => {
    const names = entries.map((e) => e.name).sort();
    // The representative is the first package in the group that ships a licence file under a standard name.
    const rawText = entries.map((e) => readLicenseFile(e.path)).find((text) => text !== null);
    if (rawText === undefined) throw new Error(`No ${license} package ships a LICENSE file to reproduce`);
    const appliesTo =
      names.length === 1
        ? `Applies to: ${names[0]}. Reproduced verbatim from the package's own license file, copyright line included.`
        : names.length <= NAME_LIST_THRESHOLD
          ? `Applies to: ${names.join(", ")}, with the copyright line(s) from the table above substituted per package.`
          : `Applies to all ${names.length} ${license} packages in the table above, with the copyright line(s) from the table above substituted per package.`;
    const text = names.length === 1 ? rawText : genericize(rawText, license);
    return `### ${license}\n\n${appliesTo}\n\n\`\`\`text\n${text}\n\`\`\``;
  })
  .join("\n\n");

const platformRows = PLATFORM_PACKAGES.map((p) => `| ${escapeCell(p.label)} | ${p.license} | ${p.note} |`).join("\n");

const content = `# Third-party licenses

[Back to README.md](README.md)

This file lists the licenses of every package in the **production** dependency tree of this repository's published packages (\`raiminiscence-mcp\`, \`raiminiscence-hooks\`, \`raiminiscence-cli\`, \`raiminiscence-argv\`), including transitive dependencies. None of them is bundled: npm installs them alongside the package. \`devDependencies\` (ESLint, Prettier, Vitest, semantic-release, and so on) are used to build and test this project but are never distributed with it, so they are not listed.

This file is generated - do not hand-edit it. Regenerate it with:

\`\`\`bash
pnpm run licenses:generate
\`\`\`

CI runs the same script with \`--check\` and fails the build if this file is stale, or if a production dependency's license isn't on the generator's reviewed list - see \`.github/workflows/ci.yml\`.

All ${packages.length} platform-independent packages in the production tree use a permissive license (${[...licenseGroups.keys()].sort().join(", ")}). The platform-specific binaries below are listed separately.

## Direct dependencies

The packages the published packages' own \`package.json\` files depend on directly, peer dependencies included.

${toTable(directRows)}

## Platform-specific native binaries

Installed once per platform, so only the current machine's variant is ever present. Reviewed by hand in \`scripts/generate-third-party-licenses.mjs\`.

| Package | License | Note |
| --- | --- | --- |
${platformRows}

## Full production dependency tree

Every platform-independent package resolved into the production tree (direct and transitive), as installed by \`pnpm-lock.yaml\`. A dash in the Copyright column means the package's own metadata does not declare an author.

${toTable(packages)}

## License texts

Each permissive license's full terms require the text below plus the copyright line(s) for the specific package - see the Copyright column in the tables above for the holder that applies to each package. Where only one package in the tree uses a license, its license file is reproduced verbatim, copyright line included.

${appendixSections}
`;

if (CHECK) {
  let existing = "";
  try {
    existing = readFileSync(OUT_FILE, "utf8");
  } catch {
    // treated as empty - falls through to the mismatch branch below
  }
  if (existing !== content) {
    console.error("THIRD_PARTY_LICENSES.md is stale. Run `pnpm run licenses:generate` and commit the result.");
    process.exit(1);
  }
  console.log("THIRD_PARTY_LICENSES.md is up to date.");
} else {
  writeFileSync(OUT_FILE, content);
  console.log(`Wrote ${OUT_FILE}`);
}
