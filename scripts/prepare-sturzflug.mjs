/**
 * Bereitet die Bilder des Sturzflug-Angriffs auf.
 *
 * Run mit:  npm run prep:sturz
 *
 * Quelle: assets-src/art/boss/
 * Ziel:   public/hazards/
 *
 *   warnung_bahn.png   -> warnung_bahn.webp      Schild über der bedrohten Bahn
 *   sturzvoegel.png    -> vogel_1|2|3.webp       drei Vögel im Sturzflug
 *
 * DIE VÖGEL WERDEN NICHT GEDREHT.
 * Die Vorlage zeigt sie schon von oben im Sturz — Schnabel nach unten,
 * Schwanz nach oben. Genau so fallen sie im Spiel. Sie werden nur an den
 * Lücken zwischen ihnen aufgeteilt, wie die drei Kackhaufen.
 *
 * Freigestellt wird gegen den grauen Hintergrund, mit demselben Kennwert
 * wie überall sonst: max(Buntheit, Abstand zur Hintergrundhelligkeit).
 * Der Code dafür ist eine Kopie aus prepare-boss.mjs — bewusst kopiert und
 * nicht geteilt: die beiden Skripte laufen unabhängig, und ein gemeinsames
 * Modul hätte beim ersten abweichenden Schwellwert doch wieder zwei Fassungen.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'assets-src/art/boss');
const OUT = resolve(ROOT, 'public/hazards');

mkdirSync(OUT, { recursive: true });

const LO = 18;
const HI = 40;
const SPERRE = 0.3;

async function freistellen(eingabe) {
  const { data, info } = await sharp(eingabe)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height,
    ch = info.channels,
    n = w * h;

  const rand = [];
  for (let x = 0; x < w; x += 4) {
    for (const y of [0, h - 1]) {
      const i = (y * w + x) * ch;
      rand.push((data[i] + data[i + 1] + data[i + 2]) / 3);
    }
  }
  rand.sort((a, b) => a - b);
  const wandHell = rand[rand.length >> 1];

  /* HELLIGKEIT IN BEIDE RICHTUNGEN.
   *
   * prepare-boss.mjs entscheidet anhand von `wandHell > 200`, ob Inhalt
   * heller oder dunkler als der Hintergrund ist, und misst nur in DIESE
   * Richtung. Das geht gut, solange der Hintergrund weiss oder fast schwarz
   * ist. Diese Vorlage hat einen MITTELGRAUEN Hintergrund (gemessen 148),
   * und die Vögel sind dunkler — die Rechnung ergab negative Werte, der
   * Kennwert fiel auf die blosse Buntheit zurück, und weil eine schwarze
   * Krähe und ein grauer Geier kaum bunt sind, wurden sie fast vollständig
   * weggeschnitten. Übrig blieben der braune Falke und der rosa Geierkopf.
   *
   * Der Betrag ist hier richtig und nicht nur bequemer: der Hintergrund ist
   * flach, also ist JEDE Abweichung Inhalt, egal in welche Richtung. */
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    const r = data[p],
      g = data[p + 1],
      b = data[p + 2];
    const m = (r + g + b) / 3;
    const dr = r - m,
      dg = g - m,
      db = b - m;
    const buntheit = Math.sqrt(dr * dr + dg * dg + db * db);
    const k = Math.max(buntheit, Math.abs(m - wandHell));
    alpha[i] = k <= LO ? 0 : k >= HI ? 1 : (k - LO) / (HI - LO);
  }

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
    const x = i % w,
      y = (i / w) | 0;
    if (x > 0) stapel[sp++] = i - 1;
    if (x < w - 1) stapel[sp++] = i + 1;
    if (y > 0) stapel[sp++] = i - w;
    if (y < h - 1) stapel[sp++] = i + w;
  }

  const MIN_LUECKE = Math.max(300, Math.round(n * 0.0004));
  const gesehen = new Uint8Array(n);
  for (let anfang = 0; anfang < n; anfang++) {
    if (gesehen[anfang] || hg[anfang] || alpha[anfang] >= SPERRE) continue;
    const gruppe = [];
    const st = [anfang];
    gesehen[anfang] = 1;
    while (st.length) {
      const i = st.pop();
      gruppe.push(i);
      const x = i % w,
        y = (i / w) | 0;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < w - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - w);
      if (y < h - 1) nb.push(i + w);
      for (const j of nb)
        if (!gesehen[j] && !hg[j] && alpha[j] < SPERRE) {
          gesehen[j] = 1;
          st.push(j);
        }
    }
    if (gruppe.length >= MIN_LUECKE) for (const i of gruppe) hg[i] = 1;
  }

  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * ch,
      q = i * 4;
    rgba[q] = data[p];
    rgba[q + 1] = data[p + 1];
    rgba[q + 2] = data[p + 2];
    rgba[q + 3] = Math.round((hg[i] ? alpha[i] : 1) * 255);
  }
  return { rgba, w, h };
}

async function schreiben({ rgba, w, h }, ziel, hoehe) {
  let minX = w,
    maxX = -1,
    minY = h,
    maxY = -1;
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] > 8) {
      const x = i % w,
        y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error(`${ziel}: nichts übrig geblieben`);

  const bild = sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize({ height: hoehe });

  const g = await bild.webp({ quality: 92, alphaQuality: 100 }).toFile(ziel);
  return { w: maxX - minX + 1, h: maxY - minY + 1, bytes: g.size, aus: [g.width, g.height] };
}

/* --- Warnschild ---------------------------------------------------------- */

const schild = resolve(SRC, 'warnung_bahn.png');
if (existsSync(schild)) {
  const r = await schreiben(await freistellen(schild), resolve(OUT, 'warnung_bahn.webp'), 320);
  console.log(`  warnung_bahn.webp   ${r.aus[0]}x${r.aus[1]}  ${(r.bytes / 1024).toFixed(0)} KB`);
} else {
  console.warn(`  FEHLT: ${schild}`);
}

/* --- Die drei Vögel: an den Lücken aufteilen ----------------------------- */

const voegel = resolve(SRC, 'sturzvoegel.png');
if (existsSync(voegel)) {
  const voll = await freistellen(voegel);

  // Aufgeteilt wird an den LÜCKEN, nicht in Dritteln: die drei sind
  // verschieden breit und sitzen nicht auf gleichen Abständen.
  const spalte = new Int32Array(voll.w);
  for (let i = 0; i < voll.w * voll.h; i++) {
    if (voll.rgba[i * 4 + 3] > 24) spalte[i % voll.w]++;
  }
  const gruppen = [];
  let start = -1;
  for (let x = 0; x <= voll.w; x++) {
    const belegt = x < voll.w && spalte[x] > 0;
    if (belegt && start < 0) start = x;
    if (!belegt && start >= 0) {
      if (x - start > voll.w * 0.04) gruppen.push([start, x - 1]);
      start = -1;
    }
  }
  if (gruppen.length !== 3) {
    console.warn(`  ACHTUNG: ${gruppen.length} Vögel gefunden statt 3 — Schwellwert prüfen`);
  }

  /* Alle drei auf DIESELBE Höhe. Sie sind in der Vorlage verschieden gross
   * gezeichnet; im Spiel sind sie dieselbe Gefahr und müssen deshalb gleich
   * gross sein, sonst liest man die kleineren als harmloser. */
  for (let i = 0; i < Math.min(3, gruppen.length); i++) {
    const [a, b] = gruppen[i];
    const breite = b - a + 1;
    const teil = Buffer.alloc(breite * voll.h * 4);
    for (let y = 0; y < voll.h; y++) {
      voll.rgba.copy(teil, y * breite * 4, (y * voll.w + a) * 4, (y * voll.w + b + 1) * 4);
    }
    const r = await schreiben(
      { rgba: teil, w: breite, h: voll.h },
      resolve(OUT, `vogel_${i + 1}.webp`),
      460,
    );
    console.log(`  vogel_${i + 1}.webp        ${r.aus[0]}x${r.aus[1]}  ${(r.bytes / 1024).toFixed(0)} KB`);
  }
}

console.log('\nZiel: public/hazards/');
