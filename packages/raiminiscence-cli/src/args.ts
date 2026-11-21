import {
  ALL_CONFIDENCE_TIERS,
  ALL_MEMORY_KINDS,
  ALL_SCOPES,
  type BrowseMemoriesFilters,
  type ConfidenceTier,
  type MemoryKind,
  type Scope,
} from "raiminiscence-mcp";
import { flag, parseAllowedValue, parseDateValue, parseNumberValue } from "raiminiscence-argv";

/**
 * Flag splitting stays hand-rolled on top of `flag` — no new arg-parsing
 * library/dependency for this one CLI. Flag *values* (the CLI's external
 * input) are validated with Zod in `raiminiscence-argv`'s `flag-value-schema.ts`, per this repo's
 * non-negotiable.
 */

export interface InspectIdArgs {
  mode: "id";
  id: string;
  detailed: boolean;
}

export interface InspectQueryArgs {
  mode: "query";
  query: string;
  detailed: boolean;
}

export interface InspectListArgs {
  mode: "list";
  filters: BrowseMemoriesFilters;
  detailed: boolean;
}

export type InspectArgs = InspectIdArgs | InspectQueryArgs | InspectListArgs;

function boolFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/** Shared `get → validate → throw-with-message` shape behind `parseEnumFlag`/`parseNumberFlag`/`parseDateFlag`. */
function validatedFlag<T>(
  argv: string[],
  name: string,
  parse: (raw: string) => T | undefined,
  formatError: (raw: string) => string,
): { raw: string; data: T } | undefined {
  const raw = flag(argv, name);
  if (raw === undefined) return undefined;
  const data = parse(raw);
  if (data === undefined) {
    throw new Error(formatError(raw));
  }
  return { raw, data };
}

/** Validates a `--name=value` flag against a fixed set of allowed values. */
function parseEnumFlag<T extends string>(argv: string[], name: string, allowed: readonly T[]): T | undefined {
  return validatedFlag(
    argv,
    name,
    (raw) => parseAllowedValue(raw, allowed),
    (raw) => `Unknown --${name} "${raw}" — expected one of ${allowed.join(", ")}.`,
  )?.data;
}

/** Validates a `--name=value` flag as a number (rejects non-numeric input, including NaN). */
function parseNumberFlag(argv: string[], name: string): number | undefined {
  return validatedFlag(argv, name, parseNumberValue, (raw) => `--${name} must be a number, got "${raw}".`)?.data;
}

/**
 * Validates a `--name=value` flag as a date (rejects
 * unparseable input). Returns the raw string, not the coerced `Date` —
 * `BrowseMemoriesFilters.since`/`until` are compared lexicographically
 * against `createdAt`'s ISO string, so the original string is what's needed.
 */
function parseDateFlag(argv: string[], name: string): string | undefined {
  return validatedFlag(argv, name, parseDateValue, (raw) => `--${name} must be a valid date, got "${raw}".`)?.raw;
}

/**
 * `raiminiscence-inspect`'s three modes — a bare positional argument (memory
 * id lookup), `--query="..."` (query-explain), or `--list` (browse) — are
 * mutually exclusive; exactly one must be present, rejected with a clear
 * error otherwise (never silently prioritised).
 */
export function parseArgs(argv: string[]): InspectArgs {
  const detailed = boolFlag(argv, "detailed");
  const list = boolFlag(argv, "list");
  const query = flag(argv, "query");
  const positional = argv.find((arg) => !arg.startsWith("--"));

  const modesSet = [positional !== undefined, query !== undefined, list].filter(Boolean).length;
  if (modesSet !== 1) {
    throw new Error('raiminiscence-inspect requires exactly one of: a bare memory id, --query="...", or --list');
  }

  if (positional !== undefined) {
    return { mode: "id", id: positional, detailed };
  }

  if (query !== undefined) {
    return { mode: "query", query, detailed };
  }

  return { mode: "list", detailed, filters: parseListFilters(argv) };
}

/** `--list`'s filter flags, each validated; an absent flag leaves its filter unset. */
function parseListFilters(argv: string[]): BrowseMemoriesFilters {
  const kind = parseEnumFlag(argv, "kind", ALL_MEMORY_KINDS as MemoryKind[]);
  const confidenceTier = parseEnumFlag(argv, "tier", ALL_CONFIDENCE_TIERS as ConfidenceTier[]);
  const scope = parseEnumFlag(argv, "scope", ALL_SCOPES as Scope[]);
  const minStrength = parseNumberFlag(argv, "min-strength");
  const maxStrength = parseNumberFlag(argv, "max-strength");
  const since = parseDateFlag(argv, "since");
  const until = parseDateFlag(argv, "until");

  return {
    ...(kind !== undefined && { kind }),
    ...(confidenceTier !== undefined && { confidenceTier }),
    ...(minStrength !== undefined && { minStrength }),
    ...(maxStrength !== undefined && { maxStrength }),
    ...(scope !== undefined && { scope }),
    ...(since !== undefined && { since }),
    ...(until !== undefined && { until }),
  };
}
