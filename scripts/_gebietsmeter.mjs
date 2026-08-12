/**
 * Wie viele METER ist jedes Gebiet lang?
 *
 * Die Gebiete sind in SEKUNDEN definiert (CONFIG.wall.stages[].afterSeconds),
 * das Tempo wächst aber mit jeder Wand. Gleiche Sekunden heissen deshalb
 * immer mehr Meter — und genau das ist die Frage: wie weit läuft das
 * auseinander?
 *
 *   node scripts/_gebietsmeter.mjs
 *   node scripts/_gebietsmeter.mjs --ziel 150 200
 *
 * Mit --ziel wird ausgerechnet, welche afterSeconds nötig wären, damit jedes
 * Gebiet zwischen den beiden Metervorgaben liegt.
 */
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';

const DT = 0.001;

/** Höhe (Meter) nach t Sekunden — Integral der Scrollgeschwindigkeit. */
function hoeheBei(t) {
  const d = new DifficultyCurve(CONFIG.difficulty);
  let h = 0;
  while (d.elapsed < t) {
    h += d.scrollSpeed * DT;
    d.update(DT);
  }
  return h;
}

/** Sekunde, bei der die Höhe `m` erreicht ist. */
function zeitFuer(m) {
  const d = new DifficultyCurve(CONFIG.difficulty);
  let h = 0;
  while (h < m && d.elapsed < 9000) {
    h += d.scrollSpeed * DT;
    d.update(DT);
  }
  return d.elapsed;
}

const args = process.argv.slice(2);
const zi = args.indexOf('--ziel');
const zielMin = zi >= 0 ? Number(args[zi + 1]) : null;
const zielMax = zi >= 0 ? Number(args[zi + 2] ?? args[zi + 1]) : null;

const stages = CONFIG.wall.stages;

console.log('IST-ZUSTAND — Gebiete in Sekunden definiert:\n');
console.log('  Nr  Name        ab s    Dauer s   ab m      Länge m   Tempo m/s');
let vorher = 0;
let vorherM = 0;
for (let i = 0; i < stages.length; i++) {
  const ab = stages[i].afterSeconds;
  const ende = stages[i + 1]?.afterSeconds ?? ab + CONFIG.wall.stageLoopSeconds;
  const abM = hoeheBei(ab);
  const endeM = hoeheBei(ende);
  const d = new DifficultyCurve(CONFIG.difficulty);
  d.elapsed = ab;
  console.log(
    `  ${String(i + 1).padStart(2)}  ${stages[i].name.padEnd(10)} ` +
      `${String(ab).padStart(5)}  ${String(ende - ab).padStart(6)}   ` +
      `${abM.toFixed(0).padStart(6)}  ${(endeM - abM).toFixed(0).padStart(8)}   ` +
      `${d.scrollSpeed.toFixed(2).padStart(6)}`,
  );
  vorher = ende;
  vorherM = endeM;
}
console.log(`\n  Gesamt bis Ende Gebiet 16: ${vorherM.toFixed(0)} m in ${vorher} s`);

if (zielMin) {
  console.log(`\n\nSOLL — jedes Gebiet ${zielMin} bis ${zielMax} m:\n`);
  /* Abwechselnde Längen statt einer festen Zahl: sonst fühlt sich jedes
   * Gebiet gleich an. Die Folge wiederholt sich alle sechs Gebiete und
   * bleibt dabei immer zwischen den Vorgaben. */
  const muster = [1.0, 0.36, 0.72, 0.14, 0.9, 0.5, 0.24, 0.82];
  const laengen = [];
  for (let i = 0; i < stages.length; i++) {
    const f = muster[i % muster.length];
    laengen.push(Math.round(zielMin + (zielMax - zielMin) * f));
  }
  // Gebiet 1 bleibt der kurze Einstieg.
  laengen[0] = 100;

  let summe = 0;
  const sekunden = [0];
  console.log('  Nr  Name         Länge m   ab m     afterSeconds   Dauer s');
  for (let i = 0; i < stages.length; i++) {
    const abM = summe;
    summe += laengen[i];
    const s = i === 0 ? 0 : Math.round(zeitFuer(abM) * 10) / 10;
    if (i > 0) sekunden.push(s);
    console.log(
      `  ${String(i + 1).padStart(2)}  ${stages[i].name.padEnd(10)} ` +
        `${String(laengen[i]).padStart(7)}  ${abM.toFixed(0).padStart(6)}   ` +
        `${String(s).padStart(10)}   ${(i > 0 ? (s - sekunden[i - 1]).toFixed(1) : '—').padStart(7)}`,
    );
  }
  const letzteSek = zeitFuer(summe);
  console.log(`\n  Ende Gebiet 16 bei ${summe} m nach ${letzteSek.toFixed(1)} s`);
  console.log(`  (heute: ${vorherM.toFixed(0)} m nach ${vorher} s)`);
  console.log('\n  afterSeconds-Werte:');
  console.log('  ' + JSON.stringify(sekunden));
  // Wie lang wäre eine Gebietsrunde nach dem letzten (zyklisch)?
  const schleifeM = laengen[laengen.length - 1];
  console.log(`\n  stageLoopSeconds sollte ~${(zeitFuer(summe + schleifeM) - letzteSek).toFixed(0)} s sein (${schleifeM} m beim dortigen Tempo)`);
}
