/**
 * Macht aus dem BRAUNEN Affen den weissen.
 *
 * Run mit:  npm run prep:weiss
 *
 * WARUM NICHT DER GELIEFERTE WEISSE AFFE
 * Dessen Kletterbilder haben einen sichtbaren Fehler im Bewegungsablauf —
 * das Video, aus dem sie stammen, hat weniger wirklich verschiedene Bilder
 * hergegeben als die anderen, und an einer Stelle springt er. Der braune
 * Affe hat den sauberen Zyklus. Ihn einzufärben ist deshalb nicht der
 * bequeme, sondern der richtige Weg: gleiche Bewegung, andere Farbe.
 *
 * WIE EINGEFÄRBT WIRD
 * Nicht "alles weiss malen" — dann wäre er eine Silhouette ohne Form. Das
 * Fell behält seine Licht-und-Schatten-Zeichnung und wird nur entsättigt
 * und aufgehellt:
 *
 *     grau  = Helligkeit des Ursprungspixels
 *     neu   = SOCKEL + (1 - SOCKEL) * grau^GAMMA
 *
 * `SOCKEL` hebt die tiefsten Schatten an (sonst wirkt er schmutzig),
 * `GAMMA` unter 1 zieht die Mitten nach oben, damit das Fell hell wirkt und
 * nicht mausgrau. Ein Hauch Blau im Schatten macht es zu WEISS statt zu
 * Beige — reines Grau liest sich vor der grünen Wand sonst gelblich.
 *
 * Augen, Nase und Innenohren bleiben dunkel: sie sind schon im Original
 * dunkler als jedes Fell, deshalb werden sie über eine Schwelle
 * ausgenommen. Ohne das bekäme er weisse Augen.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/* AB DIESER HELLIGKEIT GILT EIN PIXEL ALS FELL.
 *
 * 0.08, nicht 0.2. Gemessen an den Bildern liegt das braune Fell über den
 * GANZEN Helligkeitsbereich von 0.1 bis 0.6 (bei einer Sättigung von 0.6
 * bis 0.8) — mit 0.2 blieben alle Schattenpartien braun, und der Affe war
 * gescheckt. Nur die Augen, Nasenlöcher und der Umriss liegen wirklich
 * darunter; die sollen dunkel bleiben. */
const FELL_AB = 0.08;
const SOCKEL = 0.5;
const GAMMA = 0.72;
/** Leichter Blaustich im Schatten — sonst wirkt das Weiss beige. */
const KALT = 0.045;

async function einfaerben(quelle, ziel, mitFeuer) {
  const { data, info } = await sharp(quelle).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const aus = Buffer.alloc(n * 4);

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const r = data[p] / 255,
      g = data[p + 1] / 255,
      b = data[p + 2] / 255;
    const a = data[p + 3];

    // Wahrgenommene Helligkeit, nicht der einfache Mittelwert: Rot wirkt
    // dunkler als Grün, und das braune Fell ist rotlastig.
    const y = 0.299 * r + 0.587 * g + 0.114 * b;

    /* DAS FEUER BLEIBT FEUER — aber nur dort, wo es welches gibt.
     *
     * Erster Versuch: 'warm und hell und wenig Blau'. Nachgemessen trifft
     * das auch die HELLEN FELLSTELLEN — Blau liegt bei beiden im Median
     * bei 0.28, das Merkmal trennt also gar nicht. Der Affe bekam davon
     * orange Sprenkel auf dem Rücken, und zwar auch in den Kletterbildern,
     * in denen überhaupt kein Feuer vorkommt.
     *
     * Zwei Änderungen: die Ausnahme gilt nur für die Chili-Bilder, und sie
     * ist strenger. Gemessene Mittelwerte — Fell 0.80/0.51/0.29, Flamme
     * 0.91/0.61/0.28: Rot und Grün trennen, Blau nicht. */
    const feuer = mitFeuer && r > 0.88 && g > 0.55;

    if (y < FELL_AB || feuer) {
      // Augen, Nase, Umriss, Flamme — unverändert lassen.
      aus[p] = data[p];
      aus[p + 1] = data[p + 1];
      aus[p + 2] = data[p + 2];
      aus[p + 3] = a;
      continue;
    }

    const hell = SOCKEL + (1 - SOCKEL) * Math.pow(y, GAMMA);
    aus[p] = Math.min(255, Math.round(hell * 255 * (1 - KALT)));
    aus[p + 1] = Math.min(255, Math.round(hell * 255 * (1 - KALT * 0.35)));
    aus[p + 2] = Math.min(255, Math.round(hell * 255));
    aus[p + 3] = a;
  }

  await sharp(aus, { raw: { width: info.width, height: info.height, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(ziel);
}

/* Was eingefärbt wird: die Kletterbilder und der Chili-Flug.
 * Quelle ist jeweils der fertige BRAUNE Satz — er ist schon freigestellt
 * und auf die richtige Grösse gebracht. */
const SAETZE = [
  { von: 'public/textures', muster: /^move_\d\d\.webp$/, nach: 'public/textures/weiss', feuer: false },
  {
    von: 'public/textures/chili',
    muster: /^move_\d\d\.webp$/,
    nach: 'public/textures/chili_weiss',
    feuer: true,
  },
];

console.log('Weissen Affen aus dem braunen einfärben:');

for (const satz of SAETZE) {
  const von = resolve(ROOT, satz.von);
  const nach = resolve(ROOT, satz.nach);
  if (!existsSync(von)) {
    console.warn(`  FEHLT: ${von}`);
    continue;
  }
  mkdirSync(nach, { recursive: true });
  // Alte Ausgaben weg: ein kürzerer Satz liesse sonst Reste stehen, die das
  // Spiel als gültige Bilder einsammelt.
  for (const alt of readdirSync(nach)) if (/\.webp$/i.test(alt)) rmSync(resolve(nach, alt));

  const bilder = readdirSync(von).filter((f) => satz.muster.test(f)).sort();
  for (const b of bilder) await einfaerben(resolve(von, b), resolve(nach, b), satz.feuer);
  console.log(`  ${satz.nach.padEnd(28)} ${bilder.length} Bilder`);
}
