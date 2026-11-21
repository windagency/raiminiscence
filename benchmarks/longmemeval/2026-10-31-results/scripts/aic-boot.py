"""Paired bootstrap of answer_in_content@5 (hippo's check_answer_in_content), 10k resamples, seed 1, vs the first run named."""
import importlib.util, json, sys
sys.path.insert(0, "/Users/Shared/raim-bench/hippo-repo/benchmarks/longmemeval")
from evaluate_retrieval import check_answer_in_content
spec = importlib.util.spec_from_file_location("extra", "/Users/Shared/raim-bench/lme-extra.py")
extra = importlib.util.module_from_spec(spec); spec.loader.exec_module(extra)
qs = json.load(open(extra.DATA))
names = [p.split("=", 1)[0] for p in sys.argv[1:]]
runs = {p.split("=", 1)[0]: extra.load(p.split("=", 1)[1]) for p in sys.argv[1:]}
extra.report({"answer in content @5": {n: [int(check_answer_in_content(r[q["question_id"]]["retrieved_memories"], q["answer"], 5)) for q in qs] for n, r in runs.items()}}, names)
