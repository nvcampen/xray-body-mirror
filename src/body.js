// Loads the packed anatomy (assets/body.json + assets/body.bin.gz) and builds one mesh per layer.
// Every vertex carries two segment numbers and a weight; the vertex shader blends those two
// segment transforms, so tissue that crosses a joint (skin, muscles, vessels) bends smoothly.
import * as THREE from 'three';

export const LAYERS = [
  { id: 'skeleton', name: 'Skelet', dot: '#bfe3ff', gain: 0.55 },
  { id: 'muscles', name: 'Spieren', dot: '#ff6b5e', gain: 0.32 },
  { id: 'organs', name: 'Organen', dot: '#ffc37a', gain: 0.5 },
  { id: 'nerves', name: 'Hersenen & zenuwen', dot: '#ffe66b', gain: 0.45 },
  { id: 'vessels', name: 'Bloedvaten', dot: '#ff4d4d', gain: 0.6 },
  { id: 'skin', name: 'Lichaamscontour', dot: '#6fb6ff', gain: 0.4 },
];

// x-ray colour and solid colour per tissue group (same order as body.json "groups")
const PALETTE = {
  bone: ['#bfe3ff', '#e9e2cf'], cartilage: ['#8fd3ff', '#c9d8d0'], tooth: ['#ffffff', '#f4f1e6'],
  muscle: ['#ff6b5e', '#b5453c'], tendon: ['#ffb3a6', '#d9c3b0'], heart: ['#ff4d6a', '#b03a44'],
  lung: ['#ff9fc0', '#d99aa6'], digestive: ['#ffc37a', '#c99a6a'], liver: ['#ff8a5c', '#8f3e2a'],
  urinary: ['#ffd27a', '#b47961'], endocrine: ['#ffe08a', '#c5a09a'], reproductive: ['#ffb0d0', '#bda098'],
  lymphatic: ['#9fffb0', '#879f7c'], brain: ['#ff9fc0', '#e2a39d'], nerve: ['#ffe66b', '#d8b565'],
  eye: ['#fff3a8', '#f4f4ee'], artery: ['#ff4040', '#c0392b'], vein: ['#4da3ff', '#3e6fa8'], skin: ['#6fb6ff', '#6fb6ff'],
};

const VERT = /* glsl */`
uniform mat4 uSeg[15];
uniform float uVis[15];
uniform vec3 uXray[19];
uniform vec3 uSolid[19];
uniform float uSolidMode;
attribute vec4 bind;            // segment a, segment b, weight of a (0..255), tissue group
varying vec3 vN;
varying vec3 vCol;
varying float vAlpha;
void main() {
  int a = int(bind.x + 0.5), b = int(bind.y + 0.5), gi = int(bind.w + 0.5);
  float w = bind.z / 255.0;
  mat4 M = uSeg[a] * w + uSeg[b] * (1.0 - w);
  vec4 p = M * vec4(position, 1.0);
  vN = normalize(mat3(M) * normal);
  vAlpha = uVis[a] * w + uVis[b] * (1.0 - w);
  vCol = uSolidMode > 0.5 ? uSolid[gi] : uXray[gi];
  gl_Position = projectionMatrix * viewMatrix * p;
}`;

const FRAG = /* glsl */`
uniform float uGain;
uniform float uSolidMode;
varying vec3 vN;
varying vec3 vCol;
varying float vAlpha;
void main() {
  if (vAlpha < 0.01) discard;
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float facing = abs(n.z);                       // the view looks straight down -z
  if (uSolidMode > 0.5) {
    float d = max(dot(n, normalize(vec3(0.35, 0.55, 1.0))), 0.0) * 0.7 + 0.3;
    gl_FragColor = vec4(vCol * d * uGain, vAlpha);
  } else {
    float rim = pow(1.0 - facing, 2.0);           // edges glow, like an x-ray of a curved surface
    gl_FragColor = vec4(vCol * (0.12 + 1.15 * rim) * uGain * vAlpha, 1.0);
  }
}`;

async function gunzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;            // the server already unpacked it
  const ds = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(ds).arrayBuffer();
}

export async function loadBodyData(base = 'assets/') {
  const inlineMeta = document.getElementById('bodymeta'), inlineData = document.getElementById('bodydata');
  if (inlineMeta && inlineData) {                              // single-file build: everything is in the page
    const bin = atob(inlineData.textContent.trim()), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { meta: JSON.parse(inlineMeta.textContent), buf: await gunzip(u8.buffer) };
  }
  const [meta, raw] = await Promise.all([
    fetch(base + 'body.json').then(r => r.json()),
    fetch(base + 'body.bin.gz').then(r => r.arrayBuffer()),
  ]);
  return { meta, buf: await gunzip(raw) };
}

export function buildBody({ meta, buf }) {
  const shared = {
    uSeg: { value: Array.from({ length: 15 }, () => new THREE.Matrix4()) },
    uVis: { value: new Float32Array(15) },
    uXray: { value: meta.groups.map(g => new THREE.Color(PALETTE[g][0])) },
    uSolid: { value: meta.groups.map(g => new THREE.Color(PALETTE[g][1])) },
  };
  const group = new THREE.Group();
  const meshes = {};
  for (const L of meta.layers) {
    const q = new Uint16Array(buf, L.offP, L.nv * 3), pos = new Float32Array(L.nv * 3);
    for (let i = 0; i < q.length; i++) pos[i] = meta.min[i % 3] + (q[i] / 65535) * meta.size[i % 3];
    const counts = new Uint32Array(buf, L.offC, L.np * 2), src = new Uint16Array(buf, L.offI, L.ni);
    const idx = new Uint32Array(L.ni);
    for (let p = 0, base = 0, k = 0; p < L.np; p++) {           // indices are stored per part; add each part's start
      const nv = counts[p * 2], ni = counts[p * 2 + 1];
      for (let j = 0; j < ni; j++, k++) idx[k] = src[k] + base;
      base += nv;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('bind', new THREE.BufferAttribute(new Uint8Array(buf, L.offS, L.nv * 4).slice(), 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const info = LAYERS.find(x => x.id === L.name);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uGain: { value: 1 }, uSolidMode: { value: 0 } },
      vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = L.name === 'skin' ? 10 : LAYERS.indexOf(info);
    group.add(mesh);
    meshes[L.name] = { mesh, info };
  }
  return { group, meshes, shared, meta };
}

// x-ray: light adds up, so the more layers are on, the less each one may add
export function styleBody(body, S) {
  const on = LAYERS.filter(l => l.id !== 'skin' && S.layers[l.id]).length;
  const share = 1 / (0.45 + 0.55 * Math.max(1, on));
  for (const { mesh, info } of Object.values(body.meshes)) {
    const solid = S.style === 'solid' && info.id !== 'skin', u = mesh.material.uniforms;
    mesh.visible = !!S.layers[info.id];
    u.uSolidMode.value = solid ? 1 : 0;
    u.uGain.value = solid ? 0.75 + 0.35 * S.bright : S.bright * info.gain * (info.id === 'skin' ? 1 : share) * 1.6;
    Object.assign(mesh.material, solid
      ? { depthTest: true, depthWrite: true, blending: THREE.NormalBlending }
      : { depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    mesh.material.needsUpdate = true;
  }
}
