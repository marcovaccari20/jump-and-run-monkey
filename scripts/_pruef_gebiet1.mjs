/**
 * MESSSKRIPT — "Gebiet 1 soll nur noch 100 Meter lang sein".
 *
 * Rechnet NICHTS am Spielcode, liest nur CONFIG und benutzt die echte
 * DifficultyCurve. Die Hoehe ist das Integral der Scrollgeschwindigkeit
 * ueber die Spielzeit (Game._updatePlaying: score.addHeight(scrollSpeed*dt),
 * score.unitsPerMeter = 1).
 *
 * Aufruf:  node scripts/_pruef_gebiet1.mjs
 */
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { PlantWall } from '../src/world/PlantWall.js';

const d = CONFIG.difficulty;
const stages = CONFIG.wall.stages;

/* ------------------------------------------------------ 0) Grundzahlen */
const k = (Math.log(d.proWand) * d.tempoExponent) / d.sekundenProWand;
const v0 = d.tempo.start * d.tempo.scrollAnteil;
const tDeckel = Math.log(d.tempo.max / d.tempo.start) / k;
const sDeckel = (v0 / k) * (Math.exp(k * tDeckel) - 1);

/** Geschlossene Form der Hoehe (Meter) zur Spielzeit t. */
function hoeheExakt(t) {
  if (t <= tDeckel) return (v0 / k) * (Math.exp(k * t) - 1);
  return sDeckel + d.tempo.max * d.tempo.scrollAnteil * (t - tDeckel);
}
/** Umkehrung: bei welcher Sekunde stehen `m` Meter? */
function zeitFuer(m) {
  if (m <= sDeckel) return Math.log(1 + (m * k) / v0) / k;
  return tDeckel + (m - sDeckel) / (d.tempo.max * d.tempo.scrollAnteil);
}

/** Numerisch, mit der ECHTEN Kurve und dem Spiel-Zeitschritt. */
function hoeheNumerisch(tEnde, dt = 1 / 60) {
  const c = new DifficultyCurve(d);
  let h = 0;
  let t = 0;
  while (t < tEnde - 1e-12) {
    const schritt = Math.min(dt, tEnde - t);
    // Reihenfolge wie in Game._updatePlaying: erst update, dann scrollSpeed.
    c.update(schritt);
    h += c.scrollSpeed * schritt;
    t += schritt;
  }
  return h;
}

const L = (s = '') => console.log(s);
const f2 = (x) => x.toFixed(2);
const f3 = (x) => x.toFixed(3);

L('==============================================================');
L(' 1) IST GEBIET 1 WIRKLICH 100 METER LANG?');
L('==============================================================');
L(`config.js:556  sekundenProWand = ${d.sekundenProWand}`);
L(`config.js:557  proWand         = ${d.proWand}`);
L(`config.js:572  tempoExponent   = ${d.tempoExponent}`);
L(`config.js:590  tempo.start     = ${d.tempo.start}`);
L(`config.js:610  tempo.max       = ${d.tempo.max}`);
L(`config.js:615  scrollAnteil    = ${d.tempo.scrollAnteil}`);
L(`config.js:2522 stages[1].afterSeconds = ${stages[1].afterSeconds}`);
L();
L(`k  = ln(proWand)*tempoExponent/sekundenProWand = ${k.toExponential(6)} 1/s`);
L(`v0 = tempo.start*scrollAnteil                  = ${f3(v0)} m/s`);
L(`Tempodeckel erreicht bei t = ${f2(tDeckel)} s  (weit hinter Gebiet 1)`);
L();
const grenze = stages[1].afterSeconds;
const hGrenze = hoeheExakt(grenze);
const hNum = hoeheNumerisch(grenze);
L(`Hoehe bei t = ${grenze} s   exakt      : ${f3(hGrenze)} m`);
L(`Hoehe bei t = ${grenze} s   numerisch  : ${f3(hNum)} m   (dt=1/60, echte Kurve)`);
L(`Abweichung exakt/numerisch: ${((hNum / hGrenze - 1) * 100).toFixed(4)} %`);
L(`Anzeige im HUD (Math.floor): ${Math.floor(hNum)} m`);
L();
L(`100.000 m sind erreicht bei t = ${f3(zeitFuer(100))} s`);
L(`Fehlbetrag bei 55 s: ${f3(100 - hGrenze)} m  (${((hGrenze / 100 - 1) * 100).toFixed(2)} %)`);
L(`Fuer exakt 100 m muesste afterSeconds = ${zeitFuer(100).toFixed(3)} sein.`);
L();
L('Scrollgeschwindigkeit am Rand von Gebiet 1:');
for (const t of [0, 27.5, 55]) {
  const c = new DifficultyCurve(d);
  c.elapsed = t;
  L(`  t=${String(t).padStart(5)} s  tempo=${f3(c.tempo)}  scroll=${f3(c.scrollSpeed)} m/s`);
}

L();
L('==============================================================');
L(' 2) STIMMT DIE KETTE DANACH?');
L('==============================================================');
L(`Eintraege in CONFIG.wall.stages: ${stages.length}`);
L(`stageLoopSeconds: ${CONFIG.wall.stageLoopSeconds}`);
L();
let alleGleich = true;
for (let i = 1; i < stages.length; i++) {
  const dt = stages[i].afterSeconds - stages[i - 1].afterSeconds;
  const soll = i === 1 ? grenze : d.sekundenProWand;
  const ok = Math.abs(dt - soll) < 1e-9;
  if (i > 1 && !ok) alleGleich = false;
  const hoehe = hoeheExakt(stages[i].afterSeconds) - hoeheExakt(stages[i - 1].afterSeconds);
  L(
    `  Gebiet ${String(i).padStart(2)} -> ${String(i + 1).padStart(2)}  ` +
      `${String(stages[i - 1].afterSeconds).padStart(5)}s -> ${String(stages[i].afterSeconds).padStart(5)}s ` +
      `= ${String(dt).padStart(4)} s ${ok ? 'ok ' : 'ABW'}  ` +
      `= ${hoehe.toFixed(1).padStart(7)} m   (${stages[i - 1].name} -> ${stages[i].name})`,
  );
}
L(`Alle Gebiete ab Nr. 2 exakt ${d.sekundenProWand} s: ${alleGleich ? 'JA' : 'NEIN'}`);
const letzte = stages[stages.length - 1].afterSeconds;
L(
  `Uebergang letztes Gebiet -> Schleife: ${letzte} s + stageLoopSeconds ${CONFIG.wall.stageLoopSeconds} ` +
    `= ${letzte + CONFIG.wall.stageLoopSeconds} s`,
);
L(`Namen doppelt? ${new Set(stages.map((s) => s.name)).size === stages.length ? 'nein' : 'JA'}`);
L(`near-Texturen doppelt? ${new Set(stages.map((s) => s.near)).size === stages.length ? 'nein' : 'JA'}`);

L();
L('==============================================================');
L(' 3) WAS HAENGT SONST AN afterSeconds?');
L('==============================================================');

/* --- 3a) PlantWall.stageIndexAt ---------------------------------------- */
const wall = Object.create(PlantWall.prototype);
wall.cfg = CONFIG.wall;
L('3a) PlantWall.stageIndexAt (src/world/PlantWall.js:231)');
const proben = [
  0, 54.9, 55, 55.1, 186.9, 187, 318.9, 319, 1902.9, 1903, 2034.9, 2035, 2035.1,
  2166.9, 2167,
];
for (const t of proben) {
  L(`   t=${String(t).padStart(7)} s -> idx ${String(wall.stageIndexAt(t)).padStart(2)}  (${stages[wall.stageIndexAt(t)].name})`);
}
let kettenFehler = 0;
for (let t = 0; t <= 4000; t += 0.05) {
  const idx = wall.stageIndexAt(t);
  if (idx < 0 || idx >= stages.length) kettenFehler++;
}
L(`   Ungueltige Indizes in 0..4000 s: ${kettenFehler}`);
// Wechselzeitpunkte aus stageIndexAt zurueckgewinnen
const wechsel = [];
let vor = wall.stageIndexAt(0);
for (let t = 0; t <= 3000; t += 0.01) {
  const idx = wall.stageIndexAt(t);
  if (idx !== vor) {
    wechsel.push(Number(t.toFixed(2)));
    vor = idx;
  }
}
L(`   Wechsel bis 3000 s: ${wechsel.slice(0, 20).join(', ')} ...`);
const zyklAbstand = wechsel.slice(-5).map((v, i, a) => (i ? +(v - a[i - 1]).toFixed(2) : null)).slice(1);
L(`   Abstaende der letzten Wechsel (Schleifenbetrieb): ${zyklAbstand.join(', ')}`);

/* --- 3b) Anzeige "noch X Meter" --------------------------------------- */
L();
L('3b) Anzeige "noch X m bis zum naechsten Gebiet" (Game.js:2339-2357)');
function anzeigeMeter(t) {
  const idx = wall.stageIndexAt(t);
  const naechster = (idx + 1) % stages.length;
  const l = stages[stages.length - 1];
  let zielZeit;
  if (idx >= stages.length - 1 || t >= l.afterSeconds) {
    const seitLetzter = t - l.afterSeconds;
    const runde = Math.floor(seitLetzter / CONFIG.wall.stageLoopSeconds) + 1;
    zielZeit = l.afterSeconds + runde * CONFIG.wall.stageLoopSeconds;
  } else {
    zielZeit = stages[naechster].afterSeconds;
  }
  const rest = Math.max(0, zielZeit - t);
  const c = new DifficultyCurve(d);
  c.elapsed = t;
  return { angezeigt: rest * c.scrollSpeed, echt: hoeheExakt(zielZeit) - hoeheExakt(t), zielZeit };
}
L('   Gebiet 1:');
for (const t of [0, 10, 20, 30, 40, 50, 54]) {
  const a = anzeigeMeter(t);
  L(
    `     t=${String(t).padStart(3)}s  angezeigt ${String(Math.round(a.angezeigt)).padStart(4)} m  ` +
      `echt ${a.echt.toFixed(1).padStart(6)} m  Fehler ${(a.angezeigt - a.echt).toFixed(2).padStart(6)} m`,
  );
}
L('   Gebiet 2 (zum Vergleich):');
for (const t of [55, 100, 150, 186]) {
  const a = anzeigeMeter(t);
  L(
    `     t=${String(t).padStart(3)}s  angezeigt ${String(Math.round(a.angezeigt)).padStart(4)} m  ` +
      `echt ${a.echt.toFixed(1).padStart(6)} m  Fehler ${(a.angezeigt - a.echt).toFixed(2).padStart(6)} m`,
  );
}
L('   Nach der letzten Wand (Schleifenbetrieb):');
for (const t of [1903, 1950, 2034, 2035]) {
  const a = anzeigeMeter(t);
  L(
    `     t=${String(t).padStart(4)}s  Ziel ${a.zielZeit}s  angezeigt ${String(Math.round(a.angezeigt)).padStart(4)} m  ` +
      `echt ${a.echt.toFixed(1).padStart(6)} m`,
  );
}

/* --- 3c) Sturzflug-Uhr ------------------------------------------------ */
L();
L('3c) Sturzflug-Uhr (Game.js:1118)');
const dauerSturz = stages.length > 1 ? stages[1].afterSeconds - stages[0].afterSeconds : 132;
L(`   dauer = stages[1].afterSeconds - stages[0].afterSeconds = ${dauerSturz} s`);
L(`   ECHTE Gebietsdauer ab Gebiet 2: ${d.sekundenProWand} s`);
for (const n of [2, 3, 5, 9]) {
  const abschnitt = dauerSturz / (n + 1);
  const abschnittRichtig = d.sekundenProWand / (n + 1);
  L(
    `   n=${n} Angriffe: Abschnitt ${abschnitt.toFixed(2)} s (gestreut ${(abschnitt * 0.7).toFixed(1)}..${(abschnitt * 1.3).toFixed(1)} s) ` +
      `— richtig waeren ${abschnittRichtig.toFixed(2)} s`,
  );
  // Wie viele passen tatsaechlich in ein 132-s-Gebiet, wenn nach jedem neu gestellt wird?
  let t = 0;
  let cnt = 0;
  while (cnt < n) {
    t += abschnitt; // Erwartungswert der Streuung = abschnitt
    if (t > d.sekundenProWand) break;
    cnt++;
  }
  L(`        -> im Erwartungswert alle ${n} Angriffe nach ${t.toFixed(1)} s durch (Gebiet ist ${d.sekundenProWand} s)`);
}

/* --- 3d) Chili-Durchflug --------------------------------------------- */
L();
L('3d) Chili-Durchflug (Game.js:683-685)');
L(`   dauerGebiet = CONFIG.difficulty.sekundenProWand = ${d.sekundenProWand}`);
L('   restGebiet  = dauerGebiet - (elapsed % dauerGebiet)   <-- Raster 0,132,264,...');
L('   ECHTE Gebietsgrenzen: 0, 55, 187, 319, ... = 55 + 132k');
const c2 = CONFIG.chili;
for (const t of [60, 120, 131, 190, 250, 320, 400]) {
  const imGebiet = t % d.sekundenProWand;
  const restGebiet = d.sekundenProWand - imGebiet;
  const strecke = Math.max(restGebiet + d.sekundenProWand * c2.einstieg, c2.minSekunden * c2.tempoFaktor);
  // echte naechste Grenze
  const idx = wall.stageIndexAt(t);
  const naechsteGrenze =
    idx + 1 < stages.length ? stages[idx + 1].afterSeconds : letzte + CONFIG.wall.stageLoopSeconds;
  const landung = t + strecke;
  const landungIdx = wall.stageIndexAt(landung);
  L(
    `   t=${String(t).padStart(4)}s (Gebiet ${idx + 1}) restGebiet=${restGebiet.toFixed(1).padStart(6)}s  ` +
      `Uhrschub=${strecke.toFixed(1).padStart(6)}s -> landet bei ${landung.toFixed(1).padStart(6)}s ` +
      `= Gebiet ${landungIdx + 1}  (naechste echte Grenze waere ${naechsteGrenze}s)  ` +
      `${landungIdx > idx ? 'ok' : 'FEHLT DAS GEBIET'}`,
  );
}

/* --- 3e) Musiktempo, Belohnung, Boss, Muenzen, Banane ----------------- */
L();
L('3e) Was am GEBIETSZAEHLER haengt (_gebietWechsel, Game.js:2210)');
const m = CONFIG.klang.musik;
L(`   Musiktempo = min(${m.tempoMax}, 1 + wechsel*${m.tempoProGebiet})  -> zaehlt Wechsel, nicht Sekunden.`);
for (const g of [1, 2, 3, 6, 12]) {
  const t = g === 1 ? 0 : stages[g - 1].afterSeconds;
  L(
    `   Gebiet ${String(g).padStart(2)} beginnt bei ${String(t).padStart(5)} s ` +
      `(vorher ${g === 1 ? 0 : stages[g - 1].afterSeconds + 77} s) — Tempo ${Math.min(m.tempoMax, 1 + (g - 1) * m.tempoProGebiet).toFixed(3)}`,
  );
}
L(`   goldbanane.abGebiet=${CONFIG.goldbanane.abGebiet}  chili.abGebiet=${CONFIG.chili.abGebiet}  ` +
  `sturzflug.abGebiet=${CONFIG.sturzflug.abGebiet}  boss.abGebiet=${CONFIG.boss.abGebiet}`);
L(`   -> Boss ab Gebiet 3, das beginnt jetzt bei ${stages[2].afterSeconds} s statt bei ${stages[2].afterSeconds + 77} s.`);
L(`   -> Sturzflug ab Gebiet 2 = ${stages[1].afterSeconds} s statt ${stages[1].afterSeconds + 77} s.`);
L();
L(`   Muenzen: Spawner._muenzTakt = sekundenProWand/coin.proGebiet = ` +
  `${d.sekundenProWand}/${CONFIG.coin.proGebiet} = ${(d.sekundenProWand / CONFIG.coin.proGebiet).toFixed(2)} s`);
L(`      -> in Gebiet 1 (${grenze} s) fallen ${(grenze / (d.sekundenProWand / CONFIG.coin.proGebiet)).toFixed(1)} statt ${CONFIG.coin.proGebiet} Muenzen`);
L(`   Banane: abSekunde=${CONFIG.banana.abSekunde} s liegt in Gebiet ` +
  `${wall.stageIndexAt(CONFIG.banana.abSekunde) + 1} (${stages[wall.stageIndexAt(CONFIG.banana.abSekunde)].name}); ` +
  `frueher war das Gebiet ${Math.floor(CONFIG.banana.abSekunde / 132) + 1}`);

L();
L('==============================================================');
L(' 4) SCHWIERIGKEITSSPRUNG GEBIET 1 -> 2');
L('==============================================================');
function haerte(t) {
  return Math.pow(d.proWand, t / d.sekundenProWand);
}
function tempo(t) {
  return Math.min(d.tempo.max, d.tempo.start * Math.pow(haerte(t), d.tempoExponent));
}
function mittel(fn, a, b, n = 20000) {
  let s = 0;
  for (let i = 0; i < n; i++) s += fn(a + ((i + 0.5) * (b - a)) / n);
  return s / n;
}
const gr = [0, ...stages.slice(1, 5).map((s) => s.afterSeconds)];
L('   Gebiet | von..bis      | haerte Anfang | haerte Ende | Wachstum im Gebiet');
for (let i = 0; i < gr.length - 1; i++) {
  const a = gr[i];
  const b = gr[i + 1];
  L(
    `     ${i + 1}    | ${String(a).padStart(4)}..${String(b).padStart(4)} s | ` +
      `${haerte(a).toFixed(4)}        | ${haerte(b).toFixed(4)}      | ` +
      `${((haerte(b) / haerte(a) - 1) * 100).toFixed(1)} %`,
  );
}
L();
L('   Sprung von Gebiet zu Gebiet (haerte am Gebietsanfang):');
for (let i = 1; i < gr.length - 1; i++) {
  L(
    `     Gebiet ${i} -> ${i + 1}: haerte ${haerte(gr[i - 1]).toFixed(4)} -> ${haerte(gr[i]).toFixed(4)} ` +
      `= +${((haerte(gr[i]) / haerte(gr[i - 1]) - 1) * 100).toFixed(2)} %   (normal +25.00 %)`,
  );
}
L();
L('   Mittlere Haerte je Gebiet (das, was man wirklich spielt):');
const mh = [];
for (let i = 0; i < gr.length - 1; i++) mh.push(mittel(haerte, gr[i], gr[i + 1]));
for (let i = 0; i < mh.length; i++) {
  const rel = i ? `  -> +${((mh[i] / mh[i - 1] - 1) * 100).toFixed(2)} % ggue. Gebiet ${i}` : '';
  L(`     Gebiet ${i + 1}: ${mh[i].toFixed(4)}${rel}`);
}
L();
L('   Tempo (u/s) und Scroll (m/s) an den Gebietsgrenzen:');
for (const t of [0, 55, 187, 319, 451]) {
  L(`     t=${String(t).padStart(4)} s  tempo ${tempo(t).toFixed(3)}  scroll ${(tempo(t) * d.tempo.scrollAnteil).toFixed(3)}`);
}
L(
  `   Tempozuwachs ueber Gebiet 1: +${((tempo(55) / tempo(0) - 1) * 100).toFixed(2)} %  ` +
    `(ueber ein volles 132-s-Gebiet: +${((tempo(187) / tempo(55) - 1) * 100).toFixed(2)} %)`,
);
L();
L('   Wie lange dauerte Gebiet 1 vorher / jetzt, in Metern und Objekten:');
function objekteBis(tEnde) {
  // Zaehlt SPAWNS ueber den Spawn-Takt (keine Objektidentitaet - Pool!).
  const c = new DifficultyCurve(d);
  let t = 0;
  let n = 0;
  let next = 0;
  const dt = 1 / 60;
  while (t < tEnde) {
    c.update(dt);
    t += dt;
    if (t >= next) {
      n++;
      next = t + c.spawnDelay;
    }
  }
  return n;
}
L(`     alt (132 s): ${hoeheExakt(132).toFixed(1)} m, ca. ${objekteBis(132)} Abwuerfe`);
L(`     neu ( ${grenze} s): ${hoeheExakt(grenze).toFixed(1)} m, ca. ${objekteBis(grenze)} Abwuerfe`);

L();
L('==============================================================');
L(' 5) SERVERSEITIGE PUNKTESCHRANKE scripts/bestenliste.sql');
L('==============================================================');
const sql = {
  tempo_start: 3.8,
  tempo_max: 16.0,
  scroll_anteil: 0.42,
  pro_wand: 1.25,
  sek_pro_wand: 132,
  tempo_exp: 0.62,
  klettern_max: 0.0,
  reserve: 1.08,
};
const cfgWert = {
  tempo_start: d.tempo.start,
  tempo_max: d.tempo.max,
  scroll_anteil: d.tempo.scrollAnteil,
  pro_wand: d.proWand,
  sek_pro_wand: d.sekundenProWand,
  tempo_exp: d.tempoExponent,
};
L('   Konstante        SQL      CONFIG   Status');
for (const [name, wert] of Object.entries(sql)) {
  const c = cfgWert[name];
  const st = c === undefined ? '(nur SQL)' : Math.abs(c - wert) < 1e-9 ? 'gleich' : '>>> ABWEICHUNG <<<';
  L(`   ${name.padEnd(15)} ${String(wert).padStart(6)}   ${String(c ?? '-').padStart(6)}   ${st}`);
}
L('   Die Funktion liest CONFIG.wall.stages / afterSeconds NICHT.');
L();
function maxHoeheSql(t) {
  const kk = (Math.log(sql.pro_wand) * sql.tempo_exp) / sql.sek_pro_wand;
  const vv0 = sql.tempo_start * sql.scroll_anteil;
  const td = Math.log(sql.tempo_max / sql.tempo_start) / kk;
  const sd = (vv0 / kk) * (Math.exp(kk * td) - 1) + sql.klettern_max * td;
  if (t <= td) return sql.reserve * ((vv0 / kk) * (Math.exp(kk * t) - 1) + sql.klettern_max * t);
  return sql.reserve * (sd + (sql.tempo_max * sql.scroll_anteil + sql.klettern_max) * (t - td));
}
L('   Schranke gegen die ECHTE, automatisch erreichte Hoehe (climbAssist = 0,');
L('   die Hoehe kommt allein aus dem Scrollen — jeder Ueberlebende hat genau sie):');
L('     Sek.    echt (m)   Schranke (m)   Schranke/echt');
for (const t of [30, 55, 60, 120, 187, 300, 600, 900, 1173, 1500, 3000, 7200]) {
  const e = hoeheExakt(t);
  const s = maxHoeheSql(t);
  L(
    `     ${String(t).padStart(5)}  ${e.toFixed(1).padStart(9)}   ${s.toFixed(1).padStart(11)}   ` +
      `${(s / e).toFixed(4).padStart(7)}  ${s < e ? '<-- EHRLICHER LAUF WIRD ABGEWIESEN' : ''}`,
  );
}
L();
L(`   Verhaeltnis in der Exponentialphase = reserve * (SQL tempo_start / CONFIG tempo.start)`);
L(`   = ${sql.reserve} * ${sql.tempo_start}/${d.tempo.start} = ${((sql.reserve * sql.tempo_start) / d.tempo.start).toFixed(4)}`);
L();
L('   Der Server rechnet mit der UHRZEIT seit Rundenstart, nicht mit der Spieluhr.');
L('   Wieviel Zusatz-Uhrzeit (Todesverzoegerung + Game-Over-Bildschirm + Namenseingabe)');
L('   noetig ist, damit die Schranke den ehrlichen Lauf gerade noch durchlaesst:');
for (const t of [10, 30, 55, 120, 187, 300, 600, 900, 1173]) {
  let lo = 0;
  let hi = 4000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (maxHoeheSql(t + mid) >= hoeheExakt(t)) hi = mid;
    else lo = mid;
  }
  L(`     nach ${String(t).padStart(5)} s Spielzeit: x = ${hi.toFixed(2).padStart(6)} s`);
}
let gleich = 0;
{
  let lo = 0;
  let hi = 3000;
  for (let i = 0; i < 200; i++) {
    const m2 = (lo + hi) / 2;
    if (maxHoeheSql(m2) >= hoeheExakt(m2)) hi = m2;
    else lo = m2;
  }
  gleich = hi;
}
L(`   Ab t = ${gleich.toFixed(0)} s liegt die Schranke wieder ueber der echten Hoehe.`);
L();
L('   ZUSAETZLICH (unabhaengig von der Gebietseinteilung): der Chili-Durchflug');
L('   schiebt die SPIELUHR vor, die Serveruhr aber nicht.');
{
  const geschenk = 85.56 - 5; // Uhrschub am Gebietsanfang minus Flugdauer
  L(`   Ein Chili am Gebietsanfang schenkt ${geschenk.toFixed(1)} s Spieluhr in 5 s Echtzeit.`);
  for (const chilis of [0, 1, 2]) {
    for (const echt of [180, 300, 600]) {
      const spiel = echt + chilis * geschenk;
      const score = Math.floor(hoeheExakt(spiel));
      const gr2 = maxHoeheSql(echt);
      L(
        `     ${chilis} Chili(s), ${String(echt).padStart(3)} s Echtzeit -> Score ${String(score).padStart(4)} m, ` +
          `Schranke ${gr2.toFixed(0).padStart(4)} m  ${score > gr2 ? 'ABGEWIESEN' : 'ok'}`,
      );
    }
  }
}
