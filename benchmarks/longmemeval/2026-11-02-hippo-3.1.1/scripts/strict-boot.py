"""Paired bootstrap of hippo's strict all-evidence R@k (score_haystack.py's `all`), 470 non-_abs questions, vs the first run."""
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("extra", "/Users/Shared/raim-bench/lme-extra.py")
extra = importlib.util.module_from_spec(spec); spec.loader.exec_module(extra)
qs = [q for q in json.load(open(extra.DATA)) if "_abs" not in q["question_id"]]
pairs = sys.argv[1:]
names = [p.split("=", 1)[0] for p in pairs]
runs = {p.split("=", 1)[0]: extra.load(p.split("=", 1)[1]) for p in pairs}
def every(r, q, k):
    top = [m["tags"][0] for m in r[q["question_id"]]["retrieved_memories"][:k]]
    return int(all(g in top for g in q["answer_session_ids"]))
extra.report({f"strict R@{k}": {n: [every(r, q, k) for q in qs] for n, r in runs.items()} for k in (1, 5, 10)}, names)
