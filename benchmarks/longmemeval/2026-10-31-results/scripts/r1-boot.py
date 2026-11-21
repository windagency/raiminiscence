"""Paired bootstrap of R@1 (hippo's check_session_hit at k=1), 10k resamples, seed 1, vs the first run named."""
import importlib.util, json, sys
sys.path.insert(0, "/Users/Shared/raim-bench/hippo-repo/benchmarks/longmemeval")
from evaluate_retrieval import check_session_hit
spec = importlib.util.spec_from_file_location("extra", "/Users/Shared/raim-bench/lme-extra.py")
extra = importlib.util.module_from_spec(spec); spec.loader.exec_module(extra)
qs = json.load(open(extra.DATA))
pairs = sys.argv[1:]
names = [p.split("=", 1)[0] for p in pairs]
runs = {p.split("=", 1)[0]: extra.load(p.split("=", 1)[1]) for p in pairs}
extra.report({"R@1": {n: [int(check_session_hit(r[q["question_id"]]["retrieved_memories"], q["answer_session_ids"], 1)) for q in qs] for n, r in runs.items()}}, names)
