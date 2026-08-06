/**
 * Angriff: Fenstergroesse aendern WAEHREND des Spiels.
 * Baut fairness.mjs nach, mutiert aber `world` mitten im Lauf genau so,
 * wie Game._updateWorldBounds es auf dem geteilten worldView-Objekt tut.
 */
import { PerspectiveCamera } from 'three';

import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}

const LAEUFE = arg('laeufe', 24);
const SEKUNDEN = arg('sekunden', 120);
const DT = 1 / 60;
const RESERVE = arg('reserve', 0.75);
const AFFE = String(arg('affe', 'braun'));
const TRESIZE = arg('tresize', 40);
const RICHTUNG = String(arg('richtung', 'schmal')); // schmal | breit | keine
const MITFIX = process.argv.includes('--mitfix');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ordnen(mengen) {
  if (mengen.length === 0) return mengen;
  mengen.sort((p, q) => p[0] - q[0]);
  const out = [mengen[0]];
  for (let i = 1; i < mengen.length; i++) {
    const letzte = out[out.length - 1];
    if (mengen[i][0] <= letzte[1] + 1e-9) {
      if (mengen[i][1] > letzte[1]) letzte[1] = mengen[i][1];
    } else out.push(mengen[i]);
  }
  return out;
}
function aufweiten(mengen, d, lo, hi) {
  const out = [];
  for (const [a, b] of mengen) {
    const na = Math.max(lo, a - d);
    const nb = Math.min(hi, b + d);
    if (nb > na - 1e-9) out.push([na, nb]);
  }
  return ordnen(out);
}
function abziehen(mengen, verboten) {
  let aktuell = mengen;
  for (const [va, vb] of verboten) {
    const naechste = [];
    for (const [a, b] of aktuell) {
      if (vb <= a || va >= b) { naechste.push([a, b]); continue; }
      if (va > a) naechste.push([a, Math.min(va, b)]);
      if (vb < b) naechste.push([Math.max(vb, a), b]);
    }
    aktuell = naechste;
  }
  return aktuell.filter(([a, b]) => b - a > 1e-9);
}
const breiteste = (m) => m.reduce((x, [a, b]) => Math.max(x, b - a), 0);

/** Genau Game._updateWorldBounds, aber auf ein bestehendes Objekt angewandt. */
function bounds(aspect, hitRadius) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const base = CONFIG.world;
  const half = halfWidthAt(camera, 0, base.bounds.maxY);
  const limit = Math.max(0.9, half - hitRadius * 1.6);
  return {
    minX: Math.max(base.bounds.minX, -limit),
    maxX: Math.min(base.bounds.maxX, limit),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.4),
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

const QUER = 16 / 9;
const HOCH = 9 / 19.5;

function lauf({ seed, affe, steigt, hoehe }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const hitRadius = pCfg.hitRadius;
    const ignoreR = charCfg.ignoreRockRadius ?? 0;

    const startAspect = Number(arg('von', RICHTUNG === 'breit' ? HOCH : QUER));
    const zielAspect = Number(arg('nach', RICHTUNG === 'breit' ? QUER : HOCH));

    const b0 = bounds(startAspect, hitRadius);
    const world = {
      ...CONFIG.world,
      bounds: { minX: b0.minX, maxX: b0.maxX, minY: CONFIG.world.bounds.minY, maxY: CONFIG.world.bounds.maxY },
      spawnHalfWidth: b0.spawnHalfWidth,
    };

    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const py = hoehe;
    const schritt = pCfg.moveSpeed * RESERVE * DT;

    let S = [[0, 0]];
    let umgestellt = RICHTUNG === 'keine';
    let korridorAussen = 0; // Frames, in denen die Bahn ausserhalb des Feldes lag

    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;

      if (!umgestellt && t >= TRESIZE) {
        const b1 = bounds(zielAspect, hitRadius);
        world.bounds.minX = b1.minX;
        world.bounds.maxX = b1.maxX;
        world.spawnHalfWidth = b1.spawnHalfWidth;
        // GENAU wie Game._updateWorldBounds (Game.js:880) es tut:
        if (MITFIX) spawner.korridor.grenzenAendern(b1.minX, b1.maxX);
        umgestellt = true;
        // Der Affe wird von Player.update hart in die neuen Grenzen geklemmt.
        const geklemmt = [];
        for (const [a, b] of S) {
          const na = Math.min(Math.max(a, b1.minX), b1.maxX);
          const nb = Math.min(Math.max(b, b1.minX), b1.maxX);
          geklemmt.push([na, nb]);
        }
        S = ordnen(geklemmt);
      }

      const base = difficulty.scrollSpeed;
      const assisted = base + (steigt ? pCfg.climbAssist : 0);
      const scroll = Math.max(assisted, base * pCfg.minScrollFactor);
      spawner.hazardLook = stufeBei(t).hazard;

      S = aufweiten(S, schritt, world.bounds.minX, world.bounds.maxX);
      spawner.update(DT, false, scroll);

      const kx = spawner.korridor.x;
      if (kx < world.bounds.minX - 1e-6 || kx > world.bounds.maxX + 1e-6) korridorAussen++;

      const verboten = [];
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        if (r.radius <= ignoreR) continue;
        const R = hitRadius + r.hitRadius;
        const dy = py - r.y;
        const rest = R * R - dy * dy;
        if (rest <= 0) continue;
        const halb = Math.sqrt(rest);
        verboten.push([r.x - halb, r.x + halb]);
      }
      S = abziehen(S, verboten);

      if (S.length === 0) {
        return {
          ok: false, seed, zeit: t, korridorAussen,
          korridorX: +kx.toFixed(2),
          feld: [+world.bounds.minX.toFixed(2), +world.bounds.maxX.toFixed(2)],
          spawnHalb: +world.spawnHalfWidth.toFixed(2),
          objekte: spawner.rocks.active
            .filter((r) => Math.abs(r.y - py) < 2)
            .map((r) => `${r.type.id[0]}@${r.x.toFixed(2)}`)
            .sort(),
        };
      }
    }
    return { ok: true, seed, engste: breiteste(S), korridorAussen };
  } finally {
    Math.random = echt;
  }
}

const HOEHEN = [CONFIG.world.bounds.minY, -1.4, 0, 1.4, CONFIG.world.bounds.maxY];
console.log(`Resize-Angriff — ${LAEUFE} Läufe à ${SEKUNDEN}s, Affe ${AFFE}, Umschalten bei ${TRESIZE}s (${RICHTUNG})\n`);

let fail = 0;
const fehler = [];
let aussenSumme = 0;
for (let i = 0; i < LAEUFE; i++) {
  for (const steigt of [false, true]) {
    const r = lauf({ seed: 1000 + i * 7919, affe: AFFE, steigt, hoehe: HOEHEN[i % HOEHEN.length] });
    aussenSumme += r.korridorAussen;
    if (!r.ok) { fail++; if (fehler.length < 5) fehler.push({ ...r, steigt }); }
  }
}
console.log(`Bahn lag insgesamt ${aussenSumme} Frames ausserhalb des Spielfelds.`);
if (fail === 0) console.log(`BESTANDEN — ${LAEUFE * 2} Läufe.`);
else {
  console.log(`DURCHGEFALLEN — ${fail} von ${LAEUFE * 2} Läufen.\n`);
  for (const f of fehler) {
    console.log(`  Seed ${f.seed}${f.steigt ? '/W' : ''}  tot bei ${f.zeit.toFixed(1)}s`);
    console.log(`    Feld ${f.feld[0]} … ${f.feld[1]}   spawnHalfWidth ${f.spawnHalb}   Bahn x ${f.korridorX}`);
    console.log(`    Objekte: ${f.objekte.join('  ')}\n`);
  }
}
