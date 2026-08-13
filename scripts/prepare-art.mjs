/**
 * Bereitet die gelieferten Bilder für das Spiel auf.
 *
 * Run mit:  npm run prep:art
 *
 * Quelle: assets-src/art/  (die Original-PNGs)
 * Ziel:   public/textures/
 *
 *   stage1_green.png     Hintergrundstufe 1 — grün pur
 *   stage2_flowers.png   Hintergrundstufe 2 — grün mit Blumen
 *   stage3_branches.png  Hintergrundstufe 3 — Äste
 *   move_00.webp …       Kletter-Frames aus dem Bewegungsvideo (mit Alphakanal)
 *
 * AFFEN-FREISTELLUNG
 * Das Quellbild zeigt den Affen auf Dschungelhintergrund. Freigestellt wird
 * lokal (keine externen Dienste) über den Farbton: das Fell ist braun/orange
 * (R > G), das Blattwerk grün (G > R). Aus der Rohmaske wird die grösste
 * zusammenhängende Fläche um die Bildmitte genommen, Löcher werden gefüllt
 * und die Kante leicht weichgezeichnet.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'assets-src/art');
const OUT = resolve(ROOT, 'public/textures');

// Ausgabe als WebP: die Vorlagen sind als PNG rund 2 MB pro Stück, als WebP
// bleibt bei praktisch gleicher Qualität etwa ein Zehntel übrig. Bei drei
// Stufen mal zwei Fassungen macht das den Unterschied zwischen einem
// 9-MB- und einem 2-MB-Build.
// Reihenfolge = Reihenfolge der Stufen im Spiel (siehe CONFIG.wall.stages).
//
// Die Nummer im Namen ist die Reihenfolge, in der die Bilder GELIEFERT
// wurden — nicht die Reihenfolge im Spiel. Die steht allein in
// CONFIG.wall.stages. Die vier später dazugekommenen Wände tragen deshalb
// gar keine Nummer mehr.
const BACKGROUNDS = [
  'stage1_green',
  'stage2_flowers',
  'stage3_branches',
  'stage4_poison',
  'stage5_halloween',
  'stage6_ice',
  'stage7_clouds',
  'stage8_lava',
  'stage9_ash',
  'wall_mushroom',
  'wall_water',
  'wall_crystal',
  // Vier spaeter dazugekommene Waende — Schrottplatz, Bonbonland, Kakteen,
  // Ruine. Auch hier gilt: die Reihenfolge im Spiel steht in CONFIG.wall.stages.
  'stage_schrott',
  'stage_bonbon',
  'stage_kakteen',
  'stage_ruine',
  // Fünf weitere Wände für das Endspiel. Weltall ist das LETZTE Gebiet —
  // siehe CONFIG.wall.stages.
  'stage_pirat',
  'stage_biene',
  'stage_bibliothek',
  'stage_zirkus',
  'stage_weltall',
  // Das Gold-Gebiet. Kein gewöhnliches Gebiet der Reihe nach, sondern der
  // Bonus, in den die goldene Banane für 30 Sekunden versetzt.
  'stage_gold',
].map((name) => ({ src: `${name}.png`, out: `${name}.webp` }));

/* Kletter-Frames: bereits freigestellte Einzelbilder aus den Bewegungsvideos.
 * Siehe README, Abschnitt "Kletteranimation aus dem Video".
 *
 * Ein Satz je Charakter. Die Zielpfade müssen zu CONFIG.characters.list[*]
 * .framePath passen.
 *
 * weissSaum: Nur der BRAUNE Satz stammt aus einem Video vor reinweissem
 * Hintergrund; dort tragen halbtransparente Randpixel noch Weiss, das hier
 * herausgerechnet wird. Die beiden neuen Sätze wurden vor einer grauen Wand
 * gedreht und sind bereits in video-to-frames.mjs gegen die gemessene
 * Wandfarbe entsäumt — ein zweiter Durchgang gegen Weiss würde ihre Kante
 * fälschlich aufhellen.
 */
/* `registriert: true` heisst: die Bilder stehen bereits zueinander in Deckung
 * (ein geschlossener Zyklus aus video-frames.mjs --zyklus) und dürfen NICHT
 * einzeln zentriert werden — siehe die Erklärung in prepareMovementFrames. */
const MOVE_SETS = [
  { quelle: 'movement', ziel: '', weissSaum: false, registriert: true },
  { quelle: 'movement_orange', ziel: 'orange', weissSaum: false },
];

/* WEISS FEHLT HIER ABSICHTLICH.
 *
 * Der weisse Affe ist kein eigenes Video mehr, sondern der braune umgefärbt
 * (scripts/prepare-weiss.mjs, aus public/textures/move_NN.webp). Stünde er
 * weiter in dieser Liste, gäbe es zwei Quellen für denselben Ordner: die alte
 * assets-src/art/movement_white mit ihrer eigenen Bildzahl und die Umfärbung
 * mit der aktuellen. Wer zuletzt läuft, gewinnt — und bei ungleicher Bildzahl
 * bleibt ein Mischsatz zurück, der im Spiel als fehlendes Bild auffällt (der
 * Entwicklungsserver liefert dafür index.html mit Status 200, der Loader
 * bekommt also HTML statt PNG). */

mkdirSync(OUT, { recursive: true });

/* ============================================================ Hintergründe */

/**
 * Misst, wie gut eine Textur vertikal kachelt: mittlerer Farbabstand zwischen
 * der obersten und der untersten Pixelzeile. 0 = perfekt nahtlos.
 */
async function seamError(file) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const topRow = 0;
  const bottomRow = height - 1;
  let sum = 0;

  for (let x = 0; x < width; x++) {
    const a = (topRow * width + x) * channels;
    const b = (bottomRow * width + x) * channels;
    sum +=
      Math.abs(data[a] - data[b]) +
      Math.abs(data[a + 1] - data[b + 1]) +
      Math.abs(data[a + 2] - data[b + 2]);
  }
  return sum / (width * 3);
}

/**
 * Macht eine Textur in beiden Achsen kachelbar.
 *
 * Die gelieferten Bilder sind NICHT nahtlos (gemessen 21–45 von 255 Differenz
 * zwischen oberster und unterster Zeile) — beim endlosen Hochscrollen liefe
 * sonst eine sichtbare waagerechte Kante durchs Bild.
 *
 * Spiegeln (MirroredRepeatWrapping) scheidet aus: in gespiegelten Kacheln
 * läuft der Inhalt bei wachsendem Offset rückwärts, die Wand würde also
 * abwechselnd hoch und runter scrollen.
 *
 * Stattdessen der klassische Überblend-Beschnitt: das Bild wird um die
 * Bandbreite B gekürzt, und die ersten B Zeilen werden mit den abgeschnittenen
 * Zeilen vom Ende überblendet. Danach grenzen im Ergebnis zwei im Original
 * BENACHBARTE Zeilen aneinander — die Kachelung ist exakt nahtlos.
 */
function makeSeamless(data, width, height, channels, bandX, bandY) {
  // ---- vertikal ----
  const outH = height - bandY;
  const vert = Buffer.alloc(width * outH * channels);

  for (let y = 0; y < outH; y++) {
    const t = y < bandY ? y / bandY : 1;
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * channels;
      const a = (y * width + x) * channels;
      const b = ((y + outH) * width + x) * channels;
      for (let c = 0; c < channels; c++) {
        vert[dst + c] = t >= 1 ? data[a + c] : Math.round(data[a + c] * t + data[b + c] * (1 - t));
      }
    }
  }

  // ---- horizontal ----
  const outW = width - bandX;
  const both = Buffer.alloc(outW * outH * channels);

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const t = x < bandX ? x / bandX : 1;
      const dst = (y * outW + x) * channels;
      const a = (y * width + x) * channels;
      const b = (y * width + (x + outW)) * channels;
      for (let c = 0; c < channels; c++) {
        both[dst + c] = t >= 1 ? vert[a + c] : Math.round(vert[a + c] * t + vert[b + c] * (1 - t));
      }
    }
  }

  return { data: both, width: outW, height: outH };
}

async function prepareBackgrounds() {
  console.log('Hintergründe:');
  for (const bg of BACKGROUNDS) {
    const src = resolve(SRC, bg.src);
    if (!existsSync(src)) {
      console.warn(`  FEHLT: ${src}`);
      continue;
    }
    const dst = resolve(OUT, bg.out);
    const vorher = await seamError(src);

    const { data, info } = await sharp(src)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const bandY = Math.round(info.height * 0.12);
    const bandX = Math.round(info.width * 0.09);
    const s = makeSeamless(data, info.width, info.height, info.channels, bandX, bandY);

    await sharp(s.data, { raw: { width: s.width, height: s.height, channels: info.channels } })
      .webp({ quality: 88 })
      .toFile(dst);

    // Fernvariante für die hintere Parallax-Ebene: dieselbe Vorlage, nur
    // unscharf, dunkler und entsättigt. Dadurch entsteht Tiefe, ohne
    // stilfremde Grafik einzumischen.
    const farOut = dst.replace(/\.webp$/, '_far.webp');
    await sharp(s.data, { raw: { width: s.width, height: s.height, channels: info.channels } })
      .resize(Math.round(s.width / 2), Math.round(s.height / 2))
      .blur(6)
      .modulate({ brightness: 0.62, saturation: 0.75 })
      .webp({ quality: 82 })
      .toFile(farOut);

    const nachher = await seamError(dst);
    console.log(
      `  ${bg.out.padEnd(22)} ${info.width}x${info.height} -> ${s.width}x${s.height}  ` +
        `Naht ${vorher.toFixed(1)} -> ${nachher.toFixed(1)} von 255 ` +
        // Ein kleiner Rest bleibt durch die WebP-Kompression; alles unter
        // etwa 10/255 (4 %) ist im Scroll nicht zu sehen.
        `${nachher < 10 ? '(nahtlos)' : '(PRUEFEN!)'}`,
    );
  }
}

/* ============================================================ Kletter-Frames */

/**
 * Normalisiert die Kletter-Frames aus assets-src/art/movement/.
 *
 * HERKUNFT
 * Die Frames stammen aus dem Bewegungsvideo (assets-src/art/monkey_movement.mp4)
 * und sind bereits freigestellt — der Affe kletterte dort vor reinweissem
 * Hintergrund, das Weiss wurde per Alpha-Keying entfernt. Wie man das Video
 * zerlegt, steht im README unter "Kletteranimation aus dem Video"; das braucht
 * einen Browser (oder ffmpeg) und ist ein einmaliger Schritt. Ab hier ist die
 * Aufbereitung reproduzierbar.
 *
 * AUSRICHTUNG
 * Die Silhouette wandert von Frame zu Frame (der Affe klettert ja). Jedes Bild
 * wird deshalb auf seine Alpha-Bounding-Box beschnitten und mittig auf eine für
 * ALLE Frames gemeinsame Leinwand gelegt. Ohne das würde die Figur beim
 * Abspielen im Bild umherspringen.
 *
 * ...ausser die Bilder stehen schon in Deckung (`registriert`). Dann ist das
 * Einzelzentrieren genau falsch herum: es misst die Box eines Bildes, in dem
 * der Affe den Arm streckt, findet sie höher, und schiebt zum Ausgleich den
 * ganzen Körper nach unten. Die Figur wackelt dann bei jedem Bildwechsel,
 * obwohl in der Vorlage nur der Arm bewegt wurde. Bei registrierten Sätzen
 * wird deshalb EIN gemeinsames Fenster über alle Bilder gelegt.
 */
async function prepareMovementFrames({ quelle, ziel, weissSaum, registriert }) {
  const dir = resolve(SRC, quelle);
  const outDir = ziel ? resolve(OUT, ziel) : OUT;
  if (!existsSync(dir)) {
    console.warn(`\nKletter-Frames fehlen: ${dir}`);
    return;
  }
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(dir)
    .filter((f) => /\.png$/i.test(f))
    .sort();

  if (files.length === 0) {
    console.warn(`\nKeine PNGs in ${dir}`);
    return;
  }

  // Erst alle Bounding-Boxen messen, dann die gemeinsame Leinwand bestimmen.
  const boxes = [];
  for (const f of files) {
    const { data, info } = await sharp(resolve(dir, f))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;

    let minX = width, maxX = -1, minY = height, maxY = -1;
    for (let i = 0; i < width * height; i++) {
      if (data[i * channels + 3] > 24) {
        const x = i % width;
        const y = (i / width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    boxes.push({ f, left: minX, top: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }

  const pad = 6;
  const fenster = registriert ? {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    w: Math.max(...boxes.map((b) => b.left + b.w)) - Math.min(...boxes.map((b) => b.left)),
    h: Math.max(...boxes.map((b) => b.top + b.h)) - Math.min(...boxes.map((b) => b.top)),
  } : null;
  const canvasW = (fenster ? fenster.w : Math.max(...boxes.map((b) => b.w))) + pad * 2;
  const canvasH = (fenster ? fenster.h : Math.max(...boxes.map((b) => b.h))) + pad * 2;

  let total = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = fenster ? { ...fenster, f: boxes[i].f } : boxes[i];

    /* --- Weiss-Saum entfernen ------------------------------------------
     * Der Videohintergrund war reinweiss. Halbtransparente Randpixel tragen
     * deshalb noch Weiss in der Farbe — vor dem grünen Dschungel ergibt das
     * einen hellen Saum um die Silhouette.
     *
     * Da die Hintergrundfarbe bekannt ist, lässt sich der Vordergrund exakt
     * zurückrechnen:  C_fg = (C_beobachtet - (1-a) * 255) / a
     */
    const { data: raw, info: ri } = await sharp(resolve(dir, b.f))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (weissSaum) {
      for (let p = 0; p < raw.length; p += 4) {
        const a = raw[p + 3];
        if (a === 0 || a === 255) continue;
        const af = a / 255;
        for (let ch = 0; ch < 3; ch++) {
          const v = (raw[p + ch] - (1 - af) * 255) / af;
          raw[p + ch] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
      }
    }

    const cut = await sharp(raw, {
      raw: { width: ri.width, height: ri.height, channels: 4 },
    })
      .extract({ left: b.left, top: b.top, width: b.w, height: b.h })
      .png()
      .toBuffer();

    // composite und Kodierung getrennt halten: sharp wendet resize VOR
    // composite an, kombiniert würde die Leinwand vorher schrumpfen.
    const zentriert = await sharp({
      create: {
        width: canvasW,
        height: canvasH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: cut,
          left: Math.round((canvasW - b.w) / 2),
          top: Math.round((canvasH - b.h) / 2),
        },
      ])
      .png()
      .toBuffer();

    const name = `move_${String(i).padStart(2, '0')}.webp`;
    const written = await sharp(zentriert)
      .webp({ quality: 92, alphaQuality: 100 })
      .toFile(resolve(outDir, name));
    total += written.size;
  }

  // Das Seitenverhältnis der gemeinsamen Leinwand bestimmt im Spiel die
  // Sprite-BREITE (SpritePlayer: w = spriteHeight * aspect). Es wird je Satz
  // neu berechnet, jeder Affe bekommt also seine eigenen Proportionen.
  console.log(
    `  ${(ziel || 'braun').padEnd(8)} ${boxes.length} Bilder, je ${canvasW}x${canvasH} ` +
      `(Seitenverhältnis ${(canvasW / canvasH).toFixed(3)})  ` +
      `${(total / 1024).toFixed(0)} KB  ->  public/textures/${ziel ? ziel + '/' : ''}move_NN.webp`,
  );
}

await prepareBackgrounds();

console.log('\nKletter-Frames:');
for (const satz of MOVE_SETS) await prepareMovementFrames(satz);
