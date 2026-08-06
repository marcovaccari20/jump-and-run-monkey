/**
 * Beweist (oder widerlegt), dass jederzeit eine Lücke zum Durchkommen bleibt.
 *
 * Run mit:  npm run test:fair
 *           node scripts/fairness.mjs --laeufe 40 --sekunden 300 --affe braun
 *
 * WARUM NICHT EINFACH "EINEN BOT SPIELEN LASSEN"
 * Ein Bot, der stirbt, beweist nur, dass DIESER Bot zu dumm war. Ein Bot, der
 * überlebt, beweist nur, dass es diesmal gutging. Beides ist als Garantie
 * wertlos.
 *
 * Stattdessen wird die Menge ALLER Positionen mitgeführt, an denen ein
 * Spieler zu diesem Zeitpunkt überhaupt noch sein könnte, ohne vorher
 * gestorben zu sein — die erreichbare Restmenge:
 *
 *     S(0)     = { Startposition }
 *     S(t+dt)  = ( S(t) um die maximale Schrittweite aufgeweitet )
 *                 ∩ { x : dort steht in diesem Moment kein Objekt }
 *
 * Solange S nicht leer ist, EXISTIERT ein Weg hindurch — unabhängig davon,
 * wie geschickt jemand spielt. Wird S leer, war die Welle nachweislich
 * unausweichlich, und das Skript nennt Sekunde, Wand und die genauen
 * Objektpositionen.
 *
 * WO DAS MODELL STRENGER IST ALS DAS SPIEL
 *  - Der Modellspieler bewegt sich NUR seitlich. Im Spiel kann er zusätzlich
 *    hoch und runter ausweichen — eine Freiheit, die hier verschenkt wird.
 *  - Er sieht nicht in die Zukunft; die Mengenrechnung tut es implizit, aber
 *    nur nach vorne, nie rückwirkend.
 *  - Mit `--steigen ja` wird der volle Kletterschub angerechnet, obwohl der
 *    im Spiel nur bei rein senkrechter Eingabe anliegt. Alles fällt dadurch
 *    schneller als real möglich.
 *
 * WO ES GROSSZÜGIGER WAR — und das war ein Fehler in diesem Kopfkommentar
 * Hier stand früher, das Modell sei "bewusst strenger", ein echter Spieler
 * habe "also mehr Luft, nicht weniger". Ein Prüf-Subagent hat das widerlegt:
 * `aufweiten()` dehnt die Menge jeden Frame sofort um die volle Schrittweite,
 * aus jedem Punkt. Der echte Affe hat aber Trägheit — ein Richtungswechsel
 * kostet Zeit (SpritePlayer: v += (ziel−v)·(1−e^(−rate·dt))). Nachgemessen
 * lag das Modell bis zu 0.28 Einheiten vor der Wirklichkeit.
 *
 * Deshalb wird `--reserve` jetzt NICHT mehr geraten, sondern aus dem
 * Bewegungsmodell hergeleitet (siehe `traegheitsFaktor`): im ungünstigsten
 * Fall fährt der Affe zu Beginn des Zeitfensters noch mit voller Fahrt in die
 * FALSCHE Richtung und muss erst abbremsen. Der Faktor ist genau der Anteil
 * der Höchstgeschwindigkeit, den er unter dieser Annahme im kürzesten
 * relevanten Fenster wirklich schafft. Damit ist die Schrittweite eine untere
 * Schranke und die Aussage wieder gedeckt.
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

const LAEUFE = arg('laeufe', 24);
const SEKUNDEN = arg('sekunden', 300);
const DT = arg('dt', 1 / 60);
/**
 * Welchen Anteil seiner Höchstgeschwindigkeit schafft der Affe im
 * ungünstigsten Fall wirklich?
 *
 * Angenommen wird das Schlimmste: zu Beginn des Fensters fährt er mit voller
 * Fahrt in die FALSCHE Richtung und muss erst abbremsen. Mit dem
 * Bewegungsmodell v(t) = v_max − 2·v_max·e^(−a·t) ergibt das
 *
 *      Strecke(T) = v_max·T − (2·v_max/a)·(1 − e^(−a·T))
 *      Anteil(T)  = 1 − (2/(a·T))·(1 − e^(−a·T))
 *
 * `T` ist das kürzeste Fenster, das im Spiel wirklich vorkommt: der
 * Mindestabstand zweier Ankünfte bei Höchsttempo. Kürzere Fenster gibt es
 * nicht, längere sind günstiger.
 */
function traegheitsFaktor(pCfg) {
  const d = CONFIG.difficulty;
  const T = d.dichte.mindestAbstand / d.tempo.max;
  const a = pCfg.acceleration;
  const anteil = 1 - (2 / (a * T)) * (1 - Math.exp(-a * T));
  return Math.max(0.15, Math.min(1, anteil));
}

// --reserve überschreibt die Herleitung (für Empfindlichkeitsprüfungen).
const RESERVE_ARG = arg('reserve', null);
const AFFE = String(arg('affe', 'alle'));
const FORMAT = String(arg('format', 'beide')); // quer | hoch | beide
const STEIGEN = String(arg('steigen', 'beide')); // ja | nein | beide
const LEISE = process.argv.includes('--leise');
/* Bis die Restmenge aus dem Startpunkt herausgewachsen ist, misst die
 * "engste Durchfahrt" nur die Startbedingung. Erst danach zählt sie. */
const EINSCHWINGEN = arg('einschwingen', 4);
/* Gegenprobe: Korridor aushängen und wieder zufällig verteilen.
 *
 * ACHTUNG, HIER STAND EINE FALSCHE ZUSAGE. Der Kommentar behauptete, das
 * falle "zuverlässig" durch. Ein Prüf-Subagent hat gezeigt: über 120 s
 * besteht es, erst ab etwa 365 s (Hochformat) fällt es durch. Wer kurz misst,
 * bekommt also grünes Licht von einem Prüfer, der in diesem Moment gar nichts
 * prüft — die gefährlichste Sorte Test.
 *
 * Seit die Objekte einzeln kommen, besteht die Gegenprobe sogar dauerhaft:
 * bei rund zwei Objekten im Bild sperrt einen auch blindes Verteilen kaum je
 * ein. Aussagekräftig ist sie nur noch zusammen mit --dichte und
 * --ohne-abstand (siehe README, Tabelle "Zwei Sicherungen"). */
const ZUFALL = process.argv.includes('--zufall');
/* Auch die Einzel-Regel aushaengen. Erst damit laesst sich pruefen, was der
 * KORRIDOR allein beitraegt — die Abstandsregel greift auf die echten
 * Bildhoehen zurueck und ist per Config gar nicht abschaltbar. */
const OHNE_ABSTAND = process.argv.includes('--ohne-abstand');
/* Dichte künstlich hochdrehen (--dichte 6).
 *
 * NÖTIG FÜR DIE GEGENPROBE. Seit die Objekte einzeln kommen, sind im Normal-
 * betrieb nur rund zwei gleichzeitig im Bild — da sperrt einen auch blindes
 * Verteilen kaum je ein, und `--zufall` besteht dann ebenfalls. Der Prüfer
 * unterscheidet bei dieser Dichte also nicht mehr, was er messen soll.
 * Unter Last trennt er wieder sauber: mit Korridor bestanden, ohne
 * durchgefallen. */
const DICHTE = arg('dichte', 1);
if (DICHTE !== 1) {
  CONFIG.difficulty.dichte.start *= DICHTE;
  // Der Deckel haengt am Mindestabstand und wuerde die Erhoehung sofort
  // wieder auffressen — fuer die Gegenprobe muss auch er weichen.
  CONFIG.difficulty.dichte.auslastung *= DICHTE;
  CONFIG.difficulty.dichte.mindestAbstand /= DICHTE;
  CONFIG.difficulty.dichte.luft = 0;
}
/* Auf welchen Höhen der Affe geprüft wird. Standard: das ganze Bewegungsband
 * von unten bis oben, plus die Startlinie. Oben ist es am härtesten — dort
 * ist ein Objekt schon gefährlich, kurz nachdem es sichtbar wurde. */
const HOEHEN =
  String(arg('hoehe', 'band')) === 'band'
    ? [CONFIG.world.bounds.minY, -1.4, 0, 1.4, CONFIG.world.bounds.maxY]
    : [Number(arg('hoehe', -1.4))];

/* ============================================================ Zufall (fest) */

/** mulberry32 — reproduzierbar, damit ein Fehlschlag nachstellbar bleibt. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ==================================================== Intervallmengen (1D) */

/** Sortiert, verschmilzt Überlappungen, wirft Nullbreiten weg. */
function ordnen(mengen) {
  if (mengen.length === 0) return mengen;
  mengen.sort((p, q) => p[0] - q[0]);
  const out = [mengen[0]];
  for (let i = 1; i < mengen.length; i++) {
    const letzte = out[out.length - 1];
    if (mengen[i][0] <= letzte[1] + 1e-9) {
      if (mengen[i][1] > letzte[1]) letzte[1] = mengen[i][1];
    } else {
      out.push(mengen[i]);
    }
  }
  return out;
}

/** Jedes Intervall um d nach beiden Seiten aufweiten (= Spieler bewegt sich). */
function aufweiten(mengen, d, lo, hi) {
  const out = [];
  for (const [a, b] of mengen) {
    const na = Math.max(lo, a - d);
    const nb = Math.min(hi, b + d);
    if (nb > na - 1e-9) out.push([na, nb]);
  }
  return ordnen(out);
}

/** Verbotene Bereiche herausschneiden. */
function abziehen(mengen, verboten) {
  let aktuell = mengen;
  for (const [va, vb] of verboten) {
    const naechste = [];
    for (const [a, b] of aktuell) {
      if (vb <= a || va >= b) {
        naechste.push([a, b]);
        continue;
      }
      if (va > a) naechste.push([a, Math.min(va, b)]);
      if (vb < b) naechste.push([Math.max(vb, a), b]);
    }
    aktuell = naechste;
  }
  return aktuell.filter(([a, b]) => b - a > 1e-9);
}

const breiteste = (mengen) => mengen.reduce((m, [a, b]) => Math.max(m, b - a), 0);

/* =========================================================== Spielfeldmasse */

/**
 * Baut `worldView` genau so, wie Game._updateWorldBounds es zur Laufzeit tut —
 * inklusive der Verengung im Hochformat, wo nur noch ca. ±2 Einheiten
 * Spielfeld bleiben. Genau dort ist die Lücke am schwersten unterzubringen.
 */
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

/* ================================================================= Ein Lauf */

function lauf({ seed, affe, aspect, steigt, hoehe }) {
  const echterZufall = Math.random;
  Math.random = rng(seed);

  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const hitRadius = pCfg.hitRadius;
    const ignoreR = charCfg.ignoreRockRadius ?? 0;

    const world = spielfeld(aspect, hitRadius);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);

    const szene = { add() {} };
    const spawner = new Spawner(szene, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false; // Bananen helfen nur, sie stören nie
    spawner.setSpieler(pCfg);
    spawner.reset();

    /* GEGENPROBE (--zufall)
     * Der Korridor wird ausgehängt und wieder gleichverteilt gewürfelt — also
     * genau das Verhalten von vor dieser Änderung. Ein Prüfer, der nichts
     * durchfallen lässt, prüft nichts; dieser Schalter zeigt, dass er es tut.
     */
    if (ZUFALL) {
      spawner._freieStelle = () => (Math.random() * 2 - 1) * world.spawnHalfWidth;
    }
    if (OHNE_ABSTAND) {
      spawner._darfFallen = () => true;
    }

    /* Der Modellspieler hält seine Höhe und bewegt sich nur seitlich.
     *
     * Das ist die Existenzaussage, um die es geht: WENN es eine Strategie
     * gibt, die überlebt, ist das Spiel fair. Höhe halten und der Bahn folgen
     * IST eine solche Strategie — der echte Spieler hat mit der vertikalen
     * Bewegung nur eine Freiheit mehr, die er nicht braucht.
     *
     * Geprüft wird trotzdem auf mehreren Höhen (--hoehe): fiele die Garantie
     * schon beim Verlassen der Startlinie, wäre sie zwar formal gültig, aber
     * praktisch wertlos. */
    const py = hoehe ?? (pCfg.startPosition ?? CONFIG.player.startPosition)[1];
    // Schrittweite als untere Schranke: hergeleitet, nicht geraten.
    const reserve = RESERVE_ARG ?? traegheitsFaktor(pCfg);
    const schritt = pCfg.moveSpeed * reserve * DT;

    let S = [[0, 0]];
    let engste = Infinity;
    let engsteZeit = 0;
    let engsteStufe = '';

    const frames = Math.round(SEKUNDEN / DT);
    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;

      // Genau wie Game._updatePlaying: "W" zahlt auf die Scrollgeschwindigkeit
      // ein, die Objekte kommen dadurch SCHNELLER. Das ist der ungünstigere
      // Fall und wird deshalb mitgeprüft.
      const base = difficulty.scrollSpeed;
      const assisted = base + (steigt ? pCfg.climbAssist : 0);
      const scroll = Math.max(assisted, base * pCfg.minScrollFactor);

      spawner.hazardLook = stufeBei(t).hazard;

      // 1) Spieler zieht (Reichweite wächst)
      S = aufweiten(S, schritt, world.bounds.minX, world.bounds.maxX);

      // 2) Objekte fallen / neue entstehen
      spawner.update(DT, false, scroll);

      // 3) Was jetzt belegt ist, fällt aus der Restmenge heraus
      const verboten = [];
      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        if (r.radius <= ignoreR) continue; // oranger Affe prallt daran ab
        const R = hitRadius + r.hitRadius;
        const dy = py - r.y;
        const rest = R * R - dy * dy;
        if (rest <= 0) continue; // vertikal zu weit weg
        const halb = Math.sqrt(rest);
        verboten.push([r.x - halb, r.x + halb]);
      }
      S = abziehen(S, verboten);

      // Die Restmenge startet als PUNKT (der Affe steht ja an einer Stelle)
      // und weitet sich erst auf. Die ersten Sekunden sagen deshalb nichts
      // über die Enge des Feldes aus — nur über die Startbedingung.
      const breite = breiteste(S);
      if (t > EINSCHWINGEN && breite < engste) {
        engste = breite;
        engsteZeit = t;
        engsteStufe = stufeBei(t).name;
      }

      if (S.length === 0) {
        return {
          ok: false,
          seed,
          affe,
          aspect,
          steigt,
          zeit: t,
          stufe: stufeBei(t).name,
          dichte: +difficulty.dichte.toFixed(2),
          objekte: spawner.rocks.active
            .filter((r) => Math.abs(r.y - py) < 2)
            .map((r) => ({ x: +r.x.toFixed(2), y: +r.y.toFixed(2), art: r.type.id }))
            .sort((a, b) => a.x - b.x),
          feld: [+world.bounds.minX.toFixed(2), +world.bounds.maxX.toFixed(2)],
        };
      }
    }

    return { ok: true, seed, affe, aspect, steigt, engste, engsteZeit, engsteStufe };
  } finally {
    Math.random = echterZufall;
  }
}

/* =================================================================== Lauf */

const AFFEN = AFFE === 'alle' ? Object.keys(CONFIG.characters.list) : [AFFE];
const FORMATE = {
  quer: 16 / 9,
  hoch: 9 / 19.5, // schmales Handy — hier ist am wenigsten Platz
};
const formate = FORMAT === 'beide' ? Object.entries(FORMATE) : [[FORMAT, FORMATE[FORMAT]]];
const steigen = STEIGEN === 'beide' ? [false, true] : [STEIGEN === 'ja'];

console.log(
  `Fairness-Prüfung — ${LAEUFE} Läufe à ${SEKUNDEN}s, ` +
    `Affen: ${AFFEN.join('/')}, Formate: ${formate.map(([n]) => n).join('/')}, ` +
    `Schrittweite ${RESERVE_ARG ?? 'hergeleitet aus der Trägheit'}\n`,
);

let gepruef = 0;
let durchgefallen = 0;
const fehler = [];
let globalEngste = Infinity;
let globalEngsteInfo = null;

for (const affe of AFFEN) {
  for (const [fname, aspect] of formate) {
    for (const steigt of steigen) {
      let engsteHier = Infinity;
      let engsteInfo = null;

      for (let i = 0; i < LAEUFE; i++) {
        // Höhen durchwechseln statt sie zu multiplizieren: bei genug Läufen
        // kommt jede oft genug dran, und die Laufzeit bleibt beherrschbar.
        const hoehe = HOEHEN[i % HOEHEN.length];
        const r = lauf({ seed: 1000 + i * 7919, affe, aspect, steigt, hoehe });
        gepruef++;
        if (!r.ok) {
          durchgefallen++;
          if (fehler.length < 6) fehler.push(r);
        } else if (r.engste < engsteHier) {
          engsteHier = r.engste;
          engsteInfo = r;
        }
      }

      if (engsteInfo && engsteHier < globalEngste) {
        globalEngste = engsteHier;
        globalEngsteInfo = { ...engsteInfo, format: fname };
      }

      /* Die Zahl ist die Breite der noch möglichen MITTELPUNKTE, nicht der
       * Lücke: die beiden Trefferradien sind darin schon abgezogen. Sie sagt
       * also, wie weit man von der idealen Linie abweichen darf und trotzdem
       * durchkommt — der Spielraum. Alles über 0 ist passierbar; wieviel
       * darüber, entscheidet, ob es sich fair oder nach Millimeterarbeit
       * anfühlt. Unter etwa 0.2 wird es hart. */
      console.log(
        `  ${affe.padEnd(7)} ${fname.padEnd(5)} ${(steigt ? 'W gedrückt' : 'ohne W').padEnd(11)} ` +
          `engster Spielraum ${engsteHier === Infinity ? '   —  ' : engsteHier.toFixed(3)} ` +
          `${engsteInfo ? `bei ${engsteInfo.engsteZeit.toFixed(0)}s / ${engsteInfo.engsteStufe}` : ''}`,
      );
    }
  }
}

console.log('');
if (durchgefallen === 0) {
  console.log(`BESTANDEN — ${gepruef} Läufe, in keinem einzigen Frame war das Feld dicht.`);
  if (globalEngsteInfo) {
    console.log(
      `Engster Moment über alle Läufe: ${globalEngste.toFixed(3)} Einheiten ` +
        `bei ${globalEngsteInfo.engsteZeit.toFixed(0)}s (${globalEngsteInfo.engsteStufe}, ` +
        `${globalEngsteInfo.format}, ${globalEngsteInfo.affe}).`,
    );
  }
  process.exit(0);
} else {
  console.log(`DURCHGEFALLEN — ${durchgefallen} von ${gepruef} Läufen hatten eine dichte Wand.\n`);
  for (const f of fehler) {
    console.log(
      `  Seed ${f.seed}  ${f.affe}/${f.aspect === 16 / 9 ? 'quer' : 'hoch'}` +
        `${f.steigt ? '/W' : ''}  bei ${f.zeit.toFixed(1)}s  Wand "${f.stufe}"  Dichte ${f.dichte}/s`,
    );
    console.log(`    Feld ${f.feld[0]} … ${f.feld[1]}`);
    console.log(
      `    Objekte auf Spielerhöhe: ${f.objekte.map((o) => `${o.art[0]}@${o.x}`).join('  ')}`,
    );
    if (!LEISE) {
      // Lücken zwischen den Objekten ausrechnen — zeigt sofort, wo es klemmt.
      const luecken = [];
      for (let i = 1; i < f.objekte.length; i++) {
        luecken.push((f.objekte[i].x - f.objekte[i - 1].x).toFixed(2));
      }
      if (luecken.length) console.log(`    Abstände: ${luecken.join(' ')}`);
    }
    console.log('');
  }
  process.exit(1);
}
