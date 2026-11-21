/** Unordered pair key: sorted so `pairKey(a, b) === pairKey(b, a)`. */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Invokes `fn` once for every unordered pair within `ids` (i < j) — the double-loop shape Conflict Edge walks. */
export function forEachPair(ids: string[], fn: (a: string, b: string) => void): void {
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      fn(ids[i]!, ids[j]!);
    }
  }
}
