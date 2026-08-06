/**
 * Umfärben der Kletter-Frames — ohne eine einzige zusätzliche Bilddatei.
 *
 * Die geladenen Frames werden einmal durch ein Canvas mit CSS-Filter
 * gezeichnet; das Ergebnis wird als neue Textur weiterverwendet. Passiert
 * genau einmal beim Anlegen einer Farbe, nie im Frame-Loop.
 *
 * WARUM NICHT material.color
 * Ein Material-Tint multipliziert und kann deshalb nur abdunkeln. Aus braunem
 * Fell liesse sich so kein helles Blau und kein Gold machen. Der Canvas-Filter
 * dreht den echten Farbton (HSL) und kann zusätzlich aufhellen.
 *
 * Der Alphakanal bleibt dabei erhalten — nachgemessen: Randpixel 0, Mitte 255.
 * Die freigestellte Silhouette überlebt das Umfärben also unverändert.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';

/**
 * @param {import('three').Texture[]} frames  geladene Original-Frames
 * @param {string} filter  CSS-Filter, 'none' = unverändert
 * @returns {{textures: import('three').Texture[], erzeugt: boolean}}
 *   `erzeugt` sagt, ob NEUE Texturen entstanden sind — nur die müssen später
 *   wieder freigegeben werden. Bei 'none' kommen die Originale zurück, und die
 *   gehören dem Frame-Cache, nicht dem Aufrufer.
 */
export function recolorFrames(frames, filter) {
  if (!filter || filter === 'none') return { textures: frames, erzeugt: false };

  const out = [];
  for (const src of frames) {
    const bild = src?.image;
    if (!bild || !bild.width) {
      // Kein brauchbares Bild — lieber das Original weiterreichen als eine
      // leere Textur, sonst verschwindet der Affe.
      out.push(src);
      continue;
    }

    const canvas = document.createElement('canvas');
    canvas.width = bild.width;
    canvas.height = bild.height;

    const ctx = canvas.getContext('2d');
    ctx.filter = filter;
    ctx.drawImage(bild, 0, 0);
    ctx.filter = 'none';

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = src.wrapS;
    tex.wrapT = src.wrapT;
    tex.anisotropy = src.anisotropy;
    tex.needsUpdate = true;
    out.push(tex);
  }

  return { textures: out, erzeugt: true };
}
