/**
 * EXAKTE Erreichbarkeitsrechnung MIT Wischverzögerung (Gegenprobe zu fairness.mjs).
 *
 * Statt der stufenlosen Aufweitung von fairness.mjs wird hier der ECHTE
 * Bewegungsapparat des orangen Affen nachgebaut:
 *
 *   - Er steht auf Bahnen (world.bahnX), nicht stufenlos.
 *   - Ein Wisch wirkt erst nach `wischVerzoegerung` (Game.js:1010-1029);
 *     ein zweiter Wisch in der Wartezeit ÜBERSCHREIBT den ersten. Daraus
 *     folgt: zwei WIRKSAME Bahnwechsel liegen mindestens `verzug` auseinander.
 *   - Zwischen zwei Bahnen fährt er exakt wie SpritePlayer.update:
 *     schritt = rest*(1-e^(-rate*dt)), gedeckelt auf moveSpeed*dt.
 *
 * Verfolgt wird die MENGE ALLER Zustände (Bahn / Übergang / Frames seit dem
 * letzten wirksamen Wechsel), die bis hierher überlebt haben. Wird sie leer,
 * war die Welle mit Verzögerung nachweislich unausweichlich.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { PerspectiveCamera } from 'three';

import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}

const DT = 1 / 60;
const LETZTE_GRENZE = CONFIG.wall.stages.at(-1)?.afterSeconds ?? 0;
const SEKUNDEN = arg('sekunden', Math.ceil(LETZTE_GRENZE + 60));
const LAEUFE = arg('laeufe', 4);
const AFFE = String(arg('affe', 'orange'));
const VERZUG_ARG = arg('verzug', null); // überschreibt config (0 = ohne)
const EINSCHWINGEN = 4;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BILD_SEITE = new Map();
async function bildseitenLaden() {
  const wurzel = dirname(fileURLToPath(import.meta.url));
  for (const [id, char] of Object.entries(CONFIG.characters.list)) {
    const pfad = (char.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
    const datei = resolve(wurzel, '..', 'public', pfad.replace(/^\//, ''));
    try {
      const m = await sharp(datei).metadata();
      BILD_SEITE.set(id, m.width / m.height);
    } catch {
      BILD_SEITE.set(id, 0.56);
    }
  }
}
const halbeAffenBreite = (id, p) => (p.spriteHeight * (BILD_SEITE.get(id) ?? 0.56)) / 2;

function spielfeld(aspect, halbeBreite, pCfg) {
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
  const rand = Math.max(halbeBreite, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - rand);
  const maxX = Math.min(base.bounds.maxX, limit);
  return {
    ...base,
    bounds: { minX: Math.max(base.bounds.minX, -limit), maxX, minY: base.bounds.minY, maxY: base.bounds.maxY },
    // --deckel: Bahnen wie im Spiel auf world.bahnDeckel begrenzt
    // (Game.js:2586). fairness.mjs tut das NICHT — im Querformat liegen die
    // Bahnen dort bei ±8.3 statt ±2.2.
    bahnX: base.bahnen.map(
      (a) => a * (process.argv.includes('--deckel') ? Math.min(maxX, base.bahnDeckel) : maxX),
    ),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
  };
}

function stufeBei(sek) {
  const stages = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < stages.length; i++) if (sek >= stages[i].afterSeconds) idx = i;
  const letzte = stages[stages.length - 1];
  if (sek >= letzte.afterSeconds) {
    const extra = Math.floor((sek - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (stages.length - 1 + extra) % stages.length;
  }
  return stages[idx];
}

/** Positionskurve eines Bahnwechsels von a nach b, Frame für Frame. */
function kurve(xa, xb, pCfg, kMax) {
  const rate = 3 / Math.max(0.02, pCfg.bahnWechselZeit ?? CONFIG.player.bahnWechselZeit ?? 0.16);
  const maxS = pCfg.moveSpeed * DT;
  const out = [xa];
  let x = xa;
  for (let k = 1; k <= kMax; k++) {
    const rest = xb - x;
    let s = rest * (1 - Math.exp(-rate * DT));
    if (s > maxS) s = maxS;
    else if (s < -maxS) s = -maxS;
    x += s;
    if (Math.abs(xb - x) < 0.002) x = xb;
    out.push(x);
  }
  return out;
}

function lauf({ seed, affe, aspect, steigt, hoehe, verzug }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const hitRadius = pCfg.hitRadius;
    const ignoreR = charCfg.ignoreRockRadius ?? 0;

    const world = spielfeld(aspect, halbeAffenBreite(affe, pCfg), pCfg);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const py = hoehe ?? pCfg.startPosition[1];
    const bahnX = world.bahnX;
    const N = bahnX.length;
    const SPERRE = Math.max(1, Math.round(verzug / DT)); // Frames zwischen zwei WIRKSAMEN Wechseln
    const KMAX = SPERRE; // ab hier ist der Affe wieder frei (und längst angekommen)

    // Positionskurven für alle Nachbarpaare vorberechnen.
    const kurven = new Map();
    for (let a = 0; a < N; a++)
      for (const b of [a - 1, a + 1])
        if (b >= 0 && b < N) kurven.set(`${a}>${b}`, kurve(bahnX[a], bahnX[b], pCfg, KMAX));

    /* Zustand: `${von}>${nach}:${k}` mit k = Frames seit dem wirksamen Wechsel.
     * k >= SPERRE  =>  steht auf `nach` und darf wieder wechseln. */
    const startBahn = (() => {
      let b = 0;
      const x0 = pCfg.startPosition[0];
      for (let i = 1; i < N; i++) if (Math.abs(bahnX[i] - x0) < Math.abs(bahnX[b] - x0)) b = i;
      return b;
    })();
    let zustaende = new Map(); // key -> {von, nach, k, x}
    zustaende.set(`${startBahn}>${startBahn}:${SPERRE}`, { von: startBahn, nach: startBahn, k: SPERRE, x: bahnX[startBahn] });

    const frames = Math.round(SEKUNDEN / DT);
    let minZustaende = Infinity;
    let minZeit = 0;
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      const base = difficulty.scrollSpeed;
      const assisted = base + (steigt ? pCfg.climbAssist : 0);
      const scroll = Math.max(assisted, base * pCfg.minScrollFactor);
      spawner.hazardLook = stufeBei(t).hazard;

      // 1) Spieler: alle möglichen Folgezustände
      const naechste = new Map();
      const merken = (von, nach, k) => {
        const key = `${von}>${nach}:${k}`;
        if (naechste.has(key)) return;
        const x = k === 0 ? bahnX[von] : (kurven.get(`${von}>${nach}`) ?? [bahnX[von]])[Math.min(k, KMAX)] ?? bahnX[nach];
        naechste.set(key, { von, nach, k, x: von === nach ? bahnX[nach] : x });
      };
      for (const z of zustaende.values()) {
        const kNeu = Math.min(z.k + 1, SPERRE);
        merken(z.von, z.nach, kNeu); // bleiben
        if (z.k >= SPERRE) {
          // wirksamer Wechsel JETZT möglich (der Wisch lag `verzug` zurück)
          for (const b of [z.nach - 1, z.nach + 1])
            if (b >= 0 && b < N) merken(z.nach, b, 1);
        }
      }
      zustaende = naechste;

      // 2) Objekte fallen
      spawner.update(DT, false, scroll);

      // 3) Getroffene Zustände sterben
      const verboten = [];
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        if (r.radius <= ignoreR) continue;
        const R = hitRadius + r.hitRadius;
        const dy = py - r.y;
        const rest = R * R - dy * dy;
        if (rest <= 0) continue;
        const halb = Math.sqrt(rest);
        verboten.push([r.x - halb, r.x + halb]);
      }
      if (verboten.length) {
        for (const [key, z] of zustaende) {
          for (const [a, b] of verboten) {
            if (z.x > a && z.x < b) {
              zustaende.delete(key);
              break;
            }
          }
        }
      }

      if (t > EINSCHWINGEN && zustaende.size < minZustaende) {
        minZustaende = zustaende.size;
        minZeit = t;
      }
      if (zustaende.size === 0) {
        return { ok: false, seed, aspect, steigt, hoehe, zeit: t, stufe: stufeBei(t).name };
      }
    }
    return { ok: true, seed, minZustaende, minZeit };
  } finally {
    Math.random = echt;
  }
}

await bildseitenLaden();

const FORMATE = { quer: 16 / 9, hoch: 9 / 19.5 };
const charCfg = CONFIG.characters.list[AFFE];
const verzug = VERZUG_ARG ?? charCfg.wischVerzoegerung ?? 0;
const pCfg = { ...CONFIG.player, ...charCfg.player };
const HOEHEN = process.argv.includes('--echte-hoehe')
  ? [pCfg.startPosition[1]]
  : [pCfg.startPosition[1], CONFIG.world.bounds.minY, -1.4, 0, 1.4, CONFIG.world.bounds.maxY];

console.log(
  `EXAKT mit Verzug ${verzug}s — ${AFFE}, ${LAEUFE} Läufe à ${SEKUNDEN}s, dt=${DT.toFixed(4)}\n`,
);

let durch = 0;
let gesamt = 0;
for (const [fname, aspect] of Object.entries(FORMATE)) {
  for (const steigt of [false, true]) {
    let schlimmste = Infinity;
    let info = null;
    let fehler = null;
    for (let i = 0; i < LAEUFE; i++) {
      const hoehe = HOEHEN[i % HOEHEN.length];
      const r = lauf({ seed: 1000 + i * 7919, affe: AFFE, aspect, steigt, hoehe, verzug });
      gesamt++;
      if (!r.ok) {
        durch++;
        fehler = r;
      } else if (r.minZustaende < schlimmste) {
        schlimmste = r.minZustaende;
        info = r;
      }
    }
    console.log(
      `  ${fname.padEnd(5)} ${(steigt ? 'W gedrückt' : 'ohne W').padEnd(11)} ` +
        (fehler
          ? `DURCHGEFALLEN bei ${fehler.zeit.toFixed(1)}s (${fehler.stufe}, hoehe ${fehler.hoehe})`
          : `wenigste überlebende Zustände: ${schlimmste} bei ${info.minZeit.toFixed(0)}s`),
    );
  }
}
console.log('');
console.log(durch === 0 ? `BESTANDEN — ${gesamt} Läufe, nie ausweglos.` : `DURCHGEFALLEN — ${durch}/${gesamt}`);
