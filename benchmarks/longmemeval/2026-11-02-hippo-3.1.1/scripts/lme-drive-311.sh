#!/bin/zsh
# usage: lme-drive-311.sh [--limit N]
# hippo-memory 3.1.1 on hippo's LongMemEval-S harness at v3.1.1 (recall_cli_haystack.py, unchanged apart from a
# docstring since a59ea151), same arms as lme-drive.sh's */hippo case: A = BM25 as installed, B = plus MiniLM.
set -eu
export PATH=/Users/damientivelet/.volta/tools/image/node/26.9.0/bin:$PATH
B=/Users/Shared/raim-bench
H=$B/hippo-v311/benchmarks/longmemeval/recall_cli_haystack.py
D=/Users/damientivelet/Projects/biological-memory/benchmarks/longmemeval/data/longmemeval_s_cleaned.json
W=$B/lme-w/hippo311
HA=$B/hip311A/node_modules/hippo-memory/bin/hippo.js; HB=$B/hip311B/node_modules/hippo-memory/bin/hippo.js
L=("$@")
python3 $H build  --hippo $HA --data $D --work $W --workers 4 $L
python3 $H recall --hippo $HA --data $D --work $W --run A-default $L
python3 $H recall --hippo $HA --data $D --work $W --run A-lifted --budget 100000000 $L
python3 $H embed  --hippo $HB --data $D --work $W --workers 2 $L
python3 $H recall --hippo $HB --data $D --work $W --store embedded --run B-default $L
python3 $H recall --hippo $HB --data $D --work $W --store embedded --run B-lifted --budget 100000000 $L
echo "DRIVE DONE $W $L"
