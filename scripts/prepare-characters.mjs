/**
 * Stellt die drei Charakterbilder für die Auswahl frei.
 *
 * Run mit:  npm run prep:chars
 *
 * Quelle: assets-src/art/characters/{brown,white,orange}.png
 * Ziel:   public/characters/{brown,white,orange}.webp   (mit Alphakanal)
 *
 * Bewusst NICHT nach public/textures/: das sind Bilder für die Menü-Kacheln
 * und werden als gewöhnliche <img> geladen, nicht über den AssetLoader als
 * three.js-Texturen.
 *
 * FREISTELLUNG
 * Die Vorlagen zeigen den Affen auf einem Ast vor dichtem grünem Blattwerk.
 * Der Hintergrund wird über den Farbton bestimmt: Blattwerk ist grün-dominant
 * (G deutlich über R und B), Fell und Ast sind es nicht — das gilt für alle
 * drei Fellfarben, auch für den cremeweissen Affen.
 *
 * Danach:
 *   1. Von den Bildrändern aus fluten. Nur was von aussen erreichbar ist, ist
 *      wirklich Hintergrund — Blattlücken zwischen Arm und Körper bleiben so
 *      offen, grüne Reflexe IM Fell reissen aber keine Löcher.
 *   2. Grösste zusammenhängende Fläche nehmen. Das entfernt die einzelnen
 *      Blüten, die als "nicht grün" sonst stehen blieben.
 *   3. Der Ast läuft quer durchs ganze Bild und hängt an der Figur. Er wird
 *      an der Figur beschnitten: Zeilen, in denen die Fläche BEIDE Bildränder
 *      berührt, sind Ast; die Breite der Figur wird aus den Zeilen DARÜBER
 *      bestimmt und das Bild auf diese Breite zugeschnitten. Übrig bleibt der
 *      Affe auf einem kurzen Aststück — mit Schwanz, der darunter hängt.
 *   4. Kante um einen Pixel einziehen und weichzeichnen, damit kein grüner
 *      Saum stehen bleibt.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'assets-src/art/characters');
const OUT = resolve(ROOT, 'public/characters');
const DEBUG = resolve(ROOT, 'assets-src/art/_debug');

const CHARS = ['brown', 'white', 'orange'];

// Zielhöhe der Kachel. Die Auswahl zeigt drei Bilder nebeneinander; mehr als
// das braucht keine Kachel, und als WebP bleiben es je rund 25 KB.
const ZIELHOEHE = 420;

mkdirSync(OUT, { recursive: true });
mkdirSync(DEBUG, { recursive: true });

/** Ist das Pixel Blattwerk? Grün-dominant heisst: G klar über R UND über B. */
function istGruen(r, g, b) {
  return g > r * 1.05 && g > b * 1.02;
}

async function freistellen(key) {
  const src = resolve(SRC, `${key}.png`);
  if (!existsSync(src)) {
    console.warn(`  FEHLT: ${src}`);
    return null;
  }

  const { data, info } = await sharp(src)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const CH = info.channels;
  const N = W * H;

  /* --- 1) Grünmaske + Flutung vom Rand ---------------------------------- */
  const gruen = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const p = i * CH;
    gruen[i] = istGruen(data[p], data[p + 1], data[p + 2]) ? 1 : 0;
  }

  const hintergrund = new Uint8Array(N);
  const stapel = new Int32Array(N);
  let sp = 0;
  for (let x = 0; x < W; x++) {
    stapel[sp++] = x;
    stapel[sp++] = (H - 1) * W + x;
  }
  for (let y = 0; y < H; y++) {
    stapel[sp++] = y * W;
    stapel[sp++] = y * W + W - 1;
  }
  while (sp > 0) {
    const i = stapel[--sp];
    if (hintergrund[i] || !gruen[i]) continue;
    hintergrund[i] = 1;
    const x = i % W;
    const y = (i / W) | 0;
    if (x > 0) stapel[sp++] = i - 1;
    if (x < W - 1) stapel[sp++] = i + 1;
    if (y > 0) stapel[sp++] = i - W;
    if (y < H - 1) stapel[sp++] = i + W;
  }

  /* --- 2) Grösste zusammenhängende Vordergrundfläche --------------------- */
  const marke = new Int32Array(N).fill(-1);
  let besteMarke = -1;
  let besteGroesse = 0;
  let naechste = 0;

  for (let start = 0; start < N; start++) {
    if (hintergrund[start] || marke[start] !== -1) continue;
    const m = naechste++;
    let groesse = 0;
    sp = 0;
    stapel[sp++] = start;
    marke[start] = m;
    while (sp > 0) {
      const i = stapel[--sp];
      groesse++;
      const x = i % W;
      const y = (i / W) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < W - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - W);
      if (y < H - 1) nb.push(i + W);
      for (const j of nb) {
        if (!hintergrund[j] && marke[j] === -1) {
          marke[j] = m;
          stapel[sp++] = j;
        }
      }
    }
    if (groesse > besteGroesse) {
      besteGroesse = groesse;
      besteMarke = m;
    }
  }

  const figur = new Uint8Array(N);
  for (let i = 0; i < N; i++) figur[i] = marke[i] === besteMarke ? 1 : 0;

  /* --- 3) Den Affen finden und den Ast an ihm beschneiden ---------------- *
   * Zwei Ansätze sind vorher gescheitert, beide an denselben Lianen:
   *
   *   a) "Astzeilen berühren beide Bildränder, die Figur steht darüber" —
   *      die Lianen sind ebenfalls braun und laufen quer, gemessen wurde
   *      eine Figurbreite von praktisch dem ganzen Bild.
   *   b) "Der Ast ist dünn, der Affe massig, also wegerodieren" — die
   *      gedrehte Liane beim weissen Affen ist DICKER als der kleine Affe.
   *      Sie überlebte die Erosion und gewann als grösste Fläche.
   *
   * Das eindeutige Merkmal ist nicht die Dicke, sondern die HÖHE: der Ast
   * ist ein flaches Band über die ganze Breite, der Affe ragt mit Kopf weit
   * darüber und mit Schwanz weit darunter hinaus. Gezählt wird deshalb je
   * Bildspalte, wie viele Figurpixel darin liegen — über dem Affen ist diese
   * Säule ein Vielfaches der reinen Astsäule.
   */
  const saeule = new Int32Array(W);
  for (let i = 0; i < N; i++) if (figur[i]) saeule[i % W]++;

  let spitzeX = 0;
  for (let x = 1; x < W; x++) if (saeule[x] > saeule[spitzeX]) spitzeX = x;

  // Von der höchsten Säule aus nach beiden Seiten laufen, solange die Säule
  // wenigstens 45 % der Spitze hält. Damit sind Kopf, Rumpf und Arme drin,
  // der reine Ast (der weit darunter liegt) aber draussen.
  const schwelle = saeule[spitzeX] * 0.45;
  let rumpfLinks = spitzeX;
  let rumpfRechts = spitzeX;
  while (rumpfLinks > 0 && saeule[rumpfLinks - 1] >= schwelle) rumpfLinks--;
  while (rumpfRechts < W - 1 && saeule[rumpfRechts + 1] >= schwelle) rumpfRechts++;

  const rumpfGroesse = saeule[spitzeX];
  const erosionSchritte = 0; // Erosion wird nicht mehr gebraucht

  // Arme und Schwanz greifen deutlich über den Rumpf hinaus — das Fenster
  // wird daher symmetrisch um die Rumpfmitte aufgezogen.
  const rumpfBreite = rumpfRechts - rumpfLinks + 1;
  const mitte = Math.round((rumpfLinks + rumpfRechts) / 2);
  const halb = Math.round(rumpfBreite * 0.95);
  const cropL = Math.max(0, mitte - halb);
  const cropR = Math.min(W - 1, mitte + halb);

  const figurLinks = rumpfLinks;
  const figurRechts = rumpfRechts;
  const astOben = -1;
  const astUnten = -1;

  for (let i = 0; i < N; i++) {
    const x = i % W;
    if (x < cropL || x > cropR) figur[i] = 0;
  }

  /* --- 4) Kante einziehen ------------------------------------------------ */
  // Ein Pixel Erosion: die äussersten Pixel tragen noch Blattgrün.
  const erodiert = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!figur[i]) continue;
    const x = i % W;
    const y = (i / W) | 0;
    const drin =
      (x === 0 || figur[i - 1]) &&
      (x === W - 1 || figur[i + 1]) &&
      (y === 0 || figur[i - W]) &&
      (y === H - 1 || figur[i + W]);
    erodiert[i] = drin ? 1 : 0;
  }

  /* --- Alphakanal anlegen und zuschneiden -------------------------------- */
  const rgba = Buffer.alloc(N * 4);
  let minX = W, maxX = -1, minY = H, maxY = -1;
  let flaeche = 0;
  for (let i = 0; i < N; i++) {
    const p = i * CH;
    rgba[i * 4] = data[p];
    rgba[i * 4 + 1] = data[p + 1];
    rgba[i * 4 + 2] = data[p + 2];
    rgba[i * 4 + 3] = erodiert[i] ? 255 : 0;
    if (erodiert[i]) {
      flaeche++;
      const x = i % W;
      const y = (i / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) {
    console.warn(`  ${key}: nichts übrig geblieben — Schwellwerte prüfen`);
    return null;
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;

  const zugeschnitten = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: boxW, height: boxH })
    .png()
    .toBuffer();

  // Weiche Kante: Alphakanal leicht weichzeichnen, damit die Silhouette nicht
  // trepplig wirkt. Nur der Alphakanal, nicht die Farbe.
  const skala = ZIELHOEHE / boxH;
  const fertig = await sharp(zugeschnitten)
    .resize(Math.round(boxW * skala), ZIELHOEHE, { kernel: 'lanczos3' })
    .webp({ quality: 90, alphaQuality: 100 })
    .toFile(resolve(OUT, `${key}.webp`));

  // Kontrollbild: Silhouette auf Magenta, damit Reste sofort auffallen.
  await sharp(zugeschnitten)
    .resize(Math.round(boxW * skala), ZIELHOEHE)
    .flatten({ background: { r: 255, g: 0, b: 255 } })
    .png()
    .toFile(resolve(DEBUG, `char_${key}_kontrolle.png`));

  console.log(
    `  ${key}.webp`.padEnd(24) +
      `${W}x${H} -> ${Math.round(boxW * skala)}x${ZIELHOEHE}  ` +
      `Säule max ${rumpfGroesse} px bei x=${spitzeX}  ` +
      `Rumpf x ${figurLinks}–${figurRechts}  ` +
      `Fenster ${cropL}–${cropR}  ` +
      `${(flaeche / N * 100).toFixed(1)} % Deckung  ${(fertig.size / 1024).toFixed(0)} KB`,
  );
  return true;
}

console.log('Charakterbilder freistellen:');
for (const key of CHARS) await freistellen(key);
console.log(`\nKontrollbilder (Silhouette auf Magenta): assets-src/art/_debug/`);
