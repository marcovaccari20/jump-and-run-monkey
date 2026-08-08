/* CPU-Raster des Adlers aus der Spielkamera: welches Teil ist vorn? */
import { Vector3, Box3 } from 'three';
import sharp from 'sharp';
import { Adler3D, _resetAdler3DAssets } from './src/entities/Adler3D.js';
import { CONFIG } from './src/config.js';

const GRAD = Math.PI / 180;
const KAM = new Vector3(...CONFIG.render.camera.position);
const BLICK = new Vector3(...CONFIG.render.camera.lookAt);
const FOV = CONFIG.render.camera.fov;

const phi = Number(process.argv[2] ?? 270);
const kackPose = Number(process.argv[3] ?? 1);
const ZOOM = Number(process.argv[4] ?? 1);

_resetAdler3DAssets();
const adler = new Adler3D(CONFIG.boss);
adler.root.position.set(0, CONFIG.boss.adlerY, 0);
adler._schlag = phi * GRAD;
adler._animieren(0, kackPose);
adler.root.updateMatrixWorld(true);

/* --- Teile einsammeln ---------------------------------------------------- */
const armSet = new Set();
for (const { gruppe } of adler.schultern)
  for (const c of gruppe.children) if (c.isMesh && c.geometry.type === 'ExtrudeGeometry') armSet.add(c.id);
const faecherId = adler.schwanz.children[0].id;
const handSet = new Set();
for (const { gruppe } of adler.haende) for (const c of gruppe.children) if (c.isMesh) handSet.add(c.id);

const objekte = [];
adler.root.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const tris = [];
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getX(i) : i;
    const ib = idx ? idx.getX(i + 1) : i + 1;
    const ic = idx ? idx.getX(i + 2) : i + 2;
    tris.push([
      new Vector3().fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld),
      new Vector3().fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld),
      new Vector3().fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld),
    ]);
  }
  const box = new Box3();
  for (const t of tris) for (const p of t) box.expandByPoint(p);
  objekte.push({
    id: o.id,
    art: armSet.has(o.id) ? 'arm' : o.id === faecherId ? 'faecher' : handSet.has(o.id) ? 'hand' : 'rest',
    farbe: o.material.color.getHex(),
    tris,
    box,
  });
});

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
  return d > 0 ? { d, n: e1.cross(e2).normalize() } : null;
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

/* --- Kamerabasis --------------------------------------------------------- */
const vorn = new Vector3().subVectors(BLICK, KAM).normalize();
const rechts = new Vector3().crossVectors(vorn, new Vector3(0, 1, 0)).normalize();
const oben = new Vector3().crossVectors(rechts, vorn).normalize();

/* Bildgroesse wie ein 900x1600-Hochformat-Viewport (Handy) */
const VP_W = 900,
  VP_H = 1600;
const tanH = Math.tan((FOV / 2) * GRAD);

/* Ausschnitt: um den Adler herum */
const zentrum = new Vector3(0, CONFIG.boss.adlerY, 0);
const zuAdler = new Vector3().subVectors(zentrum, KAM);
const distanz = zuAdler.dot(vorn);
const weltProPixel = (2 * distanz * tanH) / VP_H;
const HH = Math.round((CONFIG.boss.adlerHoehe * 1.15) / weltProPixel / ZOOM);
const WW = Math.round((CONFIG.boss.adlerHoehe * adler.breiteJeHoehe * 1.1) / weltProPixel / ZOOM);
console.log(
  `phi=${phi} kackPose=${kackPose}  Bild ${WW}x${HH} px (1 px = ${(weltProPixel * ZOOM).toFixed(5)} Welt-Einheiten)`,
);
console.log(`Adler waere im 900x1600-Viewport ${(CONFIG.boss.adlerHoehe / weltProPixel).toFixed(0)} px hoch`);

const mitteX = zuAdler.dot(rechts);
const mitteY = zuAdler.dot(oben);

const rgb = Buffer.alloc(WW * HH * 3, 24);
const artMap = new Array(WW * HH).fill(null);
const licht = new Vector3(0.4, 0.8, 0.6).normalize();

let armVorn = 0,
  faecherVorn = 0,
  ueberlappung = 0;

for (let py = 0; py < HH; py++) {
  for (let px = 0; px < WW; px++) {
    const sx = mitteX + (px - WW / 2) * weltProPixel * ZOOM;
    const sy = mitteY - (py - HH / 2) * weltProPixel * ZOOM;
    const dir = new Vector3()
      .copy(vorn)
      .multiplyScalar(distanz)
      .addScaledVector(rechts, sx)
      .addScaledVector(oben, sy)
      .normalize();
    let best = null;
    let armT = Infinity,
      fanT = Infinity;
    for (const o of objekte) {
      if (!rayBox(KAM, dir, o.box)) continue;
      for (const t of o.tris) {
        const h = rayTri(KAM, dir, t[0], t[1], t[2]);
        if (!h) continue;
        if (o.art === 'arm') armT = Math.min(armT, h.d);
        if (o.art === 'faecher') fanT = Math.min(fanT, h.d);
        if (!best || h.d < best.d) best = { d: h.d, o, n: h.n };
      }
    }
    const i = py * WW + px;
    if (best) {
      artMap[i] = best.o.art;
      const lam = Math.abs(best.n.dot(licht)) * 0.75 + 0.35;
      const c = best.o.farbe;
      rgb[i * 3] = Math.min(255, ((c >> 16) & 255) * lam);
      rgb[i * 3 + 1] = Math.min(255, ((c >> 8) & 255) * lam);
      rgb[i * 3 + 2] = Math.min(255, (c & 255) * lam);
    }
    if (armT < Infinity && fanT < Infinity) {
      ueberlappung++;
      if (armT < fanT) armVorn++;
      else faecherVorn++;
    }
  }
}

console.log(
  `Pixel, in denen Arm UND Faecher getroffen werden: ${ueberlappung}` +
    `  davon Arm vorn: ${armVorn}, Faecher vorn: ${faecherVorn}`,
);

/* Sichtbare Schnittkante = benachbarte Ueberlappungs-Pixel mit unterschiedlicher
 * Vorn-Zuordnung, bei denen das vorderste Teil auch wirklich Arm oder Faecher ist. */
let kantenPixel = 0;
const kanten = [];
for (let py = 1; py < HH - 1; py++) {
  for (let px = 1; px < WW - 1; px++) {
    const i = py * WW + px;
    const a = artMap[i];
    if (a !== 'arm' && a !== 'faecher') continue;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      const j = (py + dy) * WW + (px + dx);
      const b = artMap[j];
      if ((a === 'arm' && b === 'faecher') || (a === 'faecher' && b === 'arm')) {
        kantenPixel++;
        kanten.push([px, py]);
      }
    }
  }
}
console.log(`Grenzpixel arm|faecher im Bild: ${kantenPixel}`);
if (kanten.length) {
  const xs = kanten.map((k) => k[0]);
  const ys = kanten.map((k) => k[1]);
  console.log(
    `  Grenze verlaeuft in px-Box x[${Math.min(...xs)},${Math.max(...xs)}] y[${Math.min(...ys)},${Math.max(...ys)}]`,
  );
}

const datei = `_render_phi${phi}_kp${kackPose}.png`;
await sharp(rgb, { raw: { width: WW, height: HH, channels: 3 } })
  .png()
  .toFile(datei);
console.log('geschrieben:', datei);
