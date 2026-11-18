// Turns 33 tracked body points into one transform per body segment.
// Each segment has a frame (origin + two directions) that we can build both on the
// anatomy model at rest and on the tracked person; the difference between the two
// frames is the transform that moves the model's tissue onto the person.
import * as THREE from 'three';

export const LM = {
  NOSE: 0, L_EAR: 7, R_EAR: 8, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_PI: 17, R_PI: 18, L_IN: 19, R_IN: 20, L_TH: 21, R_TH: 22, L_HIP: 23, R_HIP: 24,
  L_KN: 25, R_KN: 26, L_AN: 27, R_AN: 28, L_HE: 29, R_HE: 30, L_FI: 31, R_FI: 32,
};
const L = LM;

export const SEGMENTS = ['pelvis', 'chest', 'head', 'upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];

const v3 = () => new THREE.Vector3();
const mid = (a, b) => v3().addVectors(a, b).multiplyScalar(0.5);
const sub = (a, b) => v3().subVectors(a, b);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// direction across a bendable joint: follows the child bone once the joint is clearly bent,
// otherwise a direction taken from the torso (so a straight limb still has a sensible roll)
function bendRef(a, b, c, fallback, atRest) {
  const u = sub(b, a).normalize(), ch = sub(c, b).normalize();
  const fb = fallback.clone().addScaledVector(u, -u.dot(fallback));
  if (fb.lengthSq() < 1e-8) fb.set(0, 0, 1);
  fb.normalize();
  if (atRest) return fb;
  const perp = ch.clone().addScaledVector(u, -u.dot(ch));
  const t = perp.lengthSq() > 1e-6 ? smooth(0.35, 0.85, Math.acos(Math.min(1, Math.max(-1, u.dot(ch))))) : 0;
  const out = fb.multiplyScalar(1 - t).addScaledVector(perp.normalize(), t);
  return out.lengthSq() < 1e-8 ? fb : out.normalize();
}

function torso(g) {
  const hip = mid(g(L.L_HIP), g(L.R_HIP)), sh = mid(g(L.L_SH), g(L.R_SH)), up = sub(sh, hip);
  return {
    hip, sh, up,
    chestFwd: v3().crossVectors(sub(g(L.L_SH), g(L.R_SH)), up).normalize(),
    pelvisFwd: v3().crossVectors(sub(g(L.L_HIP), g(L.R_HIP)), up).normalize(),
  };
}

function limbDefs(S) {          // S = 'L' or 'R'
  const SH = L[S + '_SH'], EL = L[S + '_EL'], WR = L[S + '_WR'], PI = L[S + '_PI'], IN = L[S + '_IN'];
  const HIP = L[S + '_HIP'], KN = L[S + '_KN'], AN = L[S + '_AN'], HE = L[S + '_HE'], FI = L[S + '_FI'];
  return {
    arm: [
      { o: g => g(SH), u: g => sub(g(EL), g(SH)), v: (g, t, r) => bendRef(g(SH), g(EL), g(WR), t.chestFwd, r), axial: [SH, EL], lm: [SH, EL] },
      { o: g => g(EL), u: g => sub(g(WR), g(EL)), v: g => sub(g(IN), g(PI)), axial: [EL, WR], lm: [EL, WR] },
      { o: g => g(WR), u: g => sub(mid(g(IN), g(PI)), g(WR)), v: g => sub(g(IN), g(PI)), axial: null, lm: [WR, IN, PI] },
    ],
    leg: [
      { o: g => g(HIP), u: g => sub(g(KN), g(HIP)), v: (g, t, r) => bendRef(g(HIP), g(KN), g(AN), t.pelvisFwd.clone().negate(), r), axial: [HIP, KN], lm: [HIP, KN] },
      { o: g => g(KN), u: g => sub(g(AN), g(KN)), v: g => sub(g(FI), g(HE)), axial: [KN, AN], lm: [KN, AN] },
      { o: g => g(AN), u: g => sub(g(FI), g(HE)), v: g => sub(g(KN), g(AN)), axial: null, lm: [AN, HE, FI] },
    ],
  };
}
const Ls = limbDefs('L'), Rs = limbDefs('R');
const DEFS = [
  { o: (g, t) => t.hip, u: g => sub(g(L.L_HIP), g(L.R_HIP)), v: (g, t) => t.up, axial: null, lm: [L.L_HIP, L.R_HIP] },
  { o: (g, t) => t.sh, u: g => sub(g(L.L_SH), g(L.R_SH)), v: (g, t) => t.up, axial: null, lm: [L.L_SH, L.R_SH] },
  { o: g => mid(g(L.L_EAR), g(L.R_EAR)), u: g => sub(g(L.L_EAR), g(L.R_EAR)), v: g => sub(g(L.NOSE), mid(g(L.L_EAR), g(L.R_EAR))), axial: null, lm: [L.L_EAR, L.R_EAR, L.NOSE] },
  ...Ls.arm, ...Rs.arm, ...Ls.leg, ...Rs.leg,
];
// pairs used to measure how big the person is on screen compared with the model
const SIZE_PAIRS = [[L.L_SH, L.R_SH], [L.L_HIP, L.R_HIP], [L.L_SH, L.L_HIP], [L.R_SH, L.R_HIP], [L.L_EAR, L.R_EAR]];

function basis(u, v, m) {
  const a = u.clone().normalize();
  const b = v.clone().addScaledVector(a, -a.dot(v));
  if (b.lengthSq() < 1e-10) {                 // v was parallel to u: pick any perpendicular
    b.set(a.y, -a.x, 0);
    if (b.lengthSq() < 1e-10) b.set(0, a.z, -a.y);
  }
  b.normalize();
  const c = v3().crossVectors(a, b);
  return m.makeBasis(a, b, c);
}

export class Rig {
  constructor(restLandmarks) {
    this.rest = restLandmarks.map(p => new THREE.Vector3(...p));
    const g = i => this.rest[i], t = torso(g);
    this.segs = DEFS.map(def => {
      const B = basis(def.u(g, t), def.v(g, t, true), new THREE.Matrix4());
      const o = def.o(g, t);
      const restInv = B.clone().transpose().multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
      const restLen = def.axial ? g(def.axial[0]).distanceTo(g(def.axial[1])) : 0;
      return { def, restInv, restLen, matrix: new THREE.Matrix4(), vis: 0, ok: false };
    });
    this.restPairs = SIZE_PAIRS.map(([a, b]) => g(a).distanceTo(g(b)));
    this.scale = 0;
    this._B = new THREE.Matrix4(); this._S = new THREE.Matrix4(); this._T = new THREE.Matrix4();
  }

  // H: 33 points in screen space (pixels, y up, z toward the viewer); vis: 0..1 per point
  update(H, vis) {
    const g = i => H[i];
    let num = 0, den = 0;
    SIZE_PAIRS.forEach(([a, b], i) => { const w = Math.min(vis[a], vis[b]); if (w > 0.5) { num += w * H[a].distanceTo(H[b]); den += w * this.restPairs[i]; } });
    if (den > 0) { const s = num / den; this.scale = this.scale ? this.scale + (s - this.scale) * 0.35 : s; }
    if (!this.scale) return false;
    const sP = this.scale, t = torso(g);
    for (const seg of this.segs) {
      const d = seg.def, target = Math.min(...d.lm.map(i => vis[i])) > 0.5 ? 1 : 0;
      seg.vis += (target - seg.vis) * 0.25;
      const u = d.u(g, t);
      if (u.lengthSq() < 1e-6) continue;
      basis(u, d.v(g, t, false), this._B);
      let sA = sP;
      if (d.axial) sA = Math.min(1.5 * sP, Math.max(0.65 * sP, H[d.axial[0]].distanceTo(H[d.axial[1]]) / seg.restLen));
      this._S.makeScale(sA, sP, sP);
      const o = d.o(g, t);
      seg.matrix.makeTranslation(o.x, o.y, o.z).multiply(this._B).multiply(this._S).multiply(seg.restInv);
      seg.ok = true;
    }
    return true;
  }
}
