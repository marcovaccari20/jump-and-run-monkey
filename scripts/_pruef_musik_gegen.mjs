/**
 * GEGENPRUEFUNG (nur lesend) — unabhaengige Messung der Gebietsmusik.
 *
 *   node scripts/_pruef_musik_gegen.mjs
 *
 * Bewusst NICHT dieselbe Methode wie _pruef_musik.mjs: Lautheit wird hier
 * mit `ebur128` (echtes Integrated-Loudness-Filter) gemessen statt mit dem
 * Messmodus von loudnorm. Wenn beide dasselbe sagen, ist die Zahl belastbar.
 * Zusaetzlich echte Streamdauer via ffprobe-artigem Header-Parsing UND
 * Zaehlung der dekodierten Samples (packet-genau), weil "Duration:" bei
 * ogg/mp3 gern rundet.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';

import { CONFIG } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MUSIK = join(ROOT, 'public', 'musik');

function ff(args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** EBU R128 ueber den ebur128-Filter (andere Implementierung als loudnorm). */
function ebur128(datei) {
  const r = ff(['-i', datei, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const t = r.err;
  // Summary-Block am Ende
  const iM = t.match(/I:\s+(-?\d+\.\d+)\s+LUFS/g);
  const lraM = t.match(/LRA:\s+(-?\d+\.\d+)\s+LU/g);
  const tpM = t.match(/Peak:\s*\n?\s*Peak:\s+(-?\d+\.\d+)/);
  const truePeak = [...t.matchAll(/True peak:[\s\S]*?Peak:\s+(-?\d+\.\d+)\s+dBFS/g)];
  return {
    i: iM ? Number(iM[iM.length - 1].match(/(-?\d+\.\d+)/)[1]) : null,
    lra: lraM ? Number(lraM[lraM.length - 1].match(/(-?\d+\.\d+)/)[1]) : null,
    tp: truePeak.length ? Number(truePeak[truePeak.length - 1][1]) : (tpM ? Number(tpM[1]) : null),
    roh: t,
  };
}

/** Exakte Dauer: dekodieren und die letzte out_time nehmen. */
function dauerExakt(datei) {
  const r = ff(['-i', datei, '-f', 'null', '-', '-progress', 'pipe:1', '-nostats']);
  const m = [...r.out.matchAll(/out_time_us=(\d+)/g)];
  if (m.length) return Number(m[m.length - 1][1]) / 1e6;
  return null;
}

function dauerHeader(datei) {
  const r = ff(['-i', datei]);
  const m = r.err.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

const stages = CONFIG.wall.stages.map((s) => s.name);
const gold = CONFIG.goldbanane?.gebiet?.name ?? null;
const namen = [...stages, ...(gold ? [gold] : [])];

const daDrin = readdirSync(MUSIK).filter((f) => /\.(ogg|mp3)$/.test(f));
const basen = [...new Set(daDrin.map((f) => f.replace(/\.(ogg|mp3)$/, '')))].sort();
const ueberzaehlig = basen.filter((b) => !namen.includes(b));

console.log('== DECKUNG ==');
console.log(`  Gebiete in CONFIG.wall.stages: ${stages.length}`);
console.log(`  Gold-Gebiet: ${gold}`);
console.log(`  CONFIG.klang.musik.boss: ${JSON.stringify(CONFIG.klang.musik.boss ?? null)}`);
console.log(`  Dateien im Ordner: ${daDrin.length} (${basen.length} Basen)`);
console.log(`  ohne Gebiet: ${ueberzaehlig.join(', ') || '(keine)'}`);
const fehlend = [];
for (const n of namen) {
  for (const f of ['ogg', 'mp3']) if (!existsSync(join(MUSIK, `${n}.${f}`))) fehlend.push(`${n}.${f}`);
}
console.log(`  fehlend: ${fehlend.join(', ') || 'keine'}`);

console.log('\n== LAUTHEIT (ebur128-Filter, NICHT loudnorm) + DAUER ==');
console.log('Name        Fmt  I(LUFS)  Abw    TP(dBFS)  LRA   Hdr-s   Exakt-s   MB');
console.log('-'.repeat(78));

const rows = [];
for (const n of [...namen, ...ueberzaehlig]) {
  for (const fmt of ['ogg', 'mp3']) {
    const p = join(MUSIK, `${n}.${fmt}`);
    if (!existsSync(p)) continue;
    const l = ebur128(p);
    const dh = dauerHeader(p);
    const de = dauerExakt(p);
    const mb = statSync(p).size / 1048576;
    rows.push({ n, fmt, i: l.i, tp: l.tp, lra: l.lra, dh, de, mb, extra: !namen.includes(n) });
    console.log(
      `${n.padEnd(11)} ${fmt}  ${String(l.i).padStart(7)}  ` +
        `${(l.i === null ? '?' : ((l.i + 17 >= 0 ? '+' : '') + (l.i + 17).toFixed(2))).padStart(6)}  ` +
        `${String(l.tp).padStart(8)}  ${String(l.lra).padStart(4)}  ` +
        `${(dh ?? 0).toFixed(1).padStart(6)}  ${(de ?? 0).toFixed(2).padStart(8)}  ${mb.toFixed(2).padStart(5)}`,
    );
  }
}

const gemessen = rows.filter((r) => r.i !== null && !r.extra);
const abw = gemessen.map((r) => r.i + 17);
console.log(`\n  gemessene Dateien: ${gemessen.length}, verschiedene I-Werte: ${new Set(gemessen.map((r) => r.i)).size}`);
console.log(`  groesste Abweichung: ${Math.max(...abw.map(Math.abs)).toFixed(2)} LU`);
for (const f of ['ogg', 'mp3']) {
  const g = gemessen.filter((r) => r.fmt === f);
  const min = g.reduce((a, b) => (a.i < b.i ? a : b));
  const max = g.reduce((a, b) => (a.i > b.i ? a : b));
  console.log(`  ${f}: Spannweite ${(max.i - min.i).toFixed(2)} LU  (leisestes ${min.n} ${min.i}, lautestes ${max.n} ${max.i})`);
}
const ueber1 = gemessen.filter((r) => Math.abs(r.i + 17) > 1);
console.log(`  ueber 1 LU daneben: ${ueber1.length ? ueber1.map((r) => `${r.n}.${r.fmt} ${r.i}`).join(', ') : 'keine'}`);

/* ---- Groessen ---- */
console.log('\n== GROESSEN (public/musik) ==');
let so = 0, sm = 0, sog = 0, smg = 0;
for (const r of rows) {
  if (r.fmt === 'ogg') { so += r.mb; if (!r.extra) sog += r.mb; }
  else { sm += r.mb; if (!r.extra) smg += r.mb; }
}
console.log(`  ogg gesamt ${so.toFixed(2)} MB (ohne boss ${sog.toFixed(2)} MB)`);
console.log(`  mp3 gesamt ${sm.toFixed(2)} MB (ohne boss ${smg.toFixed(2)} MB)`);
console.log(`  zusammen   ${(so + sm).toFixed(2)} MB  | totes Gewicht boss: ${(so - sog + sm - smg).toFixed(2)} MB`);

/* ---- Schleife gegen Gebietsdauer, mit den ECHTEN Gebietslaengen ---- */
console.log('\n== SCHLEIFE GEGEN GEBIETSDAUER ==');
const st = CONFIG.wall.stages;
const loopSec = CONFIG.wall.stageLoopSeconds;
const m = CONFIG.klang.musik;
console.log(`  stageLoopSeconds=${loopSec}  schleifeFade=${m.schleifeFade}  tempoMax=${m.tempoMax}  tempoProGebiet=${m.tempoProGebiet}`);
console.log('  Gebiet      Dauer(Gebiet)  Tempo   Stueck-s  real-s  Durchl.  Blende-ab(real)');
for (let i = 0; i < st.length; i++) {
  const naechste = st[i + 1] ? st[i + 1].afterSeconds : st[i].afterSeconds + loopSec;
  const gebietDauer = naechste - st[i].afterSeconds;
  // Tempo: _gebietWechsel = i (Wechsel seit Rundenbeginn), Gebiet 1 -> 0 Wechsel
  const tempo = Math.min(m.tempoMax, 1 + i * m.tempoProGebiet);
  const r = rows.find((x) => x.n === st[i].name && x.fmt === 'ogg');
  const stueck = r.de;
  const real = stueck / tempo;
  const fade = Math.min(m.schleifeFade, real / 3);
  const durchl = gebietDauer / real;
  console.log(
    `  ${st[i].name.padEnd(11)} ${String(gebietDauer).padStart(6)}s      ` +
      `${tempo.toFixed(3)}  ${stueck.toFixed(1).padStart(8)}  ${real.toFixed(1).padStart(6)}  ` +
      `${durchl.toFixed(2).padStart(6)}  ${(real - fade).toFixed(1).padStart(8)}s` +
      `${durchl > 1 ? '   <- Schleife hoerbar' : ''}`,
  );
}

console.log('\n  GOLD (Gebiet dauert ' + CONFIG.goldbanane.sekunden + ' s):');
const goldRow = rows.find((x) => x.n === 'gold' && x.fmt === 'ogg');
const goldMp3 = rows.find((x) => x.n === 'gold' && x.fmt === 'mp3');
for (const [label, row] of [['ogg', goldRow], ['mp3', goldMp3]]) {
  for (const t of [1.0, 1.1, 1.2, 1.3, 1.35]) {
    const real = row.de / t;
    const fade = Math.min(m.schleifeFade, real / 3);
    const blende = real - fade;
    console.log(
      `    ${label} Tempo ${t.toFixed(2)}: Stueck ${row.de.toFixed(2)}s -> real ${real.toFixed(2)}s, ` +
        `Blende ab ${blende.toFixed(2)}s ` +
        `${blende < CONFIG.goldbanane.sekunden ? '<- IM GEBIET HOERBAR' : '(nach dem Gebiet)'}` +
        `${real < CONFIG.goldbanane.sekunden ? '  + Stueck endet vor dem Gebiet' : ''}`,
    );
  }
}

/* ---- Ab welchem Gebiet ist tempoMax erreicht? ---- */
console.log('\n== TEMPO ==');
for (let w = 0; w <= 14; w++) {
  const t = Math.min(m.tempoMax, 1 + w * m.tempoProGebiet);
  if (w <= 2 || t >= m.tempoMax - 0.0001) console.log(`  ${w} Wechsel (Gebiet ${w + 1}): Tempo ${t.toFixed(3)}${t >= m.tempoMax ? ' = Deckel' : ''}`);
  if (t >= m.tempoMax) break;
}
