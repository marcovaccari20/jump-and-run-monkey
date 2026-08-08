/**
 * Prüft, ob die Korridor-Garantie für einen Affen MIT Wischverzögerung hält.
 *
 * Der Modellspieler ist korridor-allwissend (Bestfall): er kennt die
 * garantierte Bahn exakt und wischt sofort, sobald die nächste Bahn wechselt.
 * Wenn selbst DER stirbt, ist die Zusicherung für ihn nachweislich falsch.
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function stufeBei(sek) {
  const stages = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < stages.length; i++) if (sek >= stages[i].afterSeconds) idx = i;
  const letzte = stages[stages.length - 1];
  if (sek >= letzte.afterSeconds) {
    const extra = Math.floor((sek - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (stages.length - 1 + extra) % stages.length;
  }
  return stages[idx];
}

const DT = 1 / 120;

function lauf({ seed, affeId, aspect, verzugOverride, startZeit, sekunden, halbeBreite }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const char = CONFIG.characters.list[affeId];
    const pCfg = { ...CONFIG.player, ...char.player };
    const ignoreR = char.ignoreRockRadius ?? 0;
    const verzug = verzugOverride ?? char.wischVerzoegerung ?? 0;

    const world = spielfeld(aspect, halbeBreite, pCfg);
    const d = new DifficultyCurve(CONFIG.difficulty);
    d.setRockMix(CONFIG.rock.mix);
    d.elapsed = startZeit;

    const spawner = new Spawner({ add() {} }, CONFIG, d, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const py = pCfg.startPosition[1];
    const bahnX = world.bahnX;
    // Start auf der Bahn, die der Startposition am nächsten liegt.
    let zielBahn = 0;
    for (let i = 1; i < bahnX.length; i++)
      if (Math.abs(bahnX[i]) < Math.abs(bahnX[zielBahn])) zielBahn = i;
    let px = bahnX[zielBahn];
    let pending = null;
    let uhr = 0;

    const naechsteBahnIdx = (x) => {
      let b = 0;
      for (let i = 1; i < bahnX.length; i++) if (Math.abs(bahnX[i] - x) < Math.abs(bahnX[b] - x)) b = i;
      return b;
    };

    let treffer = 0;
    let ersterTreffer = null;
    const frames = Math.round(sekunden / DT);
    for (let f = 0; f < frames; f++) {
      d.update(DT);
      const t = d.elapsed;
      spawner.hazardLook = stufeBei(t).hazard;
      const scroll = d.scrollSpeed;
      spawner.update(DT, false, scroll);

      /* --- Spieler: der garantierten Bahn folgen -------------------- */
      if (uhr > 0) {
        uhr -= DT;
        if (uhr <= 0) { uhr = 0; if (pending !== null) { zielBahn = pending; pending = null; } }
      } else {
        const soll = naechsteBahnIdx(spawner.korridor.bei(spawner.korridor.jetzt));
        if (soll !== zielBahn) {
          const dir = Math.sign(soll - zielBahn);
          const ziel = Math.max(0, Math.min(bahnX.length - 1, zielBahn + dir));
          if (verzug > 0) { pending = ziel; uhr = verzug; } else zielBahn = ziel;
        }
      }
      // Bewegung wie SpritePlayer.update
      const zx = bahnX[zielBahn];
      const rest = zx - px;
      const rate = 3 / Math.max(0.02, pCfg.bahnWechselZeit ?? 0.16);
      let schritt = rest * (1 - Math.exp(-rate * DT));
      const maxS = pCfg.moveSpeed * DT;
      if (schritt > maxS) schritt = maxS; else if (schritt < -maxS) schritt = -maxS;
      px += schritt;
      if (Math.abs(zx - px) < 0.002) px = zx;

      /* --- Kollision ------------------------------------------------ */
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        if (r.radius <= ignoreR) continue;
        const R = pCfg.hitRadius + r.hitRadius;
        const dx = r.x - px, dy = r.y - py;
        if (dx * dx + dy * dy < R * R) {
          treffer++;
          if (!ersterTreffer)
            ersterTreffer = { t: +t.toFixed(1), art: r.type.id, wand: +(t / CONFIG.difficulty.sekundenProWand).toFixed(2) };
          // Stein entfernen, damit ein Treffer nicht 20x zählt
          r.despawn(); spawner.rocks.release(r);
          break;
        }
      }
    }
    return { treffer, ersterTreffer };
  } finally {
    Math.random = echt;
  }
}

/* ------------------------------------------------------------------ Lauf */
const aspects = { hoch: 538 / 1165, quer: 16 / 9 };
const breiten = { braun: (2.5 * (407 / 725)) / 2, orange: (2.5 * (538 / 889)) / 2 };

for (const [aName, aspect] of Object.entries(aspects)) {
  for (const [label, cfg] of [
    ['braun  (kein Verzug)', { affeId: 'braun', verzugOverride: 0, halbeBreite: breiten.braun }],
    ['orange OHNE Verzug  ', { affeId: 'orange', verzugOverride: 0, halbeBreite: breiten.orange }],
    ['orange MIT 0.5 s    ', { affeId: 'orange', verzugOverride: undefined, halbeBreite: breiten.orange }],
  ]) {
    let ges = 0; let erster = null;
    for (let s = 1; s <= 8; s++) {
      const r = lauf({ seed: s * 7919, aspect, startZeit: 0, sekunden: 1400, ...cfg });
      ges += r.treffer;
      if (!erster && r.ersterTreffer) erster = r.ersterTreffer;
    }
    console.log(`${aName}  ${label}  Treffer in 8x1400s: ${ges}${erster ? `   erster: t=${erster.t}s Wand ${erster.wand} (${erster.art})` : ''}`);
  }
}
