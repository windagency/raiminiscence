#!/bin/zsh
# Runs the pre-registered repeated-work replay on both repos, one after the other.
set -eu
cd /Users/Shared/raim-bench/rework
for r in flask hono; do /Users/damientivelet/Projects/biological-memory/node_modules/.bin/tsx replay.mts $r; done
echo "REWORK ALL DONE"
