#!/bin/zsh
# Builds the 1,500 and 15,000 stores, then measures both builds in both modes at every size.
set -eu
cd /Users/Shared/raim-bench/latency
T=/Users/damientivelet/Projects/biological-memory/node_modules/.bin/tsx
for n in 1500 15000; do
  [ -f stores/$n.done ] && continue
  rm -rf stores/$n; mkdir -p stores/$n
  $T build-store.mts $n $PWD/stores/$n > stores/$n.build.json
  touch stores/$n.done
done
: > results.jsonl
for n in 150 1500 15000; do
  for b in baseline fullbody; do
    for m in scoring e2e; do
      rm -rf run && cp -R stores/$n run
      $T measure.mts $b $PWD/run $m | jq -c --argjson n $n '. + {storeSize: $n}' >> results.jsonl
      tail -1 results.jsonl
    done
  done
done
rm -rf run
echo "LATENCY DONE"
