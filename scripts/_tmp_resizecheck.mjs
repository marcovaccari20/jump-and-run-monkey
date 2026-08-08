/**
 * Prueft die Lueckengarantie ueber einen Resize hinweg.
 * Gleiches Mengenmodell wie scripts/fairness.mjs, aber worldView wird
 * mitten im Lauf umgestellt — genau wie Game._updateWorldBounds es tut.
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';

const ASPECTS = { braun: 407 / 725, weiss: 454 / 864, orange: 538 / 889 };
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
function ordnen(m) {
  if (!m.length) return m;
  m.sort((p, q) => p[0] - q[0]);
  const out = [m[0]];
  for (let i = 1; i < m.length; i++) {
    const l = out[out.length - 1];
    if (m[i][0] <= l[1] + 1e-9) { if (m[i][1] > l[1]) l[1] = m[i][1]; }
    else out.push(m[i]);
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
function abziehen(m, v) {
  let akt = m;
  for (const [va, vb] of v) {
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
function limitFuer(aspect, id) {
  const ch = CONFIG.characters.list[id];
  const pCfg = { ...CONFIG.player, ...ch.player };
  const c = CONFIG.render.camera;
  const cam = new PerspectiveCamera(c.fov, aspect, c.near, c.far);
  cam.position.set(...c.position);
  cam.lookAt(...c.lookAt);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const half = halfWidthAt(cam, 0, pCfg.startPosition[1]);
  return Math.max(0.9, half - (pCfg.spriteHeight * ASPECTS[id]) / 2);
}
/** Genau Game._updateWorldBounds, in place. */
function anwenden(view, limit) {
  const base = CONFIG.world;
  view.bounds.minX = Math.max(base.bounds.minX, -limit);
  view.bounds.maxX = Math.min(base.bounds.maxX, limit);
  view.bahnX = base.bahnen.map((a) => a * view.bounds.maxX);
  view.spawnHalfWidth = Math.min(base.spawnHalfWidth, limit + 0.8);
}
function traegheitsFaktor(pCfg) {
  const d = CONFIG.difficulty;
  const T = d.dichte.mindestAbstand / d.tempo.max;
  const a = pCfg.acceleration;
  return Math.max(0.15, Math.min(1, 1 - (2 / (a * T)) * (1 - Math.exp(-a * T))));
}
function stufeBei(s) {
  const st = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < st.length; i++) if (s >= st[i].afterSeconds) idx = i;
  const l = st[st.length - 1];
  if (s >= l.afterSeconds) idx = (st.length - 1 + Math.floor((s - l.afterSeconds) / CONFIG.wall.stageLoopSeconds)) % st.length;
  return st[idx];
}

function lauf({ seed, id, a1, a2, resizeBei, sekunden }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const ch = CONFIG.characters.list[id];
    const pCfg = { ...CONFIG.player, ...ch.player };
    const l1 = limitFuer(a1, id), l2 = limitFuer(a2, id);
    const view = { ...CONFIG.world, bounds: { ...CONFIG.world.bounds } };
    anwenden(view, l1);

    const diff = new DifficultyCurve(CONFIG.difficulty);
    diff.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, diff, view, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const py = pCfg.startPosition[1];
    const schritt = pCfg.moveSpeed * traegheitsFaktor(pCfg) * DT;
    let S = [[0, 0]];
    let umgestellt = false;

    const frames = Math.round(sekunden / DT);
    for (let f = 0; f < frames; f++) {
      diff.update(DT);
      const t = diff.elapsed;
      if (!umgestellt && t >= resizeBei) {
        umgestellt = true;
        anwenden(view, l2);
        spawner.korridor.grenzenAendern(view.bounds.minX, view.bounds.maxX);
        S = aufweiten(S, 0, view.bounds.minX, view.bounds.maxX);
      }
      spawner.hazardLook = stufeBei(t).hazard;
      S = aufweiten(S, schritt, view.bounds.minX, view.bounds.maxX);
      spawner.update(DT, false, diff.scrollSpeed);
      const verboten = [];
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        if (r.radius <= (ch.ignoreRockRadius ?? 0)) continue;
        const R = pCfg.hitRadius + r.hitRadius;
        const dy = py - r.y;
        const rest = R * R - dy * dy;
        if (rest <= 0) continue;
        const halb = Math.sqrt(rest);
        verboten.push([r.x - halb, r.x + halb]);
      }
      S = abziehen(S, verboten);
      if (S.length === 0) {
        return { ok: false, t, seed, objekte: spawner.rocks.active.filter((r) => Math.abs(r.y - py) < 2).map((r) => `${r.type.id[0]}@${r.x.toFixed(2)}`), bahn: view.bahnX.map((x) => +x.toFixed(2)), feld: [+view.bounds.minX.toFixed(2), +view.bounds.maxX.toFixed(2)] };
      }
    }
    return { ok: true };
  } finally { Math.random = echt; }
}

const faelle = [
  ['1600x900 -> 1200x900', 16 / 9, 4 / 3],
  ['1200x900 -> 1600x900', 4 / 3, 16 / 9],
  ['390x844 -> 390x750', 390 / 844, 390 / 750],
  ['390x844 -> 844x390', 390 / 844, 844 / 390],
  ['844x390 -> 390x844', 844 / 390, 390 / 844],
];
for (const id of ['braun', 'weiss', 'orange']) {
  for (const [name, a1, a2] of faelle) {
    let fehler = 0; let erst = null;
    for (let i = 0; i < 60; i++) {
      const r = lauf({ seed: 1000 + i * 7919, id, a1, a2, resizeBei: 40 + (i % 20) * 6.3, sekunden: 200 });
      if (!r.ok) { fehler++; if (!erst) erst = r; }
    }
    console.log(`${id.padEnd(7)} ${name.padEnd(22)} ${fehler}/60 durchgefallen ${erst ? `— erste bei ${erst.t.toFixed(1)}s, Feld ${erst.feld}, Bahnen ${erst.bahn}, Objekte ${erst.objekte.join(' ')}` : ''}`);
  }
}
