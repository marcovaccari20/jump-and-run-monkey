/**
 * Schneidet aus EINER Vorlage die drei Titelbilder, die CrazyGames verlangt.
 *
 *     Querformat  1920x1080  (16:9)
 *     Hochformat   800x1200  (2:3)
 *     Quadrat      800x800   (1:1)
 *
 * Run mit:  node scripts/titelbilder.mjs <vorlage.png> [zielordner]
 *
 * DAS PROBLEM, DAS DIESES SKRIPT LÖST
 *
 * Die Vorlage ist breit (1376x768, also fast 16:9). Der Schriftzug
 * "JUNGLE CLIMBER" läuft über die GANZE Breite. Schneidet man daraus mittig
 * ein Hochformat (2:3) oder ein Quadrat heraus, fehlen zwangsläufig die
 * äusseren Buchstaben — aus JUNGLE CLIMBER wird "GLE CLIM". Genau davor hat
 * der Auftraggeber gewarnt: der Name muss lesbar bleiben.
 *
 * Deshalb wird nicht einfach beschnitten, sondern GESETZT:
 *
 *   1. Der Hintergrund füllt das Zielformat (Beschnitt aus der Bildmitte,
 *      wo die beiden Affen sind) — er darf ruhig anschneiden, dort steht
 *      keine Schrift.
 *   2. Der Titel wird als eigenes Band aus der Vorlage geschnitten, auf die
 *      volle Zielbreite gebracht und oben daraufgesetzt. Er behält damit
 *      seine Proportionen und bleibt vollständig.
 *
 * Wo das Titelband liegt, wird GEMESSEN und nicht geraten: gesucht werden
 * die kräftig gelben Pixel der Schrift (hoher Rot- und Grünanteil, wenig
 * Blau). Ändert sich die Vorlage, wandert das Band von selbst mit.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const [, , vorlageArg, zielArg] = process.argv;
if (!vorlageArg) {
  console.error('Aufruf: node scripts/titelbilder.mjs <vorlage.png> [zielordner]');
  process.exit(1);
}
const VORLAGE = resolve(vorlageArg);
const ZIEL = resolve(zielArg ? resolve(zielArg) : resolve(ROOT, 'pakete/titelbilder'));

if (!existsSync(VORLAGE)) {
  console.error(`Vorlage nicht gefunden: ${VORLAGE}`);
  process.exit(1);
}
mkdirSync(ZIEL, { recursive: true });

/* ------------------------------------------------------- Titel finden */

/**
 * Findet das Rechteck, in dem die gelbe Schrift steht.
 *
 * Gelb heisst hier: Rot und Grün beide hoch, Blau deutlich niedriger. Die
 * Schwellen sind bewusst streng — Bananen und Münzen im Bild sind ebenfalls
 * gelblich, aber kleiner und dunkler. Gegen sie hilft die Zeilenzählung
 * unten: nur Zeilen mit VIELEN gelben Pixeln zählen als Schrift.
 */
async function titelBand(datei) {
  const { data, info } = await sharp(datei).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;

  const proZeile = new Array(h).fill(0);
  const proSpalte = new Array(w).fill(0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 200 && g > 150 && b < 110 && r - b > 110) {
        proZeile[y]++;
        proSpalte[x]++;
      }
    }
  }

  /* DER TITEL IST EIN ZUSAMMENHÄNGENDES BAND — das ist der Unterschied.
   *
   * Erst wurde einfach die oberste und die unterste gelbe Zeile genommen.
   * Ergebnis: 635 von 768 Pixeln Höhe, also praktisch das ganze Bild. Im
   * Motiv sind nämlich auch Bananen, Münzen und Feuer gelb, und die liegen
   * über die volle Höhe verstreut.
   *
   * Gesucht ist deshalb der LÄNGSTE ZUSAMMENHÄNGENDE Abschnitt von Zeilen
   * mit viel Gelb. Die Schrift liefert Dutzende solcher Zeilen direkt
   * untereinander; eine einzelne Banane liefert ein paar und dann eine
   * Lücke. Kurze Unterbrechungen (Schattenkanten zwischen den Buchstaben)
   * werden überbrückt, sonst zerfiele das Band in Stücke. */
  const schwelleZeile = w * 0.06;
  const LUECKE = Math.round(h * 0.02); // so viele magere Zeilen dürfen dazwischen liegen

  let bestesVon = -1, bestesBis = -1, bestesGewicht = 0;
  let von = -1, gewicht = 0, luecke = 0;

  for (let y = 0; y <= h; y++) {
    const voll = y < h && proZeile[y] >= schwelleZeile;
    if (voll) {
      if (von < 0) von = y;
      gewicht += proZeile[y];
      luecke = 0;
    } else if (von >= 0) {
      luecke++;
      if (luecke > LUECKE || y === h) {
        const bis = y - luecke;
        if (gewicht > bestesGewicht) {
          bestesGewicht = gewicht;
          bestesVon = von;
          bestesBis = bis;
        }
        von = -1;
        gewicht = 0;
        luecke = 0;
      }
    }
  }
  if (bestesVon < 0) return null;

  const oben = bestesVon;
  const unten = bestesBis;

  /* Die seitlichen Grenzen NUR innerhalb des gefundenen Bandes messen —
   * sonst zögen Bananen weiter unten die Kante wieder nach aussen. */
  const spalteImBand = new Array(w).fill(0);
  for (let y = oben; y <= unten; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 200 && g > 150 && b < 110 && r - b > 110) spalteImBand[x]++;
    }
  }
  const schwelleSpalte = Math.max(2, (unten - oben + 1) * 0.05);
  let links = -1, rechts = -1;
  for (let x = 0; x < w; x++) {
    if (spalteImBand[x] >= schwelleSpalte) {
      if (links < 0) links = x;
      rechts = x;
    }
  }
  if (links < 0) return null;

  return { oben, unten, links, rechts, hoehe: unten - oben + 1, breite: rechts - links + 1 };
}

/* ------------------------------------------------------------ Bauen */

/**
 * Ein Zielbild bauen.
 *
 * `titelAnteil` sagt, welchen Anteil der Zielbreite der Schriftzug einnehmen
 * soll. Beim Querformat ist die Vorlage schon fast passend, dort bleibt das
 * Originalbild unangetastet; bei den schmalen Formaten wird der Titel neu
 * gesetzt.
 */
async function bauen({ name, breite, hoehe, titelAnteil, titelObenAnteil }) {
  const band = await titelBand(VORLAGE);
  const meta = await sharp(VORLAGE).metadata();

  const zielVerhaeltnis = breite / hoehe;
  const quellVerhaeltnis = meta.width / meta.height;

  /* Ist das Zielformat fast so breit wie die Vorlage, genügt ein normaler
   * Beschnitt — der Titel bleibt dabei ohnehin ganz. Die Grenze von 12 %
   * ist grosszügig: bis dahin schneidet sharp so wenig weg, dass die
   * äussersten Buchstaben sicher drin bleiben. */
  const nahDran = Math.abs(zielVerhaeltnis - quellVerhaeltnis) / quellVerhaeltnis < 0.12;

  if (nahDran || !band) {
    await sharp(VORLAGE)
      .resize(breite, hoehe, { fit: 'cover', position: 'centre' })
      .png()
      .toFile(resolve(ZIEL, `${name}.png`));
    return { name, breite, hoehe, art: 'Beschnitt', band };
  }

  /* KEIN AUFGEKLEBTES TITELBAND.
   *
   * Der erste Versuch schnitt nur den Schriftzug heraus und setzte ihn auf
   * einen beschnittenen Hintergrund. Das sah aus wie ein Aufkleber: der
   * Streifen hat harte Kanten, und er zeigt eine ANDERE Stelle des Motivs
   * (Lava und Eis) als der Hintergrund direkt darunter (Blattwerk). Zwei
   * unpassende Szenen mit einer sichtbaren Naht dazwischen.
   *
   * Stattdessen bleibt die Vorlage HEIL: sie wird auf die volle Zielbreite
   * gebracht und als Ganzes gesetzt — Titel, Affen, Feuer, alles im
   * ursprünglichen Verhältnis, nichts angeschnitten. Der Platz darüber und
   * darunter bekommt dieselbe Vorlage noch einmal, formatfüllend und
   * unscharf. Das liest sich als Tiefenunschärfe, hat keine Naht und keinen
   * schwarzen Balken (den verbieten die Portale ausdrücklich). */
  const hintergrund = await sharp(VORLAGE)
    .resize(breite, hoehe, { fit: 'cover', position: 'centre' })
    .blur(Math.max(8, Math.round(breite / 45)))
    .modulate({ brightness: 0.62, saturation: 1.05 })
    .toBuffer();

  const scharfBreite = Math.round(breite * titelAnteil);
  const scharf = await sharp(VORLAGE)
    .resize(scharfBreite, null, { fit: 'inside' })
    .toBuffer();
  const scharfMeta = await sharp(scharf).metadata();

  /* SENKRECHT FAST MITTIG, einen Tick nach oben.
   *
   * Zuerst sass das scharfe Bild oben und darunter standen zwei Drittel
   * blosse Unschärfe — das sah nach Fehler aus, nicht nach Absicht. Mittig
   * gesetzt liegt oben und unten gleich viel Rahmen, und das Ganze liest
   * sich als bewusste Kachel auf unscharfem Grund.
   *
   * `titelObenAnteil` verschiebt sie aus der Mitte heraus: 0.5 wäre exakt
   * mittig, etwas darunter hebt sie leicht an. Das Auge sucht den Titel
   * oberhalb der Mitte, und Portalkacheln werden häufiger unten
   * beschnitten als oben. */
  const oben = Math.round((hoehe - scharfMeta.height) * titelObenAnteil);

  await sharp(hintergrund)
    .composite([
      {
        input: scharf,
        left: Math.round((breite - scharfMeta.width) / 2),
        top: oben,
      },
    ])
    .png()
    .toFile(resolve(ZIEL, `${name}.png`));

  return {
    name,
    breite,
    hoehe,
    art: 'Vorlage heil auf unscharfem Grund',
    band,
    scharf: `${scharfMeta.width}x${scharfMeta.height}`,
  };
}

/* --------------------------------------------------------------- Lauf */

const band = await titelBand(VORLAGE);
const meta = await sharp(VORLAGE).metadata();
console.log(`Vorlage:  ${meta.width}x${meta.height}`);
if (band) {
  console.log(
    `Titel:    x ${band.links}–${band.rechts} (${band.breite} breit), ` +
      `y ${band.oben}–${band.unten} (${band.hoehe} hoch)`,
  );
} else {
  console.log('Titel:    nicht gefunden — es wird nur beschnitten');
}

const FORMATE = [
  // Querformat: die Vorlage ist schon fast 16:9, hier genügt der Beschnitt.
  { name: 'cover-landscape-1920x1080', breite: 1920, hoehe: 1080, titelAnteil: 0.92, titelObenAnteil: 0.06 },
  // Hochformat: der Titel muss neu gesetzt werden, sonst fehlen die Ränder.
  { name: 'cover-portrait-800x1200', breite: 800, hoehe: 1200, titelAnteil: 1.0, titelObenAnteil: 0.40 },
  { name: 'cover-square-800x800', breite: 800, hoehe: 800, titelAnteil: 1.0, titelObenAnteil: 0.42 },
];

console.log('\nTitelbilder:');
for (const f of FORMATE) {
  const r = await bauen(f);
  console.log(`  ${r.name.padEnd(30)} ${r.breite}x${r.hoehe}  ${r.art}`);
}
console.log(`\nZiel: ${ZIEL}\n`);
