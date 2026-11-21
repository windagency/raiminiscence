"""Offline grid for ADR-0037, registered in adr0037-prereg.md. Flask only.
usage: python3 -I tune.py <repo>"""
import json, math, os, random, sys
from collections import defaultdict
W = "/Users/Shared/raim-bench/rework"
repo = sys.argv[1]
ids = json.load(open(f"{W}/stores/{repo}/ids.json"))
adj = defaultdict(dict)
d = f"{W}/stores/{repo}/on/.raiminiscence/memory/co-access"
for f in os.listdir(d):
    a, b = (ids[x] for x in f[:-5].split("__"))
    w = json.load(open(f"{d}/{f}"))["weight"]
    adj[a][b] = adj[b][a] = w
strongest = {k: max(v.values()) for k, v in adj.items()}
rows = json.load(open(f"{W}/tune/{repo}-off.json"))

def recall10(order, truth):
    top = set(order[:10]); return sum(t in top for t in truth) / len(truth)

def rerank(row, boost):
    scores = {p: s for p, s, _ in row["scored"]}
    wc = {p: w for p, _, w in row["scored"]}
    return sorted(scores, key=lambda p: -(scores[p] + boost(p, scores, wc)))

def adr35(p, scores, wc):
    raw = sum(w * 0.05 for n, w in adj[p].items() if n in scores)
    return wc[p] * 0.1 * (1 - math.exp(-raw))

def make(norm, agg, cap):
    def boost(p, scores, wc):
        top = max(scores.values())
        terms = []
        for n, w in adj[p].items():
            if n not in scores: continue
            den = {"own": strongest[p], "neighbour": strongest[n], "pair": max(strongest[p], strongest[n])}[norm]
            terms.append(w / den * scores[n] / top)
        if not terms: return 0.0
        a = max(terms) if agg == "max" else min(1.0, sum(terms))
        return cap * wc[p] * a
    return boost

def interval(dl):
    rng, n = random.Random(1), len(dl)
    m = sorted(sum(dl[rng.randrange(n)] for _ in range(n)) / n * 100 for _ in range(10_000))
    return f"{sum(dl)/n*100:+.1f} [{m[250]:+.1f}, {m[9749]:+.1f}]"

off = [recall10([p for p, _, _ in r["scored"]], r["truth"]) for r in rows]
reg = {json.loads(l)["sha"]: json.loads(l)["ranks"]["on"] for l in open(f"{W}/{repo}-results.jsonl")}
sim35 = [rerank(r, adr35) for r in rows]
mismatch = sum(any(o.index(t) + 1 != reg[r["sha"]][t] for t in r["truth"]) for o, r in zip(sim35, rows))
print(f"check: ADR-0035 simulation vs registered on arm, commits mismatched: {mismatch}/{len(rows)}")
results = []
order_norm = ["own", "neighbour", "pair"]
for norm in order_norm:
    for agg in ["max", "sum"]:
        for cap in [0.05, 0.1, 0.2, 0.3]:
            on = [recall10(rerank(r, make(norm, agg, cap)), r["truth"]) for r in rows]
            dl = [a - b for a, b in zip(on, off)]
            results.append((sum(dl), -cap, agg == "max", -order_norm.index(norm), norm, agg, cap, interval(dl)))
            print(f"{norm:<9} {agg} cap {cap:<4} file recall@10 on-off {interval(dl)}")
best = max(results)
print("chosen:", best[4], best[5], best[6], best[7])
