/**
 * TEMPORAER — Misst, WO die Objekte quer ueber das Bild landen.
 *
 * Der Besitzer beobachtet: "die Gegenstaende sind nicht gleichmaessig
 * verteilt, es sollte auch mal in die Mitte kommen". Dieses Skript prueft das
 * nach: es faehrt den echten Spawner ueber viele Minuten (genau wie
 * scripts/fairness.mjs, ohne Browser) und zaehlt aus,
 *
 *   1. in welcher Klasse ueber die Spielbreite jedes gespawnte Objekt landet,
 *   2. wo sich der KORRIDOR selbst ueber die Zeit aufhaelt (zeitgewichtet),
 *   3. wie weit ein Objekt beim VORBEIFLIEGEN von der Bahn entfernt ist
 *      (also von der Stelle, an der ein Spieler steht, der Muenzen sammelt),
 *   4. wie breit die Sperrzone ist und wieviel Platz uebrig bleibt,
 *   5. wie lange die MITTE am Stueck leer bleibt,
 *   6. eine Reihe ueber verschiedene Seitenverhaeltnisse.
 *
 * Aufruf:  node scripts/_verteilung.mjs [--laeufe 10] [--sekunden 600]
 *          [--affe braun] [--format quer|hoch|beide] [--klassen 20]
 *          [--sweep]   nur die Reihe ueber die Seitenverhaeltnisse
 */
import { PerspectiveCamera } from 'three';

import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';

/* ============================================================== Argumente */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}

const LAEUFE = arg('laeufe', 10);
const SEKUNDEN = arg('sekunden', 600);
const DT = arg('dt', 1 / 60);
const AFFE = String(arg('affe', 'braun'));
const FORMAT = String(arg('format', 'beide'));
const KLASSEN = arg('klassen', 20);
const NUR_SWEEP = process.argv.includes('--sweep');

/* ============================================================ Zufall (fest) */
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
/** Exakt wie fairness.mjs / Game._updateWorldBounds. */
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

/* =============================================================== Histogramm */
function neuesHisto(n) {
  return { n, zaehler: new Float64Array(n), summe: 0 };
}
function eintragen(h, x, halb, gewicht = 1) {
  let k = Math.floor(((x + halb) / (2 * halb)) * h.n);
  if (k < 0) k = 0;
  if (k >= h.n) k = h.n - 1;
  h.zaehler[k] += gewicht;
  h.summe += gewicht;
}

function druckeHisto(titel, h, halb, einheit = '') {
  const breite = (2 * halb) / h.n;
  const max = Math.max(...h.zaehler);
  const gleich = h.summe / h.n;
  console.log(`\n${titel}`);
  console.log(
    `  Klasse   x-Bereich          Anteil    (gleichverteilt waeren ${(100 / h.n).toFixed(1)} %)`,
  );
  for (let k = 0; k < h.n; k++) {
    const von = -halb + k * breite;
    const bis = von + breite;
    const anteil = h.summe > 0 ? h.zaehler[k] / h.summe : 0;
    const bar = '#'.repeat(Math.round((h.zaehler[k] / Math.max(max, 1e-9)) * 44));
    const rel = gleich > 0 ? h.zaehler[k] / gleich : 0;
    console.log(
      `  ${String(k).padStart(2)}   ${von.toFixed(2).padStart(6)} .. ${bis.toFixed(2).padStart(6)}  ` +
        `${(anteil * 100).toFixed(2).padStart(6)} %  x${rel.toFixed(2).padStart(5)}  ${bar}`,
    );
  }
  console.log(`  Summe: ${Math.round(h.summe)}${einheit}`);
}

function kennzahlen(werte, halb) {
  if (!werte.length) return null;
  let inDrittel = 0;
  let inFuenftel = 0;
  let summeAbs = 0;
  let summe = 0;
  for (const x of werte) {
    if (Math.abs(x) <= halb / 3) inDrittel++;
    if (Math.abs(x) <= halb / 5) inFuenftel++;
    summeAbs += Math.abs(x);
    summe += x;
  }
  return {
    n: werte.length,
    mitteDrittel: inDrittel / werte.length,
    mitteFuenftel: inFuenftel / werte.length,
    mittelAbs: summeAbs / werte.length,
    mittel: summe / werte.length,
  };
}

/* ================================================================= Ein Lauf */
function lauf({ seed, affe, aspect, sammel }) {
  const echterZufall = Math.random;
  Math.random = rng(seed);

  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const world = spielfeld(aspect, pCfg.hitRadius);

    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);

    const szene = { add() {} };
    const spawner = new Spawner(szene, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = charCfg.bananas !== false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    /* Mitschreiben, OHNE das Verhalten zu aendern: der Originalaufruf
     * entscheidet weiterhin allein, das Ergebnis wird nur protokolliert.
     * Zusaetzlich wird die Sperrzone nachgerechnet — mit denselben Formeln
     * wie im Spawner, aber ohne dort etwas anzufassen. */
    const origFrei = spawner._freieStelle.bind(spawner);
    let zeitJetzt = 0;
    const spanneAus = { min: 0, max: 0 };

    spawner._freieStelle = (type, hitRadius) => {
      // Sperrzone nachrechnen (reine Lesekopie aus Spawner._freieStelle).
      const k = CONFIG.rock.korridor;
      const look = CONFIG.rock.looks[spawner.hazardLook] ?? CONFIG.rock.looks.stein;
      const slot = CONFIG.rock.types.indexOf(type);
      const i = slot < 0 ? 0 : slot;
      const fall = (type.fallFactor ?? 1) * (look.fallMulSlots?.[i] ?? look.fallMul ?? 1);
      const basis = difficulty.scrollSpeed;
      const eigen = difficulty.rockFallSpeed;
      const sp = spawner.spieler;
      const vSchnell = (eigen + basis + sp.climbAssist) * fall;
      const vLangsam = (eigen + basis * sp.minScrollFactor) * fall;
      const rand = sp.hitRadius + hitRadius;
      const tEin = Math.max(0, (world.spawnY - (world.bounds.maxY + rand)) / vSchnell - k.zeitReserve);
      const tAus = (world.spawnY - (world.bounds.minY - rand)) / vLangsam + k.zeitReserve;
      const jetzt = spawner.korridor.jetzt;

      const x = origFrei(type, hitRadius);

      const s = spawner.korridor.spanne(jetzt + tEin, jetzt + tAus, spanneAus);
      const abstand = k.halbbreite + rand + k.reserve;
      const von = Math.max(-world.spawnHalfWidth, s.min - abstand);
      const bis = Math.min(world.spawnHalfWidth, s.max + abstand);
      sammel.sperrBreite.push(bis - von);
      sammel.spannBreite.push(s.max - s.min);
      sammel.fenster.push(tAus - tEin);
      sammel.freiBreite.push(2 * world.spawnHalfWidth - (bis - von));

      if (x === null) {
        sammel.entfallen++;
      } else {
        sammel.steine.push(x);
        sammel.steineNachZeit.push([zeitJetzt, x, sammel.laufNr]);
        (sammel.nachArt[type.id] ??= []).push(x);
      }
      return x;
    };

    const origCoin = spawner._spawnCoin.bind(spawner);
    spawner._spawnCoin = () => {
      const vorher = spawner.coins.active.length;
      origCoin();
      const c = spawner.coins.active[spawner.coins.active.length - 1];
      if (spawner.coins.active.length > vorher && c) sammel.muenzen.push(c.x);
    };

    const origBanane = spawner._spawnBanana.bind(spawner);
    spawner._spawnBanana = (x, y) => {
      sammel.bananen.push(x);
      origBanane(x, y);
    };

    /* Beim Vorbeifliegen messen: wie weit ist das Objekt in dem Moment, in dem
     * es die Spielerhoehe passiert, von der freien Bahn entfernt? Das ist die
     * Zahl, die der Spieler FUEHLT — er steht (Muenzen!) auf der Bahn. */
    const py = CONFIG.player.startPosition[1];
    const letztesY = new Map();

    // Wie lange bleibt die Mitte am Stueck ohne Objekt? Gemessen ueber die
    // Ankunft auf Spielerhoehe, Streifen |x| <= halb/5.
    let letzteMitte = 0;
    let letzteRand = 0;

    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      zeitJetzt = t;
      spawner.hazardLook = stufeBei(t).hazard;

      // Wie im Spiel ohne Klettereingabe: scroll == difficulty.scrollSpeed.
      spawner.update(DT, false, difficulty.scrollSpeed);

      // Korridor zeitgewichtet mitschreiben (jeder Frame ein Messpunkt).
      const kx = spawner.korridor.x;
      sammel.korridor.push(kx);

      /* Wie schnell DARF die Bahn ueberhaupt wandern? Drei Bremsen greifen
       * (Spawner.korridorTempo); die dritte (_tempoDamitPlatzBleibt) ist im
       * schmalen Feld die harte. Nur lesen, nichts veraendern. */
      if (f % 30 === 0) {
        const fallT = difficulty.rockFallSpeed + difficulty.scrollSpeed;
        const kk = CONFIG.rock.korridor;
        const tW = Math.min(1, difficulty.wand / kk.anteilVollAbWand);
        sammel.tempo.push({
          t,
          gesamt: spawner.korridorTempo,
          ausLauf: spawner.spieler.moveSpeed * (kk.anteilStart + (kk.anteilMax - kk.anteilStart) * tW),
          ausFall: fallT * kk.tempoAnteil,
          ausPlatz: spawner._tempoDamitPlatzBleibt(fallT),
        });
      }
      // Wanderung der Bahn in 60-s-Fenstern (= eine typische Partie).
      if (f % Math.round(60 / DT) === 0) {
        if (sammel._fensterStart !== null) sammel.drift60.push(Math.abs(kx - sammel._fensterStart));
        sammel._fensterStart = kx;
      }

      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        const vor = letztesY.get(r);
        letztesY.set(r, r.y);
        if (vor === undefined) continue;
        if (vor > py && r.y <= py) {
          // Passiert gerade die Spielerhoehe.
          sammel.relativ.push(r.x - kx);
          sammel.ankunft.push([t, r.x]);
          if (Math.abs(r.x) <= sammel.halbRef / 5) {
            if (letzteMitte > 0) sammel.mittePausen.push(t - letzteMitte);
            letzteMitte = t;
          }
          if (Math.abs(r.x) >= sammel.halbRef * 0.6) {
            if (letzteRand > 0) sammel.randPausen.push(t - letzteRand);
            letzteRand = t;
          }
        }
      }
    }

    sammel.halb = world.spawnHalfWidth;
    sammel.bounds = [world.bounds.minX, world.bounds.maxX];
    sammel.sekunden += SEKUNDEN;
    sammel.laufNr++;
    sammel._fensterStart = null;
  } finally {
    Math.random = echterZufall;
  }
}

function neuerSammler(halbRef) {
  return {
    steine: [],
    steineNachZeit: [],
    nachArt: {},
    muenzen: [],
    bananen: [],
    korridor: [],
    relativ: [],
    ankunft: [],
    mittePausen: [],
    randPausen: [],
    sperrBreite: [],
    spannBreite: [],
    freiBreite: [],
    fenster: [],
    tempo: [],
    drift60: [],
    _fensterStart: null,
    laufNr: 0,
    entfallen: 0,
    sekunden: 0,
    halb: CONFIG.world.spawnHalfWidth,
    halbRef,
    bounds: [0, 0],
  };
}

const mittel = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/* =================================================================== Lauf */
const FORMATE = { quer: 16 / 9, hoch: 9 / 19.5 };

if (!NUR_SWEEP) {
  const formate = FORMAT === 'beide' ? Object.entries(FORMATE) : [[FORMAT, FORMATE[FORMAT]]];

  console.log(
    `Verteilungs-Messung — ${LAEUFE} Laeufe a ${SEKUNDEN}s, Affe ${AFFE}, ` +
      `Formate ${formate.map(([n]) => n).join('/')}, ${KLASSEN} Klassen\n` +
      `(Korridor: halbbreite ${CONFIG.rock.korridor.halbbreite}, ` +
      `maxSprung ${CONFIG.rock.korridor.maxSprung}, reserve ${CONFIG.rock.korridor.reserve}, ` +
      `Feld +-${CONFIG.world.spawnHalfWidth})`,
  );

  for (const [fname, aspect] of formate) {
    // Referenzbreite vorab bestimmen, damit die Streifen im Lauf feststehen.
    const pCfg = { ...CONFIG.player, ...CONFIG.characters.list[AFFE].player };
    const halbRef = spielfeld(aspect, pCfg.hitRadius).spawnHalfWidth;
    const sammel = neuerSammler(halbRef);

    for (let i = 0; i < LAEUFE; i++) {
      lauf({ seed: 1000 + i * 7919, affe: AFFE, aspect, sammel });
    }

    const halb = sammel.halb;
    console.log(
      `\n\n${'='.repeat(78)}\n` +
        `FORMAT ${fname.toUpperCase()}   Abwurfbreite +-${halb.toFixed(2)}   ` +
        `Bewegungsband ${sammel.bounds[0].toFixed(2)} .. ${sammel.bounds[1].toFixed(2)}   ` +
        `Spielzeit ${Math.round(sammel.sekunden)} s\n${'='.repeat(78)}`,
    );

    /* ------------------------------------------------ Objekte (Hindernisse) */
    const hSteine = neuesHisto(KLASSEN);
    for (const x of sammel.steine) eintragen(hSteine, x, halb);
    druckeHisto(`HINDERNISSE — Abwurfposition (n = ${sammel.steine.length})`, hSteine, halb);
    const kz = kennzahlen(sammel.steine, halb);
    console.log(
      `  Mittelwert x = ${kz.mittel.toFixed(3)} (0 = symmetrisch), |x| = ${kz.mittelAbs.toFixed(2)} ` +
        `(gleichverteilt waere ${(halb / 2).toFixed(2)})`,
    );
    console.log(
      `  Mittleres Drittel (|x| <= ${(halb / 3).toFixed(2)}): ` +
        `${(kz.mitteDrittel * 100).toFixed(1)} %  (gleichverteilt: 33.3 %)`,
    );
    console.log(
      `  Mittleres Fuenftel (|x| <= ${(halb / 5).toFixed(2)}): ` +
        `${(kz.mitteFuenftel * 100).toFixed(1)} %  (gleichverteilt: 20.0 %)`,
    );
    console.log(
      `  Mangels Platz ganz entfallen: ${sammel.entfallen} ` +
        `(${((sammel.entfallen / Math.max(1, sammel.entfallen + sammel.steine.length)) * 100).toFixed(1)} %)`,
    );

    /* ----------------------------------------------------------- Sperrzone */
    console.log(
      `\nSPERRZONE (was der Korridor pro Abwurf blockiert):\n` +
        `  Zeitfenster [tEin,tAus] im Mittel ${mittel(sammel.fenster).toFixed(2)} s\n` +
        `  Wanderung der Bahn in diesem Fenster (Spanne): ${mittel(sammel.spannBreite).toFixed(2)}\n` +
        `  Gesperrte Breite im Mittel ${mittel(sammel.sperrBreite).toFixed(2)} ` +
        `von ${(2 * halb).toFixed(2)} = ` +
        `${((mittel(sammel.sperrBreite) / (2 * halb)) * 100).toFixed(0)} % des Feldes\n` +
        `  Freie Restbreite im Mittel ${mittel(sammel.freiBreite).toFixed(2)}`,
    );

    /* --------------------------------------------------------- Bahn-Tempo */
    const tf = sammel.tempo.filter((e) => e.t < 132);
    const ts = sammel.tempo.filter((e) => e.t >= 396);
    const zeig = (label, arr) =>
      arr.length
        ? `  ${label}: erlaubtes Bahn-Tempo ${mittel(arr.map((e) => e.gesamt)).toFixed(2)} Einh./s ` +
          `— Bremsen: Lauftempo ${mittel(arr.map((e) => e.ausLauf)).toFixed(2)}, ` +
          `Fallanteil ${mittel(arr.map((e) => e.ausFall)).toFixed(2)}, ` +
          `Platz ${mittel(arr.map((e) => e.ausPlatz)).toFixed(2)}`
        : '';
    console.log('\nWIE SCHNELL DIE BAHN WANDERN DARF (Spawner.korridorTempo):');
    console.log(zeig('erste Wand ', tf));
    console.log(zeig('ab Wand 3  ', ts));
    if (sammel.drift60.length) {
      console.log(
        `  Ortswechsel der Bahn in 60 s (eine typische Partie): ` +
          `im Mittel ${mittel(sammel.drift60).toFixed(2)} Einheiten ` +
          `bei ${(2 * halb).toFixed(2)} Feldbreite`,
      );
    }

    /* ------------------------------------------------------------- Korridor */
    const hKorr = neuesHisto(KLASSEN);
    for (const x of sammel.korridor) eintragen(hKorr, x, halb);
    druckeHisto(
      `KORRIDOR — wo die freie Bahn steht (zeitgewichtet, ${sammel.korridor.length} Frames)`,
      hKorr,
      halb,
      ' Frames',
    );
    const kzK = kennzahlen(sammel.korridor, halb);
    console.log(
      `  Mittelwert x = ${kzK.mittel.toFixed(3)}, |x| = ${kzK.mittelAbs.toFixed(2)} ` +
        `(gleichverteilt ueber +-${halb.toFixed(2)}: ${(halb / 2).toFixed(2)})`,
    );
    console.log(
      `  Zeitanteil im mittleren Drittel: ${(kzK.mitteDrittel * 100).toFixed(1)} % ` +
        `(gleichverteilt: 33.3 %)`,
    );

    /* -------------------------------- Abstand zur Bahn beim Vorbeifliegen */
    const hRel = neuesHisto(KLASSEN);
    for (const d of sammel.relativ) eintragen(hRel, d, 2 * halb);
    druckeHisto(
      `ABSTAND ZUR BAHN beim Passieren der Spielerhoehe (x_Objekt - x_Bahn, ` +
        `n = ${sammel.relativ.length})`,
      hRel,
      2 * halb,
    );
    const nah = sammel.relativ.filter((d) => Math.abs(d) <= 1.0).length;
    const nah2 = sammel.relativ.filter((d) => Math.abs(d) <= 1.5).length;
    console.log(
      `  Naeher als 1.0 an der Bahn: ${nah} (${((nah / Math.max(1, sammel.relativ.length)) * 100).toFixed(2)} %)  ` +
        `naeher als 1.5: ${nah2} (${((nah2 / Math.max(1, sammel.relativ.length)) * 100).toFixed(2)} %)`,
    );

    /* --------------------------------------------------- Wartezeit Mitte */
    if (sammel.mittePausen.length) {
      const sortiert = [...sammel.mittePausen].sort((a, b) => a - b);
      const p = (q) => sortiert[Math.min(sortiert.length - 1, Math.floor(q * sortiert.length))];
      console.log(
        `\nWARTEZEIT, bis wieder etwas in der MITTE ankommt (|x| <= ${(halb / 5).toFixed(2)}):\n` +
          `  Mittel ${mittel(sammel.mittePausen).toFixed(1)} s, Median ${p(0.5).toFixed(1)} s, ` +
          `p90 ${p(0.9).toFixed(1)} s, laengste ${sortiert[sortiert.length - 1].toFixed(1)} s`,
      );
    }
    if (sammel.randPausen.length) {
      const sortiert = [...sammel.randPausen].sort((a, b) => a - b);
      const p = (q) => sortiert[Math.min(sortiert.length - 1, Math.floor(q * sortiert.length))];
      console.log(
        `WARTEZEIT am RAND (|x| >= ${(halb * 0.6).toFixed(2)}):\n` +
          `  Mittel ${mittel(sammel.randPausen).toFixed(1)} s, Median ${p(0.5).toFixed(1)} s, ` +
          `p90 ${p(0.9).toFixed(1)} s`,
      );
    }

    /* ------------------------------------------------- Muenzen und Bananen */
    if (sammel.muenzen.length) {
      const kzM = kennzahlen(sammel.muenzen, halb);
      console.log(
        `\nMUENZEN (auf der Bahn, n = ${kzM.n}): |x| = ${kzM.mittelAbs.toFixed(2)}, ` +
          `mittleres Drittel ${(kzM.mitteDrittel * 100).toFixed(1)} %`,
      );
    }
    if (sammel.bananen.length) {
      const kzB = kennzahlen(sammel.bananen, halb);
      console.log(
        `BANANEN (auf der Bahn, n = ${kzB.n}): |x| = ${kzB.mittelAbs.toFixed(2)}, ` +
          `mittleres Drittel ${(kzB.mitteDrittel * 100).toFixed(1)} %`,
      );
    }

    /* ------------------------------------------------------- Nach Objektart */
    console.log('\nNACH OBJEKTART:');
    for (const id of Object.keys(sammel.nachArt)) {
      const k = kennzahlen(sammel.nachArt[id], halb);
      console.log(
        `  ${id.padEnd(7)} n=${String(k.n).padStart(6)}  |x| = ${k.mittelAbs.toFixed(2)}  ` +
          `Mitte-Drittel ${(k.mitteDrittel * 100).toFixed(1)} %`,
      );
    }

    /* ------------------------------------- Wie sieht EINE Partie aus? -----
     * Der Mittelwert ueber Stunden kann glatt sein und trotzdem jede einzelne
     * Partie schief: die Bahn wandert langsamer als eine Partie dauert. */
    const PARTIE = 90;
    const fenster = new Map();
    for (const [t, x, nr] of sammel.steineNachZeit) {
      const w = `${nr}:${Math.floor(t / PARTIE)}`;
      (fenster.get(w) ?? fenster.set(w, []).get(w)).push(x);
    }
    let ohneMitte = 0;
    let abdeckungen = [];
    let mittelAnteile = [];
    for (const xs of fenster.values()) {
      if (xs.length < 10) continue;
      const inMitte = xs.filter((x) => Math.abs(x) <= halb / 5).length;
      if (inMitte === 0) ohneMitte++;
      mittelAnteile.push(inMitte / xs.length);
      const belegt = new Set(
        xs.map((x) => Math.min(KLASSEN - 1, Math.floor(((x + halb) / (2 * halb)) * KLASSEN))),
      );
      abdeckungen.push(belegt.size / KLASSEN);
    }
    console.log(
      `\nEINZELNE PARTIE (${PARTIE}-s-Fenster, n = ${mittelAnteile.length}):\n` +
        `  Fenster ganz OHNE Objekt im mittleren Fuenftel: ${ohneMitte} ` +
        `(${((ohneMitte / Math.max(1, mittelAnteile.length)) * 100).toFixed(1)} %)\n` +
        `  Anteil im mittleren Fuenftel je Fenster: ${(mittel(mittelAnteile) * 100).toFixed(1)} % ` +
        `(gleichverteilt: 20.0 %)\n` +
        `  Abgedeckte Klassen je Fenster: ${(mittel(abdeckungen) * 100).toFixed(0)} % der ${KLASSEN}`,
    );

    /* --------------------------------------------------- Frueh gegen spaet */
    const grenze = CONFIG.difficulty.sekundenProWand * 3;
    const frueh = sammel.steineNachZeit.filter(([t]) => t <= grenze).map((e) => e[1]);
    const spaet = sammel.steineNachZeit.filter(([t]) => t > grenze).map((e) => e[1]);
    if (frueh.length && spaet.length) {
      const a = kennzahlen(frueh, halb);
      const b = kennzahlen(spaet, halb);
      console.log(
        `\nFRUEH (bis ${grenze}s) vs SPAET:\n` +
          `  frueh: n=${a.n}  |x|=${a.mittelAbs.toFixed(2)}  Mitte-Drittel ${(a.mitteDrittel * 100).toFixed(1)} %\n` +
          `  spaet: n=${b.n}  |x|=${b.mittelAbs.toFixed(2)}  Mitte-Drittel ${(b.mitteDrittel * 100).toFixed(1)} %`,
      );
    }
  }
}

/* ============================================ Reihe ueber Seitenverhaeltnisse */
console.log(`\n\n${'='.repeat(78)}\nREIHE UEBER DIE SEITENVERHAELTNISSE (${AFFE})\n${'='.repeat(78)}`);
console.log(
  '  Format        Feld    Sperre  frei   Mitte-Drittel  Mitte-Fuenftel  Rand-Klassen  entfallen',
);
const SWEEP = [
  ['21:9  breit', 21 / 9],
  ['16:9  Laptop', 16 / 9],
  ['16:10', 16 / 10],
  ['3:2', 3 / 2],
  ['4:3', 4 / 3],
  ['1:1', 1],
  ['3:4', 3 / 4],
  ['9:16  Handy', 9 / 16],
  ['9:19.5 schmal', 9 / 19.5],
];
for (const [name, aspect] of SWEEP) {
  const pCfg = { ...CONFIG.player, ...CONFIG.characters.list[AFFE].player };
  const halbRef = spielfeld(aspect, pCfg.hitRadius).spawnHalfWidth;
  const sammel = neuerSammler(halbRef);
  const n = NUR_SWEEP ? LAEUFE : Math.max(3, Math.round(LAEUFE / 2));
  for (let i = 0; i < n; i++) lauf({ seed: 4242 + i * 7919, affe: AFFE, aspect, sammel });
  const halb = sammel.halb;
  const kz = kennzahlen(sammel.steine, halb);
  const h = neuesHisto(KLASSEN);
  for (const x of sammel.steine) eintragen(h, x, halb);
  const randAnteil = (h.zaehler[0] + h.zaehler[KLASSEN - 1]) / h.summe;
  console.log(
    `  ${name.padEnd(13)} +-${halb.toFixed(2)}  ` +
      `${mittel(sammel.sperrBreite).toFixed(2).padStart(5)}  ` +
      `${mittel(sammel.freiBreite).toFixed(2).padStart(5)}  ` +
      `${(kz.mitteDrittel * 100).toFixed(1).padStart(8)} %      ` +
      `${(kz.mitteFuenftel * 100).toFixed(1).padStart(6)} %       ` +
      `${(randAnteil * 100).toFixed(1).padStart(5)} %      ` +
      `${((sammel.entfallen / Math.max(1, sammel.entfallen + sammel.steine.length)) * 100).toFixed(1)} %`,
  );
}
console.log(
  '  (gleichverteilt waeren: Mitte-Drittel 33.3 %, Mitte-Fuenftel 20.0 %, ' +
    `Rand-Klassen ${(200 / KLASSEN).toFixed(1)} %)`,
);
console.log('');
