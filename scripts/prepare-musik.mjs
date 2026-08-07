/**
 * Macht aus den gelieferten Musikstücken web-taugliche Gebietsmusik.
 *
 *   npm run prep:musik
 *
 * WAS ES TUT UND WARUM
 *
 * 1. TON AUS DEM VIDEO. Eine der Vorlagen ist ein .mp4. Im Spiel darf davon
 *    nichts zu sehen sein — hier wird nur die Tonspur herausgezogen, das Bild
 *    fällt weg.
 *
 * 2. LAUTSTÄRKEN ANGLEICHEN. Zwölf einzeln erzeugte Stücke sind nie gleich
 *    laut. Ohne Angleich reisst einem der Wechsel ins nächste Gebiet die
 *    Ohren ab oder man hört plötzlich nichts mehr. Gemessen und korrigiert
 *    wird nach EBU R128 (`loudnorm`) — dasselbe Verfahren, das Radio und
 *    Streamingdienste benutzen. Ziel: -17 LUFS, leiser als Musik sonst
 *    üblich, weil darüber noch Spielgeräusche liegen.
 *
 * 3. KLEINER MACHEN. 47 MB Vorlagen sind für ein Browserspiel zu viel: das
 *    Spiel OHNE Musik wiegt rund 6 MB, die Musik wäre also das Achtfache. Bei 96 kbit/s stereo bleibt genug
 *    Qualität für Hintergrundmusik und es passt in jede Portal-Grenze.
 *
 * 4. ZWEI FORMATE. `.ogg` (Vorbis) für Chrome, Firefox, Edge und Safari ab
 *    15; `.mp3` als Rückfall für alles Ältere. Das Spiel wählt beim Laden
 *    selbst aus (Musik.js, `_formatWaehlen`).
 *
 * WARUM NICHT NAHTLOS GESCHNITTEN
 * Die Stücke sind nicht als Schleife komponiert. Statt sie zurechtzuschneiden
 * blendet das Spiel am Ende in den eigenen Anfang über (Musik.js, `update`)
 * — das kaschiert sowohl die fehlende Schleifenfähigkeit als auch die
 * Kodierlücke von MP3.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const QUELLE = resolve(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Desktop');
const ZIEL = join(ROOT, 'public', 'musik');

/* Zuordnung Stück -> Gebiet. Die Gebietsnamen sind die aus
 * CONFIG.wall.stages und zugleich die Dateinamen in public/musik. */
const STUECKE = [
  { datei: 'Jungle Adventure.mp3', gebiet: 'gruen', was: 'erstes Gebiet, Dschungel' },
  { datei: 'Flower Jungle.mp3', gebiet: 'blumen', was: 'zweites Gebiet, Blumen' },
  { datei: 'Rainforest Groove.mp3', gebiet: 'aeste', was: 'drittes Gebiet, Äste' },
  { datei: 'Mushroom Grove Groove.mp3', gebiet: 'pilzwald', was: 'Pilzwald' },
  { datei: 'Toxic Swamp Groove.mp3', gebiet: 'gift', was: 'Giftgebiet' },
  { datei: 'Halloween.mp3', gebiet: 'halloween', was: 'Halloween, Kürbisse' },
  { datei: 'Weightless Waltz.mp3', gebiet: 'wasser', was: 'Unterwasser' },
  { datei: 'himmel.mp3', gebiet: 'wolken', was: 'Wolken' },
  { datei: 'winter.mp4', gebiet: 'eiszeit', was: 'Winterwald — NUR die Tonspur' },
  { datei: 'Crystal Cavern.mp3', gebiet: 'kristall', was: 'Kristallhöhle' },
  { datei: 'Lava Fortress.mp3', gebiet: 'lava', was: 'Lava, Feuer' },
  { datei: 'Ash Wasteland.mp3', gebiet: 'asche', was: 'Asche' },
];

const BITRATE = '96k';
const ZIEL_LUFS = -17;

/* ------------------------------------------------------------------ Hilfen */

const lauf = (args) =>
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** Misst die Lautheit, damit der zweite Durchgang exakt korrigieren kann. */
function messen(quelle) {
  try {
    execFileSync(
      ffmpeg,
      ['-hide_banner', '-i', quelle, '-af', `loudnorm=I=${ZIEL_LUFS}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return null;
  } catch (err) {
    // ffmpeg schreibt die Messung nach stderr und endet mit Code != 0, wenn
    // nach /dev/null geschrieben wird — das ist der normale Weg.
    const text = String(err.stderr ?? '');
    const start = text.lastIndexOf('{');
    const ende = text.lastIndexOf('}');
    if (start < 0 || ende < 0) return null;
    try {
      return JSON.parse(text.slice(start, ende + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Spieldauer in Sekunden.
 *
 * BEWUSST OHNE Ausgabeziel. Mit `-f null -` läuft ffmpeg erfolgreich durch,
 * `execFileSync` wirft dann nicht, und weil stderr nur im Fehlerfall
 * zurückkommt, war die gemessene Dauer immer 0 — die Meldung "alle Stücke
 * unter 40 s" beim ersten Lauf war genau dieser Fehler. Ohne Ausgabeziel
 * bricht ffmpeg ab, und die Kopfzeilen stehen in stderr.
 */
function dauer(datei) {
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', datei], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const m = String(err.stderr ?? '').match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  return 0;
}

const kb = (p) => Math.round(statSync(p).size / 1024);

/* -------------------------------------------------------------------- Lauf */

mkdirSync(ZIEL, { recursive: true });

/* ERST PRÜFEN, DANN LÖSCHEN — in dieser Reihenfolge, und das ist wichtig.
 *
 * Hier wurde zuerst der Altbestand gelöscht und erst danach geschaut, ob die
 * Vorlagen überhaupt da sind. Die liegen auf dem DESKTOP, also ausserhalb des
 * Projekts und nicht in Git. Auf jedem anderen Rechner — oder sobald der
 * Desktop aufgeräumt ist — hätte ein versehentliches `npm run prep:musik`
 * alle zwölf Stücke gelöscht und sich mit einem Fehler beendet. Gerettet
 * hätte nur noch Git.
 */
const fehltVorab = STUECKE.filter((s) => !existsSync(join(QUELLE, s.datei)));
if (fehltVorab.length) {
  console.error(`Vorlagen fehlen in ${QUELLE}:`);
  for (const s of fehltVorab) console.error(`  ${s.datei}   (für ${s.gebiet})`);
  console.error('\nNichts gelöscht, nichts geändert. Vorlagen dorthin legen und erneut starten.');
  process.exit(1);
}

// Jetzt ist der Weg frei: Altbestand weg, sonst bleiben Dateien von
// umbenannten Stücken liegen.
for (const f of readdirSync(ZIEL)) {
  if (/\.(ogg|mp3)$/i.test(f)) unlinkSync(join(ZIEL, f));
}

console.log(`Quelle: ${QUELLE}`);
console.log(`Ziel:   ${ZIEL}`);
console.log(`Ziel-Lautheit ${ZIEL_LUFS} LUFS, ${BITRATE} stereo\n`);

const fehlend = [];
const ergebnis = [];

for (const s of STUECKE) {
  const quelle = join(QUELLE, s.datei);
  if (!existsSync(quelle)) {
    fehlend.push(s.datei);
    console.log(`  FEHLT   ${s.gebiet.padEnd(10)} ${s.datei}`);
    continue;
  }

  const laenge = dauer(quelle);
  const gemessen = messen(quelle);

  /* Zweistufige Normalisierung: erst messen, dann mit den gemessenen Werten
   * korrigieren. Einstufig arbeitet loudnorm blind und schiesst regelmässig
   * um mehrere dB daneben. */
  const filter = gemessen
    ? `loudnorm=I=${ZIEL_LUFS}:TP=-1.5:LRA=11:measured_I=${gemessen.input_i}` +
      `:measured_TP=${gemessen.input_tp}:measured_LRA=${gemessen.input_lra}` +
      `:measured_thresh=${gemessen.input_thresh}:offset=${gemessen.target_offset}:linear=true`
    : `loudnorm=I=${ZIEL_LUFS}:TP=-1.5:LRA=11`;

  for (const [endung, args] of [
    ['ogg', ['-c:a', 'libvorbis', '-b:a', BITRATE]],
    ['mp3', ['-c:a', 'libmp3lame', '-b:a', BITRATE]],
  ]) {
    lauf([
      '-i',
      quelle,
      // `-vn` wirft die Bildspur weg — nötig für das .mp4, schadet sonst nicht.
      '-vn',
      '-af',
      filter,
      '-ar',
      '44100',
      '-ac',
      '2',
      ...args,
      join(ZIEL, `${s.gebiet}.${endung}`),
    ]);
  }

  const o = kb(join(ZIEL, `${s.gebiet}.ogg`));
  const m = kb(join(ZIEL, `${s.gebiet}.mp3`));
  ergebnis.push({ ...s, laenge, ogg: o, mp3: m, lufs: gemessen?.input_i });
  console.log(
    `  ok      ${s.gebiet.padEnd(10)} ${String(Math.round(laenge)).padStart(3)}s  ` +
      `${String(o).padStart(4)} KB ogg / ${String(m).padStart(4)} KB mp3   ${s.was}`,
  );
}

const summe = ergebnis.reduce((a, e) => a + e.ogg + e.mp3, 0);
console.log(`\n${ergebnis.length} Stücke, zusammen ${(summe / 1024).toFixed(1)} MB (beide Formate).`);

if (ergebnis.length) {
  const kurz = ergebnis.filter((e) => e.laenge < 40);
  if (kurz.length) {
    console.log(
      `\nHinweis: ${kurz.map((e) => e.gebiet).join(', ')} sind unter 40 s lang — ` +
        `die Schleife fällt dort öfter auf.`,
    );
  }
}
if (fehlend.length) {
  console.log(`\nFEHLENDE VORLAGEN (${fehlend.length}):`);
  for (const f of fehlend) console.log('  ' + f);
  process.exit(1);
}
