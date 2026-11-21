# rAIminiscence vs hippo-memory — Empirical Benchmark

[Back to README.md](../README.md) • [Back to COMPARISON.md](COMPARISON.md) • [Back to 0016-team-shared-memory-becomes-a-future-direction-adr-0003-flagged.md](../docs/adr/0016-team-shared-memory-becomes-a-future-direction-adr-0003-flagged.md) • [Back to 0029-subpath-imports-replace-parent-relative-imports.md](../docs/adr/0029-subpath-imports-replace-parent-relative-imports.md) • [Back to 0032-recall-fuses-lexical-and-embedding-scores.md](../docs/adr/0032-recall-fuses-lexical-and-embedding-scores.md) • [Back to lld.md](../docs/architecture/lld.md) • [Back to developer-guide.md](../docs/developer-guide.md) • [Back to how-it-works.md](../docs/how-it-works.md) • [Back to NEXT_STEPS.md](../NEXT_STEPS.md) • [Back to packages/raiminiscence-mcp/README.md](../packages/raiminiscence-mcp/README.md)

This directory is a **real, runnable** benchmark of rAIminiscence against
hippo-memory: both systems are actually installed/imported, actually loaded
with an identical hand-labelled corpus, and actually queried/invalidated —
no fabricated or estimated numbers anywhere in `results/`. It replaces a
prior **narrative-only** comparison, which had leaned on hippo-memory's
self-reported README numbers (e.g. "Recall@5 = 74% BM25-only") and
rAIminiscence's own design docs.

Scope is deliberately tight — two metrics only, both scoped as "must-have":

1. **Recall@k / Precision@k** — embedding-backed retrieval quality (each
   system's real local embedding model, not a lexical-only fallback — see
   "Embedding backends" below) against a small synthetic corpus with
   hand-authored ground truth.
2. **Invalidation correctness** — pass/fail per scenario, including
   "bystander lock" cases (memories that share a token/substring with the
   invalidation trigger but must NOT be invalidated). Neither system's
   invalidation mechanism uses embeddings (both are text/pattern-matching
   based), so this metric is unaffected by the embedding backend choice.

Decay-formula curves, latency, and conflict-detection accuracy were
explicitly out of scope for this original pass — see "History" below for
where those were picked up later.

## How to reproduce

```bash
# 1. Start Ollama and make sure nomic-embed-text is pulled (rAIminiscence's
#    real embedding backend — see "Embedding backends" below):
ollama serve &                      # skip if already running
ollama pull nomic-embed-text        # one-time, ~274MB

# 2. Install hippo-memory + its optional local-embedding peer dependency,
#    scoped to its own isolated package only:
cd benchmarks/hippo-memory-runner && npm install && npm install-scripts approve onnxruntime-node protobufjs hippo-memory sharp && npm rebuild && cd -

# 3. Run everything from the repo root (matches this monorepo's own tsx
#    convention, e.g. `pnpm codemap` -> scripts/build-codemap.ts):
node_modules/.bin/tsx benchmarks/compare.ts
```

This regenerates `benchmarks/results/2026-09-15-results.md` and its
underlying `2026-09-15-results.json` in place. Re-run any time the corpus,
either runner, or either system's version changes — that's the point of
keeping this checked in as a permanent, repeatable exercise across future
"assess again" cycles, not a one-off snapshot.

Total runtime is a couple of minutes. Step 2's `npm install-scripts approve`
is npm 11's install-script allowlist — required once so `onnxruntime-node`
(the native inference backend `@huggingface/transformers` needs) can run its
postinstall; without it, hippo-memory silently stays on lexical-only BM25
scoring rather than failing loudly. First run downloads hippo-memory's
~22MB embedding model from Hugging Face into
`benchmarks/hippo-memory-runner/node_modules/@huggingface/transformers/.cache/`
(gitignored, isolated to this package); later runs reuse that cache.

**Live dashboard:** every metric in `results/` also renders as an interactive
HTML page — charts, full per-query/per-scenario/per-store-size tables, all
embedded from the real result JSON at build time, nothing hand-transcribed.
`dashboard.html` is checked into git, self-contained (no server, no
network calls for its data), and public to anyone with access to this
repo — open it directly in a browser. It's built from
`dashboard-template.html` + `build-dashboard.ts`, which injects
`results/2026-09-15-results.json` and `results/2026-09-15-extended-results.json`
straight into the page; re-run `node_modules/.bin/tsx benchmarks/build-dashboard.ts`
after any `compare.ts`/`extended-compare.ts` re-run to keep it in sync
(ask Claude to do this — it's a standing instruction after any re-run, not
something to re-ask for each time).

## Isolation — what's isolated from what, and how

Two isolation requirements drove this directory's structure:

1. **hippo-memory never becomes a dependency of the main rAIminiscence
   repo.** `benchmarks/hippo-memory-runner/package.json` is its own private
   npm package, declaring `hippo-memory` as its only dependency, installed
   via its own `npm install` (scoped to that directory, producing its own
   `package-lock.json`). It is **not** listed in the root
   `pnpm-workspace.yaml` (`packages: ["packages/*"]` — `benchmarks/` isn't
   under `packages/`), so `pnpm install` at the repo root never touches it,
   and the root `package.json`/`pnpm-lock.yaml` are never modified by this
   work. Verify with `pnpm -r list --depth -1` from the repo root: hippo-memory
   never appears.

2. **Every benchmark run is isolated from every other run, and the two
   systems never share state.** Both runners follow the same rule: a fresh,
   uniquely-named directory under `os.tmpdir()` (via Node's `mkdtempSync`)
   per run, never reused, never shared between rAIminiscence and
   hippo-memory, and deleted (`rmSync(..., { recursive: true, force: true
   })`) once a run's results are captured.
   - **rAIminiscence side**: `storageRoot` is that temp directory, passed
     straight into `remember()`/`recall()`/`consolidate()` — the same
     `StorageLocation` parameter the MCP tool layer itself resolves per
     project. Memories land under `<tmp>/.raiminiscence/memory/`.
   - **hippo-memory side**: confirmed empirically (see "hippo-memory CLI
     notes" below) that it resolves its `.hippo/` store by searching
     upward from `cwd` — so pinning each `child_process` invocation's `cwd`
     to that run's temp directory is sufficient; no `HIPPO_HOME` override
     needed. `--no-hooks --no-schedule --no-learn` are passed to `hippo
     init` so a benchmark run never installs shell hooks, a cron-style
     daily runner, or seeds memories from *this* repo's own real git
     history.
   - **Within** a single Recall@k run, each of the 20 queries is evaluated
     against its own throwaway *copy* of the seeded corpus (see "Why
     per-query isolation, not just per-run isolation" below) — neither
     system's own recall side effects (rAIminiscence's Spaced
     Repetition, and its Spreading Activation edge-strengthening until
     ADR-0037 removed it; hippo-memory's
     retrieval-count-driven salience) leak from one query into the next.
   - **Within** the invalidation benchmark, each of the 9 scenarios gets
     its own fresh store on both sides, so one scenario's invalidated
     memories can never affect another scenario's bystander check.
   - Neither runner depends on the other's process or files at any point —
     `compare.ts` runs all four sequentially only because it has to, not
     because of an ordering dependency: both rAIminiscence calls share one
     local Ollama embedding server, and an actual `Promise.all` attempt
     measurably perturbed its returned vectors enough to flip a close top-5
     ranking tie (Recall@k dropped from a real 90.0% to 87.5% on an
     otherwise-identical rerun) — a real resource-contention effect, not
     benchmark noise, confirmed by re-running the sequential version
     immediately after and getting the original number back.

### Why per-query isolation, not just per-run isolation

This was discovered empirically while building the rAIminiscence runner,
not assumed up front. An early version seeded the corpus once and ran all
10 queries against that same store in sequence. Scores for later queries
came back implausibly large (`>1.0`, when the naive scorer alone is bounded
to `[0, 1]`) — because `recall()` has real, intentional side effects on the
store it's called against: Spaced Repetition bumps `recallCount`/
`lastRecalledAt`, and Spreading Activation strengthens Co-access Edges
between whatever a call returns together, which then *boosts* scores on the
**next** call. Spreading Activation has since been removed
([ADR-0037](../docs/adr/0037-coaccess-and-spreading-activation-are-removed.md));
Spaced Repetition still makes isolation necessary. That's correct, desired behaviour for a real agent session's
sequence of recalls — but it means query 2's score was already shaped by
query 1's results, snowballing by query 10, which is not what "score 10
independent ground-truth queries against one fixed corpus" is supposed to
measure. Both runners now copy the seeded base store into a fresh temp
directory per query (and delete the copy afterward), so every query is
scored against the same untouched corpus.

## Corpus and ground truth

- `corpus/memories.json` — 57 hand-authored, coding-agent-style memories
  (episodic/semantic/decision), including deliberate near-duplicate pairs
  (e.g. `m10`/`m11`, both about choosing Postgres) and confusable siblings
  (e.g. `m01`/`m02` about JWT validation vs. `m03` about session cookies,
  which shares the phrase "auth middleware" but is a different topic) —
  specifically so naive exact-keyword matching alone isn't sufficient to
  score well. Grown from an original 27 on 2026-09-16 (see "History" below,
  "Addendum (2026-09-16, larger-scale re-run)") by adding 10 more topic
  triples (m28-m57) in the same style — a near-duplicate pair plus one
  confusable distractor per topic.
- `corpus/queries.json` — 20 queries, each with a hand-decided
  `relevantIds` answer key (the corpus author's judgment call, made *before*
  either system was run) and `k: 5`. A memory not listed as relevant is
  treated as not relevant even if it shares vocabulary with the query —
  that's what makes the confusable pairs an actual test. Grown from an
  original 10 (q1-q10) alongside the memories.json expansion above; q11-q20
  cover the 10 new topic triples.
- `corpus/invalidation-scenarios.json` — 9 scenarios (8 commit-message
  style, 1 file-based), each with `targetMemories` (should be invalidated)
  and `bystanderMemories` (share a token/substring with the trigger, must
  NOT be invalidated) — mirroring hippo-memory's own "BYSTANDER LOCK"
  regression-test class. Grown from an original 5 on 2026-09-16 with 4 more
  commit-message scenarios (`redux-to-zustand`, `class-components-to-hooks`,
  `node-18-to-22`, `drop-react-admin`) exercising verbs/shapes the original
  5 didn't yet cover (switch, convert, upgrade, drop) and further
  word-boundary bystander cases. One scenario (`remove-moment`) is a deliberate
  **known-limitation** case, included for honesty rather than to flatter
  either system: removing the `moment` date library collides with the
  ordinary English word "moment", which neither a word-boundary-aware nor a
  naive substring matcher can disambiguate from the commit subject alone.

## Schema-mapping compromises

Neither system's schema matches the other's, so writes were mapped as
faithfully as reasonably possible, documented here rather than silently
smoothed over:

| rAIminiscence | hippo-memory | Compromise |
|---|---|---|
| `kind: "decision"` | `hippo decide "<content>"` | Clean match — hippo's own first-class decision object + memory mirror. |
| `kind: "episodic"` / `"semantic"` | `hippo remember "<content>" --observed` | Both rAIminiscence kinds collapse onto hippo's one raw-write path (its episodic buffer). hippo has no "write straight to semantic" primitive outside `sleep`-driven consolidation or a first-class object type (decide/policy/skill) — a "semantic" memory from the corpus is not distinguished from an "episodic" one on the hippo side. |
| `confidence` tiers: `verified`/`observed`/`inferred` | same three flags: `--verified`/`--observed`/`--inferred` | Clean 1:1 match. Both runners default to `observed` since the corpus doesn't specify per-memory confidence. |
| `relatedFiles` (anchors a memory to specific file paths, for v2 file-based invalidation) | *(no equivalent)* | hippo-memory has no file-anchoring concept. The one file-based invalidation scenario is driven on the hippo side via its single invalidation primitive, `hippo invalidate "<pattern>"`, matching on file-name text instead of on an actual changed-file signal — this conflates two mechanisms rAIminiscence keeps independent (v2 file-based vs. v9 commit-message-based). |
| `consolidate()`'s injected `commitSubjects`/`fileChangeTimestamps` (v9/v2 invalidation triggers) | `hippo invalidate "<pattern>"` | rAIminiscence's v9 Commit Invalidation parses a *commit subject* into an outgoing target (via four recognized shapes: migrate/switch/... `from X to Y`, `replace X with Y`, `deprecate X`, `remove`/`drop X`) and matches it word-boundary-aware against memory bodies. hippo-memory has no equivalent commit-message parser — its `learn --git` command extracts general "lessons" from history, a different feature — so all 9 scenarios are driven via `hippo invalidate` with the same already-extracted target string passed directly as the pattern. This is the more direct, reliable option the task explicitly allowed for, but it means hippo-memory is never actually tested on parsing a raw commit message itself, only on matching a pre-extracted target string. |
| Recall's `k` parameter | no direct top-N flag (only `--budget` tokens, `--min-results` floor) | Both runners request a deliberately oversized `--budget`/`--min-results` from hippo so nothing is truncated, then sort the full JSON result list by its own `score` field and slice the same top-k client-side that rAIminiscence's `recall({ k })` returns natively. |
| `staleAt !== null && confidence === "stale"` (rAIminiscence's own invalidated-check) | `Confidence: stale` line in `hippo inspect <id>` | Confirmed empirically (see below) that `hippo invalidate` flips a memory's confidence tier to `stale` (and tags it `invalidated`), the closest hippo-memory analogue to rAIminiscence's own tier — used as the pass/fail check on both sides for parity. |

## hippo-memory CLI notes (confirmed empirically before building the runner)

- `hippo init --no-hooks --no-schedule --no-learn` in a fresh directory
  creates `<cwd>/.hippo/` and nothing outside it; commands search upward
  from `cwd` for a `.hippo/` — cwd-pinning is sufficient for isolation, no
  `HIPPO_HOME` override needed.
- `hippo remember "<text>" --observed` prints `Remembered [mem_...]`;
  `hippo decide "<text>"` prints `Decision recorded: #N\n  memory:
  sem_...` — both parsed by regex in `hippo-memory-runner/*.ts` to recover
  hippo's own assigned id.
- `hippo recall "<query>" --json --budget <big> --min-results <big>`
  returns `{ query, results: [{ id, score, content, layer, tags }], total,
  suppressionSummary }` — no page/limit flag, so both runners rely on
  sorting `results` by `score` and slicing client-side (see mapping table
  above).
- `hippo invalidate "<pattern>"` does real work, not just tagging: it
  flips the matched memory's `Confidence` to `stale` (visible via `hippo
  inspect <id>`) and shortens its half-life, alongside adding an
  `invalidated` tag. `--dry-run` previews without writing.
- One real, reproducible finding from building this benchmark: `hippo
  invalidate "webpack"` did **not** match a memory whose only mention of
  the term was `webpack.config.js` (`webpack-to-vite`'s `inv-m02` in
  `results/2026-09-15-results.json`) — independently re-verified outside
  the harness with a throwaway `.hippo/` store. rAIminiscence's own
  word-boundary regex (`\bwebpack\b`) matches inside `webpack.config.js`
  fine, since `.` is a non-word-boundary character. This looks like a real
  tokenization difference, not a benchmark-harness bug, but it's one data
  point from a synthetic corpus, not a general claim about either system's
  matcher.
- The package's `postinstall` script only repairs an already-installed
  Codex CLI wrapper (a no-op here) and prints an informational nudge about
  Claude Code hook installation to stderr; it writes nothing without a
  prior opt-in. `HIPPO_SKIP_POSTINSTALL=1` is set on every `runHippo()`
  invocation regardless, to keep child-process output free of that nudge
  text (unrelated to the isolation guarantees above, which don't depend on
  it).

## Embedding backends

Both systems use a real, local embedding model in this run — no lexical-only
fallback on either side:

- **rAIminiscence**: `ollama-embedding-provider.ts` wraps the project's real
  `createOllamaEmbeddingProvider()` (`packages/raiminiscence-mcp/src/core/embeddings/ollama.ts`),
  pointed at a local Ollama instance (`http://localhost:11434`,
  `nomic-embed-text`, 768-dim vectors) with a 15s timeout (vs. the 2s
  production default) so a cold model load never silently trips the
  null-on-failure fallback and produces a misleadingly-lexical result.
  `recall()` mixes cosine similarity between the query vector and each
  memory's stored vector with BM25 (ADR-0032); see "Honest caveats" below.
  The provider was confirmed by a standalone sanity check before the real run
  (`embed result: vector length 768 in 690ms`).
- **Selecting rAIminiscence's provider**: every `raiminiscence-runner/*.ts`
  file that needs an embedding provider gets it from
  `embedding-provider.ts`'s `resolveEmbeddingProvider()`, not by importing
  `ollama-embedding-provider.ts` directly. It reads the
  `BENCHMARK_EMBEDDING_PROVIDER` env var (`"ollama"` | `"embedded"`, default
  `"ollama"` to match this directory's existing, already-published results)
  — the same two values as the product's own config discriminant
  (`provider?: "ollama" | "embedded"` in `project-root.ts`). Set it to
  `"embedded"` to instead benchmark `embedded-embedding-provider.ts`
  (`nomic-embed-text-v1` via `@huggingface/transformers`, in-process, no
  separate server — the v17 product default): e.g.
  `BENCHMARK_EMBEDDING_PROVIDER=embedded node_modules/.bin/tsx benchmarks/compare.ts`.
  One exception: `extended-compare.ts`'s shim subprocess pass always seeds
  its stores with the Embedded Provider. The shim runs as its own process
  and resolves its provider from the project's config, and a project with
  none gets the Embedded Provider. Before 2026-11-02 that pass seeded with
  Ollama. `recall` compares a stored vector only with a query vector of
  the same provider and model, so the shim ranked every Memory by its
  lexical fallback alone. Its latencies before that date are timings of
  that fallback path, plus the prompt's embed.
- **hippo-memory**: its optional peer dependency `@huggingface/transformers`
  (`Xenova/all-MiniLM-L6-v2`, ONNX runtime, CPU/fp32) is installed in
  `hippo-memory-runner/package.json`. Once present, `hippo remember` embeds
  automatically on write; `hippo decide` does **not** (confirmed
  empirically), so the recall runner calls `hippo embed` once after loading
  the corpus, before any per-query copy is made, closing that gap for the
  corpus's decision-kind memories. `search.ts` then blends BM25 and cosine
  via reciprocal-rank fusion (`embeddingWeight` default 0.6) rather than
  plain cosine — confirmed via a `--why` recall showing
  `"reason":"embedding similarity: 0.621","bm25":0,"cosine":0.62..."` on a
  single-memory sanity store.
- **Invalidation is unaffected by either embedding backend**: both
  `eligibleForCommitInvalidation`/`eligibleForInvalidation` (rAIminiscence)
  and `hippo invalidate "<pattern>"` (hippo-memory) are text/pattern-matching
  mechanisms with no cosine-similarity step, confirmed by the invalidation
  pass/fail results being identical before and after wiring in real
  embeddings.

## Metrics methodology

- **Recall@k** = `|topK ∩ relevantIds| / |relevantIds|`.
- **Precision@k** = `|topK ∩ relevantIds| / min(k, |topK actually
  returned|)` — **not** the more common `hits / k`. Both systems can
  legitimately return fewer than k candidates when fewer clear matches
  exist (observed for real in this run — e.g. hippo-memory returned only 3
  results for `q2`, rAIminiscence's naive scorer returned only 3 for
  `q5`). Dividing by a fixed k would unfairly penalize a system that
  declines to guess over one that pads its output with weak candidates.
- Invalidation scenarios are scored strictly pass/fail per scenario
  (all targets invalidated AND all bystanders untouched = pass), never
  averaged into one aggregate percentage — the scenario count (5) is too
  small for an aggregate to mean anything, and the task this directory
  implements explicitly called that out.

## Honest caveats

- **The two embedding backends are not the same model, and each system
  weighs them differently.** hippo-memory blends BM25 and cosine via RRF,
  with a 0.6 embedding weight by default. Since
  [ADR-0032](../docs/adr/0032-recall-fuses-lexical-and-embedding-scores.md),
  rAIminiscence's `recall()` ranks by an equal mix of min-max-normalised
  cosine and BM25. A higher Recall@k for one system is not a claim that
  `nomic-embed-text` is a better embedding model than
  `Xenova/all-MiniLM-L6-v2`. The two retrieval algorithms differ, not just
  their embedding backends. This compares each system's as-shipped pipeline
  end to end, not the embedding models on a level playing field.
- **On this corpus, the fused ranking scores lower than plain cosine.**
  Re-run on 2026-11-01, rAIminiscence's Recall@5 fell from 90.0% to 80.0%
  and its Precision@5 from 35.0% to 31.0%. Running the corpus against
  frozen builds pins the drop on ADR-0032 alone. The build before ADR-0032
  finds 35 of the 39 relevant Memories in the top 5. The ADR-0032 build and
  the current code find 31 each, with identical rankings. Four queries lose
  one relevant Memory each, and none gains. LongMemEval moved the other
  way, from 76.6 to 89.8 R@1; see below. With 20 queries, this corpus
  cannot say which effect is typical. The script and its per-query output
  are in
  [`corpus-attribution/2026-11-01-results/`](corpus-attribution/2026-11-01-results/).
  It ran against frozen copies of the built package taken at each point,
  which are not checked in, and its paths are those of the machine that
  ran it.
- **A prior run of this same benchmark, before either embedding backend was
  wired in, measured each system's lexical-only fallback path instead**
  (rAIminiscence's `naiveScore` substring scorer; hippo-memory's BM25-only
  path) and got different, lower numbers for both sides. That run is
  superseded by this one, not additive to it — see the git history of this
  file/`results/` if the lexical-only baseline is ever needed again.
- **Corpus size (57 memories, 20 queries, 9 invalidation scenarios as of
  2026-09-16, up from an original 27/10/5) is still small relative to a
  real project's memory store, by design** — big enough to include a
  wider set of confusable pairs and bystanders while still small enough to
  hand-label every relevance judgment with confidence. Separately, the
  latency/feedback-formula stress tests in the extended pass go
  meaningfully larger (up to 1500 synthetic memories, 200 feedback events,
  a 730-day horizon) precisely because those don't need hand-labelled
  ground truth. Neither is a claim about Recall@k/Precision@k performance
  at real-project scale (thousands of memories) — that would need a much
  larger hand-labelled corpus, a materially bigger undertaking than scaling
  a procedurally-generated stress test.
- **Nothing failed to run.** Both installs, both write paths, both
  read/recall paths, and both invalidation paths executed successfully;
  every number in `results/` came from an actual execution, not an
  estimate.

## Files in this directory

- `corpus/memories.json`, `corpus/queries.json`,
  `corpus/invalidation-scenarios.json` — the shared, hand-authored
  ground-truth fixtures both runners load. Checked in; re-runnable.
- `raiminiscence-runner/` — imports `remember`/`recall`/`consolidate`
  directly from `packages/raiminiscence-mcp/src/core/*` (no MCP protocol
  involved, per the HLD's stated zero-MCP-dependency design) and drives
  them against isolated temp `storageRoot`s, using `embedding-provider.ts`'s
  `resolveEmbeddingProvider()` (a real Ollama- or Embedded-backed provider,
  see "Embedding backends" above) for `remember`/`recall`'s
  `embeddingProvider` parameter.
- `hippo-memory-runner/` — its own isolated npm package (`package.json`,
  `package-lock.json`, gitignored `node_modules/`, `@huggingface/transformers`
  as a real dependency for local embeddings) driving the real `hippo-memory`
  CLI (`hippo-cli.ts`) against isolated temp `.hippo/` working directories.
- `compare.ts` — orchestrates both runners, computes the metrics, writes
  `results/2026-09-15-results.md` and `results/2026-09-15-results.json`.
- `hook-latency-interleaved.ts` — ADR-0039's acceptance check. Times
  rAIminiscence's real hook, with its MCP server running, against
  hippo-memory's real hook, call by call in alternation: 21 pairs per store
  size, the order flipped every pair, with a paired bootstrap interval from
  `paired-latency.ts`. `extended-compare.ts` times the two in separate
  phases, so load that changes between phases lands on one side only. Run
  it with `node_modules/.bin/tsx benchmarks/hook-latency-interleaved.ts`;
  it writes `results/<date>-hook-latency-interleaved.md` and `.json`.
- `warm-process-acceptance.ts` — ADR-0040's acceptance check, with no MCP
  server running. Times a first prompt that starts a warm process against
  today's cold hook, then the hook served by its own warm process against
  hippo-memory's real per-turn hook, interleaved. Also checks that the
  output is unchanged and that ten concurrent first calls leave one warm
  process. Run it with
  `node_modules/.bin/tsx benchmarks/warm-process-acceptance.ts`; it writes
  `results/<date>-warm-process-acceptance.md` and `.json`.
- `write-latency-interleaved.ts` — write cost as an agent sees it. Times
  one `remember` call to rAIminiscence's real MCP server against one
  `hippo_remember` call to `hippo mcp`, both already running, 21 pairs
  per store size, interleaved as above, with a pause after each pair.
  Both servers are driven by `mcp-stdio-client.ts`, a minimal stdio
  JSON-RPC client. Run it with
  `node_modules/.bin/tsx benchmarks/write-latency-interleaved.ts`; it
  writes `results/<date>-write-latency-interleaved.md` and `.json`.
- `benchmark-gate.ts` — the gate that defines "at least as good" in
  `NEXT_STEPS.md`. Checks that `hippo-memory-runner/` pins the latest
  hippo-memory release, freezes a built copy of the repo in its work
  directory, then runs `compare.ts`, `extended-compare.ts` and
  `hook-latency-interleaved.ts` from that copy, and LongMemEval-S and
  LoCoMo through hippo-memory's own harnesses at that release's tag.
  rAIminiscence runs its default, Embedded provider against both
  hippo-memory arms. `benchmark-gate-verdict.ts` scores the saved rows
  as hippo-memory's scorers do and applies the gate: every reported
  metric's paired 95% interval keeps its lower bound at or above -3
  points, and the hook's median stays at or below hippo-memory's at every
  store size. A full run takes about a day; a finished step is skipped
  on a re-run, and both harnesses resume per question.
  `benchmark-gate-guard.ts` makes each step wait until the load average
  is at or below the core count, and kills a command silent for 90
  minutes with its workers, retrying its step once. Run it with
  `node_modules/.bin/tsx benchmarks/benchmark-gate.ts --work=<dir>
  --locomo-data=<locomo10.json>`; it writes
  `results/<date>-benchmark-gate.md` and `.json`, and exits 1 when the
  gate fails. `--limit=<n>` is a smoke run in its own work directory:
  LongMemEval-S's first n questions and LoCoMo's first conversation.
- `results/` — the dated, checked-in report and its raw JSON. Re-generated
  by re-running `compare.ts`; not hand-edited.

## LongMemEval-S through hippo-memory's own harness (n=500)

A comparison on [LongMemEval](https://arxiv.org/abs/2407.15811) (ICLR 2025), run on 2026-10-30 and 2026-10-31. Both systems go through hippo-memory's own harness, on the same data, with the same process. The 2026-09-24 run this replaces used this repo's own runners. See History below.

- **Harness:** `recall_cli_haystack.py` from hippo-memory at `a59ea151`, unchanged. hippo-memory 1.52.5 is packed from `d0150e5`.
- **Data:** `longmemeval_s_cleaned.json`, all 500 questions, six question types.
- **Build:** one store per question. Every haystack session goes in through `remember -` on the command line, one fresh process per call.
- **Recall:** each call copies the built store first, so no recall changes a later one.
- **Scoring:** hippo-memory's own `evaluate_retrieval.py`, unchanged. A hit means an evidence session appears in the top k.
- **rAIminiscence's entry point:** [`raiminiscence-runner/hippo-cli-shim.ts`](raiminiscence-runner/hippo-cli-shim.ts) answers the harness's `init`, `remember`, `recall` and `embed` calls with the real `remember` and `recall`.

### Runs

| Run | System | Ranking |
| --- | --- | --- |
| A | hippo-memory | BM25 only |
| B | hippo-memory | BM25 plus MiniLM embeddings, after `hippo embed` |
| R, ER | rAIminiscence, Ollama / Embedded | Dense similarity, before ADR-0032 |
| F, EF | rAIminiscence, Ollama / Embedded | Fused lexical and dense score, [ADR-0032](../docs/adr/0032-recall-fuses-lexical-and-embedding-scores.md) |
| OD, ED | rAIminiscence, Ollama / Embedded | As F, plus the whole body as `detail`, [ADR-0033](../docs/adr/0033-recall-returns-the-whole-memory-body.md) |
| B-slept, F-slept | Both | B and F after one consolidation pass per store |

Each run has three variants:

- **default:** the system's own default. hippo-memory fills a 4,000-token budget. rAIminiscence returns `k` = 10.
- **lifted:** both rank the whole haystack. This is the like-for-like comparison.
- **shuffled:** the lifted run with evidence labels shuffled. It is a sanity floor, not a result.

OD and ED were the current code on 2026-10-31; ADR-0034 to ADR-0038 came after and these arms were not re-run. F and OD rank identically; they differ only in the text returned.

### Results, whole haystack ranked

| Run | R@1 | R@3 | R@5 | R@10 | answer_in_content@5 |
| --- | --- | --- | --- | --- | --- |
| hippo-memory A | 85.4 | 94.6 | 96.8 | 98.0 | 50.0 |
| hippo-memory B | 87.6 | 95.2 | 97.4 | 99.2 | 50.6 |
| rAIminiscence OD, Ollama | **89.8** | **96.2** | **98.4** | 99.2 | **50.8** |
| rAIminiscence ED, Embedded | 86.4 | 95.0 | 97.0 | 98.8 | 50.4 |
| rAIminiscence R, before ADR-0032 | 76.6 | 90.6 | 93.6 | 96.6 | 13.6 |
| rAIminiscence ER, before ADR-0032 | 65.4 | 82.0 | 87.2 | 93.8 | 12.8 |

Paired bootstrap against hippo-memory B, 10,000 resamples, seed 1, 95% interval:

| Difference | R@1 | R@5 | answer_in_content@5 |
| --- | --- | --- | --- |
| OD minus B | +2.2 [+0.2, +4.2] | +1.0 [-0.2, +2.4] | +0.2 [-0.8, +1.2] |
| ED minus B | -1.2 [-3.6, +1.2] | -0.4 [-1.6, +0.6] | -0.2 [-0.8, +0.4] |

The claim these support is "at least as good as hippo-memory's best run". With Ollama, rAIminiscence puts the right session first slightly more often. Every other difference is inside its interval.

Per question type, R@1 / R@5:

| Type | Count | OD | ED | B | A |
| --- | --- | --- | --- | --- | --- |
| knowledge-update | 78 | 93.6 / 100.0 | 93.6 / 100.0 | 96.2 / 100.0 | 93.6 / 100.0 |
| multi-session | 133 | 91.7 / 99.2 | 88.7 / 97.7 | 89.5 / 97.0 | 85.0 / 96.2 |
| single-session-assistant | 56 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 |
| single-session-preference | 30 | 73.3 / 93.3 | 43.3 / 80.0 | 60.0 / 86.7 | 40.0 / 86.7 |
| single-session-user | 70 | 88.6 / 98.6 | 85.7 / 98.6 | 87.1 / 98.6 | 90.0 / 98.6 |
| temporal-reasoning | 133 | 85.7 / 97.0 | 84.2 / 96.2 | 82.0 / 97.0 | 82.7 / 95.5 |

Per-type cells hold 30 to 133 questions, so differences of a few points are noise.

### hippo-memory 3.1.1, and all-evidence recall (2026-11-02)

Re-run of hippo-memory's arms A and B with hippo-memory 3.1.1, the latest
release, on the harness at `v3.1.1`. Its `recall_cli_haystack.py` differs
from `a59ea151` only in a docstring. The rAIminiscence arms are the
2026-10-31 runs above, not re-run.

hippo-memory 3.1.1 scores the same as 1.52.5. Arm A matches it on every
metric. Arm B moves by at most 0.2 points on any of them.

hippo-memory's [benchmark page](https://hippo-memory.com/benchmarks/) now
leads with a stricter measure: a hit only when every evidence session is
in the top k, over the 470 questions that are not abstentions. Its own
`score_haystack.py` prints it, as `all`. Scored that way, unchanged, with
paired bootstrap against 3.1.1's B, 10,000 resamples, seed 1, 95%
interval:

| Run | All-evidence R@1 | All-evidence R@5 | All-evidence R@10 |
| --- | --- | --- | --- |
| hippo-memory 3.1.1 B | 30.6 | 83.2 | 90.6 |
| hippo-memory 3.1.1 A | 30.4 | 83.6 | 90.2 |
| rAIminiscence OD, Ollama | **32.3**, +1.7 [+0.4, +3.2] | **87.2**, +4.0 [+1.9, +6.4] | **94.3**, +3.6 [+1.9, +5.5] |
| rAIminiscence ED, Embedded | 29.4, -1.3 [-3.0, +0.4] | 84.9, +1.7 [-0.4, +3.8] | 91.5, +0.9 [-1.1, +2.8] |

On this measure rAIminiscence with Ollama leads clearly at every k, and
the Embedded build is level. That page's headline, 86.8 to 88.5% with
MiniLM, does not come from `hippo recall`. It comes from separate
scripts that index every turn and fuse BM25 with dense ranks, best of
five settings. Through `hippo recall` itself, on this harness, hippo-memory
scores 83.2%.

Files: [`longmemeval/2026-11-02-hippo-3.1.1/`](longmemeval/2026-11-02-hippo-3.1.1/)
holds the four hippo-memory 3.1.1 runs, the driver, the bootstrap script,
and both scorers' output.

### Results at each system's default

| Run | R@1 | R@5 | answer_in_content@5 | Median tokens returned |
| --- | --- | --- | --- | --- |
| hippo-memory A | 85.4 | 85.6 | 38.2 | 3,927 |
| hippo-memory B | 87.6 | 87.6 | 38.4 | 3,923 |
| rAIminiscence OD | 89.8 | 98.4 | 50.8 | 29,656 |
| rAIminiscence ED | 86.4 | 97.0 | 50.4 | 28,130 |

Do not read this table as a win. hippo-memory's 4,000-token budget fits about one LongMemEval session, so its R@5 is close to its R@1. rAIminiscence returns 10 whole sessions at about 7.5 times the tokens. At equal cost the two are level: see the token-budget table below. Since [ADR-0034](../docs/adr/0034-recall-default-k-is-three.md) the default `k` is 3, which these runs predate.

### What else was measured

Fixed before any rAIminiscence run, in [`lme-extra.py`](longmemeval/2026-10-31-results/scripts/lme-extra.py).

- **Freshness.** The 78 knowledge-update questions each have exactly two evidence sessions: an old value and its update. Measured: how often the update ranks above the stale value. A 59.0, B 56.4, OD 50.0, ED 57.7. OD minus B is -6.4 [-16.7, +2.6]; ED minus B is +1.3 [-10.3, +12.8]. Neither system tracks updates; all sit near a coin flip. See [`freshness.txt`](longmemeval/2026-10-31-results/extra/freshness.txt).
- **Consolidation.** One pass per store, then recall. hippo-memory's `sleep` removed 24 duplicates and created 13 Memories across 21 stores; its recall did not change. rAIminiscence's `consolidate` created 338 Semantic Memories in 269 stores and removed none. They push sessions down: F's R@1 falls from 89.8 to 85.8; R@5 is unchanged. The harness counts a consolidated Memory as a miss even when it summarises an evidence session, so part of that drop is the harness. See [`consolidation.json`](longmemeval/2026-10-31-results/extra/consolidation.json).
- **Token budget.** Each ranking filled to a fixed number of tokens by hippo-memory's own rule: the top result always, then every later one that still fits. This holds context cost equal. 500 to 4,000 tokens were fixed in advance; 8,000 to 32,000 were added after the other results were seen. See [`token-budget.txt`](longmemeval/2026-10-31-results/extra/token-budget.txt).

  | Budget, tokens | R: OD / ED / B | answer_in_content: OD / ED / B | OD minus B, answer_in_content |
  | --- | --- | --- | --- |
  | 500 | 89.8 / 86.4 / 87.6 | 38.0 / 36.8 / 38.0 | +0.0 [-1.8, +1.8] |
  | 4,000 | 89.8 / 86.4 / 87.6 | 38.2 / 37.0 / 38.2 | +0.0 [-1.8, +1.8] |
  | 8,000 | 94.4 / 92.6 / 93.2 | 46.0 / 45.2 / 44.6 | +1.4 [-0.2, +3.0] |
  | 16,000 | 97.4 / 96.4 / 97.0 | 50.4 / 50.0 / 49.8 | +0.6 [-0.6, +1.8] |
  | 32,000 | 99.2 / 98.6 / 99.2 | 51.8 / 52.0 / 52.2 | -0.4 [-1.2, +0.4] |

  Up to 4,000 tokens, one LongMemEval session fills the budget, so R equals R@1. At 32,000 tokens, all 10 stored rows fit for 71 to 84% of questions, and the harness keeps no 11th: that row is a 10-result comparison, not a 32,000-token one. At every budget the two systems are level within their intervals, apart from Ollama's R@1 lead at the smallest ones.
- **Detail cap.** Before ADR-0033, `detail` stopped at 280 characters. Rebuilt offline from F's ranking, answer_in_content@5 is 14.0 at 280 characters, 27.2 at 2,000, 36.6 at 4,000, 44.4 at 8,000 and 50.8 uncapped. The 280 figure reproduces the measured F run. See [`detail-cap-sweep.txt`](longmemeval/2026-10-31-results/extra/detail-cap-sweep.txt).
- **Cost.** Median `remember` per session: hippo-memory 0.13 s, plus 8.4 s of `hippo embed` per store for B. rAIminiscence 1.5 s with Ollama and 2.1 s Embedded, because it embeds every whole session at write time. Building all 500 stores took 0.9 hours for hippo-memory A, 10.3 for Ollama and 14.9 for Embedded. Median recall over the whole haystack: A 0.18 s, B 0.65 s, OD 0.35 s, ED 0.79 s. See [`cost.json`](longmemeval/2026-10-31-results/extra/cost.json).

### Deviations from hippo-memory's protocol

- rAIminiscence runs through the shim, not a native CLI. Each call is still a fresh process.
- `k` = 10 stands in for hippo-memory's default budget. Lifted means `k` covers the whole store.
- Ollama runs CPU-only in Docker with a 15-second embed timeout. One embed timed out during the Ollama build; the harness rebuilt that store on its next attempt.
- rAIminiscence Ollama arms ran one worker. The Embedded build started at two and dropped to one after memory pressure; its recall ran at one. hippo-memory ran at the harness's worker counts. Per-call seconds are wall-clock under that load.
- Opportunistic consolidation is off in every rAIminiscence call. Only the slept runs consolidate, once, before recall.
- Model caches were downloaded before timing started.
- Each rAIminiscence arm ran from a frozen copy of its build, so edits to the repo could not reach a running arm.
- Every Memory is written at build time, so Decay, Half-life and time-based features play no part for either system.
- The ADR-0032 mix was chosen after an offline replay over these same stores, and ADR-0033's cap after a sweep over them. Both ADRs say so.

### Files

All under [`longmemeval/2026-10-31-results/`](longmemeval/2026-10-31-results/):

- `runs/<run>.jsonl.gz`: every harness row for all 27 runs. A retrieved Memory's `content` is dropped when it is a haystack session's text, which the dataset holds; it is kept for Memories consolidation created. [`slim-runs.py`](longmemeval/2026-10-31-results/scripts/slim-runs.py) writes these.
- `scores/<run>.json`: `evaluate_retrieval.py` output per run, from the full rows.
- `stats/*.json`: the harness's own `stats` output, R@5 with paired intervals.
- `extra/`: the metrics above, plus the R@1 and answer_in_content intervals.
- `scripts/`: the driver, queue, consolidation and scoring scripts as run. Paths are those of the machine that ran them. `setup-hippo.sh` installs the harness and both hippo-memory builds.
- `benchmarks/longmemeval/data/` is gitignored. Download `longmemeval_s_cleaned.json` from [xiaowu0162/longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned).

## LoCoMo through hippo-memory's own harness (n=1,982)

A second public benchmark, run on 2026-11-02 under the protocol hippo-memory
froze for it in `benchmarks/LOCOMO_INVESTIGATION.md`. Both systems go
through the same harness, on the same data, with the same process.

- **Harness:** `benchmarks/locomo/run.py` from hippo-memory at `v3.1.1`, unchanged, with `--score-mode evidence`: deterministic, no LLM judge. Then its `score_evidence.py`, the canonical rescore.
- **Data:** [LoCoMo](https://github.com/snap-research/locomo)'s `locomo10.json`, sha256 `79fa87e9…98ff4`, the hash hippo-memory recorded. 10 conversations, 5,882 turns, 1,982 scored questions.
- **Build:** a fresh store per conversation. Each turn goes in through `remember <text>` with `conv:`, `session:`, `speaker:` and `dia:` tags, one fresh process per call.
- **Recall:** `recall <question> --json --budget 4000`, top 5.
- **Metric:** evidence recall@k, the share of a question's gold turns among its top k results, averaged over questions. The protocol's number is k = 5. k = 1 and 3 come from the same saved ranking.
- **Arms:** hippo-memory 3.1.1 as installed, BM25 only (A), and with `@huggingface/transformers` added, so it embeds with MiniLM at write time (B). rAIminiscence's current build, frozen before the run, with Ollama and Embedded.
- **rAIminiscence's entry point:** the same [`hippo-cli-shim.ts`](raiminiscence-runner/hippo-cli-shim.ts) as LongMemEval, extended for this harness. `--tag` values go to a sidecar file and come back in `tags` for the scorer; they never touch ranking. `--budget N` keeps results while their token total stays within N, the counterpart of hippo-memory's budget.

### Results

Paired bootstrap against hippo-memory B, 10,000 resamples, seed 1, 95%
interval:

| Run | R@1 | R@3 | R@5 |
| --- | --- | --- | --- |
| hippo-memory 3.1.1 B, MiniLM | 33.4 | 49.5 | 56.5 |
| hippo-memory 3.1.1 A, BM25 | 31.5, -1.9 [-3.1, -0.7] | 46.9, -2.5 [-3.7, -1.4] | 52.6, -3.9 [-5.1, -2.8] |
| rAIminiscence, Ollama | 33.4, -0.1 [-1.2, +1.1] | 51.6, +2.2 [+1.0, +3.3] | 58.4, +1.9 [+0.8, +2.9] |
| rAIminiscence, Embedded | **33.9**, +0.5 [-0.6, +1.6] | **52.2**, +2.8 [+1.5, +4.0] | **59.1**, +2.6 [+1.5, +3.7] |

Both rAIminiscence builds lead hippo-memory's best run at R@3 and R@5, and
tie it at R@1. The lead comes from multi-hop, open-domain and single-hop
questions. On multi-hop, Embedded's R@5 is 69.3 against 63.6, +5.7
[+3.1, +8.5]. On adversarial and temporal-reasoning questions the arms are
level within their intervals.

hippo-memory publishes 0.363 on this protocol, measured with v1.25.0 in
July 2026. 3.1.1 scores 0.565 here. The two are different releases, so
that figure is not a baseline for this run.

### Deviations and limits

- One run per arm. The ranking is deterministic, so a re-run would
  repeat it; the intervals cover question sampling, not run-to-run noise.
- No consolidation on either side, as in LongMemEval.
- Wall time: hippo-memory 46 and 71 minutes, rAIminiscence 76 with Ollama
  and 173 Embedded, partly overlapping with other runs. Every call is a
  fresh process, so the Embedded build loads its model on each one.
- LoCoMo is licensed CC BY-NC 4.0, so the data is not checked in, to
  keep non-commercial terms out of this repository. Download
  `data/locomo10.json` from
  [snap-research/locomo](https://github.com/snap-research/locomo).

### Files

All under [`locomo/2026-11-02-results/`](locomo/2026-11-02-results/):

- `results/<arm>-rescored.json.gz`: `score_evidence.py` output per arm,
  with each question's top-5 dia_ids and scores. Question text and
  turn text are dropped; the dataset holds them.
- `analysis.txt`: the table above, per category too, from
  `scripts/analyze.py`.
- `scripts/locomo-drive.sh`: the driver as run. Paths are those of the
  machine that ran it.

## Co-access Edges and the recall cache (ADR-0035 to ADR-0037)

Run on 2026-11-01, rAIminiscence only. These measurements led to three decisions:

- [ADR-0035](../docs/adr/0035-coaccess-learns-only-from-selection-and-boost-is-bounded.md) bounded the Co-access boost.
- [ADR-0036](../docs/adr/0036-recall-cache-appends-instead-of-rewriting.md) made the recall cache append-only.
- [ADR-0037](../docs/adr/0037-coaccess-and-spreading-activation-are-removed.md) removed Co-access Edges and Spreading Activation.

The LongMemEval runs above used fresh stores that no recall had touched, so no edge ever formed. These replays test the edges directly.

Every comparison is paired, edges on minus edges off. Intervals come from a bootstrap of 10,000 resamples with seed 1, at 95%.

### LongMemEval-S, the per-turn hook replayed

The script is [`replay.mts`](coaccess/2026-11-01-results/longmemeval-replay/scripts/replay.mts). Its rules were registered in its docstring before any replay ran.

- **Questions:** the 324 questions with two or more evidence sessions.
- **Store:** sessions go in by date.
  - Before a session is stored, each of its user turns runs one `recall`.
  - Each recall uses the per-turn hook's settings: `k` = 10 and no consolidation.
  - That forms edges the way real use does: 77,133 recalls in all.
- **Arms:** "off" is a copy of the store with the edge files and the recall cache deleted. Only the edges differ.
- **Final query:** the question itself, ranked over the whole store.
- **Embeddings:** Ollama `nomic-embed-text`, with session vectors reused from the Ollama build above.

| Build | R@1, on / off | all-evidence@5, on / off | R@1, on minus off |
| --- | --- | --- | --- |
| Before ADR-0035 | 10.8 / 90.7 | 0.6 / 80.6 | -79.9 [-84.3, -75.3] |
| ADR-0035 | 90.1 / 90.7 | 80.6 / 80.6 | -0.6 [-1.5, +0.0] |

**Before ADR-0035:**
- Each store's first 10 sessions formed a clique of 45 edges, with weights near 400.
- After that, every recall returned those same 10 Memories, whatever the prompt.

**After ADR-0035:**
- The bounded boost stopped the runaway. R@5 and R@10 were identical in both arms.
- 57 of the 324 questions ranked their evidence differently. In 24 the evidence moved up, in 12 it moved down, and in 21 it moved both ways. The headline metrics barely changed.

### Repeated work: two repositories' own histories

This workload gives the edges their best case: the same kind of task, asked again and again. The script is [`replay.mts`](coaccess/2026-11-01-results/repeated-work/scripts/replay.mts), registered the same way.

- **Repos:** honojs/hono at `c91b60a2` and pallets/flask at `49943b5a`.
  - The first 80% of non-merge commits train the store. The last 20% test it.
  - [`prep.py`](coaccess/2026-11-01-results/repeated-work/scripts/prep.py) rebuilds the input from a clone.
- **Memories:** one per tracked text file, as of the last train commit. The body is the path, then the file's first 2,000 characters.
  - Flask has 206 Memories. Hono has 415.
- **Training:** each train commit's message runs one `recall` with the hook's settings.
  - Flask ran 3,065 recalls. Hono ran 2,253.
- **Test:** each test commit that changed 2 to 10 stored files, 692 in all.
  - Its message runs one read-only `inspectQuery` per arm.
  - The truth set is the files the commit changed.
- **Primary metric:** file recall@10, the share of changed files in the top 10.

| Boost | Flask, 366 commits | Hono, 326 commits | Commits whose ranking changed |
| --- | --- | --- | --- |
| ADR-0035, bounded | +0.0 [+0.0, +0.0] | -0.2 [-0.5, +0.0] | 1 of 692 |
| Weight-relative, tuned on Flask | +3.5 [+1.9, +5.1] | -2.9 [-4.9, -0.9] | 142 of 692 |

Off-arm file recall@10 is 46.4 on Flask and 66.4 on Hono.

**The ADR-0035 boost had almost no effect.**
- It saturated: almost every Memory got the same 0.085.
- On Flask, edges linked 14,236 of the 21,115 possible pairs.

**The edges still carry a real signal.** This analysis was exploratory, run after the results were in.
- Seed with a correct top result.
- Edge weight then picks out the other changed files with an AUC of 0.84 on Flask and 0.96 on Hono.
- Real co-change counts from the training commits give 0.89 and 0.95.
- Script: [`signal.py`](coaccess/2026-11-01-results/repeated-work/scripts/signal.py).

**The weight-relative boost did not generalise.**
- The rule was registered before tuning, in [`adr0037-prereg.md`](coaccess/2026-11-01-results/repeated-work/scripts/adr0037-prereg.md). It scales each edge against the strongest edges in the pool.
- [`tune.py`](coaccess/2026-11-01-results/repeated-work/scripts/tune.py) searched 24 configurations on Flask alone.
  - It simulates the boost offline.
  - The simulation reproduces the ADR-0035 arm exactly: 0 of 366 commits differ.
- The chosen configuration then ran through the real code:
  - On Flask, the tuning set, it gained 3.5 points.
  - On Hono, held out, it lost 2.9 points.
- Under the ship rule, which was registered before the run, it did not ship. The LongMemEval arm was stopped after one question, since its result could no longer change the decision.

ADR-0037 then removed the mechanism.

### Write and recall cost

These scripts are in [`latency/scripts/`](coaccess/2026-11-01-results/latency/scripts/). Both measurements used the Embedded provider.

**Write cost**
- Before ADR-0036, building a 15,000-Memory store took 6,095 seconds.
- Each `remember` rewrote both whole cache files.
- [`write-breakdown.mjs`](coaccess/2026-11-01-results/latency/scripts/write-breakdown.mjs) times 5 writes into an existing store.

| Store | Before ADR-0036 | After ADR-0036 |
| --- | --- | --- |
| 1,500 Memories | 241 ms | 52 ms |
| 15,000 Memories | 1,560 ms | 44 ms |

Before ADR-0036, at 15,000 Memories, a single write spent 1,387 ms in `JSON.stringify` and wrote 256 MB. The script printed these figures and no file kept them. They are copied from ADR-0036 and the run notes.

**Recall latency**
- Measured with `k` = 10 and a warm cache.
- The table gives the median of 7 calls, end to end, including the query embed.

| Store | Before ADR-0032 | ADR-0032 and ADR-0033 | ADR-0036 |
| --- | --- | --- | --- |
| 150 Memories | 19.2 ms | 20.4 ms | not run |
| 1,500 Memories | 24.5 ms | 27.3 ms, then 29.0 ms | 29.1 ms |
| 15,000 Memories | 66.6 ms | 93.1 ms, then 86.9 ms | 78.3 ms |

The middle build was measured in two sessions, and its column shows both. The first session is paired with the column to its left, the second with the column to its right. Both sessions ran with no replay going, so the gap between them is noise from one session to the next.

The rows are in [`results.jsonl`](coaccess/2026-11-01-results/latency/results/results.jsonl) and [`results-cachelog.jsonl`](coaccess/2026-11-01-results/latency/results/results-cachelog.jsonl). Scoring-only times are in the same files.

### Deviations and limits

- Every arm ran from a frozen copy of its build.
- The repeated-work replay used the ADR-0036 build. The LongMemEval replay used the ADR-0033 build, and its third arm used the ADR-0035 build.
- Each file Memory holds only the first 2,000 characters of its file. A change deep inside a large file is therefore hard to match by its text, in both arms alike.
- Flask was both the tuning set and a reported result. Its +3.5 measures fit, not generalisation. Only Hono's number is a test.
- All scripts and results come from one machine, and the paths in them are that machine's.

### Files

All under [`coaccess/2026-11-01-results/`](coaccess/2026-11-01-results/):

- `longmemeval-replay/`
  - `scripts/` holds both replay arms, the scorer and the clique investigation.
  - `results/` holds one row per question with every evidence rank in each arm, plus the scored summaries.
- `repeated-work/`
  - `scripts/` holds the input builder, both replays, the scorer, the tuner, the signal analysis and the registration.
  - `results/` holds one row per test commit with every truth file's rank in each arm, the scored summaries and the Flask tuning grid.
- `latency/` holds the store builder, the latency and write-cost scripts, and their result rows.

## History

Dated addenda recording how this benchmark's scope grew after the original
2026-09-15 pass, oldest first.

**Addendum (2026-09-15-extended):** the two items this pass explicitly left
out of scope — outcome-feedback decay-formula curves and per-turn auto-recall
latency/token budget — are now measured in `results/2026-09-15-extended-results.md`
(raw data: `results/2026-09-15-extended-results.json`), built by
`extended-compare.ts` plus `*-runner/latency-runner.ts` and
`*-runner/feedback-formula-runner.ts` on each side. This original file and
its results are unmodified and still stand as the Recall@k/Precision@k and
invalidation-correctness pass.

**Addendum (2026-09-16):** re-ran both passes against rAIminiscence as of
v13 (v11 Shared Memory, v12 Reinforcement Ceiling, v13 Checkpoint all
shipped since the 2026-09-15 run). Recall@k/Precision@k/invalidation are
unchanged — none of the three versions touch retrieval or invalidation, only
`generatedAt` moved in `2026-09-15-results.json`. The outcome-feedback
section of `2026-09-15-extended-results.md` changed materially: v12's
Reinforcement Ceiling now bounds the positive feedback term that pass had
found (correctly, at the time) to be unbounded — see that file's updated
"Headline comparison" line and `feedback-formula-runner.ts`'s docstring for
what changed and why. Filenames are unchanged (per this directory's
in-place-regeneration convention above), so the 2026-09-15 date now means
"the pass this file represents," not "the last time it was generated" —
check `generatedAt` in the paired `.json` for that.

**Addendum (2026-09-16, larger-scale re-run):** grew the hand-labelled
Recall@k/invalidation corpus (27→57 memories, 10→20 queries, 5→9
invalidation scenarios — see "Corpus and ground truth" above) and the
extended pass's stress-test ranges (`STORE_SIZES` 300→1500,
`FEEDBACK_COUNTS` 50→200, `ASSESSED_AT_DAYS` 180→730 days, in
`extended-compare.ts`), to see whether either system's behaviour changes
once tested past the original passes' scale. It does, on one axis:
rAIminiscence's per-turn recall latency, which looked roughly linear in
store size up to 300 memories, turns out to scale **worse than linear**
past that point (300→750→1500: 115.9ms → 506.0ms → 1967.3ms shim
subprocess latency — a ~17x latency increase for only a 5x store-size
increase from 300→1500) — a real finding the original 300-memory ceiling
was too small to surface. hippo-memory's structurally-bounded
`--pinned-only --include-recent 5` query stays flat (118-125ms) across the
same 150x store-size range (10→1500), confirming that design holds at
scale too, not just up to 300. The outcome-feedback Reinforcement Ceiling
(previous addendum) also holds up at 4x the previously-tested range: 730
days / 200 events pushes Strength only 0.001 further than 730 days / 50
events, confirming the asymptote is real and not an artifact of a
narrow test range. See `results/2026-09-15-extended-results.md`'s
"Saturation check" line. One authoring bug surfaced and was fixed during
this pass: the new `drop-react-admin` invalidation scenario's commit
subject initially included trailing text after the target
("drop React from the admin panel"), which the product's own
`remove|drop` regex captures as part of the target since that shape has
no "from"-stripping (unlike the migrate/switch/... shape) — fixed to a
bare "drop React", matching the existing `remove-moment` scenario's shape.
Runtime: `compare.ts` is still well under a minute against the larger
corpus; `extended-compare.ts` now takes about 15 minutes (up from roughly
a minute), almost entirely hippo-memory's per-memory CLI subprocess spawns
at the 750/1500 store sizes — a real cost of testing hippo-memory at that
scale via its CLI, not a rAIminiscence-side change.

**Addendum (2026-09-17, v14 / ADR-0021):** widened `extended-compare.ts`'s
scope again, rAIminiscence-only this time, to cover opportunistic
consolidation — a cost the recall-latency numbers above never isolated,
since the per-turn hook explicitly opts out of it
(`triggerConsolidation: false`) and it otherwise runs unobserved via
`setImmediate` on the same event loop as the MCP server. Three new
measurements, from `raiminiscence-runner/consolidation-contention-runner.ts`:

1. **Duration** — `consolidate()`'s own wall-clock cost (Clustering,
   Promotion, Promotion Audit, Commit Invalidation, Pruning, Invalidation),
   one fresh store per size, one pass only.
2. **Contention** — the actual user-facing symptom: how much slower the
   *next* `recall()` is when it runs right after a `remember()` that
   scheduled a pending consolidation (production's real default), versus
   the same next call with no pending pass at all.
3. **Shared Memory overhead** — isolates `flushSharedMemory`'s git cost
   (`add -A`, `commit`, a push attempt against no configured remote) from
   consolidate's own local compute cost measured in (1), at fewer store
   sizes since real `git` subprocesses per size make this the most
   expensive of the three.

Results live in `results/2026-09-15-extended-results.md`'s "Opportunistic
consolidation" section and the dashboard; per ADR-0021, whether the measured
contention overhead warrants its own fix (e.g. moving consolidation off the
event loop) is deferred to a follow-up pass, with these numbers as its
starting evidence.

**Addendum (2026-09-24):** added the LongMemEval retrieval-only comparison
above — a second, independent benchmark against a published academic
dataset rather than this repo's own corpus, deliberately scoped to
retrieval only (not downstream answer generation) after finding
rAIminiscence's real `recall()` truncates content to 280 characters, far
below LongMemEval's ~9,870-character average session. Validated first on
a 100-question stratified sample, then run against the complete 500-question
dataset the same day; the section above reports the full n=500 result,
with the n=100 pass noted as superseded, consistent with this file's
"real run supersedes a smaller prior one" convention elsewhere in this
history.

**Addendum (2026-10-31):** replaced the LongMemEval comparison above. The
2026-09-24 pass drove both systems through this repo's own runners
(`longmemeval-validate.ts` and the two `longmemeval-retrieve.ts`) and reported
hippo-memory ahead: Recall@1 72.2% vs. 62.0%, Recall@5 93.0% vs. 85.4%,
answer_in_content@5 47.6% vs. 8.6%. Its result files moved, unchanged, to
`longmemeval/archive/2026-09-24/`. The new pass runs hippo-memory's own harness
for both systems, so data, process and scorer are hippo-memory's. It measures
rAIminiscence before and after two changes it motivated: fused lexical and
dense ranking (ADR-0032) and the whole Memory body as `detail` (ADR-0033).
Both raise rAIminiscence to hippo-memory's level on this dataset. Neither side's numbers compare
directly with the earlier pass: the harness, the retrieval settings and the
scored runs all differ.

**Addendum (2026-11-01):** added the Co-access section above. The
LongMemEval stores never formed Co-access Edges, so two replays measured
them directly: the per-turn hook on LongMemEval-S, and repeated work on
Flask's and Hono's own histories. The first found a runaway clique, which
ADR-0035 bounded. The second found the bounded boost inert, and a tuned
replacement failed on the held-out repo. ADR-0037 removed the mechanism.
The same pass measured the write cost ADR-0036 fixed, and recall latency
across the builds.

**Addendum (2026-11-01, corpus re-run):** re-ran `compare.ts` against the
current code, the first run since ADR-0032 to ADR-0037. rAIminiscence's
Recall@5 fell from 90.0% to 80.0% and Precision@5 from 35.0% to 31.0%.
hippo-memory's numbers and both systems' invalidation results are
unchanged. A run against frozen builds attributes the whole drop to
ADR-0032's fused ranking; see "Honest caveats".

**Addendum (2026-11-01, extended re-run):** re-ran `extended-compare.ts`
against the current code. At 1,500 Memories, rAIminiscence's shim
subprocess latency fell from 767.6 ms to 697.7 ms, and its in-process
latency from 30.2 ms to 21.2 ms. Consolidation took 18.9 s instead of
23.5 s, and the contention it adds to the next `recall` fell from
1,006.8 ms to 743.3 ms. hippo-memory's subprocess latency also fell, from
156.7 ms to 79.9 ms. This run used hippo-memory 1.45.0, installed on
2026-10-24, after the earlier run, so its version may differ too. Machine
load and that upgrade could each account for part of every drop. The gap between the two
subprocess latencies widened, from about 4.9 times to about 8.7 times.
The Shared Memory overhead at 10 Memories came out at -57.0 ms, which is
noise. The outcome-feedback results are unchanged.

**Addendum (2026-11-02, warm model):** `extended-compare.ts` now times
the shim a second way, with the real MCP server running in the same
project. Per
[ADR-0038](../docs/adr/0038-a-running-server-keeps-the-embedded-model-warm-for-short-lived-callers.md),
that server keeps the Embedded model loaded and serves the prompt's
vector, so the hook skips its own model load. Both ways run on the same
store, under a fresh temp home.

The same day fixed a provider mismatch in that pass, described under
"Selecting rAIminiscence's provider" above. Its stores were seeded with
Ollama while the shim embeds with the Embedded Provider, so the shim had
been ranking by its lexical fallback alone. A check at 300 Memories
confirmed it: the shim's output on an Ollama-seeded store matched
in-process recall's lexical fallback exactly. On an Embedded-seeded store
it matched in-process embedding recall instead. The shim's stores are now
seeded with the Embedded Provider.

With both changes, at 1,500 Memories the shim took 778.0 ms with no
server and 261.2 ms with one. At 10 Memories it took 695.8 ms and
151.8 ms. hippo-memory took 91.9 ms and 83.3 ms. Output was the same
size both ways at every store size. The server-running time grows with
store size while the in-process time stays near 20 ms, so the growth is
likely the shim loading the store from disk on each call.

Paths this change does not touch moved too, which shows this machine's
run-to-run noise. Consolidation at 1,500 Memories took 30.4 s, against
18.9 s on 2026-11-01. The Shared Memory overhead came out at -18.7 ms at
10 Memories and -1,015.0 ms at 1,500. A negative overhead is noise, so
that measurement does not resolve a cost of this size on this machine.

**Addendum (2026-11-02, hippo-memory 3.1.1):** upgraded
`hippo-memory-runner/` from hippo-memory 1.45.0 to 3.1.1, the latest
release, and re-ran `compare.ts` and `extended-compare.ts`. Every CLI
command and library export the runners use still behaves the same. On
the corpus, hippo-memory's Recall@5 rose from 77.5% to 82.5% and its
Precision@5 from 31.8% to 32.0%, ahead of rAIminiscence's unchanged
80.0% and 31.0%. Its invalidation result is unchanged at 5 of 9, against
rAIminiscence's 8 of 9. Its per-turn hook got slower: 140 to 190 ms
across store sizes, against 79 to 92 ms for 1.45.0. With the MCP server
running, rAIminiscence's hook took 139 to 163 ms up to 300 Memories and
226 to 270 ms at 750 and 1,500; with no server, 670 to 983 ms.
hippo-memory's positive-feedback curve is unchanged. Its negative one is
much steeper: one negative event leaves a Strength of 0.198 at 30 days,
against 0.397 under 1.45.0, and 200 leave 0.031, against 0.252.
rAIminiscence's falls less after one event, to 0.642, and far more
after ten, to 0.00002.

**Addendum (2026-11-06, warm process):** re-ran `extended-compare.ts`
after
[ADR-0040](../docs/adr/0040-the-hook-starts-a-warm-process-when-no-server-runs.md).
The no-server shim pass now runs with `RAIMINISCENCE_WARM_EMBED=off`, so
it still times a true cold call; with the switch on, only a session's
first prompt pays that cost. The no-server shim took 578.6 to 738.5 ms.
With the server running it took 54.5 to 83.9 ms, against 139 to 270 ms
in the previous run; the 83.9 ms at 150 Memories is the only value above
76.5 ms. hippo-memory took 115.2 to 125.2 ms. Output was the same size
with and without the server at every store size. Consolidation took
19.7 s at 1,500 Memories, and the contention it adds to the next
`recall` was 691.8 ms. The Shared Memory overhead came out at -27.6 ms
at 10 Memories, which is noise, and 1,656.8 ms at 1,500. All 11,261
Ollama embed calls returned 200. A first attempt ran with Ollama down
and still exited 0; its numbers were discarded.

**Addendum (2026-11-07, write cost):** new `write-latency-interleaved.ts`
times one `remember` through each system's running MCP server. Before
[ADR-0041](../docs/adr/0041-the-mcp-server-answers-remember-before-the-embed.md),
rAIminiscence took 33 to 35 ms against hippo-memory's 3 to 5 ms: it
embedded before it answered, and read the writer identity with two
`git config` calls. After it, the server answers once the Memory is on
disk and writes the vector after, as hippo-memory does: 3.7 to 5.0 ms
against 4.7 to 5.2 ms, rAIminiscence's median at or below hippo-memory's
at every store size. Every write had its vector once the server exited.
The run before the change timed each pair's two calls back to back; the
run after it pauses after every call, so neither system's background
embed lands on the other's timed call.

**Addendum (2026-11-07, hippo-memory 3.3.3):** upgraded
`hippo-memory-runner/` from 3.1.1 to 3.3.3, the latest release, and
re-ran `compare.ts`, `extended-compare.ts`,
`hook-latency-interleaved.ts` and `write-latency-interleaved.ts`. The
3.2 and 3.3 releases change capture, rules and migration, not recall.
The corpus matches that: hippo-memory scored 82.5% Recall@5 and 32.0%
Precision@5 again, and 5 of 9 on invalidation, against rAIminiscence's
80.0%, 31.0% and 8 of 9. Its feedback curves are unchanged. Interleaved
call by call, rAIminiscence's served hook took 105.6 to 125.8 ms against
hippo-memory's 239.0 to 240.5 ms, faster in all 126 pairs
([`results/2026-11-07-hook-latency-interleaved.md`](results/2026-11-07-hook-latency-interleaved.md)).
Through each MCP server, a write took 2.2 to 2.7 ms against 2.7 to
3.1 ms, every interval below zero
([`results/2026-11-07-write-latency-interleaved-hippo-3.3.3.md`](results/2026-11-07-write-latency-interleaved-hippo-3.3.3.md)),
and every write had its vector once the server exited. Both hooks took
about twice their 2026-11-03 times, with a load average of 9 to 13
against 3, so the absolute times reflect this machine's load; the ratio
held. The same load likely explains Consolidation's 56.6 s at 1,500
Memories, against 19.7 s on 2026-11-06, and its 1,215.8 ms of
contention, against 691.8 ms: nothing changed on that path for a store
whose Memories all have vectors. All 11,358 Ollama embed calls returned
200. LongMemEval-S and LoCoMo were not re-run in full: on a sample, 50
LongMemEval-S questions and 304 LoCoMo QAs, 3.3.3 retrieves what 3.1.1
did, within the run-to-run drift of 3.1.1 against itself, and evidence
recall is the same to four decimals
([`results/2026-11-07-hippo-3.3.3-retrieval-sample.md`](results/2026-11-07-hippo-3.3.3-retrieval-sample.md)).
So the 2026-11-02 results stand for 3.3.3.

**Addendum (2026-11-11, hippo-memory 3.5.1):** upgraded
`hippo-memory-runner/` to 3.5.1, the latest release, and ran the full
benchmark gate (`benchmark-gate.ts`): `compare.ts`,
`extended-compare.ts` and `hook-latency-interleaved.ts` from a frozen
copy, then LongMemEval-S and LoCoMo in full through hippo-memory's own
harnesses at its `v3.5.1` tag. `write-latency-interleaved.ts` ran
separately. The load average stayed at 1 to 7, against 9 to 13 on
2026-11-07, and all 11,359 Ollama embed calls returned 200. 3.4.0 and
3.5.x refactor how recall decides a memory is superseded and add an
opt-in tag filter to the hook block; neither ships per-turn indexing.
The corpus matches: 82.5% Recall@5 and 32.0% Precision@5 again, and 5
of 9 on invalidation, against rAIminiscence's 80.0%, 31.0% and 8 of 9;
the feedback curves are unchanged. Interleaved call by call,
rAIminiscence's served hook took 52.9 to 57.5 ms against hippo-memory's
126.2 to 128.1 ms, faster in all 126 pairs
([`results/2026-11-10-hook-latency-interleaved.md`](results/2026-11-10-hook-latency-interleaved.md)).
Through each MCP server, a write took 5.3 to 5.8 ms against 6.5 to
6.9 ms, every interval below zero, and every write had its vector once
the server exited
([`results/2026-11-11-write-latency-interleaved-hippo-3.5.1.md`](results/2026-11-11-write-latency-interleaved-hippo-3.5.1.md)).
Both systems' writes took about twice their 2026-11-07 times at a lower
load; the cause is not known. Consolidation took 19.9 s at 1,500
Memories with 551.8 ms of contention, back to its 2026-11-06 level,
which supports reading 2026-11-07's 56.6 s as load. On LongMemEval-S,
rAIminiscence's Embedded run on the current build returns the same top
10, in the same order, as the published ED run on all 500 questions;
hippo-memory 3.5.1 reorders 7 questions on arm A and 8 on arm B against
3.1.1, and arm B scores the same on every metric. The gate fails one
check of 28: any-evidence R@1 against arm B, 86.4 against 87.6,
-1.2 [-3.6, +1.2], below its -3 point floor. Every other retrieval
check and the hook pass at every store size
([`results/2026-11-11-benchmark-gate.md`](results/2026-11-11-benchmark-gate.md)).
The dashboard's headline latency tile now shows the hook with a server
running, the usual case during a session: 68 ms against 120 ms at 1,500
Memories. It showed the no-server shim before, 694 ms here, which stays
in its latency table.

**Addendum (2026-11-12, nomic's task prefixes):** re-ran the full
benchmark gate against hippo-memory 3.5.1 with
[ADR-0042](../docs/adr/0042-nomic-embeddings-carry-their-task-prefixes.md)
built: queries embed with `search_query: ` and Memories with
`search_document: `, as the model card requires, and prefixed vectors
cluster at 0.87. hippo-memory's LongMemEval-S and LoCoMo outputs are
reused from 2026-11-11, unchanged. The gate passes all 28 checks
([`results/2026-11-12-benchmark-gate.md`](results/2026-11-12-benchmark-gate.md)).
The check that failed, any-evidence R@1 against arm B, goes from 86.4 to
87.6, level with arm B at +0.0 [-2.4, +2.4]. All-evidence R@5 rises from
84.9 to 86.2, and LoCoMo evidence R@1 from 33.9 to 36.5. Any-evidence
R@10 falls from 98.8 to 98.6, one question. On the corpus, Recall@5 rises
from 80.0% to 85.0% and Precision@5 from 31.0% to 33.0%, ahead of
hippo-memory's 82.5% and 32.0%; invalidation stays at 8 of 9. The served
hook took 53.0 to 58.7 ms against 126.8 to 127.8 ms, faster in all 126
pairs
([`results/2026-11-12-hook-latency-interleaved.md`](results/2026-11-12-hook-latency-interleaved.md)).
The extended suite moved within run-to-run noise. The Ollama arm and the
write suite were not re-run.
