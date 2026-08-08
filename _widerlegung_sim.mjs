import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { DifficultyCurve } from './src/systems/DifficultyCurve.js';
import { Spawner } from './src/systems/Spawner.js';
import { halfWidthAt } from './src/core/viewport.js';

const BILD = { braun: 407 / 725, weiss: 454 / 864, orange: 538 / 889 };
function spielfeld(aspect, pCfg, charId) {
  const cam = CONFIG.render.camera;
  const c = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  c.position.set(...cam.position); c.lookAt(...cam.lookAt);
  c.updateMatrixWorld(true); c.updateProjectionMatrix();
  c.matrixWorldInverse.copy(c.matrixWorld).invert();
  const half = halfWidthAt(c, 0, pCfg.startPosition[1]);
  const limit = Math.max(0.9, half - (pCfg.spriteHeight * BILD[charId]) / 2);
  const b = CONFIG.world;
  const maxX = Math.min(b.bounds.maxX, limit);
  return { ...b, bounds: { minX: -maxX, maxX, minY: b.bounds.minY, maxY: b.bounds.maxY },
    bahnX: b.bahnen.map((a) => a * maxX), spawnHalfWidth: Math.min(b.spawnHalfWidth, limit + 0.8) };
}
const DT = 1 / 60;

function lauf(charId, aspect, sekunden, variante) {
  const pCfg = { ...CONFIG.player, ...CONFIG.characters.list[charId].player };
  const world = spielfeld(aspect, pCfg, charId);
  const d = new DifficultyCurve(CONFIG.difficulty);
  d.setRockMix(CONFIG.rock.mix);
  const sp = new Spawner({ add() {} }, CONFIG, d, world, null);
  sp.bananasEnabled = false;
  sp.setSpieler(pCfg);
  sp.reset();

  if (variante === 'alt') {
    const k = CONFIG.rock.korridor;
    sp._tempoDamitPlatzBleibt = function (fall) {
      const rand = this.spieler.hitRadius + this._groessterHitRadius;
      const langsamste = Math.max(0.2, this._langsamsterFallfaktor);
      const vLangsam = Math.max(0.5, fall * langsamste * this.spieler.minScrollFactor);
      const fenster = (world.spawnY - (world.bounds.minY - rand)) / vLangsam;
      const sperrRest = 2 * (k.halbbreite + rand + k.reserve) + 2 * this._groessterHitRadius;
      const maxSpanne = 2 * world.spawnHalfWidth - sperrRest;
      if (maxSpanne <= 0) return 0.05;
      return maxSpanne / fenster;
    };
  }

  let versuche = 0, keinPlatz = 0;
  const echt = sp._freieStelle.bind(sp);
  sp._freieStelle = (t, hr) => { versuche++; const x = echt(t, hr); if (x === null) keinPlatz++; return x; };

  let wanderung = 0, letztesX = sp.korridor.x;
  let wechsel = 0, letzteBahn = sp._naechsteBahn(sp.korridor.x);
  let bahnHalt = 0, maxBahnHalt = 0;
  const bahnZeit = new Array(world.bahnX.length).fill(0);
  const gefallen = new Array(world.bahnX.length).fill(0);
  const echtSpawn = sp.rocks; // pool

  const frames = Math.round(sekunden / DT);
  for (let i = 0; i < frames; i++) {
    const vorher = sp.rocks.activeCount;
    d.update(DT);
    sp.update(DT, false, d.scrollSpeed);
    const x = sp.korridor.x;
    wanderung += Math.abs(x - letztesX); letztesX = x;
    const b = sp._naechsteBahn(x);
    bahnZeit[world.bahnX.indexOf(b)] += DT;
    if (b !== letzteBahn) { wechsel++; letzteBahn = b; maxBahnHalt = Math.max(maxBahnHalt, bahnHalt); bahnHalt = 0; }
    else bahnHalt += DT;
  }
  maxBahnHalt = Math.max(maxBahnHalt, bahnHalt);
  return {
    tempo: sp.korridorTempo,
    wanderung: (wanderung / sekunden) * 60,
    wechsel: (wechsel / sekunden) * 60,
    maxBahnHalt,
    ausfall: versuche ? (keinPlatz / versuche) * 100 : 0,
    versuche,
    bahnAnteil: bahnZeit.map((z) => ((z / sekunden) * 100).toFixed(1)).join('/'),
  };
}

const SEK = 300, N = 5;
for (const charId of ['braun', 'orange', 'weiss']) {
  for (const [fn, aspect] of [['hoch 9:19.5', 390 / 844], ['hoch 9:16', 405 / 720], ['quer 16:9', 1280 / 720]]) {
    for (const variante of ['neu (bounds, HEAD)', 'alt (spawnHalfWidth)']) {
      const v = variante.startsWith('neu') ? 'neu' : 'alt';
      const acc = { tempo: 0, wanderung: 0, wechsel: 0, maxBahnHalt: 0, ausfall: 0 };
      let letzte;
      for (let r = 0; r < N; r++) {
        const s = lauf(charId, aspect, SEK, v);
        acc.tempo += s.tempo / N; acc.wanderung += s.wanderung / N;
        acc.wechsel += s.wechsel / N; acc.maxBahnHalt = Math.max(acc.maxBahnHalt, s.maxBahnHalt);
        acc.ausfall += s.ausfall / N; letzte = s;
      }
      console.log(
        `${charId.padEnd(7)} ${fn.padEnd(12)} ${variante.padEnd(22)}` +
        ` tempo=${acc.tempo.toFixed(4)}  Wanderung/60s=${acc.wanderung.toFixed(2)}` +
        `  Bahnwechsel/min=${acc.wechsel.toFixed(1)}  laengsteBahn=${acc.maxBahnHalt.toFixed(1)}s` +
        `  Ausfall=${acc.ausfall.toFixed(1)}%  Zeitanteil=${letzte.bahnAnteil}`
      );
    }
  }
}
