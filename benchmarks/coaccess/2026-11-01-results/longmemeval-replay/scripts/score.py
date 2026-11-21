"""Scores replay JSONL files on the metrics registered in replay.mts: R@1 and all-evidence@5
(primary), R@5 and R@10 (secondary), per question type, with paired bootstrap intervals
(10k resamples, seed 1) of each arm minus the first one named.

usage: python3 -I score.py NAME=file.jsonl:arm [NAME=file.jsonl:arm ...]
"""
import json
import random
import sys
from collections import defaultdict


def load(spec):
    name, rest = spec.split("=", 1)
    path, arm = rest.rsplit(":", 1)
    return name, {r["question_id"]: (r["question_type"], r["ranks"][arm]) for r in map(json.loads, open(path))}


def any_at(ranks, k):
    return int(any(v is not None and v <= k for v in ranks.values()))


def all_at(ranks, k):
    return int(all(v is not None and v <= k for v in ranks.values()))


METRICS = {"R@1": lambda r: any_at(r, 1), "all-evidence@5": lambda r: all_at(r, 5), "R@5": lambda r: any_at(r, 5), "R@10": lambda r: any_at(r, 10)}


def interval(a, b):
    d = [x - y for x, y in zip(a, b)]
    rng, n = random.Random(1), len(d)
    m = sorted(sum(d[rng.randrange(n)] for _ in range(n)) / n * 100 for _ in range(10_000))
    return f"{sum(d) / n * 100:+.1f} [{m[250]:+.1f}, {m[9749]:+.1f}]"


def main():
    arms = dict(load(s) for s in sys.argv[1:])
    names = list(arms)
    qids = sorted(set.intersection(*(set(a) for a in arms.values())))
    print(f"questions scored: {len(qids)}")
    for metric, f in METRICS.items():
        print(metric)
        vals = {n: [f(arms[n][q][1]) for q in qids] for n in names}
        for n in names:
            line = f"  {n:<12} {sum(vals[n]) / len(qids) * 100:5.1f}"
            if n != names[0]:
                line += f"   vs {names[0]}: {interval(vals[n], vals[names[0]])}"
            print(line)
    print("per type, R@1 / all-evidence@5")
    by_type = defaultdict(list)
    for q in qids:
        by_type[arms[names[0]][q][0]].append(q)
    for t, qs in sorted(by_type.items()):
        cells = " | ".join(f"{n} {sum(any_at(arms[n][q][1], 1) for q in qs) / len(qs) * 100:.1f} / {sum(all_at(arms[n][q][1], 5) for q in qs) / len(qs) * 100:.1f}" for n in names)
        print(f"  {t} ({len(qs)}): {cells}")


if __name__ == "__main__":
    main()
