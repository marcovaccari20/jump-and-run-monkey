/**
 * Haerterer Nachtest: NICHT ein Resize, sondern dauernd wechselnde Formate,
 * exakt ueber den Pfad, den Game._updateWorldBounds wirklich geht
 * (bounds mutieren + korridor.grenzenAendern + Spieler klemmen).
 * Misst zusaetzlich, wie viele Objekte neben dem sichtbaren Feld landen.
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
const SEKUNDEN = arg('sekunden', 420);
const PERIODE = arg('periode', 2.0); // alle X Sekunden neues Format
const DT = 1 / 60;
const RESERVE = arg('reserve', 0.75);
const AFFE = String(arg('affe', 'braun'));
const OHNEFIX = process.argv.includes('--ohnefix');

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
function abziehen(m, verboten) {
  let cur = m;
  for (const [va, vb] of verboten) {
    const nx = [];
    for (const [a, b] of cur) {
      if (vb <= a || va >= b) { nx.push([a, b]); continue; }
      if (va > a) nx.push([a, Math.min(va, b)]);
      if (vb < b) nx.push([Math.max(vb, a), b]);
    }
    cur = nx;
  }
  return cur.filter(([a, b]) => b - a > 1e-9);
}
const breiteste = (m) => m.reduce((x, [a, b]) => Math.max(x, b - a), 0);

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
function stufeBei(s) {
  const st = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < st.length; i++) if (s >= st[i].afterSeconds) idx = i;
  const letzte = st[st.length - 1];
  if (s >= letzte.afterSeconds) {
    const extra = Math.floor((s - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (st.length - 1 + extra) % st.length;
  }
  return st[idx];
}

// Von extrem breit bis extrem schmal, inkl. Werte jenseits realer Geraete.
const FORMATE = [21 / 9, 16 / 9, 4 / 3, 1, 3 / 4, 9 / 16, 9 / 19.5, 9 / 21, 0.35];

function lauf({ seed, steigt, hoehe }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const charCfg = CONFIG.characters.list[AFFE];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const hitRadius = pCfg.hitRadius;
    const ignoreR = charCfg.ignoreRockRadius ?? 0;

    const b0 = bounds(16 / 9, hitRadius);
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
    let naechsterWechsel = PERIODE;
    let aussen = 0, wechsel = 0;
    let neben = 0, gesamtObj = 0;
    // Rocks sind gepoolt -> Objekt-Identitaet wiederholt sich. "Neu" heisst:
    // war im letzten Frame nicht aktiv.
    let warAktiv = new Set();

    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;

      if (t >= naechsterWechsel) {
        naechsterWechsel = t + PERIODE;
        wechsel++;
        const b1 = bounds(FORMATE[Math.floor(Math.random() * FORMATE.length)], hitRadius);
        world.bounds.minX = b1.minX;
        world.bounds.maxX = b1.maxX;
        world.spawnHalfWidth = b1.spawnHalfWidth;
        if (!OHNEFIX) spawner.korridor.grenzenAendern(b1.minX, b1.maxX);
        S = ordnen(S.map(([a, b]) => [
          Math.min(Math.max(a, b1.minX), b1.maxX),
          Math.min(Math.max(b, b1.minX), b1.maxX),
        ]));
      }

      const base = difficulty.scrollSpeed;
      const assisted = base + (steigt ? pCfg.climbAssist : 0);
      const scroll = Math.max(assisted, base * pCfg.minScrollFactor);
      spawner.hazardLook = stufeBei(t).hazard;

      S = aufweiten(S, schritt, world.bounds.minX, world.bounds.maxX);
      spawner.update(DT, false, scroll);

      const kx = spawner.korridor.x;
      if (kx < world.bounds.minX - 1e-6 || kx > world.bounds.maxX + 1e-6) aussen++;

      const verboten = [];
      const jetztAktiv = new Set();
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        jetztAktiv.add(r);
        if (!warAktiv.has(r)) {
          gesamtObj++;
          if (Math.abs(r.x) > world.spawnHalfWidth + 1e-6) neben++;
        }
        if (r.radius <= ignoreR) continue;
        const R = hitRadius + r.hitRadius;
        const dy = py - r.y;
        const rest = R * R - dy * dy;
        if (rest <= 0) continue;
        const halb = Math.sqrt(rest);
        verboten.push([r.x - halb, r.x + halb]);
      }
      warAktiv = jetztAktiv;
      S = abziehen(S, verboten);

      if (S.length === 0) {
        return { ok: false, seed, zeit: t, aussen, wechsel, neben, gesamtObj,
          korridorX: +kx.toFixed(2),
          feld: [+world.bounds.minX.toFixed(2), +world.bounds.maxX.toFixed(2)],
          spawnHalb: +world.spawnHalfWidth.toFixed(2),
          objekte: spawner.rocks.active.filter((r) => Math.abs(r.y - py) < 2)
            .map((r) => `${r.type.id[0]}@${r.x.toFixed(2)}`).sort() };
      }
    }
    return { ok: true, seed, engste: breiteste(S), aussen, wechsel, neben, gesamtObj };
  } finally { Math.random = echt; }
}

const HOEHEN = [CONFIG.world.bounds.minY, -1.4, 0, 1.4, CONFIG.world.bounds.maxY];
console.log(`Dauer-Resize — ${LAEUFE} Laeufe a ${SEKUNDEN}s, alle ${PERIODE}s neues Format, Affe ${AFFE}${OHNEFIX ? ' (OHNE grenzenAendern)' : ' (mit grenzenAendern, wie Game.js)'}\n`);
let fail = 0, aussenSum = 0, wechselSum = 0, nebenSum = 0, objSum = 0, engste = Infinity;
const fehler = [];
for (let i = 0; i < LAEUFE; i++) {
  for (const steigt of [false, true]) {
    const r = lauf({ seed: 1000 + i * 7919, steigt, hoehe: HOEHEN[i % HOEHEN.length] });
    aussenSum += r.aussen; wechselSum += r.wechsel; nebenSum += r.neben; objSum += r.gesamtObj;
    if (r.ok) engste = Math.min(engste, r.engste);
    else { fail++; if (fehler.length < 5) fehler.push({ ...r, steigt }); }
  }
}
console.log(`Formatwechsel gesamt: ${wechselSum}`);
console.log(`Bahn ausserhalb des Feldes: ${aussenSum} Frames`);
console.log(`Objekte neben dem sichtbaren Band: ${nebenSum} von ${objSum}`);
if (!fail) console.log(`BESTANDEN — ${LAEUFE * 2} Laeufe. Engster Spielraum ${engste.toFixed(3)}`);
else {
  console.log(`DURCHGEFALLEN — ${fail} von ${LAEUFE * 2} Laeufen.\n`);
  for (const f of fehler) {
    console.log(`  Seed ${f.seed}${f.steigt ? '/W' : ''}  tot bei ${f.zeit.toFixed(1)}s`);
    console.log(`    Feld ${f.feld[0]} … ${f.feld[1]}   spawnHalfWidth ${f.spawnHalb}   Bahn x ${f.korridorX}`);
    console.log(`    Objekte: ${f.objekte.join('  ')}\n`);
  }
}
