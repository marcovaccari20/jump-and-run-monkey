/**
 * Widerlegungsversuch: Bahnen wandern beim Resize, fliegende Objekte nicht.
 * Baut Game._updatePlaying + Game._updateWorldBounds mit den ECHTEN Systemen nach.
 */
import { readFileSync } from 'node:fs';
import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { DifficultyCurve } from './src/systems/DifficultyCurve.js';
import { Spawner } from './src/systems/Spawner.js';
import { halfWidthAt } from './src/core/viewport.js';

/* --- echte Bildmasse der Affen aus den WebP-Dateien lesen ---------------- */
function webpSize(pfad) {
  const b = readFileSync(pfad);
  // VP8X / VP8L / VP8 lossy
  const tag = b.toString('ascii', 12, 16);
  if (tag === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
  if (tag === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (tag === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error('unbekannt ' + tag);
}

const AFFE = process.env.AFFE ?? 'braun';
const charCfg = CONFIG.characters.list[AFFE];
const pCfg = { ...CONFIG.player, ...charCfg.player };
const bild = webpSize('./public' + charCfg.framePath.replace('{n}', '00'));
const SPRITE_W = pCfg.spriteHeight * (bild.w / bild.h);
console.log(`Affe ${AFFE}: Bild ${bild.w}x${bild.h} -> spriteWidth ${SPRITE_W.toFixed(4)}, hitRadius ${pCfg.hitRadius}`);

/* --- Game._updateWorldBounds, wörtlich ---------------------------------- */
const camCfg = CONFIG.render.camera;
function feld(aspect) {
  const c = new PerspectiveCamera(camCfg.fov, aspect, camCfg.near, camCfg.far);
  c.position.set(...camCfg.position);
  c.lookAt(...camCfg.lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  c.matrixWorldInverse.copy(c.matrixWorld).invert();
  const half = halfWidthAt(c, 0, pCfg.startPosition[1]);
  const limit = Math.max(0.9, half - SPRITE_W / 2);
  const base = CONFIG.world;
  return {
    minX: Math.max(base.bounds.minX, -limit),
    maxX: Math.min(base.bounds.maxX, limit),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
  };
}
function anwenden(world, spawner, aspect) {
  const f = feld(aspect);
  world.bounds.minX = f.minX;
  world.bounds.maxX = f.maxX;
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
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 60;

/**
 * @param plan {(t:number)=>number|null} liefert das Seitenverhältnis, wenn in
 *   diesem Frame ein resize feuert, sonst null.
 */
function lauf({ seed, sekunden, startAspect, plan }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const f0 = feld(startAspect);
    const world = {
      ...CONFIG.world,
      bounds: { minX: f0.minX, maxX: f0.maxX, minY: CONFIG.world.bounds.minY, maxY: CONFIG.world.bounds.maxY },
      bahnX: CONFIG.world.bahnen.map((a) => a * f0.maxX),
      spawnHalfWidth: f0.spawnHalfWidth,
    };

    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    // Spieler exakt wie SpritePlayer.reset(bahnX)
    const py = pCfg.startPosition[1] + (pCfg.hitOffsetY ?? 0);
    const pr = pCfg.hitRadius;
    let zielBahn = 0;
    for (let i = 1; i < world.bahnX.length; i++) {
      if (Math.abs(world.bahnX[i] - pCfg.startPosition[0]) < Math.abs(world.bahnX[zielBahn] - pCfg.startPosition[0])) zielBahn = i;
    }
    let px = world.bahnX[zielBahn];

    const rate = 3 / Math.max(0.02, pCfg.bahnWechselZeit ?? 0.16);
    const frames = Math.round(sekunden / DT);

    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;

      const a = plan(t);
      if (a !== null) anwenden(world, spawner, a);

      spawner.hazardLook = stufeBei(t).hazard;
      const base = difficulty.scrollSpeed;

      /* Spieler: er will auf die Bahn, die der garantierten Kurve JETZT am
       * nächsten liegt — genau das Modell aus Spawner._noetigeBahnen. */
      const kx = spawner.korridor.bei(spawner.korridor.jetzt);
      let best = 0;
      for (let i = 1; i < world.bahnX.length; i++) {
        if (Math.abs(world.bahnX[i] - kx) < Math.abs(world.bahnX[best] - kx)) best = i;
      }
      zielBahn = best;

      const ziel = world.bahnX[zielBahn];
      const rest = ziel - px;
      let schritt = rest * (1 - Math.exp(-rate * DT));
      const maxSchritt = pCfg.moveSpeed * DT;
      if (schritt > maxSchritt) schritt = maxSchritt;
      else if (schritt < -maxSchritt) schritt = -maxSchritt;
      px += schritt;
      if (Math.abs(ziel - px) < 0.002) px = ziel;
      if (px < world.bounds.minX) px = world.bounds.minX;
      else if (px > world.bounds.maxX) px = world.bounds.maxX;

      spawner.update(DT, false, base);

      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        if (r.radius <= (charCfg.ignoreRockRadius ?? 0)) continue;
        const dx = px - r.x;
        const dy = py - r.y;
        const R = pr + r.hitRadius;
        if (dx * dx + dy * dy <= R * R) {
          return {
            ok: false, seed, t,
            treffer: { x: +r.x.toFixed(3), y: +r.y.toFixed(2), typ: r.type.id, hitR: +r.hitRadius.toFixed(3) },
            px: +px.toFixed(3), ziel: +ziel.toFixed(3),
            bahnX: world.bahnX.map((v) => +v.toFixed(3)),
            korridor: +kx.toFixed(3),
            feld: +world.bounds.maxX.toFixed(3),
          };
        }
      }
    }
    return { ok: true, seed };
  } finally {
    Math.random = echt;
  }
}

/* ------------------------------------------------------------------ Läufe */
const HOCH = 9 / 19.5;
const QUER = 16 / 9;
const N = Number(process.env.N ?? 40);

function serie(name, startAspect, planFactory, sekunden = 300) {
  let fail = 0;
  const beispiele = [];
  for (let i = 0; i < N; i++) {
    const r = lauf({ seed: 1000 + i * 7919, sekunden, startAspect, plan: planFactory() });
    if (!r.ok) { fail++; if (beispiele.length < 3) beispiele.push(r); }
  }
  console.log(`${name}: ${fail}/${N} Treffer`);
  for (const b of beispiele) {
    console.log(`   t=${b.t.toFixed(1)}s  Stein ${b.treffer.typ}@x=${b.treffer.x} (y=${b.treffer.y}, r=${b.treffer.hitR})`);
    console.log(`   Affe x=${b.px} auf Bahn ${b.ziel}; Bahnen ${JSON.stringify(b.bahnX)}; Korridor ${b.korridor}; Feld ±${b.feld}`);
  }
  return fail;
}

console.log(`Feld hoch (9:19.5): ±${feld(HOCH).maxX.toFixed(4)}   quer (16:9): ±${feld(QUER).maxX.toFixed(4)}`);
const lh = feld(HOCH).maxX;
console.log(`Bahnen hoch: ${CONFIG.world.bahnen.map((a) => (a * lh).toFixed(3)).join(' ')}`);

// Resonanz-Seitenverhältnis: neue INNERE Bahn == alte ÄUSSERE Bahn
let lo = HOCH, hi = 4;
for (let i = 0; i < 80; i++) {
  const mid = (lo + hi) / 2;
  if (feld(mid).maxX / 3 < lh) lo = mid; else hi = mid;
}
const RES = (lo + hi) / 2;
console.log(`Resonanz-Aspect: ${RES.toFixed(4)}  (Feld ±${feld(RES).maxX.toFixed(4)}, innere Bahn ${(feld(RES).maxX / 3).toFixed(4)} vs alte äussere ${lh.toFixed(4)})\n`);

serie('A ohne Resize (hoch)', HOCH, () => () => null);
serie('A ohne Resize (quer)', QUER, () => () => null);

// B: Ziehen von hoch auf quer in 1.5 s, ab t=40
const T0 = 40, DAUER = 1.5;
serie('B ziehen hoch->quer in 1.5s @40s', HOCH, () => (t) => {
  if (t < T0 || t > T0 + DAUER) return null;
  const u = (t - T0) / DAUER;
  return HOCH + (QUER - HOCH) * u;
});
serie('B2 ziehen quer->hoch in 1.5s @40s', QUER, () => (t) => {
  if (t < T0 || t > T0 + DAUER) return null;
  const u = (t - T0) / DAUER;
  return QUER + (HOCH - QUER) * u;
});

// C: eine einzelne Drehung auf das Resonanzformat
serie('C einzelne Drehung hoch->Resonanz @40s', HOCH, () => {
  let getan = false;
  return (t) => { if (!getan && t >= T0) { getan = true; return RES; } return null; };
});
