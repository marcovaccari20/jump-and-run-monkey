/**
 * Misst, ob der Rock-Pool je erschoepft wird (acquire() === null) und wie hoch
 * die gleichzeitige Belegung maximal steigt. Instrumentiert zusaetzlich, ob
 * _bahnWaehlen jemals eine Bahn zaehlt/zurueckstellt, ohne dass danach ein
 * Stein wirklich faellt.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { PerspectiveCamera } from 'three';

import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}

const SEKUNDEN = arg('sekunden', Math.ceil((CONFIG.wall.stages.at(-1)?.afterSeconds ?? 0) + 60));
const LAEUFE = arg('laeufe', 8);
const DT = 1 / 60;
const POOL = arg('pool', null);
if (POOL !== null) CONFIG.rock.poolSize = POOL;

/* --hart: alle Dichte-Regler auf Anschlag, um die HARTE Obergrenze der
 * gleichzeitig aktiven Steine zu finden (nicht das Normalspiel). */
if (process.argv.includes('--hart')) {
  CONFIG.difficulty.dichte.doppel.abWand = 0;
  CONFIG.difficulty.dichte.doppel.vollAbWand = 0.001;
  CONFIG.difficulty.dichte.doppel.chanceMax = 1.0;
  CONFIG.difficulty.dichte.salveChance = 1.0;
  CONFIG.difficulty.dichte.salveMax = 9;
  CONFIG.difficulty.dichte.start = 99;
  CONFIG.difficulty.dichte.auslastung = 99;
}
/* --ohne-abstand: die Abstandsregel _darfFallen aushaengen (Gegenprobe:
 * zeigt, dass genau sie die Belegung deckelt). */
const OHNE_ABSTAND = process.argv.includes('--ohne-abstand');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BILD_SEITE = new Map();
async function bildseitenLaden() {
  const wurzel = dirname(fileURLToPath(import.meta.url));
  for (const [id, char] of Object.entries(CONFIG.characters.list)) {
    const pfad = (char.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
    const datei = resolve(wurzel, '..', 'public', pfad.replace(/^\//, ''));
    try {
      const m = await sharp(datei).metadata();
      BILD_SEITE.set(id, m.width / m.height);
    } catch {
      BILD_SEITE.set(id, 0.56);
    }
  }
}
function halbeAffenBreite(charId, pCfg) {
  return (pCfg.spriteHeight * (BILD_SEITE.get(charId) ?? 0.56)) / 2;
}

function spielfeld(aspect, halbeBreite, pCfg) {
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
  const rand = Math.max(halbeBreite, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - rand);
  const maxX = Math.min(base.bounds.maxX, limit);
  return {
    ...base,
    bounds: { minX: Math.max(base.bounds.minX, -limit), maxX, minY: base.bounds.minY, maxY: base.bounds.maxY },
    bahnX: base.bahnen.map((a) => a * maxX),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
  };
}

function stufeBei(sekunden) {
  const stages = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < stages.length; i++) if (sekunden >= stages[i].afterSeconds) idx = i;
  const letzte = stages[stages.length - 1];
  if (sekunden >= letzte.afterSeconds) {
    const extra = Math.floor((sekunden - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (stages.length - 1 + extra) % stages.length;
  }
  return stages[idx];
}

function lauf({ seed, affe, aspect, steigt }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const world = spielfeld(aspect, halbeAffenBreite(affe, pCfg), pCfg);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();
    if (OHNE_ABSTAND) spawner._darfFallen = () => true;

    // --- Instrumentierung -------------------------------------------------
    let nullCount = 0;
    let acquireCount = 0;
    const origAcquire = spawner.rocks.acquire.bind(spawner.rocks);
    spawner.rocks.acquire = () => {
      acquireCount++;
      const r = origAcquire();
      if (r === null) nullCount++;
      return r;
    };
    // Wieviele Wahl-Vorgaenge (_bahnWaehlen) enden ohne echten Spawn?
    let waehlCount = 0;
    let spawnCount = 0;
    const origWaehlen = spawner._bahnWaehlen.bind(spawner);
    spawner._bahnWaehlen = (frei, alle) => {
      waehlCount++;
      return origWaehlen(frei, alle);
    };

    let maxAktiv = 0;
    let maxFrei = spawner.rocks.free.length;
    let minFrei = spawner.rocks.free.length;

    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      const base = difficulty.scrollSpeed;
      const assisted = base + (steigt ? pCfg.climbAssist : 0);
      const scroll = Math.max(assisted, base * pCfg.minScrollFactor);
      spawner.hazardLook = stufeBei(t).hazard;
      const vorher = spawner.rocks.active.length;
      spawner.update(DT, false, scroll);
      spawnCount += Math.max(0, spawner.rocks.active.length - vorher);
      if (spawner.rocks.active.length > maxAktiv) maxAktiv = spawner.rocks.active.length;
      if (spawner.rocks.free.length < minFrei) minFrei = spawner.rocks.free.length;
    }
    return { maxAktiv, minFrei, nullCount, acquireCount, waehlCount, spawnCount, poolSize: spawner.rocks.size };
  } finally {
    Math.random = echt;
  }
}

await bildseitenLaden();

const AFFEN = Object.keys(CONFIG.characters.list);
const FORMATE = { quer: 16 / 9, hoch: 9 / 19.5, extrem: 9 / 24 };

let globalMax = 0;
let globalNull = 0;
let globalMinFrei = Infinity;
console.log(`Pool ${CONFIG.rock.poolSize}, ${SEKUNDEN}s je Lauf, ${LAEUFE} Seeds\n`);
for (const affe of AFFEN) {
  for (const [fn, aspect] of Object.entries(FORMATE)) {
    for (const steigt of [false, true]) {
      let mx = 0;
      let nl = 0;
      let mf = Infinity;
      for (let i = 0; i < LAEUFE; i++) {
        const r = lauf({ seed: 1000 + i * 7919, affe, aspect, steigt });
        mx = Math.max(mx, r.maxAktiv);
        nl += r.nullCount;
        mf = Math.min(mf, r.minFrei);
      }
      globalMax = Math.max(globalMax, mx);
      globalNull += nl;
      globalMinFrei = Math.min(globalMinFrei, mf);
      console.log(
        `  ${affe.padEnd(7)} ${fn.padEnd(7)} ${(steigt ? 'W' : '-').padEnd(2)} ` +
          `max gleichzeitig ${String(mx).padStart(3)}   min frei ${String(mf).padStart(3)}   acquire-null ${nl}`,
      );
    }
  }
}
console.log(
  `\nGESAMT: hoechste gleichzeitige Belegung ${globalMax} von ${CONFIG.rock.poolSize}; ` +
    `nie unter ${globalMinFrei} freie; acquire()===null insgesamt ${globalNull}x`,
);
