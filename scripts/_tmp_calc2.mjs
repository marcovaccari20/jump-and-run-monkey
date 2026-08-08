import { PerspectiveCamera, Vector3 } from 'three';
import { CONFIG } from '../src/config.js';

function halfWidthAt(camera, planeZ, worldY) {
  const p = new Vector3(0, worldY, planeZ).project(camera);
  const q = new Vector3(1, worldY, planeZ).project(camera);
  const perUnit = q.x - p.x;
  return Math.abs((1 - p.x) / perUnit);
}

function feld(w, h, spriteWidth) {
  const c = CONFIG.render.camera;
  const cam = new PerspectiveCamera(c.fov, w / h, c.near, c.far);
  cam.position.set(...c.position);
  cam.lookAt(new Vector3(...c.lookAt));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const affenHoehe = CONFIG.player.startPosition[1];
  const half = halfWidthAt(cam, 0, affenHoehe);
  const limit = Math.max(0.9, half - spriteWidth / 2);
  const maxX = Math.min(CONFIG.world.bounds.maxX, limit);
  const bahnX = CONFIG.world.bahnen.map((a) => a * maxX);
  const spawnHalfWidth = Math.min(CONFIG.world.spawnHalfWidth, limit + 0.8);
  return { half, limit, maxX, bahnX, spawnHalfWidth, abstand: bahnX[1] - bahnX[0] };
}

// Sprite-Breiten: aus dem Seitenverhältnis der Frames. Standardannahme im Code: 0.55
const aspects = { braun: 0.55, weiss: 0.55, orange: 0.55 };
for (const [id, ch] of Object.entries(CONFIG.characters.list)) {
  const h = ch.player.spriteHeight;
  const w = h * aspects[id];
  console.log('===', id, 'spriteHeight', h, 'spriteWidth~', w.toFixed(3), 'hitRadius', ch.player.hitRadius);
  for (const [name, [W, H]] of Object.entries({ hoch: [390, 844], quer: [844, 390], desktop: [1600, 900] })) {
    const f = feld(W, H, w);
    console.log(`  ${name}: half=${f.half.toFixed(3)} limit=${f.limit.toFixed(3)} maxX=${f.maxX.toFixed(3)} abstand=${f.abstand.toFixed(3)} spawnHW=${f.spawnHalfWidth.toFixed(3)}`);
    console.log(`     bahnX=[${f.bahnX.map((x) => x.toFixed(3)).join(', ')}]`);
  }
}

// Reichweiten
const coinHit = CONFIG.coin.radius * CONFIG.coin.hitRadiusFactor;
const banHit = CONFIG.banana.radius * CONFIG.banana.hitRadiusFactor;
console.log('\ncoin hitRadius', coinHit.toFixed(3), 'pendel', CONFIG.coin.pendelWeite);
console.log('banana hitRadius', banHit.toFixed(3), 'pendel 0.23 (hart in Banana.js)');
for (const [id, ch] of Object.entries(CONFIG.characters.list)) {
  const pr = ch.player.hitRadius;
  console.log(`  ${id}: pr=${pr} coinReach=${(pr + coinHit).toFixed(3)} (>0.28? ${pr + coinHit > 0.28}) bananaReach=${(pr + banHit).toFixed(3)} (>0.23? ${pr + banHit > 0.23})`);
}

// grösster Objekt-Trefferradius
const groesster = Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
console.log('\ngroesster rock hitRadius', groesster.toFixed(3));
for (const [id, ch] of Object.entries(CONFIG.characters.list)) {
  const rand = ch.player.hitRadius + groesster;
  console.log(`  ${id}: rand=${rand.toFixed(3)} mindestAbstand(rand+reserve)=${(rand + CONFIG.rock.korridor.reserve).toFixed(3)}`);
}
