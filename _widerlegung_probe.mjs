import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { DifficultyCurve } from './src/systems/DifficultyCurve.js';
import { Spawner } from './src/systems/Spawner.js';
import { halfWidthAt } from './src/core/viewport.js';

const BILD = { braun: 407 / 725, weiss: 454 / 864, orange: 538 / 889 };

function spielfeld(aspect, pCfg, charId) {
  const cam = CONFIG.render.camera;
  const c = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  c.position.set(...cam.position);
  c.lookAt(...cam.lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  c.matrixWorldInverse.copy(c.matrixWorld).invert();
  const half = halfWidthAt(c, 0, pCfg.startPosition[1]);
  const limit = Math.max(0.9, half - (pCfg.spriteHeight * BILD[charId]) / 2);
  const b = CONFIG.world;
  const maxX = Math.min(b.bounds.maxX, limit);
  return {
    ...b,
    bounds: { minX: -maxX, maxX, minY: b.bounds.minY, maxY: b.bounds.maxY },
    bahnX: b.bahnen.map((a) => a * maxX),
    spawnHalfWidth: Math.min(b.spawnHalfWidth, limit + 0.8),
  };
}

const DT = 1 / 60;
const FORMATE = { hoch: 390 / 844, hoch916: 405 / 720, quer: 1280 / 720 };

for (const charId of ['braun', 'orange', 'weiss']) {
  const pCfg = { ...CONFIG.player, ...CONFIG.characters.list[charId].player };
  for (const [fn, aspect] of Object.entries(FORMATE)) {
    const world = spielfeld(aspect, pCfg, charId);
    const d = new DifficultyCurve(CONFIG.difficulty);
    d.setRockMix(CONFIG.rock.mix);
    const sp = new Spawner({ add() {} }, CONFIG, d, world, null);
    sp.setSpieler(pCfg);
    sp.reset();
    const zeilen = [];
    for (const t of [0, 132, 400, 1200]) {
      while (d.t < t) d.update(DT);
      const fall = d.rockFallSpeed + d.scrollSpeed;
      const k = CONFIG.rock.korridor;
      const rand = pCfg.hitRadius + sp._groessterHitRadius;
      const langsamste = Math.max(0.2, sp._langsamsterFallfaktor);
      const vLangsam = Math.max(0.5, fall * langsamste * pCfg.minScrollFactor);
      const fenster = (world.spawnY - (world.bounds.minY - rand)) / vLangsam;
      const sperrRest = 2 * (k.halbbreite + rand + k.reserve) + 2 * sp._groessterHitRadius;
      const neu = 2 * world.bounds.maxX - sperrRest;
      const alt = 2 * world.spawnHalfWidth - sperrRest;
      const tNeu = sp._tempoDamitPlatzBleibt(fall);
      const tAlt = alt <= 0 ? 0.05 : alt / fenster;
      zeilen.push(
        `  t=${String(t).padStart(4)}  fall=${fall.toFixed(2)} fenster=${fenster.toFixed(2)}` +
        ` | spanne neu=${neu.toFixed(3)} alt=${alt.toFixed(3)}` +
        ` | brems neu=${tNeu.toFixed(4)} alt=${tAlt.toFixed(4)}` +
        ` | korridorTempo=${sp.korridorTempo.toFixed(4)}` +
        ` (moveSpeed*anteil=${(pCfg.moveSpeed * (k.anteilStart + (k.anteilMax - k.anteilStart) * Math.min(1, d.wand / k.anteilVollAbWand))).toFixed(2)}, fall*${k.tempoAnteil}=${(fall * k.tempoAnteil).toFixed(3)})`
      );
    }
    console.log(`${charId} / ${fn}: maxX=${world.bounds.maxX.toFixed(4)} spawnHalfWidth=${world.spawnHalfWidth.toFixed(4)} bahnAbstand=${(world.bahnX[1]-world.bahnX[0]).toFixed(4)} langsamsterFallfaktor=${sp._langsamsterFallfaktor.toFixed(4)} groessterHit=${sp._groessterHitRadius.toFixed(4)}`);
    console.log(zeilen.join('\n'));
  }
}
