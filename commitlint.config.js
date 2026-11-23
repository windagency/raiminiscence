export default {
  extends: ["@commitlint/config-conventional"],
  // Dependabot bodies carry release-note lines past the 100-character body limit. Its header is still
  // linted as the PR title by pr-title.yml, which is what lands on a squash merge.
  ignores: [(message) => message.includes("Signed-off-by: dependabot[bot] <support@github.com>")],
  rules: {
    // GitHub writes a squash merge's Co-authored-by trailers itself, and a GitHub App's noreply address
    // alone runs past 100 characters. Every promotion squash names the changelog bot (ADR-0043).
    "footer-max-line-length": [0],
  },
};
