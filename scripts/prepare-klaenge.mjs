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
import { execFileSync } from 'node:child_process';
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
    // Der erste Kau-Schub. 0.25 statt 0.3, damit der Anschlag mitkommt.
    von: 0.25,
    dauer: 0.85,
    // Kurz aus-, damit es nicht mitten im nächsten Bissen abbricht.
    ausblenden: 0.18,
    was: 'Banane aufgelesen — ein Bissen',
  },
  {
    datei: 'Realistic_excited_mo_#2-1786111680715.mp3',
    ziel: 'affe',
    von: 0.18,
    dauer: 1.05,
    ausblenden: 0.22,
    was: 'Affe freut sich',
  },
];

/* Dieselbe Ziel-Lautheit wie die Musik, aber ein gutes Stück lauter: Effekte
 * müssen ÜBER der Musik liegen, sonst hört man sie nicht. */
const ZIEL_LUFS = -14;

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
          `loudnorm=I=${ZIEL_LUFS}:TP=-1.0:LRA=7`,
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
  console.log(
    `  ok  ${k.ziel.padEnd(8)} ${k.von.toFixed(2)}–${(k.von + k.dauer).toFixed(2)} s ` +
      `(${k.dauer.toFixed(2)} s)   ${o} KB ogg / ${m} KB mp3   ${k.was}`,
  );
}

console.log('\nFertig. Die Klänge liegen in public/klang.');
