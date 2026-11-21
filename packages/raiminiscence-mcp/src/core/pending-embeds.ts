/**
 * ADR-0041: the vectors `remember` is still writing after it answered, per
 * storage root. In-process only, like the opportunistic-consolidation
 * flags: another process can't wait on this one's embeds, and reads its
 * Memory lexically until the vector lands.
 */
const pending = new Map<string, Set<Promise<void>>>();

/** Tracks `work` under `storageRoot` until it settles. `work` must not reject. */
export function trackPendingEmbed(storageRoot: string, work: Promise<void>): void {
  const forRoot = pending.get(storageRoot) ?? new Set();
  pending.set(storageRoot, forRoot);
  forRoot.add(work);
  void work.finally(() => {
    forRoot.delete(work);
    if (forRoot.size === 0 && pending.get(storageRoot) === forRoot) pending.delete(storageRoot);
  });
}

/** Resolves once every vector pending under `storageRoot` has been written or given up on. Immediate when none is. */
export async function awaitPendingEmbeds(storageRoot: string): Promise<void> {
  const forRoot = pending.get(storageRoot);
  if (forRoot) await Promise.all(forRoot);
}

/** Waits for every pending vector in this process, at most `timeoutMs`, so a server's exit doesn't drop them. */
export async function settlePendingEmbeds(timeoutMs: number): Promise<void> {
  const all = [...pending.values()].flatMap((forRoot) => [...forRoot]);
  if (all.length === 0) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.all(all), new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
  clearTimeout(timer);
}
