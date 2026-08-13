/**
 * GEGENPROBE zum Befund "maxTrockenZeit 2.5 s wird nicht eingehalten".
 *
 * Misst dieselben Laeufe wie _bahnverteilung.mjs (gleiche Seeds), aber zerlegt
 * jede lange Duerre in ihre Ursachen:
 *   A) global: in dieser Zeit fiel auf KEINER Bahn ein Stein (Gold-Gebiet,
 *      Chili-Durchflug, Kampf -> nachschubAus/nurMuenzen, oder Abwurftakt)
 *   B) gesperrt: die Bahn war beim Abwurf nicht frei (Korridor/Nachbarabstand)
 *   C) echt uebergangen: die Bahn WAR frei, ueberfaellig (>grenze) und bekam
 *      trotzdem nichts, obwohl >1 Bahn frei war  <-- nur DAS waere ein Bruch
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
import { Rock } from '../src/entities/Rock.js';

const arg = (n, f) => {
  const i = process.argv.indexOf(`--${n}`);
  if (i < 0) return f;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
};
const SEKUNDEN = arg('sekunden', 1200);
const LAEUFE = arg('laeufe', 6);
const DT = 1 / 60;
const AFFE = 'braun';
const FORMATE = { quer: 16 / 9, hoch: 9 / 19.5 };
const GRENZE_ARG = arg('grenze', null);
if (GRENZE_ARG !== null) CONFIG.rock.korridor.maxTrockenZeit = Number(GRENZE_ARG);
const LEISE = process.argv.includes('--leise');

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
  const maxX = Math.min(base.bounds.maxX, limit);
  return {
    ...base,
    bounds: { minX: Math.max(base.bounds.minX, -limit), maxX, minY: base.bounds.minY, maxY: base.bounds.maxY },
    bahnX: base.bahnen.map((a) => a * maxX),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
  };
}

function stufeBei(s) {
  const st = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < st.length; i++) if (s >= st[i].afterSeconds) idx = i;
  const letzte = st[st.length - 1];
  if (s >= letzte.afterSeconds) {
    const extra = Math.floor((s - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (st.length - 1 + extra) % st.length;
  }
  return st[idx];
}

function lauf({ seed, aspect }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const charCfg = CONFIG.characters.list[AFFE];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const world = spielfeld(aspect, halbeAffenBreite(AFFE, pCfg), pCfg);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.setSpieler(pCfg);
    spawner.reset();
    const w = console.warn;
    console.warn = () => {};
    spawner.setzePowerupBilder(new Map());
    console.warn = w;

    const bahnen = world.bahnX;
    const n = bahnen.length;
    const idxVon = (x) => {
      let b = 0;
      for (let i = 1; i < n; i++) if (Math.abs(bahnen[i] - x) < Math.abs(bahnen[b] - x)) b = i;
      return b;
    };

    let jetzt = 0;
    const steine = []; // [zeit, bahn]
    const origRock = Rock.prototype.spawn;
    Rock.prototype.spawn = function (type, look, x, ...rest) {
      steine.push([jetzt, idxVon(x)]);
      return origRock.call(this, type, look, x, ...rest);
    };

    /* Pro Frame: war die Gefahr abgeschaltet? Und (bei Abwurf) welche Bahnen frei? */
    const gefahrAusZeit = []; // [start, ende] Abschnitte
    let ausSeit = null;

    const grenze = CONFIG.rock.korridor.maxTrockenZeit;
    let brancheGefeuert = 0;
    let waehlAufrufe = 0;
    let verstoesse = 0; // freie, ueberfaellige Bahn nicht genommen obwohl Wahl bestand
    const verstossBeispiele = [];

    // Zeitpunkte, an denen Bahn i frei war (fuer die Ursachenzerlegung)
    const freiEvents = []; // [zeit, freiMaske, gewaehlt]

    const origWaehlen = spawner._bahnWaehlen.bind(spawner);
    spawner._bahnWaehlen = (frei, alle) => {
      waehlAufrufe++;
      const vorher = spawner._bahnTrocken ? spawner._bahnTrocken.slice() : new Array(n).fill(0);
      const freiIdx = frei.map(idxVon);
      const x = origWaehlen(frei, alle);
      const gew = idxVon(x);
      let maske = 0;
      for (const i of freiIdx) maske |= 1 << i;
      freiEvents.push([jetzt, maske, gew]);

      if (grenze > 0 && frei.length > 1) {
        // trockenste ueberfaellige freie Bahn
        let best = -1;
        let bestT = grenze;
        for (const i of freiIdx) {
          if (vorher[i] > bestT) {
            bestT = vorher[i];
            best = i;
          }
        }
        if (best >= 0) {
          brancheGefeuert++;
          if (gew !== best) {
            verstoesse++;
            if (verstossBeispiele.length < 5) verstossBeispiele.push({ jetzt, best, gew, vorher: vorher.slice() });
          }
        }
      }
      return x;
    };

    let letztesGebiet = null;
    let gebietWechsel = 0;
    const pw = { gold: -1, chili: -1 };
    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      jetzt = difficulty.elapsed;
      const stufe = stufeBei(jetzt);
      spawner.hazardLook = stufe.hazard;
      if (stufe.name !== letztesGebiet) {
        if (letztesGebiet !== null) gebietWechsel++;
        letztesGebiet = stufe.name;
        const gebiet = gebietWechsel + 1;
        for (const [art, pcfg] of [['gold', CONFIG.goldbanane], ['chili', CONFIG.chili]]) {
          if (gebiet < pcfg.abGebiet) continue;
          if (pw[art] < 0) pw[art] = pcfg.abGebiet - 1;
          if (gebiet <= pw[art]) continue;
          const j = pcfg.jedesXteGebiet;
          pw[art] = gebiet + (j.min + Math.floor(Math.random() * (j.max - j.min + 1))) - 1;
          spawner.powerupWerfen(art);
          break;
        }
        spawner.neuesGebiet();
      }
      const aus = spawner.nachschubAus || spawner.nurMuenzen;
      if (aus && ausSeit === null) ausSeit = jetzt;
      if (!aus && ausSeit !== null) {
        gefahrAusZeit.push([ausSeit, jetzt]);
        ausSeit = null;
      }
      spawner.update(DT, false, difficulty.scrollSpeed);
    }
    if (ausSeit !== null) gefahrAusZeit.push([ausSeit, jetzt]);

    Rock.prototype.spawn = origRock;
    return { steine, gefahrAusZeit, n, brancheGefeuert, waehlAufrufe, verstoesse, verstossBeispiele, freiEvents, ende: jetzt };
  } finally {
    Math.random = echt;
  }
}

/** Laengste Duerre je Bahn + Zerlegung. */
function analyse(r) {
  const { steine, gefahrAusZeit, n, freiEvents, ende } = r;
  const letzte = new Array(n).fill(steine.length ? steine[0][0] : 0);
  const best = new Array(n).fill(0);
  const bestSpanne = new Array(n).fill(null);
  for (const [t, b] of steine) {
    const d = t - letzte[b];
    if (d > best[b]) {
      best[b] = d;
      bestSpanne[b] = [letzte[b], t];
    }
    letzte[b] = t;
  }
  for (let i = 0; i < n; i++) {
    const d = ende - letzte[i];
    if (d > best[i]) {
      best[i] = d;
      bestSpanne[i] = [letzte[i], ende];
    }
  }

  const zerlegung = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = bestSpanne[i] ?? [0, 0];
    // Anteil der Spanne, in dem die Gefahr global abgeschaltet war
    let ausDauer = 0;
    for (const [s, e] of gefahrAusZeit) ausDauer += Math.max(0, Math.min(e, b) - Math.max(s, a));
    // Steine auf ANDEREN Bahnen in dieser Spanne
    let andere = 0;
    for (const [t, bb] of steine) if (t > a && t < b && bb !== i) andere++;
    // Abwuerfe in der Spanne, bei denen Bahn i FREI war (also uebergangen)
    let freiVerpasst = 0;
    let freiUndWahl = 0;
    for (const [t, maske, gew] of freiEvents) {
      if (t <= a || t >= b) continue;
      if (maske & (1 << i)) {
        freiVerpasst++;
        // gab es eine Alternative? (mehr als eine freie Bahn)
        let cnt = 0;
        for (let k = 0; k < n; k++) if (maske & (1 << k)) cnt++;
        if (cnt > 1 && gew !== i) freiUndWahl++;
      }
    }
    zerlegung.push({ bahn: i, duerre: best[i], von: a, bis: b, ausDauer, andere, freiVerpasst, freiUndWahl });
  }
  /* GEOMETRISCHE DECKE: laengste Strecke, in der die Bahn bei KEINEM Abwurf
   * frei war. So lange KANN dort nichts liegen, ohne die Lueckengarantie zu
   * brechen — egal welche Wahlregel man einbaut. */
  const decke = new Array(n).fill(0);
  const zuletztFrei = new Array(n).fill(0);
  for (const [t, maske] of freiEvents) {
    for (let i = 0; i < n; i++) {
      if (maske & (1 << i)) {
        if (t - zuletztFrei[i] > decke[i]) decke[i] = t - zuletztFrei[i];
        zuletztFrei[i] = t;
      }
    }
  }
  for (let i = 0; i < n; i++) if (ende - zuletztFrei[i] > decke[i]) decke[i] = ende - zuletztFrei[i];
  zerlegung.decke = decke;
  return zerlegung;
}

await bildseitenLaden();

console.log(`\nGrenze maxTrockenZeit = ${CONFIG.rock.korridor.maxTrockenZeit} s`);
for (const [fname, aspect] of Object.entries(FORMATE)) {
  console.log(`\n######## FORMAT ${fname.toUpperCase()} ########`);
  let gesFeuer = 0;
  let gesAufrufe = 0;
  let gesVerstoss = 0;
  const beispiele = [];
  const maxJeBahn = [0, 0, 0];
  const maxDecke = [0, 0, 0];
  for (let i = 0; i < LAEUFE; i++) {
    const r = lauf({ seed: 4200 + i * 7919, aspect });
    gesFeuer += r.brancheGefeuert;
    gesAufrufe += r.waehlAufrufe;
    gesVerstoss += r.verstoesse;
    beispiele.push(...r.verstossBeispiele);
    const z = analyse(r);
    for (let k = 0; k < z.length; k++) if (z[k].duerre > maxJeBahn[k]) maxJeBahn[k] = z[k].duerre;
    for (let k = 0; k < z.decke.length; k++) if (z.decke[k] > maxDecke[k]) maxDecke[k] = z.decke[k];
    if (LEISE) continue;
    console.log(`\n Lauf ${i} (Seed ${4200 + i * 7919}) — laengste Steinduerre je Bahn:`);
    for (const e of z) {
      console.log(
        `   Bahn ${e.bahn}: ${e.duerre.toFixed(1)} s  [${e.von.toFixed(1)}–${e.bis.toFixed(1)}]  ` +
          `davon Gefahr-AUS ${e.ausDauer.toFixed(1)} s  |  Steine auf anderen Bahnen in der Zeit: ${e.andere}  ` +
          `|  Abwuerfe mit dieser Bahn FREI: ${e.freiVerpasst} (davon mit Alternative uebergangen: ${e.freiUndWahl})`,
      );
    }
  }
  console.log(
    `\n  MAX Steinduerre ueber alle Laeufe: ${maxJeBahn.map((v) => v.toFixed(1) + ' s').join('  ')}`,
  );
  console.log(
    `  GEOMETRISCHE DECKE (Bahn bei keinem Abwurf frei): ${maxDecke.map((v) => v.toFixed(1) + ' s').join('  ')}`,
  );
  console.log(
    `  Schranke: ${gesFeuer} von ${gesAufrufe} Bahnwahlen entschieden (${((gesFeuer / gesAufrufe) * 100).toFixed(1)} %)  ` +
      `— Verstoesse gegen die Regel "trockenste ueberfaellige freie Bahn gewinnt": ${gesVerstoss}`,
  );
  if (beispiele.length) console.log('  Beispiele:', JSON.stringify(beispiele.slice(0, 3)));
}
console.log('');
