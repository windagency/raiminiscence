#!/bin/zsh
# usage: locomo-drive.sh <hippoA|hippoB|rai-embedded|rai-ollama> [run.py args]
# hippo's LoCoMo harness at v3.1.1 (benchmarks/locomo/run.py), unchanged, in its frozen evidence protocol:
# data/locomo10.json (sha256 79fa87e9...), fresh HIPPO_HOME per conversation, top-k 5, --budget 4000.
# hippoA: hippo-memory 3.1.1 as installed, BM25 only. hippoB: plus @huggingface/transformers, MiniLM.
# rai-*: the frozen current-1102 build through hippo-cli-shim.ts, so repo edits can't leak into the run.
set -eu
# The harness sets HOME per conversation, which breaks the Volta shim; put the real node first on PATH.
export PATH=/Users/damientivelet/.volta/tools/image/node/26.9.0/bin:$PATH
B=/Users/Shared/raim-bench
ARM=$1; shift
case $ARM in
  hippoA) export HIPPO_BIN="node $B/hip311A/node_modules/hippo-memory/bin/hippo.js" ;;
  hippoB) export HIPPO_BIN="node $B/hip311B/node_modules/hippo-memory/bin/hippo.js" ;;
  rai-embedded|rai-ollama) export HIPPO_BIN="node $B/current-1102/benchmarks/raiminiscence-runner/hippo-cli-shim.ts"; export RAIMINISCENCE_ARM=${ARM#rai-} ;;
  *) echo "unknown arm $ARM"; exit 2 ;;
esac
cd $B/hippo-v311/benchmarks/locomo
$B/locomo/.venv/bin/python run.py --data $B/locomo/data/locomo10.json --output-dir ${LOCOMO_OUT:-$B/locomo/results} --output-name $ARM-evidence.json --score-mode evidence "$@"
echo "LOCOMO DONE $ARM $*"
