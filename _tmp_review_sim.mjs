/* TEMPORAER — Review-Messung. Loeschen nach dem Lauf. */
import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { DifficultyCurve } from './src/systems/DifficultyCurve.js';
import { Spawner } from './src/systems/Spawner.js';
import { halfWidthAt } from './src/core/viewport.js';
import { groessteSpriteBreite, spriteHoehe, Rock } from './src/entities/Rock.js';

const szene = { add() {} };

/* ---- ECHTE Bildmasse einspeisen (sonst faellt Rock auf 'prozedural' zurueck
 * und groessteSpriteBreite/spriteHoehe liefern falsche Zahlen) ---- */
import fs from 'node:fs';
import path from 'node:path';
function webpSize(file) {
  const b = fs.readFileSync(file);
  const fourcc = b.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  if (fourcc === 'VP8L') { const bits = b.readUInt32LE(21); return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }; }
  if (fourcc === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  return null;
}
const texturen = new Map();
for (const look of Object.values(CONFIG.rock.looks)) {
  for (const name of look.bilder ?? []) {
    if (!name) continue;
    const p = CONFIG.rock.spritePath.replace('{n}', name);
    if (texturen.has(p)) continue;
    const s = webpSize(path.join('public/hazards', name + '.webp'));
    texturen.set(p, { image: { width: s.w, height: s.h } });
  }
}

function spielfeld(aspect, halbeAffenBreite, pCfg) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const base = CONFIG.world;
  const affenHoehe = (pCfg.startPosition ?? CONFIG.player.startPosition)[1];
  const half = halfWidthAt(camera, 0, affenHoehe);
  const rand = Math.max(halbeAffenBreite, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - rand);
  const maxX = Math.min(base.bounds.maxX, limit);
  return {
    ...base,
    bounds: { minX: Math.max(base.bounds.minX, -limit), maxX, minY: base.bounds.minY, maxY: base.bounds.maxY },
    bahnX: base.bahnen.map((a) => a * maxX),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
  };
}

// geteilt-Map vorwaermen, damit groessteSpriteBreite/spriteHoehe die echten
// Bildmasse benutzen (wie im Browser nach dem Laden).
new Rock(0, CONFIG.rock, texturen);
console.log('groessteSpriteBreite =', groessteSpriteBreite(CONFIG.rock).toFixed(3));
for (const look of ['stein', 'holz', 'eiszapfen'])
  console.log(`  spriteHoehe ${look}:`, CONFIG.rock.types.map((t) => `${t.id}=${spriteHoehe(CONFIG.rock, look, t).toFixed(3)}`).join(' '));

const DT = 1 / 60;

function lauf({ aspect, look, sekunden, startWand, pCfg, halbeAffenBreite, label }) {
  const d = new DifficultyCurve(CONFIG.difficulty);
  d.setRockMix(CONFIG.rock.mix);
  d.elapsed = startWand * CONFIG.difficulty.sekundenProWand;
  const world = spielfeld(aspect, halbeAffenBreite, pCfg);
  const sp = new Spawner(szene, CONFIG, d, world, texturen, null, null);
  sp.setSpieler(pCfg);
  sp.hazardLook = look;
  sp.reset();
  sp.bananasEnabled = false;
  CONFIG.banana.spawnChance = 0; // nur Steine messen

  let versuche = 0, keinPlatz = 0, gewartet = 0, abgeworfen = 0;
  const origFrei = sp._freieStelle.bind(sp);
  sp._freieStelle = (t, r) => { versuche++; const x = origFrei(t, r); if (x === null) keinPlatz++; return x; };
  const origDarf = sp._darfFallen.bind(sp);
  sp._darfFallen = (v, h, m) => { const ok = origDarf(v, h, m); if (!ok) gewartet++; return ok; };
  const origAcq = sp.rocks.acquire.bind(sp.rocks);
  sp.rocks.acquire = () => { const r = origAcq(); if (r) abgeworfen++; return r; };

  let korrTempoSum = 0, frames = 0, aktivSum = 0;
  const n = Math.round(sekunden / DT);
  for (let i = 0; i < n; i++) {
    d.update(DT);
    korrTempoSum += sp.korridorTempo;
    sp.update(DT, false, d.scrollSpeed);
    aktivSum += sp.rocks.activeCount;
    frames++;
  }
  const soll = d.dichte;
  return {
    label, look,
    wand: d.wand.toFixed(2),
    tempo: d.tempo.toFixed(2),
    sollDichte: soll.toFixed(3),
    istDichte: (abgeworfen / sekunden).toFixed(3),
    versuche, keinPlatz,
    ausfall: versuche ? ((keinPlatz / versuche) * 100).toFixed(1) + '%' : '-',
    wartFrames: gewartet,
    korrTempo: (korrTempoSum / frames).toFixed(3),
    imBild: (aktivSum / frames).toFixed(2),
  };
}

const braun = { ...CONFIG.player, ...CONFIG.characters.list.braun.player, startPosition: CONFIG.player.startPosition };
const orange = { ...CONFIG.player, ...CONFIG.characters.list.orange.player, startPosition: CONFIG.player.startPosition };

const formate = [['hoch 390x844', 390 / 844, 1.400 / 2], ['quer 16:9', 16 / 9, 1.400 / 2]];
const looks = ['stein', 'holz', 'eiszapfen', 'kaktus', 'feuer'];

console.log('label            look        wand  tempo  sollD  istD   Versuche kPlatz Ausfall wartF korrT  imBild');
for (const [fname, aspect, hb] of formate) {
  for (const look of looks) {
    for (const w of [0, 6]) {
      const r = lauf({ aspect, look, sekunden: 400, startWand: w, pCfg: braun, halbeAffenBreite: hb, label: fname });
      console.log(
        `${fname.padEnd(14)} ${look.padEnd(10)} ${r.wand.padStart(5)} ${r.tempo.padStart(6)} ${r.sollDichte.padStart(6)} ${r.istDichte.padStart(6)} ${String(r.versuche).padStart(8)} ${String(r.keinPlatz).padStart(6)} ${r.ausfall.padStart(7)} ${String(r.wartFrames).padStart(6)} ${r.korrTempo.padStart(6)} ${r.imBild.padStart(6)}`,
      );
    }
  }
}

/* ---- Bahnabstand vs. mindestAbstand in _freieStelle ---- */
console.log('\n--- Bahnabstand vs. Sperrschwelle (rand + reserve) ---');
const groessterHit = Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
for (const [fname, aspect, hb] of formate) {
  for (const [cn, pc] of [['braun', braun], ['orange', orange], ['weiss', { ...CONFIG.player, ...CONFIG.characters.list.weiss.player, startPosition: CONFIG.player.startPosition }]]) {
    const w = spielfeld(aspect, cn === 'weiss' ? 1.25 * 0.5255 / 2 : hb, pc);
    const abst = w.bahnX[1] - w.bahnX[0];
    const schwelle = pc.hitRadius + groessterHit + CONFIG.rock.korridor.reserve;
    console.log(`${fname.padEnd(14)} ${cn.padEnd(7)} maxX ${w.bounds.maxX.toFixed(3)} Bahnabstand ${abst.toFixed(3)}  Schwelle ${schwelle.toFixed(3)}  ${abst < schwelle ? 'NACHBARN GESPERRT' : 'ok'}`);
    const maxSpanne = 2 * (w.bounds.maxX - (pc.hitRadius + groessterHit) - CONFIG.rock.korridor.reserve);
    console.log(`               maxSpanne = ${maxSpanne.toFixed(3)} ${maxSpanne <= 0 ? '<= 0  -> Korridor auf 0.05 eingefroren' : ''}`);
  }
}

/* ---- Sturzflug staerke ---- */
console.log('\n--- Sturzflug: staerke / gewaehlte Bahnen ---');
const s = CONFIG.sturzflug;
const spanne = Math.max(1, s.proGebiet.max - s.proGebiet.start);
const staerke = Math.min(1, (3 - s.proGebiet.start) / spanne);
console.log('proGebiet =', JSON.stringify(s.proGebiet));
console.log('spanne =', spanne, ' staerke =', staerke);
const erlaubt = Math.min(s.maxBahnen, Math.max(1, 3 - 1));
const anzahl = Math.max(1, Math.min(erlaubt, 1 + Math.floor(staerke * erlaubt)));
console.log('erlaubt =', erlaubt, ' anzahl =', anzahl, ' slice(0,anzahl).length =', [1, 2, 3].slice(0, anzahl).length);

/* ---- Bahnwechselzeit vs. Warnzeit ---- */
console.log('\n--- Bahnwechsel vs. Sturzflug-Warnzeit ---');
for (const [fname, aspect, hb] of formate) {
  for (const [cn, pc, verzug] of [['braun', braun, 0], ['orange', orange, CONFIG.characters.list.orange.wischVerzoegerung]]) {
    const w = spielfeld(aspect, hb, pc);
    const abst = w.bahnX[1] - w.bahnX[0];
    const weitester = 2 * abst; // schlimmster Fall: zwei Bahnen weit
    const zeitPro = abst / pc.moveSpeed;
    const fallweg = CONFIG.world.spawnY - (CONFIG.world.bounds.minY + 1.5);
    const fallzeit = fallweg / s.tempo;
    const noetig = Math.max(s.warnung.sekunden, weitester / pc.moveSpeed + 0.25 - fallzeit);
    const braucht = weitester / pc.moveSpeed + verzug;
    console.log(`${fname.padEnd(14)} ${cn.padEnd(7)} Bahnabstand ${abst.toFixed(3)} 1 Bahn ${zeitPro.toFixed(3)}s  2 Bahnen+Verzug ${braucht.toFixed(3)}s  Warnzeit ${noetig.toFixed(3)}s + Fallzeit ${fallzeit.toFixed(3)}s = ${(noetig + fallzeit).toFixed(3)}s  ${braucht > noetig + fallzeit ? 'ZU KNAPP' : 'ok'}`);
  }
}
