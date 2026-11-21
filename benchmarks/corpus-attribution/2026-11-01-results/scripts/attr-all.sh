#!/bin/bash
cd /Users/Shared/raim-bench/corpus-rerun
T=/Users/damientivelet/Projects/biological-memory/node_modules/.bin/tsx
for b in baseline fusion; do $T attribute.mts /Users/Shared/raim-bench/$b/packages/raiminiscence-mcp/dist/core $b > attr-$b.txt 2>attr-$b.err; done
$T attribute.mts /Users/damientivelet/Projects/biological-memory/packages/raiminiscence-mcp/dist/core current > attr-current.txt 2>attr-current.err
echo ATTR_ALL_FINISHED > attr.done
