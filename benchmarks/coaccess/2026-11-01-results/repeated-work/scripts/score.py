"""Scores the repeated-work replay on the metrics registered in replay.mts: file recall@10
(primary), file recall@3, file recall@5 and hit@1, on minus off, paired bootstrap 10k, seed 1.
Also reports how repeated the test work is: the share of test commits with at least one pair
of truth files that changed together in some train commit.

usage: python3 -I score.py [--suffix=-rel] <repo> [<repo> ...]
"""
import itertools
import json
import random
import sys

W = "/Users/Shared/raim-bench/rework"


def file_recall(ranks, k):
    return sum(v is not None and v <= k for v in ranks.values()) / len(ranks)


def hit1(ranks, _k):
    return float(any(v == 1 for v in ranks.values()))


METRICS = [("file recall@10", file_recall, 10), ("file recall@3", file_recall, 3), ("file recall@5", file_recall, 5), ("hit@1", hit1, 1)]


def interval(d):
    rng, n = random.Random(1), len(d)
    m = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n * 100 for _ in range(10_000))
    return f"{sum(d) / n * 100:+.1f} [{m[250]:+.1f}, {m[9749]:+.1f}]"


SUFFIX = ""


def load(repo):
    rows = [json.loads(l) for l in open(f"{W}/{repo}{SUFFIX}-results.jsonl")]
    data = json.load(open(f"{W}/data/{repo}.json"))
    pairs = set()
    for c in data["train"]:
        pairs.update(itertools.combinations(sorted(set(c["changed"])), 2))
    truth = {c["sha"]: c["inStore"] for c in data["test"]}
    seen = sum(any(p in pairs for p in itertools.combinations(sorted(truth[r["sha"]]), 2)) for r in rows)
    return rows, seen


def main():
    global SUFFIX
    args = sys.argv[1:]
    if args and args[0].startswith("--suffix="):
        SUFFIX = args.pop(0).split("=", 1)[1]
    pooled = []
    for repo in args + ["pooled"]:
        if repo == "pooled":
            rows, label = pooled, f"pooled ({len(pooled)} commits)"
        else:
            rows, seen = load(repo)
            pooled += rows
            missing = sum(v is None for r in rows for a in ("on", "off") for v in r["ranks"][a].values())
            label = f"{repo} ({len(rows)} commits, {seen} with a truth pair co-changed in train, {missing} unranked truth files)"
        print(label)
        for name, f, k in METRICS:
            on = [f(r["ranks"]["on"], k) for r in rows]
            off = [f(r["ranks"]["off"], k) for r in rows]
            changed = sum(a != b for a, b in zip(on, off))
            print(f"  {name:<15} off {sum(off) / len(rows) * 100:5.1f}  on {sum(on) / len(rows) * 100:5.1f}  on-off {interval([a - b for a, b in zip(on, off)])}  commits changed {changed}")


if __name__ == "__main__":
    main()
