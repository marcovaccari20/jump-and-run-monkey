/**
 * Wie scripts/fairness.mjs, aber mit einer DREHUNG des Geraets mitten im Lauf:
 * Game._onResize -> _updateWorldBounds mutiert `worldView` IN PLACE. Der
 * Korridor hat zu diesem Zeitpunkt aber schon Wegpunkte bis jetzt+horizont
 * gebaut — mit den ALTEN Grenzen.
 *
 * Aufruf: node scripts/_probe_resize.mjs <drehSekunde> <laeufe> <sekunden>
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';

const DREH = Number(process.argv[2] ?? 60);
const LAEUFE = Number(process.argv[3] ?? 24);
const SEKUNDEN = Number(process.argv[4] ?? 120);
const AFFE = String(process.argv[5] ?? 'braun');
const DT = 1 / 60;
const RESERVE = 0.75;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function ordnen(m) {
  if (!m.length) return m;
  m.sort((p, q) => p[0] - q[0]);
  const out = [m[0]];
  for (let i = 1; i < m.length; i++) {
    const l = out[out.length - 1];
    if (m[i][0] <= l[1] + 1e-9) { if (m[i][1] > l[1]) l[1] = m[i][1]; } else out.push(m[i]);
  }
  return out;
}
function aufweiten(m, d, lo, hi) {
  const out = [];
  for (const [a, b] of m) {
    const na = Math.max(lo, a - d), nb = Math.min(hi, b + d);
    if (nb > na - 1e-9) out.push([na, nb]);
  }
  return ordnen(out);
}
function abziehen(m, verboten) {
  let akt = m;
  for (const [va, vb] of verboten) {
    const n = [];
    for (const [a, b] of akt) {
      if (vb <= a || va >= b) { n.push([a, b]); continue; }
      if (va > a) n.push([a, Math.min(va, b)]);
      if (vb < b) n.push([Math.max(vb, a), b]);
    }
    akt = n;
  }
  return akt.filter(([a, b]) => b - a > 1e-9);
}
const breiteste = (m) => m.reduce((x, [a, b]) => Math.max(x, b - a), 0);

/** limit + spawnHalfWidth exakt wie Game._updateWorldBounds. */
function masse(aspect, hitRadius) {
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
function stufeBei(s) {
  const st = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < st.length; i++) if (s >= st[i].afterSeconds) idx = i;
  const l = st[st.length - 1];
  if (s >= l.afterSeconds) {
    const extra = Math.floor((s - l.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (st.length - 1 + extra) % st.length;
  }
  return st[idx];
}

const charCfg = CONFIG.characters.list[AFFE];
const pCfg = { ...CONFIG.player, ...charCfg.player };
const quer = masse(16 / 9, pCfg.hitRadius);
const hoch = masse(9 / 19.5, pCfg.hitRadius);

function lauf(seed, drehen, heilen = 'nein') {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const world = {
      ...CONFIG.world,
      bounds: { minX: quer.minX, maxX: quer.maxX, minY: CONFIG.world.bounds.minY, maxY: CONFIG.world.bounds.maxY },
      spawnHalfWidth: quer.spawnHalfWidth,
    };
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const py = -1.4;
    const schritt = pCfg.moveSpeed * RESERVE * DT;
    let S = [[0, 0]];
    let gedreht = false;
    let engste = Infinity;
    let maxRaus = -Infinity;
    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;

      if (drehen && !gedreht && t >= DREH) {
        // GENAU das, was Game._onResize tut: worldView in place verengen.
        world.bounds.minX = hoch.minX;
        world.bounds.maxX = hoch.maxX;
        world.spawnHalfWidth = hoch.spawnHalfWidth;
        // Der Affe wird von Player.update auf die neuen Grenzen geklemmt.
        S = S.map(([a, b]) => [Math.max(hoch.minX, a), Math.min(hoch.maxX, b)]).filter(([a, b]) => b >= a);
        // MOEGLICHE HEILUNGEN — zeigen, ob die alten Wegpunkte die Ursache sind.
        const kk = spawner.korridor;
        if (heilen === 'klemmen') {
          for (let i = 0; i < kk._anzahl; i++) {
            const j = kk._index(i);
            kk._x[j] = Math.min(hoch.maxX, Math.max(hoch.minX, kk._x[j]));
          }
        } else if (heilen === 'neu') {
          const jetzt = kk.jetzt;
          kk.reset(Math.min(hoch.maxX, Math.max(hoch.minX, kk.x)));
          kk.jetzt = jetzt;
          kk._t[kk._index(0)] = jetzt;
        } else if (heilen === 'echt') {
          // GENAU Game.js:880 — das, was das Spiel heute wirklich tut.
          kk.grenzenAendern(world.bounds.minX, world.bounds.maxX);
        }
        gedreht = true;
      }

      spawner.hazardLook = stufeBei(t).hazard;
      S = aufweiten(S, schritt, world.bounds.minX, world.bounds.maxX);
      spawner.update(DT, false, difficulty.scrollSpeed);

      // Wie weit ragt die geplante ZUKUNFT der Bahn aus dem Feld?
      const kk2 = spawner.korridor;
      for (let q = 0; q < kk2._anzahl; q++) {
        const xq = kk2._x[kk2._index(q)];
        const raus = Math.max(world.bounds.minX - xq, xq - world.bounds.maxX);
        if (raus > maxRaus) maxRaus = raus;
      }

      const verboten = [];
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        const R = pCfg.hitRadius + r.hitRadius;
        const dy = py - r.y;
        const rest = R * R - dy * dy;
        if (rest <= 0) continue;
        const halb = Math.sqrt(rest);
        verboten.push([r.x - halb, r.x + halb]);
      }
      S = abziehen(S, verboten);
      if (t > 4) engste = Math.min(engste, breiteste(S));
      if (S.length === 0) {
        return { ok: false, seed, zeit: t, nachDrehung: gedreht ? +(t - DREH).toFixed(2) : null,
          korridorX: +spawner.korridor.x.toFixed(2), maxRaus,
          feld: [+world.bounds.minX.toFixed(2), +world.bounds.maxX.toFixed(2)] };
      }
    }
    return { ok: true, seed, engste, maxRaus };
  } finally {
    Math.random = echt;
  }
}

for (const [drehen, heilen, name] of [
  [false, 'nein', 'ohne Drehung (Kontrolle, quer)'],
  [true, 'nein', `MIT Drehung bei ${DREH}s, OHNE grenzenAendern (Zustand der Behauptung)`],
  [true, 'echt', `MIT Drehung, ECHTER Code (Game.js:880 grenzenAendern)`],
  [true, 'klemmen', `MIT Drehung, alte Wegpunkte geklemmt`],
  [true, 'neu', `MIT Drehung, Korridor neu aufgebaut`],
]) {
  let durch = 0;
  let engsteAlle = Infinity;
  let rausAlle = -Infinity;
  const fehler = [];
  for (let i = 0; i < LAEUFE; i++) {
    const r = lauf(1000 + i * 7919, drehen, heilen);
    rausAlle = Math.max(rausAlle, r.maxRaus);
    if (!r.ok) { durch++; if (fehler.length < 4) fehler.push(r); }
    else engsteAlle = Math.min(engsteAlle, r.engste);
  }
  console.log(`${name}: ` +
    `${durch}/${LAEUFE} durchgefallen` + (durch ? '' : `, engster Spielraum ${engsteAlle.toFixed(3)}`) +
    `  | Bahn max ${rausAlle.toFixed(3)} ausserhalb des Feldes`);
  for (const f of fehler) {
    console.log(`   Seed ${f.seed}: tot bei ${f.zeit.toFixed(2)}s (${f.nachDrehung}s nach der Drehung), ` +
      `Korridor bei x=${f.korridorX}, Feld ${f.feld[0]}…${f.feld[1]}`);
  }
}
console.log(`\nFeld quer: ${quer.minX.toFixed(2)}…${quer.maxX.toFixed(2)}  |  hoch: ${hoch.minX.toFixed(2)}…${hoch.maxX.toFixed(2)}`);
