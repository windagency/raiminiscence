#!/bin/zsh
# Waits for the shipped-build replay (item 2) so the two never share Ollama, then runs the ADR-0035 arm.
set -eu
until grep -q 'COACCESS DONE' /Users/Shared/raim-bench/coaccess/run.log 2>/dev/null; do echo "waiting for item 2: $(tail -1 /Users/Shared/raim-bench/coaccess/run.log)"; sleep 60; done
cd /Users/Shared/raim-bench/coaccess
/Users/damientivelet/Projects/biological-memory/node_modules/.bin/tsx replay-fixed.mts 0 1
echo "FIXED DONE"
