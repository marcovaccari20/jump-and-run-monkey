/* TEMPORAER (Pruefung) — Masse nachrechnen: halbFeld, Bahnen, Sperrbreiten. */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { halfWidthAt } from '../src/core/viewport.js';

function feld(aspect, halbeAffenBreite, pCfg) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const base = CONFIG.world;
  const affenHoehe = (pCfg.startPosition ?? CONFIG.player.startPosition)[1];
  const half = halfWidthAt(camera, 0, affenHoehe);
  const limit = Math.max(0.9, half - halbeAffenBreite);
  return {
    limit,
    maxX: Math.min(base.bounds.maxX, limit),
    bahnX: base.bahnen.map((a) => a * limit),
  };
}

const k = CONFIG.rock.korridor;
const groesster = Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
console.log('korridor cfg', JSON.stringify(k));
console.log('groessterHitRadius', groesster.toFixed(4));
console.log(
  'Objekt-Trefferradien',
  CONFIG.rock.types
    .map((t) => `${t.id}=${(t.radius * CONFIG.rock.hitRadiusFactor).toFixed(4)}`)
    .join(' '),
);

for (const [name, aspect] of [
  ['hoch(390x844)', 390 / 844],
  ['hoch(9:19.5)', 9 / 19.5],
  ['quer(16:9) ', 16 / 9],
]) {
  for (const [affe, char] of Object.entries(CONFIG.characters.list)) {
    const pCfg = { ...CONFIG.player, ...char.player };
    const seite = { braun: 407 / 725, weiss: 454 / 864, orange: 538 / 889 }[affe] ?? 0.56;
    const hab = ((pCfg.spriteHeight ?? CONFIG.player.spriteHeight) * seite) / 2;
    const f = feld(aspect, hab, pCfg);
    const abst = f.bahnX[1] - f.bahnX[0];
    const rand = pCfg.hitRadius + groesster;
    const sperrRest = 2 * (k.halbbreite + rand + k.reserve) + 2 * groesster;
    const sperrRest6 = 2 * (0.6 + rand + k.reserve) + 2 * groesster;
    console.log(
      `${name} ${affe.padEnd(6)} maxX=${f.maxX.toFixed(3)} bahnen=[${f.bahnX
        .map((x) => x.toFixed(3))
        .join(',')}] abstand=${abst.toFixed(3)}` +
        ` | rand(gross)=${rand.toFixed(3)} sperrRest=${sperrRest.toFixed(3)} maxSpanne=${(
          2 * f.maxX -
          sperrRest
        ).toFixed(3)}` +
        ` | bei0.6: sperrRest=${sperrRest6.toFixed(3)} maxSpanne=${(2 * f.maxX - sperrRest6).toFixed(
          3,
        )}`,
    );
  }
}
