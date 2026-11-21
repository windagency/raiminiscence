# Benchmark gate against hippo-memory 3.5.1 (2026-11-11)

**Fails.** 1 check fails: LongMemEval-S, whole haystack any-evidence R@1 against hippo-memory B.

The gate, from `NEXT_STEPS.md`: on every reported metric of every public benchmark, the lower bound of the paired 95% interval for rAIminiscence minus hippo-memory stays at or above -3.0 points, and the per-turn hook's median stays at or below hippo-memory's at each store size. Intervals are percentile bootstraps over whole questions, 10,000 resamples, seed 1. rAIminiscence runs its default, Embedded provider, against each hippo-memory arm.

| Suite | Against | Metric | rAIminiscence | hippo-memory | Difference [95% CI] | Verdict |
|---|---|---|---|---|---|---|
| LongMemEval-S, whole haystack | hippo-memory A | any-evidence R@1 | 86.4 | 85.4 | +1.0 [-1.6, +3.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | any-evidence R@3 | 95.0 | 94.6 | +0.4 [-1.4, +2.2] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | any-evidence R@5 | 97.0 | 96.8 | +0.2 [-1.0, +1.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | any-evidence R@10 | 98.8 | 98.0 | +0.8 [+0.2, +1.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | answer_in_content@5 | 50.4 | 49.8 | +0.6 [-0.4, +1.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | all-evidence R@1 | 29.4 | 30.4 | -1.1 [-2.6, +0.4] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | all-evidence R@5 | 84.9 | 83.6 | +1.3 [-0.6, +3.2] | passes |
| LongMemEval-S, whole haystack | hippo-memory A | all-evidence R@10 | 91.5 | 90.2 | +1.3 [-0.4, +3.2] | passes |
| LoCoMo, evidence | hippo-memory A | R@1 | 33.9 | 31.5 | +2.4 [+1.1, +3.7] | passes |
| LoCoMo, evidence | hippo-memory A | R@3 | 52.2 | 46.9 | +5.3 [+4.0, +6.6] | passes |
| LoCoMo, evidence | hippo-memory A | R@5 | 59.1 | 52.6 | +6.5 [+5.3, +7.8] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | any-evidence R@1 | 86.4 | 87.6 | -1.2 [-3.6, +1.2] | fails |
| LongMemEval-S, whole haystack | hippo-memory B | any-evidence R@3 | 95.0 | 95.2 | -0.2 [-1.8, +1.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | any-evidence R@5 | 97.0 | 97.4 | -0.4 [-1.4, +0.6] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | any-evidence R@10 | 98.8 | 99.2 | -0.4 [-1.2, +0.4] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | answer_in_content@5 | 50.4 | 50.4 | +0.0 [-0.8, +0.8] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | all-evidence R@1 | 29.4 | 30.6 | -1.3 [-3.0, +0.4] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | all-evidence R@5 | 84.9 | 83.2 | +1.7 [-0.4, +3.8] | passes |
| LongMemEval-S, whole haystack | hippo-memory B | all-evidence R@10 | 91.5 | 90.6 | +0.9 [-1.1, +2.8] | passes |
| LoCoMo, evidence | hippo-memory B | R@1 | 33.9 | 33.4 | +0.5 [-0.6, +1.5] | passes |
| LoCoMo, evidence | hippo-memory B | R@3 | 52.2 | 49.5 | +2.8 [+1.5, +4.0] | passes |
| LoCoMo, evidence | hippo-memory B | R@5 | 59.1 | 56.5 | +2.6 [+1.5, +3.7] | passes |

| Memories | rAIminiscence hook median | hippo-memory hook median | Verdict |
|---|---|---|---|
| 10 | 52.9 ms | 127.8 ms | passes |
| 50 | 53.0 ms | 128.1 ms | passes |
| 150 | 53.0 ms | 126.8 ms | passes |
| 300 | 54.0 ms | 127.3 ms | passes |
| 750 | 55.1 ms | 126.6 ms | passes |
| 1500 | 57.5 ms | 126.2 ms | passes |

Sources:

- `/Users/Shared/raim-bench/gate-351/lme/raiminiscence/E-lifted.jsonl`
- `/Users/Shared/raim-bench/gate-351/locomo/raiminiscence-rescored.json`
- `/Users/Shared/raim-bench/gate-351/lme/hippo/A-lifted.jsonl`
- `/Users/Shared/raim-bench/gate-351/locomo/hippoA-rescored.json`
- `/Users/Shared/raim-bench/gate-351/lme/hippo/B-lifted.jsonl`
- `/Users/Shared/raim-bench/gate-351/locomo/hippoB-rescored.json`
- `/Users/Shared/raim-bench/gate-351/frozen/benchmarks/results/2026-11-10-hook-latency-interleaved.json`
