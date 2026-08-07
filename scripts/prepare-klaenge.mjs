/**
 * Macht aus den gelieferten Aufnahmen kurze Spielklänge.
 *
 *   npm run prep:klaenge
 *
 * WARUM GESCHNITTEN WIRD, UND WO
 *
 * Die Vorlagen sind je 3.12 s lang. Für einen Spielklang ist das viel zu
 * viel: die Banane ist in einem Sekundenbruchteil eingesammelt, und ein Ton,
 * der danach noch drei Sekunden weiterläuft, klebt am Geschehen vorbei.
 *
 * Gemessen (Lautstärkeverlauf in 0.1-s-Fenstern):
 *   Banane  Kauen in vier Schüben: 0.3-1.0, 1.2-1.7, 1.9-2.1, 2.3-2.7 s.
 *           Gebraucht wird EIN Bissen — der erste Schub.
 *   Affe    durchgehender Ruf von 0.2 bis 2.5 s. Gebraucht wird ein kurzer
 *           Freudenlaut, nicht die ganze Tirade.
 *
 * WARUM DIE LAUTSTÄRKEN ANGEGLICHEN WERDEN
 * Die Vorlagen liegen 28 dB auseinander (Banane -34.2 dB Spitze, Affe -5.7).
 * Unverändert wäre die Banane unhörbar und der Affe ein Schreck. Beide gehen
 * deshalb auf dieselbe Lautheit wie die übrigen Effekte.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const QUELLE = resolve(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Downloads');
const ZIEL = join(ROOT, 'public', 'klang');

const KLAENGE = [
  {
    datei: 'Ultra-clean_close-up_#3-1786111587555.mp3',
    ziel: 'banane',
    /* ZWEITER ANLAUF, und der erste war falsch herum.
     *
     * Ich hatte 0.25–1.10 s geschnitten in der Annahme, der erste Kau-Schub
     * sei "der Bissen". Nachgemessen (25-ms-Fenster, Spitze je Fenster):
     *
     *   0.475 s  −25 dB   kleiner Vorlauf
     *   0.825 s  −23 dB
     *   0.900 s  −19 dB   ← hier beisst sie wirklich zu
     *   0.950 s  −15 dB   ← lautester Moment der ganzen Aufnahme
     *   1.000 s  −22 dB
     *   1.025 s  −42 dB   danach Stille bis 1.25 s
     *
     * Der laute Teil lag damit ganz am ENDE meines Ausschnitts: der Klang
     * wäre erst 0.66 s nach dem Einsammeln richtig losgegangen — genau das
     * Nachhängen, das nicht sein soll. Jetzt beginnt der Ausschnitt kurz vor
     * dem Zubeissen, der Höhepunkt liegt in den ersten 100 ms.
     */
    von: 0.86,
    dauer: 0.42,
    ausblenden: 0.14,
    was: 'Banane aufgelesen — das Zubeissen',
  },
  {
    datei: 'Realistic_excited_mo_#2-1786111680715.mp3',
    ziel: 'affe',
    /* Auch hier lag der Höhepunkt hinten. Gemessen: die Vorlage ist bei
     * 2.01 s am lautesten (0.0 dB), mein Schnitt 0.18–1.23 s hatte seinen
     * Gipfel bei 77 % der Länge — das Ausblenden schnitt also mitten in den
     * lautesten Ruf. Jetzt beginnt der Ausschnitt kurz vor 2.01 s. */
    von: 1.82,
    dauer: 0.78,
    ausblenden: 0.24,
    was: 'Affe freut sich',
  },
];

/* SPITZENPEGEL STATT LAUTHEIT — und das ist eine Korrektur.
 *
 * Der erste Anlauf normalisierte mit `loudnorm` auf -14 LUFS. Ergebnis
 * gemessen: Banane -26.1 LUFS, Affe -13.9 — also 12 dB auseinander statt
 * gleich. Zwei Gründe, beide grundsätzlich:
 *
 *  1. `loudnorm` braucht rund drei Sekunden Material für eine belastbare
 *     Messung. Bei 0.4-1.0 s misst es daneben; es meldete für die Banane
 *     einen Spitzenwert von -11.6 dB, tatsächlich waren es -8.8 — und legte
 *     entsprechend 2.8 dB zu viel auf. Die fertige Datei übersteuerte mit
 *     +1.2 dBFS.
 *  2. Ein Bissen ist ein Knacken mit sehr hohem Scheitelfaktor. Um so etwas
 *     auf -14 LUFS zu heben, müsste die Spitze weit über 0 dBFS steigen.
 *     Die Deckelung verhindert das — und dann bleibt die Lautheit eben
 *     darunter, ohne dass jemand etwas merkt.
 *
 * Deshalb jetzt: gemessene Spitze exakt auf -1.0 dBFS ziehen. Das ist
 * verlässlich, unabhängig von der Länge und kann nicht übersteuern. Die
 * WAHRGENOMMENE Balance macht danach `CONFIG.klang.probenPegel` je Klang —
 * dort gehört sie hin, denn nur dort kann man sie gegen die Musik hören. */
const ZIEL_SPITZE_DB = -1.8;

/**
 * Höchster Pegel eines Ausschnitts in dBFS.
 *
 * MIT `spawnSync`, NICHT `execFileSync` — und das ist kein Stil.
 * `volumedetect` schreibt sein Ergebnis nach stderr, und mit `-f null -`
 * BEENDET sich ffmpeg erfolgreich. `execFileSync` gibt bei Erfolg aber nur
 * stdout zurück; stderr bekommt man nur über das Fehlerobjekt. Ein
 * try/catch darum herum greift also nie, und die Messung ist immer leer.
 * Genau dieser Fehler stand vorher schon einmal in prepare-musik.mjs (dort
 * meldete er alle Stücke als 0 Sekunden lang) — und ich habe ihn hier
 * prompt wiederholt. `spawnSync` liefert beides.
 */
function spitze(quelle, von, dauer) {
  const r = spawnSync(
    ffmpeg,
    ['-hide_banner', '-ss', String(von), '-t', String(dauer), '-i', quelle, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const m = `${r.stderr ?? ''}${r.stdout ?? ''}`.match(/max_volume:\s*(-?[\d.]+) dB/);
  return m ? +m[1] : null;
}

mkdirSync(ZIEL, { recursive: true });

const fehlt = KLAENGE.filter((k) => !existsSync(join(QUELLE, k.datei)));
if (fehlt.length) {
  console.error(`Vorlagen fehlen in ${QUELLE}:`);
  for (const k of fehlt) console.error(`  ${k.datei}`);
  console.error('\nNichts geändert.');
  process.exit(1);
}

console.log(`Quelle: ${QUELLE}`);
console.log(`Ziel:   ${ZIEL}\n`);

for (const k of KLAENGE) {
  const quelle = join(QUELLE, k.datei);
  const einblenden = 0.012; // gegen das Knacken am Schnitt

  // Erst messen, dann genau so viel anheben, dass die Spitze auf dem Ziel
  // landet. Kein Schätzen, kein Übersteuern.
  const ist = spitze(quelle, k.von, k.dauer);
  const anheben = ist === null ? 0 : ZIEL_SPITZE_DB - ist;
  k._gemessen = ist;
  k._anheben = anheben;

  for (const [endung, args] of [
    ['ogg', ['-c:a', 'libvorbis', '-q:a', '4']],
    ['mp3', ['-c:a', 'libmp3lame', '-b:a', '128k']],
  ]) {
    execFileSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(k.von),
        '-t',
        String(k.dauer),
        '-i',
        quelle,
        '-af',
        [
          `afade=t=in:st=0:d=${einblenden}`,
          `afade=t=out:st=${(k.dauer - k.ausblenden).toFixed(3)}:d=${k.ausblenden}`,
          `volume=${anheben.toFixed(2)}dB`,
        ].join(','),
        '-ar',
        '44100',
        '-ac',
        '1', // mono: ein Punktereignis braucht kein Stereobild, halbiert die Grösse
        ...args,
        join(ZIEL, `${k.ziel}.${endung}`),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  }

  const o = Math.round(statSync(join(ZIEL, `${k.ziel}.ogg`)).size / 1024);
  const m = Math.round(statSync(join(ZIEL, `${k.ziel}.mp3`)).size / 1024);
  const nachher = spitze(join(ZIEL, `${k.ziel}.ogg`), 0, k.dauer);
  console.log(
    `  ok  ${k.ziel.padEnd(8)} ${k.von.toFixed(2)}–${(k.von + k.dauer).toFixed(2)} s ` +
      `(${k.dauer.toFixed(2)} s)  Spitze ${String(k._gemessen?.toFixed(1) ?? '?').padStart(6)} ` +
      `→ ${String(nachher?.toFixed(1) ?? '?').padStart(5)} dB  ` +
      `${o} KB ogg / ${m} KB mp3   ${k.was}`,
  );
}

console.log('\nFertig. Die Klänge liegen in public/klang.');
