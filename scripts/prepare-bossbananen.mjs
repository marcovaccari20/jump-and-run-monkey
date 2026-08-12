/**
 * Färbt die gelbe Sammelbanane grün ein — das Wurfgeschoss des Gorillas.
 *
 *   npm run prep:bossbananen
 *
 * Quelle: public/hazards/banane.webp   (bereits freigestellt, 176x224)
 * Ziel:   public/hazards/banane_gruen.webp
 *
 * WARUM UMFÄRBEN STATT NEU ZEICHNEN
 * Es soll dieselbe Banane sein, nur grün — der Spieler muss auf einen Blick
 * erkennen, dass das Ding vom Boss kommt und nicht zum Einsammeln ist. Eine
 * zweite, anders gezeichnete Banane würde diesen Zusammenhang verwischen.
 *
 * WIE
 * Nicht über einen HSL-Dreh: die Banane hat braune Enden und weisse Glanz-
 * lichter, ein globaler Farbtondreh macht daraus giftgrüne Enden und grüne
 * Glanzlichter. Stattdessen wird nur der GELBE Anteil verschoben — Pixel,
 * bei denen Rot und Grün deutlich über Blau liegen. Deren Rotanteil wird
 * gesenkt und der Grünanteil angehoben; Helligkeit und Zeichnung bleiben.
 * Braune Enden und Glanzlichter bleiben unangetastet.
 *
 * Die kleine gelbe Wurfbanane des Affen braucht KEINE eigene Datei: das ist
 * dieselbe gelbe Banane, nur kleiner skaliert (CONFIG.boss.arten[].wurf).
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const QUELLE = resolve(ROOT, 'public/hazards/banane.webp');
const ZIEL = resolve(ROOT, 'public/hazards/banane_gruen.webp');

if (!existsSync(QUELLE)) {
  console.error(`Vorlage fehlt: ${QUELLE}`);
  process.exit(1);
}

const { data, info } = await sharp(QUELLE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const n = w * h;
const aus = Buffer.alloc(n * 4);

let umgefaerbt = 0;
for (let i = 0; i < n; i++) {
  const p = i * 4;
  const r = data[p];
  const g = data[p + 1];
  const b = data[p + 2];
  const a = data[p + 3];

  aus[p] = r;
  aus[p + 1] = g;
  aus[p + 2] = b;
  aus[p + 3] = a;
  if (a < 8) continue;

  /* Gelb heisst: Rot UND Grün deutlich über Blau, und die beiden nah
   * beieinander. Braun (R >> G) und Weiss (R≈G≈B) fallen so heraus. */
  const gelbheit = Math.min(r, g) - b;
  if (gelbheit <= 30) continue;
  if (r < g * 0.75) continue; // schon grünlich, nichts zu tun

  /* Wie stark dieses Pixel umgefärbt wird: volle Wirkung erst bei klarem
   * Gelb, damit die Übergänge zu Braun und Weiss weich bleiben. */
  const k = Math.min(1, (gelbheit - 30) / 60);

  // Zielton: sattes Blattgrün bei gleicher Helligkeit.
  const hell = (r + g + b) / 3;
  const zielR = hell * 0.42;
  const zielG = hell * 1.28;
  const zielB = hell * 0.34;

  aus[p] = Math.max(0, Math.min(255, Math.round(r + (zielR - r) * k)));
  aus[p + 1] = Math.max(0, Math.min(255, Math.round(g + (zielG - g) * k)));
  aus[p + 2] = Math.max(0, Math.min(255, Math.round(b + (zielB - b) * k)));
  umgefaerbt++;
}

const res = await sharp(aus, { raw: { width: w, height: h, channels: 4 } })
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(ZIEL);

const anteil = ((umgefaerbt / n) * 100).toFixed(1);
console.log(`banane_gruen.webp  ${w}x${h}  ${Math.round(res.size / 1024)} KB`);
console.log(`  ${umgefaerbt} Pixel umgefärbt (${anteil} % der Fläche)`);
