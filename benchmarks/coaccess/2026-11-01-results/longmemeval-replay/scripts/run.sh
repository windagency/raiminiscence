#!/bin/zsh
# Waits for the latency A/B (item 1) so the two never share the CPU, then runs the pre-registered replay.
set -eu
until grep -q 'LATENCY DONE' /Users/Shared/raim-bench/latency/run.log 2>/dev/null; do echo "waiting for item 1: $(tail -1 /Users/Shared/raim-bench/latency/run.log)"; sleep 60; done
cd /Users/Shared/raim-bench/coaccess
/Users/damientivelet/Projects/biological-memory/node_modules/.bin/tsx replay.mts 0 1
echo "COACCESS DONE"
