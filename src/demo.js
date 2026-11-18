// Demo without a camera: moves the model's own rest skeleton through a few poses and
// hands the result to the same pipeline the camera uses, so you can test everything offline.
import * as THREE from 'three';
import { LM as L } from './rig.js';

const ARM = S => ({ all: [L[S + '_EL'], L[S + '_WR'], L[S + '_PI'], L[S + '_IN'], L[S + '_TH']], fore: [L[S + '_WR'], L[S + '_PI'], L[S + '_IN'], L[S + '_TH']] });
const LEG = S => ({ all: [L[S + '_KN'], L[S + '_AN'], L[S + '_HE'], L[S + '_FI']], shin: [L[S + '_AN'], L[S + '_HE'], L[S + '_FI']] });
const UPPER = Array.from({ length: 23 }, (_, i) => i);
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

function rot(P, ids, pivot, axis, ang) {
  if (!ang) return;
  const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
  for (const i of ids) P[i].sub(pivot).applyQuaternion(q).add(pivot);
}

// pose parameters (radians) for a moment in the 16-second loop
function keyframe(t) {
  const c = t % 16, k = { abdL: 0.15, abdR: 0.15, elL: 0.1, elR: 0.1, hipL: 0, hipR: 0, knL: 0, knR: 0, lean: 0, yaw: 0 };
  const a = ease(c / 2) * (1 - ease((c - 4) / 2));                 // 0-6 s: arms out
  k.abdL += a * 1.25; k.abdR += a * 1.25; k.elL += a * 0.9; k.elR += a * 0.9;
  const w = ease((c - 6) / 1.5) * (1 - ease((c - 9.5) / 1.5));      // 6-11 s: wave
  k.abdR += w * 2.4; k.elR += w * (0.9 + 0.5 * Math.sin(c * 7));
  const s = ease((c - 11) / 1.5) * (1 - ease((c - 14) / 1.5));      // 11-16 s: squat
  k.hipL += s * 1.1; k.hipR += s * 1.1; k.knL += s * 1.9; k.knR += s * 1.9; k.lean += s * 0.45;
  k.abdL += s * 0.2; k.abdR += s * 0.2; k.elL += s * 1.2; k.elR += s * 1.2;
  k.yaw = 0.5 * Math.sin(t * 0.45);
  return k;
}

export function demoPose(rest, t, W, H) {
  const P = rest.map(p => new THREE.Vector3(...p)), k = keyframe(t);
  const hip0 = P[L.L_HIP].clone().add(P[L.R_HIP]).multiplyScalar(0.5);
  const FEET = [L.L_HE, L.R_HE, L.L_FI, L.R_FI, L.L_AN, L.R_AN];
  const floor0 = Math.min(...FEET.map(i => P[i].y));
  for (const [S, sgn] of [['L', 1], ['R', -1]]) {
    const arm = ARM(S), leg = LEG(S);
    rot(P, arm.fore, P[L[S + '_EL']], X, -k['el' + S]);           // elbow bends forward
    rot(P, arm.all, P[L[S + '_SH']], Z, sgn * k['abd' + S]);       // arm lifts sideways
    rot(P, leg.shin, P[L[S + '_KN']], X, k['kn' + S]);             // knee bends backward
    rot(P, leg.all, P[L[S + '_HIP']], X, -k['hip' + S]);           // thigh lifts forward
  }
  rot(P, UPPER, hip0, X, k.lean);
  const floor = Math.min(...FEET.map(i => P[i].y));
  for (const p of P) p.y += floor0 - floor;                         // keep the feet on the floor
  rot(P, P.map((_, i) => i), hip0, Y, k.yaw);
  const hip = P[L.L_HIP].clone().add(P[L.R_HIP]).multiplyScalar(0.5);
  const s = (H * 0.86) / 1.75;
  return {
    img: P.map(p => ({ x: (W / 2 + p.x * s) / W, y: (H * 0.96 - p.y * s) / H, z: (-p.z * s) / W, v: 1 })),
    world: P.map(p => ({ x: p.x - hip.x, y: -(p.y - hip.y), z: -(p.z - hip.z) })),
    mask: null,
  };
}
