/**
 * PRUEFSKRIPT (Audit, nicht Teil des Spiels).
 *
 * Frage: Liegen jemals zwei Objekte "auf einem Haufen"?
 *
 * Gemessen wird ueber den GANZEN sichtbaren Flug, nicht nur beim Abwurf:
 *   - wie viele Objekte gleichzeitig im Bild sind
 *   - ob sich zwei Bild-Rechtecke (aus mesh.scale) ueberlappen
 *   - kleinster senkrechter Abstand zweier Objekte
 *
 * WICHTIG: die echten Bildgroessen werden eingespeist. Ohne sie faellt Rock.js
 * auf prozedurale Koerper zurueck und mesh.scale.y stimmt nicht mit dem Spiel
 * ueberein (Eiszapfen 2.45 vs. 2.59, Feuer 1.55 vs. 0.60 ...).
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { PerspectiveCamera } from 'three';

import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt, visibleRectAt } from '../src/core/viewport.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HAZARD_DIR = path.join(HIER, '..', 'public', 'hazards');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}

const LAEUFE = arg('laeufe', 6);
const SEKUNDEN = arg('sekunden', 600);
const DT = 1 / 60;
const AFFE = String(arg('affe', 'braun'));
const MIT_BANANEN = !process.argv.includes('--ohne-bananen');

/* --------------------------------------------- echte Bildgroessen einlesen */

async function echteTexturen() {
  const map = new Map();
  for (const datei of readdirSync(HAZARD_DIR)) {
    if (!datei.endsWith('.webp')) continue;
    const m = await sharp(path.join(HAZARD_DIR, datei)).metadata();
    const name = datei.replace(/\.webp$/, '');
    map.set(CONFIG.rock.spritePath.replace('{n}', name), {
      isTexture: true,
      image: { width: m.width, height: m.height },
    });
  }
  return map;
}

/* ------------------------------------------------------------- Hilfsmittel */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

function kamera(aspect) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  return camera;
}

function spielfeld(camera, hitRadius) {
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

/* ------------------------------------------------------------------ Lauf */

function lauf({ seed, affe, aspect, steigt, texturen, sicht, world, stat }) {
  const echt = Math.random;
  Math.random = rng(seed);
  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };

    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);

    const szene = { add() {} };
    const spawner = new Spawner(szene, CONFIG, difficulty, world, texturen);
    spawner.bananasEnabled = MIT_BANANEN && charCfg.bananas;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const frames = Math.round(SEKUNDEN / DT);
    const objekte = []; // wiederverwendet

    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      const base = difficulty.scrollSpeed;
      const assisted = base + (steigt ? pCfg.climbAssist : 0);
      const scroll = Math.max(assisted, base * pCfg.minScrollFactor);

      spawner.hazardLook = stufeBei(t).hazard;
      spawner.update(DT, false, scroll);

      // --- sichtbare Objekte einsammeln --------------------------------
      objekte.length = 0;
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        objekte.push({
          x: r.x,
          y: r.y,
          w: Math.abs(r.mesh.scale.x),
          h: Math.abs(r.mesh.scale.y),
          art: r.type.id,
          look: r.lookId,
          stein: true,
        });
      }
      for (const b of spawner.bananas.active) {
        if (!b.active) continue;
        // Torus 0.62 + Rohr 0.2 -> Aussenmass 1.64, mal mesh.scale.
        const d = 1.64 * Math.abs(b.mesh.scale.x);
        objekte.push({
          x: b.x,
          y: b.y,
          w: d,
          h: d,
          art: 'banane',
          look: 'banane',
          stein: false,
        });
      }

      const sichtbar = objekte.filter(
        (o) =>
          o.y + o.h / 2 > sicht.minY &&
          o.y - o.h / 2 < sicht.maxY &&
          o.x + o.w / 2 > sicht.minX &&
          o.x - o.w / 2 < sicht.maxX,
      );
      const nurSteine = sichtbar.filter((o) => o.stein);

      // Zeitscheiben: die Dichte ist erst ab ~858s am Anschlag. Ein Mittelwert
      // ueber den ganzen Lauf verwaesserte genau die harte Phase.
      const eimer = Math.min(stat.eimer.length - 1, Math.floor(t / 100));
      stat.eimer[eimer].frames++;
      stat.eimer[eimer].summe += nurSteine.length;
      stat.eimer[eimer].summeAlle += sichtbar.length;
      if (nurSteine.length > stat.eimer[eimer].max) stat.eimer[eimer].max = nurSteine.length;

      stat.frames++;
      stat.summe += nurSteine.length;
      stat.hist[Math.min(nurSteine.length, 12)]++;
      if (nurSteine.length > stat.max) {
        stat.max = nurSteine.length;
        stat.maxZeit = t;
      }
      stat.summeAlle += sichtbar.length;
      stat.histAlle[Math.min(sichtbar.length, 12)]++;

      // Strengere Zaehlung: nur Objekte, deren MITTE im Bild liegt (also
      // wirklich ganz zu sehen, nicht bloss mit der Spitze am Rand).
      const mitte = nurSteine.filter((o) => o.y > sicht.minY && o.y < sicht.maxY).length;
      stat.summeMitte += mitte;
      stat.histMitte[Math.min(mitte, 12)]++;

      // --- Paarweise pruefen -------------------------------------------
      let frameUeberlappt = false;
      let frameUeberlapptMitBanane = false;
      for (let i = 0; i < sichtbar.length; i++) {
        for (let j = i + 1; j < sichtbar.length; j++) {
          const a = sichtbar[i];
          const b = sichtbar[j];
          const dy = Math.abs(a.y - b.y);
          const dx = Math.abs(a.x - b.x);
          const luftY = dy - (a.h + b.h) / 2; // >0 = kein senkrechter Kontakt
          const luftX = dx - (a.w + b.w) / 2;

          if (a.stein && b.stein) {
            if (dy < stat.minDy) {
              stat.minDy = dy;
              stat.minDyInfo = { t, a, b };
            }
            if (luftY < stat.minLuftY) {
              stat.minLuftY = luftY;
              stat.minLuftYInfo = { t, a, b, dx, dy };
            }
            // "Aufeinander" heisst: senkrecht dicht UND waagerecht deckungs-
            // gleich. Nur dann sieht es nach Haufen aus.
            if (luftX < 0) {
              if (dy < stat.minDyGleicheSpur) {
                stat.minDyGleicheSpur = dy;
                stat.minDyGleicheSpurInfo = { t, a, b, dx };
              }
            }
            if (luftY < 0 && luftX < 0) {
              frameUeberlappt = true;
              stat.paare++;
              const oben = Math.max(a.y, b.y);
              stat.ueberlappungY.push(oben);
              // Oberkante des unteren Objekts: wo im Bild sieht man es?
              if (Math.min(a.y, b.y) > -3.0) stat.ueberlappungImSpielfeld++;
              if (Math.min(a.y, b.y) > world.bounds.minY - 1.6) stat.ueberlappungImSchutz++;
              const flaeche =
                Math.min(-luftY, Math.min(a.h, b.h)) * Math.min(-luftX, Math.min(a.w, b.w));
              if (flaeche > stat.groessteUeberlappung) {
                stat.groessteUeberlappung = flaeche;
                stat.groessteInfo = { t, a, b, luftX, luftY };
              }
            }
          } else if (luftY < 0 && luftX < 0) {
            frameUeberlapptMitBanane = true;
            const unten = Math.min(a.y, b.y);
            if (unten < stat.bananeMinY) stat.bananeMinY = unten;
            if (unten > stat.bananeMaxY) stat.bananeMaxY = unten;
            if (unten > -3.0) stat.bananeImSpielfeld++;
          }
        }
      }
      if (frameUeberlappt) stat.frameMitUeberlappung++;
      if (frameUeberlappt || frameUeberlapptMitBanane) stat.frameMitUeberlappungAlle++;
    }
  } finally {
    Math.random = echt;
  }
}

/* -------------------------------------------------------------- Ausgabe */

const texturen = await echteTexturen();

const FORMATE = { quer: 16 / 9, hoch: 9 / 19.5 };
const AFFEN = AFFE === 'alle' ? Object.keys(CONFIG.characters.list) : [AFFE];

console.log(
  `Haufen-Audit — ${LAEUFE} Laeufe a ${SEKUNDEN}s je Kombination ` +
    `(= ${((LAEUFE * SEKUNDEN) / 60).toFixed(0)} min Spielzeit), ` +
    `${texturen.size} echte Bilder eingespeist, Bananen ${MIT_BANANEN ? 'an' : 'aus'}\n`,
);

for (const affe of AFFEN) {
  const charCfg = CONFIG.characters.list[affe];
  const pCfg = { ...CONFIG.player, ...charCfg.player };
  for (const [fname, aspect] of Object.entries(FORMATE)) {
    const camera = kamera(aspect);
    const rect = visibleRectAt(camera, 0, {});
    const sicht = {
      minX: rect.centerX - rect.width / 2,
      maxX: rect.centerX + rect.width / 2,
      minY: rect.centerY - rect.height / 2,
      maxY: rect.centerY + rect.height / 2,
    };
    const world = spielfeld(camera, pCfg.hitRadius);

    for (const steigt of [false, true]) {
      const stat = {
        frames: 0,
        summe: 0,
        summeAlle: 0,
        hist: new Array(13).fill(0),
        histAlle: new Array(13).fill(0),
        max: 0,
        maxZeit: 0,
        frameMitUeberlappung: 0,
        frameMitUeberlappungAlle: 0,
        paare: 0,
        minDy: Infinity,
        minDyInfo: null,
        minLuftY: Infinity,
        minLuftYInfo: null,
        minDyGleicheSpur: Infinity,
        minDyGleicheSpurInfo: null,
        ueberlappungY: [],
        ueberlappungImSpielfeld: 0,
        ueberlappungImSchutz: 0,
        bananeMinY: Infinity,
        bananeMaxY: -Infinity,
        bananeImSpielfeld: 0,
        summeMitte: 0,
        histMitte: new Array(13).fill(0),
        eimer: Array.from({ length: Math.ceil(SEKUNDEN / 100) }, () => ({
          frames: 0,
          summe: 0,
          summeAlle: 0,
          max: 0,
        })),
        groessteUeberlappung: 0,
        groessteInfo: null,
      };

      for (let i = 0; i < LAEUFE; i++) {
        lauf({
          seed: 2000 + i * 7919,
          affe,
          aspect,
          steigt,
          texturen,
          sicht,
          world,
          stat,
        });
      }

      const p = (n) => ((100 * n) / stat.frames).toFixed(3);
      const hist = stat.hist
        .map((n, i) => (n > 0 ? `${i}:${p(n)}%` : null))
        .filter(Boolean)
        .join('  ');

      console.log(
        `${affe} / ${fname} / ${steigt ? 'W gedrueckt' : 'ohne W'}   ` +
          `Sichtfenster y ${sicht.minY.toFixed(2)}..${sicht.maxY.toFixed(2)}, ` +
          `x +-${sicht.maxX.toFixed(2)}`,
      );
      console.log(
        `   Steine gleichzeitig im Bild: Mittel ${(stat.summe / stat.frames).toFixed(2)}, ` +
          `Max ${stat.max} (bei ${stat.maxZeit.toFixed(0)}s)`,
      );
      console.log(`   Verteilung: ${hist}`);
      console.log(
        `   nur Objekte mit MITTE im Bild: Mittel ${(stat.summeMitte / stat.frames).toFixed(2)}, ` +
          `Verteilung ${stat.histMitte
            .map((n, i) => (n > 0 ? `${i}:${p(n)}%` : null))
            .filter(Boolean)
            .join('  ')}`,
      );
      console.log(
        `   mit Bananen: Mittel ${(stat.summeAlle / stat.frames).toFixed(2)}, ` +
          `Verteilung ${stat.histAlle
            .map((n, i) => (n > 0 ? `${i}:${p(n)}%` : null))
            .filter(Boolean)
            .join('  ')}`,
      );
      console.log(
        `   Frames mit Rechteck-Ueberlappung (Stein/Stein): ${p(stat.frameMitUeberlappung)} %` +
          `   inkl. Bananen: ${p(stat.frameMitUeberlappungAlle)} %`,
      );
      if (stat.groessteInfo) {
        const g = stat.groessteInfo;
        console.log(
          `   groesste Ueberlappung: ${g.a.look}/${g.a.art} @ (${g.a.x.toFixed(2)}, ${g.a.y.toFixed(2)}) ` +
            `vs ${g.b.look}/${g.b.art} @ (${g.b.x.toFixed(2)}, ${g.b.y.toFixed(2)}) ` +
            `bei ${g.t.toFixed(0)}s, Ueberdeckung x ${(-g.luftX).toFixed(2)} y ${(-g.luftY).toFixed(2)}`,
        );
      }
      const d = stat.minDyInfo;
      console.log(
        `   kleinster senkrechter Abstand (Mitte-Mitte): ${stat.minDy.toFixed(3)}` +
          (d
            ? `  (${d.a.look}/${d.a.art} vs ${d.b.look}/${d.b.art}, dx ${Math.abs(d.a.x - d.b.x).toFixed(2)}, bei ${d.t.toFixed(0)}s)`
            : ''),
      );
      const l = stat.minLuftYInfo;
      console.log(
        `   kleinste senkrechte LUFT zwischen den Bildkanten: ${stat.minLuftY.toFixed(3)}` +
          (l
            ? `  (${l.a.look}/${l.a.art} vs ${l.b.look}/${l.b.art}, dx ${l.dx.toFixed(2)}, bei ${l.t.toFixed(0)}s)`
            : ''),
      );
      console.log(
        `   ueber die Spielzeit (je 100s, Steine / mit Bananen / Max Steine): ` +
          stat.eimer
            .map(
              (e, i) =>
                `${i * 100}s:${(e.summe / e.frames).toFixed(1)}/` +
                `${(e.summeAlle / e.frames).toFixed(1)}/${e.max}`,
            )
            .join('  '),
      );
      const gs = stat.minDyGleicheSpurInfo;
      console.log(
        `   kleinster senkrechter Abstand bei WAAGERECHTER Deckung: ` +
          `${stat.minDyGleicheSpur === Infinity ? '— (kam nie vor)' : stat.minDyGleicheSpur.toFixed(3)}` +
          (gs
            ? `  (${gs.a.look}/${gs.a.art} vs ${gs.b.look}/${gs.b.art}, dx ${gs.dx.toFixed(2)}, ` +
              `y ${gs.a.y.toFixed(2)}/${gs.b.y.toFixed(2)}, bei ${gs.t.toFixed(0)}s)`
            : ''),
      );
      if (stat.ueberlappungY.length) {
        const ys = stat.ueberlappungY.slice().sort((a, b) => a - b);
        console.log(
          `   Ueberlappungs-Ereignisse: ${ys.length} Paar-Frames, oberes Objekt y ` +
            `von ${ys[0].toFixed(2)} bis ${ys[ys.length - 1].toFixed(2)}; ` +
            `davon mit unterem Objekt oberhalb y=-3.0 (Spielband): ${stat.ueberlappungImSpielfeld}; ` +
            `oberhalb der Schutzgrenze y=${(world.bounds.minY - 1.6).toFixed(2)}: ${stat.ueberlappungImSchutz}`,
        );
      }
      if (stat.bananeMinY !== Infinity) {
        console.log(
          `   Banane-gegen-Stein: unteres Objekt y von ${stat.bananeMinY.toFixed(2)} bis ` +
            `${stat.bananeMaxY.toFixed(2)}; davon im Spielband (y > -3.0): ${stat.bananeImSpielfeld}`,
        );
      }
      console.log('');
    }
  }
}
