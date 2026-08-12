/**
 * PC GEGEN HANDY — wie sicher ist "zwischen den Bahnen"?
 *
 * MESSSKRIPT, ändert nichts am Spiel. Aufruf:
 *     node scripts/_pcvshandy.mjs
 *     node scripts/_pcvshandy.mjs --minuten 5 --laeufe 12
 *
 * HINTERGRUND
 * Die Bahnen liegen bei `anteil * halbFeld` (Game._updateWorldBounds, Game.js
 * 2374/2375), und `halbFeld` kommt aus der Kamera, hängt also am
 * Seitenverhältnis. Der Affe bewegt sich dagegen mit einer FESTEN
 * Weltgeschwindigkeit (SpritePlayer.js:479, `maxSchritt = cfg.moveSpeed * dt`).
 * Auf einem breiten Bildschirm liegen die Bahnen also weiter auseinander,
 * während das Lauftempo gleich bleibt — der Bahnwechsel dauert länger.
 *
 * Da ALLE Objekte ausschliesslich auf Bahnen fallen (Spawner._freieStelle,
 * Spawner.js:641-649), ist die Frage: wie viel Zeit verbringt ein Spieler,
 * der dauernd zwischen zwei Bahnen hin- und herpendelt, ausserhalb jeder
 * Gefahrenzone — und wie oft wird er dabei überhaupt noch getroffen?
 *
 * Drei Teile:
 *   A  Geometrie je Format: Feldbreite, Bahnabstand, Wechselzeit, Trefferkreis
 *   B  Pendel-Simulation, rein geometrisch (Anteil der Zeit in Gefahr)
 *   C  Pendel-Simulation gegen den ECHTEN Spawner (Treffer je Minute,
 *      Überlebenszeit) — Spawner kopflos wie in scripts/fairness.mjs
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

/* ============================================================== Argumente */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}

const MINUTEN = arg('minuten', 5);
const LAEUFE = arg('laeufe', 8);
const DT = arg('dt', 1 / 60);
const SEKUNDEN = MINUTEN * 60;
/* Die ersten Sekunden zählen nicht: der Pendler startet an einer Bahn und
 * muss erst in seinen Takt kommen. Sonst misst die Spalte "1. Treffer" nur
 * die Startbedingung — derselbe Fehler, vor dem fairness.mjs warnt. */
const EINSCHWINGEN = arg('einschwingen', 6);

/* ------------------------------- Die beiden Lösungsvorschläge zum Nachmessen
 * --deckel N   Bahnabstand auf halbFeld <= N deckeln (Vorschlag a).
 *              N = 1.611 ist das schmale Handy (braun).
 * --skaliert   moveSpeed mit der Feldbreite skalieren, Referenz ist das
 *              schmale Handy (Vorschlag b). Die Wechselzeit wird dadurch in
 *              jedem Format gleich.
 * Beide wirken NUR in diesem Messskript, nichts am Spiel wird angefasst. */
const DECKEL = arg('deckel', null);
const SKALIERT = process.argv.includes('--skaliert');
const REFERENZ_ASPECT = 9 / 19.5;

/* Die Formate der Aufgabe. aspect = Breite / Höhe. */
const FORMATE = [
  { name: '9:19.5  schmales Handy', aspect: 9 / 19.5 },
  { name: '9:16    Handy', aspect: 9 / 16 },
  { name: '3:4     Tablet hoch', aspect: 3 / 4 },
  { name: '1:1     quadratisch', aspect: 1 },
  { name: '16:9    Laptop', aspect: 16 / 9 },
  { name: '21:9    breit', aspect: 21 / 9 },
];

/* ============================================================ Zufall (fest) */

/** mulberry32 — reproduzierbar, damit ein Befund nachstellbar bleibt. */
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

/** Bildseitenverhältnis der Kletterbilder je Affe (wie in fairness.mjs). */
const BILD_SEITE = new Map();

async function bildseitenLaden() {
  const wurzel = dirname(fileURLToPath(import.meta.url));
  for (const [id, char] of Object.entries(CONFIG.characters.list)) {
    const pfad = (char.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
    const datei = resolve(wurzel, '..', 'public', pfad.replace(/^\//, ''));
    try {
      const m = await sharp(datei).metadata();
      BILD_SEITE.set(id, m.width / m.height);
    } catch (fehler) {
      console.warn(`[pcvshandy] ${datei} nicht lesbar (${fehler.message}) — nehme 0.56.`);
      BILD_SEITE.set(id, 0.56);
    }
  }
}

function halbeAffenBreite(charId, pCfg) {
  const seite = BILD_SEITE.get(charId) ?? 0.56;
  return (pCfg.spriteHeight * seite) / 2;
}

/**
 * Vorschlag (b): moveSpeed mit der Feldbreite skalieren.
 *
 * Referenz ist das schmale Handy — dort bleibt alles wie heute, breitere
 * Formate bekommen genau so viel mehr Tempo, dass die Wechselzeit gleich
 * bleibt. Gibt eine KOPIE zurück; CONFIG bleibt unangetastet.
 */
function tempoSkalieren(pCfg, charId, aspect) {
  if (!SKALIERT) return pCfg;
  const hb = halbeAffenBreite(charId, pCfg);
  const jetzt = spielfeld(aspect, hb, pCfg).bounds.maxX;
  const ref = spielfeld(REFERENZ_ASPECT, hb, pCfg).bounds.maxX;
  return { ...pCfg, moveSpeed: pCfg.moveSpeed * (jetzt / ref) };
}

/**
 * Exakt Game._updateWorldBounds (Game.js:2295-2375), kopflos.
 * Gleiche Rechnung wie fairness.mjs `spielfeld()`.
 */
function spielfeld(aspect, halbeBreiteAffe, pCfg) {
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
  const rand = Math.max(halbeBreiteAffe, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - rand);
  let maxX = Math.min(base.bounds.maxX, limit);
  // Vorschlag (a): Bahnabstand deckeln. Das Feld bleibt breit, nur die Bahnen
  // rücken zusammen — deshalb wirkt der Deckel hier auf `maxX`, aus dem
  // Game.js:2374/2375 die Bahnen bildet.
  if (DECKEL !== null) maxX = Math.min(maxX, DECKEL);

  return {
    ...base,
    bounds: {
      minX: Math.max(base.bounds.minX, -limit),
      maxX,
      minY: base.bounds.minY,
      maxY: base.bounds.maxY,
    },
    bahnX: base.bahnen.map((anteil) => anteil * maxX),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
    _sichtHalb: half,
  };
}

/* ==================================================== Bewegung des Affen */

/**
 * Ein Frame Seitwärtsbewegung — WÖRTLICH wie SpritePlayer.update
 * (SpritePlayer.js:458-493).
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

/** Reine Wechselzeit von Bahn a nach Bahn b (bis `angekommen`). */
function wechselZeit(von, nach, pCfg, bounds) {
  let x = von;
  let t = 0;
  const grenze = 60; // Sicherung gegen Endlosschleifen
  while (Math.abs(x - nach) > 0.002 && t < grenze) {
    x = schrittMachen(x, nach, pCfg, DT, bounds);
    t += DT;
  }
  return t;
}

/* ================================================== A) Geometrie je Format */

function tabelleGeometrie() {
  const objR = CONFIG.rock.types.map((t) => ({
    id: t.id,
    r: t.radius * CONFIG.rock.hitRadiusFactor,
  }));

  console.log('\n' + '='.repeat(112));
  console.log('A)  BAHNGEOMETRIE JE FORMAT   (bahnen = [-1, 0, 1], config.js:107)');
  console.log('='.repeat(112));

  for (const [affe, char] of Object.entries(CONFIG.characters.list)) {
    const pCfg = { ...CONFIG.player, ...char.player };
    const hb = halbeAffenBreite(affe, pCfg);
    console.log(
      `\n${char.label}  (moveSpeed ${pCfg.moveSpeed}, hitRadius ${pCfg.hitRadius}, ` +
        `bahnWechselZeit ${pCfg.bahnWechselZeit}, halbe Bildbreite ${hb.toFixed(3)})`,
    );
    console.log(
      '  Format                sichtbar±   halbFeld   Bahnen               Abstand   Wechselzeit  eff.Tempo',
    );
    for (const f of FORMATE) {
      const w = spielfeld(f.aspect, hb, pCfg);
      const pF = tempoSkalieren(pCfg, affe, f.aspect);
      const d = w.bahnX[1] - w.bahnX[0]; // = halbFeld
      const tW = wechselZeit(w.bahnX[0], w.bahnX[1], pF, w.bounds);
      console.log(
        `  ${f.name.padEnd(20)} ${w._sichtHalb.toFixed(3).padStart(8)}` +
          `${w.bounds.maxX.toFixed(3).padStart(11)}` +
          `   [${w.bahnX.map((x) => x.toFixed(2).padStart(5)).join(',')}]` +
          `${d.toFixed(3).padStart(10)}` +
          `${(tW * 1000).toFixed(0).padStart(11)} ms` +
          `${(d / tW).toFixed(2).padStart(9)} u/s`,
      );
    }

    console.log('\n  Trefferkreis + Objektradius (= Halbbreite der Gefahrenzone um eine Bahn):');
    for (const o of objR) {
      const R = pCfg.hitRadius + o.r;
      console.log(
        `    Stein "${o.id}"  r=${o.r.toFixed(3)}  ->  R = ${R.toFixed(3)}` +
          `   sichere Lücke ab Bahnabstand > ${(2 * R).toFixed(3)}`,
      );
    }
    // Wo liegt die Schwelle je Format?
    const Rmax = pCfg.hitRadius + Math.max(...objR.map((o) => o.r));
    const Rmin = pCfg.hitRadius + Math.min(...objR.map((o) => o.r));
    console.log(
      '\n  Format                Abstand   Abstand/2Rmax  freie Strecke (gross)  freie Strecke (klein)',
    );
    for (const f of FORMATE) {
      const w = spielfeld(f.aspect, hb, pCfg);
      const d = w.bahnX[1] - w.bahnX[0];
      const freiGross = d - 2 * Rmax;
      const freiKlein = d - 2 * Rmin;
      console.log(
        `  ${f.name.padEnd(20)}${d.toFixed(3).padStart(9)}` +
          `${(d / (2 * Rmax)).toFixed(2).padStart(15)}` +
          `${(freiGross > 0 ? '+' + freiGross.toFixed(3) : freiGross.toFixed(3)).padStart(23)}` +
          `${(freiKlein > 0 ? '+' + freiKlein.toFixed(3) : freiKlein.toFixed(3)).padStart(23)}`,
      );
    }
  }
}

/* ================================== B) Pendel-Simulation, rein geometrisch */

/**
 * Der Pendler: ein Spieler, der DAUERND zwischen zwei Bahnen wechselt und nie
 * ankommt.
 *
 * WIE ER GEFAHREN WIRD
 * Er wischt zurück, sobald er der Zielbahn näher als `umkehr` kommt. Mit
 * `umkehr = R` (Trefferkreis + Objektradius) dreht er genau an der Kante der
 * Gefahrenzone — das ist der bestmögliche Ausnutzer. Mit `umkehr = 0.002`
 * kommt er wirklich an; das ist der ehrliche Dauerwechsler.
 *
 * DER ORANGE AFFE BRAUCHT VORHALT. `wischVerzoegerung` = 0.5 s (config.js:467):
 * sein Wisch wirkt erst später, und ein zweiter Wisch in der Wartezeit
 * ÜBERSCHREIBT den ersten (Game.js:931-940). Er wischt deshalb schon, wenn er
 * noch `umkehr + moveSpeed * verzug` entfernt ist — genau die Strecke, die er
 * während der Wartezeit noch zurücklegt —, und danach erst wieder, wenn der
 * Wisch gewirkt hat. Damit ist die Regel des Spiels eingehalten, ohne dass er
 * sich selbst festnagelt.
 *
 * Bei engen Bahnen wird `umkehr` auf 0.45 * Bahnabstand gedeckelt, sonst würde
 * der Ausnutzer gar nicht erst losgehen.
 */
function pendlerZustand({ bahnA, bahnB, umkehr, pCfg, char }) {
  const verzug = char.wischVerzoegerung ?? 0;
  return {
    bahnA,
    bahnB,
    umkehr,
    verzug,
    vorhalt: umkehr + pCfg.moveSpeed * verzug,
    ziel: bahnB,
    pending: null,
    gewischt: false,
    start: bahnA + Math.sign(bahnB - bahnA) * umkehr,
  };
}

/** Einen Frame Steuerung. Gibt das aktuelle Ziel zurück. */
function pendlerSchritt(z, x, t) {
  if (z.pending !== null && t >= z.pending.wann) {
    z.ziel = z.pending.ziel;
    z.pending = null;
    z.gewischt = false;
  }
  if (z.pending === null && !z.gewischt && Math.abs(z.ziel - x) <= z.vorhalt) {
    const neu = z.ziel === z.bahnA ? z.bahnB : z.bahnA;
    z.pending = { wann: t + z.verzug, ziel: neu };
    z.gewischt = true;
    // Ohne Verzögerung wirkt der Wisch sofort im selben Frame.
    if (z.verzug <= 0) {
      z.ziel = neu;
      z.pending = null;
      z.gewischt = false;
    }
  }
  return z.ziel;
}

function pendeln({ world, pCfg, char, umkehr, sekunden }) {
  const z = pendlerZustand({
    bahnA: world.bahnX[0],
    bahnB: world.bahnX[1],
    umkehr,
    pCfg,
    char,
  });
  let x = z.start;

  const frames = Math.round(sekunden / DT);
  const zaehler = { klein: 0, mittel: 0, gross: 0 };
  const Rjeart = {};
  for (const t of CONFIG.rock.types) {
    Rjeart[t.id] = pCfg.hitRadius + t.radius * CONFIG.rock.hitRadiusFactor;
  }
  let summeAbstand = 0;
  let minAbstand = Infinity;
  let wechsel = 0;
  let letztesZiel = z.ziel;

  for (let f = 0; f < frames; f++) {
    const t = f * DT;
    const ziel = pendlerSchritt(z, x, t);
    if (ziel !== letztesZiel) {
      wechsel++;
      letztesZiel = ziel;
    }
    x = schrittMachen(x, ziel, pCfg, DT, world.bounds);

    let dMin = Infinity;
    for (const bx of world.bahnX) dMin = Math.min(dMin, Math.abs(x - bx));
    summeAbstand += dMin;
    if (dMin < minAbstand) minAbstand = dMin;
    for (const art of CONFIG.rock.types) if (dMin < Rjeart[art.id]) zaehler[art.id]++;
  }

  return {
    takt: wechsel > 0 ? sekunden / wechsel : Infinity,
    anteil: {
      klein: zaehler.klein / frames,
      mittel: zaehler.mittel / frames,
      gross: zaehler.gross / frames,
    },
    mittlererAbstand: summeAbstand / frames,
    minAbstand,
  };
}

function tabellePendel() {
  console.log('\n' + '='.repeat(112));
  console.log(
    `B)  DAUERWECHSLER, REIN GEOMETRISCH  (${MINUTEN} min Spielzeit je Zelle, dt = ${DT.toFixed(4)} s)`,
  );
  console.log('    Anteil der Zeit NÄHER als (Trefferkreis + Objektradius) an einer Bahn.');
  console.log('    100 % = immer angreifbar,  0 % = nie angreifbar.');
  console.log('='.repeat(112));

  for (const [affe, char] of Object.entries(CONFIG.characters.list)) {
    const pCfg = { ...CONFIG.player, ...char.player };
    const hb = halbeAffenBreite(affe, pCfg);
    console.log(`\n${char.label}`);
    console.log(
      '  Strategie          Format                Halbtakt     klein     mittel     gross   mittl.Abstand',
    );
    for (const modus of ['kante', 'ankommen']) {
      for (const f of FORMATE) {
        const world = spielfeld(f.aspect, hb, pCfg);
        const d = world.bahnX[1] - world.bahnX[0];
        const Rmittel =
          pCfg.hitRadius + CONFIG.rock.types[1].radius * CONFIG.rock.hitRadiusFactor;
        const umkehr = modus === 'kante' ? Math.min(Rmittel, 0.45 * d) : 0.002;
        const r = pendeln({
          world,
          pCfg: tempoSkalieren(pCfg, affe, f.aspect),
          char,
          umkehr,
          sekunden: SEKUNDEN,
        });
        console.log(
          `  ${(modus === 'kante' ? 'Kante (Ausnutzer)' : 'bis Ankunft').padEnd(18)}` +
            `${f.name.padEnd(20)}` +
            `${(r.takt * 1000).toFixed(0).padStart(7)} ms` +
            `${(r.anteil.klein * 100).toFixed(1).padStart(9)} %` +
            `${(r.anteil.mittel * 100).toFixed(1).padStart(9)} %` +
            `${(r.anteil.gross * 100).toFixed(1).padStart(9)} %` +
            `${r.mittlererAbstand.toFixed(3).padStart(14)}`,
        );
      }
      console.log('');
    }
  }
}

/* ============================ C) Gegen den ECHTEN Spawner (Treffer/Minute) */

/** Wand-Stufe zur Spielzeit (Spiegel von PlantWall.stageIndexAt) — wie fairness.mjs. */
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

/**
 * Ein echter Lauf: Spawner kopflos (wie fairness.mjs:335-410), Spieler mit
 * einer Strategie, Kollision als Kreis/Kreis (CollisionSystem.circleOverlap).
 *
 * Treffer beenden den Lauf NICHT — sonst misst man nur die erste Sekunde.
 * Jeder Stein zählt höchstens einmal.
 */
function lauf({ seed, affe, aspect, strategie, sekunden }) {
  const echterZufall = Math.random;
  Math.random = rng(seed);
  try {
    const char = CONFIG.characters.list[affe];
    const roh = { ...CONFIG.player, ...char.player };
    const world = spielfeld(aspect, halbeAffenBreite(affe, roh), roh);
    // Vorschlag (b) wirkt hier: auf den Affen UND auf den Spawner, der
    // moveSpeed für das Korridortempo liest (Spawner.js:198).
    const pCfg = tempoSkalieren(roh, affe, aspect);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);

    const szene = { add() {} };
    const spawner = new Spawner(szene, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false; // Bananen helfen nur
    spawner.setSpieler(pCfg);
    spawner.reset();

    const py = pCfg.startPosition[1];
    const ignoreR = char.ignoreRockRadius ?? 0;
    const bahnA = world.bahnX[0];
    const bahnB = world.bahnX[1];
    const bahnM = world.bahnX[1];
    const verzug = char.wischVerzoegerung ?? 0;
    const d = bahnB - bahnA;
    const Rmittel = pCfg.hitRadius + CONFIG.rock.types[1].radius * CONFIG.rock.hitRadiusFactor;
    /* "optimal" dreht schon am Radius des GRÖSSTEN Steins um — dann berührt
     * sein Trefferkreis auch den dicksten Brocken auf der Bahn nicht mehr. */
    const Rgross =
      pCfg.hitRadius +
      Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
    /* Ein Frame Schrittweite Zuschlag: die Umkehr wird auf Frames gerastert,
     * der Affe schiesst um bis zu `moveSpeed * dt` über den Wendepunkt hinaus.
     * Ohne diesen Zuschlag stünde "optimal" genau AUF der Kante und würde
     * durch die Rasterung doch wieder hineinlaufen. */
    const slop = pCfg.moveSpeed * DT + 0.02;
    const umkehr = Math.min(
      strategie === 'optimal' ? Rgross + slop : Rmittel,
      0.45 * d,
    );
    const z = pendlerZustand({ bahnA, bahnB, umkehr, pCfg, char });

    let x = strategie === 'steher' ? bahnM : z.start;
    let ziel = strategie === 'steher' ? bahnM : z.ziel;

    const getroffen = new Set();
    let treffer = 0;
    let ersterTreffer = null;
    let zeitFrei = 0;
    let minAbstand = Infinity;

    const frames = Math.round(sekunden / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      const scroll = difficulty.scrollSpeed;
      spawner.hazardLook = stufeBei(t).hazard;

      if (strategie !== 'steher') ziel = pendlerSchritt(z, x, t);
      x = schrittMachen(x, ziel, pCfg, DT, world.bounds);
      if (t > EINSCHWINGEN) {
        for (const bx of world.bahnX) minAbstand = Math.min(minAbstand, Math.abs(x - bx));
      }

      spawner.update(DT, false, scroll);

      let frei = true;
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        if (r.radius <= ignoreR) continue;
        const dx = x - r.x;
        const dy = py - r.y;
        const R = pCfg.hitRadius + r.hitRadius;
        if (dx * dx + dy * dy <= R * R) {
          frei = false;
          if (!getroffen.has(r) && t > EINSCHWINGEN) {
            getroffen.add(r);
            treffer++;
            if (ersterTreffer === null) ersterTreffer = t - EINSCHWINGEN;
          }
        }
      }
      if (frei && t > EINSCHWINGEN) zeitFrei += DT;
      // Steine, die das Bild verlassen haben, dürfen wieder zählen
      for (const r of spawner.rocks.all) if (!r.active) getroffen.delete(r);
    }

    const gemessen = sekunden - EINSCHWINGEN;
    return {
      treffer,
      proMinute: treffer / (gemessen / 60),
      ersterTreffer,
      anteilFrei: zeitFrei / gemessen,
      minAbstand,
      umkehr,
    };
  } finally {
    Math.random = echterZufall;
  }
}

function tabelleEcht() {
  console.log('\n' + '='.repeat(112));
  console.log(
    `C)  GEGEN DEN ECHTEN SPAWNER  (${LAEUFE} Läufe x ${MINUTEN} min je Zelle)`,
  );
  console.log('    "Pendler"  wechselt dauernd zwischen den beiden linken Bahnen, dreht am Rand');
  console.log('               der Gefahrenzone des MITTLEREN Steins (R = hit + 0.413).');
  console.log('    "optimal"  dreht am Rand der Zone des GRÖSSTEN Steins (R = hit + 0.636).');
  console.log('    "Steher"   bleibt auf der Mittelbahn stehen — die Vergleichsgrösse.');
  console.log(`    Erste ${EINSCHWINGEN} s zählen nicht. Treffer beenden den Lauf nicht; jeder Stein zählt einmal.`);
  console.log('='.repeat(112));

  const median = (a) => {
    const s = [...a].sort((p, q) => p - q);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  for (const affe of Object.keys(CONFIG.characters.list)) {
    const char = CONFIG.characters.list[affe];
    console.log(`\n${char.label}`);
    const Rg =
      ({ ...CONFIG.player, ...char.player }).hitRadius +
      Math.max(...CONFIG.rock.types.map((t) => t.radius)) * CONFIG.rock.hitRadiusFactor;
    console.log(
      `  (unantastbar wäre: kleinster Bahnabstand > R_gross = ${Rg.toFixed(3)})`,
    );
    console.log(
      '  Format               |  STEHER |          PENDLER          |          OPTIMAL          | opt. minAbst.',
    );
    console.log(
      '                       |  Tr/min |  Tr/min   1.Tr.  unversehrt |  Tr/min   1.Tr.  unversehrt |',
    );
    for (const f of FORMATE) {
      const roh = {};
      for (const strategie of ['steher', 'pendler', 'optimal']) {
        roh[strategie] = [];
        for (let i = 0; i < LAEUFE; i++) {
          roh[strategie].push(
            lauf({ seed: 1000 + i, affe, aspect: f.aspect, strategie, sekunden: SEKUNDEN }),
          );
        }
      }
      const mit = (a, k) => a.reduce((m, r) => m + r[k], 0) / a.length;
      const gemessen = SEKUNDEN - EINSCHWINGEN;
      const erst = (a) => median(a.map((r) => (r.ersterTreffer === null ? gemessen : r.ersterTreffer)));
      const nie = (a) => a.filter((r) => r.ersterTreffer === null).length;
      const spalte = (a) =>
        `${mit(a, 'proMinute').toFixed(2).padStart(9)}` +
        `${(erst(a).toFixed(0) + (nie(a) ? '+' : '') + 's').padStart(8)}` +
        `${(nie(a) + '/' + LAEUFE).padStart(12)}`;
      console.log(
        `  ${f.name.padEnd(20)} ${mit(roh.steher, 'proMinute').toFixed(2).padStart(8)} |` +
          `${spalte(roh.pendler)} |${spalte(roh.optimal)} |` +
          `${Math.min(...roh.optimal.map((r) => r.minAbstand)).toFixed(3).padStart(9)}`,
      );
    }
  }
}

/* ===================================================================== Los */

await bildseitenLaden();
tabelleGeometrie();
tabellePendel();
tabelleEcht();
console.log('');
