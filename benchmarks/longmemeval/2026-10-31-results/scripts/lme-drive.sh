#!/bin/zsh
# usage: lme-drive.sh <hippo|rai-embedded|rai-ollama> [--limit N]
# hippo's recall_cli_haystack.py (a59ea151), unchanged, over one system's work dir. Every stage resumes per question.
# rAI runs the frozen baseline build in /Users/Shared/raim-bench/baseline, so repo edits can't leak into the run.
set -eu
# The harness sets HOME per question, which breaks the Volta shim; put the real node first on PATH.
export PATH=/Users/damientivelet/.volta/tools/image/node/26.9.0/bin:$PATH
B=/Users/Shared/raim-bench
H=$B/hippo-repo/benchmarks/longmemeval/recall_cli_haystack.py
D=/Users/damientivelet/Projects/biological-memory/benchmarks/longmemeval/data/longmemeval_s_cleaned.json
W=$B/lme-w/$1; shift
# A *-fusion work dir runs the ADR-0032 build over fresh copies of its base arm's stores, as F-* runs.
BUILD=baseline; P=R
[[ $W == *-fusion* ]] && { BUILD=fusion; P=F; }
# A *-fullbody work dir runs the ADR-0033 build (fusion, detail uncapped) over the same stores, as D-* runs.
[[ $W == *-fullbody* ]] && { BUILD=fullbody; P=D; }
SHIM=$B/$BUILD/benchmarks/raiminiscence-runner/hippo-cli-shim.ts
L=("$@")
case $W in
  */hippo-slept)
    # Item 2: hippo B's store after one `hippo sleep` pass, recalled like B-*.
    HB=$B/hipB/node_modules/hippo-memory/bin/hippo.js
    python3 $H embed  --hippo $HB --data $D --work $W --workers 4 $L
    python3 $B/sleep-stores.py hippo $W --workers 4
    python3 $H recall --hippo $HB --data $D --work $W --store embedded --run B-slept-default $L
    python3 $H recall --hippo $HB --data $D --work $W --store embedded --run B-slept-lifted --budget 100000000 $L ;;
  *-slept)
    # Item 2: the fusion build's store after one consolidate() pass, recalled like F-*.
    python3 $H embed  --hippo $SHIM --data $D --work $W --workers 8 $L
    python3 $B/sleep-stores.py rai $W --workers 1
    python3 $H recall --hippo $SHIM --data $D --work $W --store embedded --run F-slept-default --workers 1 $L
    python3 $H recall --hippo $SHIM --data $D --work $W --store embedded --run F-slept-lifted --budget 100000000 --workers 1 $L ;;
  */hippo)
    HA=$B/hipA/node_modules/hippo-memory/bin/hippo.js; HB=$B/hipB/node_modules/hippo-memory/bin/hippo.js
    python3 $H build  --hippo $HA --data $D --work $W --workers 8 $L
    python3 $H recall --hippo $HA --data $D --work $W --run A-default $L
    python3 $H recall --hippo $HA --data $D --work $W --run A-lifted --budget 100000000 $L
    python3 $H recall --hippo $HA --data $D --work $W --run A-shuffled --budget 100000000 --shuffle $L
    python3 $H embed  --hippo $HB --data $D --work $W --workers 4 $L
    python3 $H recall --hippo $HB --data $D --work $W --store embedded --run B-default $L
    python3 $H recall --hippo $HB --data $D --work $W --store embedded --run B-lifted --budget 100000000 $L ;;
  *)
    # Embedded: 1 worker; 4 hit memory pressure, and 2 got the watcher reaped on 2026-10-31. Ollama serves one request at a time; more workers only queue embeds toward the 15s timeout.
    BW=1
    python3 $H build  --hippo $SHIM --data $D --work $W --workers $BW $L
    python3 $H embed  --hippo $SHIM --data $D --work $W --workers 8 $L
    python3 $H recall --hippo $SHIM --data $D --work $W --store embedded --run $P-default --workers $BW $L
    python3 $H recall --hippo $SHIM --data $D --work $W --store embedded --run $P-lifted --budget 100000000 --workers $BW $L
    python3 $H recall --hippo $SHIM --data $D --work $W --store embedded --run $P-shuffled --budget 100000000 --shuffle --workers $BW $L ;;
esac
echo "DRIVE DONE $W $L"
