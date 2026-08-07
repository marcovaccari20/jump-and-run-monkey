/**
 * PRÜFSKRIPT — ist die Folge der Affenrufe wirklich unregelmässig?
 *
 *   node scripts/_affenmuster.mjs
 *
 * Simuliert 20 Minuten Spielzeit mit GENAU der Logik aus
 * Game.js `_naechsterAffenAbstand()` / `_affenRuf()` und liest die Werte aus
 * src/config.js (klang.affenRuf). Rein lesend, ändert nichts.
 *
 * Der Besitzer wollte ausdrücklich KEIN Metronom. Deshalb wird hier nicht nur
 * gezählt, sondern gemessen, wie stark die Folge sich wiederholt:
 *   - Autokorrelation der Abstandsfolge bei Verschiebung 1..12
 *     (Verschiebung = Länge der Grundfolge = das verräterische Mass)
 *   - wie sicher man aus einem Abstand auf die Stelle in der Grundfolge
 *     schliessen kann (Trennschärfe der Werte)
 *   - Rangfolge innerhalb eines Durchlaufs: bleibt sie über Durchläufe gleich?
 */
import { CONFIG } from '../src/config.js';

const cfg = CONFIG.klang.affenRuf;
const DAUER = 20 * 60; // Sekunden
const DT = 1 / 60; // dieselbe Bildrate wie im Spiel

/* ---------------------------------------------------------- Spiel-Logik 1:1 */

function simuliere({ muenzen = 0 } = {}) {
  let schritt = 0;
  const naechster = () => {
    const wert = cfg.abstaende[schritt % cfg.abstaende.length];
    schritt++;
    const streu = 1 + (Math.random() * 2 - 1) * (cfg.streuung ?? 0);
    return Math.max(2, wert * streu);
  };

  // _startRun(): erster Ruf nicht sofort im Startmoment
  let timer = 6 + Math.random() * 4;
  const zeiten = [];
  const stellen = []; // Stelle in der Grundfolge, die diesen Abstand erzeugt hat

  // Münzrate wie im Spiel: coin.proGebiet Stück je wall-Stufe
  const proSekunde = muenzen ? CONFIG.coin.proGebiet / CONFIG.difficulty.sekundenProWand : 0;

  for (let t = 0; t < DAUER; t += DT) {
    // _affeFreutSich(): Münze eingesammelt -> mit beiMuenze-Chance ein Ruf,
    // der den regulären Timer NEU setzt (und die Grundfolge weiterschiebt).
    if (proSekunde && Math.random() < proSekunde * DT && Math.random() < cfg.beiMuenze) {
      zeiten.push(t + (cfg.nachErfolgVerzoegerung ?? 0));
      stellen.push(-1);
      timer = naechster();
      continue;
    }
    timer -= DT;
    if (timer > 0) continue;
    stellen.push(schritt % cfg.abstaende.length);
    timer = naechster();
    zeiten.push(t);
  }
  return { zeiten, stellen };
}

/* -------------------------------------------------------------- Auswertung */

const mittel = (a) => a.reduce((s, x) => s + x, 0) / a.length;

function autokorr(a, lag) {
  const m = mittel(a);
  let oben = 0;
  let unten = 0;
  for (let i = 0; i < a.length; i++) unten += (a[i] - m) ** 2;
  for (let i = 0; i + lag < a.length; i++) oben += (a[i] - m) * (a[i + lag] - m);
  return oben / unten;
}

function auswerten(name, { zeiten }, extra = '') {
  const abst = [];
  for (let i = 1; i < zeiten.length; i++) abst.push(zeiten[i] - zeiten[i - 1]);

  console.log(`\n================ ${name} ${extra}`);
  console.log(`  Rufe gesamt        ${zeiten.length} in ${DAUER / 60} Minuten`);
  console.log(`  Rufe pro Minute    ${(zeiten.length / (DAUER / 60)).toFixed(2)}`);
  console.log(`  Abstand kürzest    ${Math.min(...abst).toFixed(2)} s`);
  console.log(`  Abstand längst     ${Math.max(...abst).toFixed(2)} s`);
  console.log(`  Abstand Mittel     ${mittel(abst).toFixed(2)} s`);
  console.log(
    `  Standardabweichung ${Math.sqrt(mittel(abst.map((x) => (x - mittel(abst)) ** 2))).toFixed(2)} s`,
  );

  const L = cfg.abstaende.length;
  const zeile = [];
  for (let lag = 1; lag <= 12; lag++) {
    const r = autokorr(abst, lag);
    zeile.push(`${lag}${lag === L ? '*' : ' '}:${r >= 0 ? ' ' : ''}${r.toFixed(2)}`);
  }
  console.log(`  Autokorrelation (Verschiebung:r, * = Länge der Grundfolge)`);
  console.log(`    ${zeile.join('  ')}`);

  /* WECHSELTAKT — das, was man tatsächlich hört.
   * Die Grundfolge ist an geraden Stellen kurz (10,15,5,12) und an ungeraden
   * lang (20,20,25,30). Wenn sich kurz und lang strikt abwechseln, ergibt das
   * einen hörbaren Zweiertakt — ein Metronom mit Humpeln, aber ein Metronom. */
  const med = [...abst].sort((a, b) => a - b)[Math.floor(abst.length / 2)];
  let wechsel = 0;
  for (let i = 1; i < abst.length; i++) {
    if (abst[i - 1] < med !== abst[i] < med) wechsel++;
  }
  console.log(
    `  Wechseltakt kurz/lang: ${(((wechsel / (abst.length - 1)) * 100)).toFixed(1)} %` +
      ` der Nachbarpaare wechseln die Seite des Medians (${med.toFixed(1)} s)` +
      `  —  50 % = Zufall, 100 % = strikter Zweiertakt`,
  );
  return abst;
}

/* --------------------------------------------------- Kann man es erkennen? */

/** Wie sicher lässt sich aus einem gemessenen Abstand die Stelle ableiten? */
function trennschaerfe() {
  const w = cfg.abstaende;
  const s = cfg.streuung ?? 0;
  console.log('\n================ Trennschärfe der Grundfolge');
  console.log(`  Grundfolge  [${w.join(', ')}]  Streuung ±${(s * 100).toFixed(0)} %`);
  console.log(`  Summe eines Durchlaufs ${w.reduce((a, b) => a + b, 0)} s` +
    `  →  ein Durchlauf alle ${(w.reduce((a, b) => a + b, 0) / 60).toFixed(2)} Minuten`);
  for (let i = 0; i < w.length; i++) {
    const lo = w[i] * (1 - s);
    const hi = w[i] * (1 + s);
    // mit welchen anderen Stellen überlappt dieser Bereich?
    const kollision = w
      .map((v, j) => ({ v, j }))
      .filter(({ v, j }) => j !== i && v * (1 + s) > lo && v * (1 - s) < hi)
      .map(({ v }) => v);
    console.log(
      `    Stelle ${i}  ${String(w[i]).padStart(2)} s → ${lo.toFixed(2)}–${hi.toFixed(2)} s` +
        (kollision.length ? `   überlappt mit ${kollision.join(', ')}` : '   EINDEUTIG'),
    );
  }
}

/** Bleibt die Reihenfolge kurz/lang über die Durchläufe hinweg gleich? */
function rangTreue(abst) {
  const L = cfg.abstaende.length;
  const zyklen = Math.floor(abst.length / L);
  if (zyklen < 2) return;
  let gleich = 0;
  let paare = 0;
  for (let z = 0; z < zyklen; z++) {
    for (let a = 0; a < L; a++) {
      for (let b = a + 1; b < L; b++) {
        const ist = abst[z * L + a] < abst[z * L + b];
        const soll = cfg.abstaende[a] < cfg.abstaende[b];
        if (ist === soll) gleich++;
        paare++;
      }
    }
  }
  console.log(
    `\n  Rangtreue: in ${((gleich / paare) * 100).toFixed(1)} % aller Paare steht der ` +
      `Abstand in derselben Reihenfolge wie in der Grundfolge (50 % = reiner Zufall)`,
  );
}

/* ------------------------------------------------------------------- Lauf */

trennschaerfe();
const rein = simuliere();
const abstRein = auswerten('NUR TIMER', rein, '(kein Einsammeln)');
rangTreue(abstRein);

const mitMuenzen = simuliere({ muenzen: true });
auswerten('MIT MÜNZEN', mitMuenzen, `(beiMuenze ${cfg.beiMuenze}, ${CONFIG.coin.proGebiet}/Gebiet)`);

console.log('\nHinweis: 20 Minuten sind mehr als ein realer Lauf. Ein Lauf endet' +
  ' meist nach 1–3 Minuten, und _startRun() setzt die Grundfolge wieder auf Stelle 0.');
