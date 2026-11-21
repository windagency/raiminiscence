import { RelativePath } from "arch-unit-ts/dist/arch-unit/core/domain/RelativePath.js";
import { TypeScriptProject } from "arch-unit-ts/dist/arch-unit/core/domain/TypeScriptProject.js";
import { describe, expect, it } from "vitest";

const CLI_SRC = "packages/raiminiscence-cli/src";

/**
 * `raiminiscence-cli` has no internal module boundaries worth asserting
 * (args.ts/format.ts/run.ts/inspect-cli.ts are all flat, no adapters); its
 * one architecture rule is the workspace boundary below.
 */
describe("raiminiscence-cli architecture", () => {
  it("arch-unit-ts loads this package's source tree", () => {
    const project = new TypeScriptProject(RelativePath.of(CLI_SRC));
    expect(project.allClasses().get().length).toBeGreaterThan(0);
  });

  /**
   * `raiminiscence-argv` was extracted out of both
   * `raiminiscence-cli` and `raiminiscence-hooks` specifically so neither
   * sibling CLI package depends on the other.
   */
  it("never imports from raiminiscence-hooks", () => {
    const project = new TypeScriptProject(RelativePath.of(CLI_SRC));
    const importers = project
      .allClasses()
      .get()
      .filter((klass) => klass.hasImport("raiminiscence-hooks"));
    expect(importers).toEqual([]);
  });
});
