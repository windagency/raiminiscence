import { RelativePath } from "arch-unit-ts/dist/arch-unit/core/domain/RelativePath.js";
import { TypeScriptProject } from "arch-unit-ts/dist/arch-unit/core/domain/TypeScriptProject.js";
import { describe, expect, it } from "vitest";

const ARGV_SRC = "packages/raiminiscence-argv/src";

/**
 * `raiminiscence-argv` has no internal module boundaries worth asserting;
 * its one architecture rule is the workspace boundary below.
 */
describe("raiminiscence-argv architecture", () => {
  it("arch-unit-ts loads this package's source tree", () => {
    const project = new TypeScriptProject(RelativePath.of(ARGV_SRC));
    expect(project.allClasses().get().length).toBeGreaterThan(0);
  });

  /**
   * `raiminiscence-argv` was extracted out of `raiminiscence-cli` and
   * `raiminiscence-hooks` specifically so it has no workspace
   * dependency on either of them (or on `raiminiscence-mcp`) — they depend
   * on it, never the reverse.
   */
  it("has zero workspace dependencies", () => {
    const project = new TypeScriptProject(RelativePath.of(ARGV_SRC));
    const workspaceImporters = project
      .allClasses()
      .get()
      .filter((klass) => ["raiminiscence-cli", "raiminiscence-hooks", "raiminiscence-mcp"].some((pkg) => klass.hasImport(pkg)));
    expect(workspaceImporters).toEqual([]);
  });
});
