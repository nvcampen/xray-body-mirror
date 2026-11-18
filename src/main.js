import * as THREE from 'three';
import { loadBodyData, buildBody, styleBody, LAYERS } from './body.js';
import { Rig, LM } from './rig.js';
import { createPoseTracker, PoseSmoother } from './tracker.js';
import { demoPose } from './demo.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), video = $('video'), shade = $('shade'), hud = $('hud'), statusEl = $('status'), fpsEl = $('fps');
const setStatus = (t, cls) => { statusEl.textContent = t; statusEl.className = cls || ''; };

// ------------------------------ settings ------------------------------
const DEFAULTS = { layers: { skeleton: true, muscles: false, organs: false, nerves: false, vessels: false, skin: true },
  style: 'xray', bright: 1, real: 0.3, dim: 0.35, steady: 0.5, labels: false, debug: false, model: 'full' };
let S = structuredClone(DEFAULTS);
try { const saved = JSON.parse(localStorage.getItem('xrb_settings') || 'null'); if (saved) S = { ...S, ...saved, layers: { ...S.layers, ...saved.layers } }; } catch (e) {}
const save = () => { try { localStorage.setItem('xrb_settings', JSON.stringify(S)); } catch (e) {} };

const checks = $('layerChecks');
for (const l of LAYERS) checks.insertAdjacentHTML('beforeend',
  `<label class="ck"><input type="checkbox" data-layer="${l.id}"><i style="background:${l.dot}"></i>${l.name}</label>`);

function syncUI() {
  checks.querySelectorAll('input').forEach(c => { c.checked = !!S.layers[c.dataset.layer]; });
  document.querySelectorAll('#style button').forEach(b => b.classList.toggle('on', b.dataset.style === S.style));
  for (const k of ['bright', 'real', 'dim', 'steady']) $(k).value = S[k];
  $('labels').checked = S.labels; $('debug').checked = S.debug; $('model').value = S.model;
}
function changed() { save(); syncUI(); if (body) styleBody(body, S); }

checks.addEventListener('change', e => { S.layers[e.target.dataset.layer] = e.target.checked; changed(); });
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
  const p = b.dataset.preset;
  for (const l of LAYERS) S.layers[l.id] = p === 'all' ? true : l.id === p || l.id === 'skin';
  changed();
});
document.querySelectorAll('#style button').forEach(b => b.onclick = () => { S.style = b.dataset.style; changed(); });
for (const k of ['bright', 'real', 'dim', 'steady']) $(k).oninput = e => { S[k] = +e.target.value; changed(); };
$('labels').onchange = e => { S.labels = e.target.checked; changed(); };
$('debug').onchange = e => { S.debug = e.target.checked; changed(); };
$('model').onchange = async e => { S.model = e.target.value; changed(); if (mode === 'camera') await loadTracker(); };
syncUI();

// ------------------------------ scene ------------------------------
let W = 1, H = 1, renderer, scene, cam, body, rig, labelPts = [];
const shadeCtx = shade.getContext('2d'), hudCtx = hud.getContext('2d');

function resize() {
  const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  for (const c of [shade, hud]) { c.width = W * dpr; c.height = H * dpr; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
  if (renderer) {
    renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
    Object.assign(cam, { left: 0, right: W, top: H, bottom: 0 }); cam.updateProjectionMatrix();
  }
}
new ResizeObserver(resize).observe(stage);

async function boot() {
  setStatus('Anatomie laden…');
  renderer = new THREE.WebGLRenderer({ canvas: $('gl'), alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(0, 1, 1, 0, -20000, 20000);   // one unit = one screen pixel
  const data = await loadBodyData();
  body = buildBody(data);
  scene.add(body.group);
  rig = new Rig(data.meta.rest.landmarks);
  labelPts = data.meta.labels.map(l => ({ ...l, v: new THREE.Vector3(...l.p) }));
  styleBody(body, S);
  resize();
  setStatus('Klaar. Start de camera of bekijk de demo.');
  requestAnimationFrame(frame);
}

// ------------------------------ tracking ------------------------------
let mode = 'idle', tracker = null, lostFrames = 0, lastPose = null, k = 0;
const smoother = new PoseSmoother();

async function loadTracker() {
  setStatus('Trackingmodel laden…');
  try { tracker?.close(); } catch (e) {}
  tracker = null;
  tracker = await createPoseTracker(S.model);
  setStatus('Camera actief. Ga volledig in beeld staan.', 'ok');
}

$('start').onclick = async () => {
  $('start').disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream; await video.play();
    stage.style.setProperty('--ar', (video.videoWidth / video.videoHeight).toFixed(4));
    video.hidden = false; $('intro').hidden = true; smoother.reset();
    mode = 'camera';
    await loadTracker();
  } catch (e) {
    console.error(e);
    setStatus(e.name === 'NotAllowedError' ? 'Geen toegang tot de camera. Sta het toe in je browser en probeer opnieuw.' : 'Starten mislukt: ' + e.message, 'bad');
    $('start').disabled = false;
  }
};
$('demo').onclick = () => { mode = 'demo'; video.hidden = true; $('intro').hidden = true; smoother.reset(); setStatus('Demo: het model beweegt zelf.', 'ok'); };

// screen-space points: x, y from the picture (pixels, y up), depth from the world points
const PAIRS = [[LM.L_SH, LM.R_SH], [LM.L_HIP, LM.R_HIP], [LM.L_SH, LM.L_HIP], [LM.R_SH, LM.R_HIP]];
function screenPoints(sm) {
  let a = 0, b = 0;
  for (const [i, j] of PAIRS) {
    if (Math.min(sm[i].v, sm[j].v) < 0.5) continue;
    a += Math.hypot(sm[i].px - sm[j].px, sm[i].py - sm[j].py);
    b += Math.hypot(sm[i].wx - sm[j].wx, sm[i].wy - sm[j].wy);
  }
  if (b > 1e-4) k = k ? k + (a / b - k) * 0.3 : a / b;
  return sm.map(p => new THREE.Vector3(p.px, H - p.py, -p.wz * (k || 500)));
}

function onPose(pose, now) {
  const u = body.shared.uVis.value;
  if (!pose) {
    if (++lostFrames > 6) { for (const s of rig.segs) s.vis *= 0.8; rig.segs.forEach((s, i) => { u[i] = s.vis; }); }
    if (lostFrames === 30 && mode === 'camera') setStatus('Niemand in beeld. Ga op 2 à 3 meter staan.', 'bad');
    return;
  }
  if (lostFrames >= 30 && mode === 'camera') setStatus('Camera actief.', 'ok');
  lostFrames = 0;
  const sm = smoother.apply(pose, W, H, now, S.steady);
  lastPose = { sm, mask: pose.mask };
  if (!rig.update(screenPoints(sm), sm.map(p => p.v))) return;
  rig.segs.forEach((s, i) => { body.shared.uSeg.value[i].copy(s.matrix); u[i] = s.vis; });
}

// ------------------------------ 2D layers ------------------------------
const maskCanvas = document.createElement('canvas'), maskCtx = maskCanvas.getContext('2d');
function drawShade() {
  shadeCtx.clearRect(0, 0, W, H);
  if (mode !== 'camera') return;
  if (S.dim > 0) { shadeCtx.fillStyle = `rgba(2,4,9,${S.dim})`; shadeCtx.fillRect(0, 0, W, H); }
  const m = lastPose?.mask;
  if (!m || S.real >= 1) return;
  const w = m.w >> 1, h = m.h >> 1;                        // half resolution is plenty for a soft veil
  if (maskCanvas.width !== w || maskCanvas.height !== h) { maskCanvas.width = w; maskCanvas.height = h; }
  const img = maskCtx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; d[o] = 4; d[o + 1] = 7; d[o + 2] = 13; d[o + 3] = m.data[(y * 2) * m.w + x * 2] * 255;
  }
  maskCtx.putImageData(img, 0, 0);
  shadeCtx.save(); shadeCtx.globalAlpha = (1 - S.real) * (1 - S.dim * 0.5); shadeCtx.filter = 'blur(5px)';
  shadeCtx.drawImage(maskCanvas, 0, 0, W, H); shadeCtx.restore();
}

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 17], [15, 19], [17, 19], [16, 18], [16, 20], [18, 20], [7, 8]];
const tmp = new THREE.Vector3();
function drawHud() {
  hudCtx.clearRect(0, 0, W, H);
  if (S.debug && lastPose) {
    const P = lastPose.sm, X = p => W - p.px;                // the picture is mirrored, the HUD is not
    hudCtx.strokeStyle = 'rgba(127,209,255,.7)'; hudCtx.lineWidth = 2;
    for (const [a, b] of BONES) if (P[a].v > 0.5 && P[b].v > 0.5) { hudCtx.beginPath(); hudCtx.moveTo(X(P[a]), P[a].py); hudCtx.lineTo(X(P[b]), P[b].py); hudCtx.stroke(); }
    hudCtx.fillStyle = '#7fd1ff';
    for (const p of P) if (p.v > 0.5) { hudCtx.beginPath(); hudCtx.arc(X(p), p.py, 3.5, 0, 7); hudCtx.fill(); }
  }
  if (!S.labels) return;
  hudCtx.font = '600 13px system-ui,Segoe UI,sans-serif'; hudCtx.textBaseline = 'middle';
  const boxes = [];
  for (const l of labelPts) {
    const seg = rig.segs[l.seg];
    if (!S.layers[l.layer] || seg.vis < 0.6) continue;
    tmp.copy(l.v).applyMatrix4(seg.matrix);
    const x = W - tmp.x, y = H - tmp.y, right = x > W / 2, tx = right ? x + 46 : x - 46;
    const tw = hudCtx.measureText(l.t).width, bx = right ? tx : tx - tw;
    if (boxes.some(b => bx < b[2] && bx + tw > b[0] && y - 9 < b[3] && y + 9 > b[1])) continue;
    boxes.push([bx - 4, y - 9, bx + tw + 4, y + 9]);
    hudCtx.strokeStyle = 'rgba(238,241,248,.55)'; hudCtx.lineWidth = 1;
    hudCtx.beginPath(); hudCtx.moveTo(x, y); hudCtx.lineTo(tx + (right ? -4 : 4), y); hudCtx.stroke();
    hudCtx.fillStyle = '#eef1f8'; hudCtx.beginPath(); hudCtx.arc(x, y, 3, 0, 7); hudCtx.fill();
    hudCtx.fillStyle = 'rgba(5,8,14,.75)'; hudCtx.fillRect(bx - 4, y - 9, tw + 8, 18);
    hudCtx.fillStyle = '#eef1f8'; hudCtx.textAlign = 'left'; hudCtx.fillText(l.t, bx, y + 0.5);
  }
}

// ------------------------------ main loop ------------------------------
let fpsT = 0, fpsN = 0, demoFreeze = null;   // demoFreeze: hold the demo at one moment (seconds), handy for testing
function frame(now) {
  requestAnimationFrame(frame);
  if (mode === 'camera' && tracker) {
    const r = tracker.detect(video, now);
    if (r !== undefined) onPose(r, now);
  } else if (mode === 'demo') {
    onPose(demoPose(body.meta.rest.landmarks, demoFreeze ?? now / 1000, W, H), now);
  }
  drawShade();
  renderer.render(scene, cam);
  drawHud();
  fpsN++;
  if (now - fpsT > 1000) { fpsEl.textContent = mode === 'idle' ? '' : `${Math.round(fpsN * 1000 / (now - fpsT))} fps`; fpsT = now; fpsN = 0; }
}

boot().catch(e => { console.error(e); setStatus('Laden mislukt: ' + e.message, 'bad'); });
window.__xrb = { get S() { return S; }, get rig() { return rig; }, freeze(t) { demoFreeze = t; } };   // handy in the browser console
