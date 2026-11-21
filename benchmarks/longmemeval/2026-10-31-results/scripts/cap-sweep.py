"""Answer-in-content@5 and returned tokens if recall's detail cap were N chars, on F-lifted's own ranking.
detail = truncatedDetail(body), body = the session text the harness passed to `remember -`."""
import json, sys
sys.path.insert(0, "/Users/Shared/raim-bench/hippo-repo/benchmarks/longmemeval")
from evaluate_retrieval import check_answer_in_content
D = "/Users/damientivelet/Projects/biological-memory/benchmarks/longmemeval/data/longmemeval_s_cleaned.json"
qs = json.load(open(D))
run = {r["question_id"]: r for r in map(json.loads, open(sys.argv[1]))}
for cap in (280, 500, 1000, 2000, 4000, 8000, None):
    hits, toks = [], []
    for q in qs:
        text = {sid: "\n".join(t["content"] for t in s) for sid, s in zip(q["haystack_session_ids"], q["haystack_sessions"])}
        top = run[q["question_id"]]["retrieved_memories"][:5]
        mems = []
        for m in top:
            body = text.get(m["tags"][0], m["content"])
            detail = body if cap is None or len(body) <= cap else body[:cap] + "…"
            mems.append({"content": detail})
            toks.append(len(detail) / 4)
        hits.append(check_answer_in_content(mems, q["answer"], 5))
    print(f"cap {str(cap):>5}: answer-in-content@5 {sum(hits)/len(hits)*100:5.1f}   mean tokens/result {sum(toks)/len(toks):6.0f}   top-5 tokens {sum(toks)/len(qs):6.0f}")
