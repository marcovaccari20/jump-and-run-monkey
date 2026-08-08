/* Voller Sweep: schlimmster Fall der falsch sortierten Zone, inkl. Kurvenlage. */
import { Vector3, Box3 } from 'three';
import { Adler3D, _resetAdler3DAssets } from './src/entities/Adler3D.js';
import { CONFIG } from './src/config.js';

const GRAD = Math.PI / 180;
const KAM = new Vector3(...CONFIG.render.camera.position);
const BLICK = new Vector3(...CONFIG.render.camera.lookAt);
const FOV = CONFIG.render.camera.fov;

_resetAdler3DAssets();
const adler = new Adler3D(CONFIG.boss);
adler.root.position.set(0, CONFIG.boss.adlerY, 0);

const armSet = new Set();
for (const { gruppe } of adler.schultern)
  for (const c of gruppe.children) if (c.isMesh && c.geometry.type === 'ExtrudeGeometry') armSet.add(c.id);
const faecherId = adler.schwanz.children[0].id;

const meshes = [];
adler.root.traverse((o) => {
  if (o.isMesh)
    meshes.push({
      o,
      art: armSet.has(o.id) ? 'arm' : o.id === faecherId ? 'faecher' : 'rest',
    });
});

function trisOf(m) {
  const g = m.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const out = [];
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getX(i) : i;
    const ib = idx ? idx.getX(i + 1) : i + 1;
    const ic = idx ? idx.getX(i + 2) : i + 2;
    out.push([
      new Vector3().fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld),
      new Vector3().fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld),
      new Vector3().fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld),
    ]);
  }
  return out;
}
function rayTri(orig, dir, a, b, c) {
  const e1 = new Vector3().subVectors(b, a);
  const e2 = new Vector3().subVectors(c, a);
  const p = new Vector3().crossVectors(dir, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-15) return null;
  const inv = 1 / det;
  const t = new Vector3().subVectors(orig, a);
  const u = t.dot(p) * inv;
  if (u < 0 || u > 1) return null;
  const q = new Vector3().crossVectors(t, e1);
  const v = dir.dot(q) * inv;
  if (v < 0 || u + v > 1) return null;
  const d = e2.dot(q) * inv;
  return d > 0 ? d : null;
}
function rayBox(orig, dir, box) {
  let tmin = -Infinity,
    tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / dir[ax];
    let t1 = (box.min[ax] - orig[ax]) * inv;
    let t2 = (box.max[ax] - orig[ax]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return false;
  }
  return tmax > 0;
}

const vorn = new Vector3().subVectors(BLICK, KAM).normalize();
const rechts = new Vector3().crossVectors(vorn, new Vector3(0, 1, 0)).normalize();
const oben = new Vector3().crossVectors(rechts, vorn).normalize();
const VP_H = 1600;
const tanH = Math.tan((FOV / 2) * GRAD);
const zuAdler = new Vector3(0, CONFIG.boss.adlerY, 0).sub(KAM);
const distanz = zuAdler.dot(vorn);
const wpp = (2 * distanz * tanH) / VP_H;
const mitteX = zuAdler.dot(rechts);
const mitteY = zuAdler.dot(oben);

function messen(phi, kackPose, neigung) {
  adler._schlag = phi * GRAD;
  adler._animieren(0, kackPose);
  adler.figur.rotation.z = neigung;
  adler.figur.rotation.y = neigung * 0.55;
  adler.root.updateMatrixWorld(true);

  const gruppen = { arm: [], faecher: [], rest: [] };
  for (const { o, art } of meshes) gruppen[art].push(...trisOf(o));
  const boxen = {};
  for (const k of ['arm', 'faecher', 'rest']) {
    const b = new Box3();
    for (const t of gruppen[k]) for (const p of t) b.expandByPoint(p);
    boxen[k] = b;
  }
  // nur das Gebiet um den Faecher rastern
  const fb = boxen.faecher.clone().expandByScalar(0.05);
  const ecken = [];
  for (const x of [fb.min.x, fb.max.x])
    for (const y of [fb.min.y, fb.max.y])
      for (const z of [fb.min.z, fb.max.z]) {
        const v = new Vector3(x, y, z).sub(KAM);
        const t = v.dot(vorn);
        ecken.push([(v.dot(rechts) / t) * distanz, (v.dot(oben) / t) * distanz]);
      }
  const sx0 = Math.min(...ecken.map((e) => e[0]));
  const sx1 = Math.max(...ecken.map((e) => e[0]));
  const sy0 = Math.min(...ecken.map((e) => e[1]));
  const sy1 = Math.max(...ecken.map((e) => e[1]));
  const px0 = Math.floor((sx0 - mitteX) / wpp) - 2;
  const px1 = Math.ceil((sx1 - mitteX) / wpp) + 2;
  const py0 = Math.floor((mitteY - sy1) / wpp) - 2;
  const py1 = Math.ceil((mitteY - sy0) / wpp) + 2;
  const W = px1 - px0;
  const H = py1 - py0;

  const A = new Float64Array(W * H).fill(Infinity);
  const F = new Float64Array(W * H).fill(Infinity);
  const R = new Float64Array(W * H).fill(Infinity);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const sx = mitteX + (px0 + i) * wpp;
      const sy = mitteY - (py0 + j) * wpp;
      const dir = new Vector3()
        .copy(vorn)
        .multiplyScalar(distanz)
        .addScaledVector(rechts, sx)
        .addScaledVector(oben, sy)
        .normalize();
      const k = j * W + i;
      for (const [name, ziel] of [
        ['arm', A],
        ['faecher', F],
        ['rest', R],
      ]) {
        if (!rayBox(KAM, dir, boxen[name])) continue;
        for (const t of gruppen[name]) {
          const d = rayTri(KAM, dir, t[0], t[1], t[2]);
          if (d !== null && d < ziel[k]) ziel[k] = d;
        }
      }
    }
  }
  let fanVorn = 0,
    armVorn = 0;
  const maske = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    if (!(A[k] < Infinity && F[k] < Infinity)) continue;
    if (R[k] < Math.min(A[k], F[k])) continue;
    if (A[k] < F[k]) armVorn++;
    else {
      fanVorn++;
      maske[k] = 1;
    }
  }
  let maxDicke = 0;
  for (let i = 0; i < W; i++) {
    let d = 0;
    for (let j = 0; j < H; j++) if (maske[j * W + i]) d++;
    maxDicke = Math.max(maxDicke, d);
  }
  return { fanVorn, armVorn, maxDicke };
}

console.log(`Adler ${(CONFIG.boss.adlerHoehe / wpp).toFixed(0)} px hoch bei 900x1600-Viewport\n`);
let schlimmst = { fanVorn: -1 };
for (const neig of [-0.42, -0.28, -0.14, 0, 0.14, 0.28, 0.42]) {
  for (const kp of [0, 0.25, 0.5, 0.75, 1]) {
    let besteZeile = { fanVorn: -1 };
    for (let phi = 200; phi <= 340; phi += 5) {
      const r = messen(phi, kp, neig);
      if (r.fanVorn > besteZeile.fanVorn) besteZeile = { ...r, phi };
      if (r.fanVorn > schlimmst.fanVorn) schlimmst = { ...r, phi, kp, neig };
    }
    console.log(
      `neigung=${neig.toFixed(2)} kackPose=${kp}: schlimmste Phase phi=${besteZeile.phi} -> ` +
        `falsch sortiert ${besteZeile.fanVorn} px, max ${besteZeile.maxDicke} px dick`,
    );
  }
}
console.log('\nGLOBAL SCHLIMMSTER FALL:', JSON.stringify(schlimmst));
