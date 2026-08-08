/* Echter Dreieck-gegen-Dreieck-Schnitt: Innenfluegel (arm) gegen Schwanzfaecher. */
import { Vector3, Matrix4, Box3 } from 'three';
import { Adler3D, _resetAdler3DAssets } from './src/entities/Adler3D.js';
import { CONFIG } from './src/config.js';

const GRAD = Math.PI / 180;

_resetAdler3DAssets();
const adler = new Adler3D(CONFIG.boss);

/* --- Meshes sauber trennen ---------------------------------------------- */
const teile = { arm: [], deck: [], hand: [], faecher: [adler.schwanz.children[0]] };
for (const { gruppe, seite } of adler.schultern) {
  for (const c of gruppe.children) {
    if (!c.isMesh) continue;
    // arm = ExtrudeGeometry (kein 'kugel'), deck = SphereGeometry
    if (c.geometry.type === 'ExtrudeGeometry') teile.arm.push(c);
    else teile.deck.push(c);
  }
}
for (const { gruppe } of adler.haende) for (const c of gruppe.children) if (c.isMesh) teile.hand.push(c);

for (const [n, l] of Object.entries(teile)) {
  const g = l[0].geometry;
  g.computeBoundingBox();
  const b = g.boundingBox;
  console.log(
    `${n}: ${l.length} Mesh(es), typ=${g.type}, verts=${g.attributes.position.count}, bbox=` +
      `x[${b.min.x.toFixed(4)},${b.max.x.toFixed(4)}] y[${b.min.y.toFixed(4)},${b.max.y.toFixed(4)}] z[${b.min.z.toFixed(4)},${b.max.z.toFixed(4)}]`,
  );
}

/* --- Dreieck-Dreieck-Schnitt (Moeller) ---------------------------------- */
function triTri(p0, p1, p2, q0, q1, q2) {
  const seg = triTriSeg(p0, p1, p2, q0, q1, q2);
  return seg;
}
function planeOf(a, b, c) {
  const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
  return { n, d: -n.dot(a) };
}
function dists(pl, a, b, c) {
  return [pl.n.dot(a) + pl.d, pl.n.dot(b) + pl.d, pl.n.dot(c) + pl.d];
}
/** Schnittsegment eines Dreiecks mit einer Ebene (nur wenn es sie kreuzt). */
function segOnPlane(pl, a, b, c) {
  const d = dists(pl, a, b, c);
  const eps = 1e-12;
  if ((d[0] > eps && d[1] > eps && d[2] > eps) || (d[0] < -eps && d[1] < -eps && d[2] < -eps))
    return null;
  const pts = [];
  const V = [a, b, c];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const di = d[i];
    const dj = d[j];
    if ((di > 0 && dj < 0) || (di < 0 && dj > 0)) {
      const t = di / (di - dj);
      pts.push(new Vector3().lerpVectors(V[i], V[j], t));
    } else if (Math.abs(di) <= eps) {
      pts.push(V[i].clone());
    }
  }
  if (pts.length < 2) return null;
  return [pts[0], pts[pts.length - 1]];
}
function inTri(p, a, b, c, n) {
  const t = new Vector3();
  const s1 = t.copy(b).sub(a).cross(new Vector3().subVectors(p, a)).dot(n);
  const s2 = new Vector3().subVectors(c, b).cross(new Vector3().subVectors(p, b)).dot(n);
  const s3 = new Vector3().subVectors(a, c).cross(new Vector3().subVectors(p, c)).dot(n);
  const eps = -1e-12;
  return (s1 >= eps && s2 >= eps && s3 >= eps) || (s1 <= -eps && s2 <= -eps && s3 <= -eps);
}
function triTriSeg(p0, p1, p2, q0, q1, q2) {
  const plP = planeOf(p0, p1, p2);
  const plQ = planeOf(q0, q1, q2);
  if (plP.n.lengthSq() < 1e-20 || plQ.n.lengthSq() < 1e-20) return null;
  const sQ = segOnPlane(plP, q0, q1, q2);
  const sP = segOnPlane(plQ, p0, p1, p2);
  if (!sQ || !sP) return null;
  // Beide Segmente liegen auf der Schnittgerade; ueberlappen sie?
  const dir = new Vector3().crossVectors(plP.n, plQ.n);
  if (dir.lengthSq() < 1e-20) return null;
  dir.normalize();
  const proj = (p) => dir.dot(p);
  let a0 = proj(sP[0]),
    a1 = proj(sP[1]);
  if (a0 > a1) [a0, a1] = [a1, a0];
  let b0 = proj(sQ[0]),
    b1 = proj(sQ[1]);
  if (b0 > b1) [b0, b1] = [b1, b0];
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  if (hi <= lo + 1e-9) return null;
  const basis = sP[0].clone().addScaledVector(dir, -proj(sP[0]));
  return [basis.clone().addScaledVector(dir, lo), basis.clone().addScaledVector(dir, hi)];
}

function trisOf(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const out = [];
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getX(i) : i;
    const ib = idx ? idx.getX(i + 1) : i + 1;
    const ic = idx ? idx.getX(i + 2) : i + 2;
    out.push([
      new Vector3().fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld),
      new Vector3().fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld),
      new Vector3().fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld),
    ]);
  }
  return out;
}

function pose(phiGrad, kackPose) {
  adler._schlag = phiGrad * GRAD;
  adler._animieren(0, kackPose);
  adler.root.updateMatrixWorld(true);
}

function schnitt(phiGrad, kackPose, welcheMeshes) {
  pose(phiGrad, kackPose);
  const fTris = trisOf(teile.faecher[0]);
  const fBox = new Box3();
  for (const t of fTris) for (const p of t) fBox.expandByPoint(p);
  const segs = [];
  for (const m of welcheMeshes) {
    const mTris = trisOf(m);
    for (const a of mTris) {
      const bb = new Box3().setFromPoints(a);
      if (!bb.intersectsBox(fBox)) continue;
      for (const b of fTris) {
        const bb2 = new Box3().setFromPoints(b);
        if (!bb.intersectsBox(bb2)) continue;
        const s = triTri(a[0], a[1], a[2], b[0], b[1], b[2]);
        if (s) segs.push(s);
      }
    }
  }
  return segs;
}

function laenge(segs) {
  let l = 0;
  for (const s of segs) l += s[0].distanceTo(s[1]);
  return l;
}

console.log('\n=== Innenfluegel (arm) gegen Faecher ===');
for (const kp of [0, 0.5, 1]) {
  for (let phi = 220; phi <= 320; phi += 10) {
    const s = schnitt(phi, kp, teile.arm);
    if (s.length)
      console.log(
        `kackPose=${kp} phi=${phi}: ${s.length} Segmente, Gesamtlaenge=${laenge(s).toFixed(4)} (Figureinheiten)`,
      );
  }
}

console.log('\n=== Deckfedern-Kugel gegen Faecher ===');
for (const kp of [0, 0.5, 1]) {
  for (let phi = 220; phi <= 320; phi += 10) {
    const s = schnitt(phi, kp, teile.deck);
    if (s.length)
      console.log(`kackPose=${kp} phi=${phi}: ${s.length} Segmente, Gesamtlaenge=${laenge(s).toFixed(4)}`);
  }
}

console.log('\n=== Handfluegel gegen Faecher ===');
let handTreffer = 0;
for (const kp of [0, 0.5, 1]) {
  for (let phi = 0; phi < 360; phi += 10) {
    const s = schnitt(phi, kp, teile.hand);
    if (s.length) {
      handTreffer++;
      console.log(`kackPose=${kp} phi=${phi}: ${s.length} Segmente`);
    }
  }
}
if (!handTreffer) console.log('nie');

console.log('\n=== voller Sweep arm x faecher ===');
let best = { len: 0 };
for (let phi = 0; phi < 360; phi += 5) {
  for (let kp = 0; kp <= 1.001; kp += 0.1) {
    const s = schnitt(phi, kp, teile.arm);
    const l = laenge(s);
    if (l > best.len) best = { len: l, phi, kp, segs: s };
  }
}
console.log(`groesster Schnitt: phi=${best.phi} kackPose=${best.kp?.toFixed(2)} Laenge=${best.len.toFixed(4)}`);
if (best.segs) {
  const box = new Box3();
  for (const s of best.segs) {
    box.expandByPoint(s[0]);
    box.expandByPoint(s[1]);
  }
  console.log('Schnittkurve Weltbox:', JSON.stringify(box).replace(/"/g, ''));
}
