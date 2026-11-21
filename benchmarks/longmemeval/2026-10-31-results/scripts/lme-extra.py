"""Scores LongMemEval-S retrieval runs on what evaluate_retrieval.py does not.

usage: python3 -I lme-extra.py <freshness|budget> NAME=run.jsonl [NAME=run.jsonl ...]

freshness: the 78 knowledge-update questions each have exactly two evidence
  sessions, an older value and its update. Any-evidence recall saturates on
  them, so instead: how often the update ranks above the stale value (a
  session missing from the results ranks last), how often the update is
  ranked first, and how often the stale value is. Run on lifted runs, which
  rank the whole haystack.
budget: filling a token budget from each run's ranking the way hippo's
  own budget does (top result always, then whatever still fits), at budgets of 500, 1000, 2000 and 4000 tokens: any-evidence
  recall, and whether the answer is in the content returned, by
  evaluate_retrieval.py's own check_answer_in_content. 8000, 16000 and 32000 were
  added on 2026-10-31, after the other results were seen. The harness keeps only
  each ranking's top 10 rows, so a budget those 10 rows fit under is capped at 10
  results; "capped at 10 rows" counts those questions.
Both print paired-bootstrap 95% intervals (10k resamples, seed 1) of each
run minus the first one named.
"""
import json
import random
import sys

sys.path.insert(0, "/Users/Shared/raim-bench/hippo-repo/benchmarks/longmemeval")
from evaluate_retrieval import check_answer_in_content  # hippo's own rule, verbatim

DATA = "/Users/damientivelet/Projects/biological-memory/benchmarks/longmemeval/data/longmemeval_s_cleaned.json"
BUDGETS = (500, 1000, 2000, 4000, 8000, 16000, 32000)


def load(path):
    return {r["question_id"]: r for r in map(json.loads, open(path, encoding="utf-8"))}


def sessions_of(memory, evidence):
    tags = set(memory.get("tags", []))
    content = memory.get("content", "")
    return {sid for sid in evidence if sid in tags or f"[Session: {sid}]" in content}


def rank_of(run, sid):
    for i, memory in enumerate(run["retrieved_memories"]):
        if sid in sessions_of(memory, {sid}):
            return i
    return float("inf")


def interval(a, b):
    diffs = [x - y for x, y in zip(a, b)]
    rng, n = random.Random(1), len(diffs)
    means = sorted(sum(diffs[rng.randrange(n)] for _ in range(n)) / n * 100 for _ in range(10_000))
    return f"{sum(diffs) / n * 100:+.1f} [{means[250]:+.1f}, {means[9749]:+.1f}]"


def report(metrics, names):
    base = names[0]
    for metric, by_run in metrics.items():
        print(metric)
        for name in names:
            values = by_run[name]
            line = f"  {name:<14} {sum(values) / len(values) * 100:5.1f}"
            if name != base:
                line += f"   vs {base}: {interval(values, by_run[base])}"
            print(line)


def freshness(questions, runs):
    ku = [q for q in questions if q["question_type"] == "knowledge-update"]
    metrics = {"update ranked above stale value": {}, "update ranked first": {}, "stale value ranked first": {}}
    for name, run in runs.items():
        above, first, stale_first = [], [], []
        for q in ku:
            dates = dict(zip(q["haystack_session_ids"], q["haystack_dates"]))
            old, new = sorted(q["answer_session_ids"], key=lambda sid: dates[sid])
            r = run[q["question_id"]]
            new_rank, old_rank = rank_of(r, new), rank_of(r, old)
            above.append(int(new_rank < old_rank))
            first.append(int(new_rank == 0))
            stale_first.append(int(old_rank == 0))
        metrics["update ranked above stale value"][name] = above
        metrics["update ranked first"][name] = first
        metrics["stale value ranked first"][name] = stale_first
    print(f"knowledge-update questions: {len(ku)}")
    return metrics


def budget(questions, runs):
    metrics = {}
    for b in BUDGETS:
        metrics[f"R@{b} tokens"], metrics[f"answer in content @{b} tokens"] = {}, {}
        metrics[f"capped at 10 rows @{b} tokens"] = {}
    for name, run in runs.items():
        for b in BUDGETS:
            hits, answers, capped = [], [], []
            for q in questions:
                evidence = set(q["answer_session_ids"])
                # hippo's own budget rule, read off its A-default output: the top result
                # always goes in, then every later one that still fits, skipping the rest.
                spent, within = 0, []
                for memory in run[q["question_id"]]["retrieved_memories"]:
                    cost = memory.get("tokens", 0)
                    if within and spent + cost > b:
                        continue
                    spent += cost
                    within.append(memory)
                capped.append(int(spent <= b and len(within) == len(run[q["question_id"]]["retrieved_memories"]) == 10))
                hits.append(int(any(sessions_of(memory, evidence) for memory in within)))
                answers.append(int(check_answer_in_content(within, q["answer"], len(within))))
            metrics[f"R@{b} tokens"][name] = hits
            metrics[f"answer in content @{b} tokens"][name] = answers
            metrics[f"capped at 10 rows @{b} tokens"][name] = capped
    return metrics


def main():
    mode, pairs = sys.argv[1], sys.argv[2:]
    names = [p.split("=", 1)[0] for p in pairs]
    runs = {p.split("=", 1)[0]: load(p.split("=", 1)[1]) for p in pairs}
    questions = json.load(open(DATA, encoding="utf-8"))
    report({"freshness": freshness, "budget": budget}[mode](questions, runs), names)


if __name__ == "__main__":
    main()
