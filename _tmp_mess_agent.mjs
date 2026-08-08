import sharp from 'sharp';
import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { halfWidthAt } from './src/core/viewport.js';
import { resolve } from 'node:path';

const root = 'C:/Users/vacca/Downloads/jump-and-run-monkey/public';
// echte Sprite-Breiten
let max = 0, wer = '';
for (const [lookId, look] of Object.entries(CONFIG.rock.looks)) {
  for (let i = 0; i < CONFIG.rock.types.length; i++) {
    const name = look.bilder?.[i];
    if (!name) continue;
    const datei = resolve(root, CONFIG.rock.spritePath.replace('{n}', name).replace(/^\//, ''));
    let m;
    try { m = await sharp(datei).metadata(); } catch (e) { console.log('fehlt', datei); continue; }
    const aspect = m.width / m.height;
    const t = CONFIG.rock.types[i];
    const d = 2 * t.radius * (CONFIG.rock.spriteScale ?? 1) * (look.bildScale ?? 1);
    const breite = d * Math.sqrt(aspect);
    if (breite > max) { max = breite; wer = `${lookId}/${t.id} aspect=${aspect.toFixed(3)}`; }
  }
}
console.log('groessteSpriteBreite (echt):', max.toFixed(4), wer);
console.log('ohne Bilder (fairness.mjs):', (2*0.74).toFixed(4));

const cam = CONFIG.render.camera;
for (const [name, aspect] of [['quer',16/9],['hoch',9/19.5]]) {
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position); camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  for (const [id, ch] of Object.entries(CONFIG.characters.list)) {
    const pCfg = { ...CONFIG.player, ...ch.player };
    const y = (pCfg.startPosition ?? CONFIG.player.startPosition)[1];
    const half = halfWidthAt(camera, 0, y);
    const framePfad = (ch.framePath ?? CONFIG.sprite.framePath).replace('{n}','00');
    const md = await sharp(resolve(root, framePfad.replace(/^\//,''))).metadata();
    const affenBreite = pCfg.spriteHeight * (md.width/md.height) / 2;
    for (const [tag, objBreite] of [['echt', max/2], ['test', 0.74]]) {
      const rand = Math.max(affenBreite, objBreite);
      const limit = Math.max(0.9, half - rand);
      const maxX = Math.min(CONFIG.world.bounds.maxX, limit);
      console.log(name, id, tag, 'halfWidth', half.toFixed(3), 'affe', affenBreite.toFixed(3), 'maxX/Bahnabstand', maxX.toFixed(4),
        'bahnX', CONFIG.world.bahnen.map(a=>(a*maxX).toFixed(3)).join(','));
    }
  }
}
const hr = CONFIG.rock.hitRadiusFactor, res = CONFIG.rock.korridor.reserve;
for (const t of CONFIG.rock.types) {
  console.log('mindestAbstand', t.id, (0.42 + t.radius*hr + res).toFixed(4));
}
