/**
 * GEGENPRUEFUNG des Befunds "maxTrockenZeit 2.5 wirkt nur frueh".
 *
 * Simuliert das echte Spiel ueber alle Gebiete und misst je Gebiet:
 *   - wie oft die Schranke in _bahnWaehlen tatsaechlich zuschlaegt
 *   - die tatsaechliche Trockenzeit je Bahn (echte Spawns, inkl. Doppelabwurf)
 *   - dasselbe mit abgeschalteter Schranke (maxTrockenZeit = 0)
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
const LAEUFE = arg('laeufe', 6);
const AFFE = arg('affe', 'braun');
const ASPECT = arg('aspect', 9 / 19.5);
const DT = 1 / 60;
const GRENZEN = CONFIG.difficulty.gebietsGrenzen;
const ENDE = GRENZEN[GRENZEN.length - 1] + 40;

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
    bounds: {
      minX: Math.max(base.bounds.minX, -limit),
      maxX,
      minY: base.bounds.minY,
      maxY: base.bounds.maxY,
    },
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

function gebietVon(t) {
  let i = 0;
  while (i < GRENZEN.length && t >= GRENZEN[i]) i++;
  return i; // 1 = erstes Gebiet
}

function lauf({ seed, grenze }) {
  const echt = Math.random;
  Math.random = rng(seed);
  const altGrenze = CONFIG.rock.korridor.maxTrockenZeit;
  CONFIG.rock.korridor.maxTrockenZeit = grenze;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const pCfg = { ...CONFIG.player, ...CONFIG.characters.list[AFFE].player };
    const world = spielfeld(ASPECT, (pCfg.spriteHeight * (BILD_SEITE.get(AFFE) ?? 0.56)) / 2, pCfg);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const anzGebiete = GRENZEN.length;
    // je Gebiet: Schranke schlug zu, Wahlen gesamt, frei.length-Verteilung
    const stat = Array.from({ length: anzGebiete + 2 }, () => ({
      schranke: 0,
      wahlen: 0,
      freiEins: 0,
      spawns: 0,
      luecken: [],
    }));

    let jetzt = 0;
    const origWaehlen = spawner._bahnWaehlen.bind(spawner);
    spawner._bahnWaehlen = (frei, alle) => {
      const g = gebietVon(jetzt);
      const s = stat[Math.min(g, anzGebiete + 1)];
      s.wahlen++;
      if (frei.length === 1) s.freiEins++;
      // Wuerde die Schranke greifen? (exakt dieselbe Bedingung wie im Code)
      let greift = false;
      if (grenze > 0 && frei.length > 1 && spawner._bahnTrocken) {
        for (const x of frei) {
          const i = alle.indexOf(x);
          if (i >= 0 && spawner._bahnTrocken[i] > grenze) greift = true;
        }
      }
      if (greift) s.schranke++;
      return origWaehlen(frei, alle);
    };

    const bahnen = world.bahnX;
    const trockenIst = new Array(bahnen.length).fill(0);

    const frames = Math.round(ENDE / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      jetzt = difficulty.elapsed;
      const base = difficulty.scrollSpeed;
      const scroll = Math.max(base, base * pCfg.minScrollFactor);
      spawner.hazardLook = stufeBei(jetzt).hazard;
      for (let i = 0; i < trockenIst.length; i++) trockenIst[i] += DT;
      const vorher = new Set(spawner.rocks.active);
      spawner.update(DT, false, scroll);
      const g = Math.min(gebietVon(jetzt), anzGebiete + 1);
      for (const r of spawner.rocks.active) {
        if (vorher.has(r)) continue;
        let best = 0;
        for (let i = 1; i < bahnen.length; i++) {
          if (Math.abs(bahnen[i] - r.x) < Math.abs(bahnen[best] - r.x)) best = i;
        }
        stat[g].spawns++;
        stat[g].luecken.push(trockenIst[best]);
        trockenIst[best] = 0;
      }
    }
    return stat;
  } finally {
    Math.random = echt;
    CONFIG.rock.korridor.maxTrockenZeit = altGrenze;
    console.warn = warn;
  }
}

function quantil(arr, q) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}

await bildseitenLaden();

const varianten = [
  { name: 'AN  (2.5)', grenze: 2.5 },
  { name: 'AUS (0)  ', grenze: 0 },
];
const erg = new Map();
for (const v of varianten) {
  const zus = [];
  for (let i = 0; i < LAEUFE; i++) {
    const stat = lauf({ seed: 1000 + i * 7919, grenze: v.grenze });
    stat.forEach((s, g) => {
      if (!zus[g]) zus[g] = { schranke: 0, wahlen: 0, freiEins: 0, spawns: 0, luecken: [] };
      zus[g].schranke += s.schranke;
      zus[g].wahlen += s.wahlen;
      zus[g].freiEins += s.freiEins;
      zus[g].spawns += s.spawns;
      zus[g].luecken.push(...s.luecken);
    });
  }
  erg.set(v.name, zus);
}

console.log(`Affe ${AFFE}  aspect ${ASPECT.toFixed(3)}  ${LAEUFE} Laeufe x ${ENDE.toFixed(0)} s`);
console.log(
  'Gebiet | Wahlen | frei=1 | Schranke greift | max Luecke AN | max AUS | p99 AN | p99 AUS | >2.5s AN | >2.5s AUS',
);
for (let g = 1; g <= GRENZEN.length; g++) {
  const an = erg.get('AN  (2.5)')[g];
  const aus = erg.get('AUS (0)  ')[g];
  if (!an || !an.wahlen) continue;
  const uebAn = an.luecken.filter((x) => x > 2.5).length / Math.max(1, an.luecken.length);
  const uebAus = aus.luecken.filter((x) => x > 2.5).length / Math.max(1, aus.luecken.length);
  console.log(
    `${String(g).padStart(6)} | ${String(an.wahlen).padStart(6)} | ` +
      `${((100 * an.freiEins) / an.wahlen).toFixed(0).padStart(5)}% | ` +
      `${String(an.schranke).padStart(6)} = ${((100 * an.schranke) / an.wahlen).toFixed(1).padStart(5)}% | ` +
      `${Math.max(...an.luecken).toFixed(2).padStart(13)} | ${Math.max(...aus.luecken).toFixed(2).padStart(7)} | ` +
      `${quantil(an.luecken, 0.99).toFixed(2).padStart(6)} | ${quantil(aus.luecken, 0.99).toFixed(2).padStart(7)} | ` +
      `${(100 * uebAn).toFixed(1).padStart(7)}% | ${(100 * uebAus).toFixed(1).padStart(8)}%`,
  );
}
