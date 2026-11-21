import { z } from "zod";
import type { OpportunisticConsolidationState } from "./opportunistic-consolidation-state.js";
import type { CacheLogEntry, CacheSlotFile, VersionMarker } from "./recall-cache.js";

/**
 * The local-only files under `.raiminiscence/cache/`. Only this package
 * writes them, but they outlive the process that wrote them, so a hand edit,
 * a partial write or a shape change across versions must degrade to "absent"
 * rather than reach `recall`/`consolidate` as a wrongly typed value.
 */
const versionMarkerSchema = z.object({ recordsVersion: z.number(), embeddingsVersion: z.number() });

/**
 * Only the envelope is checked. `data` is a whole cached corpus, written
 * atomically by this package and trusted only when its version matches the
 * marker; re-validating every cached Memory on each read would cost what the
 * cache exists to save.
 */
const cacheSlotFileSchema = z.object({ version: z.number(), data: z.record(z.string(), z.unknown()) });

/** ADR-0036: as with a slot file, only the envelope; `op` is applied by the slot that wrote it. */
const cacheLogEntrySchema = z.object({ version: z.number(), prev: z.number(), op: z.record(z.string(), z.unknown()) });

const opportunisticConsolidationStateSchema = z.object({ lastPassAt: z.string(), callsSinceLastPass: z.number() });

/** The cache's version marker, or `undefined` when the JSON isn't that shape. */
export function parseVersionMarker(json: unknown): VersionMarker | undefined {
  const parsed = versionMarkerSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** A cache slot's `{ version, data }` envelope, or `undefined` when the JSON isn't that shape. */
export function parseCacheSlotFile(json: unknown): CacheSlotFile<Record<string, unknown>> | undefined {
  const parsed = cacheSlotFileSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** One cache log line's `{ version, prev, op }` envelope, or `undefined` when the JSON isn't that shape. */
export function parseCacheLogEntry(json: unknown): CacheLogEntry<Record<string, unknown>> | undefined {
  const parsed = cacheLogEntrySchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** Opportunistic Consolidation's debounce state, or `undefined` when the JSON isn't that shape. */
export function parseOpportunisticConsolidationState(json: unknown): OpportunisticConsolidationState | undefined {
  const parsed = opportunisticConsolidationStateSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
