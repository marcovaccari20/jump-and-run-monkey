/* Sichtbarkeit der Schnittkurve Innenfluegel x Schwanzfaecher aus der SPIELKAMERA. */
import { Vector3, Matrix4, Box3 } from 'three';
import { Adler3D, _resetAdler3DAssets } from './src/entities/Adler3D.js';
import { CONFIG } from './src/config.js';

const GRAD = Math.PI / 180;
const KAM = new Vector3(...CONFIG.render.camera.position);

_resetAdler3DAssets();
const adler = new Adler3D(CONFIG.boss);
adler.y = CONFIG.boss.adlerY;
adler.root.position.set(0, CONFIG.boss.adlerY, 0);

/* --- alle Meshes mit Namen ---------------------------------------------- */
const alle = [];
adler.root.traverse((o) => {
  if (o.isMesh) alle.push(o);
});
const arm = [];
const faecher = [adler.schwanz.children[0]];
for (const { gruppe } of adler.schultern)
  for (const c of gruppe.children) if (c.isMesh && c.geometry.type === 'ExtrudeGeometry') arm.push(c);
console.log('Meshes gesamt:', alle.length, '| arm:', arm.length, '| faecher:', faecher.length);

function pose(phiGrad, kackPose) {
  adler._schlag = phiGrad * GRAD;
  adler._animieren(0, kackPose);
  adler.root.updateMatrixWorld(true);
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

/* --- Moeller-Trumbore --------------------------------------------------- */
function rayTri(orig, dir, a, b, c) {
  const e1 = new Vector3().subVectors(b, a);
  const e2 = new Vector3().subVectors(c, a);
  const p = new Vector3().crossVectors(dir, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const t = new Vector3().subVectors(orig, a);
  const u = t.dot(p) * inv;
  if (u < 0 || u > 1) return null;
  const q = new Vector3().crossVectors(t, e1);
  const v = dir.dot(q) * inv;
  if (v < 0 || u + v > 1) return null;
  const dist = e2.dot(q) * inv;
  return dist;
}

/* --- Dreieck-Dreieck (wie zuvor) ---------------------------------------- */
function planeOf(a, b, c) {
  const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
  return { n, d: -n.dot(a) };
}
function segOnPlane(pl, a, b, c) {
  const d = [pl.n.dot(a) + pl.d, pl.n.dot(b) + pl.d, pl.n.dot(c) + pl.d];
  const eps = 1e-13;
  if ((d[0] > eps && d[1] > eps && d[2] > eps) || (d[0] < -eps && d[1] < -eps && d[2] < -eps)) return null;
  const V = [a, b, c];
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if ((d[i] > 0 && d[j] < 0) || (d[i] < 0 && d[j] > 0))
      pts.push(new Vector3().lerpVectors(V[i], V[j], d[i] / (d[i] - d[j])));
    else if (Math.abs(d[i]) <= eps) pts.push(V[i].clone());
  }
  return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : null;
}
function triTri(p, q) {
  const plP = planeOf(...p);
  const plQ = planeOf(...q);
  if (plP.n.lengthSq() < 1e-22 || plQ.n.lengthSq() < 1e-22) return null;
  const sQ = segOnPlane(plP, ...q);
  const sP = segOnPlane(plQ, ...p);
  if (!sQ || !sP) return null;
  const dir = new Vector3().crossVectors(plP.n, plQ.n);
  if (dir.lengthSq() < 1e-22) return null;
  dir.normalize();
  const pr = (x) => dir.dot(x);
  let [a0, a1] = [pr(sP[0]), pr(sP[1])];
  if (a0 > a1) [a0, a1] = [a1, a0];
  let [b0, b1] = [pr(sQ[0]), pr(sQ[1])];
  if (b0 > b1) [b0, b1] = [b1, b0];
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  if (hi <= lo + 1e-9) return null;
  const basis = sP[0].clone().addScaledVector(dir, -pr(sP[0]));
  return [basis.clone().addScaledVector(dir, lo), basis.clone().addScaledVector(dir, hi)];
}

function schnittkurve(phi, kp) {
  pose(phi, kp);
  const f = trisOf(faecher[0]);
  const fBox = new Box3();
  for (const t of f) for (const p of t) fBox.expandByPoint(p);
  const segs = [];
  for (const m of arm) {
    for (const a of trisOf(m)) {
      const bb = new Box3().setFromPoints(a);
      if (!bb.intersectsBox(fBox)) continue;
      for (const b of f) {
        if (!bb.intersectsBox(new Box3().setFromPoints(b))) continue;
        const s = triTri(a, b);
        if (s) segs.push(s);
      }
    }
  }
  return segs;
}

/** Wie viele Flaechen liegen zwischen Punkt und Kamera? */
function verdeckt(p, alleTris) {
  const dir = new Vector3().subVectors(KAM, p);
  const maxT = dir.length();
  dir.normalize();
  const orig = p.clone().addScaledVector(dir, 2e-5);
  let n = 0;
  const treffer = [];
  for (const [name, tris] of alleTris) {
    for (const t of tris) {
      const d = rayTri(orig, dir, t[0], t[1], t[2]);
      if (d !== null && d > 1e-6 && d < maxT) {
        n++;
        treffer.push(name);
      }
    }
  }
  return { n, treffer };
}

function analyse(phi, kp) {
  const segs = schnittkurve(phi, kp);
  if (!segs.length) return null;
  // Alle Meshes des Adlers als Verdecker
  const alleTris = [];
  for (const m of alle) alleTris.push([m.geometry.type + '@' + m.id, trisOf(m)]);

  let sichtbar = 0;
  let gesamt = 0;
  let laengeSichtbar = 0;
  let laenge = 0;
  const verdeckerZaehler = {};
  for (const s of segs) {
    // 5 Proben je Segment
    const l = s[0].distanceTo(s[1]);
    laenge += l;
    for (let i = 0; i < 5; i++) {
      const p = new Vector3().lerpVectors(s[0], s[1], (i + 0.5) / 5);
      const r = verdeckt(p, alleTris);
      gesamt++;
      if (r.n === 0) {
        sichtbar++;
        laengeSichtbar += l / 5;
      } else {
        for (const t of new Set(r.treffer)) verdeckerZaehler[t] = (verdeckerZaehler[t] || 0) + 1;
      }
    }
  }
  return { segs: segs.length, gesamt, sichtbar, laenge, laengeSichtbar, verdeckerZaehler };
}

for (const [phi, kp] of [
  [270, 0],
  [260, 0],
  [270, 0.5],
  [260, 1],
  [270, 1],
  [250, 1],
  [290, 1],
]) {
  const r = analyse(phi, kp);
  if (!r) {
    console.log(`phi=${phi} kackPose=${kp}: kein Schnitt`);
    continue;
  }
  console.log(
    `phi=${phi} kackPose=${kp}: Schnittkurve ${r.laenge.toFixed(3)} lang, ` +
      `sichtbare Proben ${r.sichtbar}/${r.gesamt}, sichtbare Laenge ${r.laengeSichtbar.toFixed(4)}`,
  );
  if (r.sichtbar === 0) console.log('   -> vollstaendig verdeckt von:', JSON.stringify(r.verdeckerZaehler));
}
