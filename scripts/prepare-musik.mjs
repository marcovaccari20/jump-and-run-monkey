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
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HEIM = process.env.USERPROFILE ?? process.env.HOME ?? '';
/* Vorlagen liegen mal auf dem Desktop, mal im Download-Ordner — je nachdem,
 * woher sie kamen. Beide Orte werden durchsucht, der erste Treffer gewinnt. */
const QUELLEN = [resolve(HEIM, 'Desktop'), resolve(HEIM, 'Downloads')];
const ZIEL = join(ROOT, 'public', 'musik');

/** Sucht eine Vorlage in allen Quellordnern. `null`, wenn sie nirgends liegt. */
function finden(datei) {
  for (const ordner of QUELLEN) {
    const p = join(ordner, datei);
    if (existsSync(p)) return p;
  }
  return null;
}

/* Zuordnung Stück -> Gebiet. Die Gebietsnamen sind die aus
 * CONFIG.wall.stages und zugleich die Dateinamen in public/musik.
 * `bis` schneidet nach n Sekunden ab — für Stücke, die viel länger sind,
 * als das Gebiet je dauert. */
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
  { datei: 'Rust and Neon.mp3', gebiet: 'schrott', was: 'Schrott, Rost' },
  { datei: 'Candy Land Loop.mp3', gebiet: 'bonbon', was: 'Süssigkeiten' },
  { datei: 'Desert of Alhambra.mp3', gebiet: 'kakteen', was: 'Kakteen, Wüste' },
  { datei: 'Echoes of the Obsidian Cavern.mp3', gebiet: 'ruine', was: 'Ruine' },
  { datei: "Captain's Quest.mp3", gebiet: 'pirat', was: 'Piratenschiff' },
  { datei: 'Golden Hive.mp3', gebiet: 'biene', was: 'Bienenwaben' },
  { datei: 'The Silent Archive.mp3', gebiet: 'bibliothek', was: 'Bibliothek' },
  { datei: 'Carnival of Bits.mp3', gebiet: 'zirkus', was: 'Zirkus' },
  { datei: 'Stardust Arpeggio.mp3', gebiet: 'weltall', was: 'Weltall — letztes Gebiet' },
  /* Das Gold-Gebiet dauert 30 s. Die Vorlage ist 480 s lang — ungekürzt wären
   * das 5,6 MB je Format für Musik, von der niemand je mehr als die erste
   * halbe Minute hört. 40 s lassen der Schleifenblende (3 s) Luft. */
  { datei: 'Bonus Stage Victory.mp3', gebiet: 'gold', was: 'Gold-Gebiet, Bonus', bis: 40 },
];

/* Bitrate und Format über die Befehlszeile steuerbar:
 *     npm run prep:musik -- --bitrate 64k --nur mp3
 *
 * 96k war für sich genommen richtig, aber BEIDE Formate zusammen machten 54
 * von 63 MB des Portalpakets aus. Bei Hintergrundmusik, über der Spielklänge
 * liegen, ist 64k stereo nicht vom Original zu unterscheiden — und halbiert
 * die Grösse noch einmal. */
const argw = (name, standard) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const BITRATE = argw('bitrate', '96k');
const NUR = argw('nur', 'beide'); // 'mp3' | 'ogg' | 'beide'
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

/* NUR ANFASSEN, WOFÜR EINE VORLAGE DA IST.
 *
 * Früher löschte dieses Skript erst den ganzen Zielordner und schaute dann,
 * ob die Vorlagen überhaupt existieren. Die liegen ausserhalb des Projekts
 * und nicht in Git — ein versehentlicher Lauf ohne sie hätte alle Stücke
 * gelöscht. Danach kam die Prüfung vorweg, aber als Alles-oder-nichts: fehlte
 * eine einzige Vorlage, lief gar nichts mehr.
 *
 * Beides ist jetzt hinfällig. Jedes Stück wird einzeln betrachtet: fehlt die
 * Vorlage, bleibt die vorhandene Ausgabe unangetastet. Gelöscht wird immer
 * nur genau das, was im selben Durchgang neu geschrieben wird. Damit lassen
 * sich Stücke nachtragen, ohne die schon fertigen zu gefährden.
 */
const vorhanden = STUECKE.map((s) => ({ ...s, quelle: finden(s.datei) }));
const zuTun = vorhanden.filter((s) => s.quelle);
const fehlend = vorhanden.filter((s) => !s.quelle);

console.log(`Quellen: ${QUELLEN.join('  |  ')}`);
console.log(`Ziel:    ${ZIEL}`);
console.log(`Ziel-Lautheit ${ZIEL_LUFS} LUFS, ${BITRATE} stereo\n`);

if (!zuTun.length) {
  console.error('Keine einzige Vorlage gefunden. Nichts geändert.');
  process.exit(1);
}

const ergebnis = [];

for (const s of zuTun) {
  const quelle = s.quelle;
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

  const formate = [
    ['ogg', ['-c:a', 'libvorbis', '-b:a', BITRATE]],
    ['mp3', ['-c:a', 'libmp3lame', '-b:a', BITRATE]],
  ].filter(([e]) => NUR === 'beide' || NUR === e);
  for (const [endung, args] of formate) {
    const ziel = join(ZIEL, `${s.gebiet}.${endung}`);
    if (existsSync(ziel)) unlinkSync(ziel);
    lauf([
      '-i',
      quelle,
      // `-vn` wirft die Bildspur weg — nötig für das .mp4, schadet sonst nicht.
      '-vn',
      // Kürzen nur, wenn für dieses Stück verlangt.
      ...(s.bis ? ['-t', String(s.bis)] : []),
      '-af',
      filter,
      '-ar',
      '44100',
      '-ac',
      '2',
      ...args,
      ziel,
    ]);
  }

  // Nur das messen, was in diesem Lauf auch geschrieben wurde.
  const o = NUR === 'mp3' ? 0 : kb(join(ZIEL, `${s.gebiet}.ogg`));
  const m = NUR === 'ogg' ? 0 : kb(join(ZIEL, `${s.gebiet}.mp3`));
  const gekuerzt = s.bis ? ` (auf ${s.bis}s gekürzt)` : '';
  ergebnis.push({ ...s, laenge, ogg: o, mp3: m, lufs: gemessen?.input_i });
  console.log(
    `  ok      ${s.gebiet.padEnd(10)} ${String(Math.round(laenge)).padStart(3)}s  ` +
      `${String(o).padStart(4)} KB ogg / ${String(m).padStart(4)} KB mp3   ${s.was}${gekuerzt}`,
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
  console.log(`\nOhne Vorlage, deshalb übersprungen (${fehlend.length}):`);
  for (const f of fehlend) {
    /* BEIDE Formate prüfen, nicht nur Ogg.
     *
     * Seit `--nur mp3` liegt im Spiel gar kein Ogg mehr. Die Prüfung auf
     * allein `.ogg` meldete deshalb „FEHLT AUCH IM SPIEL" für Stücke, die
     * in Wahrheit als MP3 danebenlagen und einwandfrei spielten — ein
     * Fehlalarm, der zu einer überflüssigen Suche nach verlorenen Dateien
     * verleitet. */
    const da =
      existsSync(join(ZIEL, `${f.gebiet}.ogg`)) || existsSync(join(ZIEL, `${f.gebiet}.mp3`));
    console.log(`  ${f.gebiet.padEnd(10)} ${f.datei}   ${da ? '— fertige Datei bleibt liegen' : '— FEHLT AUCH IM SPIEL'}`);
  }
  // Kein Abbruch: Übersprungene Stücke sind der Normalfall, sobald die
  // Vorlagen aufgeräumt sind. Nur wenn eines im Spiel fehlt, ist es ein Fehler.
  const echtWeg = fehlend.filter((f) => !existsSync(join(ZIEL, `${f.gebiet}.ogg`)));
  if (echtWeg.length) process.exit(1);
}
