"""Writes the published LongMemEval-S run files: each harness JSONL row with its retrieved
memories' `content` dropped wherever it is a haystack session's text, which the dataset
already holds, and kept for Memories consolidation created, which it does not.

usage: python3 -I slim-runs.py OUT_DIR NAME=run.jsonl [NAME=run.jsonl ...]
"""
import gzip
import json
import sys
from pathlib import Path

DATA = "/Users/damientivelet/Projects/biological-memory/benchmarks/longmemeval/data/longmemeval_s_cleaned.json"


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    hay = {q["question_id"]: set(q["haystack_session_ids"]) for q in json.load(open(DATA, encoding="utf-8"))}
    for pair in sys.argv[2:]:
        name, path = pair.split("=", 1)
        with open(path, encoding="utf-8") as src, gzip.open(out / f"{name}.jsonl.gz", "wt", encoding="utf-8", compresslevel=9) as dst:
            for row in map(json.loads, src):
                for memory in row["retrieved_memories"]:
                    if memory["tags"][0] in hay[row["question_id"]]:
                        memory.pop("content", None)
                dst.write(json.dumps(row, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
