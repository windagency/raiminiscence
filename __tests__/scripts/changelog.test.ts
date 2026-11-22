import { describe, expect, it } from "vitest";
import { releaseChangelog, releaseNotes, syncChangelog, type Commit } from "../../scripts/changelog.js";

const MARKER = "<!-- end of Unreleased: generated from commits, see docs/semver.md -->";
const REPO = "https://github.com/windagency/raiminiscence";

const hash = (seed: string) => seed.repeat(40).slice(0, 40);
const commit = (seed: string, subject: string, body = ""): Commit => ({ hash: hash(seed), subject, body });
const entry = (seed: string, text: string) => `- ${text} ([${hash(seed).slice(0, 7)}](${REPO}/commit/${hash(seed)}))`;

const changelog = (unreleased: string, released = "## [1.0.0](link) (2026-01-01)\n\n### Features\n\n- old\n") =>
  `# Changelog\n\nIntro.\n\n## [Unreleased]\n${unreleased ? `\n${unreleased}` : ""}\n${MARKER}\n\n${released}`;

describe("syncChangelog", () => {
  it("lists feat and fix commits under Features and Bug Fixes, oldest first, scope in bold", () => {
    // git log order: newest first.
    const commits = [
      commit("c", "fix(hooks): stop the double prime"),
      commit("b", "feat: add inspect --json"),
      commit("a", "feat(mcp): recall by tag"),
    ];

    expect(syncChangelog(changelog(""), changelog(""), commits)).toBe(
      changelog(
        `### Features\n\n${entry("a", "**mcp:** recall by tag")}\n${entry("b", "add inspect --json")}\n\n### Bug Fixes\n\n${entry("c", "**hooks:** stop the double prime")}\n`,
      ),
    );
  });

  it("puts a breaking change of any type under BREAKING CHANGES, and leaves out what ships nothing", () => {
    const commits = [
      commit("a", "refactor!: drop the v1 store"),
      commit("b", "chore: bump deps", "BREAKING CHANGE: Node 22 is required"),
      commit("c", "docs: fix a typo"),
      commit("d", "Merge branch 'main' into int"),
    ];

    expect(syncChangelog(changelog(""), changelog(""), commits)).toBe(
      changelog(`### BREAKING CHANGES\n\n${entry("b", "bump deps")}\n${entry("a", "drop the v1 store")}\n`),
    );
  });

  it("changes nothing when run again on its own output", () => {
    const commits = [commit("b", "fix: two"), commit("a", "feat: one")];
    const once = syncChangelog(changelog(""), changelog(""), commits);

    expect(syncChangelog(once, changelog(""), commits)).toBe(once);
  });

  it("takes released sections from main and keeps only the entries that did not ship", () => {
    const released = `## [1.1.0](link) (2026-02-01)\n\n### Features\n\n${entry("a", "shipped")}\n\n## [1.0.0](link) (2026-01-01)\n\n- old\n`;
    const onInt = changelog(`### Features\n\n${entry("a", "shipped")}\n${entry("b", "merged during the release")}\n`);
    // Squash promotion: int's commits stay outside main's history until the back-merge.
    const commits = [commit("b", "feat: merged during the release"), commit("a", "feat: shipped")];

    expect(syncChangelog(onInt, changelog("", released), commits)).toBe(
      changelog(`### Features\n\n${entry("b", "merged during the release")}\n`, released),
    );
  });

  it("keeps int's header, so an intro edit merged into int survives", () => {
    const onInt = changelog("").replace("Intro.", "New intro.");

    expect(syncChangelog(onInt, changelog(""), [])).toBe(onInt);
  });

  it("fails rather than guessing when a file lost the Unreleased heading or its end marker", () => {
    expect(() => syncChangelog(changelog("").replace("## [Unreleased]", "## Next"), changelog(""), [])).toThrow(/Unreleased/);
    expect(() => syncChangelog(changelog(""), changelog("").replace(MARKER, ""), [])).toThrow(/marker/);
  });
});

describe("before the first release", () => {
  const empty = `# Changelog\n\nIntro.\n\n## [Unreleased]\n\n${MARKER}\n`;

  it("ends the file at the marker, with no trailing blank line", () => {
    expect(syncChangelog(empty, empty, [])).toBe(empty);
  });

  it("ends the file at the first release's notes", () => {
    const notes = "## 1.0.0 (2026-02-01)\n\n### Features\n\n- one\n";

    expect(releaseChangelog(empty, notes)).toBe(`# Changelog\n\nIntro.\n\n## [Unreleased]\n\n${MARKER}\n\n${notes}`);
  });
});

describe("releaseNotes", () => {
  it("turns the Unreleased list into the version's notes", () => {
    const onMain = changelog(`### Features\n\n${entry("a", "one")}\n`);

    expect(releaseNotes(onMain, [commit("p", "feat: promote int")], { version: "1.1.0", previousTag: "v1.0.0", date: "2026-02-01" })).toBe(
      `## [1.1.0](${REPO}/compare/v1.0.0...v1.1.0) (2026-02-01)\n\n### Features\n\n${entry("a", "one")}\n`,
    );
  });

  it("falls back to the released commits when Unreleased is empty, as after a hotfix", () => {
    expect(releaseNotes(changelog(""), [commit("h", "fix: hotfix")], { version: "1.0.1", previousTag: "v1.0.0", date: "2026-02-01" })).toBe(
      `## [1.0.1](${REPO}/compare/v1.0.0...v1.0.1) (2026-02-01)\n\n### Bug Fixes\n\n${entry("h", "hotfix")}\n`,
    );
  });

  it("adds main's own commits to the first release, since they predate int", () => {
    const onMain = changelog(`### Bug Fixes\n\n${entry("b", "two")}\n`, "");
    // HEAD's history on main: the promotion squash, then the commit main started from.
    const commits = [commit("p", "chore(release): promote int to main"), commit("b", "fix: two"), commit("a", "feat: one")];

    expect(releaseNotes(onMain, commits, { version: "1.0.0", date: "2026-02-01" })).toBe(
      `## 1.0.0 (2026-02-01)\n\n### Features\n\n${entry("a", "one")}\n\n### Bug Fixes\n\n${entry("b", "two")}\n`,
    );
  });

  it("returns the version's section unchanged once the release has written it", () => {
    // semantic-release runs generateNotes again after prepare, when Unreleased is already empty.
    const notes = `## [1.1.0](${REPO}/compare/v1.0.0...v1.1.0) (2026-02-01)\n\n### Features\n\n${entry("a", "one")}\n`;
    const released = releaseChangelog(changelog(`### Features\n\n${entry("a", "one")}\n`), notes);
    const afterPrepare = [commit("r", "chore(release): 1.1.0 [skip ci]"), commit("p", "chore(release): promote int to main")];

    expect(releaseNotes(released, afterPrepare, { version: "1.1.0", previousTag: "v1.0.0", date: "2026-02-02" })).toBe(notes);
  });

  it("has no compare link for the first release", () => {
    expect(releaseNotes(changelog(`### Features\n\n${entry("a", "one")}\n`, ""), [], { version: "1.0.0", date: "2026-02-01" })).toMatch(
      /^## 1\.0\.0 \(2026-02-01\)\n\n/,
    );
  });
});

describe("releaseChangelog", () => {
  it("empties Unreleased and puts the notes above the older releases", () => {
    const notes = `## [1.1.0](link) (2026-02-01)\n\n### Features\n\n${entry("a", "one")}\n`;

    expect(releaseChangelog(changelog(`### Features\n\n${entry("a", "one")}\n`), notes)).toBe(
      changelog("", `${notes}\n## [1.0.0](link) (2026-01-01)\n\n### Features\n\n- old\n`),
    );
  });
});
