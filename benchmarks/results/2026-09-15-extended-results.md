# rAIminiscence vs hippo-memory — Extended Benchmark Results (2026-09-15-extended)

Extends `2026-09-15-results.md` with the two measurements its scope deliberately excluded (see `benchmarks/README.md`), needed to resolve two "contingent on the benchmark" candidates from an internal hippo-memory comparison (§3.1 outcome-feedback formula bound, §3.8 per-turn latency/token budget). Does not modify or supersede the original results file — that Recall@k/invalidation pass stands as-is.

## 1. Per-turn auto-recall latency & injected content size

Three rAIminiscence measurements are reported, because they answer different questions and mixing them would overstate or understate the real per-turn cost:

- **In-process** — calls `promptRecallText` (the exact v10 `UserPromptSubmit` hook function) directly in the same Node process as this benchmark script. Isolates the pure recall-computation cost, excluding any process-startup overhead.
- **Shim subprocess** — invokes the real, built `raiminiscence-hooks-shim` binary as an actual child process via stdin/stdout JSON, exactly the shape Claude Code/Codex use in real usage. Its store is seeded with the Embedded Provider, the shim's own default, so the vectors it stores match the vector it embeds the prompt with; seeded with Ollama, as before 2026-11-02, every stored vector mismatched and the shim ranked by its lexical fallback alone. This is the fair, apples-to-apples comparison against hippo-memory's number below, which is *also* a real CLI subprocess invocation — comparing hippo-memory's subprocess number against rAIminiscence's in-process number would have silently favored rAIminiscence by excluding Node's own startup cost from one side only.
- **Shim subprocess, server running** — the same shim call on the same store, with the real, built MCP server running in the same project. The server answers the shim's whole recall over a local socket (ADR-0039), with its model loaded and its recall cache parsed once, so the shim skips the model load (ADR-0038), the engine import and the cache parse. This is the usual case during a session, since the agent's MCP server runs alongside the hook. The plain shim column is the case with no server. Both run under a fresh temp home, so neither reaches a developer's own running server.

hippo-memory: its real, source-confirmed per-turn hook command, `hippo context --pinned-only --include-recent 5 --format additional-context` — structurally bounded to pinned memories + the last 5 writes regardless of store size, confirmed from `dist/hooks.js`, not assumed. Median of 5 reps per store size, one untimed warm-up call first on every measurement (steady-state cost, not process cold-start; the Ollama/embedding server itself was already warm from the original 2026-09-15 pass in this session). Both systems write an identical synthetic corpus (`benchmarks/corpus/synthetic-memories.ts`) at each size, in isolated temp storage.

| Store size | rAIminiscence in-process | rAIminiscence shim subprocess | rAIminiscence shim subprocess, server running | hippo-memory CLI subprocess | rAIminiscence output chars (~tokens) | hippo-memory output chars (~tokens) |
|---|---|---|---|---|---|---|
| 10 | 15.0ms | 526.8ms | 61.2ms | 120.2ms | 1478 (~370) | 1459 (~365) |
| 50 | 12.8ms | 526.1ms | 56.2ms | 123.4ms | 1485 (~371) | 1468 (~367) |
| 150 | 15.9ms | 532.3ms | 55.3ms | 125.0ms | 1499 (~375) | 1497 (~374) |
| 300 | 15.3ms | 539.2ms | 58.4ms | 124.8ms | 1496 (~374) | 1513 (~378) |
| 750 | 18.6ms | 573.1ms | 58.9ms | 123.6ms | 1478 (~370) | 1497 (~374) |
| 1500 | 23.6ms | 652.0ms | 64.4ms | 120.1ms | 1484 (~371) | 1523 (~381) |

**~tokens** is chars/4, a rough documented estimate (not a real tokenizer count) — sufficient to compare relative growth, not to state an exact token cost.

**Observed scaling, this run only, fair subprocess-to-subprocess comparison** (store size 10 → 1500): rAIminiscence shim latency 526.8ms → 652.0ms with no server and 61.2ms → 64.4ms with one running, output 1478 → 1484 chars. hippo-memory latency 120.2ms → 120.1ms, output 1459 → 1523 chars. rAIminiscence's *output size* stays essentially flat (it always returns its top-k `recall` results, not a store-size-proportional dump) while its *latency* grows with store size (full similarity search over every memory); hippo-memory's `--pinned-only --include-recent 5` is structurally bounded on both latency and output size, since it only ever looks at pinned memories plus the last 5 writes — a real, source-confirmed design difference, not a benchmark artifact. These are single-machine, single-run numbers on a small synthetic corpus (not averaged across repeated full runs) — read as a directional signal, not a precise production forecast.

## 2. Opportunistic consolidation: raw cost and contention (v14 / ADR-0021)

Added when ADR-0021's interview widened this pass's scope beyond recall's own scan: `remember`/`recall` schedule a full Clustering/Promotion/Promotion Audit/Commit Invalidation/Pruning/Invalidation pass via `setImmediate` on the *same* event loop as the MCP server (see `opportunistic-consolidation.ts`) — a cost the recall-latency numbers above never isolated, since the per-turn hook explicitly opts out of it (`triggerConsolidation: false`). Three measurements, each answering a different question:

- **Duration** — `consolidate()`'s own wall-clock cost, one fresh store per size (a second pass on the same store would mostly find nothing left to promote/prune, understating the real first-pass cost).
- **Contention** — the actual user-facing symptom: how much slower the *next* `recall()` is when it runs right after a `remember()` that scheduled a pending consolidation (production's real default), versus the same next call with no pending pass at all.
- **Shared Memory overhead** — isolates `flushSharedMemory`'s git cost (`add -A`, `commit`, a push attempt against no configured remote) from consolidate's own local compute cost measured above. Run at fewer store sizes (real `git` subprocesses per size make this the most expensive of the three).

### Duration (one fresh store per size, single pass)

| Store size | consolidate() duration |
|---|---|
| 10 | 369.6ms |
| 300 | 4116.7ms |
| 1500 | 20809.2ms |

### Contention (next recall(), with vs. without a pending consolidation)

| Store size | Next recall(), baseline | Next recall(), pending consolidation | Contention overhead |
|---|---|---|---|
| 10 | 12.1ms | 27.6ms | 15.5ms |
| 300 | 15.6ms | 142.0ms | 126.4ms |
| 1500 | 21.8ms | 604.7ms | 582.9ms |

### Shared Memory overhead (consolidate() with vs. without Shared Memory enabled)

| Store size | Without Shared Memory | With Shared Memory | Overhead |
|---|---|---|---|
| 10 | 149.9ms | 191.4ms | 41.5ms |
| 1500 | 22037.3ms | 23176.0ms | 1138.7ms |

**Reading this:** contention overhead at the largest measured store (1500 memories) was 582.9ms — real, but this pass does not yet say whether it warrants its own fix (e.g. moving consolidation off the event loop, or debouncing it the way the Checkpoint nudge already is); per ADR-0021, that decision is deferred to a follow-up pass with these numbers as its starting evidence, while the confirmed, measured recall-latency fix (below) lands in this same pass.

## 3. Outcome-feedback formula stress test

Both sides use their real, unmodified strength/decay function (rAIminiscence's `computeStrength`, hippo-memory's `calculateStrength`+`applyOutcome`), same base half-life (30 days), same feedback counts, assessed at 30/90/180/365/730 days since the memory's anchor. Isolates the reward/feedback term specifically — no recall-count bonus, no error tag, no emotional-valence multiplier on either side (confirmed neutral-by-construction from each system's own source).

### Positive feedback — Strength (0..1) by days since anchor

| Feedback count | rAIminiscence @30d | rAIminiscence @90d | rAIminiscence @180d | rAIminiscence @365d | rAIminiscence @730d | hippo-memory @30d | hippo-memory @90d | hippo-memory @180d | hippo-memory @365d | hippo-memory @730d |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.691 | 0.173 | 0.022 | 0.000 | 0.000 | 0.500 | 0.125 | 0.016 | 0.000 | 0.000 |
| 1 | 0.773 | 0.294 | 0.069 | 0.004 | 0.000 | 0.574 | 0.189 | 0.036 | 0.001 | 0.000 |
| 5 | 0.874 | 0.529 | 0.249 | 0.053 | 0.002 | 0.613 | 0.230 | 0.053 | 0.003 | 0.000 |
| 10 | 0.906 | 0.625 | 0.359 | 0.114 | 0.012 | 0.621 | 0.239 | 0.057 | 0.003 | 0.000 |
| 20 | 0.923 | 0.683 | 0.435 | 0.172 | 0.027 | 0.625 | 0.244 | 0.060 | 0.003 | 0.000 |
| 50 | 0.929 | 0.703 | 0.463 | 0.197 | 0.036 | 0.628 | 0.248 | 0.061 | 0.003 | 0.000 |
| 100 | 0.929 | 0.704 | 0.464 | 0.198 | 0.037 | 0.629 | 0.249 | 0.062 | 0.004 | 0.000 |
| 200 | 0.929 | 0.704 | 0.464 | 0.198 | 0.037 | 0.629 | 0.249 | 0.062 | 0.004 | 0.000 |

### Negative feedback — Strength (0..1) by days since anchor

| Feedback count | rAIminiscence @30d | rAIminiscence @90d | rAIminiscence @180d | rAIminiscence @365d | rAIminiscence @730d | hippo-memory @30d | hippo-memory @90d | hippo-memory @180d | hippo-memory @365d | hippo-memory @730d |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.691 | 0.173 | 0.022 | 0.000 | 0.000 | 0.500 | 0.125 | 0.016 | 0.000 | 0.000 |
| 1 | 0.642 | 0.122 | 0.010 | 0.000 | 0.000 | 0.198 | 0.031 | 0.002 | 0.000 | 0.000 |
| 5 | 0.109 | 0.000 | 0.000 | 0.000 | 0.000 | 0.038 | 0.004 | 0.000 | 0.000 | 0.000 |
| 10 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.035 | 0.003 | 0.000 | 0.000 | 0.000 |
| 20 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.033 | 0.002 | 0.000 | 0.000 | 0.000 |
| 50 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.032 | 0.002 | 0.000 | 0.000 | 0.000 |
| 100 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.032 | 0.002 | 0.000 | 0.000 | 0.000 |
| 200 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.031 | 0.002 | 0.000 | 0.000 | 0.000 |

**Headline comparison (730 days since anchor, 50 positive feedback events):** rAIminiscence Strength goes from 0.000 (0 feedback) to 0.036 (50 feedback) — a delta of 0.036. hippo-memory goes from 0.000 to 0.000 — a delta of 0.000. hippo-memory's multiplicative reward factor is mathematically bounded to (0.5x, 1.5x) of base half-life regardless of feedback count (asymptotic as counts grow, per its own `(pos-neg)/(pos+neg+1)` ratio); rAIminiscence's own positive term is bounded too as of v12's Reinforcement Ceiling (`decay.ts`) — the combined Spaced Repetition + Outcome Feedback bonus now saturates asymptotically toward 4x base half-life via a smooth `1 - 0.5^(bonusDays / 30)` curve, rather than growing without limit — high feedback counts still push Strength further out than hippo-memory's tighter (0.5x, 1.5x) band, but no longer indefinitely. The negative term is unaffected by v12: each further negative event still subtracts a flat 5 days until the 1-day floor.

**Saturation check at the top of this pass's range** (730 days, 50 → 200 feedback events, the two largest counts now measured): rAIminiscence Strength moves 0.036 → 0.037 — a further delta of only 0.000, versus 0.036 for the first 50 events — directly demonstrating the Reinforcement Ceiling asymptote holding at higher counts than the original pass measured, not just a smaller range where a cap coincidentally looked flat. hippo-memory moves 0.000 → 0.000, already essentially flat by 50 events under its own tighter bound.

## Raw data

Full per-size/per-count JSON: `benchmarks/results/2026-09-15-extended-results.json`

