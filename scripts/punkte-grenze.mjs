/**
 * Prüft die Betrugsschranke der weltweiten Bestenliste.
 *
 * FRAGE 1  Weist die Schranke ehrliche Läufe ab?  (darf NIE passieren)
 * FRAGE 2  Lässt sie Betrug durch?                (soll möglichst eng sein)
 *
 * Dazu werden zwei Dinge verglichen:
 *   - die SIMULATION des echten Punktezuwachses, Frame für Frame, exakt mit
 *     den Formeln aus DifficultyCurve.js und Game._updatePlaying
 *   - die FORMEL aus scripts/bestenliste.sql (hier nachgebaut)
 *
 * Aufruf:  node scripts/punkte-grenze.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CONFIG } from '../src/config.js';

const D = CONFIG.difficulty;
const HIER = dirname(fileURLToPath(import.meta.url));

/* ================================================================= ABGLEICH
 *
 * Das Skript baute die Formel früher nur aus CONFIG nach und las das SQL
 * überhaupt nicht. Damit konnte es genau den Fehler NICHT finden, vor dem es
 * selbst warnt: dass jemand an der Schwierigkeit dreht und die Zahlen im SQL
 * vergisst. Es stand dann trotzdem "BESTANDEN" da.
 *
 * Jetzt werden die Konstanten aus scripts/bestenliste.sql gelesen und gegen
 * die Konfiguration gehalten.
 * ======================================================================== */

const SQL = readFileSync(join(HIER, 'bestenliste.sql'), 'utf8');

/** Liest `name constant numeric := 3.8;` aus dem SQL. */
function ausSql(name) {
  const treffer = SQL.match(new RegExp(`${name}\\s+constant\\s+numeric\\s*:=\\s*([\\d.]+)`));
  return treffer ? Number(treffer[1]) : null;
}

const sqlWerte = {
  tempo_start: ausSql('tempo_start'),
  tempo_max: ausSql('tempo_max'),
  scroll_anteil: ausSql('scroll_anteil'),
  pro_wand: ausSql('pro_wand'),
  sek_pro_wand: ausSql('sek_pro_wand'),
  tempo_exp: ausSql('tempo_exp'),
  klettern_max: ausSql('klettern_max'),
  reserve: ausSql('reserve'),
  tick_sekunden: ausSql('tick_sekunden'),
  toleranz: ausSql('toleranz'),
};

/* ---------------------------------------------------------- Die Simulation */

/**
 * Punkte eines PERFEKTEN Spielers: dauerhaft senkrecht klettern, nie sterben.
 * Genau die Kette aus Game.js:
 *   scrollSpeed = tempo * scrollAnteil
 *   assisted    = scrollSpeed + axis.y * climbAssist      (axis.y = 1)
 *   climbed     = assisted * dt
 */
function simuliere(sekunden, climbAssist, dt = 1 / 60) {
  let hoehe = 0;
  for (let t = 0; t < sekunden; t += dt) {
    const wand = t / D.sekundenProWand;
    const haerte = Math.pow(D.proWand, wand);
    const tempo = Math.min(D.tempo.max, D.tempo.start * Math.pow(haerte, D.tempoExponent));
    hoehe += (tempo * D.tempo.scrollAnteil + climbAssist) * dt;
  }
  return hoehe;
}

/* ------------------------------------------------- Die Formel aus dem SQL */

const RESERVE = sqlWerte.reserve ?? 1.08;

function maxHoehe(sekunden, climbAssist) {
  const t = Math.max(0, sekunden);
  const k = (Math.log(D.proWand) * D.tempoExponent) / D.sekundenProWand;
  const v0 = D.tempo.start * D.tempo.scrollAnteil;
  const tDeckel = Math.log(D.tempo.max / D.tempo.start) / k;
  const sDeckel = (v0 / k) * (Math.exp(k * tDeckel) - 1) + climbAssist * tDeckel;

  if (t <= tDeckel) return RESERVE * ((v0 / k) * (Math.exp(k * t) - 1) + climbAssist * t);
  return RESERVE * (sDeckel + (D.tempo.max * D.tempo.scrollAnteil + climbAssist) * (t - tDeckel));
}

/* ------------------------------------------------------------------ Lauf */

// climbAssist steht je Affe unter characters[id].player.climbAssist —
// der Wert in CONFIG.player ist nur die Vorgabe.
const werte = Object.values(CONFIG.characters.list)
  .map((c) => c.player?.climbAssist)
  .filter((v) => Number.isFinite(v));
if (!werte.length) {
  console.error('FEHLER: kein climbAssist gefunden — stimmt der Pfad in der Konfiguration noch?');
  process.exit(1);
}
const climbAssist = Math.max(...werte);
const maxSpielzeit = 7200; // wie in bestenliste.sql

console.log(
  'climbAssist je Affe: ' +
    Object.entries(CONFIG.characters.list)
      .map(([id, c]) => `${id}=${c.player?.climbAssist}`)
      .join('  '),
);
console.log('Für die Schranke zählt der grösste:', climbAssist);
console.log('');

/* --- Abgleich SQL gegen Konfiguration ---------------------------------- */
const erwartet = {
  tempo_start: D.tempo.start,
  tempo_max: D.tempo.max,
  scroll_anteil: D.tempo.scrollAnteil,
  pro_wand: D.proWand,
  sek_pro_wand: D.sekundenProWand,
  tempo_exp: D.tempoExponent,
  klettern_max: climbAssist,
  tick_sekunden: CONFIG.bestenliste.tickSekunden,
};

const abweichungen = [];
for (const [name, soll] of Object.entries(erwartet)) {
  const ist = sqlWerte[name];
  if (ist === null) abweichungen.push(`${name}: im SQL nicht gefunden`);
  else if (Math.abs(ist - soll) > 1e-9) abweichungen.push(`${name}: SQL ${ist}, Konfiguration ${soll}`);
}

console.log('ABGLEICH scripts/bestenliste.sql <-> src/config.js');
if (abweichungen.length === 0) {
  console.log(`  Alle ${Object.keys(erwartet).length} Konstanten stimmen überein.`);
} else {
  console.log('  ABWEICHUNGEN GEFUNDEN — die Schranke passt nicht zum Spiel:');
  for (const a of abweichungen) console.log(`    - ${a}`);
}
console.log('');
console.log('  Zeit      ehrlich (perfekt)   Schranke      Luft');
console.log('  ────────────────────────────────────────────────────');

let schlimmste = Infinity;
let abgelehnt = 0;
const proben = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 5400, 7200];
for (const t of proben) {
  const echt = simuliere(t, climbAssist);
  const grenze = maxHoehe(t, climbAssist);
  const luft = grenze / echt;
  if (luft < schlimmste) schlimmste = luft;
  // NICHT `grenze < echt` — bei NaN ist jeder Vergleich falsch, und der Test
  // hätte sich selbst durchgewunken. Genau das ist beim ersten Lauf passiert.
  if (!(grenze >= echt)) abgelehnt++;
  console.log(
    `  ${String(t).padStart(5)} s   ${echt.toFixed(0).padStart(10)} m   ` +
      `${grenze.toFixed(0).padStart(9)} m   ${luft.toFixed(3)}x`,
  );
}

/* Feinraster: die Schranke darf an KEINER Stelle unter dem echten Wert
 * liegen, nicht nur an den Stützstellen oben. */
let engste = { t: 0, luft: Infinity };
let hoehe = 0;
const dt = 1 / 60;
for (let t = dt; t <= maxSpielzeit; t += dt) {
  const wand = (t - dt) / D.sekundenProWand;
  const haerte = Math.pow(D.proWand, wand);
  const tempo = Math.min(D.tempo.max, D.tempo.start * Math.pow(haerte, D.tempoExponent));
  hoehe += (tempo * D.tempo.scrollAnteil + climbAssist) * dt;
  if (t < 4) continue; // unter 4 s wird ohnehin abgewiesen
  const luft = maxHoehe(t, climbAssist) / hoehe;
  if (luft < engste.luft) engste = { t, luft };
}

console.log('');
console.log('FRAGE 1 — werden ehrliche Läufe abgewiesen?');
console.log(`  Stützstellen unter der Schranke: ${abgelehnt} von ${proben.length}`);
console.log(
  `  Engste Stelle im Feinraster: bei ${engste.t.toFixed(1)} s noch ` +
    `${((engste.luft - 1) * 100).toFixed(1)} % Luft`,
);
const bestanden =
  abgelehnt === 0 && Number.isFinite(engste.luft) && engste.luft > 1 && abweichungen.length === 0;
console.log(
  `  ${
    bestanden
      ? 'BESTANDEN — kein ehrlicher Lauf wird abgewiesen'
      : abweichungen.length
        ? 'DURCHGEFALLEN — SQL und Konfiguration laufen auseinander (siehe oben)'
        : 'DURCHGEFALLEN'
  }`,
);

console.log('');
console.log('FRAGE 2 — was kostet Betrug?');
console.log('');
console.log('  Die Kurve allein hätte fast nichts gebracht: der Angreifer gab');
console.log('  einfach die höchste erlaubte Spielzeit an und den Punktestand,');
console.log('  der laut Kurve dazu passt. Er bestimmte BEIDE Zahlen.');
console.log('');
const alteGrenze = 9 * maxSpielzeit;
const neueGrenze = maxHoehe(maxSpielzeit, climbAssist);
console.log(`    alte Schranke (9 m/s, Zeit vom Browser)   ${alteGrenze.toFixed(0).padStart(7)} m, sofort`);
console.log(`    nur die Kurve (Zeit weiter vom Browser)   ${neueGrenze.toFixed(0).padStart(7)} m, sofort`);
console.log(`    -> Verbesserung durch die Kurve allein:  ${(alteGrenze / neueGrenze).toFixed(2)}x  (fast nichts)`);
console.log('');
console.log('  Deshalb misst jetzt der SERVER die Zeit. Der Punktestand ist');
console.log('  damit an echte Wartezeit gekoppelt:');
console.log('');
console.log('    Ziel-Eintrag      dafür nötige ECHTE Wartezeit');
console.log('    ─────────────────────────────────────────────');
for (const ziel of [1000, 2000, 5000, 10000, 20000, 57689]) {
  // Kleinste Zeit, zu der die Schranke `ziel` überhaupt zulässt
  let lo = 0;
  let hi = maxSpielzeit;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (maxHoehe(mid, climbAssist) < ziel) lo = mid;
    else hi = mid;
  }
  const min = hi / 60;
  const zuLang = hi >= maxSpielzeit - 1;
  console.log(
    `    ${String(ziel).padStart(6)} m` +
      `        ${zuLang ? 'über 2 h — nicht eintragbar' : `${min.toFixed(1)} Minuten`}`,
  );
}

const realistisch = simuliere(300, climbAssist); // 5 Minuten sind schon sehr gut
console.log('');
console.log('  HIER STAND EIN FEHLSCHLUSS, und er ist es wert, benannt zu werden:');
console.log('  "der Betrug kostet dieselbe Zeit wie ehrliches Spielen". Falsch.');
console.log('  Ein `sleep` läuft im Hintergrund, beliebig oft parallel, ohne');
console.log('  Aufmerksamkeit. 47 Minuten ununterbrochenes Ausweichen bei einem');
console.log('  Treffer Tod sind etwas völlig anderes. Die ZEIT war gleich, die');
console.log('  KOSTEN nicht — und nur die zählen.');
console.log('');
console.log('  Deshalb zählt jetzt nicht das Alter der Marke, sondern die Zahl');
console.log('  der Lebenszeichen. Angerechnet wird');
console.log('');
console.log('      min( Uhrzeit , Lebenszeichen * Takt * Toleranz )');
console.log('');
const takt = sqlWerte.tick_sekunden ?? 20;
const toleranz = sqlWerte.toleranz ?? 3;
console.log(`  Takt ${takt} s, Toleranz ${toleranz} — daraus folgt:`);
console.log('');
console.log('    Wer NUR wartet                 0 Lebenszeichen -> 0 s -> 0 m');
console.log(
  `    Wer die Lebenszeichen fälscht  braucht 1 Anfrage je ${(takt * toleranz).toFixed(0)} s` +
    ' angerechneter Zeit,',
);
console.log('                                   und die kann er nicht stauchen: der');
console.log(`                                   Server verwirft alles schneller als ${(takt * 0.8).toFixed(0)} s.`);
console.log('');
for (const ziel of [1000, 5000, 20000]) {
  let lo = 0;
  let hi = maxSpielzeit;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (maxHoehe(mid, climbAssist) < ziel) lo = mid;
    else hi = mid;
  }
  console.log(
    `    ${String(ziel).padStart(6)} m  ->  ${(hi / 60).toFixed(0)} Minuten Wanduhr` +
      ` UND mindestens ${Math.ceil(hi / (takt * toleranz))} Anfragen im Takt`,
  );
}
console.log('');
console.log(`  Sehr guter echter Lauf (5 min): ${realistisch.toFixed(0)} m`);
console.log('');
console.log('  WAS DAS IMMER NOCH NICHT LEISTET, ehrlich:');
console.log('  Ein Angreifer kann die Lebenszeichen skripten. Er muss dann aber');
console.log('  die volle Wanduhr abwarten UND regelmässig Anfragen schicken —');
console.log('  die sind zählbar, rationiert (240/min bzw. 120/min) und fallen auf.');
console.log('  Unmöglich wird Betrug nicht: der anon-Schlüssel steht zwangsläufig');
console.log('  im ausgelieferten JavaScript. Bei einem Browserspiel ohne Anmeldung');
console.log('  ist das die Grenze des Machbaren.');
