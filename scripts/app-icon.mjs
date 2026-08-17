/**
 * Baut das Android-App-Symbol aus dem freigestellten Kletter-Affen.
 *
 * Run mit:  node scripts/app-icon.mjs
 *
 * WARUM NICHT EINFACH DAS TITELBILD SKALIEREN
 *
 * Android schneidet Symbole seit "Adaptive Icons" (API 26+) selbst zu — mal
 * rund, mal abgerundet quadratisch, je nach Hersteller-Oberfläche. Wer ein
 * rechteckiges Bild mit Ecken hineinlegt, verliert die Ecken zufällig, und
 * bei einem Titelbild mit Schriftzug bis zum Rand hiesse das: der Name wird
 * teils weggeschnitten.
 *
 * Adaptive Icons bestehen deshalb aus ZWEI Ebenen — Hintergrund und
 * Vordergrund, beide 108x108 dp, aber nur die inneren 72x72 dp sind auf
 * jedem Gerät sicher sichtbar ("safe zone"). Der Affe kommt in diese Zone;
 * der Rand ist reine Reserve fürs Zuschneiden.
 *
 * QUELLE: der freigestellte Kletter-Affe (public/textures/move_00.webp) —
 * dasselbe Bild, das auch im Spiel steht, mit Alphakanal, kein Hintergrund
 * zum Wegrechnen.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const QUELLE = resolve(ROOT, 'public/textures/move_00.webp');
const RES = resolve(ROOT, 'android/app/src/main/res');

/* Dieselbe Farbe wie CONFIG.render.clearColor (dunkles Dschungelgrün) —
 * das Symbol soll aussehen, als käme es aus demselben Spiel. */
const HINTERGRUND = '#0a1a0d';

/** Dichten, für die Android eigene Bilddateien erwartet. */
const DICHTEN = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

/* Adaptive-Icon-Masse. 108dp Leinwand, 72dp "sichere Zone" in der Mitte —
 * ausserhalb davon kann jedes Gerät unterschiedlich viel wegschneiden. */
const LEINWAND_DP = 108;
const SICHER_DP = 72;

async function bauen() {
  const affe = sharp(QUELLE);
  const meta = await affe.metadata();

  for (const [dichteName, faktor] of Object.entries(DICHTEN)) {
    const leinwand = Math.round(LEINWAND_DP * faktor);
    const sicher = Math.round(SICHER_DP * faktor);

    // Affe auf die sichere Zone bringen, Seitenverhältnis erhalten.
    const affeHoehe = sicher;
    const affeBreite = Math.round((meta.width / meta.height) * affeHoehe);
    const affeBuffer = await sharp(QUELLE).resize(affeBreite, affeHoehe).toBuffer();

    // --- Vordergrund: nur der Affe, transparenter Grund -----------------
    const vordergrund = await sharp({
      create: { width: leinwand, height: leinwand, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: affeBuffer,
          left: Math.round((leinwand - affeBreite) / 2),
          top: Math.round((leinwand - affeHoehe) / 2),
        },
      ])
      .png()
      .toBuffer();

    // --- Hintergrund: einfarbig -------------------------------------------
    const hintergrund = await sharp({
      create: { width: leinwand, height: leinwand, channels: 4, background: HINTERGRUND },
    })
      .png()
      .toBuffer();

    // --- Klassisches (nicht-adaptives) Symbol, für ältere Geräte ---------
    // Rund vorbeschnitten wird hier nicht — Launcher ohne Adaptive-Icon-
    // Unterstützung zeigen es eckig, das ist auf alten Geräten üblich.
    const klassisch = await sharp(hintergrund).composite([{ input: vordergrund }]).png().toBuffer();

    const zielRund = resolve(RES, `mipmap-${dichteName}`);
    const zielQuadr = resolve(RES, `mipmap-${dichteName}`);
    mkdirSync(zielRund, { recursive: true });

    await sharp(vordergrund).toFile(resolve(zielRund, 'ic_launcher_foreground.png'));
    await sharp(klassisch).toFile(resolve(zielQuadr, 'ic_launcher.png'));
    await sharp(klassisch).toFile(resolve(zielQuadr, 'ic_launcher_round.png'));

    console.log(`  mipmap-${dichteName.padEnd(7)} ${leinwand}x${leinwand}  (Affe ${affeBreite}x${affeHoehe})`);
  }

  // Adaptive-Icon-Hintergrundfarbe als Ressource, für mipmap-anydpi-v26/*.xml
  const werteOrdner = resolve(RES, 'values');
  mkdirSync(werteOrdner, { recursive: true });
  const farbdatei = resolve(werteOrdner, 'ic_launcher_background.xml');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    farbdatei,
    `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<resources>\n` +
      `    <color name="ic_launcher_background">${HINTERGRUND}</color>\n` +
      `</resources>\n`,
  );
  console.log(`  values/ic_launcher_background.xml  -> ${HINTERGRUND}`);
}

await bauen();
console.log('\nApp-Symbol aus dem Kletter-Affen gebaut.\n');
