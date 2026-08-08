/* Trennt echte Durchdringungskante von normaler Silhouettenkante. */
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

_resetAdler3DAssets();
const adler = new Adler3D(CONFIG.boss);
adler.root.position.set(0, CONFIG.boss.adlerY, 0);
adler._schlag = phi * GRAD;
adler._animieren(0, kackPose);
adler.root.updateMatrixWorld(true);

const armSet = new Set();
for (const { gruppe } of adler.schultern)
  for (const c of gruppe.children) if (c.isMesh && c.geometry.type === 'ExtrudeGeometry') armSet.add(c.id);
const faecherId = adler.schwanz.children[0].id;

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
    art: armSet.has(o.id) ? 'arm' : o.id === faecherId ? 'faecher' : 'rest',
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
const zentrum = new Vector3(0, CONFIG.boss.adlerY, 0);
const zuAdler = new Vector3().subVectors(zentrum, KAM);
const distanz = zuAdler.dot(vorn);
const wpp = (2 * distanz * tanH) / VP_H;
const HH = Math.round((CONFIG.boss.adlerHoehe * 1.15) / wpp);
const WW = Math.round((CONFIG.boss.adlerHoehe * adler.breiteJeHoehe * 1.1) / wpp);
const mitteX = zuAdler.dot(rechts);
const mitteY = zuAdler.dot(oben);

const px_arm = new Float64Array(WW * HH).fill(Infinity);
const px_fan = new Float64Array(WW * HH).fill(Infinity);
const px_rest = new Float64Array(WW * HH).fill(Infinity);

for (let py = 0; py < HH; py++) {
  for (let px = 0; px < WW; px++) {
    const sx = mitteX + (px - WW / 2) * wpp;
    const sy = mitteY - (py - HH / 2) * wpp;
    const dir = new Vector3()
      .copy(vorn)
      .multiplyScalar(distanz)
      .addScaledVector(rechts, sx)
      .addScaledVector(oben, sy)
      .normalize();
    const i = py * WW + px;
    for (const o of objekte) {
      if (!rayBox(KAM, dir, o.box)) continue;
      const ziel = o.art === 'arm' ? px_arm : o.art === 'faecher' ? px_fan : px_rest;
      for (const t of o.tris) {
        const d = rayTri(KAM, dir, t[0], t[1], t[2]);
        if (d !== null && d < ziel[i]) ziel[i] = d;
      }
    }
  }
}

/* Klassifikation je Pixel */
const KLASSE = new Uint8Array(WW * HH); // 0 leer, 1 arm vorn, 2 faecher vorn, 3 anderes Teil vorn
let nurArm = 0,
  nurFan = 0,
  beide = 0,
  beideArmVorn = 0,
  beideFanVorn = 0;
for (let i = 0; i < WW * HH; i++) {
  const a = px_arm[i],
    f = px_fan[i],
    r = px_rest[i];
  if (a === Infinity && f === Infinity) {
    KLASSE[i] = r === Infinity ? 0 : 3;
    continue;
  }
  const vorne = Math.min(a, f);
  if (r < vorne) {
    KLASSE[i] = 3;
  } else KLASSE[i] = a < f ? 1 : 2;
  if (a < Infinity && f < Infinity) {
    beide++;
    if (a < f) beideArmVorn++;
    else beideFanVorn++;
  } else if (a < Infinity) nurArm++;
  else nurFan++;
}

console.log(`Bild ${WW}x${HH}, 1 px = ${wpp.toFixed(5)} Welt-Einheiten (Adler = ${(CONFIG.boss.adlerHoehe / wpp).toFixed(0)} px hoch)`);
console.log(`Pixel mit Arm UND Faecher: ${beide}  (Arm vorn ${beideArmVorn}, Faecher vorn ${beideFanVorn})`);

/* Echte Durchdringungskante: benachbarte Pixel, BEIDE im Ueberlappungsgebiet,
 * aber unterschiedliche Reihenfolge -> die Flaechen kreuzen sich im Bild. */
let echt = 0,
  silhouette = 0;
const echteKanten = [];
const bothHit = (i) => px_arm[i] < Infinity && px_fan[i] < Infinity;
for (let py = 0; py < HH - 1; py++) {
  for (let px = 0; px < WW - 1; px++) {
    const i = py * WW + px;
    for (const j of [i + 1, i + WW]) {
      const ka = KLASSE[i],
        kb = KLASSE[j];
      if (!((ka === 1 && kb === 2) || (ka === 2 && kb === 1))) continue;
      if (bothHit(i) && bothHit(j)) {
        echt++;
        echteKanten.push([px, py]);
      } else silhouette++;
    }
  }
}
console.log(`Grenzpixel arm|faecher gesamt: ${echt + silhouette}`);
console.log(`  davon ECHTE Durchdringungskante (beide Pixel im Ueberlappungsgebiet): ${echt}`);
console.log(`  davon normale Silhouettenkante (ein Teil endet dort): ${silhouette}`);
if (echteKanten.length) {
  const xs = echteKanten.map((k) => k[0]);
  const ys = echteKanten.map((k) => k[1]);
  console.log(`  echte Kante in px-Box x[${Math.min(...xs)},${Math.max(...xs)}] y[${Math.min(...ys)},${Math.max(...ys)}]`);
}

/* Falschfarbenbild */
const rgb = Buffer.alloc(WW * HH * 3, 20);
for (let i = 0; i < WW * HH; i++) {
  let c = [20, 20, 24];
  if (KLASSE[i] === 1) c = bothHit(i) ? [255, 120, 40] : [150, 70, 25];
  else if (KLASSE[i] === 2) c = bothHit(i) ? [60, 255, 90] : [30, 120, 45];
  else if (KLASSE[i] === 3) c = [70, 70, 80];
  rgb[i * 3] = c[0];
  rgb[i * 3 + 1] = c[1];
  rgb[i * 3 + 2] = c[2];
}
for (const [x, y] of echteKanten) {
  const i = y * WW + x;
  rgb[i * 3] = 255;
  rgb[i * 3 + 1] = 255;
  rgb[i * 3 + 2] = 255;
}
await sharp(rgb, { raw: { width: WW, height: HH, channels: 3 } })
  .png()
  .toFile(`_klasse_phi${phi}_kp${kackPose}.png`);
console.log('geschrieben:', `_klasse_phi${phi}_kp${kackPose}.png`);
