/* TEMPORAER (Pruefung) — Gilt die CONFIG-Zusage
 *   |Objekt.x - Korridor(t)| >= halbbreite + Spielerradius + Objektradius + reserve
 * noch, seit _freieStelle mit mindestAbstand = rand + reserve gegen BAHNEN misst?
 *
 * Aufbau wie scripts/fairness.mjs (inkl. bahnX!), Messung wie korridor-audit.
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { Rock } from '../src/entities/Rock.js';
import { halfWidthAt } from '../src/core/viewport.js';

const arg = (n, fb) => {
  const i = process.argv.indexOf(`--${n}`);
  if (i < 0) return fb;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
};
const SEKUNDEN = arg('sekunden', 400);
const LAEUFE = arg('laeufe', 4);
const DT = 1 / 60;
const HB = arg('halbbreite', null);
if (HB !== null) CONFIG.rock.korridor.halbbreite = Number(HB);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEITE = { braun: 407 / 725, weiss: 454 / 864, orange: 538 / 889 };

function spielfeld(aspect, pCfg, affe) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const base = CONFIG.world;
  const halbeAffenBreite = ((pCfg.spriteHeight ?? CONFIG.player.spriteHeight) * (SEITE[affe] ?? 0.56)) / 2;
  const half = halfWidthAt(camera, 0, (pCfg.startPosition ?? CONFIG.player.startPosition)[1]);
  const limit = Math.max(0.9, half - halbeAffenBreite);
  return {
    ...base,
    bounds: {
      minX: Math.max(base.bounds.minX, -limit),
      maxX: Math.min(base.bounds.maxX, limit),
      minY: base.bounds.minY,
      maxY: base.bounds.maxY,
    },
    bahnX: base.bahnen.map((a) => a * limit),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
  };
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

function lauf({ seed, affe, aspect, sammel }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const world = spielfeld(aspect, pCfg, affe);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const k = CONFIG.rock.korridor;
    let pending = null;
    const orig = spawner._freieStelle.bind(spawner);
    spawner._freieStelle = (type, hr) => {
      pending = {
        rand: pCfg.hitRadius + hr,
        zusage: k.halbbreite + pCfg.hitRadius + hr + k.reserve,
        art: type.id,
      };
      const x = orig(type, hr);
      if (x === null) {
        pending = null;
        sammel.entfallen++;
      } else {
        // Fingerabdruck aller Abwurfstellen: aendert sich er nicht, hat der
        // geaenderte Parameter auf die Platzierung keinerlei Wirkung.
        sammel.fp = (sammel.fp * 31 + Math.round((x + 20) * 1000)) % 1000000007;
        sammel.summeX += Math.abs(x);
      }
      return x;
    };
    const origSpawn = Rock.prototype.spawn;
    Rock.prototype.spawn = function (...a) {
      origSpawn.apply(this, a);
      this._rec = pending;
      pending = null;
      sammel.gespawnt++;
    };

    const frames = Math.round(SEKUNDEN / DT);
    let achse = 1;
    // Korridortempo mitschreiben
    let tempoSumme = 0;
    let tempoMin = Infinity;
    let tempoMax = -Infinity;
    let kxMin = Infinity;
    let kxMax = -Infinity;

    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      if (Math.random() < 0.06) achse = Math.random() < 0.5 ? 1 : -1;
      const base = difficulty.scrollSpeed;
      const scroll = Math.max(base + achse * pCfg.climbAssist, base * pCfg.minScrollFactor);
      spawner.hazardLook = stufeBei(t).hazard;

      const tempo = spawner.korridorTempo;
      tempoSumme += tempo;
      if (tempo < tempoMin) tempoMin = tempo;
      if (tempo > tempoMax) tempoMax = tempo;

      spawner.update(DT, false, scroll);

      const jetzt = spawner.korridor.jetzt;
      const kx = spawner.korridor.bei(jetzt);
      if (kx < kxMin) kxMin = kx;
      if (kx > kxMax) kxMax = kx;

      for (const r of spawner.rocks.active) {
        if (!r.active || !r._rec) continue;
        const randR = pCfg.hitRadius + r.hitRadius;
        if (r.y > world.bounds.maxY + randR || r.y < world.bounds.minY - randR) continue;
        const ist = Math.abs(r.x - kx);
        const luft = ist - r._rec.zusage;
        const e = (sammel.proArt[r._rec.art] ??= { minLuft: Infinity, minIst: Infinity, verletzt: 0, frames: 0, zusage: r._rec.zusage });
        e.frames++;
        if (luft < e.minLuft) e.minLuft = luft;
        if (ist < e.minIst) e.minIst = ist;
        if (luft < -1e-9) {
          e.verletzt++;
          sammel.verletzt++;
          if (-luft > sammel.maxEindringen) {
            sammel.maxEindringen = -luft;
            sammel.bsp = {
              t: +t.toFixed(2), affe, art: r._rec.art,
              objX: +r.x.toFixed(3), korridorX: +kx.toFixed(3),
              istAbstand: +ist.toFixed(3), zusage: +r._rec.zusage.toFixed(3),
              bahnen: world.bahnX.map((x) => +x.toFixed(3)),
            };
          }
        }
        sammel.frames++;
      }
    }
    Rock.prototype.spawn = origSpawn;
    sammel.tempo.push({ mittel: tempoSumme / frames, min: tempoMin, max: tempoMax, wanderung: kxMax - kxMin });
  } finally {
    Math.random = echt;
  }
}

const FORMATE = { hoch: 390 / 844, quer: 16 / 9 };
console.log(`halbbreite = ${CONFIG.rock.korridor.halbbreite}, reserve = ${CONFIG.rock.korridor.reserve}\n`);
for (const affe of Object.keys(CONFIG.characters.list)) {
  for (const [fn, aspect] of Object.entries(FORMATE)) {
    const sammel = { frames: 0, verletzt: 0, maxEindringen: 0, bsp: null, proArt: {}, gespawnt: 0, entfallen: 0, tempo: [], fp: 7, summeX: 0 };
    for (let i = 0; i < LAEUFE; i++) lauf({ seed: 1000 + i * 7919, affe, aspect, sammel });
    const q = sammel.frames ? ((sammel.verletzt / sammel.frames) * 100).toFixed(1) : '—';
    console.log(
      `${affe.padEnd(6)} ${fn.padEnd(4)} gespawnt=${sammel.gespawnt} entfallen=${sammel.entfallen} ` +
        `| Zusage verletzt in ${q} % der Gefahren-Frames, tiefstens um ${sammel.maxEindringen.toFixed(3)}`,
    );
    for (const [art, e] of Object.entries(sammel.proArt)) {
      console.log(
        `        ${art.padEnd(7)} zusage=${e.zusage.toFixed(3)} kleinster IST-Abstand=${e.minIst.toFixed(3)} ` +
          `(fehlt ${(-e.minLuft).toFixed(3)}), verletzt ${((e.verletzt / e.frames) * 100).toFixed(1)} %`,
      );
    }
    const tm = sammel.tempo[0];
    console.log(`        korridorTempo mittel=${tm.mittel.toFixed(3)} min=${tm.min.toFixed(3)} max=${tm.max.toFixed(3)} Wanderung=${tm.wanderung.toFixed(2)} | Abwurf-Fingerabdruck=${sammel.fp} summe|x|=${sammel.summeX.toFixed(2)}`);
  }
}
