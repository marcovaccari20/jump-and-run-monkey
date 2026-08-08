/* Wie stark weicht das gerenderte Bild von einer sauberen Ueberdeckung ab? */
import { Vector3, Box3 } from 'three';
import sharp from 'sharp';
import { Adler3D, _resetAdler3DAssets } from './src/entities/Adler3D.js';
import { CONFIG } from './src/config.js';

const GRAD = Math.PI / 180;
const KAM = new Vector3(...CONFIG.render.camera.position);
const BLICK = new Vector3(...CONFIG.render.camera.lookAt);
const FOV = CONFIG.render.camera.fov;

function messen(phi, kackPose, adlerHoehe) {
  _resetAdler3DAssets();
  const adler = new Adler3D(CONFIG.boss);
  if (adlerHoehe) adler.groesseSetzen(adlerHoehe);
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
    objekte.push({ art: armSet.has(o.id) ? 'arm' : o.id === faecherId ? 'faecher' : 'rest', tris, box });
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
  const H = Math.round((adler.hoehe * 1.15) / wpp);
  const W = Math.round((adler.hoehe * adler.breiteJeHoehe * 1.15) / wpp);
  const mitteX = zuAdler.dot(rechts);
  const mitteY = zuAdler.dot(oben);

  const A = new Float64Array(W * H).fill(Infinity);
  const F = new Float64Array(W * H).fill(Infinity);
  const R = new Float64Array(W * H).fill(Infinity);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const sx = mitteX + (px - W / 2) * wpp;
      const sy = mitteY - (py - H / 2) * wpp;
      const dir = new Vector3()
        .copy(vorn)
        .multiplyScalar(distanz)
        .addScaledVector(rechts, sx)
        .addScaledVector(oben, sy)
        .normalize();
      const i = py * W + px;
      for (const o of objekte) {
        if (!rayBox(KAM, dir, o.box)) continue;
        const ziel = o.art === 'arm' ? A : o.art === 'faecher' ? F : R;
        for (const t of o.tris) {
          const d = rayTri(KAM, dir, t[0], t[1], t[2]);
          if (d !== null && d < ziel[i]) ziel[i] = d;
        }
      }
    }
  }

  /* "Falsche" Pixel = im Ueberlappungsgebiet gewinnt der Faecher, obwohl der
   * Fluegel davor liegen muesste (bzw. umgekehrt) — das ist die kleinere der
   * beiden Mengen und damit die sichtbare Abweichung von einer sauberen
   * Ueberdeckung. Zusaetzlich muss das Teil ueberhaupt vorn sein (nicht vom
   * Rumpf verdeckt). */
  let armVorn = 0,
    fanVorn = 0;
  const fanVornMask = new Uint8Array(W * H);
  const armVornMask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!(A[i] < Infinity && F[i] < Infinity)) continue;
    if (R[i] < Math.min(A[i], F[i])) continue; // von Rumpf/Krallen verdeckt
    if (A[i] < F[i]) {
      armVorn++;
      armVornMask[i] = 1;
    } else {
      fanVorn++;
      fanVornMask[i] = 1;
    }
  }
  // Dicke der "falschen" Zone je Spalte
  let maxDicke = 0;
  const dicken = [];
  for (let px = 0; px < W; px++) {
    let d = 0;
    for (let py = 0; py < H; py++) if (fanVornMask[py * W + px]) d++;
    if (d) dicken.push(d);
    maxDicke = Math.max(maxDicke, d);
  }
  // Und die Gegenrichtung: wie dick ist die Zone, in der der Arm vorn liegt?
  let maxDickeArm = 0;
  for (let px = 0; px < W; px++) {
    let d = 0;
    for (let py = 0; py < H; py++) if (armVornMask[py * W + px]) d++;
    maxDickeArm = Math.max(maxDickeArm, d);
  }
  return {
    hoehePx: adler.hoehe / wpp,
    W,
    H,
    armVorn,
    fanVorn,
    maxDickeFan: maxDicke,
    maxDickeArm,
    mittlereDicke: dicken.length ? dicken.reduce((a, b) => a + b, 0) / dicken.length : 0,
    spalten: dicken.length,
  };
}

for (const [phi, kp, hoehe] of [
  [270, 0, null],
  [265, 0, null],
  [270, 0.5, null],
  [270, 1, null],
  [260, 1, null],
  [250, 1, null],
  [270, 1, 1.588], // im Hochformat schrumpft er auf 62 % der Feldbreite
]) {
  const r = messen(phi, kp, hoehe);
  console.log(
    `phi=${phi} kackPose=${kp}${hoehe ? ` hoehe=${hoehe}` : ''}: Adler ${r.hoehePx.toFixed(0)} px hoch | ` +
      `Ueberlappung ${r.armVorn + r.fanVorn} px (Arm vorn ${r.armVorn}, Faecher vorn ${r.fanVorn}) | ` +
      `falsche Zone max ${r.maxDickeFan} px dick, im Mittel ${r.mittlereDicke.toFixed(2)} px ueber ${r.spalten} Spalten`,
  );
}
