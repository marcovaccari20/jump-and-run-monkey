/**
 * Zeigt, was jede Wand konkret bedeutet.
 *
 * Run mit:  npm run balance
 *
 * Die Schwierigkeit ist eine Formel (CONFIG.difficulty), keine Tabelle — das
 * hält sie konsistent, macht sie aber schlecht lesbar. Dieses Skript rechnet
 * sie aus, damit man beim Justieren sieht, was man tut, statt zu raten.
 *
 * Die letzte Spalte ist die wichtigste: VORWARNUNG. So lange bleibt zwischen
 * "Objekt wird sichtbar" und "Objekt wird gefährlich". Fällt sie unter etwa
 * 0.3 s, ist Ausweichen kein Können mehr, sondern Reflex-Glücksspiel — dann
 * gehört CONFIG.difficulty.tempo.max heruntergesetzt, nicht die Dichte.
 */
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';

const d = new DifficultyCurve(CONFIG.difficulty);
d.setRockMix(CONFIG.rock.mix);

const stages = CONFIG.wall.stages;

/* DIE TABELLE MUSS AN DEN ECHTEN GEBIETSGRENZEN ABTASTEN.
 *
 * Hier stand `const proWand = CONFIG.difficulty.sekundenProWand` (132) und
 * unten `d.elapsed = i * proWand`. Seit die Härte an den Gebieten hängt, ist
 * sekundenProWand nur noch Rückfall und im Spiel nie in Gebrauch — dieses
 * Werkzeug tastete die Kurve also bei 0/132/264/… ab und klebte die
 * Gebietsnamen darauf, während die echten Grenzen bei 0/54.9/140.7/… liegen.
 *
 * Die Folge war kein Schönheitsfehler, sondern ein falscher Tacho: Zeile
 * "eiszeit" zeigte "ab 1056 s, Tempo am Anschlag", in Wirklichkeit beginnt
 * eiszeit bei 565.7 s mit Tempo 7.5 und weit vom Anschlag entfernt. Die
 * Druckschritte las man als +25/+21/+23/… — echt sind es zwanzigmal
 * dieselben +11.5 %. Ab Zeile 8 lagen alle Zeilen jenseits des letzten
 * Gebiets, zeigten also die Wiederholungsschleife unter fremdem Namen.
 *
 * Wer die Schwierigkeit mit diesem Werkzeug justiert hat, justierte blind. */
const GRENZEN = CONFIG.difficulty.gebietsGrenzen ?? null;
const WAENDE = Number(process.argv[2] ?? stages.length + 4);

/** Sekunde, bei der Gebiet `i` beginnt (auch über die letzte Grenze hinaus). */
function beginnVon(i) {
  if (!GRENZEN?.length) return i * CONFIG.difficulty.sekundenProWand;
  if (i < GRENZEN.length) return GRENZEN[i];
  // Nachlauf: mit der Länge des letzten Gebiets weiterzählen.
  const letzte = GRENZEN.length - 1;
  const takt = letzte > 0 ? GRENZEN[letzte] - GRENZEN[letzte - 1] : CONFIG.difficulty.sekundenProWand;
  return GRENZEN[letzte] + (i - letzte) * takt;
}

const laengen = stages.map((_, i) => (i === 0 ? 0 : beginnVon(i) - beginnVon(i - 1))).slice(1);
console.log(
  `Schwierigkeit: ${CONFIG.difficulty.proWand}x je GEBIET, ` +
    `Gebiete ${Math.min(...laengen).toFixed(0)}–${Math.max(...laengen).toFixed(0)}s lang, ` +
    `Tempo gedeckelt bei ${CONFIG.difficulty.tempo.max}\n`,
);
console.log(
  '  #  Wand           ab      Härte   Tempo  Scroll   Obj/s  Abstand  Vorwarn   Δ Druck',
);
console.log('  ' + '─'.repeat(94));

let vorDruck = null;
for (let i = 0; i < WAENDE; i++) {
  d.elapsed = beginnVon(i) + 0.001;
  const name = stages[i % stages.length]?.name ?? '—';
  const zyklus = i >= stages.length ? ' (Runde 2+)' : '';
  const druck = d.tempo * d.dichte;
  const delta = vorDruck ? `+${(((druck / vorDruck) - 1) * 100).toFixed(0)}%` : '—';
  vorDruck = druck;

  const warn = d.vorwarnung(CONFIG.player.startPosition[1], CONFIG.player.hitRadius + 0.636);

  console.log(
    `  ${String(i).padStart(2)}  ${(name + zyklus).padEnd(14)} ` +
      `${String(Math.round(beginnVon(i))).padStart(4)}s  ` +
      `${d.haerte.toFixed(2).padStart(7)}  ` +
      `${d.tempo.toFixed(2).padStart(5)}  ` +
      `${d.scrollSpeed.toFixed(2).padStart(6)}  ` +
      `${d.dichte.toFixed(2).padStart(6)}  ` +
      `${d.spawnDelay.toFixed(2).padStart(6)}s  ` +
      `${warn.toFixed(2).padStart(7)}s  ` +
      `${delta.padStart(8)}${d.amAnschlag ? '  <- Maximum' : ''}`,
  );
}

/* -------------------------------------------------------- Zum Vergleich */

console.log('\nZum Vergleich, der Stand VOR dem Umbau (Zeitrampen mit Deckel):');
console.log('   0s   Tempo  6.20   Scroll 2.30   Obj/s 0.86   Vorwarnung 0.87s');
console.log(' 142s+  Tempo 24.50   Scroll 9.50   Obj/s 29.6   Vorwarnung 0.22s   <- unspielbar');

/* ------------------------------------------------- Punktestand-Vergleich */

function meterNach(sekunden) {
  const c = new DifficultyCurve(CONFIG.difficulty);
  let m = 0;
  const dt = 0.05;
  for (let t = 0; t < sekunden; t += dt) {
    c.update(dt);
    m += c.scrollSpeed * dt;
  }
  return m;
}

console.log('\nHöhenmeter (der Punktestand) — die Skala ändert sich mit dem Tempo:');
for (const s of [30, 60, 90, 120, 180, 240]) {
  console.log(`  nach ${String(s).padStart(3)}s: ${Math.round(meterNach(s))} m`);
}
