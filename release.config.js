const NO_RELEASE_TYPES = ["perf", "build", "chore", "ci", "docs", "style", "refactor", "test", "revert"];

export default {
  branches: [
    "main",
    {
      name: "release/+([0-9])?(.{+([0-9]),x}).x",
      // semantic-release's own lodash template, evaluated by semantic-release.
      range: "${name.replace(/^release\\//, '')}",
    },
  ],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { type: "feat", release: "minor" },
          { type: "fix", release: "patch" },
          ...NO_RELEASE_TYPES.map((type) => ({ type, release: false })),
        ],
      },
    ],
    // Lockstep versioning (ADR-0026): the root package is private, so @semantic-release/npm isn't used.
    // scripts/release.mjs writes the version into every package.json and packs each package; its publish
    // step stages the tarballs. The npm Trusted Publisher only allows `npm stage publish`, so a release is
    // never installable until a maintainer approves it with 2FA. The npm CLI authenticates through OIDC.
    // scripts/changelog.ts turns CHANGELOG.md's Unreleased list, kept by changelog.yml, into the notes and the
    // version's section (ADR-0043), in place of release-notes-generator and @semantic-release/changelog.
    [
      "@semantic-release/exec",
      {
        generateNotesCmd: 'pnpm exec tsx scripts/changelog.ts notes ${nextRelease.version} "${lastRelease.gitTag}"',
        prepareCmd:
          'pnpm exec tsx scripts/changelog.ts release ${nextRelease.version} "${lastRelease.gitTag}" && node scripts/release.mjs prepare ${nextRelease.version}',
        publishCmd: 'node scripts/release.mjs publish ${nextRelease.channel || "latest"}',
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json", "packages/*/package.json"],
      },
    ],
    [
      "@semantic-release/github",
      {
        successComment: false,
        assets: [{ path: "sbom.cdx.json", label: "SBOM (CycloneDX JSON, repository lockfile)" }],
      },
    ],
  ],
};
