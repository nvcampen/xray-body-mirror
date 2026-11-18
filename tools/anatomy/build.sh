#!/usr/bin/env bash
# Rebuilds assets/body.json and assets/body.bin.gz from BodyParts3D
# (the processed meshes in ashemag/human-atlas, pinned to one commit).
# Needs git, python3 with numpy and scipy, and node with `npm install` done.
set -euo pipefail
cd "$(dirname "$0")/../.."
ATLAS_COMMIT=1c38bf35c254a891200d3cedecfd57abebe83d8d
SRC=.cache/human-atlas
if [ ! -f "$SRC/public/models/atlas.json" ]; then
  rm -rf "$SRC" && mkdir -p "$SRC"
  git -C "$SRC" init -q
  git -C "$SRC" remote add origin https://github.com/ashemag/human-atlas.git
  git -C "$SRC" sparse-checkout set --no-cone /public/models/
  git -C "$SRC" fetch -q --depth 1 origin "$ATLAS_COMMIT"
  git -C "$SRC" checkout -q FETCH_HEAD
fi
M="$SRC/public/models"
mkdir -p work
python3 tools/anatomy/classify.py "$M" work/layers.json
node tools/anatomy/simplify.mjs "$M" work/layers.json work
python3 tools/anatomy/rig.py work assets
