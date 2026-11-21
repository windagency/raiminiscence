// Generates CHANGELOG.md's Unreleased section from Conventional Commits, and turns it into a version's
// notes at release (ADR-0043). `main` only takes squash merges, so int's commits never become part of
// main's history; a commit's hash in a released section is what marks it shipped.
//
//   tsx scripts/changelog.ts sync [--check]          on int: released sections from origin/main, Unreleased
//                                                    from int's list plus every feat/fix/breaking commit in
//                                                    origin/main..HEAD that no section lists yet
//   tsx scripts/changelog.ts notes <version> [tag]   prints the release notes (semantic-release generateNotesCmd)
//   tsx scripts/changelog.ts release <version> [tag] writes those notes into CHANGELOG.md, emptying Unreleased
//
// The end marker keeps Unreleased and the newest release apart by an unchanged line, so the back-merge of
// main into int merges cleanly while int has entries main doesn't.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHANGELOG = "CHANGELOG.md";
const REPO = "https://github.com/windagency/raiminiscence";
const UNRELEASED_HEADING = "## [Unreleased]\n";
const MARKER = "<!-- end of Unreleased: generated from commits, see docs/semver.md -->";
const GROUPS = ["BREAKING CHANGES", "Features", "Bug Fixes"];

export interface Commit {
  hash: string;
  subject: string;
  body: string;
}

interface Entry {
  group: string;
  line: string;
  hash: string | undefined;
}

interface Parts {
  header: string;
  entries: Entry[];
  released: string;
}

const HEADER = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;

function toEntry({ hash, subject, body }: Commit): Entry | undefined {
  const match = HEADER.exec(subject);
  if (!match) return undefined;
  const [, type, scope, bang, description] = match;
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body);
  const group = breaking ? "BREAKING CHANGES" : type === "feat" ? "Features" : type === "fix" ? "Bug Fixes" : undefined;
  if (!group) return undefined;
  const text = `${scope ? `**${scope}:** ` : ""}${description}`;
  return { group, hash, line: `- ${text} ([${hash.slice(0, 7)}](${REPO}/commit/${hash}))` };
}

function parse(changelog: string): Parts {
  const start = changelog.indexOf(`\n${UNRELEASED_HEADING}`);
  if (start === -1) throw new Error(`${CHANGELOG} has no "${UNRELEASED_HEADING.trim()}" heading.`);
  const end = changelog.indexOf(MARKER);
  if (end === -1) throw new Error(`${CHANGELOG} has no end-of-Unreleased marker: ${MARKER}`);
  const headerEnd = start + 1 + UNRELEASED_HEADING.length;

  const entries: Entry[] = [];
  let group = "";
  for (const line of changelog.slice(headerEnd, end).split("\n")) {
    const heading = /^### (.+)$/.exec(line);
    if (heading) group = heading[1] ?? "";
    else if (line.startsWith("- ")) entries.push({ group, line, hash: /\/commit\/([0-9a-f]{40})\)/.exec(line)?.[1] });
  }
  return { header: changelog.slice(0, headerEnd), entries, released: changelog.slice(end + MARKER.length).replace(/^\n+/, "") };
}

function render(entries: Entry[]): string {
  const groups = [...new Set([...GROUPS, ...entries.map((entry) => entry.group)])];
  return groups
    .map((group) => entries.filter((entry) => entry.group === group).map((entry) => entry.line))
    .map((lines, index) => (lines.length ? `### ${groups[index]}\n\n${lines.join("\n")}\n` : ""))
    .filter(Boolean)
    .join("\n");
}

// `commits` newest first, as git log lists them.
function entriesOf(commits: Commit[]): Entry[] {
  return [...commits].reverse().flatMap((commit) => toEntry(commit) ?? []);
}

function assemble(header: string, body: string, released: string): string {
  return `${header}${body ? `\n${body}` : ""}\n${MARKER}\n${released ? `\n${released}` : ""}`;
}

export function syncChangelog(intChangelog: string, mainChangelog: string, commits: Commit[]): string {
  const { header, entries } = parse(intChangelog);
  const { released } = parse(mainChangelog);
  const kept = entries.filter((entry) => !entry.hash || !released.includes(entry.hash));
  const listed = new Set(kept.map((entry) => entry.hash));
  const added = entriesOf(commits).filter((entry) => !listed.has(entry.hash) && !released.includes(entry.hash ?? ""));
  return assemble(header, render([...kept, ...added]), released);
}

// The Unreleased list when there is one. A hotfix squashed straight into main leaves it empty, so the
// release's own commits stand in.
export function releaseNotes(changelog: string, commits: Commit[], release: { version: string; previousTag?: string; date: string }): string {
  const { version, previousTag, date } = release;
  const { entries } = parse(changelog);
  const heading = previousTag ? `## [${version}](${REPO}/compare/${previousTag}...v${version}) (${date})` : `## ${version} (${date})`;
  return `${heading}\n\n${render(entries.length ? entries : entriesOf(commits))}`;
}

export function releaseChangelog(changelog: string, notes: string): string {
  const { header, released } = parse(changelog);
  return assemble(header, "", released ? `${notes}\n${released}` : notes);
}

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });

function commitsIn(range: string): Commit[] {
  return git("log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", range)
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", subject = "", body = ""] = record.split("\x1f");
      return { hash, subject, body };
    });
}

function main(): void {
  const [command, version, previousTag] = process.argv.slice(2);
  const path = join(REPO_ROOT, CHANGELOG);
  const current = readFileSync(path, "utf8");

  if (command === "sync") {
    const synced = syncChangelog(current, git("show", `origin/main:${CHANGELOG}`), commitsIn("origin/main..HEAD"));
    if (!process.argv.includes("--check")) writeFileSync(path, synced);
    else if (synced !== current) {
      console.error(`${CHANGELOG}'s Unreleased section is behind int's commits. Wait for the changelog workflow, or run \`pnpm changelog:sync\`.`);
      process.exitCode = 1;
    }
    return;
  }
  if ((command === "notes" || command === "release") && version) {
    // semantic-release passes an empty lastRelease.gitTag on the first release.
    const tag = previousTag || undefined;
    const notes = releaseNotes(current, commitsIn(tag ? `${tag}..HEAD` : "HEAD"), {
      version,
      previousTag: tag,
      date: new Date().toISOString().slice(0, 10),
    });
    if (command === "notes") process.stdout.write(notes);
    else writeFileSync(path, releaseChangelog(current, notes));
    return;
  }
  console.error("usage: tsx scripts/changelog.ts sync [--check] | notes <version> [tag] | release <version> [tag]");
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
