import json, sys, collections
D = "/Users/damientivelet/Projects/biological-memory/benchmarks/longmemeval/data/longmemeval_s_cleaned.json"
hay = {q["question_id"]: set(q["haystack_session_ids"]) for q in json.load(open(D))}
for path in sys.argv[1:]:
    c = collections.Counter()
    for r in map(json.loads, open(path)):
        for m in r["retrieved_memories"]:
            t = m["tags"][0]
            if t not in hay[r["question_id"]]:
                c[t.split(":")[0] if ":" in t else "OTHER:" + t] += 1
    print(path, dict(c))
