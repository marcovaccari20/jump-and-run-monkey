/**
 * GEGENPRUEFUNG 2 — Aggregat frueh/spaet, viele Laeufe.
 * Misst zusaetzlich: wie oft die Schranke die Wuerfelwahl UEBERSTIMMT
 * (also eine andere Bahn liefert als der gewichtete Zufall gezogen haette),
 * und wie sich die Verteilung der echten Luecken je Bahn aendert.
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
const LAEUFE = arg('laeufe', 12);
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
  return Math.max(1, i);
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

    const gruppe = (g) => (g <= 9 ? 0 : 1); // 0 = Gebiet 1-9, 1 = Gebiet 10-21
    const stat = [
      { schranke: 0, ueberstimmt: 0, wahlen: 0, freiEins: 0, luecken: [] },
      { schranke: 0, ueberstimmt: 0, wahlen: 0, freiEins: 0, luecken: [] },
    ];

    let jetzt = 0;
    const origWaehlen = spawner._bahnWaehlen.bind(spawner);
    spawner._bahnWaehlen = (frei, alle) => {
      const s = stat[gruppe(gebietVon(jetzt))];
      s.wahlen++;
      if (frei.length === 1) s.freiEins++;
      let duerrste = null;
      let maxT = grenze;
      if (grenze > 0 && frei.length > 1 && spawner._bahnTrocken) {
        for (const x of frei) {
          const i = alle.indexOf(x);
          if (i >= 0 && spawner._bahnTrocken[i] > maxT) {
            maxT = spawner._bahnTrocken[i];
            duerrste = x;
          }
        }
      }
      // Was haette der gewichtete Zufall gezogen? (gleiche Zahlenfolge waere
      // gestoert — deshalb nur zaehlen, ob die Schranke eine ANDERE Bahn als
      // die zaehler-beste liefert.)
      if (duerrste !== null) {
        s.schranke++;
        let bestZ = null;
        let minN = Infinity;
        for (const x of frei) {
          const i = alle.indexOf(x);
          const n = i >= 0 ? spawner._bahnZaehler[i] : 0;
          if (n < minN) {
            minN = n;
            bestZ = x;
          }
        }
        if (bestZ !== duerrste) s.ueberstimmt++;
      }
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
      const s = stat[gruppe(gebietVon(jetzt))];
      for (const r of spawner.rocks.active) {
        if (vorher.has(r)) continue;
        let best = 0;
        for (let i = 1; i < bahnen.length; i++) {
          if (Math.abs(bahnen[i] - r.x) < Math.abs(bahnen[best] - r.x)) best = i;
        }
        s.luecken.push(trockenIst[best]);
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

for (const grenze of [2.5, 0]) {
  const zus = [
    { schranke: 0, ueberstimmt: 0, wahlen: 0, freiEins: 0, luecken: [], maxProLauf: [] },
    { schranke: 0, ueberstimmt: 0, wahlen: 0, freiEins: 0, luecken: [], maxProLauf: [] },
  ];
  for (let i = 0; i < LAEUFE; i++) {
    const stat = lauf({ seed: 1000 + i * 7919, grenze });
    stat.forEach((s, k) => {
      zus[k].schranke += s.schranke;
      zus[k].ueberstimmt += s.ueberstimmt;
      zus[k].wahlen += s.wahlen;
      zus[k].freiEins += s.freiEins;
      zus[k].luecken.push(...s.luecken);
      zus[k].maxProLauf.push(Math.max(...s.luecken));
    });
  }
  console.log(`\n=== maxTrockenZeit = ${grenze} ===`);
  zus.forEach((s, k) => {
    const name = k === 0 ? 'Gebiet  1-9 ' : 'Gebiet 10-21';
    const mittel = s.luecken.reduce((a, b) => a + b, 0) / s.luecken.length;
    console.log(
      `${name}  Wahlen ${s.wahlen}  frei=1 ${((100 * s.freiEins) / s.wahlen).toFixed(0)}%  ` +
        `Schranke greift ${s.schranke} (${((100 * s.schranke) / s.wahlen).toFixed(1)}%), ` +
        `davon andere Bahn als Zaehler-Favorit ${s.ueberstimmt}\n` +
        `             Luecke: mittel ${mittel.toFixed(2)}s  p95 ${quantil(s.luecken, 0.95).toFixed(2)}  ` +
        `p99 ${quantil(s.luecken, 0.99).toFixed(2)}  max ${Math.max(...s.luecken).toFixed(2)}  ` +
        `Median der Lauf-Maxima ${quantil(s.maxProLauf, 0.5).toFixed(2)}  ` +
        `Anteil >2.5s ${((100 * s.luecken.filter((x) => x > 2.5).length) / s.luecken.length).toFixed(1)}%  ` +
        `>6s ${((100 * s.luecken.filter((x) => x > 6).length) / s.luecken.length).toFixed(2)}%`,
    );
  });
}
