/**
 * Sichtbarkeitsrechnung für Ebenen parallel zur Wand (konstantes z).
 *
 * Warum das nicht "2 * tan(fov/2) * distanz" ist: die Kamera schaut leicht
 * nach unten. Dadurch ist eine Ebene bei z = const NICHT parallel zur
 * Bildebene ausgerichtet — das sichtbare Gebiet darin ist ein Trapez, sein
 * Mittelpunkt liegt nicht auf y = 0, und die Breite hängt von der Höhe ab
 * (weiter oben ist die Wand näher an der Kamera, also schmaler).
 *
 * Beide Funktionen rechnen deshalb über die echte Projektionsmatrix.
 */
import { Vector3 } from 'three';

const _p = new Vector3();
const _q = new Vector3();
const _dir = new Vector3();

/**
 * Halbe sichtbare Breite in der Ebene z = planeZ auf Höhe worldY.
 *
 * Für eine Kamera ohne Gierung ist die NDC-x-Koordinate bei festem (y, z)
 * linear in world-x — es genügen also zwei Projektionen.
 *
 * @returns {number} world-x, das genau auf den rechten Bildrand fällt
 */
export function halfWidthAt(camera, planeZ, worldY) {
  _p.set(0, worldY, planeZ).project(camera);
  _q.set(1, worldY, planeZ).project(camera);
  const perUnit = _q.x - _p.x; // NDC-x pro World-Unit
  if (!Number.isFinite(perUnit) || Math.abs(perUnit) < 1e-9) return Infinity;
  return Math.abs((1 - _p.x) / perUnit);
}

/**
 * Umschliessendes Rechteck des sichtbaren Trapezes in der Ebene z = planeZ.
 * Wird zum bildfüllenden Aufziehen der Parallax-Ebenen benutzt.
 *
 * @param {object} out wiederverwendetes Zielobjekt (keine Allokation)
 */
export function visibleRectAt(camera, planeZ, out) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Die vier Bildecken auf die Ebene projizieren.
  for (let i = 0; i < 4; i++) {
    const nx = i < 2 ? -1 : 1;
    const ny = i % 2 === 0 ? -1 : 1;

    _p.set(nx, ny, 0.5).unproject(camera);
    _dir.copy(_p).sub(camera.position);
    if (Math.abs(_dir.z) < 1e-9) continue;

    const t = (planeZ - camera.position.z) / _dir.z;
    const x = camera.position.x + _dir.x * t;
    const y = camera.position.y + _dir.y * t;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    // Entartetes Frustum (z. B. Fenster mit Höhe 0) — neutrale Werte liefern.
    out.width = 1;
    out.height = 1;
    out.centerX = 0;
    out.centerY = 0;
    return out;
  }

  out.width = maxX - minX;
  out.height = maxY - minY;
  out.centerX = (minX + maxX) * 0.5;
  out.centerY = (minY + maxY) * 0.5;
  return out;
}
