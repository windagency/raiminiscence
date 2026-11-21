#!/bin/zsh
# ADR-0037 one-shot arms (adr0037-prereg.md): Hono, Flask as an implementation check, then LongMemEval.
set -eu
TSX=/Users/damientivelet/Projects/biological-memory/node_modules/.bin/tsx
cd /Users/Shared/raim-bench/rework
for r in hono flask; do $TSX replay-rel.mts $r; done
echo "REWORK REL DONE"
cd /Users/Shared/raim-bench/coaccess
$TSX replay-rel.mts 0 1
echo "LME REL DONE"
