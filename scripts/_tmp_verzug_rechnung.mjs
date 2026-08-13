import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { halfWidthAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';

const DT = 1 / 60;
const d = CONFIG.difficulty;
const T = d.dichte.mindestAbstand / d.tempo.max;
const c = CONFIG.characters.list.orange;
const p = { ...CONFIG.player, ...c.player };
const reserve = Math.max(0.15, Math.min(1, 1 - (2 / (p.acceleration * T)) * (1 - Math.exp(-p.acceleration * T))));
const vModell = p.moveSpeed * reserve;

console.log('T (kuerzestes Fenster)      =', T.toFixed(4), 's');
console.log('reserve (traegheitsFaktor)  =', reserve.toFixed(4));
console.log('Modelltempo orange          =', vModell.toFixed(4), 'E/s');
console.log('Modellweg in T              =', (vModell * T).toFixed(4), 'E   (Pruefer: 0.2313)');
console.log('echter Affe in T            = 0  (Totzeit', c.wischVerzoegerung, 's)');
console.log('Break-even T                =', (c.wischVerzoegerung / (1 / reserve - 1)).toFixed(4), 's  (Pruefer: 0.705)');
console.log('Totzeit in Fallstrecke      =', (c.wischVerzoegerung * d.tempo.max).toFixed(2), 'E   (Vorwarnstrecke 6.491)');
console.log('');

function spacing(aspect) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const half = halfWidthAt(camera, 0, p.startPosition[1]);
  const rand = Math.max((p.spriteHeight * (538 / 889)) / 2, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - rand);
  const maxX = Math.min(CONFIG.world.bounds.maxX, limit);
  const bahnX = CONFIG.world.bahnen.map((a) => a * maxX);
  return bahnX[1] - bahnX[0];
}

/** Echte Zeit fuer EINEN Bahnwechsel: Totzeit + Fahrt (SpritePlayer.update). */
function echteWechselzeit(abstand, toleranz) {
  const rate = 3 / (CONFIG.player.bahnWechselZeit ?? 0.16);
  let x = 0;
  let t = c.wischVerzoegerung;
  for (let i = 0; i < 100000; i++) {
    const rest = abstand - x;
    let s = rest * (1 - Math.exp(-rate * DT));
    const maxS = p.moveSpeed * DT;
    if (s > maxS) s = maxS;
    x += s;
    t += DT;
    if (abstand - x <= toleranz) return t;
  }
  return Infinity;
}

for (const [name, aspect] of [
  ['quer 16:9', 16 / 9],
  ['hoch 9:19.5', 9 / 19.5],
]) {
  const sp = spacing(aspect);
  console.log(
    `${name.padEnd(12)} Bahnabstand ${sp.toFixed(3)} E | Modell braucht ${(sp / vModell).toFixed(3)} s | ` +
      `echter Affe MIT Totzeit ${echteWechselzeit(sp, 0.05).toFixed(3)} s | Dauerrate echt ${(sp / c.wischVerzoegerung).toFixed(2)} E/s gegen Modell ${vModell.toFixed(2)} E/s`,
  );
}
