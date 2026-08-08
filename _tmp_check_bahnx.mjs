import { PerspectiveCamera, Vector3 } from 'three';
import sharp from 'sharp';
import { CONFIG } from './src/config.js';
import { halfWidthAt } from './src/core/viewport.js';

function makeCam(aspect) {
  const c = CONFIG.render.camera;
  const k = new PerspectiveCamera(c.fov, aspect, c.near, c.far);
  k.position.set(...c.position);
  k.lookAt(new Vector3(...c.lookAt));
  k.updateMatrixWorld(true);
  k.updateProjectionMatrix();
  k.matrixWorldInverse.copy(k.matrixWorld).invert();
  return k;
}

const y = CONFIG.player.startPosition[1];
console.log('startPosition[1] =', y, ' bounds =', JSON.stringify(CONFIG.world.bounds));
console.log('bahnen =', JSON.stringify(CONFIG.world.bahnen));

// Bildseiten wie fairness.mjs
const seiten = new Map();
for (const [id, char] of Object.entries(CONFIG.characters.list)) {
  const pfad = (char.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
  const datei = new URL('./public/' + pfad.replace(/^\//, ''), import.meta.url);
  const m = await sharp(datei.pathname.replace(/^\//, '')).metadata();
  seiten.set(id, m.width / m.height);
  const p = { ...CONFIG.player, ...char.player };
  console.log(
    `${id.padEnd(7)} ${m.width}x${m.height} seite=${(m.width / m.height).toFixed(4)} ` +
      `spriteHeight=${p.spriteHeight} halbeBreite=${((p.spriteHeight * m.width) / m.height / 2).toFixed(4)}`,
  );
}

const aspects = [
  ['hoch 9/19.5', 9 / 19.5],
  ['hoch 390/844', 390 / 844],
  ['quer 16/9', 16 / 9],
  ['quer 1920/1080', 16 / 9],
  ['2.00', 2.0],
  ['2.10', 2.1],
  ['handy quer 844/390', 844 / 390],
  ['ultrawide 21/9', 21 / 9],
  ['3.00', 3.0],
];

console.log('\naspect                half     | braun limit/maxX | weiss limit/maxX | orange limit/maxX');
for (const [name, a] of aspects) {
  const cam = makeCam(a);
  const half = halfWidthAt(cam, 0, y);
  const teile = [];
  for (const [id, char] of Object.entries(CONFIG.characters.list)) {
    const p = { ...CONFIG.player, ...char.player };
    const hb = (p.spriteHeight * seiten.get(id)) / 2;
    const limit = Math.max(0.9, half - hb);
    const maxX = Math.min(CONFIG.world.bounds.maxX, limit);
    teile.push(
      `${id}: limit=${limit.toFixed(3)} maxX=${maxX.toFixed(3)} ` +
        `bahnSkript=[${CONFIG.world.bahnen.map((q) => (q * limit).toFixed(2)).join(',')}] ` +
        `bahnSpiel=[${CONFIG.world.bahnen.map((q) => (q * maxX).toFixed(2)).join(',')}]`,
    );
  }
  console.log(`${name.padEnd(20)} half=${half.toFixed(3)}`);
  for (const t of teile) console.log('    ' + t);
}

// Ab welchem aspect wird limit > 9?
function limitFor(a, id) {
  const cam = makeCam(a);
  const half = halfWidthAt(cam, 0, y);
  const char = CONFIG.characters.list[id];
  const p = { ...CONFIG.player, ...char.player };
  const hb = (p.spriteHeight * seiten.get(id)) / 2;
  return Math.max(0.9, half - hb);
}
for (const id of Object.keys(CONFIG.characters.list)) {
  let lo = 1,
    hi = 6;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (limitFor(mid, id) > 9) hi = mid;
    else lo = mid;
  }
  console.log(`\n${id}: limit ueberschreitet 9 ab aspect ~${hi.toFixed(4)}  (limit@16:9=${limitFor(16 / 9, id).toFixed(3)}, limit@844/390=${limitFor(844 / 390, id).toFixed(3)})`);
}
