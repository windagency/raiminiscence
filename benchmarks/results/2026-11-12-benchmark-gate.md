# Benchmark gate against hippo-memory 3.5.1 (2026-11-12)

**Passes.** Every check holds.

The gate, from `NEXT_STEPS.md`: on every reported metric of every public benchmark, the lower bound of the paired 95% interval for rAIminiscence minus hippo-memory stays at or above -3.0 points, and the per-turn hook's median stays at or below hippo-memory's at each store size. Intervals are percentile bootstraps over whole questions, 10,000 resamples, seed 1. rAIminiscence runs its default, Embedded provider, against each hippo-memory arm.

| Suite | Against | Metric | rAIminiscence | hippo-memory | Difference [95% CI] | Verdict |
|---|---|---|---|---|---|---|
| LongMemEval-S, whole haystack | hippo-memory A | any-evidence R@1 | 87.6 | 85.4 | +2.2 [-0.4, +4.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | any-evidence R@3 | 95.8 | 94.6 | +1.2 [-0.4, +3.0] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | any-evidence R@5 | 97.0 | 96.8 | +0.2 [-1.0, +1.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | any-evidence R@10 | 98.6 | 98.0 | +0.6 [+0.0, +1.4] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | answer_in_content@5 | 50.8 | 49.8 | +1.0 [-0.2, +2.2] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | all-evidence R@1 | 30.4 | 30.4 | +0.0 [-1.5, +1.5] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | all-evidence R@5 | 86.2 | 83.6 | +2.6 [+0.4, +4.9] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | all-evidence R@10 | 92.6 | 90.2 | +2.3 [+0.6, +4.0] | passes |
| LoCoMo, evidence | hippo-memory A | R@1 | 36.5 | 31.5 | +4.9 [+3.7, +6.2] | passes |
| LoCoMo, evidence | hippo-memory A | R@3 | 53.4 | 46.9 | +6.5 [+5.2, +7.8] | passes |
| LoCoMo, evidence | hippo-memory A | R@5 | 60.5 | 52.6 | +7.8 [+6.6, +9.1] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | any-evidence R@1 | 87.6 | 87.6 | +0.0 [-2.4, +2.4] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | any-evidence R@3 | 95.8 | 95.2 | +0.6 [-1.0, +2.2] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | any-evidence R@5 | 97.0 | 97.4 | -0.4 [-1.6, +0.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | any-evidence R@10 | 98.6 | 99.2 | -0.6 [-1.4, +0.0] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | answer_in_content@5 | 50.8 | 50.4 | +0.4 [-0.6, +1.4] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | all-evidence R@1 | 30.4 | 30.6 | -0.2 [-1.9, +1.5] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | all-evidence R@5 | 86.2 | 83.2 | +3.0 [+0.9, +5.3] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | all-evidence R@10 | 92.6 | 90.6 | +1.9 [+0.2, +3.8] | passes |
| LoCoMo, evidence | hippo-memory B | R@1 | 36.5 | 33.4 | +3.0 [+1.9, +4.1] | passes |
| LoCoMo, evidence | hippo-memory B | R@3 | 53.4 | 49.5 | +3.9 [+2.7, +5.1] | passes |
| LoCoMo, evidence | hippo-memory B | R@5 | 60.5 | 56.5 | +3.9 [+2.9, +5.0] | passes |

| Memories | rAIminiscence hook median | hippo-memory hook median | Verdict |
|---|---|---|---|
| 10 | 53.4 ms | 127.8 ms | passes |
| 50 | 53.0 ms | 127.7 ms | passes |
| 150 | 54.0 ms | 126.8 ms | passes |
| 300 | 54.7 ms | 127.1 ms | passes |
| 750 | 55.9 ms | 126.9 ms | passes |
| 1500 | 58.7 ms | 127.1 ms | passes |

Sources:

- `/Users/Shared/raim-bench/gate-351-prefix/lme/raiminiscence/E-lifted.jsonl`
- `/Users/Shared/raim-bench/gate-351-prefix/locomo/raiminiscence-rescored.json`
- `/Users/Shared/raim-bench/gate-351-prefix/lme/hippo/A-lifted.jsonl`
- `/Users/Shared/raim-bench/gate-351-prefix/locomo/hippoA-rescored.json`
- `/Users/Shared/raim-bench/gate-351-prefix/lme/hippo/B-lifted.jsonl`
- `/Users/Shared/raim-bench/gate-351-prefix/locomo/hippoB-rescored.json`
- `/Users/Shared/raim-bench/gate-351-prefix/frozen/benchmarks/results/2026-11-12-hook-latency-interleaved.json`
