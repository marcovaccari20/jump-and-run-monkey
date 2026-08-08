import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { halfWidthAt } from '../src/core/viewport.js';

const ASPECTS = {
  braun: 407 / 725,
  weiss: 454 / 864,
  orange: 538 / 889,
};

function feld(aspect, id) {
  const ch = CONFIG.characters.list[id];
  const pCfg = { ...CONFIG.player, ...ch.player };
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const half = halfWidthAt(camera, 0, pCfg.startPosition[1]);
  const halbeBreite = (pCfg.spriteHeight * ASPECTS[id]) / 2;
  const limit = Math.max(0.9, half - halbeBreite);
  const maxX = Math.min(CONFIG.world.bounds.maxX, limit);
  return { half, limit, maxX, bahnX: CONFIG.world.bahnen.map((a) => a * maxX) };
}

// Was fairness.mjs annimmt
function feldTest(aspect, id) {
  const ch = CONFIG.characters.list[id];
  const pCfg = { ...CONFIG.player, ...ch.player };
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const half = halfWidthAt(camera, 0, pCfg.startPosition[1]);
  const halbeBreite = (pCfg.spriteHeight * (377 / 720)) / 2;
  const limit = Math.max(0.9, half - halbeBreite);
  return { limit, bahnX: CONFIG.world.bahnen.map((a) => a * limit) };
}

console.log('--- Spiel vs. fairness.mjs (BILD_SEITE 377/720) ---');
for (const fmt of [['hoch 9:19.5', 9 / 19.5], ['quer 16:9', 16 / 9]]) {
  for (const id of Object.keys(CONFIG.characters.list)) {
    const a = feld(fmt[1], id);
    const b = feldTest(fmt[1], id);
    console.log(
      `${fmt[0].padEnd(12)} ${id.padEnd(7)} Spiel limit=${a.limit.toFixed(3)} maxX=${a.maxX.toFixed(3)} bahnAbst=${(a.bahnX[1] - a.bahnX[0]).toFixed(3)}` +
      `   Test limit=${b.limit.toFixed(3)} bahnAbst=${(b.bahnX[1] - b.bahnX[0]).toFixed(3)}` +
      `   Feld im Test um ${(((b.limit / a.limit) - 1) * 100).toFixed(1)}% breiter`,
    );
  }
}

console.log('\n--- Bahnverschiebung bei Resize (braun) ---');
const faelle = [
  ['390x844 -> 390x750 (URL-Leiste)', 390 / 844, 390 / 750],
  ['390x844 -> 844x390 (drehen)', 390 / 844, 844 / 390],
  ['1600x900 -> 900x900 (Fenster schmaler)', 1600 / 900, 900 / 900],
  ['1600x900 -> 1200x900', 1600 / 900, 1200 / 900],
];
const groesster = Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
for (const [name, a1, a2] of faelle) {
  const v = feld(a1, 'braun');
  const n = feld(a2, 'braun');
  const rand = CONFIG.characters.list.braun.player.hitRadius + groesster;
  // Fuer jedes alte Bahn-x: Abstand zur naechsten neuen Bahn
  const zeilen = v.bahnX.map((x) => {
    const d = Math.min(...n.bahnX.map((b) => Math.abs(b - x)));
    return `${x.toFixed(2)}->d${d.toFixed(2)}${d < rand ? (Math.abs(d) < 1e-6 ? '' : ' GEFAHR') : ' harmlos'}`;
  });
  console.log(`${name.padEnd(38)} alt=[${v.bahnX.map((x) => x.toFixed(2))}] neu=[${n.bahnX.map((x) => x.toFixed(2))}] rand=${rand.toFixed(3)}`);
  console.log(`    ${zeilen.join('  ')}`);
}
