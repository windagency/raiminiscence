# rAIminiscence vs hippo-memory: the comparison report

[Back to README.md](../README.md) • [Back to packages/raiminiscence-mcp/README.md](../packages/raiminiscence-mcp/README.md)

This report reads the benchmark results in plain language. It covers the run of 2026-11-12, against hippo-memory 3.5.1, the latest release. Method, raw files and history are in [`README.md`](README.md) in this directory. The pass or fail record is [`results/2026-11-12-benchmark-gate.md`](results/2026-11-12-benchmark-gate.md).

## The short answer

rAIminiscence is at least as good as hippo-memory on every measured check. It is clearly better on some. It is never clearly worse.

- **Finding the right memory:** level or ahead on all three retrieval benchmarks.
- **Forgetting outdated facts:** 8 of 9 scenarios, against 5 of 9.
- **Speed of the per-turn hook:** about 55 ms, against about 127 ms.
- **Speed of a write:** about 5.5 ms, against about 6.7 ms.
- **Where hippo-memory wins:** cheaper bulk writes, and preference questions on LongMemEval.

The project's bar is called the benchmark gate. It has 28 checks. All 28 pass.

## Scorecard

| Area | What it asks | rAIminiscence | hippo-memory | Result |
| --- | --- | --- | --- | --- |
| Coding corpus | Is a relevant memory in the top 5? | **85.0%** | 82.5% | Ahead, small sample |
| Invalidation | Are outdated memories retired, and only those? | **8 of 9** | 5 of 9 | Ahead |
| LongMemEval-S | Is a right session ranked first? | 87.6% | 87.6% | Level |
| LongMemEval-S | Are all right sessions in the top 5? | **86.2%** | 83.2% | Ahead, outside noise |
| LoCoMo | Share of right turns in the top 5 | **60.5%** | 56.5% | Ahead, outside noise |
| Per-turn hook | Time to inject memories, 1,500 stored | **58.7 ms** | 127.1 ms | About 2x faster |
| Write | Time for one `remember` call | **5.8 ms** | 6.6 ms | Faster |

On the public benchmarks, hippo-memory is arm B, with its MiniLM embeddings. The other lines have one hippo-memory setup.

## How to read the numbers

- **Recall@k.** Ask a question. Take the top k results. Did the right answer come back? R@1 means first place. R@5 means anywhere in the top 5.
- **Any-evidence or all-evidence.** Some questions need several sessions. "Any" counts a hit when one is found. "All" needs every one of them. "All" is stricter, and hippo-memory's own benchmark page leads with it.
- **Difference and interval.** Each difference is rAIminiscence minus hippo-memory, in points. The bracket is a 95% interval from 10,000 resamples. If it spans zero, the gap could be noise.
- **The gate's floor.** A check passes when the interval's low end stays at or above -3 points. In words: rAIminiscence is not plausibly more than 3 points behind.
- **The two hippo-memory arms.** Arm A ranks by keywords alone, BM25. Arm B adds MiniLM embeddings. Both are compared, and B is usually the stronger.
- **rAIminiscence's setup.** Its default Embedded provider, `nomic-embed-text-v1` on ONNX, with nomic's task prefixes ([ADR-0042](../docs/adr/0042-nomic-embeddings-carry-their-task-prefixes.md)). Nothing extra to install.

## 1. The coding corpus

**What it is.** 57 hand-written memories in the style a coding agent keeps. 20 questions, each with its correct memories labelled by hand. Both systems load the same memories and answer the same questions.

| | rAIminiscence | hippo-memory |
| --- | --- | --- |
| Recall@5 | **85.0%** | 82.5% |
| Precision@5 | **33.0%** | 32.0% |

The gap is one question. On "How are background jobs processed?" rAIminiscence finds both memories and hippo-memory finds one. The other 19 questions score the same. With 20 questions, read this as level to slightly ahead.

Per query: [`results/2026-09-15-results.md`](results/2026-09-15-results.md). The file keeps its original name; its contents are the 2026-11-12 run.

## 2. Invalidation

**What it is.** A commit says "migrate from webpack to vite". Memories about webpack are now stale and should be retired. Bystander memories that only mention a similar word must survive. Nine scenarios test this.

| Scenario | rAIminiscence | hippo-memory |
| --- | --- | --- |
| webpack-to-vite | Pass | Fail, misses a stale memory |
| jest-to-vitest | Pass | Pass |
| deprecate-legacyauth | Pass | Pass |
| remove-moment | Fail, retires a bystander | Fail, retires a bystander |
| redux-to-zustand | Pass | Pass |
| class-components-to-hooks | Pass | Fail, retires a bystander |
| node-18-to-22 | Pass | Fail, retires a bystander |
| drop-react-admin | Pass | Pass |
| webpack-config-file-changed | Pass | Pass |
| **Total** | **8 of 9** | 5 of 9 |

`remove-moment` is a deliberate trap. "moment" is also an ordinary English word. Neither system avoids it.

hippo-memory has no notion of a file a memory is anchored to. Its file-based scenario is driven through its one invalidation command instead.

## 3. LongMemEval-S

**What it is.** A published research dataset, ICLR 2025. 500 questions about long chat histories, each with about 50 past sessions to search. Both systems run through hippo-memory's own harness and scorer, unchanged. Both rank the whole history.

| Metric | rAIminiscence | hippo-memory B | Difference [95% CI] | hippo-memory A |
| --- | --- | --- | --- | --- |
| Any-evidence R@1 | 87.6 | 87.6 | +0.0 [-2.4, +2.4] | 85.4 |
| Any-evidence R@3 | 95.8 | 95.2 | +0.6 [-1.0, +2.2] | 94.6 |
| Any-evidence R@5 | 97.0 | 97.4 | -0.4 [-1.6, +0.6] | 96.8 |
| Any-evidence R@10 | 98.6 | 99.2 | -0.6 [-1.4, +0.0] | 98.0 |
| answer_in_content@5 | 50.8 | 50.4 | +0.4 [-0.6, +1.4] | 49.8 |
| All-evidence R@1 | 30.4 | 30.6 | -0.2 [-1.9, +1.5] | 30.4 |
| All-evidence R@5 | **86.2** | 83.2 | **+3.0 [+0.9, +5.3]** | 83.6 |
| All-evidence R@10 | **92.6** | 90.6 | **+1.9 [+0.2, +3.8]** | 90.2 |

**In plain words.** Finding one right session is a tie. Finding every right session is where rAIminiscence pulls ahead, by 2 to 3 points, outside noise. That is the measure hippo-memory's own benchmark page leads with. Against arm A, rAIminiscence is ahead or level on every line.

**By question type,** any-evidence R@1 / R@5:

| Type | Questions | rAIminiscence | hippo-memory B | hippo-memory A |
| --- | --- | --- | --- | --- |
| knowledge-update | 78 | 94.9 / 100.0 | 96.2 / 100.0 | 93.6 / 100.0 |
| multi-session | 133 | **90.2** / **97.7** | 89.5 / 97.0 | 85.0 / 96.2 |
| single-session-assistant | 56 | 100.0 / 100.0 | 100.0 / 100.0 | 100.0 / 100.0 |
| single-session-preference | 30 | 50.0 / 76.7 | **60.0** / **86.7** | 40.0 / 86.7 |
| single-session-user | 70 | **90.0** / 98.6 | 87.1 / 98.6 | 90.0 / 98.6 |
| temporal-reasoning | 133 | **82.7** / 97.0 | 82.0 / 97.0 | 82.7 / 95.5 |

Preference questions are hippo-memory's clearest win: 3 questions of 30 at R@1 and R@5. They ask about a taste stated in passing, such as a favourite cuisine. The other types are level or lean rAIminiscence. Each cell holds 30 to 133 questions, so a few points either way is noise.

**What changed on 2026-11-12.** Before nomic's task prefixes, rAIminiscence scored 86.4 at R@1. That trailed arm B by 1.2 points, and the interval's low end sat at -3.6. It was the gate's only failing check. With the prefixes it reaches 87.6, level. The cost was one question at R@10, 98.8 to 98.6.

## 4. LoCoMo

**What it is.** A second published dataset. 10 long conversations, 5,882 turns, 1,982 questions. Scored by hippo-memory's deterministic evidence protocol, with no language-model judge. The score is the share of a question's correct turns found in the top k.

| Metric | rAIminiscence | hippo-memory B | Difference [95% CI] | hippo-memory A |
| --- | --- | --- | --- | --- |
| R@1 | **36.5** | 33.4 | **+3.0 [+1.9, +4.1]** | 31.5 |
| R@3 | **53.4** | 49.5 | **+3.9 [+2.7, +5.1]** | 46.9 |
| R@5 | **60.5** | 56.5 | **+3.9 [+2.9, +5.0]** | 52.6 |

Ahead at every k, outside noise, against both arms.

**By category,** R@1 / R@5:

| Category | Questions | rAIminiscence | hippo-memory B | hippo-memory A |
| --- | --- | --- | --- | --- |
| open-domain | 841 | **43.5** / **69.8** | 40.7 / 65.5 | 38.3 / 61.0 |
| adversarial | 446 | **37.2** / **63.3** | 33.0 / 61.5 | 34.4 / 58.2 |
| multi-hop | 321 | **46.9** / **70.2** | 43.2 / 63.6 | 37.2 / 60.5 |
| single-hop | 282 | **9.6** / **28.2** | 8.6 / 23.8 | 7.1 / 19.5 |
| temporal-reasoning | 92 | **13.8** / 26.2 | 11.8 / 25.9 | 10.1 / 22.6 |

rAIminiscence leads in every category. The largest gap is multi-hop at R@5, 6.6 points. Single-hop and temporal questions are hard for both: under 30% at R@5.

## 5. Speed

### The per-turn hook

**What it is.** Before each prompt, the agent's client calls a hook that injects relevant memories. It runs on every turn, so its cost is felt constantly. Both hooks run as real subprocesses. rAIminiscence's MCP server is running, as it is during a session. Calls alternate between the systems, 21 pairs per size.

| Memories stored | rAIminiscence | hippo-memory |
| --- | --- | --- |
| 10 | **53.4 ms** | 127.8 ms |
| 50 | **53.0 ms** | 127.7 ms |
| 150 | **54.0 ms** | 126.8 ms |
| 300 | **54.7 ms** | 127.1 ms |
| 750 | **55.9 ms** | 126.9 ms |
| 1,500 | **58.7 ms** | 127.1 ms |

rAIminiscence is faster in all 126 pairs. Its time grows slowly with the store, because it searches every memory. hippo-memory's stays flat, because its hook reads only pinned memories and the last 5 writes.

With no server running, rAIminiscence's hook must load its model first. It then takes about 530 to 650 ms. That case is rare during a session.

Both inject about 1,500 characters, roughly 370 tokens, per turn.

Sources: [`results/2026-11-12-hook-latency-interleaved.md`](results/2026-11-12-hook-latency-interleaved.md), [`results/2026-09-15-extended-results.md`](results/2026-09-15-extended-results.md).

### A single write

One `remember` call through each running MCP server, 21 alternating pairs per size, measured 2026-11-11.

| Memories stored | rAIminiscence | hippo-memory | Difference [95% CI] |
| --- | --- | --- | --- |
| 10 | **5.3 ms** | 6.8 ms | -1.4 ms [-2.0, -1.1] |
| 300 | **5.5 ms** | 6.8 ms | -1.1 ms [-1.7, -0.6] |
| 1,500 | **5.8 ms** | 6.6 ms | -1.3 ms [-1.8, -0.3] |

Both answer once the memory is on disk and embed it afterwards. Every write had its vector by the time the server exited.

Source: [`results/2026-11-11-write-latency-interleaved-hippo-3.5.1.md`](results/2026-11-11-write-latency-interleaved-hippo-3.5.1.md).

### Bulk writes

Building LongMemEval's 500 stores, one fresh process per session, is where hippo-memory wins. rAIminiscence embeds each whole session as it writes it. That took a median of 2.1 s per session, against hippo-memory's 0.13 s plus 8.4 s per store for its own embedding pass. These figures are from 2026-10-31.

## 6. Forgetting and feedback

Both systems weaken a memory over time unless it proves useful. This test applies the same positive feedback to both, using each system's real formula.

After 730 days, a memory with 50 positive signals keeps a strength of 0.036 in rAIminiscence and 0.000 in hippo-memory. hippo-memory's reward is a bounded multiplier, so old memories fade fully however useful they were. rAIminiscence's reward has a ceiling too, so feedback cannot keep a memory alive forever: 200 signals add almost nothing over 50.

Source: [`results/2026-09-15-extended-results.md`](results/2026-09-15-extended-results.md), section 3.

## Where hippo-memory is better

- **Bulk write cost.** Writing many memories in fresh processes is several times cheaper.
- **Preference questions.** 60.0% against 50.0% R@1 on LongMemEval's 30 preference questions.
- **Flat hook cost.** Its hook does not grow with the store. rAIminiscence's grows from 53 to 59 ms between 10 and 1,500 memories.
- **Scope.** hippo-memory is the larger, more mature project, with features outside this comparison.

## Limits of this comparison

- **One machine, one run each.** The intervals cover which questions were asked. They do not cover run-to-run timing noise.
- **The corpus is small.** 20 questions. One question moves Recall@5 by 2.5 points.
- **Not re-run with the prefixes:** the Ollama provider on LongMemEval-S, and the write suite. The write path does not embed before it answers, so its timings should hold.
- **Neither system consolidates during the public benchmarks.** Every memory is written at once, so time-based features play no part.
- **hippo-memory's published headline is not reproduced here.** Its benchmark page reports 86.8% to 88.5% all-evidence R@5. That comes from separate scripts that index every turn, not from `hippo recall`. Through `hippo recall`, on its own harness, it scores 83.2%.
- **rAIminiscence's ranking was tuned on LongMemEval-S.** The fused-ranking mix and the detail cap were chosen with these stores in view, as ADR-0032 and ADR-0033 state. LoCoMo was not used for tuning, and the lead holds there too.

## Re-running it

The full gate, from a clean checkout, is described in [`README.md`](README.md#how-to-reproduce). It writes a new dated `results/<date>-benchmark-gate.md`. The dashboard, [`dashboard.html`](dashboard.html), is rebuilt from the result files by `build-dashboard.ts`.
