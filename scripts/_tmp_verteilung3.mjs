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
function welt(aspect, id) {
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
  const limit = Math.max(0.9, half - (pCfg.spriteHeight * ASPECTS[id]) / 2);
  const maxX = Math.min(CONFIG.world.bounds.maxX, limit);
  return { pCfg, world: { ...CONFIG.world, bounds: { minX: -maxX, maxX, minY: CONFIG.world.bounds.minY, maxY: CONFIG.world.bounds.maxY }, bahnX: CONFIG.world.bahnen.map((a) => a * maxX), spawnHalfWidth: Math.min(CONFIG.world.spawnHalfWidth, limit + 0.8) } };
}
function stufeBei(s) {
  const st = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < st.length; i++) if (s >= st[i].afterSeconds) idx = i;
  const l = st[st.length - 1];
  if (s >= l.afterSeconds) idx = (st.length - 1 + Math.floor((s - l.afterSeconds) / CONFIG.wall.stageLoopSeconds)) % st.length;
  return st[idx];
}

function messen(aspect, id, sekunden, seed, modus) {
  const echt = Math.random; Math.random = rng(seed);
  try {
    const { pCfg, world } = welt(aspect, id);
    const diff = new DifficultyCurve(CONFIG.difficulty);
    diff.setRockMix(CONFIG.rock.mix);
    const sp = new Spawner({ add() {} }, CONFIG, diff, world, null);
    sp.bananasEnabled = false;
    sp.setSpieler(pCfg);
    sp.reset();

    const zaehler = new Array(world.bahnX.length).fill(0);
    let entfallen = 0, einzige = 0, gesamt = 0;
    const origFrei = sp._freieStelle.bind(sp);
    sp._freieStelle = (type, hr) => {
      const x = origFrei(type, hr);
      if (x === null) { entfallen++; return x; }
      const i = world.bahnX.findIndex((b) => Math.abs(b - x) < 1e-9);
      if (i >= 0) { zaehler[i]++; gesamt++; }
      return x;
    };
    const origWaehlen = sp._bahnWaehlen.bind(sp);
    sp._bahnWaehlen = (frei, alle) => {
      if (frei.length === 1) einzige++;
      if (modus === 'gleich') return frei[Math.floor(Math.random() * frei.length)];
      if (modus === 'zaehleImmer' && frei.length === 1) {
        if (!sp._bahnZaehler || sp._bahnZaehler.length !== alle.length) sp._bahnZaehler = new Array(alle.length).fill(0);
        const i = alle.indexOf(frei[0]);
        if (i >= 0) sp._bahnZaehler[i]++;
        return frei[0];
      }
      return origWaehlen(frei, alle);
    };

    const frames = Math.round(sekunden / DT);
    for (let f = 0; f < frames; f++) {
      diff.update(DT);
      sp.hazardLook = stufeBei(diff.elapsed).hazard;
      sp.update(DT, false, diff.scrollSpeed);
    }
    return { zaehler, gesamt, entfallen, einzige };
  } finally { Math.random = echt; }
}

for (const [fname, aspect] of Object.entries({ hoch: 9 / 19.5, quer: 16 / 9 })) {
  for (const modus of ['code', 'zaehleImmer', 'gleich']) {
    const summe = [0, 0, 0, 0]; let g = 0, e = 0, ein = 0;
    for (let s = 0; s < 8; s++) {
      const r = messen(aspect, 'braun', 1500, 1000 + s * 7919, modus);
      r.zaehler.forEach((n, i) => (summe[i] += n));
      g += r.gesamt; e += r.entfallen; ein += r.einzige;
    }
    console.log(`${fname} ${modus.padEnd(11)} ${g} Steine, ${e} entfallen (${((e / (g + e)) * 100).toFixed(1)} %), ${ein}x nur eine Bahn frei  ->  ${summe.map((n) => ((n / g) * 100).toFixed(1) + '%').join(' / ')}`);
  }
}
