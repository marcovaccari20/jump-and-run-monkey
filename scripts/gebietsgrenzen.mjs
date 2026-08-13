/**
 * Rechnet die Gebietsgrenzen (CONFIG.wall.stages[].afterSeconds) so aus, dass
 * jedes Gebiet eine vorgegebene Länge in METERN hat — und schreibt sie in
 * src/config.js.
 *
 *     node scripts/gebietsgrenzen.mjs            nur rechnen und zeigen
 *     node scripts/gebietsgrenzen.mjs --schreiben  auch eintragen
 *
 * WARUM DAS ITERIEREN MUSS
 *
 * Seit die Schwierigkeit an den Gebieten hängt (DifficultyCurve.wand liest
 * CONFIG.difficulty.gebietsGrenzen), beisst sich die Katze in den Schwanz:
 *
 *     Grenzen  ->  Härtekurve  ->  Scrollgeschwindigkeit  ->  Meter je
 *     Sekunde  ->  andere Grenzen
 *
 * Einmal rechnen genügt deshalb nicht. Der Durchgang wird wiederholt, bis
 * sich keine Grenze mehr um mehr als `GENAU` Sekunden verschiebt. In der
 * Praxis sind das drei bis fünf Runden.
 *
 * WARUM METER UND NICHT SEKUNDEN
 * Der Spieler sieht Meter — sie stehen im Bild und sind das Ergebnis des
 * Laufs. Gleiche Sekunden bedeuten bei steigendem Tempo immer mehr Meter;
 * ein spätes Gebiet wäre dann doppelt so lang wie ein frühes, ohne dass es
 * jemand so entschieden hätte.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PFAD = resolve(__dirname, '../src/config.js');

const DT = 0.002;
const GENAU = 0.05; // Sekunden — darunter gilt es als eingerastet
const MAX_RUNDEN = 40;

/* Sollänge je Gebiet in Metern.
 *
 * Gebiet 1 ist kurz (100 m): dort lernt man die Steuerung, und ein langes
 * Einstiegsgebiet hält gute Spieler nur auf. Danach schwanken die Längen
 * zwischen 150 und 200 m — gleich lange Gebiete lesen sich als Fliessband,
 * die Schwankung macht den Wechsel zum Ereignis. Das Muster wiederholt sich,
 * damit es bei mehr Gebieten ohne Nachpflege weitergeht. */
const MUSTER = [168, 186, 157, 195, 175, 162, 191, 200];
const ERSTES = 100;

const sollMeter = (i) => (i === 0 ? ERSTES : MUSTER[(i - 1) % MUSTER.length]);

/**
 * Grenzen für EINEN Durchgang: simuliert die Kurve mit den gerade geltenden
 * Grenzen und schneidet dort, wo die Sollmeter erreicht sind.
 *
 * @param {number[]} grenzen  die aktuell angenommenen Grenzen
 * @param {number}   anzahl   wie viele Gebiete
 */
function einDurchgang(grenzen, anzahl) {
  const cfg = { ...CONFIG.difficulty, gebietsGrenzen: grenzen };
  const d = new DifficultyCurve(cfg);
  d.setRockMix?.(CONFIG.rock.mix);

  const neu = [0];
  let hoehe = 0;
  let ziel = sollMeter(0);

  while (neu.length < anzahl && d.elapsed < 20000) {
    hoehe += d.scrollSpeed * DT;
    d.update(DT);
    if (hoehe >= ziel) {
      neu.push(Math.round(d.elapsed * 10) / 10);
      ziel += sollMeter(neu.length - 1);
    }
  }
  while (neu.length < anzahl) neu.push(neu[neu.length - 1] + 20);
  return neu;
}

const stages = CONFIG.wall.stages;
let grenzen = stages.map((s) => s.afterSeconds ?? 0);
let runde = 0;
let abweichung = Infinity;

while (runde < MAX_RUNDEN && abweichung > GENAU) {
  const neu = einDurchgang(grenzen, stages.length);
  abweichung = Math.max(...neu.map((v, i) => Math.abs(v - grenzen[i])));
  grenzen = neu;
  runde++;
}

console.log(
  abweichung <= GENAU
    ? `Eingerastet nach ${runde} Runden (letzte Verschiebung ${abweichung.toFixed(2)} s).`
    : `ACHTUNG: nach ${MAX_RUNDEN} Runden noch ${abweichung.toFixed(2)} s Verschiebung — schwingt.`,
);

/* Kontrollrechnung mit den gefundenen Grenzen: stimmen die Meter wirklich? */
const pruef = new DifficultyCurve({ ...CONFIG.difficulty, gebietsGrenzen: grenzen });
const hoehen = [];
let h = 0;
let k = 0;
while (k < grenzen.length && pruef.elapsed < 20000) {
  if (pruef.elapsed >= grenzen[k]) {
    hoehen.push(h);
    k++;
    continue;
  }
  h += pruef.scrollSpeed * DT;
  pruef.update(DT);
}

console.log('');
console.log('  Nr  Name         ab s     Dauer s    Länge m   Soll   Tempo');
for (let i = 0; i < stages.length; i++) {
  const dauer = i === 0 ? 0 : grenzen[i] - grenzen[i - 1];
  const laenge = i === 0 ? 0 : (hoehen[i] ?? 0) - (hoehen[i - 1] ?? 0);
  const d = new DifficultyCurve({ ...CONFIG.difficulty, gebietsGrenzen: grenzen });
  d.elapsed = grenzen[i] + 0.01;
  console.log(
    `  ${String(i + 1).padStart(2)}  ${stages[i].name.padEnd(11)}` +
      `${grenzen[i].toFixed(1).padStart(7)}` +
      `${(i === 0 ? '—' : dauer.toFixed(1)).padStart(10)}` +
      `${(i === 0 ? '—' : Math.round(laenge)).toString().padStart(10)}` +
      `${(i === 0 ? ERSTES : sollMeter(i - 1)).toString().padStart(7)}` +
      `${d.tempo.toFixed(1).padStart(8)}`,
  );
}
console.log('');
console.log(`  Gesamtzeit bis ins letzte Gebiet: ${(grenzen[grenzen.length - 1] / 60).toFixed(1)} min`);
console.log(`  afterSeconds: [${grenzen.join(', ')}]`);

/* ------------------------------------------------------------- Schreiben */
if (process.argv.includes('--schreiben')) {
  let text = readFileSync(CONFIG_PFAD, 'utf8');
  let ersetzt = 0;

  for (let i = 0; i < stages.length; i++) {
    /* Gezielt ersetzen: der Name steht IMMER unmittelbar vor afterSeconds im
     * selben Objekt. Ohne diesen Anker träfe ein blosses /afterSeconds: …/
     * auch Zahlen in Kommentaren oder in anderen Abschnitten. */
    const muster = new RegExp(
      `(name: '${stages[i].name}',[\\s\\S]{0,200}?afterSeconds: )([0-9.]+)`,
    );
    if (!muster.test(text)) {
      console.error(`  KEIN TREFFER für Gebiet '${stages[i].name}' — nichts geschrieben.`);
      process.exit(1);
    }
    text = text.replace(muster, `$1${grenzen[i]}`);
    ersetzt++;
  }

  writeFileSync(CONFIG_PFAD, text);
  console.log(`\n  ${ersetzt} Grenzen in src/config.js eingetragen.`);
}
