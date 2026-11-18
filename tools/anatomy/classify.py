"""Step 1: put every BodyParts3D part in one of the app's layers.
Usage: python3 classify.py ATLAS_DIR OUT.json"""
import json, re, sys
from pathlib import Path

atlas = json.loads((Path(sys.argv[1]) / "atlas.json").read_text())
concepts = {c["id"]: set(c["elements"]) for c in atlas["concepts"]}
muscle_set = concepts["FMA5022"]          # 'muscle organ'

ORGANS = {"cardiac", "respiratory", "digestive", "urinary", "endocrine", "reproductive", "lymphatic"}
out = {}
for p in atlas["parts"]:
    s, n = p["system"], p["name"]
    if p["id"] in muscle_set or s == "muscular" or re.search(r"iliotibial tract|calcaneal tendon|tensor fasciae", n, re.I):
        layer = "muscles"
    elif re.search(r"external ear", n, re.I) or s == "integumentary":
        layer = "skin"
    elif re.search(r"lacrimal bone", n, re.I):
        layer = "skeleton"
    elif s in ("skeletal", "connective"):
        layer = "skeleton"
    elif s in ("nervous", "sensory"):
        layer = "nerves"
    elif s in ("arterial", "venous"):
        layer = "vessels"
    elif s in ORGANS:
        layer = "organs"
    else:
        layer = "organs"
    out[p["id"]] = layer
Path(sys.argv[2]).write_text(json.dumps(out))
from collections import Counter
print(Counter(out.values()))
