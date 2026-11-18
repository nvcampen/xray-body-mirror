"""Step 3: find the rest-pose joints, bind every vertex to the body segments that move it,
quantize and pack everything into one compact binary for the browser.
Usage: python3 rig.py work/ OUT_DIR"""
import json, re, sys, gzip
from pathlib import Path
import numpy as np

work, out = Path(sys.argv[1]), Path(sys.argv[2])
meta = json.loads((work / "simplified.json").read_text())
raw = (work / "simplified.bin").read_bytes()
parts = meta["parts"]
for p in parts:
    p["P"] = np.frombuffer(raw, np.float32, p["nv"] * 3, p["offP"]).reshape(-1, 3).astype(np.float64)
    p["I"] = np.frombuffer(raw, np.uint32, p["ni"], p["offI"]).reshape(-1, 3)

def pts(rx):
    sel = [p["P"] for p in parts if re.search(rx, p["name"], re.I)]
    assert sel, rx
    return np.concatenate(sel)

def end(v, axis, side, band):          # centroid of the vertices within `band` of the min/max along an axis
    c = v[:, axis]
    m = c.max() - band if side > 0 else c.min() + band
    return v[c >= m].mean(0) if side > 0 else v[c <= m].mean(0)

skin = pts(r"^Skin$")
L = np.zeros((33, 3))
for side, s, o in (("left", 1, 0), ("right", -1, 1)):
    hum = pts(rf"^{side} humerus$"); uln = pts(rf"^{side} ulna$"); rad = pts(rf"^{side} radius$")
    fem = pts(rf"^{side} femur$"); tib = pts(rf"^{side} tibia$")
    L[11 + o] = end(hum, 1, 1, 0.035)
    L[13 + o] = (end(hum, 1, -1, 0.025) + end(uln, 1, 1, 0.025)) / 2
    L[15 + o] = (end(rad, 1, -1, 0.015) + end(uln, 1, -1, 0.015)) / 2
    L[17 + o] = end(pts(rf"^{side} fifth metacarpal"), 1, -1, 0.008)
    L[19 + o] = end(pts(rf"^{side} second metacarpal"), 1, -1, 0.008)
    L[21 + o] = pts(rf"distal phalanx of {side} thumb").mean(0)
    top = fem[fem[:, 1] > fem[:, 1].max() - 0.05]
    L[23 + o] = top[np.abs(top[:, 0]) < np.abs(top[:, 0]).mean()].mean(0)      # femoral head, the medial half of the top
    L[25 + o] = (end(fem, 1, -1, 0.02) + end(tib, 1, 1, 0.02)) / 2
    L[27 + o] = pts(rf"^{side} talus$").mean(0)
    cal = pts(rf"^{side} calcaneus$")
    L[29 + o] = cal[(cal[:, 2] < cal[:, 2].min() + 0.015)].mean(0)
    foot = skin[(skin[:, 1] < 0.06) & (skin[:, 0] * s > 0.03)]
    L[31 + o] = end(foot, 2, 1, 0.012)
    eye = pts(rf"^{side} vitreous body$").mean(0)
    L[2 if side == "left" else 5] = eye
    L[1 if side == "left" else 4] = eye + [-s * 0.014, 0, 0.004]
    L[3 if side == "left" else 6] = eye + [s * 0.016, 0, 0]
ear = pts(r"^External ear$")
L[7] = ear[ear[:, 0] > 0].mean(0); L[8] = ear[ear[:, 0] < 0].mean(0)
head = skin[skin[:, 1] > 1.45]
L[0] = end(head[np.abs(head[:, 0]) < 0.02], 2, 1, 0.004)
for i, s in ((9, 1), (10, -1)):
    y = L[0][1] - 0.045
    near = head[(np.abs(head[:, 1] - y) < 0.006) & (np.abs(head[:, 0] - s * 0.024) < 0.006)]
    L[i] = end(near, 2, 1, 0.003)

hipMid = (L[23] + L[24]) / 2; shMid = (L[11] + L[12]) / 2; earMid = (L[7] + L[8]) / 2
tipL = end(skin[(skin[:, 0] > 0.18) & (skin[:, 1] < 0.9)], 1, -1, 0.008)
tipR = end(skin[(skin[:, 0] < -0.18) & (skin[:, 1] < 0.9)], 1, -1, 0.008)
print("hipMid", hipMid.round(3), "shMid", shMid.round(3), "earMid", earMid.round(3), "nose", L[0].round(3))
print("L shoulder/elbow/wrist", L[11].round(3), L[13].round(3), L[15].round(3), "tip", tipL.round(3))
print("L hip/knee/ankle/heel/toe", L[23].round(3), L[25].round(3), L[27].round(3), L[29].round(3), L[31].round(3))

# ---------------- segments and the lines that "own" nearby tissue ----------------
SEG = ["pelvis", "chest", "head", "upperarm_L", "forearm_L", "hand_L", "upperarm_R", "forearm_R", "hand_R",
       "thigh_L", "shin_L", "foot_L", "thigh_R", "shin_R", "foot_R"]
up = np.array([0, 1, 0.0])
lumbarTop = np.array([0, 1.05, -0.03]); chestLow = np.array([0, 1.12, -0.02]); neckTop = np.array([0, 1.47, -0.03])
c3 = np.array([0, 1.50, -0.02]); crown = np.array([0, 1.66, -0.01])
R_ = {3: 0.04, 4: 0.035, 5: 0.02, 6: 0.04, 7: 0.035, 8: 0.02, 9: 0.06, 10: 0.04, 11: 0.03, 12: 0.06, 13: 0.04, 14: 0.03}
lines = {   # segment -> [(start, end, thickness)]
    0: [(L[23], L[24], 0.08), (hipMid, lumbarTop, 0.10)],
    1: [(chestLow, neckTop, 0.11), (L[11] * [0.8, 1, 1], L[12] * [0.8, 1, 1], 0.045)],
    2: [(c3, crown, 0.07), (L[7], L[8], 0.06)],
    3: [(L[11], L[13])], 4: [(L[13], L[15])], 5: [(L[15], tipL)],
    6: [(L[12], L[14])], 7: [(L[14], L[16])], 8: [(L[16], tipR)],
    9: [(L[23], L[25])], 10: [(L[25], L[27])], 11: [(L[29], L[31]), (L[27], (L[29] + L[31]) / 2)],
    12: [(L[24], L[26])], 13: [(L[26], L[28])], 14: [(L[30], L[32]), (L[28], (L[30] + L[32]) / 2)],
}
lines = {s: [l if len(l) == 3 else (*l, R_[s]) for l in ls] for s, ls in lines.items()}
ADJ = {(0, 1), (1, 2), (1, 3), (3, 4), (4, 5), (1, 6), (6, 7), (7, 8), (0, 9), (9, 10), (10, 11), (0, 12), (12, 13), (13, 14)}
ADJ |= {(b, a) for a, b in ADJ}
LEFT_LIMBS, RIGHT_LIMBS = {3, 4, 5, 9, 10, 11}, {6, 7, 8, 12, 13, 14}
AXIAL = [0, 1, 2]

# in the rest pose the arms hang beside the torso and thighs: an arm segment may not claim
# tissue that lies clearly on the body side of its bone (more than this many metres medial)
MEDIAL = {3: 0.045, 4: 0.045, 5: 0.07, 6: 0.045, 7: 0.045, 8: 0.07}

def seg_dist(V):
    """distance of each vertex to every segment, plus the direction from the nearest line point"""
    D = np.full((len(V), 15), 9.0); R = np.zeros((len(V), 15, 3))
    for s, ls in lines.items():
        for a, b, rad in ls:          # rad: rough thickness, so a wide torso wins tissue far from the spine
            ab = b - a; t = np.clip(((V - a) @ ab) / (ab @ ab), 0, 1)
            q = a + t[:, None] * ab; r = V - q; d = np.linalg.norm(r, axis=1) - rad
            if s in MEDIAL: d = np.where(np.abs(q[:, 0]) - np.abs(V[:, 0]) > MEDIAL[s], 9.0, d)
            # ...and the torso and thighs may not claim the hands and forearms hanging beside them
            if s in (9, 12): d = np.where(np.abs(V[:, 0]) - np.abs(q[:, 0]) > 0.12, 9.0, d)
            if s == 0: d = np.where(np.abs(V[:, 0]) > 0.19, 9.0, d)
            if s == 1: d = np.where((np.abs(V[:, 0]) > 0.19) & (V[:, 1] < 1.30), 9.0, d)
            better = d < D[:, s]
            D[better, s] = d[better]
            R[better, s] = r[better] / np.maximum(np.linalg.norm(r[better], axis=1, keepdims=True), 1e-9)
    return D, R

def normals(P, I):
    n = np.zeros_like(P)
    f = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
    for k in range(3): np.add.at(n, I[:, k], f)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

BAND = 0.055
for p in parts:
    if p["layer"] == "skin": continue              # skin is done last, from the tissue right beneath it
    V, layer, name = p["P"], p["layer"], p["name"]
    D, R = seg_dist(V)
    allowed = np.ones(15, bool)
    cx = V[:, 0].mean()                             # side from the geometry (a few source names are mirrored)
    if cx > 0.04: allowed[list(RIGHT_LIMBS)] = False
    if cx < -0.04: allowed[list(LEFT_LIMBS)] = False
    if layer == "organs" or (layer == "nerves" and p["system"] == "sensory"): allowed[:] = False; allowed[AXIAL] = True
    if re.search(r"cerebr|cerebell|brain|midbrain|pons|medulla|fornix|thalam|ventricle of brain|hemisphere", name, re.I) and layer == "nerves":
        allowed[:] = False; allowed[2] = True
    D[:, ~allowed] = 9.0
    if layer == "muscles":
        dot = np.einsum("vsk,vk->vs", R, normals(V, p["I"].astype(np.int64)))
        D = D * np.where(dot < -0.25, 3.0, 1.0)
    near = D.argmin(1)
    if layer == "skeleton":                         # bones are rigid: the whole part follows one segment
        s = np.bincount(near, minlength=15).argmax()
        p["s0"] = np.full(len(V), s); p["s1"] = np.full(len(V), s); p["w"] = np.ones(len(V)); continue
    if layer != "skin":                             # soft tissue: only the segments this part mostly lies in
        votes = np.bincount(near, minlength=15) / len(V)
        keep = votes >= 0.08; keep[votes.argmax()] = True
        D[:, ~keep] = 9.0
    order = np.argsort(D, 1)
    s0, s1 = order[:, 0], order[:, 1]
    d0, d1 = np.take_along_axis(D, order[:, :1], 1)[:, 0], np.take_along_axis(D, order[:, 1:2], 1)[:, 0]
    adj = np.array([(a, b) in ADJ for a, b in zip(s0, s1)])
    w = 0.5 + 0.5 * smoothstep(0, BAND, d1 - d0)
    w[~adj] = 1.0; s1 = np.where(adj, s1, s0)
    p["s0"], p["s1"], p["w"] = s0, s1, w

# The skin is a thin double shell (inner and outer surface), so its normals can't tell inside
# from outside. Instead every skin vertex copies the binding of the muscles and bones nearest
# to it: lateral thigh skin then follows the thigh, not the hand hanging next to it.
from scipy.spatial import cKDTree
under = [p for p in parts if p["layer"] in ("muscles", "skeleton")]
UP = np.concatenate([p["P"] for p in under])
UW = np.zeros((len(UP), 15))
o = 0
for p in under:
    n = p["nv"]; r = np.arange(o, o + n)
    np.add.at(UW, (r, p["s0"]), p["w"]); np.add.at(UW, (r, p["s1"]), 1 - p["w"]); o += n
tree = cKDTree(UP)
for p in parts:
    if p["layer"] != "skin": continue
    d, j = tree.query(p["P"], k=12)
    wt = 1 / np.maximum(d, 0.002) ** 2
    acc = np.einsum("vk,vks->vs", wt, UW[j])
    order = np.argsort(-acc, 1); s0, s1 = order[:, 0], order[:, 1]
    a0 = np.take_along_axis(acc, order[:, :1], 1)[:, 0]; a1 = np.take_along_axis(acc, order[:, 1:2], 1)[:, 0]
    adj = np.array([(a, b) in ADJ for a, b in zip(s0, s1)])
    w = np.where(adj, a0 / np.maximum(a0 + a1, 1e-12), 1.0)
    p["s0"], p["s1"], p["w"] = s0, np.where(adj, s1, s0), w

# ---------------- clean-up: no triangle may span two segments that aren't joined ----------------
# (such a triangle would stretch across the screen as soon as the limbs move apart)
NEIGH = {s: {b for a, b in ADJ if a == s} for s in range(15)}
for p in parts:
    if p["layer"] == "skeleton": continue
    I = p["I"].astype(np.int64); E = np.concatenate([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]])
    ring = [[] for _ in range(p["nv"])]
    for x, y in E: ring[x].append(y); ring[y].append(x)
    s0, s1, w = p["s0"].copy(), p["s1"].copy(), p["w"].copy()
    for it in range(20):
        a, b = s0[E[:, 0]], s0[E[:, 1]]
        bad = (a != b) & ~np.array([(x, y) in ADJ for x, y in zip(a, b)])
        if not bad.any(): break
        for va, vb in E[bad]:
            sa, sb = s0[va], s0[vb]
            if sa == sb or (sa, sb) in ADJ: continue
            common = NEIGH[sa] & NEIGH[sb]
            if common and it > 6:                    # stubborn seam (e.g. between the thighs): hand it to the shared parent
                c = min(common); s0[[va, vb]] = c; s1[[va, vb]] = c; w[[va, vb]] = 1; continue
            for v in (va, vb):                       # otherwise each end follows the majority of its own neighbours
                m = np.bincount(s0[ring[v] + [v]], minlength=15).argmax()
                if m != s0[v]: s0[v] = m; s1[v] = m; w[v] = 1
    p["s0"], p["s1"], p["w"] = s0, s1, w

# ---------------- colour groups (one palette index per vertex) ----------------
GROUPS = ["bone", "cartilage", "tooth", "muscle", "tendon", "heart", "lung", "digestive", "liver", "urinary",
          "endocrine", "reproductive", "lymphatic", "brain", "nerve", "eye", "artery", "vein", "skin"]
def group(p):
    n, s, l = p["name"], p["system"], p["layer"]
    if l == "skeleton":
        if re.search(r"tooth", n, re.I): return "tooth"
        if re.search(r"cartilage|disk|ligament|membrane|tendon|raphe|meniscus|gingiva", n, re.I) or s == "connective": return "cartilage"
        return "bone"
    if l == "muscles": return "tendon" if re.search(r"tendon|tract|aponeurosis", n, re.I) else "muscle"
    if l == "vessels": return "artery" if s == "arterial" else "vein"
    if l == "skin": return "skin"
    if l == "nerves":
        if s == "sensory": return "eye"
        if re.search(r"cerebr|cerebell|brain|midbrain|pons|medulla|fornix|thalam|hemisphere|gyrus|lobe|nucleus|corpus|hippocamp", n, re.I): return "brain"
        return "nerve"
    if s == "cardiac": return "heart"
    if s == "respiratory": return "lung"
    if re.search(r"liver|hepat|gallbladder|bile", n, re.I): return "liver"
    return {"digestive": "digestive", "urinary": "urinary", "endocrine": "endocrine", "reproductive": "reproductive",
            "lymphatic": "lymphatic"}.get(s, "digestive")

# ---------------- labels: a handful of named places to point at ----------------
LABELS = [("Schedel", r"^(frontal|occipital|left parietal|right parietal) bone$", "skeleton"),
          ("Hersenen", r"white matter of (left|right) cerebral hemisphere", "nerves"),
          ("Kleine hersenen", r"^cerebellum$", "nerves"),
          ("Ruggenmerg", r"spinal cord", "nerves"),
          ("Hart", r".", "organs", "heart"),
          ("Longen", r".", "organs", "lung"),
          ("Lever", r".", "organs", "liver"),
          ("Maag", r"^stomach$", "organs"),
          ("Nieren", r"(left|right) kidney$", "organs"),
          ("Blaas", r"urinary bladder", "organs"),
          ("Wervelkolom", r"lumbar vertebra|thoracic vertebra", "skeleton"),
          ("Bekken", r"(left|right) hip bone|sacrum", "skeleton"),
          ("Ribbenkast", r"\brib\b|sternum|manubrium", "skeleton"),
          ("Opperarmbeen", r"^left humerus$", "skeleton"),
          ("Dijbeen", r"^left femur$", "skeleton"),
          ("Scheenbeen", r"^right tibia$", "skeleton"),
          ("Biceps", r"left biceps brachii", "muscles"),
          ("Quadriceps", r"right (rectus femoris|vastus)", "muscles"),
          ("Aorta", r"aorta", "vessels")]
labels = []
for lab in LABELS:
    t, rx, layer = lab[:3]
    sel = [p for p in parts if p["layer"] == layer and re.search(rx, p["name"], re.I) and (len(lab) < 4 or group(p) == lab[3])]
    if not sel: print("no label match", t); continue
    V = np.concatenate([p["P"] for p in sel]); S = np.concatenate([p["s0"] for p in sel])
    c = V.mean(0); s = int(np.bincount(S).argmax())
    labels.append({"t": t, "layer": layer, "p": [round(x, 4) for x in c], "seg": s})

# ---------------- pack ----------------
allP = np.concatenate([p["P"] for p in parts]); lo = allP.min(0); hi = allP.max(0); size = hi - lo
LAYERS = ["skeleton", "muscles", "organs", "nerves", "vessels", "skin"]
blob = bytearray(); layout = []
def put(a):
    while len(blob) % 4: blob.append(0)
    off = len(blob); blob.extend(a.tobytes()); return off
for layer in LAYERS:
    ps = [p for p in parts if p["layer"] == layer]
    P = np.concatenate([p["P"] for p in ps])
    q = np.round((P - lo) / size * 65535).astype(np.uint16)
    sk = np.stack([np.concatenate([p["s0"] for p in ps]), np.concatenate([p["s1"] for p in ps]),
                   np.round(np.concatenate([p["w"] for p in ps]) * 255),
                   np.concatenate([np.full(p["nv"], GROUPS.index(group(p))) for p in ps])], 1).astype(np.uint8)
    idx = np.concatenate([p["I"].ravel() for p in ps]).astype(np.uint16)
    assert max(p["nv"] for p in ps) < 65536
    counts = np.array([[p["nv"], p["ni"]] for p in ps], np.uint32)
    layout.append({"name": layer, "nv": int(len(P)), "ni": int(len(idx)), "np": len(ps),
                   "offP": put(q), "offS": put(sk), "offI": put(idx), "offC": put(counts)})
gz = gzip.compress(bytes(blob), 9, mtime=0)
rest = {"landmarks": L.round(5).tolist(), "tipL": tipL.round(5).tolist(), "tipR": tipR.round(5).tolist()}
manifest = {"min": lo.round(6).tolist(), "size": size.round(6).tolist(), "layers": layout, "groups": GROUPS,
            "segments": SEG, "rest": rest, "labels": labels,
            "credit": "BodyParts3D, (c) The Database Center for Life Science, CC BY 4.0. Simplified and rigged for this app."}
out.mkdir(parents=True, exist_ok=True)
(out / "body.bin.gz").write_bytes(gz)
(out / "body.json").write_text(json.dumps(manifest, separators=(",", ":")))
print({l["name"]: (l["nv"], l["ni"] // 3) for l in layout}, "raw MB", round(len(blob) / 1e6, 2), "gz MB", round(len(gz) / 1e6, 2))
print("labels", [l["t"] for l in labels])
