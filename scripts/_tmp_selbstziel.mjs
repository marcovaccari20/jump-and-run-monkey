/**
 * TEMPORAER — prueft den Befund "Korridor._bahnZiel benutzt x0 nicht".
 *
 * Misst im ECHTEN Spawner:
 *   - wie oft _bahnZiel die Spur waehlt, auf der der Korridor schon steht
 *   - laengster zusammenhaengender Stillstand der Bahn (aus dem Streckenzug)
 *   - laengste Trockenzeit je Spur (die "Schranke" aus _bahnWaehlen)
 *   - Verteilung der Objekte je Spur
 *
 * Zweiter Durchlauf mit gepatchtem _bahnZiel (Selbstwahl ausgeschlossen),
 * damit sich die Zahlen vergleichen lassen.
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';

const DT = 1 / 60;
const SEKUNDEN = Number(process.argv[2] ?? 600);
const AFFE = String(process.argv[3] ?? 'braun');
const ASPECT = Number(process.argv[4] ?? 9 / 19.5);
const SEED = Number(process.argv[5] ?? 12345);

/* Deterministischer Zufall, damit beide Durchlaeufe dieselbe Wuerfelfolge
 * sehen und der Unterschied nicht nur Rauschen ist. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  // Exakt wie Game._updateWorldBounds
  const halbeBreite = Math.max(1.4 / 2, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - halbeBreite);
  const bounds = {
    minX: Math.max(base.bounds.minX, -limit),
    maxX: Math.min(base.bounds.maxX, limit),
    minY: base.bounds.minY,
    maxY: base.bounds.maxY,
  };
  const rAffe = hitRadius;
  const rObjekt = Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
  const deckel = Math.min(base.bahnDeckel ?? Infinity, 2 * (rAffe + rObjekt));
  const halbFeld = Math.min(bounds.maxX, deckel);
  return {
    ...base,
    bounds,
    bahnX: base.bahnen.map((a) => a * halbFeld),
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

function lauf({ fix }) {
  const echterZufall = Math.random;
  Math.random = mulberry32(SEED);

  const charCfg = CONFIG.characters.list[AFFE];
  const pCfg = { ...CONFIG.player, ...charCfg.player };
  const world = spielfeld(ASPECT, pCfg.hitRadius);

  const difficulty = new DifficultyCurve(CONFIG.difficulty);
  difficulty.setRockMix(CONFIG.rock.mix);
  const gespawnt = [];
  const scene = { add() {} };
  const spawner = new Spawner(scene, CONFIG, difficulty, world, null);
  spawner.bananasEnabled = false;
  spawner.setSpieler(pCfg);
  spawner.reset();

  const k = spawner.korridor;

  /* --- _bahnZiel instrumentieren (Original bleibt in Kraft) --- */
  let rufe = 0;
  let selbst = 0;
  let x0IstSpur = 0;
  const origZiel = k._bahnZiel.bind(k);
  k._bahnZiel = function (bahnen, x0) {
    rufe++;
    if (bahnen.some((b) => b === x0)) x0IstSpur++;
    let ziel = origZiel(bahnen, x0);
    if (ziel === x0) {
      selbst++;
      if (fix) {
        // "Ausschluss der aktuellen Spur" — die vorgeschlagene Korrektur.
        let schutz = 20;
        while (ziel === x0 && schutz-- > 0) ziel = origZiel(bahnen, x0);
      }
    }
    return ziel;
  };

  /* --- Abwuerfe je Spur mitzaehlen --- */
  const bahnen = world.bahnX;
  const proSpur = new Array(bahnen.length).fill(0);
  const origWaehlen = spawner._bahnWaehlen.bind(spawner);
  spawner._bahnWaehlen = function (frei, alle) {
    const x = origWaehlen(frei, alle);
    const i = alle.indexOf(x);
    if (i >= 0) proSpur[i]++;
    return x;
  };

  /* --- Trockenzeit je Spur mitschreiben --- */
  const maxTrocken = new Array(bahnen.length).fill(0);

  /* --- Stillstand aus dem Streckenzug rekonstruieren ---
   * Wir lesen die Stuetzstellen, sobald sie erzeugt werden: jeder Aufruf von
   * _anfuegen ist ein neuer Abschnitt (t, x). Zwei aufeinanderfolgende
   * Stuetzstellen mit gleichem x heissen: die Bahn steht in diesem Abschnitt. */
  const stillstaende = [];
  let laufStart = null;
  let letztesX = null;
  let letzteT = null;
  const origAnfuegen = k._anfuegen.bind(k);
  k._anfuegen = function (t, x) {
    if (letztesX !== null) {
      if (x === letztesX) {
        if (laufStart === null) laufStart = letzteT;
      } else {
        if (laufStart !== null) {
          stillstaende.push(letzteT - laufStart);
          laufStart = null;
        }
      }
    }
    letztesX = x;
    letzteT = t;
    return origAnfuegen(t, x);
  };

  /* --- Die SPIELRELEVANTE Groesse: wie lange bleibt die sichere Spur
   * dieselbe? Solange sie sich nicht aendert, muss der Spieler sich nicht
   * bewegen. Gemessen an der Bahn zum JETZT-Zeitpunkt, wie der Spieler sie
   * erlebt. */
  const sicherLauf = [];
  let letzteSpur = null;
  let spurSeit = 0;

  const frames = Math.round(SEKUNDEN / DT);
  for (let f = 0; f < frames; f++) {
    difficulty.update(DT);
    spawner.hazardLook = stufeBei(difficulty.elapsed).hazard;
    spawner.update(DT, false, difficulty.scrollSpeed);
    if (spawner._bahnTrocken) {
      for (let i = 0; i < spawner._bahnTrocken.length; i++) {
        if (spawner._bahnTrocken[i] > maxTrocken[i]) maxTrocken[i] = spawner._bahnTrocken[i];
      }
    }
    const xJetzt = k.bei(k.jetzt);
    let spur = 0;
    let best = Infinity;
    for (let i = 0; i < bahnen.length; i++) {
      const d = Math.abs(bahnen[i] - xJetzt);
      if (d < best) {
        best = d;
        spur = i;
      }
    }
    if (spur !== letzteSpur) {
      if (letzteSpur !== null) sicherLauf.push(k.jetzt - spurSeit);
      letzteSpur = spur;
      spurSeit = k.jetzt;
    }
  }
  if (laufStart !== null) stillstaende.push(letzteT - laufStart);

  Math.random = echterZufall;

  stillstaende.sort((a, b) => a - b);
  const summe = stillstaende.reduce((s, v) => s + v, 0);
  const gesamtSpawns = proSpur.reduce((s, v) => s + v, 0) || 1;
  sicherLauf.sort((a, b) => a - b);
  const sSum = sicherLauf.reduce((s, v) => s + v, 0);
  const p95 = sicherLauf.length ? sicherLauf[Math.floor(0.95 * (sicherLauf.length - 1))] : 0;

  return {
    sicherMax: sicherLauf.length ? sicherLauf[sicherLauf.length - 1] : 0,
    sicherMittel: sicherLauf.length ? sSum / sicherLauf.length : 0,
    sicherP95: p95,
    spurWechsel: sicherLauf.length,
    rufe,
    selbst,
    x0IstSpur,
    bahnen,
    stillZahl: stillstaende.length,
    stillMax: stillstaende.length ? stillstaende[stillstaende.length - 1] : 0,
    stillMittel: stillstaende.length ? summe / stillstaende.length : 0,
    stillAnteilZeit: summe / SEKUNDEN,
    maxTrocken,
    proSpur,
    proSpurProzent: proSpur.map((v) => (100 * v) / gesamtSpawns),
    gesamtSpawns,
  };
}

function zeig(name, r) {
  console.log(`\n=== ${name} ===`);
  console.log(`  Spuren x:                 ${r.bahnen.map((b) => b.toFixed(3)).join('  ')}`);
  console.log(`  _bahnZiel-Aufrufe:        ${r.rufe}`);
  console.log(`  davon x0 exakt auf Spur:  ${r.x0IstSpur} (${((100 * r.x0IstSpur) / r.rufe).toFixed(1)} %)`);
  console.log(`  davon ziel === x0:        ${r.selbst} (${((100 * r.selbst) / r.rufe).toFixed(1)} %)`);
  console.log(`  Stillstands-Phasen:       ${r.stillZahl}`);
  console.log(`  laengster Stillstand:     ${r.stillMax.toFixed(3)} s`);
  console.log(`  mittlerer Stillstand:     ${r.stillMittel.toFixed(3)} s`);
  console.log(`  Anteil Zeit im Stillstand:${(100 * r.stillAnteilZeit).toFixed(1)} %`);
  console.log(`  sichere Spur unveraendert: max ${r.sicherMax.toFixed(2)} s  p95 ${r.sicherP95.toFixed(2)} s  mittel ${r.sicherMittel.toFixed(2)} s  (${r.spurWechsel} Wechsel)`);
  console.log(`  laengste Trockenzeit/Spur:${r.maxTrocken.map((v) => v.toFixed(2)).join('  ')} s  (Schranke ${CONFIG.rock.korridor.maxTrockenZeit})`);
  console.log(`  Objekte je Spur:          ${r.proSpurProzent.map((v) => v.toFixed(1) + ' %').join('  ')}  (n=${r.gesamtSpawns})`);
}

console.log(`${SEKUNDEN}s  ${AFFE}  aspect=${ASPECT.toFixed(3)}  seed=${SEED}  bahnZiele=${CONFIG.rock.korridor.bahnZiele}`);
zeig('IST (Code wie er ist)', lauf({ fix: false }));
zeig('MIT FIX (Selbstwahl ausgeschlossen)', lauf({ fix: true }));
