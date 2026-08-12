/**
 * Macht aus dem Video des KLEINEN AFFEN die Wurfanimation des Spielers.
 *
 *   npm run prep:spielerwurf
 *
 * Quelle: hf_20260808_114309_….mp4 (Downloads oder Desktop)
 * Ziel:   public/textures/wurf/move_NN.webp
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WARUM DIESES VIDEO HIER UND NICHT ALS BOSS
 *
 * Es zeigt DENSELBEN Affen wie die Spielfigur — dieselbe Figur, dieselbe
 * Ansicht von hinten, dieselbe Fellfarbe. Als Gegner oben im Bild war das
 * verwirrend: man kämpfte gegen sich selbst. Unten am Spieler ist es dagegen
 * genau richtig, weil es dort dieselbe Figur SEIN SOLL.
 *
 * Der Boss ist deshalb allein der Gorilla.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGISTRIERUNG — das Eigentliche an diesem Skript
 *
 * Die Wurfbilder ersetzen für die Dauer des Wurfs die Kletterbilder. Sitzt
 * die Figur darin anders im Rahmen, springt sie beim Werfen — und wieder
 * zurück. Man sieht das sofort, und es sieht kaputt aus.
 *
 * Deshalb wird nicht einfach auf die Silhouette zugeschnitten, sondern auf
 * das MASS DER KLETTERBILDER gebracht:
 *
 *   1. Aus public/textures/move_00.webp wird gemessen, wie hoch die Figur
 *      dort im Verhältnis zur Bildhöhe steht (Silhouettenhöhe / Bildhöhe).
 *   2. Die Wurfbilder werden so skaliert, dass ihre Figur DIESELBE relative
 *      Höhe hat.
 *   3. Waagerecht wird auf den Schwerpunkt der Figur ausgerichtet, senkrecht
 *      auf die Unterkante — der Affe steht auf derselben Höhe wie beim
 *      Klettern, egal wie weit er die Arme streckt.
 *
 * SpritePlayer.setzeWurfFrames gleicht danach nur noch das Seitenverhältnis
 * aus (`_wurfBreite`), damit der breitere Wurfrahmen die Figur nicht
 * quetscht.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HEIM = process.env.USERPROFILE ?? process.env.HOME ?? '';
const QUELLEN = [resolve(HEIM, 'Downloads'), resolve(HEIM, 'Desktop')];
const OUT = resolve(ROOT, 'public/textures/wurf');
const VORBILD = resolve(ROOT, 'public/textures/move_00.webp');

const VIDEO = 'hf_20260808_114309_03b9688f-109d-43a0-9fb4-ba65b3578a8b.mp4';
const BILDER = 12; // muss zu CONFIG.boss.wurf.frameAnzahl passen
const QUALITAET = 88;

/* Schwellen des Alphakeils — der Hintergrund des Videos ist fast weiss
 * (gemessen 250) und extrem flach (Randschwankung höchstens 3). */
const LO = 7;
const HI = 22;
const SPERRE = 0.3;

function finden(datei) {
  for (const o of QUELLEN) {
    const p = join(o, datei);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Freistellen über den BETRAG des Abstands zur Hintergrundfarbe. */
async function freistellen(datei) {
  const { data, info } = await sharp(datei).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const n = w * h;

  const kanal = [[], [], []];
  for (let x = 0; x < w; x += 3) {
    for (const y of [0, 1, h - 2, h - 1]) {
      const i = (y * w + x) * ch;
      for (let k = 0; k < 3; k++) kanal[k].push(data[i + k]);
    }
  }
  const bg = kanal.map((v) => {
    v.sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const bgHell = (bg[0] + bg[1] + bg[2]) / 3;

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const m = (r + g + b) / 3;
    const dr = r - m;
    const dg = g - m;
    const db = b - m;
    const buntheit = Math.sqrt(dr * dr + dg * dg + db * db);
    const k = Math.max(buntheit, Math.abs(m - bgHell));
    alpha[i] = k <= LO ? 0 : k >= HI ? 1 : (k - LO) / (HI - LO);
  }

  // Vom Rand fluten: nur von aussen Erreichbares ist Hintergrund.
  const hg = new Uint8Array(n);
  const stapel = new Int32Array(n);
  let sp = 0;
  for (let x = 0; x < w; x++) {
    stapel[sp++] = x;
    stapel[sp++] = (h - 1) * w + x;
  }
  for (let y = 0; y < h; y++) {
    stapel[sp++] = y * w;
    stapel[sp++] = y * w + w - 1;
  }
  while (sp > 0) {
    const i = stapel[--sp];
    if (hg[i] || alpha[i] >= SPERRE) continue;
    hg[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) stapel[sp++] = i - 1;
    if (x < w - 1) stapel[sp++] = i + 1;
    if (y > 0) stapel[sp++] = i - w;
    if (y < h - 1) stapel[sp++] = i + w;
  }

  const rgba = Buffer.alloc(n * 4);
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    const q = i * 4;
    const a = hg[i] ? alpha[i] : 1;
    rgba[q] = data[p];
    rgba[q + 1] = data[p + 1];
    rgba[q + 2] = data[p + 2];
    rgba[q + 3] = Math.round(a * 255);
    if (a > 0.1) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { rgba, w, h, minX, maxX, minY, maxY };
}

/** Silhouettenhöhe eines fertigen Bildes im Verhältnis zur Bildhöhe. */
async function figurAnteil(datei) {
  const { data, info } = await sharp(datei).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minY = info.height;
  let maxY = -1;
  for (let i = 0; i < info.width * info.height; i++) {
    if (data[i * 4 + 3] > 24) {
      const y = (i / info.width) | 0;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { anteil: (maxY - minY + 1) / info.height, hoehe: info.height, breite: info.width };
}

/* -------------------------------------------------------------------- Lauf */

const video = finden(VIDEO);
if (!video) {
  console.error(`Vorlage nicht gefunden: ${VIDEO}\nGesucht in:\n  ${QUELLEN.join('\n  ')}`);
  process.exit(1);
}
if (!existsSync(VORBILD)) {
  console.error(`Kletterbild fehlt: ${VORBILD} — ohne es lässt sich nicht registrieren.`);
  process.exit(1);
}

const vorbild = await figurAnteil(VORBILD);
console.log(`Kletterbild: ${vorbild.breite}x${vorbild.hoehe}, Figur füllt ${(vorbild.anteil * 100).toFixed(1)} % der Höhe`);

const tmp = join(OUT, '_tmp');
mkdirSync(tmp, { recursive: true });
for (const f of readdirSync(tmp)) rmSync(join(tmp, f));

const r = spawnSync(
  ffmpeg,
  ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `fps=${BILDER}/5.06`, '-frames:v', String(BILDER), join(tmp, 'roh_%03d.png')],
  { encoding: 'utf8' },
);
if (r.status !== 0) {
  console.error('ffmpeg:', (r.stderr || '').slice(-400));
  process.exit(1);
}

const roh = readdirSync(tmp).filter((f) => f.startsWith('roh_')).sort().map((f) => join(tmp, f));
const frei = [];
for (const f of roh) frei.push(await freistellen(f));

/* Gemeinsamer Ausschnitt über ALLE Bilder — die Figur darf sich darin
 * bewegen, springen darf sie nicht. */
const g = {
  minX: Math.min(...frei.map((f) => f.minX)),
  maxX: Math.max(...frei.map((f) => f.maxX)),
  minY: Math.min(...frei.map((f) => f.minY)),
  maxY: Math.max(...frei.map((f) => f.maxY)),
};
const bw = g.maxX - g.minX + 1;
const bh = g.maxY - g.minY + 1;

/* Zielhöhe so wählen, dass die FIGUR denselben Anteil der Bildhöhe einnimmt
 * wie beim Klettern. Der Ausschnitt ist bereits eng an der Figur, sein
 * Figuranteil ist also ~1.0; die Leinwand wird entsprechend höher. */
const zielFigurHoehe = Math.round(vorbild.hoehe * vorbild.anteil);
const skal = zielFigurHoehe / bh;
const leinwandH = vorbild.hoehe;
const leinwandW = Math.round(bw * skal);
const obenPad = Math.round((leinwandH - zielFigurHoehe) / 2);

console.log(`Ausschnitt aus dem Video: ${bw}x${bh}`);
console.log(`-> skaliert auf ${leinwandW}x${zielFigurHoehe}, Leinwand ${leinwandW}x${leinwandH}`);

for (const f of readdirSync(OUT)) {
  if (f.endsWith('.webp')) rmSync(join(OUT, f));
}

const breiten = [];
let kb = 0;
for (let i = 0; i < frei.length; i++) {
  const f = frei[i];
  breiten.push(f.maxX - f.minX + 1);
  const ziel = join(OUT, `move_${String(i).padStart(2, '0')}.webp`);
  const zugeschnitten = await sharp(f.rgba, { raw: { width: f.w, height: f.h, channels: 4 } })
    .extract({ left: g.minX, top: g.minY, width: bw, height: bh })
    .resize({ width: leinwandW, height: zielFigurHoehe, fit: 'fill' })
    // Als PNG zwischenspeichern: aus einem Rohpuffer kann `composite` das
    // Format nicht erraten und bricht mit "unsupported image format" ab.
    .png()
    .toBuffer();

  const info = await sharp({
    create: { width: leinwandW, height: leinwandH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: zugeschnitten, left: 0, top: obenPad }])
    .webp({ quality: QUALITAET, alphaQuality: 100 })
    .toFile(ziel);
  kb += info.size / 1024;
}

rmSync(tmp, { recursive: true, force: true });

const maxB = Math.max(...breiten);
const wurfBild = breiten.indexOf(maxB);
console.log(`\n${frei.length} Bilder, zusammen ${kb.toFixed(0)} KB`);
console.log(`breitestes Bild (Arm am weitesten gestreckt): move_${String(wurfBild).padStart(2, '0')}`);
console.log(`-> CONFIG.boss.wurf.loslassenBei ≈ ${(wurfBild / breiten.length).toFixed(3)}`);
