// Step 2: simplify every part with a per-layer triangle budget.
// Usage: node simplify.mjs ATLAS_DIR layers.json OUT_DIR
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;

const [dir, layersFile, outDir] = process.argv.slice(2);
const atlas = JSON.parse(fs.readFileSync(path.join(dir, 'atlas.json'), 'utf8'));
const layers = JSON.parse(fs.readFileSync(layersFile, 'utf8'));
const bins = atlas.chunks.map(c => fs.readFileSync(path.join(dir, c.url.split('/').pop())));

// share of triangles kept per layer, and the smallest a part may become
const RATIO = { skeleton: 0.42, muscles: 0.26, organs: 0.30, nerves: 0.28, vessels: 0.16, skin: 0.9 };
const MIN_TRIS = { skeleton: 120, muscles: 80, organs: 60, nerves: 40, vessels: 24, skin: 2000 };

const parts = [], blobs = [];
let offset = 0, before = 0, after = 0;
for (const p of atlas.parts) {
  const b = bins[p.chunk], layer = layers[p.id];
  const pos = new Float32Array(b.buffer, b.byteOffset + p.positions, p.vertexCount * 3);
  const idx = new Uint32Array(b.buffer, b.byteOffset + p.indices, p.indexCount);
  // weld identical positions first so the simplifier sees one connected surface
  const map = new Map(), remap = new Uint32Array(p.vertexCount), wp = [];
  for (let i = 0; i < p.vertexCount; i++) {
    const k = pos[i * 3] + ',' + pos[i * 3 + 1] + ',' + pos[i * 3 + 2];
    let j = map.get(k);
    if (j === undefined) { j = wp.length / 3; map.set(k, j); wp.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    remap[i] = j;
  }
  const P = new Float32Array(wp), I = Uint32Array.from(idx, i => remap[i]);
  const tris = I.length / 3;
  const target = Math.min(tris, Math.max(MIN_TRIS[layer], Math.round(tris * RATIO[layer]))) * 3;
  let [S] = MeshoptSimplifier.simplify(I, P, 3, target, 0.02);
  if (S.length < 36) S = I;                                   // never let a part vanish
  const [rm, count] = MeshoptSimplifier.compactMesh(S);
  const outP = new Float32Array(count * 3);
  for (let o = 0; o < rm.length; o++) { const n = rm[o]; if (n !== 0xffffffff) outP.set(P.subarray(o * 3, o * 3 + 3), n * 3); }
  const outI = new Uint32Array(S);
  blobs.push(Buffer.from(outP.buffer), Buffer.from(outI.buffer));
  parts.push({ id: p.id, name: p.name, system: p.system, layer, nv: count, ni: outI.length, offP: offset, offI: offset + outP.byteLength });
  offset += outP.byteLength + outI.byteLength;
  before += tris; after += outI.length / 3;
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'simplified.bin'), Buffer.concat(blobs));
fs.writeFileSync(path.join(outDir, 'simplified.json'), JSON.stringify({ parts }));
const per = {};
for (const p of parts) per[p.layer] = (per[p.layer] || 0) + p.ni / 3;
console.log({ before, after, per, mb: (offset / 1e6).toFixed(1) });
