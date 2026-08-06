/**
 * Angriffs-Sonde auf Korridor.js (temporär, nicht Teil des Spiels).
 *
 * Misst im echten Spawner:
 *   - Fuellstand des Ringpuffers (anzahl vs. stuetzstellen)
 *   - ob das Zeitfenster [tEin,tAus] eines Objekts UEBER den letzten
 *     Wegpunkt hinausreicht (dann liefert bei()/spanne() nur noch den
 *     eingefrorenen letzten Wert -> die Sperrzone ist geraten, nicht bewiesen)
 *   - kleinste Abschnittsdauer
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';

const DT = Number(process.argv[2] ?? 1 / 60);
const SEKUNDEN = Number(process.argv[3] ?? 600);
const AFFE = String(process.argv[4] ?? 'braun');
const ASPECT = Number(process.argv[5] ?? 9 / 19.5);

function spielfeld(aspect, hitRadius) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const base = CONFIG.world;
  const half = halfWidthAt(camera, 0, base.bounds.maxY);
  const limit = Math.max(0.9, half - hitRadius * 1.6);
  return {
    ...base,
    bounds: {
      minX: Math.max(base.bounds.minX, -limit),
      maxX: Math.min(base.bounds.maxX, limit),
      minY: base.bounds.minY,
      maxY: base.bounds.maxY,
    },
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.4),
  };
}

function stufeBei(sekunden) {
  const stages = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < stages.length; i++) if (sekunden >= stages[i].afterSeconds) idx = i;
  const letzte = stages[stages.length - 1];
  if (sekunden >= letzte.afterSeconds) {
    const extra = Math.floor((sekunden - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (stages.length - 1 + extra) % stages.length;
  }
  return stages[idx];
}

const charCfg = CONFIG.characters.list[AFFE];
const pCfg = { ...CONFIG.player, ...charCfg.player };
const world = spielfeld(ASPECT, pCfg.hitRadius);

const difficulty = new DifficultyCurve(CONFIG.difficulty);
difficulty.setRockMix(CONFIG.rock.mix);
const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
spawner.bananasEnabled = false;
spawner.setSpieler(pCfg);
spawner.reset();

const k = spawner.korridor;
const N = k._t.length;

let maxAnzahl = 0;
let minAbschnitt = Infinity;
let schutzErschoepft = 0;
let horizontZuKurz = 0;
let maxUeberhang = 0; // wie weit tAus ueber den letzten Wegpunkt hinausragt
let maxTAus = 0;
let infoTAus = null;
let ueberhangInfo = null;

// _freieStelle instrumentieren (Original weiter benutzen)
const orig = spawner._freieStelle.bind(spawner);
spawner._freieStelle = function (type, hitRadius) {
  const kk = CONFIG.rock.korridor;
  const look = CONFIG.rock.looks[spawner.hazardLook] ?? CONFIG.rock.looks.stein;
  const slot = CONFIG.rock.types.indexOf(type);
  const i = slot < 0 ? 0 : slot;
  const fall = (type.fallFactor ?? 1) * (look.fallMulSlots?.[i] ?? look.fallMul ?? 1);
  const basis = difficulty.scrollSpeed;
  const eigen = difficulty.rockFallSpeed;
  const sp = spawner.spieler;
  const vLangsam = (eigen + basis * sp.minScrollFactor) * fall;
  const rand = sp.hitRadius + hitRadius;
  const untenY = world.bounds.minY - rand;
  const tAus = (world.spawnY - untenY) / vLangsam + kk.zeitReserve;
  const ueber = k.jetzt + tAus - k.letzteZeit;
  if (tAus > maxTAus) {
    maxTAus = tAus;
    infoTAus = { t: +difficulty.elapsed.toFixed(1), look: spawner.hazardLook, art: type.id };
  }
  if (ueber > maxUeberhang) {
    maxUeberhang = ueber;
    ueberhangInfo = {
      t: +difficulty.elapsed.toFixed(1),
      look: spawner.hazardLook,
      art: type.id,
      tAus: +tAus.toFixed(3),
      horizontIst: +(k.letzteZeit - k.jetzt).toFixed(3),
    };
  }
  if (ueber > 0) horizontZuKurz++;
  return orig(type, hitRadius);
};

const frames = Math.round(SEKUNDEN / DT);
for (let f = 0; f < frames; f++) {
  difficulty.update(DT);
  const t = difficulty.elapsed;
  spawner.hazardLook = stufeBei(t).hazard;
  const vorher = k.letzteZeit;
  const anzVorher = k._anzahl;
  spawner.update(DT, false, difficulty.scrollSpeed);
  if (k._anzahl > maxAnzahl) maxAnzahl = k._anzahl;
  if (k.letzteZeit < k.jetzt + CONFIG.rock.korridor.horizont - 1e-9) schutzErschoepft++;
  // kleinste Abschnittsdauer messen
  for (let i = 1; i < k._anzahl; i++) {
    const d = k._t[k._index(i)] - k._t[k._index(i - 1)];
    if (d < minAbschnitt) minAbschnitt = d;
  }
  void vorher;
  void anzVorher;
}

console.log(`dt=${DT}  ${SEKUNDEN}s  ${AFFE}  aspect=${ASPECT.toFixed(3)}`);
console.log(`  Ringpuffer: max ${maxAnzahl} von ${N} Stuetzstellen`);
console.log(`  kleinste Abschnittsdauer: ${minAbschnitt.toFixed(4)} s`);
console.log(`  Frames mit zu kurzem Horizont (schutz erschoepft): ${schutzErschoepft}`);
console.log(`  Spawns, deren tAus ueber den letzten Wegpunkt hinausragt: ${horizontZuKurz}`);
console.log(`  groesster Ueberhang: ${maxUeberhang.toFixed(3)} s`, ueberhangInfo ?? '');
console.log(`  groesstes tAus: ${maxTAus.toFixed(3)} s (horizont=${CONFIG.rock.korridor.horizont})`, infoTAus ?? '');
