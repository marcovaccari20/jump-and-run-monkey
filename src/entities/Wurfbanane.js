/**
 * Die geworfene Banane.
 *
 * Fliegt GERADE NACH OBEN, ohne Bogen und ohne Zielsuche. Beides war
 * erwogen und beides ist falsch:
 *
 *   Ein Bogen würde den Wurf zu einer Rechenaufgabe machen — man müsste
 *   vorhalten, während der Adler seine Richtung sowieso ständig wechselt.
 *   Der Kampf soll vom Positionieren leben, nicht vom Ballistikgefühl.
 *
 *   Zielsuche würde jeden Wurf zum Treffer machen. Dann könnte man auch
 *   dreimal blind tippen.
 *
 * Also: senkrecht. Getroffen wird, wer beim Aufsteigen im Weg ist — man
 * stellt sich unter den Adler und wirft.
 *
 * Sie ist halb so gross wie die Sammelbanane (CONFIG.boss.wurf.radius) und
 * benutzt DASSELBE Bild — es ist dieselbe Banane, nur in der Hand.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

let geometrie = null;
let material = null;
let aspect = 1;

/** Nur für Tests. */
export function _resetWurfAssets() {
  geometrie = null;
  material = null;
}

export class Wurfbanane {
  /**
   * @param {number} _index
   * @param {typeof import('../config.js').CONFIG.boss.wurf} cfg
   * @param {import('three').Texture|null} textur Bild der Banane
   */
  constructor(_index, cfg, textur) {
    this.cfg = cfg;

    if (!material) {
      geometrie = new PlaneGeometry(1, 1);
      material = new MeshBasicMaterial({
        map: textur,
        transparent: true,
        alphaTest: 0.03,
        depthWrite: false,
        toneMapped: false,
      });
      aspect = (textur?.image?.width ?? 1) / (textur?.image?.height ?? 1);
    }

    this.mesh = new Mesh(geometrie, material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;

    const d = 2 * cfg.radius;
    const wurzel = Math.sqrt(aspect);
    this.mesh.scale.set(d * wurzel, d / wurzel, 1);

    this.x = 0;
    this.y = 0;
    this.hitRadius = cfg.hitRadius;
    this.active = false;
    this._drehung = 0;
  }

  spawn(x, y) {
    this.x = x;
    this.y = y;
    // Dreht sich beim Fliegen — eine starr aufsteigende Banane sieht aus
    // wie ein Fahrstuhl.
    this._drehung = 7 + Math.random() * 3;
    this.mesh.rotation.z = 0;
    this.mesh.position.set(x, y, 0.25);
    this.mesh.visible = true;
    this.active = true;
  }

  update(dt) {
    this.y += this.cfg.tempo * dt;
    this.mesh.position.y = this.y;
    this.mesh.rotation.z += this._drehung * dt;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
