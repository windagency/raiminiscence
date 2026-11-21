import { readFileSync } from "node:fs";
import { parsePackageManifestVersion } from "./package-manifest-schema.js";

/**
 * ADR-0039: this package's own version, read from its `package.json`. The
 * relative path holds from `src/core/` and from `dist/core/` alike. The
 * served-recall socket refuses to mix two releases' rankings by comparing
 * it on both sides.
 */
export const PACKAGE_VERSION: string = parsePackageManifestVersion(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")));
