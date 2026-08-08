/**
 * Bereitet die Bilder des Adler-Bosskampfs auf.
 *
 * Run mit:  npm run prep:boss
 *
 * Quelle: assets-src/art/boss/
 * Ziel:   public/boss/
 *
 *   banane_gold.png       -> banane_gold.webp     (Belohnung nach dem Kampf)
 *   kacke_dreierlei.png   -> kacke_klein|mittel|gross.webp
 *   warnung_enemy.png     -> warnung.webp         (Vorwarnung, bevor er kommt)
 *
 * DIE KACKHAUFEN WERDEN GEDREHT.
 * Die Vorlage zeigt sie so, wie sie am Boden liegen: Kuppe oben, Tropfen
 * laufen nach unten weg. Im Spiel FALLEN sie aber — dann gehört die Kuppe
 * nach unten und der Schweif nach oben, sonst fliegen die Tropfen voraus
 * statt hinterher. Deshalb 180 Grad.
 *
 * Freigestellt wird gegen den grauen Hintergrund der Vorlagen, mit demselben
 * Kennwert wie bei den Videos: max(Buntheit, Abstand zur Wandhelligkeit).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'assets-src/art/boss');
const OUT = resolve(ROOT, 'public/boss');

mkdirSync(OUT, { recursive: true });

const LO = 18;
const HI = 40;
const SPERRE = 0.3;

/** Stellt ein Bild gegen seinen flachen Hintergrund frei. */
async function freistellen(eingabe) {
  const { data, info } = await sharp(eingabe).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels, n = w * h;

  // Hintergrundhelligkeit aus dem Rand.
  const rand = [];
  for (let x = 0; x < w; x += 4) {
    for (const y of [0, h - 1]) {
      const i = (y * w + x) * ch;
      rand.push((data[i] + data[i + 1] + data[i + 2]) / 3);
    }
  }
  rand.sort((a, b) => a - b);
  const wandHell = rand[rand.length >> 1];
  const hellerHintergrund = wandHell > 200;

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const m = (r + g + b) / 3;
    const dr = r - m, dg = g - m, db = b - m;
    const buntheit = Math.sqrt(dr * dr + dg * dg + db * db);
    const k = Math.max(buntheit, hellerHintergrund ? wandHell - m : m - wandHell);
    alpha[i] = k <= LO ? 0 : k >= HI ? 1 : (k - LO) / (HI - LO);
  }

  // Vom Rand fluten: nur von aussen Erreichbares ist Hintergrund.
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

  /* EINGESCHLOSSENE HINTERGRUNDFLÄCHEN.
   *
   * Das Warnschild ist ein Rahmen: seine Innenfläche hat exakt die
   * Hintergrundfarbe, ist vom Bildrand aus aber nicht erreichbar. Ohne
   * diesen Durchgang blieb sie als grauer Klotz im Schild stehen.
   *
   * Unterschieden wird nach Grösse — eine echte Öffnung ist gross, ein Loch
   * durch Bildrauschen klein und soll zugehen. */
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
    rgba[q] = data[p]; rgba[q + 1] = data[p + 1]; rgba[q + 2] = data[p + 2];
    rgba[q + 3] = Math.round((hg[i] ? alpha[i] : 1) * 255);
  }
  return { rgba, w, h };
}

/** Schneidet auf die Silhouette zu und schreibt als WebP. */
async function schreiben({ rgba, w, h }, ziel, { drehen = false, hoehe = null } = {}) {
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
  if (maxX < 0) throw new Error(`nichts übrig: ${ziel}`);

  let bild = sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 });

  if (drehen) bild = bild.rotate(180);
  if (hoehe) bild = bild.resize({ height: hoehe });

  const geschrieben = await bild.webp({ quality: 90, alphaQuality: 100 }).toFile(ziel);
  return { w: maxX - minX + 1, h: maxY - minY + 1, bytes: geschrieben.size };
}

/* ------------------------------------------------------------------ Lauf */

console.log('Boss-Bilder aufbereiten:');

for (const [quelle, ziel, hoehe] of [
  ['banane_gold.png', 'banane_gold.webp', 320],
  ['warnung_enemy.png', 'warnung.webp', 420],
]) {
  const q = resolve(SRC, quelle);
  if (!existsSync(q)) { console.warn(`  FEHLT: ${q}`); continue; }
  const r = await schreiben(await freistellen(q), resolve(OUT, ziel), { hoehe });
  console.log(`  ${ziel.padEnd(20)} ${r.w}x${r.h} -> Höhe ${hoehe}  ${(r.bytes / 1024).toFixed(0)} KB`);
}

/* --- Die drei Kackhaufen: aufteilen, drehen ----------------------------- */

const kacke = resolve(SRC, 'kacke_dreierlei.png');
if (existsSync(kacke)) {
  const voll = await freistellen(kacke);

  // Die drei liegen nebeneinander. Aufgeteilt wird an den LÜCKEN, nicht in
  // Dritteln: sie sind verschieden breit und sitzen nicht mittig.
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

  const namen = ['kacke_klein', 'kacke_mittel', 'kacke_gross'];
  /* Volle Auflösung der Quelle (132/251/397 px) statt der früheren
   * 110/150/200. Im Spiel sind die Haufen 0.6 / 0.88 / 1.24 Welteinheiten
   * hoch — bei rund 330 px je Einheit also 200 / 290 / 410 Bildpunkte.
   * Kleiner zu exportieren hiess, sie hinterher wieder aufzublasen. */
  const hoehen = [132, 251, 397];
  if (gruppen.length !== 3) {
    console.warn(`  ACHTUNG: ${gruppen.length} Haufen gefunden statt 3 — Schwellwert prüfen`);
  }

  for (let i = 0; i < Math.min(3, gruppen.length); i++) {
    const [a, b] = gruppen[i];
    const breite = b - a + 1;
    const teil = Buffer.alloc(breite * voll.h * 4);
    for (let y = 0; y < voll.h; y++) {
      voll.rgba.copy(teil, y * breite * 4, (y * voll.w + a) * 4, (y * voll.w + b + 1) * 4);
    }
    const r = await schreiben(
      { rgba: teil, w: breite, h: voll.h },
      resolve(OUT, `${namen[i]}.webp`),
      { drehen: true, hoehe: hoehen[i] },
    );
    console.log(`  ${(namen[i] + '.webp').padEnd(20)} ${r.w}x${r.h} -> Höhe ${hoehen[i]}, um 180° gedreht  ${(r.bytes / 1024).toFixed(0)} KB`);
  }
}

/* --- Bildfolgen aus den Videos ----------------------------------------- *
 *
 * scripts/video-frames.mjs hat sie bereits freigestellt und mittig auf eine
 * gemeinsame Leinwand gelegt. Hier werden sie nur noch verkleinert und als
 * WebP ausgeliefert — die Rohbilder sind knapp 1000 px breit, im Spiel ist
 * der Adler keine 400 px gross.
 *
 * Die Zielhöhe je Satz bestimmt, wie gross die Figur im Spiel MAXIMAL
 * aufgelöst ist; die tatsächliche Grösse steht in CONFIG.
 */
const FOLGEN = [
  /* 800 statt der früheren 420.
   *
   * 420 war zu klein und im Spiel als Klötzchen zu sehen: der Adler ist
   * 2.4 Welteinheiten hoch, der Affe 2.5 — der Affe kam mit 720 px herein,
   * der Adler mit 420. Auf einem hohen Bildschirm war das mehr als doppelte
   * Vergrösserung.
   *
   * 800 ist praktisch die volle Auflösung der Rohbilder (972x806); höher zu
   * gehen brächte nichts ausser Dateigrösse. Die 26 Bilder werden ohnehin
   * erst geladen, wenn der erste Bosskampf ansteht. */
  /* DIE ADLERBILDER SIND WEG.
   *
   * Der Adler ist keine Bildfolge mehr, sondern eine gebaute 3D-Figur
   * (src/entities/Adler3D.js). Die 26 Einzelbilder haben 2.6 MB gewogen und
   * sahen bei jeder Groesse nach abgefilmtem Video aus. Die Rohvideos
   * liegen weiter in assets-src/art/adler_* — wer die Figur doch wieder
   * gegen Bilder tauschen will, holt sich die Zeilen aus der Historie. */
  // Der goldene Affe ist ein Fellwechsel der Spielfigur und folgt deshalb
  // der Namensgebung der übrigen Kletter-Sätze.
  { quelle: 'affe_gold', ziel: 'public/textures/gold', hoehe: 720, name: 'move' },
  { quelle: 'affe_wurf', ziel: 'public/textures/wurf', hoehe: 720, name: 'move' },
];

console.log('\nBildfolgen:');

for (const f of FOLGEN) {
  const von = resolve(ROOT, 'assets-src/art', f.quelle);
  if (!existsSync(von)) {
    console.warn(`  FEHLT: ${von} — erst "node scripts/video-frames.mjs" laufen lassen`);
    continue;
  }
  const nach = resolve(ROOT, f.ziel);
  mkdirSync(nach, { recursive: true });

  const { readdirSync, rmSync: entfernen } = await import('node:fs');
  // Alte Ausgaben weg: ein kürzerer Satz liesse sonst Reste stehen, die das
  // Spiel als gültige Bilder einsammelt.
  for (const alt of readdirSync(nach)) if (/\.webp$/i.test(alt)) entfernen(resolve(nach, alt));

  const bilder = readdirSync(von).filter((n) => /\.png$/i.test(n)).sort();
  let bytes = 0;
  let masse = '';
  for (let i = 0; i < bilder.length; i++) {
    const name = `${f.name ?? 'f'}_${String(i).padStart(2, '0')}.webp`;
    const g = await sharp(resolve(von, bilder[i]))
      .resize({ height: f.hoehe })
      .webp({ quality: 90, alphaQuality: 100 })
      .toFile(resolve(nach, name));
    bytes += g.size;
    if (i === 0) masse = `${g.width}x${g.height}`;
  }
  console.log(
    `  ${f.quelle.padEnd(14)} ${String(bilder.length).padStart(2)} Bilder, je ${masse}` +
      `  ${(bytes / 1024).toFixed(0)} KB  ->  ${f.ziel}/`,
  );
}

console.log(`\nZiel: public/boss/ und public/textures/`);
