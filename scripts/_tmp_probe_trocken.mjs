/**
 * PROBE: greift die Schranke maxTrockenZeit?
 * Misst je Bahn: laengste Zeit ohne Stein, laengste Zeit "gesperrt" (nicht in frei),
 * und wie oft die Schranke ueberhaupt zuschlaegt.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PerspectiveCamera } from 'three';

import { CONFIG } from 'file:///C:/Users/Marco%20Vaccari/FApp/jungle-climber/src/config.js';
import { DifficultyCurve } from 'file:///C:/Users/Marco%20Vaccari/FApp/jungle-climber/src/systems/DifficultyCurve.js';
import { Spawner } from 'file:///C:/Users/Marco%20Vaccari/FApp/jungle-climber/src/systems/Spawner.js';
import { halfWidthAt } from 'file:///C:/Users/Marco%20Vaccari/FApp/jungle-climber/src/core/viewport.js';
import { groessteSpriteBreite, Rock } from 'file:///C:/Users/Marco%20Vaccari/FApp/jungle-climber/src/entities/Rock.js';

const SEKUNDEN = 1200;
const LAEUFE = 6;
const DT = 1 / 60;
const AFFE = 'braun';
const FORMATE = { quer: 16 / 9, hoch: 9 / 19.5 };

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
  const wurzel = 'C:/Users/Marco Vaccari/FApp/jungle-climber';
  for (const [id, char] of Object.entries(CONFIG.characters.list)) {
    const pfad = (char.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
    const datei = resolve(wurzel, 'public', pfad.replace(/^\//, ''));
    try {
      const m = await sharp(datei).metadata();
      BILD_SEITE.set(id, m.width / m.height);
    } catch { BILD_SEITE.set(id, 0.56); }
  }
}

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

await bildseitenLaden();
const GRENZE = CONFIG.rock.korridor.maxTrockenZeit ?? 0;
console.log(`maxTrockenZeit = ${GRENZE} s, bahnZiele = ${CONFIG.rock.korridor.bahnZiele}`);

for (const [fname, aspect] of Object.entries(FORMATE)) {
  const n = 3;
  const gesperrtMax = new Array(n).fill(0);   // laengste Zeit ohne "frei"
  const trockenMax = new Array(n).fill(0);    // laengste Zeit ohne Stein
  const ueberGrenzeUndGesperrt = new Array(n).fill(0); // Sekunden ueber Grenze UND blockiert
  const ueberGrenzeUndFrei = new Array(n).fill(0);
  const wachZeit = new Array(n).fill(0);
  let schrankeAktiv = 0, waehlenRufe = 0, freiEins = 0, freiZwei = 0, freiDrei = 0;
  const trockenBeimZuschlag = [];

  for (let r = 0; r < LAEUFE; r++) {
    const echt = Math.random;
    Math.random = rng(4200 + r * 7919);
    try {
      const charCfg = CONFIG.characters.list[AFFE];
      const pCfg = { ...CONFIG.player, ...charCfg.player };
      const world = spielfeld(aspect, (pCfg.spriteHeight * (BILD_SEITE.get(AFFE) ?? 0.56)) / 2, pCfg);
      const difficulty = new DifficultyCurve(CONFIG.difficulty);
      difficulty.setRockMix(CONFIG.rock.mix);
      const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
      spawner.setSpieler(pCfg);
      spawner.reset();
      const stille = console.warn; console.warn = () => {};
      spawner.setzePowerupBilder(new Map());
      console.warn = stille;

      const bahnen = world.bahnX;
      const idxVon = (x) => { let b = 0; for (let i = 1; i < bahnen.length; i++) if (Math.abs(bahnen[i]-x) < Math.abs(bahnen[b]-x)) b = i; return b; };

      let jetzt = 0;
      const letzterStein = new Array(n).fill(0);
      const letztesFrei = new Array(n).fill(0);
      const istFrei = new Array(n).fill(true);

      const origRockSpawn = Rock.prototype.spawn;
      Rock.prototype.spawn = function (type, look, x, ...rest) {
        const i = idxVon(x);
        if (jetzt - letzterStein[i] > trockenMax[i]) trockenMax[i] = jetzt - letzterStein[i];
        letzterStein[i] = jetzt;
        return origRockSpawn.call(this, type, look, x, ...rest);
      };

      const origWaehlen = spawner._bahnWaehlen.bind(spawner);
      spawner._bahnWaehlen = (frei, alle) => {
        waehlenRufe++;
        if (frei.length === 1) freiEins++; else if (frei.length === 2) freiZwei++; else freiDrei++;
        for (let i = 0; i < n; i++) istFrei[i] = false;
        for (const fx of frei) {
          const i = idxVon(fx);
          istFrei[i] = true;
          if (jetzt - letztesFrei[i] > gesperrtMax[i]) gesperrtMax[i] = jetzt - letztesFrei[i];
          letztesFrei[i] = jetzt;
        }
        // Wuerde die Schranke greifen?
        const tr = spawner._bahnTrocken;
        let wuerde = false;
        if (GRENZE > 0 && frei.length > 1 && tr) {
          for (const fx of frei) if (tr[idxVon(fx)] > GRENZE) wuerde = true;
        }
        if (wuerde) { schrankeAktiv++; }
        if (tr) {
          for (let i = 0; i < n; i++) if (tr[i] > GRENZE) trockenBeimZuschlag.push([i, tr[i], istFrei[i]]);
        }
        return origWaehlen(frei, alle);
      };

      let letztesGebiet = null, gebietWechsel = 0;
      const pn = { gold: -1, chili: -1 };
      const frames = Math.round(SEKUNDEN / DT);
      for (let f = 0; f < frames; f++) {
        difficulty.update(DT);
        const t = difficulty.elapsed;
        jetzt = t;
        const stufe = stufeBei(t);
        spawner.hazardLook = stufe.hazard;
        if (stufe.name !== letztesGebiet) {
          if (letztesGebiet !== null) gebietWechsel++;
          letztesGebiet = stufe.name;
          const gebiet = gebietWechsel + 1;
          for (const [art, pcfg] of [['gold', CONFIG.goldbanane], ['chili', CONFIG.chili]]) {
            if (gebiet < pcfg.abGebiet) continue;
            if (pn[art] < 0) pn[art] = pcfg.abGebiet - 1;
            if (gebiet <= pn[art]) continue;
            const j = pcfg.jedesXteGebiet;
            pn[art] = gebiet + (j.min + Math.floor(Math.random() * (j.max - j.min + 1))) - 1;
            spawner.powerupWerfen(art);
            break;
          }
          spawner.neuesGebiet();
        }
        // Zeit ueber Grenze buchen
        const tr = spawner._bahnTrocken;
        if (tr) for (let i = 0; i < n; i++) {
          if (tr[i] > GRENZE) { if (istFrei[i]) ueberGrenzeUndFrei[i] += DT; else ueberGrenzeUndGesperrt[i] += DT; }
          wachZeit[i] += DT;
        }
        spawner.update(DT, false, difficulty.scrollSpeed);
      }
      // offene Duerre
      for (let i = 0; i < n; i++) {
        if (jetzt - letzterStein[i] > trockenMax[i]) trockenMax[i] = jetzt - letzterStein[i];
        if (jetzt - letztesFrei[i] > gesperrtMax[i]) gesperrtMax[i] = jetzt - letztesFrei[i];
      }
      Rock.prototype.spawn = origRockSpawn;
    } finally { Math.random = echt; }
  }

  const p = (v) => v.map((x) => x.toFixed(1).padStart(9)).join('');
  console.log(`\n### ${fname.toUpperCase()}`);
  console.log(`                                links    MITTE   rechts`);
  console.log(`laengste Duerre Steine (s) ${p(trockenMax)}`);
  console.log(`laengste Sperre (s)        ${p(gesperrtMax)}   (Zeit am Stueck NICHT in 'frei')`);
  console.log(`Zeit ueber Grenze+gesperrt ${p(ueberGrenzeUndGesperrt.map((v,i)=>100*v/wachZeit[i]))}  %`);
  console.log(`Zeit ueber Grenze+frei     ${p(ueberGrenzeUndFrei.map((v,i)=>100*v/wachZeit[i]))}  %`);
  console.log(`_bahnWaehlen-Rufe: ${waehlenRufe}   davon frei=1: ${(100*freiEins/waehlenRufe).toFixed(1)} %  frei=2: ${(100*freiZwei/waehlenRufe).toFixed(1)} %  frei=3: ${(100*freiDrei/waehlenRufe).toFixed(1)} %`);
  console.log(`Rufe, bei denen die Schranke greifen konnte: ${schrankeAktiv} (${(100*schrankeAktiv/waehlenRufe).toFixed(1)} %)`);
  const ueber = trockenBeimZuschlag;
  const gesperrtAnteil = ueber.filter(([,,f]) => !f).length / Math.max(1, ueber.length);
  console.log(`Bahnen ueber Grenze bei einem Abwurf: ${ueber.length}, davon GESPERRT: ${(100*gesperrtAnteil).toFixed(1)} %`);
  const max = ueber.reduce((a,[,v]) => Math.max(a,v), 0);
  console.log(`groesster Trockenwert, der einem Abwurf begegnet ist: ${max.toFixed(1)} s`);
}
