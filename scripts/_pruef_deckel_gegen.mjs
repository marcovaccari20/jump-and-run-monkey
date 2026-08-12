/**
 * GEGENPRUEFUNG des Berichts "bahndeckel".
 *
 * Teile:
 *   1  Geometrie: groessteSpriteBreite kopflos vs. echte Bilddateien,
 *      daraus limit / halbFeld / bahnX je Seitenverhaeltnis.
 *   2  Bahnverteilung: echter Spawner, Welt EXAKT wie Game._updateWorldBounds
 *      (inkl. Deckel). Gezaehlt wird an der SPAWN-METHODE (nicht per WeakSet
 *      auf gepoolten Objekten!).
 *   3  Korridor: wie oft liegt korridor.bei(t) ausserhalb +-halbFeld.
 *   4  Variante "eng": bounds ebenfalls auf +-halbFeld geklemmt.
 *
 * node scripts/_pruef_deckel_gegen.mjs --teil 1
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

const WURZEL = dirname(fileURLToPath(import.meta.url));
const arg = (name, std) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : std;
};
const TEIL = arg('teil', 'alle');
const DT = 1 / 60;

/* ------------------------------------------------ Bildseiten der Affen */
const BILD_SEITE = new Map();
for (const [id, char] of Object.entries(CONFIG.characters.list)) {
  const pfad = (char.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
  const datei = resolve(WURZEL, '..', 'public', pfad.replace(/^\//, ''));
  try {
    const m = await sharp(datei).metadata();
    BILD_SEITE.set(id, m.width / m.height);
  } catch {
    BILD_SEITE.set(id, 0.56);
  }
}
const halbeAffenBreite = (id, pCfg) => (pCfg.spriteHeight * (BILD_SEITE.get(id) ?? 0.56)) / 2;

/* ------------------- ECHTE groesste Sprite-Breite aus den Bilddateien */
async function echteGroessteSpriteBreite(cfg) {
  let max = 0;
  let wer = '';
  for (const [lookId, look] of Object.entries(cfg.looks)) {
    for (let i = 0; i < cfg.types.length; i++) {
      const t = cfg.types[i];
      const bildName = look.bilder?.[i] ?? null;
      let breite;
      if (bildName) {
        const datei = resolve(
          WURZEL,
          '..',
          'public',
          cfg.spritePath.replace('{n}', bildName).replace(/^\//, ''),
        );
        let aspect = null;
        try {
          const m = await sharp(datei).metadata();
          aspect = m.width / m.height;
        } catch {
          aspect = null;
        }
        if (aspect) {
          const d =
            2 * t.radius * (cfg.spriteScale ?? 1) * (look.bildScaleSlots?.[i] ?? look.bildScale ?? 1);
          breite = d * Math.sqrt(aspect);
        } else {
          const st = look.strecken;
          breite = st ? 2 * t.radius * st[0] : 2 * t.radius;
        }
      } else {
        const st = look.strecken;
        breite = st ? 2 * t.radius * st[0] : 2 * t.radius;
      }
      if (breite > max) {
        max = breite;
        wer = `${lookId}/${t.id}`;
      }
    }
  }
  return { max, wer };
}

/* ------------------------------------------------ Spielfeld wie Game.js */
function spielfeld(aspect, charId, { deckel = true, eng = false, spriteBreite = null } = {}) {
  const charCfg = CONFIG.characters.list[charId];
  const pCfg = { ...CONFIG.player, ...charCfg.player };
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
  const sb = spriteBreite ?? groessteSpriteBreite(CONFIG.rock);
  const rand = Math.max(halbeAffenBreite(charId, pCfg), sb / 2);
  const limit = Math.max(0.9, half - rand);

  let minX = Math.max(base.bounds.minX, -limit);
  let maxX = Math.min(base.bounds.maxX, limit);
  const halbFeld = deckel ? Math.min(maxX, base.bahnDeckel ?? Infinity) : maxX;
  if (eng) {
    minX = Math.max(minX, -halbFeld);
    maxX = Math.min(maxX, halbFeld);
  }
  return {
    ...base,
    bounds: { minX, maxX, minY: base.bounds.minY, maxY: base.bounds.maxY },
    _halbFeld: halbFeld,
    bahnX: base.bahnen.map((a) => a * halbFeld),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
    _sichtHalb: half,
    _pCfg: pCfg,
  };
}

/* ------------------------------------------------------ Zufall mit Saat */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
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

const FORMATE = [
  ['9:19.5', 9 / 19.5],
  ['9:16', 9 / 16],
  ['3:4', 3 / 4],
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
];

/* ================================================================ TEIL 1 */
if (TEIL === '1' || TEIL === 'alle') {
  const kopflos = groessteSpriteBreite(CONFIG.rock);
  const echt = await echteGroessteSpriteBreite(CONFIG.rock);
  console.log('TEIL 1 — Geometrie');
  console.log(`  groessteSpriteBreite kopflos : ${kopflos.toFixed(4)}`);
  console.log(`  aus den Bilddateien          : ${echt.max.toFixed(4)}  (${echt.wer})`);
  console.log('');
  console.log(
    '  Format    sichtHalb   limit(echt)  halbFeld(echt)   limit(kopflos)  halbFeld(kopflos)',
  );
  for (const [name, a] of FORMATE) {
    const echtW = spielfeld(a, 'braun', { spriteBreite: echt.max });
    const kopfW = spielfeld(a, 'braun', { spriteBreite: kopflos });
    console.log(
      `  ${name.padEnd(8)} ${echtW._sichtHalb.toFixed(3).padStart(8)} ` +
        `${echtW.bounds.maxX.toFixed(3).padStart(12)} ${echtW._halbFeld.toFixed(3).padStart(14)} ` +
        `${kopfW.bounds.maxX.toFixed(3).padStart(15)} ${kopfW._halbFeld.toFixed(3).padStart(17)}`,
    );
  }
  console.log('');
}

/* ================================================================ TEIL 2 */
/**
 * Ein Lauf. Zaehlt an den SPAWN-METHODEN mit (Pool-Falle vermeiden).
 */
function lauf({ seed, aspect, charId, sekunden, eng = false, deckel = true, spriteBreite }) {
  const echterZufall = Math.random;
  Math.random = rng(seed);
  try {
    const world = spielfeld(aspect, charId, { deckel, eng, spriteBreite });
    const pCfg = world._pCfg;
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const szene = { add() {} };
    const spawner = new Spawner(szene, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = true;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const bahnen = world.bahnX;
    const idxVon = (x) => {
      let b = 0;
      for (let i = 1; i < bahnen.length; i++) {
        if (Math.abs(bahnen[i] - x) < Math.abs(bahnen[b] - x)) b = i;
      }
      return b;
    };
    const zaehler = {
      stein: new Array(bahnen.length).fill(0),
      muenze: new Array(bahnen.length).fill(0),
      banane: new Array(bahnen.length).fill(0),
      powerup: new Array(bahnen.length).fill(0),
    };
    let steinNull = 0; // _freieStelle lieferte null
    let steinVersuch = 0;
    let nichtAufBahn = 0;

    // --- Spawn-Methoden mitschreiben ---
    const origFrei = spawner._freieStelle.bind(spawner);
    spawner._freieStelle = (type, hitRadius) => {
      steinVersuch++;
      const x = origFrei(type, hitRadius);
      if (x === null) steinNull++;
      else {
        if (!bahnen.some((b) => Math.abs(b - x) < 1e-9)) nichtAufBahn++;
        zaehler.stein[idxVon(x)]++;
      }
      return x;
    };
    const origCoin = spawner._spawnCoin.bind(spawner);
    spawner._spawnCoin = () => {
      const vorher = spawner.coins.active.length;
      origCoin();
      const c = spawner.coins.active[spawner.coins.active.length - 1];
      if (spawner.coins.active.length > vorher && c) zaehler.muenze[idxVon(c.x)]++;
    };
    const origBan = spawner._spawnBanana.bind(spawner);
    spawner._spawnBanana = (x, y) => {
      zaehler.banane[idxVon(x)]++;
      origBan(x, y);
    };
    if (spawner.powerups) {
      const origPow = spawner._spawnPowerup?.bind(spawner);
      if (origPow) {
        spawner._spawnPowerup = (...a) => {
          const vorher = spawner.powerups.active.length;
          const r = origPow(...a);
          const p = spawner.powerups.active[spawner.powerups.active.length - 1];
          if (spawner.powerups.active.length > vorher && p) zaehler.powerup[idxVon(p.x)]++;
          return r;
        };
      }
    }

    // --- Korridor beobachten ---
    let kFrames = 0;
    let kDraussen = 0;
    let kMaxAbstand = 0;

    // --- "Steher": Affe steht fest auf der Mittelbahn, wird er getroffen? ---
    const py = (pCfg.startPosition ?? CONFIG.player.startPosition)[1];
    const px = bahnen[Math.floor(bahnen.length / 2)];
    let treffer = 0;
    const getroffen = new Set();

    const frames = Math.round(sekunden / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      const scroll = difficulty.scrollSpeed;
      spawner.hazardLook = stufeBei(t).hazard;
      spawner.update(DT, false, scroll);

      const kx = spawner.korridor.bei(spawner.korridor.jetzt);
      kFrames++;
      if (Math.abs(kx) > world._halbFeld + 1e-6) {
        kDraussen++;
        kMaxAbstand = Math.max(kMaxAbstand, Math.abs(kx) - world._halbFeld);
      }

      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        const R = pCfg.hitRadius + r.hitRadius;
        if (Math.abs(r.x - px) < R && Math.abs(r.y - py) < R) {
          if (!getroffen.has(r)) {
            getroffen.add(r);
            treffer++;
          }
        } else if (getroffen.has(r) && Math.abs(r.y - py) > R + 1) {
          getroffen.delete(r);
        }
      }
    }
    return {
      zaehler,
      steinNull,
      steinVersuch,
      nichtAufBahn,
      kDraussenProzent: (100 * kDraussen) / kFrames,
      kMaxAbstand,
      treffer,
      trefferProMin: (treffer * 60) / sekunden,
      world,
    };
  } finally {
    Math.random = echterZufall;
  }
}

function verteilung(arr) {
  const s = arr.reduce((a, b) => a + b, 0);
  if (!s) return arr.map(() => '  –  ').join(' ');
  return arr.map((v) => ((100 * v) / s).toFixed(1).padStart(5)).join(' ');
}

if (TEIL === '2' || TEIL === 'alle') {
  const sekunden = Number(arg('sekunden', 300));
  const laeufe = Number(arg('laeufe', 6));
  console.log(`TEIL 2 — Bahnverteilung + Korridor  (${laeufe} Laeufe x ${sekunden}s, braun)`);
  console.log('  Format   Var    Korr.draussen  maxUeber   Steine L/M/R        Muenzen L/M/R       Steher Tr/min  freieStelle-null');
  for (const [name, a] of FORMATE) {
    for (const variante of ['heute', 'eng']) {
      const sum = {
        stein: [0, 0, 0],
        muenze: [0, 0, 0],
        kD: 0,
        kM: 0,
        tr: 0,
        null: 0,
        vers: 0,
      };
      for (let i = 0; i < laeufe; i++) {
        const r = lauf({
          seed: 1000 + i * 7,
          aspect: a,
          charId: 'braun',
          sekunden,
          eng: variante === 'eng',
        });
        for (let k = 0; k < 3; k++) {
          sum.stein[k] += r.zaehler.stein[k];
          sum.muenze[k] += r.zaehler.muenze[k];
        }
        sum.kD += r.kDraussenProzent;
        sum.kM = Math.max(sum.kM, r.kMaxAbstand);
        sum.tr += r.trefferProMin;
        sum.null += r.steinNull;
        sum.vers += r.steinVersuch;
      }
      console.log(
        `  ${name.padEnd(8)} ${variante.padEnd(6)} ` +
          `${(sum.kD / laeufe).toFixed(1).padStart(9)} % ${sum.kM.toFixed(2).padStart(9)}   ` +
          `${verteilung(sum.stein)}   ${verteilung(sum.muenze)}   ` +
          `${(sum.tr / laeufe).toFixed(2).padStart(8)}    ` +
          `${((100 * sum.null) / Math.max(1, sum.vers)).toFixed(1).padStart(5)} %`,
      );
    }
  }
  console.log('');
}

/* ================================================================ TEIL 3
 * PENDLER-EXPLOIT je AFFE. Der Bericht hat das nur fuer BRAUN geprueft.
 * Modell: SpritePlayer.update woertlich (Zielbahn + Traegheit + Deckel auf
 * moveSpeed). Der Bot kippt sein Ziel um, sobald er `umkehr` vor der Bahn
 * ist — er haelt sich damit im Zwischenraum.
 */
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

function pendelLauf({ seed, aspect, charId, sekunden, deckel = true, hz = 60 }) {
  const dt = 1 / hz;
  const echterZufall = Math.random;
  Math.random = rng(seed);
  try {
    const world = spielfeld(aspect, charId, { deckel });
    const char = CONFIG.characters.list[charId];
    const pCfg = world._pCfg;
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const py = pCfg.startPosition[1];
    const ignoreR = char.ignoreRockRadius ?? 0;
    const bahnA = world.bahnX[0];
    const bahnB = world.bahnX[1];
    const d = bahnB - bahnA;
    const Rgross =
      pCfg.hitRadius + Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
    // Ziel: genau in der Mitte zwischen den Bahnen bleiben.
    const umkehr = Math.min(Rgross + pCfg.moveSpeed * dt + 0.02, 0.5 * d);
    const verzug = char.wischVerzoegerung ?? 0;

    let x = bahnA + umkehr;
    let ziel = bahnB;
    let pending = null;
    let gewischt = false;
    const vorhalt = umkehr + pCfg.moveSpeed * verzug;

    const getroffen = new Set();
    let treffer = 0;
    let ersterTreffer = null;
    const frames = Math.round(sekunden / dt);
    for (let f = 0; f < frames; f++) {
      const t = f * dt;
      difficulty.update(dt);
      spawner.hazardLook = stufeBei(difficulty.elapsed).hazard;
      spawner.update(dt, false, difficulty.scrollSpeed);

      if (pending !== null && t >= pending.wann) { ziel = pending.ziel; pending = null; gewischt = false; }
      if (pending === null && !gewischt && Math.abs(ziel - x) <= vorhalt) {
        const neu = ziel === bahnA ? bahnB : bahnA;
        if (verzug > 0) { pending = { wann: t + verzug, ziel: neu }; gewischt = true; }
        else ziel = neu;
      }
      x = schrittMachen(x, ziel, pCfg, dt, world.bounds);

      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        if (r.radius <= ignoreR) continue;
        const R = pCfg.hitRadius + r.hitRadius;
        const dx = r.x - x;
        const dy = r.y - py;
        if (dx * dx + dy * dy < R * R) {
          if (!getroffen.has(r)) { getroffen.add(r); treffer++; if (ersterTreffer === null) ersterTreffer = t; }
        } else if (getroffen.has(r) && Math.abs(dy) > R + 1) getroffen.delete(r);
      }
    }
    return { treffer, proMinute: (treffer * 60) / sekunden, ersterTreffer, halbFeld: world._halbFeld,
             luecke: d - 2 * Rgross };
  } finally { Math.random = echterZufall; }
}

if (TEIL === '3') {
  const sekunden = Number(arg('sekunden', 600));
  const laeufe = Number(arg('laeufe', 4));
  const hz = Number(arg('hz', 60));
  console.log(`TEIL 3 — Pendler zwischen zwei Bahnen, je Affe (${laeufe} x ${sekunden}s, ${hz} Hz)`);
  console.log('  Affe    Format    halbFeld  sichere Luecke   Tr/min   1.Treffer  nie getroffen');
  for (const charId of ['braun', 'weiss', 'orange']) {
    for (const [name, a] of FORMATE) {
      let tr = 0, nie = 0, erst = 0, luecke = 0, hf = 0;
      for (let i = 0; i < laeufe; i++) {
        const r = pendelLauf({ seed: 500 + i * 13, aspect: a, charId, sekunden, hz });
        tr += r.proMinute;
        if (r.ersterTreffer === null) nie++; else erst += r.ersterTreffer;
        luecke = r.luecke; hf = r.halbFeld;
      }
      const getr = laeufe - nie;
      console.log(
        `  ${charId.padEnd(7)} ${name.padEnd(8)} ${hf.toFixed(3).padStart(8)} ` +
        `${luecke.toFixed(3).padStart(14)} ${(tr / laeufe).toFixed(2).padStart(8)} ` +
        `${(getr ? (erst / getr).toFixed(1) + ' s' : '   –').padStart(11)}  ${nie}/${laeufe}`,
      );
    }
  }
}
