/* Prueft: schneidet der Innenfluegel (arm) beim Abschlag durch den Schwanzfaecher? */
import { Vector3, Matrix4 } from 'three';
import { Adler3D, _resetAdler3DAssets } from './src/entities/Adler3D.js';
import { CONFIG } from './src/config.js';

const GRAD = Math.PI / 180;

/* --- Polygon des Schwanzumrisses, 1:1 aus Adler3D.js nachgebaut ---------- */
function schwanzPoly() {
  const p = [];
  p.push([-0.1, 0.02]);
  p.push([-0.19, -0.36]);
  for (let i = 0; i < 4; i++) {
    const x = -0.19 + ((i + 1) * 0.38) / 4;
    p.push([x - 0.03, -0.32]);
    p.push([x, -0.37]);
  }
  p.push([0.19, -0.36]);
  p.push([0.1, 0.02]);
  return p;
}

function innen(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Abstand zum Polygonrand (positiv = innen). */
function randAbstand(poly, x, y) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - xi) * dx + (y - yi) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = xi + t * dx;
    const py = yi + t * dy;
    best = Math.min(best, Math.hypot(x - px, y - py));
  }
  return best;
}

const POLY = schwanzPoly();
const HALB_Z = 0.02 / 2 + 0.012; // Extrudetiefe/2 + Bevel = 0.022

_resetAdler3DAssets();
const adler = new Adler3D(CONFIG.boss);

// Meshes einsammeln
const armMeshes = [];
const handMeshes = [];
for (const { gruppe } of adler.schultern) {
  for (const c of gruppe.children) if (c.isMesh && c.geometry.attributes.position.count > 100) armMeshes.push(c);
}
for (const { gruppe } of adler.haende) {
  for (const c of gruppe.children) if (c.isMesh) handMeshes.push(c);
}
const faecher = adler.schwanz.children[0];

console.log('rohHoehe =', adler._rohHoehe.toFixed(4), ' figurScale =', (adler.hoehe / adler._rohHoehe).toFixed(4));
console.log('arm-Meshes:', armMeshes.length, 'Vertices je', armMeshes[0].geometry.attributes.position.count);
console.log('hand-Meshes:', handMeshes.length, 'Vertices je', handMeshes[0].geometry.attributes.position.count);

function pose(phiGrad, kackPose) {
  adler._schlag = phiGrad * GRAD;
  adler._animieren(0, kackPose);
  adler.root.updateMatrixWorld(true);
}

function test(phiGrad, kackPose, verbose = false) {
  pose(phiGrad, kackPose);
  const inv = new Matrix4().copy(faecher.matrixWorld).invert();
  const res = { arm: 0, hand: 0, maxTiefe: 0, minZbetrag: Infinity, bestPunkt: null, zNah: 0 };
  const v = new Vector3();
  for (const [name, liste] of [
    ['arm', armMeshes],
    ['hand', handMeshes],
  ]) {
    for (const m of liste) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(m.matrixWorld).applyMatrix4(inv);
        if (Math.abs(v.z) > HALB_Z) continue;
        res.zNah++;
        if (!innen(POLY, v.x, v.y)) continue;
        res[name]++;
        const d = randAbstand(POLY, v.x, v.y);
        if (d > res.maxTiefe) {
          res.maxTiefe = d;
          res.bestPunkt = [v.x, v.y, v.z, name];
        }
      }
    }
  }
  if (verbose) console.log(JSON.stringify(res));
  return res;
}

console.log('\n--- normaler Flug (kackPose = 0) ---');
for (let phi = 240; phi <= 300; phi += 5) {
  const r = test(phi, 0);
  console.log(
    `phi=${phi}  arm=${r.arm} hand=${r.hand}  zNah=${r.zNah}  maxTiefe=${r.maxTiefe.toFixed(4)}`,
  );
}

console.log('\n--- Kackpose = 1 ---');
for (let phi = 230; phi <= 310; phi += 5) {
  const r = test(phi, 1);
  console.log(
    `phi=${phi}  arm=${r.arm} hand=${r.hand}  zNah=${r.zNah}  maxTiefe=${r.maxTiefe.toFixed(4)}` +
      (r.bestPunkt ? `  @ ${r.bestPunkt.map((x) => (typeof x === 'number' ? x.toFixed(3) : x)).join(',')}` : ''),
  );
}

console.log('\n--- alle Phasen x alle kackPose, Maximum ---');
let schlimmst = { arm: -1 };
for (let phi = 0; phi < 360; phi += 2) {
  for (let kp = 0; kp <= 1.0001; kp += 0.05) {
    const r = test(phi, kp);
    if (r.arm + r.hand > (schlimmst.arm ?? 0) + (schlimmst.hand ?? 0)) {
      schlimmst = { ...r, phi, kp };
    }
  }
}
console.log(JSON.stringify(schlimmst));
