/**
 * Macht aus der Rohaufnahme die zwei Vorschauvideos, die CrazyGames verlangt.
 *
 *     Querformat  1920x1080  (16:9)   Pflicht
 *     Hochformat  1080x1620  (2:3)    Pflicht
 *
 * Run mit:  node scripts/video-fassungen.mjs [rohdatei] [titelbild-ordner]
 *
 * DIE VORGABEN, GEGEN DIE HIER GEBAUT WIRD
 * (nachgelesen bei docs.crazygames.com, nicht geraten)
 *
 *   - 15 bis 20 Sekunden. Längeres wird auf 20 gekürzt.
 *   - Höchstens 50 MB.
 *   - KEIN Ton.
 *   - Das erste Bild muss das statische Titelbild sein.
 *   - Verboten: schwarze Balken, schwarze Bilder, Logo-Übergänge,
 *     Mauszeiger, Werbetext, App- und Sozialmedien-Symbole, Zeitraffer.
 *
 * DAS PROBLEM MIT DEN SCHWARZEN BALKEN
 *
 * Aufgenommen wird die Leinwand des Spiels, und die ist hochkant (9:16) —
 * so sieht das Spiel aus, seit die Bühne das Seitenverhältnis deckelt. In
 * ein 16:9-Video passt das nicht ohne Rand. Ein schwarzer Rand ist aber
 * ausdrücklich verboten.
 *
 * Deshalb dieselbe Lösung wie bei den Titelbildern: hinter das scharfe Bild
 * kommt dasselbe Video noch einmal, formatfüllend, unscharf und abgedunkelt.
 * Der Rand ist damit kein Balken, sondern Tiefenunschärfe — und das Auge
 * bleibt trotzdem in der Mitte.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ROH = resolve(process.argv[2] ?? resolve(ROOT, 'pakete/video/roh-hoch.webm'));
const TITEL = resolve(process.argv[3] ?? resolve(ROOT, 'pakete/titelbilder'));
const ZIEL = resolve(ROOT, 'pakete/video');

if (!existsSync(ROH)) {
  console.error(`Rohaufnahme fehlt: ${ROH}`);
  process.exit(1);
}
mkdirSync(ZIEL, { recursive: true });

/** Wie lange das Titelbild am Anfang steht. */
const VORLAUF = 0.5;
/** Spiellänge, damit mit Vorlauf 20 s nicht überschritten werden. */
const SPIELDAUER = 17.4;

const FASSUNGEN = [
  {
    name: 'preview-landscape-1920x1080',
    breite: 1920,
    hoehe: 1080,
    titel: 'cover-landscape-1920x1080.png',
  },
  {
    name: 'preview-portrait-1080x1620',
    breite: 1080,
    hoehe: 1620,
    titel: 'cover-portrait-800x1200.png',
  },
];

console.log(`Rohaufnahme: ${ROH}`);

for (const f of FASSUNGEN) {
  const titelBild = resolve(TITEL, f.titel);
  const hatTitel = existsSync(titelBild);
  const ausgabe = resolve(ZIEL, `${f.name}.mp4`);

  /* Der Filtergraph, Schritt für Schritt:
   *
   *   [0:v] ist das Spielvideo.
   *     bg  formatfüllend beschnitten, weichgezeichnet, abgedunkelt
   *     fg  auf die Zielhöhe gebracht, unangetastet scharf
   *     overlay legt fg mittig auf bg
   *
   *   [1:v] ist das Titelbild, auf dieselbe Grösse gebracht.
   *
   *   Am Ende werden beide aneinandergehängt: erst das Titelbild, dann das
   *   Spiel. Damit ist das erste Bild garantiert das Titelbild, so wie es
   *   die Vorgabe verlangt. */
  const spiel =
    `[0:v]trim=0:${SPIELDAUER},setpts=PTS-STARTPTS,split=2[roh1][roh2];` +
    `[roh1]scale=${f.breite}:${f.hoehe}:force_original_aspect_ratio=increase,` +
    `crop=${f.breite}:${f.hoehe},boxblur=24:2,eq=brightness=-0.14:saturation=1.05[bg];` +
    `[roh2]scale=-2:${f.hoehe}[fg];` +
    /* `setsar=1` ist Pflicht, nicht Kosmetik.
     *
     * `scale=-2:H` rundet die Breite auf eine gerade Zahl und gleicht die
     * Abweichung über das PIXEL-Seitenverhältnis aus — hier kam 10239:10240
     * heraus. Das Titelbild hat dagegen glatte 1:1. `concat` verlangt, dass
     * beide Eingänge darin übereinstimmen, und brach sonst mit
     * "parameters do not match" ab, ohne ein einziges Bild zu schreiben. */
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,setsar=1,format=yuv420p[spiel]`;

  const argumente = ['-hide_banner', '-loglevel', 'error', '-y', '-i', ROH];

  if (hatTitel) {
    argumente.push('-loop', '1', '-t', String(VORLAUF), '-i', titelBild);
    argumente.push(
      '-filter_complex',
      spiel +
        `;[1:v]scale=${f.breite}:${f.hoehe}:force_original_aspect_ratio=increase,` +
        `crop=${f.breite}:${f.hoehe},fps=30,setsar=1,format=yuv420p[kopf];` +
        `[kopf][spiel]concat=n=2:v=1:a=0[aus]`,
      '-map', '[aus]',
    );
  } else {
    argumente.push('-filter_complex', spiel, '-map', '[spiel]');
  }

  argumente.push(
    // KEIN Ton — ausdrücklich verlangt.
    '-an',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '21',
    // Für Browser: Kopfdaten nach vorn, damit sofort abgespielt werden kann.
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    ausgabe,
  );

  execFileSync(ffmpeg, argumente, { stdio: 'inherit' });

  const mb = statSync(ausgabe).size / 1048576;
  const dauer = (hatTitel ? VORLAUF : 0) + SPIELDAUER;
  console.log(
    `  ${f.name.padEnd(32)} ${f.breite}x${f.hoehe}  ` +
      `${dauer.toFixed(1)} s  ${mb.toFixed(1)} MB` +
      `${mb > 50 ? '   ZU GROSS (Grenze 50 MB)' : ''}` +
      `${hatTitel ? '  (Titelbild als erstes Bild)' : '  OHNE Titelbild!'}`,
  );
}

console.log(`\nZiel: ${ZIEL}\n`);
