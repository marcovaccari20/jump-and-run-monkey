/**
 * GEGENPRÜFUNG Teil 3: Silhouettenbreite je Einzelbild, getrennt nach
 * sichtbarem Teil (untere 75 %) und abgeschnittenem Teil (obere 25 %).
 * Prüft die Behauptung des Berichts zu `loslassenBei`.
 */
import sharp from 'sharp';
import { CONFIG } from '../src/config.js';

for (const art of CONFIG.boss.arten) {
  const zeilen = [];
  for (let i = 0; i < art.frameAnzahl; i++) {
    const pfad = 'public' + art.framePath.replace('{n}', String(i).padStart(2, '0'));
    const bild = sharp(pfad).ensureAlpha();
    const { data, info } = await bild.raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const schnitt = Math.round(height * CONFIG.boss.ueberstand); // obere 25 %
    let sMin = width, sMax = -1, oMin = width, oMax = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * channels + 3] > 12) {
          if (y < schnitt) {
            if (x < oMin) oMin = x;
            if (x > oMax) oMax = x;
          } else {
            if (x < sMin) sMin = x;
            if (x > sMax) sMax = x;
          }
        }
      }
    }
    zeilen.push({
      i,
      sichtbar: sMax >= sMin ? (sMax - sMin + 1) / width : 0,
      oben: oMax >= oMin ? (oMax - oMin + 1) / width : 0,
    });
  }
  const maxS = Math.max(...zeilen.map((z) => z.sichtbar));
  const maxO = Math.max(...zeilen.map((z) => z.oben));
  const wurfBild = Math.round(art.loslassenBei * art.frameAnzahl);
  console.log(`\n===== ${art.id}  (loslassenBei = ${wurfBild}/${art.frameAnzahl}) =====`);
  for (const z of zeilen) {
    const marke = z.i === wurfBild ? ' <== WURF' : '';
    const best = z.sichtbar === maxS ? ' *breitestes sichtbar*' : '';
    const bo = z.oben === maxO ? ' [breitestes abgeschnitten]' : '';
    console.log(
      `  Bild ${String(z.i).padStart(2)}  sichtbar ${z.sichtbar.toFixed(3)}  oben ${z.oben.toFixed(3)}${best}${bo}${marke}`,
    );
  }
  const beste = zeilen.find((z) => z.sichtbar === maxS);
  console.log(
    `  -> breitestes SICHTBARES Bild: ${beste.i} (${maxS.toFixed(3)}); Wurf liegt bei Bild ${wurfBild} (${zeilen[wurfBild]?.sichtbar.toFixed(3)})`,
  );
}
