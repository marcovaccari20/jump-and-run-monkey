/**
 * MESSSKRIPT (nur Messung).
 *
 * Sieht man die Wurfbewegung ueberhaupt? Der obere Teil der Figur liegt
 * ausserhalb des Bildes (CONFIG.boss.ueberstand). Gemessen wird deshalb die
 * Silhouette JE BILD, getrennt nach "sichtbar" (untere 1-ueberstand) und
 * "abgeschnitten" (oberer ueberstand-Anteil).
 */
import sharp from 'sharp';
import { CONFIG } from '../src/config.js';

const B = CONFIG.boss;

for (const art of B.arten) {
  console.log(`\n=== ${art.id} (loslassenBei = Bild ${Math.round(art.loslassenBei * art.frameAnzahl)}) ===`);
  const zeilen = [];
  for (let i = 0; i < art.frameAnzahl; i++) {
    const pfad = 'public' + art.framePath.replace('{n}', String(i).padStart(2, '0'));
    const bild = sharp(pfad);
    const { width, height } = await bild.metadata();
    const { data } = await bild.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const schnitt = Math.floor(height * B.ueberstand); // diese Zeilen sind ausserhalb
    let minS = width, maxS = -1, minA = width, maxA = -1, pixS = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < 12) continue;
        if (y < schnitt) {
          if (x < minA) minA = x;
          if (x > maxA) maxA = x;
        } else {
          if (x < minS) minS = x;
          if (x > maxS) maxS = x;
          pixS++;
        }
      }
    }
    zeilen.push({
      i,
      sichtbareBreite: maxS >= 0 ? (maxS - minS + 1) / width : 0,
      sichtbareMitte: maxS >= 0 ? ((maxS + minS) / 2 / width - 0.5) : 0,
      abgeschnBreite: maxA >= 0 ? (maxA - minA + 1) / width : 0,
      pixel: pixS,
    });
  }
  const maxSicht = Math.max(...zeilen.map((z) => z.sichtbareBreite));
  const argmax = zeilen.findIndex((z) => z.sichtbareBreite === maxSicht);
  const wurfBild = Math.round(art.loslassenBei * art.frameAnzahl);
  console.log('  Bild | sichtb.Breite (Anteil) | Mitte | oben-abgeschnitten');
  for (const z of zeilen) {
    const mark = z.i === wurfBild ? '  <== loslassenBei' : z.i === argmax ? '  <== breitestes sichtbares Bild' : '';
    console.log(
      `   ${String(z.i).padStart(2)}  | ${z.sichtbareBreite.toFixed(3)} ${'#'.repeat(Math.round(z.sichtbareBreite * 40))}`.padEnd(60) +
        `| ${z.sichtbareMitte >= 0 ? '+' : ''}${z.sichtbareMitte.toFixed(3)} | ${z.abgeschnBreite.toFixed(3)}${mark}`,
    );
  }
  const spanne = maxSicht - Math.min(...zeilen.map((z) => z.sichtbareBreite));
  console.log(
    `  Schwankung der sichtbaren Silhouette: ${(spanne * 100).toFixed(1)} % der Bildbreite. ` +
      `Breitestes sichtbares Bild = ${argmax}, loslassenBei = ${wurfBild}.`,
  );
}
