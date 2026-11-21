#!/bin/zsh
# Rebuild hippo's harness (a59ea151) and hippo-memory 1.52.5 installs (packed from d0150e5).
set -eux
B=/Users/Shared/raim-bench; cd $B
[ -d hippo-repo/.git ] || git clone https://github.com/kitfunso/hippo-memory hippo-repo
cd hippo-repo; git fetch -q origin; git checkout -q a59ea151; git log -1 --format='%H %s'
npm ci --no-audit --no-fund; npm run build; ls dist/eval-stats.js
[ -d ../hippo-d0150e5 ] || git worktree add ../hippo-d0150e5 d0150e5
cd ../hippo-d0150e5; npm ci --no-audit --no-fund; npm run build; mkdir -p ../pkg; npm pack --pack-destination ../pkg
cd $B; for d in hipA hipB; do mkdir -p $d; (cd $d; [ -f package.json ] || npm init -y >/dev/null; npm i --no-audit --no-fund ../pkg/hippo-memory-1.52.5.tgz); done
(cd hipB; npm i --no-audit --no-fund @huggingface/transformers@4.3.0)
node hipA/node_modules/hippo-memory/bin/hippo.js --version
echo SETUP DONE
