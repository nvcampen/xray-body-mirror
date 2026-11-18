// MediaPipe Pose: 33 body points per video frame, in two flavours:
//  - image points (x, y in 0..1 of the picture), used for where things are on screen
//  - world points (metres, origin between the hips), used for depth
// plus a person mask, used to darken the real body so the anatomy reads clearly.
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = n => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${n}/float16/1/pose_landmarker_${n}.task`;

let vision = null, files = null;

export async function createPoseTracker(model = 'full') {
  if (!vision) {
    vision = await import(/* @vite-ignore */ MP + '/vision_bundle.mjs');
    files = await vision.FilesetResolver.forVisionTasks(MP + '/wasm');
  }
  const make = delegate => vision.PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: MODEL(model), delegate },
    runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: true,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  let pose;
  try { pose = await make('GPU'); } catch (e) { pose = await make('CPU'); }
  let last = -1;
  return {
    // returns null when nobody is in view
    detect(video, now) {
      if (video.readyState < 2 || video.currentTime === last) return undefined;   // no new frame yet
      last = video.currentTime;
      let out = null;
      pose.detectForVideo(video, now, res => {
        if (!res.landmarks?.length) return;
        const m = res.segmentationMasks?.[0];
        out = {
          img: res.landmarks[0].map(p => ({ x: p.x, y: p.y, z: p.z, v: p.visibility ?? 1 })),
          world: res.worldLandmarks[0].map(p => ({ x: p.x, y: p.y, z: p.z })),
          mask: m ? { w: m.width, h: m.height, data: m.getAsFloat32Array().slice() } : null,
        };
      });
      return out;
    },
    close() { pose.close(); },
  };
}

// One Euro filter: smooths jitter when still, stays responsive when moving fast
class OneEuro {
  constructor(minCut, beta) { this.minCut = minCut; this.beta = beta; this.x = null; this.dx = 0; }
  static a(cut, dt) { const r = 2 * Math.PI * cut * dt; return r / (r + 1); }
  filter(x, dt) {
    if (this.x === null) { this.x = x; return x; }
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.a(1, dt) * (dx - this.dx);
    const cut = this.minCut + this.beta * Math.abs(this.dx);
    this.x += OneEuro.a(cut, dt) * (x - this.x);
    return this.x;
  }
}

export class PoseSmoother {
  constructor() { this.reset(); }
  reset() { this.f = null; this.t = 0; }
  // steadiness 0..1: higher = calmer but more lag
  apply(pose, W, H, now, steadiness) {
    const dt = this.t ? Math.max(1 / 120, Math.min(0.2, (now - this.t) / 1000)) : 1 / 30;
    this.t = now;
    const minCut = 0.4 + (1 - steadiness) * 3.0;
    if (!this.f) this.f = pose.img.map(() => ({
      x: new OneEuro(minCut, 0.012), y: new OneEuro(minCut, 0.012),
      wx: new OneEuro(minCut, 2.5), wy: new OneEuro(minCut, 2.5), wz: new OneEuro(minCut * 0.6, 1.5),
    }));
    return pose.img.map((p, i) => {
      const f = this.f[i], w = pose.world[i];
      for (const k in f) f[k].minCut = k === 'wz' ? minCut * 0.6 : minCut;
      return {
        px: f.x.filter(p.x * W, dt), py: f.y.filter(p.y * H, dt), v: p.v,
        wx: f.wx.filter(w.x, dt), wy: f.wy.filter(w.y, dt), wz: f.wz.filter(w.z, dt),
      };
    });
  }
}
