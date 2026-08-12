/**
 * MISST DIE BAHNVERTEILUNG — welche der drei Spuren bekommt wie viel?
 *
 * Der Besitzer beobachtet: "die Gegenstaende, die herunterkommen, sollten
 * gleichmaessiger sein — Mitte, rechts, links. Es hat noch zu wenig von dem."
 *
 * Das aeltere scripts/_verteilung.mjs stammt aus der Zeit der STUFENLOSEN
 * Platzierung: es teilt die Bildbreite in N gleich breite Klassen und zaehlt,
 * in welche Klasse ein Objekt faellt. Seit CONFIG.world.bahnen = [-1, 0, 1]
 * gibt es aber nur noch DREI moegliche x-Werte. Eine Klasseneinteilung misst
 * dann nur noch, wie die Klassengrenzen zufaellig neben den drei Bahnen
 * liegen — nicht die Verteilung selbst. Deshalb dieses Skript.
 *
 * WAS HIER GEZAEHLT WIRD
 *   1. Je Bahn: Steine nach Art (klein/mittel/gross), Muenzen, Bananen,
 *      Power-ups (Goldbanane/Chili).
 *   2. Je Bahn: wie oft sie ueberhaupt FREI war (spawner._bahnWaehlen bekommt
 *      die Liste der erlaubten Bahnen) — trennt "Geometrie sperrt sie" von
 *      "die Wahl bevorzugt eine andere".
 *   3. Die Folge: wie oft zweimal hintereinander dieselbe Bahn, und wie lang
 *      die laengste Strecke ohne ein Objekt auf der mittleren Bahn ist —
 *      in Objekten UND in Sekunden.
 *   4. Wo sich der Korridor selbst aufhaelt (zeitgewichtet). Muenzen, Bananen
 *      und Power-ups liegen AUF ihm, ihre Verteilung haengt also direkt daran.
 *
 * NICHTS AM SPIELCODE WIRD VERAENDERT. Gemessen wird, indem die spawn()-
 * Methoden der Entities und zwei Spawner-Methoden zur Laufzeit umhuellt
 * werden (Original wird immer aufgerufen und sein Rueckgabewert
 * durchgereicht).
 *
 * Aufruf:
 *   node scripts/_bahnverteilung.mjs
 *   node scripts/_bahnverteilung.mjs --sekunden 1200 --laeufe 6 --affe braun
 *   node scripts/_bahnverteilung.mjs --format hoch
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
import { Coin } from '../src/entities/Coin.js';
import { Banana } from '../src/entities/Banana.js';
import { Powerup } from '../src/entities/Powerup.js';

/* ============================================================== Argumente */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}

const SEKUNDEN = arg('sekunden', 1200); // 20 Minuten Spielzeit je Lauf
const LAEUFE = arg('laeufe', 6);
const DT = arg('dt', 1 / 60);
const AFFE = String(arg('affe', 'braun'));
const FORMAT = String(arg('format', 'beide')); // quer | hoch | beide

/* GEGENPROBEN — was WUERDE eine andere Wahlregel bringen?
 *
 * Nur die Wahl UNTER DEN FREIEN Bahnen wird ersetzt; welche Bahnen frei sind,
 * entscheidet weiter die Luecken-Garantie (Spawner._freieStelle). Am Spielcode
 * aendert das nichts — die Ersetzung lebt nur in diesem Messlauf.
 *
 *   echt              wie im Spiel (Spawner._bahnWaehlen, Gewicht 1/(n+1))
 *   gleich            gleichverteilt unter den freien Bahnen
 *   nichtwie          gleichverteilt, aber moeglichst nicht die letzte Bahn
 *   zaehler-nichtwie  wie im Spiel, aber die letzte Bahn wird uebersprungen,
 *                     wenn es eine Alternative gibt
 */
const MODUS = String(arg('modus', 'echt'));

/* Config-Gegenproben. Sie aendern NUR das im Speicher geladene CONFIG dieses
 * Messlaufs, nicht die Datei — damit laesst sich beziffern, was ein
 * geaenderter Wert braechte, bevor jemand ihn anfasst. */
const RANDSOG = arg('randsog', null);
if (RANDSOG !== null) CONFIG.rock.korridor.randSog = Number(RANDSOG);
const MAXSPRUNG = arg('maxsprung', null);
if (MAXSPRUNG !== null) CONFIG.rock.korridor.maxSprung = Number(MAXSPRUNG);

const FORMATE = { quer: 16 / 9, hoch: 9 / 19.5 };

/* ============================================================ Zufall (fest) */

/** mulberry32 — reproduzierbar, damit eine Zahl nachstellbar bleibt. */
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

/** Halbe Bildbreite eines Affen — aus der echten Bilddatei, wie fairness.mjs. */
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
      console.warn(`[bahnverteilung] ${datei} nicht lesbar (${fehler.message}) — nehme 0.56.`);
      BILD_SEITE.set(id, 0.56);
    }
  }
}

function halbeAffenBreite(charId, pCfg) {
  return (pCfg.spriteHeight * (BILD_SEITE.get(charId) ?? 0.56)) / 2;
}

/** Exakt wie Game._updateWorldBounds (und wie fairness.mjs es spiegelt). */
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
    bounds: {
      minX: Math.max(base.bounds.minX, -limit),
      maxX,
      minY: base.bounds.minY,
      maxY: base.bounds.maxY,
    },
    bahnX: base.bahnen.map((anteil) => anteil * maxX),
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.8),
  };
}

/** Wand-Stufe zur Spielzeit (Spiegel von PlantWall.stageIndexAt). */
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

/* ================================================================= Ein Lauf */

function lauf({ seed, affe, aspect, sammler }) {
  const echterZufall = Math.random;
  Math.random = rng(seed);

  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const world = spielfeld(aspect, halbeAffenBreite(affe, pCfg), pCfg);

    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);

    const szene = { add() {} };
    const spawner = new Spawner(szene, CONFIG, difficulty, world, null);
    spawner.setSpieler(pCfg);
    spawner.reset();

    // Power-up-Pool anlegen (ohne Bilder — Powerup warnt, das ist hier egal).
    const stilleWarnung = console.warn;
    console.warn = () => {};
    spawner.setzePowerupBilder(new Map());
    console.warn = stilleWarnung;

    /* Bahnindex zu einem x — die Bahnen sind exakte Werte, aber wir runden
     * ueber "naechste Bahn", damit nichts an Fliesskomma-Resten haengt. */
    const bahnen = world.bahnX;
    const idxVon = (x) => {
      let best = 0;
      for (let i = 1; i < bahnen.length; i++) {
        if (Math.abs(bahnen[i] - x) < Math.abs(bahnen[best] - x)) best = i;
      }
      return best;
    };

    let jetzt = 0; // Spielzeit dieses Laufs, fuer die Zeitabstaende

    /* ------------------------------------------- Messhaken (nicht-invasiv) */
    const origRock = Rock.prototype.spawn;
    const origCoin = Coin.prototype.spawn;
    const origBanana = Banana.prototype.spawn;
    const origPower = Powerup.prototype.spawn;

    Rock.prototype.spawn = function (type, look, x, ...rest) {
      sammler.notiere('stein', type.id, idxVon(x), jetzt);
      return origRock.call(this, type, look, x, ...rest);
    };
    Coin.prototype.spawn = function (x, ...rest) {
      sammler.notiere('muenze', 'muenze', idxVon(x), jetzt);
      return origCoin.call(this, x, ...rest);
    };
    Banana.prototype.spawn = function (x, ...rest) {
      sammler.notiere('banane', 'banane', idxVon(x), jetzt);
      return origBanana.call(this, x, ...rest);
    };
    Powerup.prototype.spawn = function (art, x, ...rest) {
      sammler.notiere('powerup', art, idxVon(x), jetzt);
      return origPower.call(this, art, x, ...rest);
    };

    // Welche Bahnen waren ueberhaupt erlaubt, und welche wurde genommen?
    const origWaehlen = spawner._bahnWaehlen.bind(spawner);
    let letzteBahn = -1;
    const eigenZaehler = new Array(bahnen.length).fill(0);
    const zufaellig = (menge) => menge[Math.floor(Math.random() * menge.length)];
    spawner._bahnWaehlen = (frei, alle) => {
      for (const fx of frei) sammler.frei[idxVon(fx)]++;
      sammler.freiGroesse[frei.length]++;

      let x;
      if (MODUS === 'knappste' || MODUS === 'knappste-nichtwie') {
        /* Unter den freien Bahnen die mit dem KLEINSTEN Zaehler.
         *
         * Anders als 1/(n+1) im Spiel: dort ist das Gewicht der Kehrwert der
         * Gesamtzahl, und das flacht ab. Bei 2140 zu 3291 Abwuerfen betraegt
         * das Verhaeltnis nur noch 1.54 — der Ausgleich verliert mit der
         * Laufzeit an Kraft, statt den Rueckstand aufzuholen. */
        let menge = frei;
        if (MODUS === 'knappste-nichtwie') {
          const andere = frei.filter((k) => idxVon(k) !== letzteBahn);
          if (andere.length > 0) menge = andere;
        }
        let besteZahl = Infinity;
        let kandidaten = [];
        for (const k of menge) {
          const c = eigenZaehler[idxVon(k)];
          if (c < besteZahl) {
            besteZahl = c;
            kandidaten = [k];
          } else if (c === besteZahl) kandidaten.push(k);
        }
        x = zufaellig(kandidaten);
        eigenZaehler[idxVon(x)]++;
      } else if (MODUS === 'defizit') {
        /* Gewicht linear im Rueckstand: (groesster Zaehler + 1 - eigener).
         * Bleibt zufaellig, holt aber den Rueckstand wirklich auf. */
        const max = Math.max(...eigenZaehler);
        let summe = 0;
        const g = frei.map((k) => {
          const w = max + 1 - eigenZaehler[idxVon(k)];
          summe += w;
          return w;
        });
        let r = Math.random() * summe;
        let treffer = frei.length - 1;
        for (let i = 0; i < g.length; i++) {
          r -= g[i];
          if (r <= 0) {
            treffer = i;
            break;
          }
        }
        x = frei[treffer];
        eigenZaehler[idxVon(x)]++;
      } else if (MODUS === 'gleich') {
        x = zufaellig(frei);
      } else if (MODUS === 'nichtwie') {
        const andere = frei.filter((k) => idxVon(k) !== letzteBahn);
        x = zufaellig(andere.length > 0 ? andere : frei);
      } else if (MODUS === 'zaehler-nichtwie') {
        const andere = frei.filter((k) => idxVon(k) !== letzteBahn);
        x = origWaehlen(andere.length > 0 ? andere : frei, alle);
      } else {
        x = origWaehlen(frei, alle);
      }
      letzteBahn = idxVon(x);
      return x;
    };

    // Wie oft entfaellt ein Objekt mangels freier Bahn?
    const origFreieStelle = spawner._freieStelle.bind(spawner);
    spawner._freieStelle = (type, hitRadius) => {
      const x = origFreieStelle(type, hitRadius);
      if (x === null) sammler.entfallen++;
      else sammler.versuche++;
      return x;
    };

    /* ---------------------------------------------------------- Simulation */
    let letztesGebiet = null;
    let gebietWechsel = 0;
    const powerupNaechstes = { gold: -1, chili: -1 };

    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      jetzt = t;

      const stufe = stufeBei(t);
      spawner.hazardLook = stufe.hazard;

      // Gebietswechsel — exakt wie Game._updatePlaying es macht.
      if (stufe.name !== letztesGebiet) {
        if (letztesGebiet !== null) gebietWechsel++;
        letztesGebiet = stufe.name;
        // Game._belohnungenPruefen
        const gebiet = gebietWechsel + 1;
        for (const [art, pcfg] of [
          ['gold', CONFIG.goldbanane],
          ['chili', CONFIG.chili],
        ]) {
          if (gebiet < pcfg.abGebiet) continue;
          if (powerupNaechstes[art] < 0) powerupNaechstes[art] = pcfg.abGebiet - 1;
          if (gebiet <= powerupNaechstes[art]) continue;
          const j = pcfg.jedesXteGebiet;
          const abstand = j.min + Math.floor(Math.random() * (j.max - j.min + 1));
          powerupNaechstes[art] = gebiet + abstand - 1;
          spawner.powerupWerfen(art);
          break;
        }
        spawner.neuesGebiet();
      }

      // Kein Klettern (Normalfall): scroll = reine Scrollgeschwindigkeit.
      const scroll = difficulty.scrollSpeed;

      // Wo steht der Korridor gerade? (zeitgewichtet, fuer Muenzen/Bananen)
      sammler.korridorZeit[idxVon(spawner.korridor.x)] += DT;

      spawner.update(DT, false, scroll);
    }

    sammler.spielzeit += SEKUNDEN;
    sammler.feldbreite = world.bounds.maxX;
    sammler.bahnAbstand = Math.abs(bahnen[1] - bahnen[0]);
    // Folge-Statistik JE LAUF abschliessen — ueber Laufgrenzen hinweg zu
    // zaehlen ergaebe Duerren, die es im Spiel nie gibt (jeder Lauf faengt
    // wieder bei Sekunde 0 an).
    sammler.laufAbschliessen();

    /* Haken wieder abnehmen — sonst zaehlt der naechste Lauf doppelt. */
    Rock.prototype.spawn = origRock;
    Coin.prototype.spawn = origCoin;
    Banana.prototype.spawn = origBanana;
    Powerup.prototype.spawn = origPower;
  } finally {
    Math.random = echterZufall;
  }
}

/* ================================================================= Sammler */

function neuerSammler(n) {
  return {
    n,
    // gruppe -> art -> [n Bahnen]
    zaehler: new Map(),
    frei: new Array(n).fill(0),
    freiGroesse: new Array(n + 1).fill(0),
    korridorZeit: new Array(n).fill(0),
    entfallen: 0,
    versuche: 0,
    spielzeit: 0,
    feldbreite: 0,
    bahnAbstand: 0,

    // Folge ALLER Objekte in Abwurfreihenfolge (Bahnindex + Zeit) — je Lauf.
    folgeAlle: [],
    folgeStein: [],
    // Aggregierte Folge-Statistik ueber alle Laeufe.
    folgeErgebnis: {
      stein: { paare: 0, wiederholung: 0, luecke: new Array(n).fill(0), lueckeZeit: new Array(n).fill(0), serie: new Array(n).fill(0), lueckeJeLauf: [] },
      alle: { paare: 0, wiederholung: 0, luecke: new Array(n).fill(0), lueckeZeit: new Array(n).fill(0), serie: new Array(n).fill(0), lueckeJeLauf: [] },
    },
    // Steine je Zeitabschnitt (5-Minuten-Bloecke), um Drift zu sehen.
    abschnitte: new Map(),

    notiere(gruppe, art, bahn, zeit) {
      if (!this.zaehler.has(gruppe)) this.zaehler.set(gruppe, new Map());
      const g = this.zaehler.get(gruppe);
      if (!g.has(art)) g.set(art, new Array(this.n).fill(0));
      g.get(art)[bahn]++;
      this.folgeAlle.push([bahn, zeit]);
      if (gruppe === 'stein') {
        this.folgeStein.push([bahn, zeit]);
        const block = Math.floor(zeit / 300);
        if (!this.abschnitte.has(block)) this.abschnitte.set(block, new Array(this.n).fill(0));
        this.abschnitte.get(block)[bahn]++;
      }
    },

    laufAbschliessen() {
      for (const [schluessel, folge] of [
        ['stein', this.folgeStein],
        ['alle', this.folgeAlle],
      ]) {
        const s = folgeStatistik(folge, this.n);
        const z = this.folgeErgebnis[schluessel];
        z.paare += Math.max(0, folge.length - 1);
        z.wiederholung += s.wiederholung;
        for (let i = 0; i < this.n; i++) {
          if (s.luecke[i] > z.luecke[i]) z.luecke[i] = s.luecke[i];
          if (s.lueckeZeit[i] > z.lueckeZeit[i]) z.lueckeZeit[i] = s.lueckeZeit[i];
          if (s.laufLaenge[i] > z.serie[i]) z.serie[i] = s.laufLaenge[i];
        }
        z.lueckeJeLauf.push(s.lueckeZeit.map((v) => +v.toFixed(1)));
      }
      this.folgeStein = [];
      this.folgeAlle = [];
    },
  };
}

/* ================================================================= Ausgabe */

const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const proz = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) + ' %' : '—');

function tabelle(sammler, titel, namen) {
  const n = sammler.n;
  console.log(`\n  ${titel}`);
  console.log(
    `  ${pad('Objektart', 16)}${namen.map((s) => padL(s, 12)).join('')}${padL('gesamt', 10)}`,
  );
  console.log(`  ${'-'.repeat(16 + 12 * n + 10)}`);

  const gesamtAlle = new Array(n).fill(0);

  for (const [gruppe, arten] of sammler.zaehler) {
    for (const [art, reihe] of arten) {
      const summe = reihe.reduce((a, b) => a + b, 0);
      const label = gruppe === art ? art : `${gruppe} ${art}`;
      console.log(
        `  ${pad(label, 16)}` +
          reihe.map((v) => padL(proz(v, summe), 12)).join('') +
          padL(summe, 10),
      );
      for (let i = 0; i < n; i++) gesamtAlle[i] += reihe[i];
    }
  }

  const summeAlle = gesamtAlle.reduce((a, b) => a + b, 0);
  console.log(`  ${'-'.repeat(16 + 12 * n + 10)}`);
  console.log(
    `  ${pad('ALLES ZUSAMMEN', 16)}` +
      gesamtAlle.map((v) => padL(proz(v, summeAlle), 12)).join('') +
      padL(summeAlle, 10),
  );
}

/** Wie oft folgt auf eine Bahn dieselbe? Und die laengste Duerre je Bahn. */
function folgeStatistik(folge, n) {
  let wiederholung = 0;
  const laufLaenge = new Array(n).fill(0); // laengste Serie derselben Bahn
  const aktuellerLauf = new Array(n).fill(0);

  // Laengste Strecke OHNE Bahn i — in Objekten und in Sekunden.
  const luecke = new Array(n).fill(0);
  const lueckeZeit = new Array(n).fill(0);
  const seit = new Array(n).fill(0); // Objekte seit dem letzten Mal Bahn i
  const seitZeit = new Array(n).fill(folge.length ? folge[0][1] : 0);
  const letzteZeit = new Array(n).fill(folge.length ? folge[0][1] : 0);

  for (let k = 0; k < folge.length; k++) {
    const [b, t] = folge[k];
    if (k > 0 && folge[k - 1][0] === b) wiederholung++;

    for (let i = 0; i < n; i++) {
      if (i === b) {
        aktuellerLauf[i]++;
        if (aktuellerLauf[i] > laufLaenge[i]) laufLaenge[i] = aktuellerLauf[i];
        if (seit[i] > luecke[i]) luecke[i] = seit[i];
        const dt = t - letzteZeit[i];
        if (dt > lueckeZeit[i]) lueckeZeit[i] = dt;
        seit[i] = 0;
        letzteZeit[i] = t;
      } else {
        aktuellerLauf[i] = 0;
        seit[i]++;
      }
    }
  }
  // Auch die noch offene Duerre am Ende zaehlt.
  const ende = folge.length ? folge[folge.length - 1][1] : 0;
  for (let i = 0; i < n; i++) {
    if (seit[i] > luecke[i]) luecke[i] = seit[i];
    if (ende - letzteZeit[i] > lueckeZeit[i]) lueckeZeit[i] = ende - letzteZeit[i];
  }

  return { wiederholung, anteil: folge.length > 1 ? wiederholung / (folge.length - 1) : 0, luecke, lueckeZeit, laufLaenge };
}

/* ==================================================================== Start */

await bildseitenLaden();

const formate = FORMAT === 'beide' ? Object.entries(FORMATE) : [[FORMAT, FORMATE[FORMAT]]];
const NAMEN = ['links', 'MITTE', 'rechts'];

console.log('\n=========================================================');
console.log('  BAHNVERTEILUNG');
console.log(`  Affe: ${AFFE}   Bahnen: ${JSON.stringify(CONFIG.world.bahnen)}   Wahlregel: ${MODUS}`);
console.log(`  ${LAEUFE} Laeufe x ${SEKUNDEN} s = ${((LAEUFE * SEKUNDEN) / 60).toFixed(0)} Minuten Spielzeit je Format`);
console.log('  Gleichverteilt waeren 33.3 % je Bahn.');
console.log('=========================================================');

for (const [fname, aspect] of formate) {
  const n = CONFIG.world.bahnen.length;
  const namen = n === 3 ? NAMEN : CONFIG.world.bahnen.map((b, i) => `Bahn${i}`);
  const sammler = neuerSammler(n);

  for (let i = 0; i < LAEUFE; i++) {
    lauf({ seed: 4200 + i * 7919, affe: AFFE, aspect, sammler });
  }

  console.log(`\n\n#########  FORMAT ${fname.toUpperCase()}  (${aspect.toFixed(3)})  #########`);
  console.log(
    `  Feld: +/-${sammler.feldbreite.toFixed(3)}   Bahnabstand: ${sammler.bahnAbstand.toFixed(3)}   ` +
      `Bahnen bei ${CONFIG.world.bahnen.map((b) => (b * sammler.feldbreite).toFixed(2)).join(' / ')}`,
  );

  tabelle(sammler, 'ANTEIL JE BAHN', namen);

  /* --------------------------------------------------- Freiheit vs. Wahl */
  const freiSumme = sammler.frei.reduce((a, b) => a + b, 0);
  console.log('\n  WIE OFT WAR EINE BAHN UEBERHAUPT FREI (Angebot, nicht Wahl)');
  console.log(`  ${pad('', 16)}${namen.map((s) => padL(s, 12)).join('')}`);
  const steinReihe = new Array(n).fill(0);
  for (const [art, reihe] of sammler.zaehler.get('stein') ?? []) {
    for (let i = 0; i < n; i++) steinReihe[i] += reihe[i];
  }
  const steinSumme = steinReihe.reduce((a, b) => a + b, 0);
  const angebote = sammler.versuche; // Abwuerfe mit mindestens einer freien Bahn
  console.log(
    `  ${pad('frei bei', 16)}` +
      sammler.frei.map((v) => padL(proz(v, angebote), 12)).join('') +
      '   (Anteil der Abwuerfe, bei denen diese Bahn erlaubt war)',
  );
  console.log(
    `  ${pad('genommen wenn frei', 16)}` +
      steinReihe.map((v, i) => padL(proz(v, sammler.frei[i]), 12)).join(''),
  );
  console.log(
    `  Grad der Wahlfreiheit: ` +
      sammler.freiGroesse
        .map((v, k) => (v > 0 ? `${k} freie Bahn(en): ${proz(v, angebote)}` : null))
        .filter(Boolean)
        .join('   '),
  );
  console.log(
    `  Objekte, die mangels freier Bahn ENTFALLEN sind: ${sammler.entfallen} ` +
      `(${proz(sammler.entfallen, sammler.entfallen + sammler.versuche)} aller Abwurfversuche)`,
  );

  /* ------------------------------------------------------------ Korridor */
  const kSumme = sammler.korridorZeit.reduce((a, b) => a + b, 0);
  console.log('\n  WO DER KORRIDOR STEHT (zeitgewichtet — Muenzen/Bananen/Power-ups liegen darauf)');
  console.log(`  ${pad('', 16)}${namen.map((s) => padL(s, 12)).join('')}`);
  console.log(
    `  ${pad('Aufenthalt', 16)}` +
      sammler.korridorZeit.map((v) => padL(proz(v, kSumme), 12)).join(''),
  );

  /* ------------------------------------------------- Drift ueber die Zeit */
  console.log('\n  STEINE JE 5-MINUTEN-BLOCK (steigt die Schieflage mit der Schwierigkeit?)');
  console.log(`  ${pad('Spielzeit', 16)}${namen.map((s) => padL(s, 12)).join('')}${padL('Steine', 10)}`);
  for (const block of [...sammler.abschnitte.keys()].sort((a, b) => a - b)) {
    const reihe = sammler.abschnitte.get(block);
    const summe = reihe.reduce((a, b) => a + b, 0);
    console.log(
      `  ${pad(`${block * 5}-${block * 5 + 5} min`, 16)}` +
        reihe.map((v) => padL(proz(v, summe), 12)).join('') +
        padL(summe, 10),
    );
  }

  /* -------------------------------------------------------------- Folge */
  for (const [titel, schluessel] of [
    ['NUR STEINE', 'stein'],
    ['ALLE OBJEKTE', 'alle'],
  ]) {
    const z = sammler.folgeErgebnis[schluessel];
    console.log(`\n  DIE FOLGE — ${titel}  (je Lauf getrennt gezaehlt, ${z.paare + LAEUFE} Objekte)`);
    console.log(
      `  zweimal hintereinander dieselbe Bahn: ${((z.wiederholung / z.paare) * 100).toFixed(1)} % ` +
        `(bei freier Gleichverteilung waeren es 33.3 %, bei "nie dieselbe" 0 %)`,
    );
    console.log(`  ${pad('', 26)}${namen.map((x) => padL(x, 12)).join('')}`);
    console.log(
      `  ${pad('laengste Serie', 26)}` + z.serie.map((v) => padL(v + 'x', 12)).join(''),
    );
    console.log(
      `  ${pad('laengste Duerre (Objekte)', 26)}` + z.luecke.map((v) => padL(v, 12)).join(''),
    );
    console.log(
      `  ${pad('laengste Duerre (Sekunden)', 26)}` +
        z.lueckeZeit.map((v) => padL(v.toFixed(1) + ' s', 12)).join(''),
    );
    if (schluessel === 'stein') {
      console.log(`  laengste Duerre je Lauf (s): ${z.lueckeJeLauf.map((r) => '[' + r.join(' / ') + ']').join('  ')}`);
    }
  }
}

console.log('');
