/**
 * GEGENPRÜFUNG zum Bericht "gebiet1".
 * Rechnet unabhängig aus CONFIG + echter DifficultyCurve nach.
 * Ändert nichts am Spielcode.
 */
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';

const D = CONFIG.difficulty;
const stages = CONFIG.wall.stages;
const nf = (x, n = 3) => Number(x).toFixed(n);

console.log('=== 0. Konstanten aus CONFIG ===');
console.log({
  sekundenProWand: D.sekundenProWand,
  proWand: D.proWand,
  tempoExponent: D.tempoExponent,
  tempoStart: D.tempo.start,
  tempoMax: D.tempo.max,
  scrollAnteil: D.tempo.scrollAnteil,
  dichteStart: D.dichte.start,
  unitsPerMeter: CONFIG.score.unitsPerMeter,
  stageLoopSeconds: CONFIG.wall.stageLoopSeconds,
  stageCount: stages.length,
});

const k = (Math.log(D.proWand) * D.tempoExponent) / D.sekundenProWand;
const v0 = D.tempo.start * D.tempo.scrollAnteil;
const tDeckel = Math.log(D.tempo.max / D.tempo.start) / k;
const H = (t) => (t <= tDeckel
  ? (v0 / k) * (Math.exp(k * t) - 1)
  : (v0 / k) * (Math.exp(k * tDeckel) - 1) + D.tempo.max * D.tempo.scrollAnteil * (t - tDeckel));
console.log('k =', k, ' v0 =', v0, ' tDeckel =', nf(tDeckel, 2));

console.log('\n=== 1. Höhe in Gebiet 1 ===');
console.log('H(55) exakt          =', nf(H(55), 4));
// Simulation mit der echten Kurve, dt = 1/60 (wie _updatePlaying)
function simHoehe(tEnd, dt = 1 / 60) {
  const d = new DifficultyCurve(D);
  let h = 0, t = 0;
  while (t < tEnd - 1e-12) {
    const s = Math.min(dt, tEnd - t);
    // Reihenfolge wie in Game._updatePlaying: erst difficulty.update, dann scrollSpeed
    d.update(s);
    h += d.scrollSpeed * s;
    t += s;
  }
  return { h, d };
}
const s55 = simHoehe(55);
console.log('H(55) Simulation     =', nf(s55.h, 4), ' (HUD zeigt', Math.floor(s55.h), 'm)');
// 100 m erreicht bei
let tHundert = Math.log(1 + (100 * k) / v0) / k;
console.log('100.000 m bei t      =', nf(tHundert, 3), 's');
console.log('Fehlbetrag bei 55 s  =', nf(100 - H(55), 3), 'm =', nf((100 - H(55)) / 1, 3), '→',
  nf((H(55) / 100 - 1) * 100, 2), '%');
console.log('afterSeconds 55.4 →  ', nf(H(55.4), 3), 'm');
console.log('afterSeconds 55.33 → ', nf(H(55.33), 3), 'm');

console.log('\n=== 2. Kette der afterSeconds ===');
const abst = stages.slice(1).map((s, i) => s.afterSeconds - stages[i].afterSeconds);
console.log('afterSeconds:', stages.map((s) => s.afterSeconds).join(', '));
console.log('Abstände    :', abst.join(', '));
console.log('alle ab Index1 == 132 :', abst.slice(1).every((a) => a === 132));
console.log('Namen doppelt?', new Set(stages.map((s) => s.name)).size !== stages.length);
console.log('near doppelt?', new Set(stages.map((s) => s.near)).size !== stages.length);
const looks = Object.keys(CONFIG.rock.looks ?? {});
console.log('rock.looks:', looks.length, looks.join(','));
const hazards = stages.map((s) => s.hazard);
console.log('hazard ohne Look:', hazards.filter((h) => !looks.includes(h)));
console.log('Look ungenutzt  :', looks.filter((l) => !hazards.includes(l)));

console.log('\n=== 3. Chili-Durchflug ===');
const C = CONFIG.chili;
function chiliFlug(elapsed) {
  const dauerGebiet = D.sekundenProWand;
  const imGebiet = elapsed % dauerGebiet;
  const restGebiet = dauerGebiet - imGebiet;
  const strecke = Math.max(restGebiet + dauerGebiet * C.einstieg, C.minSekunden * C.tempoFaktor);
  const dauerBeiAcht = strecke / C.tempoFaktor;
  const dauer = Math.max(C.minSekunden, Math.min(C.sekunden, dauerBeiAcht));
  // Uhrschub = strecke (uhrRest), plus die echte Flugdauer die ebenfalls in elapsed geht
  return { restGebiet, strecke, dauer, ende: elapsed + strecke + dauer };
}
function gebietIndex(t) {
  const lastAt = stages[stages.length - 1].afterSeconds;
  if (t < lastAt) {
    let idx = 0;
    for (let i = 0; i < stages.length; i++) if (t >= stages[i].afterSeconds) idx = i;
    return idx;
  }
  const extra = Math.floor((t - lastAt) / CONFIG.wall.stageLoopSeconds);
  return (stages.length - 1 + extra) % stages.length;
}
for (const start of [57, 60, 70, 100, 150, 189, 192, 250, 321, 400, 1910, 1950]) {
  const f = chiliFlug(start);
  console.log(
    `start=${String(start).padStart(4)}  rest=${nf(f.restGebiet, 2).padStart(7)}  strecke=${nf(f.strecke, 2).padStart(7)}`,
    ` dauer=${nf(f.dauer, 2)}  ende=${nf(f.ende, 2).padStart(8)}`,
    ` Gebiet ${gebietIndex(start) + 1} (${stages[gebietIndex(start)].name}) → ${gebietIndex(f.ende) + 1} (${stages[gebietIndex(f.ende)].name})`,
    gebietIndex(f.ende) === gebietIndex(start) ? '  *** GLEICHES GEBIET ***' : '',
  );
}
// Wie tief im Gebiet endet er?
{
  const start = 190;
  const f = chiliFlug(start);
  const i = gebietIndex(f.ende);
  const von = stages[i].afterSeconds;
  const bis = i + 1 < stages.length ? stages[i + 1].afterSeconds : von + 132;
  console.log(`Beispiel 190 s: Ende ${nf(f.ende, 2)} liegt bei ${nf(((f.ende - von) / (bis - von)) * 100, 1)} % des Gebiets`);
}

console.log('\n=== 3b. Sturzflug-Uhr ===');
const dauerSturz = stages.length > 1 ? stages[1].afterSeconds - stages[0].afterSeconds : 132;
console.log('Game.js:1118 dauer =', dauerSturz, '(sollte Gebietslänge sein: 132)');
const S = CONFIG.sturzflug;
for (const gebiet of [2, 3, 5, 9, 12]) {
  const i = Math.min(S.proGebiet.stufen.length - 1, gebiet - S.abGebiet);
  const n = Math.min(S.proGebiet.max, S.proGebiet.stufen[i]);
  const abschnitt = dauerSturz / (n + 1);
  const zeiten = Array.from({ length: n }, (_, j) => nf(abschnitt * (j + 1), 1));
  const letzte = abschnitt * n;
  console.log(`Gebiet ${gebiet}: n=${n} abschnitt=${nf(abschnitt, 2)}  Angriffe bei ${zeiten.join(' / ')}  danach ruhig ${nf(132 - letzte, 1)} s (von 132)`);
}

console.log('\n=== 3c. Anzeige "noch X m" ===');
function anzeige(t) {
  const d = new DifficultyCurve(D);
  d.elapsed = t;
  const idx = gebietIndex(t);
  const naechster = (idx + 1) % stages.length;
  let zielZeit;
  const letzte = stages[stages.length - 1];
  if (idx >= stages.length - 1 || t >= letzte.afterSeconds) {
    const runde = Math.floor((t - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds) + 1;
    zielZeit = letzte.afterSeconds + runde * CONFIG.wall.stageLoopSeconds;
  } else zielZeit = stages[naechster].afterSeconds;
  const rest = Math.max(0, zielZeit - t);
  return { angezeigt: rest * d.scrollSpeed, echt: H(zielZeit) - H(t), zielZeit };
}
for (const t of [0, 10, 20, 30, 40, 50, 54]) {
  const a = anzeige(t);
  console.log(`t=${String(t).padStart(3)}  angezeigt ${nf(a.angezeigt, 1).padStart(6)} m   echt ${nf(a.echt, 1).padStart(6)} m   Diff ${nf(a.angezeigt - a.echt, 2)}`);
}
{
  const a = anzeige(55);
  console.log(`t= 55 (132-s-Gebiet)  angezeigt ${nf(a.angezeigt, 1)}  echt ${nf(a.echt, 1)}  Diff ${nf(a.angezeigt - a.echt, 2)}`);
  const b = anzeige(1903);
  console.log(`t=1903 (Schleife)     angezeigt ${nf(b.angezeigt, 1)}  echt ${nf(b.echt, 1)}  Ziel ${b.zielZeit}`);
}

console.log('\n=== 4. Härte ===');
function h(t) { return Math.pow(D.proWand, t / D.sekundenProWand); }
function tempo(t) { return Math.min(D.tempo.max, D.tempo.start * Math.pow(h(t), D.tempoExponent)); }
const grenzen = [0, 55, 187, 319, 451];
for (let i = 0; i < grenzen.length - 1; i++) {
  const a = grenzen[i], b = grenzen[i + 1];
  console.log(`Gebiet ${i + 1}: ${a}..${b}  haerte ${nf(h(a), 4)} → ${nf(h(b), 4)}  Wachstum ${nf((h(b) / h(a) - 1) * 100, 2)} %`);
}
// mittlere Härte je Gebiet
function mittel(a, b) {
  return (h(b) - h(a)) / (Math.log(D.proWand) / D.sekundenProWand) / (b - a);
}
for (let i = 0; i < grenzen.length - 2; i++) {
  const m1 = mittel(grenzen[i], grenzen[i + 1]);
  const m2 = mittel(grenzen[i + 1], grenzen[i + 2]);
  console.log(`mittlere Härte ${i + 1}→${i + 2}: ${nf(m1, 4)} → ${nf(m2, 4)} = ${nf((m2 / m1 - 1) * 100, 2)} %`);
}
const d0 = new DifficultyCurve(D); d0.elapsed = 0;
const d55 = new DifficultyCurve(D); d55.elapsed = 55;
console.log('tempo   0 →55 :', nf(d0.tempo, 3), '→', nf(d55.tempo, 3), ` (+${nf((d55.tempo / d0.tempo - 1) * 100, 2)} %)`);
console.log('scroll  0 →55 :', nf(d0.scrollSpeed, 3), '→', nf(d55.scrollSpeed, 3));
console.log('vorwarn 0 →55 :', nf(d0.vorwarnung(), 3), '→', nf(d55.vorwarnung(), 3));
console.log('spawnDelay    :', nf(d0.spawnDelay, 3), '→', nf(d55.spawnDelay, 3));
console.log('tempo je volles Gebiet: +', nf((Math.pow(D.proWand, D.tempoExponent) - 1) * 100, 2), '%');
console.log('Höhe 0..55 =', nf(H(55), 1), ' Höhe 0..132 =', nf(H(132), 1));
console.log('Abwürfe 0..55 ≈', nf(anzahlAbwuerfe(0, 55), 1), '  0..132 ≈', nf(anzahlAbwuerfe(0, 132), 1));
function anzahlAbwuerfe(a, b) {
  const d = new DifficultyCurve(D);
  let t = a, n = 0;
  while (t < b) { d.elapsed = t; t += d.spawnDelay; if (t <= b) n++; }
  return n;
}

console.log('\n=== 5. bestenliste.sql ===');
const SQL = { tempo_start: 3.8, tempo_max: 16.0, scroll_anteil: 0.42, pro_wand: 1.25, sek_pro_wand: 132, tempo_exp: 0.62, klettern_max: 0.0, reserve: 1.08 };
const kS = (Math.log(SQL.pro_wand) * SQL.tempo_exp) / SQL.sek_pro_wand;
const v0S = SQL.tempo_start * SQL.scroll_anteil;
const tDeckelS = Math.log(SQL.tempo_max / SQL.tempo_start) / kS;
const grenze = (t) => SQL.reserve * (t <= tDeckelS
  ? (v0S / kS) * (Math.exp(kS * t) - 1)
  : (v0S / kS) * (Math.exp(kS * tDeckelS) - 1) + SQL.tempo_max * SQL.scroll_anteil * (t - tDeckelS));
console.log('kSQL == kGame:', Math.abs(kS - k) < 1e-15, ' tDeckel SQL =', nf(tDeckelS, 1), ' Game =', nf(tDeckel, 1));
console.log('Verhältnis in der Exponentialphase:', nf(SQL.reserve * SQL.tempo_start / D.tempo.start, 5));
console.log('t      echt      Schranke   Verhältnis   Zusatzzeit nötig');
for (const t of [30, 55, 187, 300, 600, 900, 1173, 1250, 1300, 1341, 1400, 1500, 1800]) {
  const e = H(t), g = grenze(t);
  let T = t;
  if (g < e) { let lo = t, hi = t + 400; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (grenze(m) < e) lo = m; else hi = m; } T = hi; }
  console.log(`${String(t).padStart(5)} ${nf(e, 1).padStart(9)} ${nf(g, 1).padStart(10)}   ${nf(g / e, 4)}      ${g >= e ? 'keine' : nf(T - t, 2) + ' s'}`);
}
// Ab wann rettet der zu hohe tempo_max?
{
  let lo = 1173, hi = 2000;
  for (let i = 0; i < 300; i++) { const m = (lo + hi) / 2; if (grenze(m) < H(m)) lo = m; else hi = m; }
  console.log('Schranke >= echte Höhe ab t =', nf(hi, 1), 's');
}
// Chili-Uhrschub gegen Serveruhr
{
  const f = chiliFlug(190);
  console.log(`Chili bei 190 s: Uhrschub ${nf(f.strecke, 2)} s Spielzeit in ${nf(f.dauer, 2)} s Echtzeit`);
}

console.log('\n=== 6. Münzen / Banane ===');
console.log('Münztakt =', nf(D.sekundenProWand / Math.max(1, CONFIG.coin.proGebiet), 3), 's → in Gebiet 1 (55 s):', nf(55 / (D.sekundenProWand / CONFIG.coin.proGebiet), 2), 'Münzen');
console.log('banana.abSekunde =', CONFIG.banana.abSekunde, '→ liegt in Gebiet', gebietIndex(CONFIG.banana.abSekunde) + 1, `(${stages[gebietIndex(CONFIG.banana.abSekunde)].name})`);
console.log('Ende Gebiet 2 =', stages[2].afterSeconds, 's; "letztes Viertel von Gebiet 2" wäre ab', stages[1].afterSeconds + 0.75 * 132, 's');

console.log('\n=== 7. rock.mix (abWand = elapsed/132) ===');
for (const m of CONFIG.rock.mix) {
  const t = m.abWand * D.sekundenProWand;
  console.log(`abWand ${String(m.abWand).padStart(4)} → t = ${String(t).padStart(6)} s → Gebiet ${gebietIndex(t) + 1} (${stages[gebietIndex(t)].name})`);
}

console.log('\n=== 8. Musik / Boss / Belohnungen am Wechselzähler ===');
const M = CONFIG.musik ?? {};
console.log('musik.tempoProGebiet =', M.tempoProGebiet, ' tempoMax =', M.tempoMax);
if (M.tempoProGebiet && M.tempoMax) {
  const nDeckel = Math.ceil((M.tempoMax - 1) / M.tempoProGebiet);
  const tDeckelMusik = nDeckel === 0 ? 0 : stages[Math.min(nDeckel, stages.length - 1)]?.afterSeconds;
  console.log(`Deckel ${M.tempoMax} ab ${nDeckel} Wechseln → Gebiet ${nDeckel + 1} → t = ${tDeckelMusik} s (früher ${nDeckel * 132} s)`);
}
console.log('boss.abGebiet =', CONFIG.boss.abGebiet, '→ ab t =', stages[CONFIG.boss.abGebiet - 1].afterSeconds, 's (früher', (CONFIG.boss.abGebiet - 1) * 132, 's)');
console.log('goldbanane.abGebiet =', CONFIG.goldbanane.abGebiet, ' chili.abGebiet =', CONFIG.chili.abGebiet, ' sturzflug.abGebiet =', CONFIG.sturzflug.abGebiet);

console.log('\n=== 9. stageIndexAt über 0..4000 s ===');
{
  const w = { cfg: CONFIG.wall };
  let bad = 0; const wechsel = [];
  let prev = gebietIndex(0);
  for (let t = 0; t <= 4000; t += 0.05) {
    const i = gebietIndex(t);
    if (!Number.isInteger(i) || i < 0 || i >= stages.length) bad++;
    if (i !== prev) { wechsel.push(nf(t, 2)); prev = i; }
  }
  console.log('ungültige Indizes:', bad);
  console.log('Wechsel bei:', wechsel.slice(0, 22).join(', '), '…');
}
