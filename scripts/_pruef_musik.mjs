/**
 * MESSSKRIPT (nur lesend) — Gebietsmusik pruefen.
 *
 *   node scripts/_pruef_musik.mjs
 *
 * 1. Deckung: jedes Gebiet aus CONFIG.wall.stages (+ Gold, + Boss) gegen
 *    public/musik/, beide Formate.
 * 2. Lautheit nach EBU R128 via loudnorm im Messmodus.
 *    WICHTIG: spawnSync statt execFileSync, stderr wird IMMER gelesen —
 *    mit "-f null -" endet ffmpeg mit Code 0 und execFileSync liefert dann
 *    gar kein stderr, die Messung waere leer.
 * 3. Dauer, Groesse.
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
const ZIEL_LUFS = -17;

/* ---------------------------------------------------------------- Messen */

/** ffmpeg aufrufen und stderr IMMER zurueckgeben, egal welcher Exitcode. */
function ff(args) {
  const r = spawnSync(ffmpeg, ['-hide_banner', ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** EBU R128 Messung (loudnorm, Messmodus). */
function lautheit(datei) {
  const r = ff([
    '-i', datei,
    '-af', `loudnorm=I=${ZIEL_LUFS}:TP=-1.5:LRA=11:print_format=json`,
    '-f', 'null', '-',
  ]);
  const text = r.err;
  const start = text.lastIndexOf('{');
  const ende = text.lastIndexOf('}');
  if (start < 0 || ende < 0) {
    return { fehler: `keine JSON-Messung (exit ${r.code}, stderr ${text.length} Zeichen)` };
  }
  try {
    const j = JSON.parse(text.slice(start, ende + 1));
    return {
      i: Number(j.input_i),
      tp: Number(j.input_tp),
      lra: Number(j.input_lra),
      thresh: Number(j.input_thresh),
    };
  } catch (e) {
    return { fehler: `JSON kaputt: ${e.message}` };
  }
}

/** Spieldauer in Sekunden — ohne Ausgabeziel, Kopfzeilen stehen in stderr. */
function dauer(datei) {
  const r = ff(['-i', datei]);
  const m = r.err.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

const kb = (p) => statSync(p).size / 1024;

/* ------------------------------------------------------------ Gebietsliste */

const stages = CONFIG.wall.stages.map((s) => s.name);
const goldName = CONFIG.goldbanane?.gebiet?.name ?? null;
/* Der Bosskampf wurde entfernt; `klang.musik.boss` gibt es nicht mehr.
 *
 * Die Abfrage bleibt der Vollständigkeit halber stehen — falls jemand die
 * Bossmusik wieder einträgt, prüft dieses Skript sie automatisch mit. Die
 * AUSGABE unten sagt jetzt aber nicht mehr „FEHLT IN DER CONFIG", denn das
 * las sich wie ein Mangel, obwohl es der gewollte Zustand ist. */
const bossDatei = CONFIG.klang?.musik?.boss?.datei ?? null;

const erwartet = [
  ...stages.map((n, i) => ({ name: n, quelle: `stages[${i}]` })),
  ...(goldName ? [{ name: goldName, quelle: 'goldbanane.gebiet.name' }] : []),
  ...(bossDatei ? [{ name: bossDatei, quelle: 'klang.musik.boss.datei' }] : []),
];

console.log(`CONFIG.wall.stages: ${stages.length} Gebiete`);
console.log(`Gold-Gebiet: ${goldName ?? '(keins)'}`);
console.log(`Bossmusik: ${bossDatei ?? '(kein Bosskampf — so gewollt)'}`);
console.log(`Ordner: ${MUSIK}\n`);

const daDrin = readdirSync(MUSIK).filter((f) => /\.(ogg|mp3)$/.test(f));
const basen = [...new Set(daDrin.map((f) => f.replace(/\.(ogg|mp3)$/, '')))].sort();

/* -------------------------------------------------------- 1. Deckung */

console.log('== 1. DECKUNG =========================================');

/* NUR DAS AUSGELIEFERTE FORMAT ZÄHLT.
 *
 * Hier wurden früher BEIDE Formate verlangt. Seit das Spiel bewusst nur MP3
 * ausliefert (`CONFIG.klang.musik.format` — Ogg fehlt auf älteren iPhones,
 * und beides doppelt zu liefern machte 54 von 63 MB aus), meldete die
 * Prüfung „fehlend: 22" für Dateien, die absichtlich nicht da sind. Ein
 * Daueralarm, der immer leuchtet, wird nicht mehr gelesen — und verdeckt
 * dann den Tag, an dem wirklich ein Stück fehlt. */
const FORMAT = CONFIG.klang?.musik?.format ?? 'mp3';
const fehlend = [];
for (const g of erwartet) {
  const hat = existsSync(join(MUSIK, `${g.name}.${FORMAT}`));
  const andere = FORMAT === 'mp3' ? 'ogg' : 'mp3';
  const hatAndere = existsSync(join(MUSIK, `${g.name}.${andere}`));
  if (!hat) fehlend.push({ ...g, hat });
  console.log(
    `  ${g.name.padEnd(11)} ${FORMAT}:${hat ? 'ja ' : 'NEIN'}` +
      `  ${hatAndere ? `(${andere} liegt daneben, wird nicht ausgeliefert)` : ''}  ${g.quelle}`,
  );
}
console.log(`\n  ausgeliefertes Format laut CONFIG.klang.musik.format: ${FORMAT}`);
const ueberzaehlig = basen.filter((b) => !erwartet.some((g) => g.name === b));
console.log(`\n  fehlend: ${fehlend.length}`);
console.log(`  Dateien ohne Gebiet: ${ueberzaehlig.length ? ueberzaehlig.join(', ') : '(keine)'}`);

/* -------------------------------------------------- 2./3. Lautheit + Dauer */

console.log('\n== 2./3. LAUTHEIT (EBU R128) + DAUER ==================');
console.log(
  'Gebiet      | Fmt | LUFS   | Abw.  | TP dBTP | LRA  | Dauer   |    KB',
);
console.log('-'.repeat(74));

const zeilen = [];
for (const g of erwartet) {
  for (const fmt of ['ogg', 'mp3']) {
    const p = join(MUSIK, `${g.name}.${fmt}`);
    if (!existsSync(p)) continue;
    const l = lautheit(p);
    const d = dauer(p);
    const groesse = kb(p);
    if (l.fehler) {
      console.log(`${g.name.padEnd(11)} | ${fmt} | MESSUNG FEHLGESCHLAGEN: ${l.fehler}`);
      zeilen.push({ name: g.name, fmt, fehler: l.fehler, d, groesse });
      continue;
    }
    const abw = l.i - ZIEL_LUFS;
    zeilen.push({ name: g.name, fmt, ...l, abw, d, groesse });
    console.log(
      `${g.name.padEnd(11)} | ${fmt} | ${l.i.toFixed(2).padStart(6)} | ` +
        `${(abw >= 0 ? '+' : '') + abw.toFixed(2).padStart(5)} | ` +
        `${l.tp.toFixed(2).padStart(7)} | ${l.lra.toFixed(1).padStart(4)} | ` +
        `${(d === null ? '?' : d.toFixed(1) + 's').padStart(7)} | ` +
        `${groesse.toFixed(0).padStart(5)}`,
    );
  }
}

const daneben = zeilen.filter((z) => !z.fehler && Math.abs(z.abw) > 1);
console.log(`\nMehr als 1 LU neben ${ZIEL_LUFS} LUFS: ${daneben.length}`);
for (const z of daneben) {
  console.log(`  ${z.name}.${z.fmt}  ${z.i.toFixed(2)} LUFS  (${z.abw > 0 ? '+' : ''}${z.abw.toFixed(2)} LU)`);
}

const leer = zeilen.filter((z) => z.fehler);
if (leer.length) console.log(`\nLeere Messungen: ${leer.length} — ${leer.map((z) => z.name + '.' + z.fmt).join(', ')}`);

/* ------------------------------------------------------------ 4. Groessen */

console.log('\n== 4. GROESSEN ========================================');
let sOgg = 0, sMp3 = 0;
for (const z of zeilen) {
  if (z.fmt === 'ogg') sOgg += z.groesse;
  else sMp3 += z.groesse;
}
console.log(`  ogg gesamt: ${(sOgg / 1024).toFixed(2)} MB (${zeilen.filter((z) => z.fmt === 'ogg').length} Dateien)`);
console.log(`  mp3 gesamt: ${(sMp3 / 1024).toFixed(2)} MB (${zeilen.filter((z) => z.fmt === 'mp3').length} Dateien)`);
console.log(`  beide zusammen (das liegt im Build): ${((sOgg + sMp3) / 1024).toFixed(2)} MB`);

/* AUF DAS FORMAT ABSTELLEN, DAS WIRKLICH IM PAKET LIEGT.
 *
 * Hier stand fest `fmt === 'ogg'`. Seit das Spiel nur noch MP3 ausliefert
 * (CONFIG.klang.musik.format), war diese Liste leer: der Schnitt kam als NaN
 * heraus, und ein paar Zeilen weiter stürzte das Skript mit "Cannot read
 * properties of undefined" ab — mitten in der Prüfung, die es durchführen
 * sollte. Ein Prüfwerkzeug, das selbst abstürzt, prüft nichts. */
const FMT = zeilen.some((z) => z.fmt === 'ogg') ? 'ogg' : 'mp3';
const oggs = zeilen.filter((z) => z.fmt === FMT).sort((a, b) => b.groesse - a.groesse);
const summeFmt = FMT === 'ogg' ? sOgg : sMp3;
console.log(`  groesste Datei (${FMT}): ${oggs[0]?.name} ${(oggs[0]?.groesse / 1024).toFixed(2)} MB`);
console.log(`  Schnitt je Gebiet (${FMT}): ${(summeFmt / oggs.length / 1024).toFixed(2)} MB`);

/* Was ein Spieler tatsaechlich zieht: das Spiel streamt pro Gebiet.
 * Deshalb: Erstladung = nur das erste Gebiet, danach je Gebietswechsel eins. */
const g1 = oggs.find((z) => z.name === stages[0]);
console.log(
  `\n  Erstes Gebiet allein (${stages[0]}.${FMT}): ` +
    `${g1 ? (g1.groesse / 1024).toFixed(2) : '?'} MB`,
);

/* ---------------------------------------------------- 5. Dauer vs. Gebiet */

console.log('\n== 5. DAUER GEGEN GEBIETSDAUER ========================');
/* DIE MITTLERE ECHTE GEBIETSLÄNGE, nicht sekundenProWand.
 *
 * Hier stand `CONFIG.difficulty.sekundenProWand` (132). Seit die Gebiete an
 * eigenen Grenzen hängen, dauern sie 24 bis 90 Sekunden — die Spalte
 * "Durchläufe je Gebiet" rechnete also mit einer Gebietsdauer, die es im
 * Spiel nirgends gibt, und meldete gut doppelt so viele Durchläufe wie
 * tatsächlich vorkommen. Genau derselbe Fehler wie in balance.mjs. */
const g = CONFIG.difficulty?.gebietsGrenzen;
const sekProWand =
  g && g.length > 1 ? g[g.length - 1] / (g.length - 1) : (CONFIG.difficulty?.sekundenProWand ?? null);
console.log(`  mittlere Gebietsdauer: ${sekProWand?.toFixed(1)} s (aus den Gebietsgrenzen)`);
console.log(`  Gold-Gebiet dauert: ${CONFIG.goldbanane?.sekunden} s`);
console.log(`  schleifeFade: ${CONFIG.klang.musik.schleifeFade} s, tempoMax: ${CONFIG.klang.musik.tempoMax}`);
for (const z of oggs.sort((a, b) => (a.d ?? 0) - (b.d ?? 0))) {
  const schleifenProGebiet = sekProWand && z.d ? (sekProWand / z.d).toFixed(1) : '?';
  const beiTempoMax = z.d ? (z.d / CONFIG.klang.musik.tempoMax).toFixed(1) : '?';
  console.log(
    `  ${z.name.padEnd(11)} ${(z.d ?? 0).toFixed(1).padStart(6)}s  ` +
      `bei tempoMax ${beiTempoMax.padStart(6)}s  ->  ${String(schleifenProGebiet).padStart(5)} Durchlaeufe je Gebiet`,
  );
}
