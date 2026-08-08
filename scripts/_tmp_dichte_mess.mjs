/* Misst die tatsaechlich erreichte Spawnrate gegen DifficultyCurve.dichte. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PerspectiveCamera, Object3D } from 'three';

import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';
import { groessteSpriteBreite, spriteHoehe } from '../src/entities/Rock.js';

const WURZEL = 'C:/Users/vacca/Downloads/jump-and-run-monkey';

/* --- echte Bildseitenverhaeltnisse als Fake-Texturen ------------------- */
const texturen = new Map();
for (const [lookId, look] of Object.entries(CONFIG.rock.looks)) {
  for (const name of look.bilder ?? []) {
    if (!name) continue;
    const pfad = CONFIG.rock.spritePath.replace('{n}', name);
    if (texturen.has(pfad)) continue;
    const datei = resolve(WURZEL, 'public', pfad.replace(/^\//, ''));
    try {
      const m = await sharp(datei).metadata();
      texturen.set(pfad, { image: { width: m.width, height: m.height } });
    } catch (e) {
      console.warn('fehlt:', datei, e.message);
    }
  }
}

const pCfg = { ...CONFIG.player, ...CONFIG.characters.list.braun.player };
const charFrame = (CONFIG.characters.list.braun.player?.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
let affenSeite = 0.56;
try {
  const m = await sharp(resolve(WURZEL, 'public', charFrame.replace(/^\//, ''))).metadata();
  affenSeite = m.width / m.height;
} catch {}
const halbeAffenBreite = (pCfg.spriteHeight * affenSeite) / 2;

function spielfeld(aspect) {
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

const DT = 1 / 60;
const SEK = Number(process.argv[3] ?? 500);
const ASPECT = process.argv[2] === 'hoch' ? 9 / 19.5 : 16 / 9;

function messen(look, wand, ohneGross = false, ohneAbstand = false) {
  const world = spielfeld(ASPECT);
  const d = new DifficultyCurve(CONFIG.difficulty);
  d.setRockMix(CONFIG.rock.mix);
  d.elapsed = wand * CONFIG.difficulty.sekundenProWand;
  const spawner = new Spawner(new Object3D(), CONFIG, d, world, texturen);
  spawner.bananasEnabled = false;
  spawner.setSpieler(pCfg);
  spawner.reset();
  spawner.hazardLook = look;
  if (ohneAbstand) spawner._darfFallen = () => true;
  if (ohneGross) {
    const t = CONFIG.rock.types;
    spawner._pickRockType = () => (Math.random() < 0.5 ? t[0] : t[1]);
  }

  let spawns = 0;
  let blockiert = 0;   // Frames, in denen _darfFallen nein sagte
  let ausfall = 0;     // kein Platz (x === null)
  const echtDarf = spawner._darfFallen.bind(spawner);
  spawner._darfFallen = (...a) => { const r = echtDarf(...a); if (!r) blockiert++; return r; };
  const echtFrei = spawner._freieStelle.bind(spawner);
  spawner._freieStelle = (...a) => { const r = echtFrei(...a); if (r === null) ausfall++; return r; };
  const echtAcq = spawner.rocks.acquire.bind(spawner.rocks);
  spawner.rocks.acquire = () => { const r = echtAcq(); if (r) spawns++; return r; };

  const frames = Math.round(SEK / DT);
  const scroll = d.scrollSpeed;
  for (let f = 0; f < frames; f++) {
    spawner.update(DT, false, scroll);
    d.elapsed = wand * CONFIG.difficulty.sekundenProWand; // Haerte einfrieren
  }
  return { ist: spawns / SEK, soll: d.dichte, blockiert, ausfall, spawnDelay: d.spawnDelay, tempo: d.tempo };
}

console.log('aspect', ASPECT.toFixed(3), 'sek', SEK);
for (const look of ['stein', 'holz', 'eiszapfen']) {
  for (const [label, og] of [['alle', false], ['ohne gross', true]]) {
    const r = messen(look, 3, og);
    console.log(
      `${look.padEnd(10)} ${label.padEnd(11)} ist ${r.ist.toFixed(3)}/s  soll ${r.soll.toFixed(3)}/s  ` +
      `(${(((r.ist / r.soll) - 1) * 100).toFixed(1)}%)  block ${r.blockiert}  ausfall ${r.ausfall}`,
    );
  }
  const ohne = messen(look, 3, false, true);
  console.log(`${look.padEnd(10)} ${'ohneAbstand'.padEnd(11)} ist ${ohne.ist.toFixed(3)}/s  soll ${ohne.soll.toFixed(3)}/s  (${(((ohne.ist / ohne.soll) - 1) * 100).toFixed(1)}%)  ausfall ${ohne.ausfall}`);
}

/* Bildhoehen */
console.log('\nBildhoehen:');
for (const look of ['stein', 'holz', 'eiszapfen']) {
  const zeile = CONFIG.rock.types.map((t) => `${t.id} ${spriteHoehe(CONFIG.rock, look, t).toFixed(3)}`).join('  ');
  console.log('  ' + look.padEnd(10) + zeile);
}

console.log('\nSweep ueber die Waende (alle Groessen):');
console.log(' wand   soll   stein     holz      eis');
for (const w of [0,1,2,3,4,5,6,7,8,9,10,12,14,16]) {
  const rs = messen('stein', w), rh = messen('holz', w), re = messen('eiszapfen', w);
  console.log(
    `  ${String(w).padStart(2)}  ${rs.soll.toFixed(3)}  ` +
    `${rs.ist.toFixed(3)}(${(((rs.ist/rs.soll)-1)*100).toFixed(0)}%)  ` +
    `${rh.ist.toFixed(3)}(${(((rh.ist/rh.soll)-1)*100).toFixed(0)}%)  ` +
    `${re.ist.toFixed(3)}(${(((re.ist/re.soll)-1)*100).toFixed(0)}%)  ausf ${rs.ausfall}/${rh.ausfall}/${re.ausfall}`,
  );
}
