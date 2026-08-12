/**
 * MESSSKRIPT (nur lesend) — faellt die Schleife auf?
 *
 *   node scripts/_pruef_musik_schleife.mjs
 *
 * Rechnet je Gebiet: wie lange dauert es, wie schnell laeuft dort die Musik
 * (Game._musikTempo, src/core/Game.js:1320), wie oft laeuft das Stueck also
 * durch — und ab welcher Sekunde des Gebiets die erste Schleifenblende
 * hoerbar wird.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';

import { CONFIG } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MUSIK = join(resolve(__dirname, '..'), 'public', 'musik');

function dauer(datei) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', datei], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const m = (r.stderr ?? '').match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

const m = CONFIG.klang.musik;
const stages = CONFIG.wall.stages;
const loopSek = CONFIG.wall.stageLoopSeconds;

console.log('Gebiet       Dauer  Tempo  Stueck  real   Durchl.  1. Schleife bei');
console.log('-'.repeat(70));

const zeilen = [];
for (let i = 0; i < stages.length; i++) {
  const s = stages[i];
  const naechste = stages[i + 1];
  const gebietSek = naechste ? naechste.afterSeconds - s.afterSeconds : loopSek;
  // Gebietswechsel seit Rundenbeginn == Index (Runde faengt bei stages[0] an).
  const tempo = Math.min(m.tempoMax, 1 + i * m.tempoProGebiet);
  const p = join(MUSIK, `${s.name}.ogg`);
  if (!existsSync(p)) continue;
  const d = dauer(p);
  const real = d / tempo;
  const durchl = gebietSek / real;
  const fade = Math.min(m.schleifeFade, d / tempo / 3);
  const ersteSchleife = real - fade;
  zeilen.push({ name: s.name, gebietSek, tempo, d, real, durchl, ersteSchleife });
  console.log(
    `${s.name.padEnd(11)} ${String(gebietSek).padStart(4)}s  ${tempo.toFixed(3)}  ` +
      `${d.toFixed(1).padStart(6)}s ${real.toFixed(1).padStart(6)}s  ${durchl.toFixed(2).padStart(5)}   ` +
      `${ersteSchleife < gebietSek ? ersteSchleife.toFixed(1) + 's' : 'gar nicht'}`,
  );
}

console.log('\nGebiete, in denen das Stueck mehr als 1x komplett durchlaeuft:');
const oft = zeilen.filter((z) => z.durchl > 1);
for (const z of oft) console.log(`  ${z.name}: ${z.durchl.toFixed(2)}x`);
if (!oft.length) console.log('  (keins)');

/* ------------------------------------------------------------- Gold */

console.log('\n== GOLD-GEBIET ========================================');
const gsek = CONFIG.goldbanane.sekunden;
const gd = dauer(join(MUSIK, 'gold.ogg'));
console.log(`  Gold-Gebiet dauert ${gsek}s, gold.ogg ist ${gd.toFixed(1)}s lang.`);
for (const t of [1, 1.1, 1.2, 1.3, m.tempoMax]) {
  const real = gd / t;
  const fade = Math.min(m.schleifeFade, real / 3);
  const schleifeBei = real - fade;
  console.log(
    `  Tempo ${t.toFixed(3)}: real ${real.toFixed(1)}s  ` +
      `-> ${real >= gsek ? 'reicht' : 'ZU KURZ'}, Schleifenblende setzt bei ` +
      `${schleifeBei.toFixed(1)}s ein ${schleifeBei < gsek ? '(IM Gold-Gebiet hoerbar)' : '(nach dem Gold-Gebiet)'}`,
  );
}
const nMax = Math.ceil((m.tempoMax - 1) / m.tempoProGebiet);
console.log(`  tempoMax (${m.tempoMax}) ist ab dem ${nMax + 1}. Gebiet erreicht (${nMax} Wechsel x ${m.tempoProGebiet}).`);

/* ------------------------------------------------------- Groessen dist */

console.log('\n== GROESSEN =========================================');
const dist = join(resolve(__dirname, '..'), 'dist');
if (existsSync(dist)) {
  const { readdirSync } = await import('node:fs');
  const alles = [];
  const gehe = (d, rel = '') => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) gehe(p, rel + e.name + '/');
      else alles.push({ pfad: rel + e.name, kb: statSync(p).size / 1024 });
    }
  };
  gehe(dist);
  const gesamt = alles.reduce((a, x) => a + x.kb, 0);
  const musik = alles.filter((x) => x.pfad.startsWith('musik/'));
  const musikKb = musik.reduce((a, x) => a + x.kb, 0);
  const ogg = musik.filter((x) => x.pfad.endsWith('.ogg')).reduce((a, x) => a + x.kb, 0);
  const mp3 = musik.filter((x) => x.pfad.endsWith('.mp3')).reduce((a, x) => a + x.kb, 0);
  console.log(`  dist gesamt:        ${(gesamt / 1024).toFixed(2)} MB (${alles.length} Dateien)`);
  console.log(`  davon musik/:       ${(musikKb / 1024).toFixed(2)} MB (${musik.length} Dateien)`);
  console.log(`    ogg ${(ogg / 1024).toFixed(2)} MB / mp3 ${(mp3 / 1024).toFixed(2)} MB`);
  console.log(`  dist OHNE Musik:    ${((gesamt - musikKb) / 1024).toFixed(2)} MB`);
  console.log(`  Musikanteil:        ${((musikKb / gesamt) * 100).toFixed(1)} %`);
  const top = alles.filter((x) => !x.pfad.startsWith('musik/')).sort((a, b) => b.kb - a.kb).slice(0, 8);
  console.log('  groesste Nicht-Musik-Dateien:');
  for (const t of top) console.log(`    ${t.pfad.padEnd(46)} ${(t.kb / 1024).toFixed(2)} MB`);
} else {
  console.log('  dist fehlt — erst `npm run build`.');
}
