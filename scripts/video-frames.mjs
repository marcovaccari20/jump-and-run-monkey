/**
 * Zerlegt ein Bewegungsvideo in freigestellte Einzelbilder — ohne Browser.
 *
 * Run mit:
 *   node scripts/video-frames.mjs <video.mp4> <zielordner> [--frames 12]
 *
 * LÖST scripts/video-to-frames.mjs AB. Jenes Skript dekodierte im Browser,
 * weil es kein ffmpeg gab; das war fehleranfällig (der Tab musste sichtbar
 * sein, sonst lieferte jedes Springen dasselbe Bild) und langsam. Seit
 * `ffmpeg-static` als Abhängigkeit dabei ist, geht es direkt hier.
 *
 * Die Freistellung ist dieselbe wie vorher, nur in Node statt im Browser:
 *
 *   Kennwert = max(Buntheit, Aufhellung)
 *
 * Wand UND Schatten sind neutrales Grau; die Figur ist entweder bunt oder
 * heller als die Wand, und ein Schatten ist nie bunter. Ein blosser
 * Farbabstand trennt beides nicht — beim orangen Affen lag der Schlagschatten
 * weiter von der Wand entfernt als manche Stelle der Figur.
 *
 * Danach: vom Rand fluten (nur von aussen Erreichbares ist Hintergrund),
 * eingeschlossene Wandflächen ab einer Mindestgrösse ebenfalls freigeben,
 * Grau-Saum herausrechnen, auf die Silhouette zuschneiden und mittig auf eine
 * für ALLE Bilder gemeinsame Leinwand legen.
 *
 * Es werden nur SICHTBAR VERSCHIEDENE Bilder geschrieben: die Videos laufen
 * mit 24 fps, aber die Bewegung darin ist gröber. Wer stur gleichmässig
 * abtastet, bekommt Wiederholungen, und die Animation hakt.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/* ------------------------------------------------------------- Argumente */

const [, , videoArg, zielArg] = process.argv;
if (!videoArg || !zielArg) {
  console.error('Aufruf: node scripts/video-frames.mjs <video.mp4> <zielordner> [--frames 12]');
  process.exit(1);
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? Number(process.argv[i + 1]) : fallback;
};

const VIDEO = resolve(videoArg);
const ZIEL = resolve(ROOT, 'assets-src/art', zielArg);
const WUNSCH = arg('frames', 12);
/** Ab dieser Änderung gilt ein Bild als neu (Skala: mittlerer Kanalabstand). */
const MIN_ABSTAND = arg('abstand', 2.5);

if (!existsSync(VIDEO)) {
  console.error(`Video nicht gefunden: ${VIDEO}`);
  process.exit(1);
}

/* --------------------------------------------------- Rohbilder mit ffmpeg */

const ROH = resolve(ROOT, 'assets-src/art/_roh');
rmSync(ROH, { recursive: true, force: true });
mkdirSync(ROH, { recursive: true });

console.log(`Video:  ${VIDEO}`);
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', VIDEO, `${ROH}/f_%04d.png`]);

const roh = readdirSync(ROH).filter((f) => f.endsWith('.png')).sort();
console.log(`        ${roh.length} Rohbilder entpackt`);

/* ------------------------------------------------------------ Freistellen */

const LO = 22;
const HI = 45;
const SPERRE = 0.3;
const MIN_LUECKE = 300;
const DESPILL_AB = 0.35;

const klemm = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Hintergrundfarbe aus dem Bildrand (Median). */
function bgFarbe(d, w, h, ch) {
  const rs = [], gs = [], bs = [];
  const nimm = (x, y) => {
    const i = (y * w + x) * ch;
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
  };
  for (let x = 0; x < w; x += 4) { nimm(x, 0); nimm(x, h - 1); }
  for (let y = 0; y < h; y += 4) { nimm(0, y); nimm(w - 1, y); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

/** Stellt ein Rohbild frei und gibt RGBA zurück. */
async function freistellen(datei) {
  const { data, info } = await sharp(datei).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels, n = w * h;
  const [br, bg_, bb] = bgFarbe(data, w, h, ch);
  const wandHell = (br + bg_ + bb) / 3;

  /* HELLIGKEIT IN BEIDE RICHTUNGEN — mit einem Freibetrag nach unten.
   *
   * HIER STAND EINE RICHTUNGSANNAHME, und die hat sichtbaren Schaden
   * angerichtet. Die Regel lautete: bei grauer Wand ist die Figur HELLER,
   * bei weisser DUNKLER. Sie stimmt, solange die Figur flach ausgeleuchtet
   * ist. Die neuen Kletter- und Chilivideos sind es nicht — der Affe wird
   * von der Seite angestrahlt, und seine Schattenseite ist DUNKLER als die
   * graue Wand. Für die galt dann nur noch die Buntheit, und dunkelbraunes
   * Fell im Schatten ist kaum bunt.
   *
   * Gemessen am fertigen Bild: 14.4 % der Figur waren halbdurchsichtig
   * (beim Goldaffen aus einem flach beleuchteten Video: 2.7 %). Im Spiel sah
   * das aus wie ein zerfressener, verpixelter Kopf mit Löchern im Rumpf.
   *
   * Beide Richtungen bedingungslos zu nehmen geht aber auch nicht: der
   * SCHLAGSCHATTEN auf der Wand ist ebenfalls dunkler und würde damit zum
   * Inhalt. Gemessen an einem Rohbild lassen sich die beiden sauber
   * trennen:
   *
   *   Schlagschatten   Buntheit  0-6,  dunkler um   0-20   (neutrales Grau)
   *   Fell im Schatten Buntheit 18-36, dunkler um  60-120  (braun)
   *
   * Nach unten gilt deshalb ein Freibetrag: die ersten `SCHATTEN` Stufen
   * Dunkelheit zählen nicht. Ein weicher Schatten fällt darunter, eine
   * beschattete Flanke weit darüber. Nach oben gibt es keinen Freibetrag —
   * heller als der Hintergrund wird nichts ausser der Figur. */
  const SCHATTEN = 26;

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const m = (r + g + b) / 3;
    const dr = r - m, dg = g - m, db = b - m;
    const buntheit = Math.sqrt(dr * dr + dg * dg + db * db);
    const heller = m - wandHell;
    const abstandHell = heller >= 0 ? heller : Math.max(0, -heller - SCHATTEN);
    const k = Math.max(buntheit, abstandHell);
    alpha[i] = k <= LO ? 0 : k >= HI ? 1 : (k - LO) / (HI - LO);
  }

  // Vom Rand fluten
  const hg = new Uint8Array(n);
  const stapel = new Int32Array(n);
  let sp = 0;
  for (let x = 0; x < w; x++) { stapel[sp++] = x; stapel[sp++] = (h - 1) * w + x; }
  for (let y = 0; y < h; y++) { stapel[sp++] = y * w; stapel[sp++] = y * w + w - 1; }
  while (sp > 0) {
    const i = stapel[--sp];
    if (hg[i] || alpha[i] >= SPERRE) continue;
    hg[i] = 1;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stapel[sp++] = i - 1;
    if (x < w - 1) stapel[sp++] = i + 1;
    if (y > 0) stapel[sp++] = i - w;
    if (y < h - 1) stapel[sp++] = i + w;
  }

  // Eingeschlossene Wandflächen ab MIN_LUECKE ebenfalls freigeben
  const gesehen = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (gesehen[start] || hg[start] || alpha[start] >= SPERRE) continue;
    const gruppe = [];
    const st = [start];
    gesehen[start] = 1;
    while (st.length) {
      const i = st.pop();
      gruppe.push(i);
      const x = i % w, y = (i / w) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb) if (!gesehen[j] && !hg[j] && alpha[j] < SPERRE) { gesehen[j] = 1; st.push(j); }
    }
    if (gruppe.length >= MIN_LUECKE) for (const i of gruppe) hg[i] = 1;
  }

  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * ch, q = i * 4;
    const a = hg[i] ? alpha[i] : 1;
    let r = data[p], g = data[p + 1], b = data[p + 2];
    if (a >= DESPILL_AB && a < 1) {
      r = klemm((r - (1 - a) * br) / a);
      g = klemm((g - (1 - a) * bg_) / a);
      b = klemm((b - (1 - a) * bb) / a);
    }
    rgba[q] = r; rgba[q + 1] = g; rgba[q + 2] = b; rgba[q + 3] = Math.round(a * 255);
  }
  return { rgba, w, h };
}

/** Mittlerer Kanalabstand zweier Bilder, grob gerastert. */
function abstand(a, b, w, h) {
  const schritt = Math.max(1, Math.floor(w / 96));
  let s = 0, n = 0;
  for (let y = 0; y < h; y += schritt) {
    for (let x = 0; x < w; x += schritt) {
      const i = (y * w + x) * 4;
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
           Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
      n += 4;
    }
  }
  return s / n;
}

/* ------------------------------------------------------------------ Lauf */

const behalten = [];
let letztes = null;

for (const f of roh) {
  const bild = await freistellen(resolve(ROH, f));
  if (letztes && abstand(letztes.rgba, bild.rgba, bild.w, bild.h) < MIN_ABSTAND) continue;
  letztes = bild;
  behalten.push(bild);
}

console.log(`        ${behalten.length} sichtbar verschiedene Bilder`);

// Gleichmässig bis zu WUNSCH Stück auswählen.
const anzahl = Math.min(WUNSCH, behalten.length);
const schritt = behalten.length / anzahl;
const gewaehlt = [];
for (let i = 0; i < anzahl; i++) gewaehlt.push(behalten[Math.floor(i * schritt)]);

// Gemeinsame Leinwand aus allen Bounding-Boxen.
const boxen = gewaehlt.map(({ rgba, w, h }) => {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] > 24) {
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { left: minX, top: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
});

const pad = 6;
const leinwandW = Math.max(...boxen.map((b) => b.w)) + pad * 2;
const leinwandH = Math.max(...boxen.map((b) => b.h)) + pad * 2;

rmSync(ZIEL, { recursive: true, force: true });
mkdirSync(ZIEL, { recursive: true });

for (let i = 0; i < gewaehlt.length; i++) {
  const { rgba, w, h } = gewaehlt[i];
  const b = boxen[i];
  const cut = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: b.left, top: b.top, width: b.w, height: b.h })
    .png()
    .toBuffer();

  await sharp({
    create: { width: leinwandW, height: leinwandH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: cut, left: Math.round((leinwandW - b.w) / 2), top: Math.round((leinwandH - b.h) / 2) }])
    .png()
    .toFile(resolve(ZIEL, `f_${String(i).padStart(2, '0')}.png`));
}

rmSync(ROH, { recursive: true, force: true });

console.log(`Ziel:   ${ZIEL}`);
console.log(`        ${gewaehlt.length} Bilder, je ${leinwandW}x${leinwandH}` +
  (gewaehlt.length < WUNSCH ? `  (statt ${WUNSCH} — mehr gibt das Video nicht her)` : ''));
