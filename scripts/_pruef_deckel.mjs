/**
 * PRUEFUNG DES BAHNDECKELS (CONFIG.world.bahnDeckel = 2.2)
 *
 * MESSSKRIPT — aendert NICHTS am Spiel. Aufruf:
 *     node scripts/_pruef_deckel.mjs
 *     node scripts/_pruef_deckel.mjs --minuten 5 --laeufe 8 --teil B
 *
 * WARUM NOCH EIN SKRIPT NEBEN _pcvshandy.mjs
 * _pcvshandy.mjs kennt `CONFIG.world.bahnDeckel` NICHT (es liest ihn nirgends)
 * und bildet den Deckel nur ueber die Option --deckel nach. Dabei deckelt es
 * `bounds.maxX` MIT — das Spiel tut das ausdruecklich nicht:
 *
 *   Game.js:2566   view.bounds.maxX = Math.min(base.bounds.maxX, limit)   // UNgedeckelt
 *   Game.js:2586   const halbFeld  = Math.min(view.bounds.maxX, base.bahnDeckel)
 *   Game.js:2588   view.bahnX      = base.bahnen.map(a => a * halbFeld)
 *
 * bounds.maxX geht also weiterhin bis an den Bildrand, nur die BAHNEN sind
 * gedeckelt. Alles, was bounds.maxX liest (Korridor, Boss, Chili-Schwung,
 * Tempolinien, Spawner._tempoDamitPlatzBleibt), sieht deshalb weiter das
 * volle Feld. Dieses Skript rechnet alle drei Welten nebeneinander:
 *
 *   alt      ohne Deckel                       (Stand vor dem Fix)
 *   skript   _pcvshandy --deckel 2.2           (bounds MIT gedeckelt)
 *   spiel    exakt Game._updateWorldBounds     (nur bahnX gedeckelt)
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { PerspectiveCamera } from 'three';

import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';
// Rock.js liefert kopflos einen zu kleinen Wert — siehe SPRITEBREITE oben.

/* ============================================================== Argumente */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}
const MINUTEN = arg('minuten', 5);
const LAEUFE = arg('laeufe', 6);
const DT = 1 / 60;
const SEKUNDEN = MINUTEN * 60;
const EINSCHWINGEN = 6;
const TEILE = String(arg('teil', 'ABCDEF')).toUpperCase();

/* BREITESTES OBJEKTBILD — kopflos NICHT aus Rock.js zu bekommen.
 *
 * `groessteSpriteBreite` (Rock.js:193-211) liest den Sprite-Atlas `geteilt`.
 * Ohne Browser ist der leer, und die Funktion faellt auf `2 * radius` zurueck:
 * 1.480 statt der echten 1.788. Genau diesen Fehler haben auch fairness.mjs
 * (:244) und _pcvshandy.mjs (:147) — sie rechnen das Feld dadurch 0.154
 * Einheiten ZU BREIT, auf dem Handy also gut 10 %.
 *
 * Gemessen im laufenden Spiel (localhost, window.__game.worldView):
 *     390x844 (9:19.5)  bounds.maxX 1.459   (kopflos gerechnet: 1.611)
 *     405x720 (9:16)    bounds.maxX 1.971   (kopflos gerechnet: 2.125)
 *     1280x720 (16:9)   bounds.maxX 8.160   (kopflos gerechnet: 8.314)
 * Aus 9.054 - 8.160 folgt rand = 0.894, also breitestes Bild 1.788.
 *
 * --spritebreite 1.480 stellt das kopflose (falsche) Verhalten wieder her.
 */
const SPRITEBREITE = arg('spritebreite', 1.788);

const FORMATE = [
  { name: '9:19.5  schmales Handy', aspect: 9 / 19.5 },
  { name: '9:16    Handy', aspect: 9 / 16 },
  { name: '3:4     Tablet hoch', aspect: 3 / 4 },
  { name: '1:1     quadratisch', aspect: 1 },
  { name: '16:9    Laptop', aspect: 16 / 9 },
  { name: '21:9    breit', aspect: 21 / 9 },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =========================================================== Spielfeldmasse */
const BILD_SEITE = new Map();
async function bildseitenLaden() {
  const wurzel = dirname(fileURLToPath(import.meta.url));
  for (const [id, char] of Object.entries(CONFIG.characters.list)) {
    const pfad = (char.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
    const datei = resolve(wurzel, '..', 'public', pfad.replace(/^\//, ''));
    try {
      const m = await sharp(datei).metadata();
      BILD_SEITE.set(id, m.width / m.height);
    } catch (f) {
      console.warn(`[pruef] ${datei} nicht lesbar (${f.message}) — nehme 0.56.`);
      BILD_SEITE.set(id, 0.56);
    }
  }
}
function halbeAffenBreite(charId, pCfg) {
  return (pCfg.spriteHeight * (BILD_SEITE.get(charId) ?? 0.56)) / 2;
}

function kamera(aspect) {
  const cam = CONFIG.render.camera;
  const c = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  c.position.set(...cam.position);
  c.lookAt(...cam.lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  c.matrixWorldInverse.copy(c.matrixWorld).invert();
  return c;
}

/**
 * Die vier Weltvarianten.
 *
 *   alt      ohne Deckel — Stand vor dem Fix
 *   skript   WOERTLICH _pcvshandy.mjs:149-163 mit --deckel 2.2. Achtung: dort
 *            wird nur maxX gedeckelt, minX bleibt bei -limit. Das Feld ist
 *            deshalb ASYMMETRISCH (16:9: -8.31 .. +2.20) — eine Welt, die es
 *            weder vorher noch nachher gibt.
 *   spiel    exakt Game._updateWorldBounds: nur bahnX gedeckelt, bounds breit
 *   eng      bounds SYMMETRISCH auf ±Deckel — der Vorschlag zum Vergleich
 *
 * @param {'alt'|'skript'|'spiel'|'eng'} variante
 */
function spielfeld(aspect, halbeBreiteAffe, pCfg, variante) {
  const base = CONFIG.world;
  const camera = kamera(aspect);
  const affenHoehe = (pCfg.startPosition ?? CONFIG.player.startPosition)[1];
  const half = halfWidthAt(camera, 0, affenHoehe);
  const rand = Math.max(halbeBreiteAffe, SPRITEBREITE / 2);
  const limit = Math.max(0.9, half - rand);

  let maxX = Math.min(base.bounds.maxX, limit);
  let minX = Math.max(base.bounds.minX, -limit);
  let halbFeld = maxX;
  if (variante === 'skript') {
    maxX = Math.min(maxX, base.bahnDeckel); // minX bleibt absichtlich stehen
    halbFeld = maxX;
  } else if (variante === 'eng') {
    maxX = Math.min(maxX, base.bahnDeckel);
    minX = Math.max(minX, -base.bahnDeckel);
    halbFeld = maxX;
  } else if (variante === 'spiel') {
    halbFeld = Math.min(maxX, base.bahnDeckel ?? Infinity);
  }

  return {
    ...base,
    bounds: { minX, maxX, minY: base.bounds.minY, maxY: base.bounds.maxY },
    bahnX: base.bahnen.map((a) => a * halbFeld),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
    _halbFeld: halbFeld,
    _sichtHalb: half,
    _limit: limit,
  };
}

/* ================================================== Bewegung (SpritePlayer) */
function schrittMachen(x, ziel, pCfg, dt, bounds) {
  const rest = ziel - x;
  const rate = 3 / Math.max(0.02, pCfg.bahnWechselZeit ?? 0.16);
  let schritt = rest * (1 - Math.exp(-rate * dt));
  const maxSchritt = pCfg.moveSpeed * dt;
  if (schritt > maxSchritt) schritt = maxSchritt;
  else if (schritt < -maxSchritt) schritt = -maxSchritt;
  let nx = x + schritt;
  if (Math.abs(ziel - nx) < 0.002) nx = ziel;
  if (nx < bounds.minX) nx = bounds.minX;
  else if (nx > bounds.maxX) nx = bounds.maxX;
  return nx;
}

function pendlerZustand({ bahnA, bahnB, umkehr, pCfg, char }) {
  const verzug = char.wischVerzoegerung ?? 0;
  return {
    bahnA, bahnB, umkehr, verzug,
    vorhalt: umkehr + pCfg.moveSpeed * verzug,
    ziel: bahnB, pending: null, gewischt: false,
    start: bahnA + Math.sign(bahnB - bahnA) * umkehr,
  };
}
function pendlerSchritt(z, x, t) {
  if (z.pending !== null && t >= z.pending.wann) {
    z.ziel = z.pending.ziel; z.pending = null; z.gewischt = false;
  }
  if (z.pending === null && !z.gewischt && Math.abs(z.ziel - x) <= z.vorhalt) {
    const neu = z.ziel === z.bahnA ? z.bahnB : z.bahnA;
    z.pending = { wann: t + z.verzug, ziel: neu };
    z.gewischt = true;
    if (z.verzug <= 0) { z.ziel = neu; z.pending = null; z.gewischt = false; }
  }
  return z.ziel;
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

/* ==================================================== Ein Lauf gegen Spawner */
function lauf({ seed, affe, aspect, variante, strategie, sekunden, messen = false }) {
  const echterZufall = Math.random;
  Math.random = rng(seed);
  try {
    const char = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...char.player };
    const world = spielfeld(aspect, halbeAffenBreite(affe, pCfg), pCfg, variante);

    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    /* ---- Mitschreiben AN DER SPAWN-METHODE, nicht an den Objekten:
     * Steine/Muenzen sind GEPOOLT, ein WeakSet auf die Instanzen zaehlt jede
     * Wiederverwendung als "schon gesehen". */
    const bahnZaehler = new Array(world.bahnX.length).fill(0);
    const muenzZaehler = new Array(world.bahnX.length).fill(0);
    let ausfaelle = 0;
    let versuche = 0;
    const index = (x) => {
      let b = 0;
      for (let i = 1; i < world.bahnX.length; i++) {
        if (Math.abs(world.bahnX[i] - x) < Math.abs(world.bahnX[b] - x)) b = i;
      }
      return b;
    };
    if (messen) {
      const origFrei = spawner._freieStelle.bind(spawner);
      spawner._freieStelle = (t, hr) => {
        const x = origFrei(t, hr);
        versuche++;
        if (x === null) ausfaelle++;
        else bahnZaehler[index(x)]++;
        return x;
      };
      const origCoin = spawner._spawnCoin.bind(spawner);
      spawner._spawnCoin = () => {
        const vorher = spawner.coins.active.length;
        origCoin();
        if (spawner.coins.active.length > vorher) {
          muenzZaehler[index(spawner.coins.active[spawner.coins.active.length - 1]._mitteX)]++;
        }
      };
    }

    const py = pCfg.startPosition[1];
    const ignoreR = char.ignoreRockRadius ?? 0;
    const bahnA = world.bahnX[0];
    const bahnB = world.bahnX[1];
    const d = bahnB - bahnA;
    const Rmittel = pCfg.hitRadius + CONFIG.rock.types[1].radius * CONFIG.rock.hitRadiusFactor;
    const Rgross =
      pCfg.hitRadius +
      Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
    const slop = pCfg.moveSpeed * DT + 0.02;
    const umkehr = Math.min(strategie === 'optimal' ? Rgross + slop : Rmittel, 0.45 * d);
    const z = pendlerZustand({ bahnA, bahnB, umkehr, pCfg, char });

    let x = strategie === 'steher' ? world.bahnX[1] : z.start;
    let ziel = strategie === 'steher' ? world.bahnX[1] : z.ziel;

    const getroffen = new Set();
    let treffer = 0;
    let ersterTreffer = null;
    let korridorDraussen = 0;
    let korridorFrames = 0;
    let steineImBild = 0;

    const frames = Math.round(sekunden / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      spawner.hazardLook = stufeBei(t).hazard;

      if (strategie !== 'steher') ziel = pendlerSchritt(z, x, t);
      x = schrittMachen(x, ziel, pCfg, DT, world.bounds);

      spawner.update(DT, false, difficulty.scrollSpeed);

      if (t > EINSCHWINGEN) {
        korridorFrames++;
        if (Math.abs(spawner.korridor.x) > world._halbFeld + 1e-9) korridorDraussen++;
        steineImBild += spawner.rocks.active.length;
      }

      for (const r of spawner.rocks.active) {
        if (!r.active || r.radius <= ignoreR) continue;
        const dx = x - r.x;
        const dy = py - r.y;
        const R = pCfg.hitRadius + r.hitRadius;
        if (dx * dx + dy * dy <= R * R && !getroffen.has(r) && t > EINSCHWINGEN) {
          getroffen.add(r);
          treffer++;
          if (ersterTreffer === null) ersterTreffer = t - EINSCHWINGEN;
        }
      }
      for (const r of spawner.rocks.all) if (!r.active) getroffen.delete(r);
    }

    const gemessen = sekunden - EINSCHWINGEN;
    return {
      treffer,
      proMinute: treffer / (gemessen / 60),
      ersterTreffer,
      bahnZaehler, muenzZaehler, ausfaelle, versuche,
      korridorAnteilDraussen: korridorFrames ? korridorDraussen / korridorFrames : 0,
      steineSchnitt: korridorFrames ? steineImBild / korridorFrames : 0,
      world,
    };
  } finally {
    Math.random = echterZufall;
  }
}

const median = (a) => {
  const s = [...a].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* =========================================== A) Geometrie und Bildnutzung */
function teilA() {
  console.log('\n' + '='.repeat(112));
  console.log('A)  GEOMETRIE MIT DEM ECHTEN DECKEL   (bahnDeckel = ' + CONFIG.world.bahnDeckel + ', config.js:147)');
  console.log('    "genutzt" = Strecke, die der Affe samt Bild einnimmt, geteilt durch die sichtbare Breite');
  console.log('='.repeat(112));
  for (const [affe, char] of Object.entries(CONFIG.characters.list)) {
    const pCfg = { ...CONFIG.player, ...char.player };
    const hb = halbeAffenBreite(affe, pCfg);
    console.log(`\n${char.label}   (halbe Bildbreite ${hb.toFixed(3)}, hitRadius ${pCfg.hitRadius})`);
    console.log(
      '  Format                sichtbar±   bounds±   halbFeld   Bahnabstand   Affenband±   genutzt   ungenutzt',
    );
    for (const f of FORMATE) {
      const w = spielfeld(f.aspect, hb, pCfg, 'spiel');
      const band = w._halbFeld + hb; // aussen steht er mit halber Bildbreite drüber
      const genutzt = band / w._sichtHalb;
      console.log(
        `  ${f.name.padEnd(20)}${w._sichtHalb.toFixed(3).padStart(9)}` +
          `${w.bounds.maxX.toFixed(3).padStart(10)}` +
          `${w._halbFeld.toFixed(3).padStart(11)}` +
          `${(w.bahnX[1] - w.bahnX[0]).toFixed(3).padStart(14)}` +
          `${band.toFixed(3).padStart(13)}` +
          `${(genutzt * 100).toFixed(1).padStart(10)} %` +
          `${((1 - genutzt) * 100).toFixed(1).padStart(11)} %`,
      );
    }
  }
}

/* ========================== B) Wirkt der Deckel? Drei Welten nebeneinander */
function teilB() {
  console.log('\n' + '='.repeat(112));
  console.log(`B)  WIRKT ER?   ${LAEUFE} Laeufe x ${MINUTEN} min je Zelle, erste ${EINSCHWINGEN} s zaehlen nicht`);
  console.log('    alt    = ohne Deckel (Stand vorher)');
  console.log('    skript = _pcvshandy --deckel 2.2 (deckelt bounds MIT)');
  console.log('    spiel  = Game._updateWorldBounds (nur bahnX gedeckelt, bounds breit)');
  console.log('    eng    = bounds SYMMETRISCH auf ±2.2 mitgedeckelt (Vergleichsvorschlag)');
  console.log('='.repeat(112));

  for (const affe of ['braun']) {
    const char = CONFIG.characters.list[affe];
    console.log(`\n${char.label}`);
    console.log(
      '  Format                Welt     | Steher Tr/min | Pendler Tr/min  1.Tr | Optimal Tr/min  1.Tr  nie getroffen',
    );
    for (const f of FORMATE) {
      for (const variante of ['alt', 'skript', 'spiel', 'eng']) {
        const erg = {};
        for (const strategie of ['steher', 'pendler', 'optimal']) {
          erg[strategie] = [];
          for (let i = 0; i < LAEUFE; i++) {
            erg[strategie].push(
              lauf({ seed: 1000 + i, affe, aspect: f.aspect, variante, strategie, sekunden: SEKUNDEN }),
            );
          }
        }
        const mit = (a, k) => a.reduce((m, r) => m + r[k], 0) / a.length;
        const gemessen = SEKUNDEN - EINSCHWINGEN;
        const erst = (a) => median(a.map((r) => (r.ersterTreffer === null ? gemessen : r.ersterTreffer)));
        const nie = (a) => a.filter((r) => r.ersterTreffer === null).length;
        console.log(
          `  ${(variante === 'alt' ? f.name : '').padEnd(20)}` +
            `${variante.padEnd(9)}` +
            `${mit(erg.steher, 'proMinute').toFixed(2).padStart(14)} |` +
            `${mit(erg.pendler, 'proMinute').toFixed(2).padStart(14)}` +
            `${(erst(erg.pendler).toFixed(0) + (nie(erg.pendler) ? '+' : '') + 's').padStart(7)} |` +
            `${mit(erg.optimal, 'proMinute').toFixed(2).padStart(14)}` +
            `${(erst(erg.optimal).toFixed(0) + (nie(erg.optimal) ? '+' : '') + 's').padStart(7)}` +
            `${(nie(erg.optimal) + '/' + LAEUFE).padStart(9)}`,
        );
      }
      console.log('');
    }
  }
}

/* ================================ C) Was der Deckel an der Verteilung tut */
function teilC() {
  console.log('\n' + '='.repeat(112));
  console.log(`C)  BAHNVERTEILUNG UND KORRIDOR   (${LAEUFE} Laeufe x ${MINUTEN} min, Affe braun, Steher)`);
  console.log('    Der Korridor wandert ueber bounds (Spawner.js:288-294), die Bahnen liegen bei ±halbFeld.');
  console.log('    "Korr. draussen" = Anteil der Zeit, in der die garantierte Bahn AUSSERHALB des Bahnbandes liegt.');
  console.log('='.repeat(112));
  console.log(
    '\n  Format                Welt     Steine je Bahn (links/mitte/rechts)   Ausfall   Muenzen je Bahn        Korr.draussen  Steine/Bild',
  );
  for (const f of FORMATE) {
    for (const variante of ['alt', 'spiel', 'eng']) {
      const laeufe = [];
      for (let i = 0; i < LAEUFE; i++) {
        laeufe.push(
          lauf({ seed: 2000 + i, affe: 'braun', aspect: f.aspect, variante, strategie: 'steher', sekunden: SEKUNDEN, messen: true }),
        );
      }
      const summe = (feld) =>
        laeufe.reduce((a, r) => a.map((v, i) => v + r[feld][i]), new Array(3).fill(0));
      const st = summe('bahnZaehler');
      const mu = summe('muenzZaehler');
      const stSum = st.reduce((a, b) => a + b, 0) || 1;
      const muSum = mu.reduce((a, b) => a + b, 0) || 1;
      const aus = laeufe.reduce((a, r) => a + r.ausfaelle, 0);
      const ver = laeufe.reduce((a, r) => a + r.versuche, 0) || 1;
      const kd = laeufe.reduce((a, r) => a + r.korridorAnteilDraussen, 0) / laeufe.length;
      const sb = laeufe.reduce((a, r) => a + r.steineSchnitt, 0) / laeufe.length;
      console.log(
        `  ${(variante === 'alt' ? f.name : '').padEnd(20)}${variante.padEnd(9)}` +
          st.map((v) => ((v / stSum) * 100).toFixed(1).padStart(9) + ' %').join('') +
          `${((aus / ver) * 100).toFixed(1).padStart(9)} %  ` +
          mu.map((v) => ((v / muSum) * 100).toFixed(1).padStart(7) + ' %').join('') +
          `${(kd * 100).toFixed(1).padStart(13)} %` +
          `${sb.toFixed(2).padStart(13)}`,
      );
    }
    console.log('');
  }
}

/* ============================================ D) Formatwechsel mitten drin */

/** Spiegel von Game._updateWorldBounds (Game.js:2487-2651), inkl. Streckung. */
function weltAktualisieren(view, aspect, pCfg, hb, spawner) {
  const base = CONFIG.world;
  const camera = kamera(aspect);
  const affenHoehe = pCfg.startPosition[1];
  const half = halfWidthAt(camera, 0, affenHoehe);
  const rand = Math.max(hb, SPRITEBREITE / 2);
  const limit = Math.max(0.9, half - rand);

  const altesFeld = view._halbFeld ?? view.bounds.maxX; // Game.js:2563

  view.bounds.minX = Math.max(base.bounds.minX, -limit);
  view.bounds.maxX = Math.min(base.bounds.maxX, limit);

  const halbFeld = Math.min(view.bounds.maxX, base.bahnDeckel ?? Infinity);
  view._halbFeld = halbFeld;
  view.bahnX = base.bahnen.map((a) => a * halbFeld);

  if (altesFeld > 0.01 && Math.abs(halbFeld - altesFeld) > 1e-6) {
    const streckung = halbFeld / altesFeld;
    for (const pool of [spawner?.rocks, spawner?.bananas, spawner?.coins]) {
      for (const o of pool?.active ?? []) {
        if (!o.active) continue;
        o.x *= streckung;
        if (o._mitteX !== undefined) o._mitteX *= streckung;
        o.mesh.position.x = o.x;
      }
    }
  }
  view.spawnHalfWidth = Math.min(base.spawnHalfWidth, limit + 0.8);
  spawner?.korridor.grenzenAendern(view.bounds.minX, view.bounds.maxX);
}

function teilD() {
  console.log('\n' + '='.repeat(112));
  console.log('D)  FORMATWECHSEL MITTEN IM SPIEL   Hochformat -> 16:9 -> Hochformat');
  console.log('    Nach jedem Wechsel: liegt JEDES fallende Objekt noch exakt auf einer Bahn?');
  console.log('='.repeat(112));

  const affe = 'braun';
  const char = CONFIG.characters.list[affe];
  const pCfg = { ...CONFIG.player, ...char.player };
  const hb = halbeAffenBreite(affe, pCfg);
  const folge = [9 / 19.5, 16 / 9, 9 / 19.5, 21 / 9, 3 / 4, 9 / 16];

  let fehlerGesamt = 0;
  const geprueft = {};
  const fehlerNach = {};
  for (let seed = 0; seed < 8; seed++) {
    const echterZufall = Math.random;
    Math.random = rng(3000 + seed);
    try {
      const view = {
        ...CONFIG.world,
        bounds: { ...CONFIG.world.bounds },
        bahnX: CONFIG.world.bahnen.map((a) => a * CONFIG.world.bounds.maxX),
      };
      const difficulty = new DifficultyCurve(CONFIG.difficulty);
      difficulty.setRockMix(CONFIG.rock.mix);
      const spawner = new Spawner({ add() {} }, CONFIG, difficulty, view, null);
      spawner.bananasEnabled = true;
      spawner.setSpieler(pCfg);
      spawner.setzePowerupBilder(new Map());
      spawner.reset();
      weltAktualisieren(view, folge[0], pCfg, hb, spawner);
      spawner.korridor.reset(0);

      for (let schritt = 0; schritt < folge.length; schritt++) {
        // 12 s laufen lassen, damit reichlich in der Luft ist
        const n = Math.round(12 / DT);
        for (let f = 0; f < n; f++) {
          difficulty.update(DT);
          spawner.hazardLook = stufeBei(difficulty.elapsed).hazard;
          spawner.update(DT, false, difficulty.scrollSpeed);
          // Kurz VOR dem Wechsel, damit sie beim Wechsel noch in der Luft ist.
          if (f === n - 24) spawner.powerupWerfen(seed % 2 ? 'chili' : 'gold');
        }
        weltAktualisieren(view, folge[(schritt + 1) % folge.length], pCfg, hb, spawner);

        // Pruefen
        const gruppen = [
          ['Stein', spawner.rocks],
          ['Banane', spawner.bananas],
          ['Muenze', spawner.coins],
          ['Powerup', spawner.powerups],
        ];
        for (const [name, pool] of gruppen) {
          for (const o of pool?.active ?? []) {
            if (!o.active) continue;
            geprueft[name] = (geprueft[name] ?? 0) + 1;
            const px = o._mitteX !== undefined ? o._mitteX : o.x;
            let dmin = Infinity;
            for (const b of view.bahnX) dmin = Math.min(dmin, Math.abs(px - b));
            if (dmin > 1e-6) {
              fehlerGesamt++;
              fehlerNach[name] = (fehlerNach[name] ?? 0) + 1;
              if (fehlerGesamt <= 12) {
                console.log(
                  `  ABWEICHUNG  seed ${seed}  Schritt ${schritt}  ${name}` +
                    `  x=${px.toFixed(4)}  Bahnen=[${view.bahnX.map((b) => b.toFixed(3)).join(', ')}]` +
                    `  Abstand ${dmin.toFixed(4)}`,
                );
              }
            }
          }
        }
      }
    } finally {
      Math.random = echterZufall;
    }
  }
  console.log(
    `\n  geprueft: ${Object.entries(geprueft).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  if (Object.keys(fehlerNach).length) {
    console.log(`  daneben:  ${Object.entries(fehlerNach).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  console.log(
    fehlerGesamt === 0
      ? '\n  BESTANDEN — nach jedem Wechsel lag jedes Objekt exakt auf einer Bahn.'
      : `\n  DURCHGEFALLEN — ${fehlerGesamt} Objekte lagen nach einem Wechsel neben der Bahn.`,
  );
}

/* ============================================ E) Boss und Munition erreichbar */
function teilE() {
  console.log('\n' + '='.repeat(112));
  console.log('E)  BOSSKAMPF: WIE VIEL DAVON IST UEBERHAUPT ERREICHBAR?');
  console.log('    Der Boss faehrt bounds ab (BossKampf.js:254-255), geworfen wird SENKRECHT von einer Bahn.');
  console.log('    Munition faellt bei minX + Spanne*(0.15..0.85) (BossKampf.js:361-364).');
  console.log('='.repeat(112));

  const affe = 'braun';
  const pCfg = { ...CONFIG.player, ...CONFIG.characters.list[affe].player };
  const hb = halbeAffenBreite(affe, pCfg);
  const wurfR = CONFIG.boss.wurf.hitRadius;

  for (const art of CONFIG.boss.arten) {
    const trefferR = art.hoehe * CONFIG.boss.trefferAnteil;
    const reich = trefferR + wurfR;
    console.log(`\n  ${art.label}  (Hoehe ${art.hoehe}, Trefferradius ${trefferR.toFixed(3)}, Wurf ${wurfR}  ->  Reichweite ±${reich.toFixed(3)})`);
    console.log('  Format                bounds±   Bahnen           Boss treffbar   Munition erreichbar');
    for (const f of FORMATE) {
      const w = spielfeld(f.aspect, hb, pCfg, 'spiel');
      // Vereinigung der Intervalle [bahn-reich, bahn+reich], geschnitten mit bounds
      const iv = w.bahnX
        .map((b) => [Math.max(-w.bounds.maxX, b - reich), Math.min(w.bounds.maxX, b + reich)])
        .sort((a, b) => a[0] - b[0]);
      const zus = [];
      for (const s of iv) {
        const l = zus[zus.length - 1];
        if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]);
        else zus.push([...s]);
      }
      const treffbar = zus.reduce((a, [p, q]) => a + (q - p), 0) / (2 * w.bounds.maxX);

      // Munition: Abwurf gleichverteilt ueber [minX+0.15S, minX+0.85S], faellt senkrecht.
      const S = 2 * w.bounds.maxX;
      const a0 = -w.bounds.maxX + 0.15 * S;
      const a1 = -w.bounds.maxX + 0.85 * S;
      const holR = pCfg.hitRadius + CONFIG.boss.munition.radius * CONFIG.boss.munition.hitRadiusFactor;
      const iv2 = w.bahnX
        .map((b) => [Math.max(a0, b - holR), Math.min(a1, b + holR)])
        .filter(([p, q]) => q > p)
        .sort((a, b) => a[0] - b[0]);
      const zus2 = [];
      for (const s of iv2) {
        const l = zus2[zus2.length - 1];
        if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]);
        else zus2.push([...s]);
      }
      const holbar = zus2.reduce((a, [p, q]) => a + (q - p), 0) / (a1 - a0);

      console.log(
        `  ${f.name.padEnd(20)}${w.bounds.maxX.toFixed(3).padStart(9)}   ` +
          `[${w.bahnX.map((x) => x.toFixed(2).padStart(5)).join(',')}]` +
          `${(treffbar * 100).toFixed(1).padStart(14)} %` +
          `${(holbar * 100).toFixed(1).padStart(20)} %`,
      );
    }
  }
}

/* ======================= F) Die Fairness-Zusage mit den ECHTEN Bahnen */
/* Kern von scripts/fairness.mjs (Intervallmengen + "ist eine Bahn frei?"),
 * aber mit dem gedeckelten Spielfeld. fairness.mjs selbst kennt den Deckel
 * nicht (fairness.mjs:252-263) und prueft im Querformat Bahnen bei ±8.31. */
function ordnen(m) {
  if (m.length === 0) return m;
  m.sort((p, q) => p[0] - q[0]);
  const out = [m[0]];
  for (let i = 1; i < m.length; i++) {
    const l = out[out.length - 1];
    if (m[i][0] <= l[1] + 1e-9) { if (m[i][1] > l[1]) l[1] = m[i][1]; }
    else out.push(m[i]);
  }
  return out;
}
function aufweiten(m, d, lo, hi) {
  const out = [];
  for (const [a, b] of m) {
    const na = Math.max(lo, a - d), nb = Math.min(hi, b + d);
    if (nb > na - 1e-9) out.push([na, nb]);
  }
  return ordnen(out);
}
function abziehen(m, verboten) {
  let akt = m;
  for (const [va, vb] of verboten) {
    const n = [];
    for (const [a, b] of akt) {
      if (vb <= a || va >= b) { n.push([a, b]); continue; }
      if (va > a) n.push([a, Math.min(va, b)]);
      if (vb < b) n.push([Math.max(vb, a), b]);
    }
    akt = n;
  }
  return akt.filter(([a, b]) => b - a > 1e-9);
}

function teilF() {
  console.log('\n' + '='.repeat(112));
  console.log(`F)  FAIRNESS-ZUSAGE MIT DEN ECHTEN (gedeckelten) BAHNEN  —  ${LAEUFE} Laeufe x ${MINUTEN} min`);
  console.log('    Faellt in irgendeinem Frame keine erreichbare Bahn mehr frei?');
  console.log('='.repeat(112));

  let durchgefallen = 0;
  for (const [affe, char] of Object.entries(CONFIG.characters.list)) {
    const pCfg = { ...CONFIG.player, ...char.player };
    const hb = halbeAffenBreite(affe, pCfg);
    const ignoreR = char.ignoreRockRadius ?? 0;
    for (const f of FORMATE) {
      for (const variante of ['alt', 'spiel']) {
        let engste = Infinity;
        let fehler = 0;
        for (let i = 0; i < LAEUFE; i++) {
          const echt = Math.random;
          Math.random = rng(4000 + i * 7919);
          try {
            const world = spielfeld(f.aspect, hb, pCfg, variante);
            const difficulty = new DifficultyCurve(CONFIG.difficulty);
            difficulty.setRockMix(CONFIG.rock.mix);
            const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
            spawner.bananasEnabled = false;
            spawner.setSpieler(pCfg);
            spawner.reset();

            const py = pCfg.startPosition[1];
            const schritt = pCfg.moveSpeed * 0.5 * DT;
            let S = [[0, 0]];
            const frames = Math.round(SEKUNDEN / DT);
            for (let k = 0; k < frames; k++) {
              difficulty.update(DT);
              const t = difficulty.elapsed;
              spawner.hazardLook = stufeBei(t).hazard;
              S = aufweiten(S, schritt, world.bounds.minX, world.bounds.maxX);
              spawner.update(DT, false, difficulty.scrollSpeed);
              const verboten = [];
              for (const r of spawner.rocks.active) {
                if (!r.active || r.radius <= ignoreR) continue;
                const R = pCfg.hitRadius + r.hitRadius;
                const rest = R * R - (py - r.y) ** 2;
                if (rest <= 0) continue;
                const halb = Math.sqrt(rest);
                verboten.push([r.x - halb, r.x + halb]);
              }
              S = abziehen(S, verboten);
              if (t > EINSCHWINGEN) {
                const b = S.reduce((m, [a, c]) => Math.max(m, c - a), 0);
                if (b < engste) engste = b;
                let frei = false;
                for (const bx of world.bahnX) {
                  for (const [a, c] of S) if (bx >= a && bx <= c) { frei = true; break; }
                  if (frei) break;
                }
                if (!frei || S.length === 0) { fehler++; break; }
              }
            }
          } finally {
            Math.random = echt;
          }
        }
        if (fehler) durchgefallen++;
        console.log(
          `  ${(variante === 'alt' ? f.name : '').padEnd(20)}${variante.padEnd(8)}${char.label.padEnd(15)}` +
            `Bahnen ±${spielfeld(f.aspect, hb, pCfg, variante)._halbFeld.toFixed(3).padStart(6)}   ` +
            `engster Spielraum ${engste.toFixed(3).padStart(7)}   ` +
            (fehler ? `DURCHGEFALLEN in ${fehler}/${LAEUFE}` : 'ok'),
        );
      }
    }
    console.log('');
  }
  console.log(durchgefallen === 0 ? '  BESTANDEN — in keinem Frame war jede Bahn belegt.' : '  DURCHGEFALLEN.');
}

/* ===================================================================== Los */
await bildseitenLaden();
if (TEILE.includes('A')) teilA();
if (TEILE.includes('B')) teilB();
if (TEILE.includes('C')) teilC();
if (TEILE.includes('D')) teilD();
if (TEILE.includes('E')) teilE();
if (TEILE.includes('F')) teilF();
console.log('');
