/**
 * ADR-0032: the lexical half of Recall's fused ranking. Pure functions over
 * one query and the pool it is scored against; nothing is cached or stored.
 */

/** Okapi BM25's textbook defaults, fixed rather than tuned (ADR-0032). */
const K1 = 1.2;
const B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Okapi BM25 of `query` against each of `bodies`, with `bodies` itself as the corpus. */
export function bm25Scores(query: string, bodies: string[]): number[] {
  const queryTerms = [...new Set(tokenize(query))];
  const docs = bodies.map(tokenize);
  if (queryTerms.length === 0 || docs.length === 0) return bodies.map(() => 0);

  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) for (const term of new Set(doc)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);

  return docs.map((doc) => {
    const termFrequency = new Map<string, number>();
    for (const term of doc) termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const frequency = termFrequency.get(term);
      if (frequency === undefined) continue;
      const df = documentFrequency.get(term)!;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += (idf * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * doc.length) / averageLength));
    }
    return score;
  });
}

/**
 * Rescales `values` onto [0, 1] across the pool. A pool of equal values has no
 * spread to rescale: it maps to 1 when that value is positive, 0 otherwise, so a
 * pool with no lexical overlap anywhere contributes no lexical signal.
 */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  if (highest === lowest) return values.map(() => (highest > 0 ? 1 : 0));
  return values.map((value) => (value - lowest) / (highest - lowest));
}
