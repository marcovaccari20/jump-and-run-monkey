/**
 * Erzeugt die beiden Pflichtgrafiken für den Google Play Store.
 *
 * Aufruf:  npm run playstore:grafiken
 * Ergebnis: pakete/playstore/
 *
 * WAS GOOGLE VERLANGT (und was daran leicht schiefgeht)
 *
 *   App-Symbol      512 x 512, PNG, 32 Bit, höchstens 1 MB
 *   Feature-Grafik  1024 x 500, PNG oder JPG, OHNE Transparenz
 *
 * Die zwei Fallen:
 *
 *   1. TRANSPARENZ IN DER FEATURE-GRAFIK. Play weist sie ab. Deshalb wird
 *      hier ausdrücklich auf einen deckenden Hintergrund gelegt, statt sich
 *      darauf zu verlassen, dass die Vorlage schon deckend ist.
 *
 *   2. DAS SYMBOL WIRD RUND BESCHNITTEN. Play und die meisten Startbildschirme
 *      legen eine Maske darüber — bei 512 px bleiben von den Ecken nichts
 *      übrig. Motiv deshalb mit Rand, nicht randfüllend. Ein Titel, der bis
 *      an die Kante läuft, verliert seine Enden.
 */

import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUELLEN = resolve(ROOT, 'pakete/titelbilder');
const ZIEL = resolve(ROOT, 'pakete/playstore');

/** Dunkles Dschungelgrün — dasselbe wie `theme-color` im Spiel. */
const GRUND = { r: 10, g: 26, b: 13, alpha: 1 };

mkdirSync(ZIEL, { recursive: true });

function pruefen(pfad) {
  if (!existsSync(pfad)) {
    console.error(`Fehlt: ${pfad}`);
    console.error('Erst `node scripts/titelbilder.mjs <vorlage.png>` laufen lassen.');
    process.exit(1);
  }
  return pfad;
}

/* ------------------------------------------------------------ App-Symbol */

const quadrat = pruefen(resolve(QUELLEN, 'cover-square-800x800.png'));

/* 8 % Rand rundum, damit die runde Maske nichts Wichtiges abschneidet.
 * 512 * 0.84 = 430 px Motiv, 41 px Luft auf jeder Seite. */
const MOTIV = Math.round(512 * 0.84);
const RAND = Math.round((512 - MOTIV) / 2);

const symbolMotiv = await sharp(quadrat)
  .resize(MOTIV, MOTIV, { fit: 'cover' })
  .toBuffer();

await sharp({
  create: { width: 512, height: 512, channels: 4, background: GRUND },
})
  .composite([{ input: symbolMotiv, top: RAND, left: RAND }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(ZIEL, 'app-icon-512x512.png'));

/* -------------------------------------------------------- Feature-Grafik */

const quer = pruefen(resolve(QUELLEN, 'cover-landscape-1920x1080.png'));

/* 1024 x 500 ist 2.048:1, die Vorlage 16:9 (1.778:1) — es MUSS oben und
 * unten etwas weg. `fit: 'cover'` schneidet aus der Mitte; `position: 'top'`
 * wäre falsch, der Titel sitzt mittig. */
await sharp(quer)
  .resize(1024, 500, { fit: 'cover', position: 'centre' })
  // Auf deckenden Grund legen: Play weist eine Feature-Grafik mit
  // Transparenz ab, und die Vorlage könnte welche mitbringen.
  .flatten({ background: GRUND })
  .png({ compressionLevel: 9 })
  .toFile(resolve(ZIEL, 'feature-graphic-1024x500.png'));

/* ------------------------------------------------------------- Nachweis */

for (const datei of ['app-icon-512x512.png', 'feature-graphic-1024x500.png']) {
  const p = resolve(ZIEL, datei);
  const m = await sharp(p).metadata();
  const { size } = await sharp(p).toBuffer({ resolveWithObject: true }).then((r) => r.info);
  const kb = (size / 1024).toFixed(0);
  const transparent = m.channels === 4 && m.hasAlpha;
  console.log(
    `${datei.padEnd(32)} ${m.width}x${m.height}  ${kb} kB` +
      (datei.startsWith('feature') && transparent ? '  ⚠ hat noch einen Alphakanal' : ''),
  );
}
console.log(`\nLiegt in: ${ZIEL}`);
