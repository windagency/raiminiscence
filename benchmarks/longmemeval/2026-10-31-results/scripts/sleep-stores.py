"""Item 2: one consolidation pass over every embedded/<qid> store of a work dir, before recall.

usage: python3 sleep-stores.py <hippo|rai> <work> [--workers N]
Runs in each store exactly as recall_cli_haystack.py's hippo() runs the CLI (cwd, HOME, HIPPO_HOME
inside the store). hippo: `hippo sleep`, then `hippo export` for the ids left. rai: rai-consolidate.mts.
A Memory the pass created maps to "consolidated:<id>" in ids.json, so it can never count as a hit;
a removed Memory just stops being returned. Resumable per store via slept.json.
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, "/Users/Shared/raim-bench/hippo-repo/benchmarks/longmemeval")
from recall_cli_haystack import hippo  # the harness's own env-isolated runner

HIPPO_B = "/Users/Shared/raim-bench/hipB/node_modules/hippo-memory/bin/hippo.js"
RAI = "/Users/Shared/raim-bench/rai-consolidate.mts"


def sleep_one(system: str, inst: Path) -> dict:
    done = inst / "slept.json"
    if done.exists():
        return json.loads(done.read_text())
    if system == "hippo":
        log = hippo(HIPPO_B, inst, ["sleep"])
        left = [e["id"] for e in json.loads(hippo(HIPPO_B, inst, ["export"]))]
        result = {"log": log.strip()[-400:]}
    else:
        out = json.loads(hippo(RAI, inst, []))
        left, result = out["ids"], out["result"]
    ids_file = inst / "ids.json"
    record = json.loads(ids_file.read_text())
    before = set(record["ids"])
    created = [i for i in left if i not in before]
    record["ids"].update({i: f"consolidated:{i}" for i in created})
    ids_file.write_text(json.dumps(record))
    summary = {"before": len(before), "after": len(left), "created": len(created), "removed": len(before - set(left)), "result": result}
    done.write_text(json.dumps(summary))
    return summary


def main():
    system, work = sys.argv[1], Path(sys.argv[2])
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 1
    stores = sorted(p for p in (work / "embedded").iterdir() if p.is_dir())
    with ThreadPoolExecutor(max_workers=workers) as pool:
        summaries = list(pool.map(lambda p: sleep_one(system, p), stores))
    totals = {k: sum(s[k] for s in summaries) for k in ("before", "after", "created", "removed")}
    print(f"slept {len(summaries)} stores: {totals}")


if __name__ == "__main__":
    main()
