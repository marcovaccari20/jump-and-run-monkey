/* TEMPORAER — Kontrollversuche. Loeschen nach dem Lauf. */
import fs from 'node:fs';
import path from 'node:path';
import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { DifficultyCurve } from './src/systems/DifficultyCurve.js';
import { Spawner } from './src/systems/Spawner.js';
import { halfWidthAt } from './src/core/viewport.js';
import { groessteSpriteBreite, Rock, _resetSharedRockAssets } from './src/entities/Rock.js';

const szene = { add() {} };
function webpSize(file) {
  const b = fs.readFileSync(file);
  const f = b.toString('ascii', 12, 16);
  if (f === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  if (f === 'VP8L') { const bits = b.readUInt32LE(21); return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }; }
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}
function texMap() {
  const m = new Map();
  for (const look of Object.values(CONFIG.rock.looks))
    for (const name of look.bilder ?? []) {
      if (!name) continue;
      const p = CONFIG.rock.spritePath.replace('{n}', name);
      if (m.has(p)) continue;
      const s = webpSize(path.join('public/hazards', name + '.webp'));
      m.set(p, { image: { width: s.w, height: s.h } });
    }
  return m;
}

const DT = 1 / 60;
function spielfeld(aspect, pCfg) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const base = CONFIG.world;
  const half = halfWidthAt(camera, 0, CONFIG.player.startPosition[1]);
  const rand = Math.max(1.4 / 2, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - rand);
  const maxX = Math.min(base.bounds.maxX, limit);
  return {
    ...base,
    bounds: { minX: -limit, maxX, minY: base.bounds.minY, maxY: base.bounds.maxY },
    bahnX: base.bahnen.map((a) => a * maxX),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
  };
}

function lauf(aspect, look, sekunden, startWand, pCfg) {
  const tex = texMap();
  _resetSharedRockAssets();
  new Rock(0, CONFIG.rock, tex);
  const d = new DifficultyCurve(CONFIG.difficulty);
  d.setRockMix(CONFIG.rock.mix);
  d.elapsed = startWand * CONFIG.difficulty.sekundenProWand;
  const world = spielfeld(aspect, pCfg);
  const sp = new Spawner(szene, CONFIG, d, world, tex, null, null);
  sp.setSpieler(pCfg);
  sp.hazardLook = look;
  sp.reset();
  CONFIG.banana.spawnChance = 0;
  let versuche = 0, keinPlatz = 0, abgeworfen = 0, kt = 0, frames = 0;
  const of = sp._freieStelle.bind(sp);
  sp._freieStelle = (t, r) => { versuche++; const x = of(t, r); if (x === null) keinPlatz++; return x; };
  const oa = sp.rocks.acquire.bind(sp.rocks);
  sp.rocks.acquire = () => { const r = oa(); if (r) abgeworfen++; return r; };
  for (let i = 0, n = Math.round(sekunden / DT); i < n; i++) {
    d.update(DT); kt += sp.korridorTempo; sp.update(DT, false, d.scrollSpeed); frames++;
  }
  return {
    maxX: world.bounds.maxX, breite: groessteSpriteBreite(CONFIG.rock),
    soll: d.dichte, ist: abgeworfen / sekunden,
    ausfall: versuche ? keinPlatz / versuche : 0, korr: kt / frames,
  };
}

const braun = { ...CONFIG.player, ...CONFIG.characters.list.braun.player };
const HOCH = 390 / 844;

function zeig(t, r) {
  console.log(`${t.padEnd(42)} maxX ${r.maxX.toFixed(3)}  breitestes ${r.breite.toFixed(3)}  soll ${r.soll.toFixed(3)}  ist ${r.ist.toFixed(3)} (${((r.ist / r.soll - 1) * 100).toFixed(0)}%)  Ausfall ${(r.ausfall * 100).toFixed(1)}%  korrTempo ${r.korr.toFixed(3)}`);
}

console.log('=== Hochformat 390x844, Wand 3, Look stein, 500 s ===');
zeig('IST (holz 2.1, 3 Bahnen)', lauf(HOCH, 'stein', 500, 3, braun));

CONFIG.rock.looks.holz.bildScale = 1.05;
zeig('Kontrolle A: holz.bildScale zurueck auf 1.05', lauf(HOCH, 'stein', 500, 3, braun));
CONFIG.rock.looks.holz.bildScale = 2.1;

CONFIG.world.bahnen = [-1, -1 / 3, 1 / 3, 1];
zeig('Kontrolle B: 4 Bahnen (holz weiter 2.1)', lauf(HOCH, 'stein', 500, 3, braun));
CONFIG.world.bahnen = [-1, 0, 1];

const mixAlt = CONFIG.rock.mix;
CONFIG.rock.mix = [{ abWand: 0, weights: [50, 50, 0] }];
zeig('Kontrolle C: keine grossen Objekte', lauf(HOCH, 'stein', 500, 3, braun));
CONFIG.rock.mix = mixAlt;

console.log('\n=== Querformat 16:9, Wand 3, 500 s — Dichteverlust durch _darfFallen ===');
for (const look of ['stein', 'holz']) {
  const r = lauf(16 / 9, look, 500, 3, braun);
  zeig(`quer / ${look} (IST)`, r);
}
CONFIG.rock.mix = [{ abWand: 0, weights: [50, 50, 0] }];
for (const look of ['stein', 'holz']) zeig(`quer / ${look} ohne grosse`, lauf(16 / 9, look, 500, 3, braun));
CONFIG.rock.mix = mixAlt;

console.log('\n=== touch anchor ===');
console.log(JSON.stringify(CONFIG.input?.touch ?? CONFIG.touch ?? null));
