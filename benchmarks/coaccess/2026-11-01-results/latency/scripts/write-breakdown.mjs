// Sums time spent in JSON.stringify, JSON.parse, file writes and file reads across 5 remember()
// calls, against the total, to show where an O(n) write cost comes from.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const t = { stringify: 0, parse: 0, write: 0, read: 0, bytesWritten: 0 };
const wrap = (obj, key, bucket, onCall) => { const orig = obj[key]; obj[key] = function (...a) { const s = performance.now(); try { return orig.apply(this, a); } finally { t[bucket] += performance.now() - s; onCall?.(a); } }; };
wrap(JSON, "stringify", "stringify");
wrap(JSON, "parse", "parse");
wrap(fs, "writeFileSync", "write", (a) => { t.bytesWritten += typeof a[1] === "string" ? Buffer.byteLength(a[1]) : a[1]?.length ?? 0; });
wrap(fs, "readFileSync", "read");
syncBuiltinESMExports();
const DIST = "/Users/Shared/raim-bench/fullbody/packages/raiminiscence-mcp/dist/core";
const { remember } = await import(`${DIST}/engine.js`);
const { createEmbeddedEmbeddingProvider } = await import(`${DIST}/embeddings/embedded.js`);
const embeddingProvider = createEmbeddedEmbeddingProvider();
await embeddingProvider.embed("warm up");
const storageRoot = process.argv[2];
let embedMs = 0;
const timed = { identity: embeddingProvider.identity, embed: async (x) => { const s = performance.now(); try { return await embeddingProvider.embed(x); } finally { embedMs += performance.now() - s; } } };
// One unmeasured write first: it pays the one-off cache load into memory.
await remember({ content: "warm write", client: "benchmark", storageRoot, embeddingProvider: timed, triggerConsolidation: false });
for (const k of Object.keys(t)) t[k] = 0; embedMs = 0;
const start = performance.now();
for (let i = 0; i < 5; i++) await remember({ content: `Profiling write ${i}: the retry client backs off exponentially`, client: "benchmark", storageRoot, embeddingProvider: timed, triggerConsolidation: false });
const total = performance.now() - start;
const r = (x) => Math.round(x / 5);
console.log(JSON.stringify({ perWriteMs: { total: r(total), embed: r(embedMs), stringify: r(t.stringify), parse: r(t.parse), fileWrite: r(t.write), fileRead: r(t.read) }, mbWrittenPerWrite: +(t.bytesWritten / 5 / 1e6).toFixed(1) }));
