import { z } from "zod";

const manifestSchema = z.object({ version: z.string() });

/** ADR-0039: the `version` field of this package's own `package.json`. Throws when it isn't there: the file ships with the package. */
export function parsePackageManifestVersion(json: unknown): string {
  return manifestSchema.parse(json).version;
}
