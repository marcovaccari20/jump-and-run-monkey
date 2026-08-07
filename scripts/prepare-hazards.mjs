/**
 * Zerlegt die gelieferten Objektbilder in einzelne, freigestellte Sprites.
 *
 * Run mit:  npm run prep:hazards
 *
 * Quelle: assets-src/hazards/*.png   (mehrere Objekte je Bild, auf grauem
 *                                     oder weissem Studiohintergrund)
 * Ziel:   public/hazards/*.webp      (ein Objekt je Datei, mit Alphakanal)
 *
 * WARUM AUTOMATISCH ZERLEGEN STATT FESTE ZUSCHNITTE
 * Feste Rechtecke müsste man bei jedem neuen Bild von Hand nachmessen, und
 * jeder Nachbesserung am Original hinterherpflegen. Hier wird stattdessen der
 * Hintergrund weggerechnet und aus dem Rest werden die zusammenhängenden
 * Flächen gesucht — das Skript findet die Objekte selbst und sortiert sie von
 * links nach rechts, also genau in der Reihenfolge klein/mittel/gross.
 *
 * DIE VIER SCHRITTE
 *  1. Hintergrundfarbe aus den vier Bildecken messen (grau oder weiss).
 *  2. Alpha aus dem Farbabstand: ein weicher Verlauf zwischen `t0` und `t1`
 *     statt einer harten Schwelle — sonst bekommt jedes Objekt eine Treppe
 *     als Kante.
 *  3. Innenflächen auffüllen: durchscheinende Objekte (Eiszapfen, Gifttropfen)
 *     liegen farblich nah am Grau und würden sonst halb verschwinden. Was von
 *     der Silhouette eingeschlossen ist, bekommt deshalb einen Mindest-Alpha.
 *  4. Zusammenhängende Flächen suchen. Die grössten sind die Objekte; kleine
 *     Fetzen (Funken, Rauchfahnen, Sandkörner) werden dem nächsten Objekt
 *     zugeschlagen statt weggeworfen.
 *
 * ENTSÄUMEN
 * Halbtransparente Randpixel tragen noch die Hintergrundfarbe. Da diese
 * bekannt ist, lässt sich der Vordergrund exakt zurückrechnen:
 *     C_fg = (C_beobachtet - (1-a) * C_bg) / a
 * Ohne diesen Schritt hätte jedes Objekt vor der dunklen Lavawand einen
 * hellgrauen Saum.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'assets-src/hazards');
const OUT = resolve(ROOT, 'public/hazards');

/* Längste Kante des fertigen Sprites. Auf dem Bildschirm ist ein grosses
 * Objekt selbst auf einem hohen Display keine 200 px breit — mehr Auflösung
 * kostet nur Ladezeit. */
const MAX_KANTE = 224;

/* ------------------------------------------------------------------ *
 *  WELCHES BILD WIRD WIE ZERLEGT
 *
 *   objekte    wie viele Objekte im Bild stehen (inkl. der ungenutzten!)
 *   waehle     welche davon exportiert werden, von links nach rechts gezählt
 *   ziele      Dateinamen dazu, in derselben Reihenfolge wie `waehle`
 *   t0 / t1    Farbabstand zum Hintergrund: ab t0 wird das Pixel sichtbar,
 *              ab t1 voll deckend. Kleiner = empfindlicher.
 *   boden      Mindest-Alpha innerhalb der Silhouette (durchscheinende Objekte)
 *   dreh       Drehung im Uhrzeigersinn, je Objekt
 *   kippen     vertikal spiegeln, je Objekt
 *   farbe      { hue, brightness, saturation } — Umfärben, je Objekt
 * ------------------------------------------------------------------ */
const BILDER = [
  {
    quelle: 'stein.png',
    ziele: ['stein_klein', 'stein_mittel', 'stein_gross'],
    objekte: 3,
    // Weisser Hintergrund, und das Sandkorn links ist selbst hell —
    // deshalb empfindlicher als bei den grauen Bildern.
    t0: 10,
    t1: 34,
  },
  {
    quelle: 'kokos_ganz.png',
    // Im Bild stehen die ganze Nuss und daneben die aufgebrochene Nuss aus
    // zwei Hälften. Gebraucht wird nur die ganze — die zwei Hälften bleiben
    // liegen (ausdrücklicher Wunsch).
    ziele: ['kokos_ganz'],
    objekte: 3,
    waehle: [0],
    t0: 14,
    t1: 42,
  },
  {
    quelle: 'kokos_halb.png',
    ziele: ['kokos_halb'],
    objekte: 1,
    t0: 14,
    t1: 42,
  },
  {
    quelle: 'pilz.png',
    ziele: ['pilz_klein', 'pilz_mittel', 'pilz_gross'],
    objekte: 3,
    t0: 12,
    t1: 40,
    // Der Hut soll nach UNTEN zeigen, damit es fallend aussieht.
    kippen: [true, true, true],
  },
  {
    quelle: 'gift.png',
    ziele: ['gift_klein', 'gift_mittel', 'gift_gross'],
    objekte: 3,
    t0: 9,
    t1: 30,
    boden: 0.8, // Tropfen sind durchscheinend
    // Drei Farben statt dreimal Violett: so ist auch im Augenwinkel zu
    // erkennen, welche Grössenklasse fällt.
    farbe: [
      { hue: 200, saturation: 1.15 }, // grün
      { brightness: 0.3, saturation: 0.3 }, // fast schwarz
      null, // violett, wie geliefert
    ],
  },
  {
    quelle: 'halloween.png',
    // Zwei Objekte im Bild. Der Kürbis deckt klein UND mittel ab (die
    // Grössenklasse skaliert ihn), der Geist ist der grosse Brocken.
    ziele: ['kuerbis', 'geist'],
    objekte: 2,
    t0: 12,
    t1: 40,
  },
  {
    quelle: 'eis.png',
    ziele: ['eis_klein', 'eis_mittel', 'eis_gross'],
    objekte: 3,
    // Glasklares Eis vor Grau: der Farbabstand ist winzig, deshalb sehr
    // empfindlich und mit hohem Innen-Boden.
    t0: 5,
    t1: 22,
    boden: 0.85,
  },
  {
    quelle: 'meer.png',
    ziele: ['meer_klein', 'meer_mittel', 'meer_gross'],
    objekte: 3,
    t0: 11,
    t1: 38,
    /* Alle drei sollen nach unten schauen, sonst schwimmen sie quer durchs
     * Bild statt zu fallen.
     *
     * Der Schwertfisch stand vorher auf +90 und hatte damit den Schnabel
     * OBEN — nachgesehen, nicht nachgerechnet: das Vorzeichen war schlicht
     * falsch herum. Der Seestern hat keine Richtung. */
    dreh: [0, -90, -90],
  },
  {
    quelle: 'feuer.png',
    ziele: ['feuer_klein', 'feuer_mittel', 'feuer_gross'],
    objekte: 3,
    t0: 10,
    t1: 36,
    // Die Flamme zieht im Original nach rechts hinten. Gedreht zeigt die
    // Spitze nach oben — dann sieht der Ball aus, als fiele er.
    dreh: [-42, -38, 0],
  },
  {
    quelle: 'asche.png',
    ziele: ['asche_klein', 'asche_mittel', 'asche_gross'],
    objekte: 3,
    t0: 11,
    t1: 36,
  },
  {
    // Sammelmünze. Kein Hindernis, aber dieselbe Aufbereitung — deshalb hier.
    // Im Bild stehen drei Grössen; gebraucht wird ausdrücklich NUR die
    // kleinste (ganz links). Die beiden anderen bleiben liegen.
    quelle: 'muenze.png',
    ziele: ['muenze'],
    objekte: 3,
    waehle: [0],
    t0: 12,
    t1: 40,
  },
  {
    // Banane = zweites Leben. Wie die Münze kein Hindernis, aber dieselbe
    // Aufbereitung. Ein Objekt auf grauem Grund.
    quelle: 'banane.png',
    ziele: ['banane'],
    objekte: 1,
    t0: 12,
    t1: 40,
  },
  {
    quelle: 'wolken.png',
    // Im Bild stehen sie als Tropfen, Hagel, Blatt — gebraucht werden sie als
    // klein, mittel, gross. `waehle` sortiert um, statt das Bild anzufassen.
    ziele: ['wolken_klein', 'wolken_mittel', 'wolken_gross'],
    objekte: 3,
    waehle: [0, 2, 1], // Tropfen, Blatt, Hagel
    t0: 8,
    t1: 28,
    boden: 0.8, // Tropfen und Hagel sind durchscheinend
    // Das Blatt zeigt im Original mit der Spitze nach oben — gedreht fällt es
    // mit der Spitze voran. Tropfen und Hagel brauchen nichts: der Tropfen
    // fällt mit dem runden Ende voran (Spitze schleppt hinterher, wie beim
    // Feuerball), der Hagel ist rund.
    // ACHTUNG: `dreh` wird nach der Reihenfolge IM BILD indiziert, nicht nach
    // `waehle`. Im Bild steht das Blatt an dritter Stelle — die 180° gehören
    // deshalb auf Index 2, nicht auf 1. (Erster Versuch drehte den Hagel, und
    // der ist rund: der Fehler war unsichtbar.)
    dreh: [0, 0, 180],
  },
  {
    quelle: 'kristall.png',
    ziele: ['kristall_klein', 'kristall_mittel', 'kristall_gross'],
    objekte: 3,
    t0: 10,
    t1: 34,
    // Spitze nach unten.
    kippen: [true, true, true],
  },
];

mkdirSync(OUT, { recursive: true });

/* ============================================================ Werkzeuge */

/** Hintergrundfarbe: Median über die vier Eckfelder. */
function hintergrundfarbe(data, width, height, channels, feld = 14) {
  const r = [];
  const g = [];
  const b = [];
  const ecken = [
    [0, 0],
    [width - feld, 0],
    [0, height - feld],
    [width - feld, height - feld],
  ];
  for (const [ox, oy] of ecken) {
    for (let y = oy; y < oy + feld; y++) {
      for (let x = ox; x < ox + feld; x++) {
        const p = (y * width + x) * channels;
        r.push(data[p]);
        g.push(data[p + 1]);
        b.push(data[p + 2]);
      }
    }
  }
  const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  return [med(r), med(g), med(b)];
}

/**
 * Alphakanal aus dem Farbabstand zum Hintergrund.
 * Weicher Verlauf zwischen t0 und t1 statt harter Schwelle.
 */
function alphaAusAbstand(data, width, height, channels, bg, t0, t1) {
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    const dr = data[p] - bg[0];
    const dg = data[p + 1] - bg[1];
    const db = data[p + 2] - bg[2];
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    const a = (d - t0) / (t1 - t0);
    alpha[i] = a <= 0 ? 0 : a >= 1 ? 1 : a;
  }
  return alpha;
}

/**
 * Füllt Innenflächen auf.
 *
 * Von den Bildrändern aus wird alles geflutet, was noch als Hintergrund
 * durchgeht. Was dabei NICHT erreicht wird, liegt innerhalb einer Silhouette —
 * ein durchscheinender Eiszapfen also, kein Hintergrund. Diese Pixel bekommen
 * einen Mindest-Alpha, damit das Objekt nicht halb verschwindet.
 */
function innenAuffuellen(alpha, width, height, boden, schwelle = 0.5) {
  if (boden <= 0) return;
  const aussen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let sp = 0;

  const schieben = (i) => {
    if (!aussen[i] && alpha[i] < schwelle) {
      aussen[i] = 1;
      stack[sp++] = i;
    }
  };

  for (let x = 0; x < width; x++) {
    schieben(x);
    schieben((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    schieben(y * width);
    schieben(y * width + width - 1);
  }

  while (sp > 0) {
    const i = stack[--sp];
    const x = i % width;
    const y = (i / width) | 0;
    if (x > 0) schieben(i - 1);
    if (x < width - 1) schieben(i + 1);
    if (y > 0) schieben(i - width);
    if (y < height - 1) schieben(i + width);
  }

  for (let i = 0; i < alpha.length; i++) {
    if (!aussen[i] && alpha[i] < boden) alpha[i] = boden;
  }
}

/**
 * Zusammenhängende Flächen (8er-Nachbarschaft) über der Schwelle.
 * @returns {Array<{flaeche:number, minX:number, maxX:number, minY:number, maxY:number}>}
 */
function flaechenSuchen(alpha, width, height, schwelle = 0.3) {
  const label = new Int32Array(width * height).fill(-1);
  const stack = new Int32Array(width * height);
  const gefunden = [];

  for (let start = 0; start < width * height; start++) {
    if (label[start] >= 0 || alpha[start] < schwelle) continue;
    const id = gefunden.length;
    const box = { flaeche: 0, minX: width, maxX: -1, minY: height, maxY: -1 };
    let sp = 0;
    label[start] = id;
    stack[sp++] = start;

    while (sp > 0) {
      const i = stack[--sp];
      const x = i % width;
      const y = (i / width) | 0;
      box.flaeche++;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (label[j] < 0 && alpha[j] >= schwelle) {
            label[j] = id;
            stack[sp++] = j;
          }
        }
      }
    }
    gefunden.push(box);
  }
  return gefunden;
}

/** Bounding-Box des Sichtbaren in einem RGBA-Puffer. */
function alphaBox(raw, width, height, schwelle = 8) {
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let i = 0; i < width * height; i++) {
    if (raw[i * 4 + 3] > schwelle) {
      const x = i % width;
      const y = (i / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/* ============================================================ Hauptlauf */

const bericht = [];

for (const bild of BILDER) {
  const src = resolve(SRC, bild.quelle);
  if (!existsSync(src)) {
    console.warn(`  FEHLT: ${src}`);
    continue;
  }

  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const bg = hintergrundfarbe(data, width, height, channels);
  const alpha = alphaAusAbstand(data, width, height, channels, bg, bild.t0, bild.t1);
  innenAuffuellen(alpha, width, height, bild.boden ?? 1.0);

  /* --- Objekte finden ------------------------------------------------- */
  const alle = flaechenSuchen(alpha, width, height);
  alle.sort((a, b) => b.flaeche - a.flaeche);
  const anker = alle.slice(0, bild.objekte).sort((a, b) => a.minX - b.minX);
  const reste = alle.slice(bild.objekte);

  // Kleinteile (Funken, Rauchfahnen, aufspritzender Sand) dem nächsten Objekt
  // zuschlagen. Wegwerfen wäre falsch — der Rauch über der Glut gehört dazu.
  for (const r of reste) {
    const cx = (r.minX + r.maxX) / 2;
    const cy = (r.minY + r.maxY) / 2;
    let beste = null;
    let bestD = Infinity;
    for (const a of anker) {
      const dx = Math.max(a.minX - cx, 0, cx - a.maxX);
      const dy = Math.max(a.minY - cy, 0, cy - a.maxY);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        beste = a;
      }
    }
    // Nur was wirklich dicht dran liegt — sonst wandert ein Fleck vom
    // Nachbarobjekt herüber.
    if (beste && bestD < Math.max(beste.maxX - beste.minX, beste.maxY - beste.minY) * 0.55) {
      beste.minX = Math.min(beste.minX, r.minX);
      beste.maxX = Math.max(beste.maxX, r.maxX);
      beste.minY = Math.min(beste.minY, r.minY);
      beste.maxY = Math.max(beste.maxY, r.maxY);
    }
  }

  const waehle = bild.waehle ?? anker.map((_, i) => i);
  if (waehle.length !== bild.ziele.length) {
    throw new Error(`${bild.quelle}: ${waehle.length} gewählt, aber ${bild.ziele.length} Zielnamen`);
  }
  if (anker.length < bild.objekte) {
    console.warn(
      `  ${bild.quelle}: nur ${anker.length} von ${bild.objekte} Objekten gefunden — t0/t1 prüfen`,
    );
  }

  /* --- Objekte schreiben ---------------------------------------------- */
  for (let k = 0; k < waehle.length; k++) {
    const idx = waehle[k];
    const box = anker[idx];
    if (!box) continue;
    const name = bild.ziele[k];

    const pad = 3;
    const left = Math.max(0, box.minX - pad);
    const top = Math.max(0, box.minY - pad);
    const w = Math.min(width - left, box.maxX - box.minX + 1 + pad * 2);
    const h = Math.min(height - top, box.maxY - box.minY + 1 + pad * 2);

    // RGBA bauen und dabei entsäumen.
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sI = (top + y) * width + (left + x);
        const dI = (y * w + x) * 4;
        const a = alpha[sI];
        if (a <= 0) continue;
        const p = sI * channels;
        for (let c = 0; c < 3; c++) {
          const v = a >= 1 ? data[p + c] : (data[p + c] - (1 - a) * bg[c]) / a;
          rgba[dI + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
        rgba[dI + 3] = Math.round(a * 255);
      }
    }

    /* Drehen/Spiegeln in einem eigenen Durchgang: sharp wendet resize vor
     * extract an, kombiniert würde die Leinwand vorher schrumpfen. */
    let pipe = sharp(rgba, { raw: { width: w, height: h, channels: 4 } });
    const dreh = bild.dreh?.[idx] ?? 0;
    if (dreh) pipe = pipe.rotate(dreh, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    if (bild.kippen?.[idx]) pipe = pipe.flip();
    const farbe = bild.farbe?.[idx];
    if (farbe) pipe = pipe.modulate(farbe);

    // Nach dem Drehen bleibt transparenter Rand stehen — erneut beschneiden,
    // damit das Seitenverhältnis zum Objekt passt und nicht zur Leinwand.
    const gedreht = await pipe.raw().toBuffer({ resolveWithObject: true });
    const box2 = alphaBox(gedreht.data, gedreht.info.width, gedreht.info.height);
    if (!box2) {
      console.warn(`  ${name}: nach dem Drehen leer — übersprungen`);
      continue;
    }

    const skala = MAX_KANTE / Math.max(box2.width, box2.height);
    const zielW = Math.max(1, Math.round(box2.width * Math.min(1, skala)));
    const zielH = Math.max(1, Math.round(box2.height * Math.min(1, skala)));

    const datei = resolve(OUT, `${name}.webp`);
    const geschrieben = await sharp(gedreht.data, {
      raw: {
        width: gedreht.info.width,
        height: gedreht.info.height,
        channels: 4,
      },
    })
      .extract(box2)
      .resize(zielW, zielH)
      .webp({ quality: 90, alphaQuality: 100 })
      .toFile(datei);

    bericht.push({
      name,
      quelle: bild.quelle,
      px: `${zielW}x${zielH}`,
      seite: (zielW / zielH).toFixed(3),
      kb: (geschrieben.size / 1024).toFixed(1),
    });
  }

  console.log(
    `  ${bild.quelle.padEnd(16)} Hintergrund rgb(${bg.join(',')})  ` +
      `${anker.length} Objekte, ${reste.length} Kleinteile zugeschlagen`,
  );
}

console.log('\nSprites:');
let summe = 0;
for (const b of bericht) {
  console.log(
    `  ${b.name.padEnd(18)} ${b.px.padStart(9)}  Seitenverhältnis ${b.seite.padStart(6)}  ${b.kb.padStart(6)} KB`,
  );
  summe += Number(b.kb);
}
console.log(`  ${'—'.repeat(52)}\n  ${bericht.length} Dateien, ${summe.toFixed(0)} KB gesamt`);
