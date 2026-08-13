/**
 * Wirkungsmessung: Wie sehr schadet der angebliche Fehler, WENN der Pool
 * erschoepft ist? Vergleicht das heutige Verhalten (Zaehler/Trockenzeit werden
 * in _bahnWaehlen zurueckgesetzt) gegen eine "geflickte" Variante, die den
 * Reset zuruecknimmt, sobald acquire() null liefert.
 *
 * Gemessen wird die laengste tatsaechliche Trockenzeit je Bahn (echte Spawns).
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
const SEKUNDEN = arg('sekunden', 600);
const LAEUFE = arg('laeufe', 6);
const DT = 1 / 60;

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

function lauf({ seed, pool, flicken }) {
  const echt = Math.random;
  Math.random = rng(seed);
  const altPool = CONFIG.rock.poolSize;
  CONFIG.rock.poolSize = pool;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const affe = 'braun';
    const pCfg = { ...CONFIG.player, ...CONFIG.characters.list[affe].player };
    const world = spielfeld(9 / 19.5, (pCfg.spriteHeight * (BILD_SEITE.get(affe) ?? 0.56)) / 2, pCfg);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    let pending = null;
    const origWaehlen = spawner._bahnWaehlen.bind(spawner);
    spawner._bahnWaehlen = (frei, alle) => {
      const x = origWaehlen(frei, alle);
      const i = alle.indexOf(x);
      pending = i >= 0 ? { i, zaehler: spawner._bahnZaehler[i], vorher: null } : null;
      return x;
    };
    const origAcquire = spawner.rocks.acquire.bind(spawner.rocks);
    let leerlauf = 0; // Wahl gezaehlt, aber kein Stein gefallen
    spawner.rocks.acquire = () => {
      const r = origAcquire();
      if (r === null && pending) {
        leerlauf++;
        if (flicken) {
          // Reset zuruecknehmen: Zaehler -1, Trockenzeit weiterlaufen lassen
          spawner._bahnZaehler[pending.i] = pending.zaehler - 1;
          spawner._bahnTrocken[pending.i] = trockenIst[pending.i];
        }
      }
      pending = null;
      return r;
    };

    // Echte Trockenzeit je Bahn mitfuehren (unabhaengig vom Spawner-Zaehler)
    const bahnen = world.bahnX;
    const trockenIst = new Array(bahnen.length).fill(0);
    const maxTrocken = new Array(bahnen.length).fill(0);

    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      const base = difficulty.scrollSpeed;
      const scroll = Math.max(base, base * pCfg.minScrollFactor);
      spawner.hazardLook = stufeBei(t).hazard;
      for (let i = 0; i < trockenIst.length; i++) trockenIst[i] += DT;
      const vorher = new Set(spawner.rocks.active);
      spawner.update(DT, false, scroll);
      for (const r of spawner.rocks.active) {
        if (vorher.has(r)) continue;
        let best = 0;
        for (let i = 1; i < bahnen.length; i++) {
          if (Math.abs(bahnen[i] - r.x) < Math.abs(bahnen[best] - r.x)) best = i;
        }
        if (trockenIst[best] > maxTrocken[best]) maxTrocken[best] = trockenIst[best];
        trockenIst[best] = 0;
      }
    }
    return { maxTrocken, leerlauf };
  } finally {
    Math.random = echt;
    CONFIG.rock.poolSize = altPool;
    console.warn = warn;
  }
}

await bildseitenLaden();

for (const pool of [48, 8, 4, 3]) {
  for (const flicken of [false, true]) {
    let schlimmste = 0;
    let leer = 0;
    for (let i = 0; i < LAEUFE; i++) {
      const r = lauf({ seed: 1000 + i * 7919, pool, flicken });
      schlimmste = Math.max(schlimmste, ...r.maxTrocken);
      leer += r.leerlauf;
    }
    console.log(
      `pool ${String(pool).padStart(2)}  ${(flicken ? 'GEFLICKT' : 'heute   ').padEnd(9)} ` +
        `laengste echte Trockenzeit ${schlimmste.toFixed(2)}s   ` +
        `Wahl-ohne-Stein ${leer}x`,
    );
  }
}
