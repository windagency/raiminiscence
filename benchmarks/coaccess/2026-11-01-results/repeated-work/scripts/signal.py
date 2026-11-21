"""Exploratory, after the registered result: do the learned edges carry signal at all?
For each test commit whose off top-1 file is a truth file (the seed), AUC of the seed's edge
weight for the other truth files against every non-truth file. Compared with the same AUC
using real co-change counts from the train commits."""
import itertools, json, os, sys
from collections import Counter
W = "/Users/Shared/raim-bench/rework"

def auc(pos, neg):
    if not pos or not neg: return None
    return sum((p > n) + 0.5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg))

for repo in sys.argv[1:]:
    ids = json.load(open(f"{W}/stores/{repo}/ids.json"))
    edge = Counter()
    d = f"{W}/stores/{repo}/on/.raiminiscence/memory/co-access"
    for f in os.listdir(d):
        a, b = f[:-5].split("__")
        edge[frozenset((ids[a], ids[b]))] = json.load(open(f"{d}/{f}"))["weight"]
    data = json.load(open(f"{W}/data/{repo}.json"))
    co = Counter()
    for c in data["train"]:
        for p in itertools.combinations(sorted(set(c["changed"])), 2): co[frozenset(p)] += 1
    files = list(data["files"])
    truth = {c["sha"]: set(c["inStore"]) for c in data["test"]}
    res = {"edge": [], "cochange": []}
    for r in map(json.loads, open(f"{W}/{repo}-results.jsonl")):
        seed = [p for p, v in r["ranks"]["off"].items() if v == 1]
        if not seed: continue
        s, t = seed[0], truth[r["sha"]]
        others = [f for f in files if f != s]
        for name, w in (("edge", edge), ("cochange", co)):
            a = auc([w[frozenset((s, f))] for f in others if f in t], [w[frozenset((s, f))] for f in others if f not in t])
            if a is not None: res[name].append(a)
    print(repo, {k: f"AUC {sum(v)/len(v):.3f} over {len(v)} seeds" for k, v in res.items()}, f"edges with weight>=50: {sum(v >= 50 for v in edge.values())}/{len(edge)}")
