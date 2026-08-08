/**
 * Zweiter Durchgang:
 *  (1) Sweep über das ZIEL-Seitenverhältnis bei EINEM einzelnen Resize.
 *  (2) Allwissender Spieler (Erreichbarkeitsmenge über alle Bahnen):
 *      stirbt auch der, ist die Lücke wirklich weg — nicht nur die Zusage.
 */
import { readFileSync } from 'node:fs';
import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { DifficultyCurve } from './src/systems/DifficultyCurve.js';
import { Spawner } from './src/systems/Spawner.js';
import { halfWidthAt } from './src/core/viewport.js';

function webpSize(pfad) {
  const b = readFileSync(pfad);
  const tag = b.toString('ascii', 12, 16);
  if (tag === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
  if (tag === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (tag === 'VP8L') { const bits = b.readUInt32LE(21); return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 }; }
  throw new Error('unbekannt ' + tag);
}

const AFFE = process.env.AFFE ?? 'braun';
const charCfg = CONFIG.characters.list[AFFE];
const pCfg = { ...CONFIG.player, ...charCfg.player };
const bild = webpSize('./public' + charCfg.framePath.replace('{n}', '00'));
const SPRITE_W = pCfg.spriteHeight * (bild.w / bild.h);

const camCfg = CONFIG.render.camera;
function feld(aspect) {
  const c = new PerspectiveCamera(camCfg.fov, aspect, camCfg.near, camCfg.far);
  c.position.set(...camCfg.position);
  c.lookAt(...camCfg.lookAt);
  c.updateMatrixWorld(true); c.updateProjectionMatrix();
  c.matrixWorldInverse.copy(c.matrixWorld).invert();
  const half = halfWidthAt(c, 0, pCfg.startPosition[1]);
  const limit = Math.max(0.9, half - SPRITE_W / 2);
  const base = CONFIG.world;
  return { minX: Math.max(base.bounds.minX, -limit), maxX: Math.min(base.bounds.maxX, limit),
           spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8) };
}
function anwenden(world, spawner, aspect) {
  const f = feld(aspect);
  world.bounds.minX = f.minX; world.bounds.maxX = f.maxX;
  world.bahnX = CONFIG.world.bahnen.map((a) => a * f.maxX);
  world.spawnHalfWidth = f.spawnHalfWidth;
  spawner.korridor.grenzenAendern(f.minX, f.maxX);
}
function stufeBei(s) {
  const stages = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < stages.length; i++) if (s >= stages[i].afterSeconds) idx = i;
  const letzte = stages[stages.length - 1];
  if (s >= letzte.afterSeconds) {
    const extra = Math.floor((s - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (stages.length - 1 + extra) % stages.length;
  }
  return stages[idx];
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const DT = 1 / 60;
const RATE = 3 / Math.max(0.02, pCfg.bahnWechselZeit ?? 0.16);
const PY = pCfg.startPosition[1] + (pCfg.hitOffsetY ?? 0);
const PR = pCfg.hitRadius;

function schrittZu(x, ziel, minX, maxX) {
  const rest = ziel - x;
  let s = rest * (1 - Math.exp(-RATE * DT));
  const m = pCfg.moveSpeed * DT;
  if (s > m) s = m; else if (s < -m) s = -m;
  let nx = x + s;
  if (Math.abs(ziel - nx) < 0.002) nx = ziel;
  if (nx < minX) nx = minX; else if (nx > maxX) nx = maxX;
  return nx;
}

function getroffen(x, rocks) {
  for (const r of rocks) {
    if (!r.active) continue;
    if (r.radius <= (charCfg.ignoreRockRadius ?? 0)) continue;
    const dx = x - r.x, dy = PY - r.y, R = PR + r.hitRadius;
    if (dx * dx + dy * dy <= R * R) return true;
  }
  return false;
}

/**
 * modus 'korridor' = Spieler folgt der garantierten Bahn (das Modell der Zusage)
 * modus 'allwissend' = Erreichbarkeitsmenge über ALLE Bahnwahlen, jeden Frame frei
 */
function lauf({ seed, sekunden, startAspect, plan, modus }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const f0 = feld(startAspect);
    const world = { ...CONFIG.world,
      bounds: { minX: f0.minX, maxX: f0.maxX, minY: CONFIG.world.bounds.minY, maxY: CONFIG.world.bounds.maxY },
      bahnX: CONFIG.world.bahnen.map((a) => a * f0.maxX), spawnHalfWidth: f0.spawnHalfWidth };

    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    let start = 0;
    for (let i = 1; i < world.bahnX.length; i++)
      if (Math.abs(world.bahnX[i] - pCfg.startPosition[0]) < Math.abs(world.bahnX[start] - pCfg.startPosition[0])) start = i;
    let px = world.bahnX[start];
    let menge = [world.bahnX[start]]; // allwissend: erreichbare x-Werte

    const frames = Math.round(sekunden / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      const a = plan(t);
      if (a !== null) anwenden(world, spawner, a);
      spawner.hazardLook = stufeBei(t).hazard;
      const base = difficulty.scrollSpeed;

      if (modus === 'korridor') {
        const kx = spawner.korridor.bei(spawner.korridor.jetzt);
        let best = 0;
        for (let i = 1; i < world.bahnX.length; i++)
          if (Math.abs(world.bahnX[i] - kx) < Math.abs(world.bahnX[best] - kx)) best = i;
        px = schrittZu(px, world.bahnX[best], world.bounds.minX, world.bounds.maxX);
      } else {
        const neu = new Set();
        for (const x of menge) for (const ziel of world.bahnX) {
          const nx = schrittZu(x, ziel, world.bounds.minX, world.bounds.maxX);
          neu.add(Math.round(nx * 1000) / 1000);
        }
        menge = [...neu];
      }

      spawner.update(DT, false, base);

      if (modus === 'korridor') {
        if (getroffen(px, spawner.rocks.active)) return { ok: false, t };
      } else {
        menge = menge.filter((x) => !getroffen(x, spawner.rocks.active));
        if (menge.length === 0) return { ok: false, t };
      }
    }
    return { ok: true };
  } finally { Math.random = echt; }
}

const HOCH = 9 / 19.5;
const N = Number(process.env.N ?? 40);
const T0 = 40;
const SEK = 46;

function serie(name, startAspect, planFactory, modus) {
  let fail = 0;
  for (let i = 0; i < N; i++) {
    const r = lauf({ seed: 1000 + i * 7919, sekunden: SEK, startAspect, plan: planFactory(), modus });
    if (!r.ok) fail++;
  }
  return fail;
}

const einSchritt = (ziel) => () => { let getan = false; return (t) => { if (!getan && t >= T0) { getan = true; return ziel; } return null; }; };

console.log(`EIN einzelner Resize aus dem Hochformat (Feld ±${feld(HOCH).maxX.toFixed(3)}), ${N} Läufe je Ziel:\n`);
console.log('  Ziel-Aspect   Feld ±     Korridor-Spieler   Allwissender');
for (const ziel of [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1012, 1.2, 1.4, 16 / 9, 2.1667, 2.5, 3.0]) {
  const kf = serie('', HOCH, einSchritt(ziel), 'korridor');
  const af = serie('', HOCH, einSchritt(ziel), 'allwissend');
  console.log(`  ${ziel.toFixed(4)}        ${feld(ziel).maxX.toFixed(3).padStart(6)}     ${String(kf).padStart(2)}/${N}              ${String(af).padStart(2)}/${N}`);
}

console.log('\nZiehen (Resize jeden Frame) über 1.5 s:');
const zieh = (von, nach, dauer) => () => (t) => {
  if (t < T0 || t > T0 + dauer) return null;
  return von + (nach - von) * ((t - T0) / dauer);
};
for (const [von, nach, label] of [[HOCH, 16 / 9, 'hoch->quer'], [16 / 9, HOCH, 'quer->hoch']]) {
  const kf = serie('', von, zieh(von, nach, 1.5), 'korridor');
  const af = serie('', von, zieh(von, nach, 1.5), 'allwissend');
  console.log(`  ${label}:  Korridor-Spieler ${kf}/${N}   Allwissender ${af}/${N}`);
}
