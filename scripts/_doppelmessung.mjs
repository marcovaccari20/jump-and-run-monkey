/**
 * Wie oft kommen zwei Objekte GLEICHZEITIG, und auf welchen Bahnen?
 *
 *   node scripts/_doppelmessung.mjs [minuten]
 *
 * Misst am echten Spawner, kopflos. Gezählt wird an der Spawn-METHODE, nicht
 * über die Objekte — die sind gepoolt, ein Objektzähler liefert höchstens
 * poolSize verschiedene und damit Unsinn.
 *
 * Geprüft wird dreierlei:
 *   1. Anteil der Abwürfe, bei denen zwei gleichzeitig fallen — und ob er
 *      wie geplant mit der Spielzeit wächst.
 *   2. Ob die beiden wirklich auf VERSCHIEDENEN Bahnen liegen.
 *   3. Ob je Bahn ungefähr gleich viel herunterkommt (die Klage war, dass es
 *      immer nur auf einer Seite kommt).
 */
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';

const MINUTEN = Number(process.argv[2] ?? 15);
const DT = 1 / 60;

/* Welt wie im Hochformat eines Handys (9:19.5) — dort ist es am engsten. */
const halbFeld = 1.611;
const world = {
  bounds: { minX: -halbFeld, maxX: halbFeld, minY: -2.9, maxY: 2.7 },
  bahnen: CONFIG.world.bahnen,
  bahnX: CONFIG.world.bahnen.map((a) => a * halbFeld),
  spawnY: 6,
  despawnY: -5.6,
  spawnHalfWidth: halbFeld + 0.8,
};

const difficulty = new DifficultyCurve(CONFIG.difficulty);
difficulty.setRockMix(CONFIG.rock.mix);

const scene = { add() {} };
const spawner = new Spawner(scene, CONFIG, difficulty, world, new Map(), null, null);
spawner.setSpieler(CONFIG.characters.list.braun.player);

/* Mitschreiben, WANN und WOHIN abgeworfen wird. */
const abwuerfe = [];
const echt = spawner.rocks.acquire.bind(spawner.rocks);
let jetzt = 0;
spawner.rocks.acquire = function () {
  const r = echt();
  if (r) {
    const spawnEcht = r.spawn.bind(r);
    r.spawn = function (type, look, x, ...rest) {
      abwuerfe.push({ t: jetzt, x: Math.round(x * 1000) / 1000 });
      return spawnEcht(type, look, x, ...rest);
    };
  }
  return r;
};

const stufeBei = (t) => {
  const s = CONFIG.wall.stages;
  let n = s[0];
  for (const st of s) if (t >= st.afterSeconds) n = st;
  return n.hazard;
};

const schritte = Math.round(MINUTEN * 60 * 60);
for (let i = 0; i < schritte; i++) {
  jetzt = i * DT;
  difficulty.update(DT);
  spawner.hazardLook = stufeBei(difficulty.elapsed);
  spawner.update(DT, false, world);
}

/* --- Auswertung --------------------------------------------------------- */

// Gleichzeitig = im selben Frame abgeworfen.
const proZeit = new Map();
for (const a of abwuerfe) {
  const k = a.t.toFixed(4);
  if (!proZeit.has(k)) proZeit.set(k, []);
  proZeit.get(k).push(a.x);
}

let einzel = 0;
let doppel = 0;
let gleicheBahn = 0;
const proBahn = new Map();
const doppelNachWand = new Map();

for (const [k, xs] of proZeit) {
  if (xs.length === 1) einzel++;
  else {
    doppel++;
    if (new Set(xs).size < xs.length) gleicheBahn++;
    const wand = Math.floor(Number(k) / CONFIG.difficulty.sekundenProWand);
    doppelNachWand.set(wand, (doppelNachWand.get(wand) ?? 0) + 1);
  }
  for (const x of xs) proBahn.set(x, (proBahn.get(x) ?? 0) + 1);
}

const gesamt = einzel + doppel;
console.log(`${MINUTEN} Minuten Spielzeit, Hochformat 9:19.5, brauner Affe\n`);
console.log(`Abwurf-Momente: ${gesamt}   Objekte: ${abwuerfe.length}`);
console.log(`  davon einzeln:      ${einzel}  (${((100 * einzel) / gesamt).toFixed(1)} %)`);
console.log(`  davon zwei zugleich: ${doppel}  (${((100 * doppel) / gesamt).toFixed(1)} %)`);
console.log(`  zwei auf DERSELBEN Bahn (waere ein Fehler): ${gleicheBahn}`);

console.log('\nVerteilung auf die Bahnen:');
const bahnen = [...proBahn.entries()].sort((a, b) => a[0] - b[0]);
for (const [x, n] of bahnen) {
  console.log(
    `  x=${String(x).padStart(7)}: ${String(n).padStart(4)}  ` +
      `${((100 * n) / abwuerfe.length).toFixed(1).padStart(5)} %  ` +
      '#'.repeat(Math.round((40 * n) / abwuerfe.length)),
  );
}

console.log('\nDoppelabwuerfe je Wand (sollen mit der Zeit zunehmen):');
const wände = [...doppelNachWand.entries()].sort((a, b) => a[0] - b[0]);
for (const [w, n] of wände) {
  console.log(`  Wand ${String(w).padStart(2)}: ${String(n).padStart(3)}  ` + '#'.repeat(Math.min(50, n)));
}
