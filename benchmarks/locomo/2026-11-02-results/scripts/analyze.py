"""LoCoMo evidence recall per arm, from score_evidence.py's rescored JSONs.

usage: analyze.py <ref-arm>=<rescored.json[.gz]> <arm>=<rescored.json[.gz]> ...
Evidence recall@k is hippo's per-QA metric: the share of a QA's gold dia_ids among the dia_ids of its top-k
memories, averaged over scored QAs. k=5 is the protocol's number; k=1 and k=3 use the same saved top-5 ranking.
Intervals: paired percentile bootstrap over QAs, 10,000 resamples, seed 1, 95%, each arm minus the first.
"""
import gzip, json, random, sys
from collections import defaultdict

def load(path):
    rows = json.load((gzip.open if path.endswith(".gz") else open)(path, "rt"))["per_qa"]
    return {(r["conversation_id"], r["qa_index"]): r for r in rows if r.get("scored")}

def recall_at(row, k):
    gold = set(row["gold_evidence"])
    return len(gold & set(row["retrieved_dia_ids"][:k])) / len(gold)

arms = [a.split("=", 1) for a in sys.argv[1:]]
data = {name: load(path) for name, path in arms}
names = [n for n, _ in arms]
keys = sorted(set.intersection(*(set(d) for d in data.values())))
for n in names:
    assert len(data[n]) == len(keys), f"{n}: {len(data[n])} scored QAs, {len(keys)} shared"
cats = sorted({data[names[0]][k]["category_name"] for k in keys})
rng = random.Random(1)
draws = [[rng.randrange(len(keys)) for _ in keys] for _ in range(10_000)]

def table(subset, label):
    print(f"\n{label} (n={len(subset)})")
    for k in (1, 3, 5):
        vec = {n: [recall_at(data[n][q], k) for q in subset] for n in names}
        ref = vec[names[0]]
        cells = [f"{names[0]} {100 * sum(ref) / len(ref):5.1f}"]
        for n in names[1:]:
            diff = [a - b for a, b in zip(vec[n], ref)]
            idx = [[rng.randrange(len(subset)) for _ in subset] for _ in range(2000)] if len(subset) != len(keys) else draws
            means = sorted(sum(diff[i] for i in d) / len(d) for d in idx)
            lo, hi = means[int(0.025 * len(means))], means[int(0.975 * len(means)) - 1]
            cells.append(f"{n} {100 * sum(vec[n]) / len(subset):5.1f} ({100 * sum(diff) / len(diff):+.1f} [{100 * lo:+.1f}, {100 * hi:+.1f}])")
        print(f"  R@{k}: " + " | ".join(cells))

table(keys, "overall")
for c in cats:
    table([q for q in keys if data[names[0]][q]["category_name"] == c], c)
