import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';

const ASPECTS = { braun: 407 / 725, weiss: 454 / 864, orange: 538 / 889 };
const DT = 1 / 60;

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
  return {
    pCfg,
    world: {
      ...CONFIG.world,
      bounds: { minX: -maxX, maxX, minY: CONFIG.world.bounds.minY, maxY: CONFIG.world.bounds.maxY },
      bahnX: CONFIG.world.bahnen.map((a) => a * maxX),
      spawnHalfWidth: Math.min(CONFIG.world.spawnHalfWidth, limit + 0.8),
    },
  };
}
function stufeBei(s) {
  const st = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < st.length; i++) if (s >= st[i].afterSeconds) idx = i;
  const l = st[st.length - 1];
  if (s >= l.afterSeconds) idx = (st.length - 1 + Math.floor((s - l.afterSeconds) / CONFIG.wall.stageLoopSeconds)) % st.length;
  return st[idx];
}

function messen(aspect, id, sekunden, zaehleImmer) {
  const { pCfg, world } = welt(aspect, id);
  const diff = new DifficultyCurve(CONFIG.difficulty);
  diff.setRockMix(CONFIG.rock.mix);
  const sp = new Spawner({ add() {} }, CONFIG, diff, world, null);
  sp.bananasEnabled = false;
  sp.setSpieler(pCfg);
  sp.reset();

  if (zaehleImmer) {
    // Variante: auch bei nur einer freien Bahn zaehlen
    const orig = sp._bahnWaehlen.bind(sp);
    sp._bahnWaehlen = (frei, alle) => {
      if (frei.length === 1) {
        if (!sp._bahnZaehler || sp._bahnZaehler.length !== alle.length) sp._bahnZaehler = new Array(alle.length).fill(0);
        const i = alle.indexOf(frei[0]);
        if (i >= 0) sp._bahnZaehler[i]++;
        return frei[0];
      }
      return orig(frei, alle);
    };
  }

  const zaehler = new Array(world.bahnX.length).fill(0);
  let gesamt = 0, entfallen = 0;
  const gesehen = new Set();
  const frames = Math.round(sekunden / DT);
  for (let f = 0; f < frames; f++) {
    diff.update(DT);
    sp.hazardLook = stufeBei(diff.elapsed).hazard;
    const vorher = sp.rocks.activeCount;
    sp.update(DT, false, diff.scrollSpeed);
    for (const r of sp.rocks.active) {
      if (!r.active) continue;
      if (gesehen.has(r)) continue;
      gesehen.add(r);
      const i = world.bahnX.findIndex((b) => Math.abs(b - r.x) < 1e-9);
      if (i < 0) entfallen++;
      else { zaehler[i]++; gesamt++; }
    }
    // Objekte, die wieder frei sind, aus dem Set nehmen
    for (const r of gesehen) if (!r.active) gesehen.delete(r);
    void vorher;
  }
  return { zaehler, gesamt, entfallen, pct: zaehler.map((n) => ((n / gesamt) * 100).toFixed(1) + '%') };
}

for (const [fname, aspect] of Object.entries({ hoch: 9 / 19.5, quer: 16 / 9 })) {
  for (const id of ['braun']) {
    const a = messen(aspect, id, 4000, false);
    const b = messen(aspect, id, 4000, true);
    console.log(`${fname} ${id}: ${a.gesamt} Steine, nicht auf einer Bahn: ${a.entfallen}`);
    console.log(`   wie im Code     : ${a.pct.join(' / ')}`);
    console.log(`   mit Zaehlung bei nur einer freien Bahn: ${b.pct.join(' / ')}`);
  }
}
