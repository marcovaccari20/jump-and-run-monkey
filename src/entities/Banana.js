/**
 * Banane — gibt beim Einsammeln EINE Wiederbelebung (max. 1 gebunkert).
 *
 * Fällt langsamer als ein Stein und hat eine grosszügigere Hitbox, damit das
 * Einsammeln sich gut anfühlt.
 */
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

let geteilteGeometrie = null;
let geteiltesMaterial = null;

/** Nur für Tests: erzwingt beim nächsten Bau ein frisches Material. */
export function _resetBananenAssets() {
  geteilteGeometrie = null;
  geteiltesMaterial = null;
}

export class Banana {
  /**
   * @param {number} _index
   * @param {typeof import('../config.js').CONFIG.banana} cfg
   * @param {import('three').Texture|null} textur vorgeladenes Bild
   */
  constructor(_index, cfg, textur = null) {
    this.cfg = cfg;

    /* Bis hierher war die Banane ein Torus-Ausschnitt — eine billige
     * Bananenform aus Geometrie. Jetzt das gezeichnete Bild, genau wie bei
     * Münze und Hindernissen. */
    if (!geteilteGeometrie) geteilteGeometrie = new PlaneGeometry(1, 1);
    if (!geteiltesMaterial) {
      geteiltesMaterial = new MeshBasicMaterial({
        map: textur,
        transparent: true,
        alphaTest: 0.03,
        depthWrite: false,
        side: DoubleSide,
        // Das Bild ist schon beleuchtet; Tonemapping macht das Gelb stumpf.
        toneMapped: false,
      });
    }

    this.mesh = new Mesh(geteilteGeometrie, geteiltesMaterial);
    this.mesh.visible = false;

    this.x = 0;
    this.y = 0;
    this.radius = cfg.radius;
    this.hitRadius = cfg.radius * cfg.hitRadiusFactor;
    this.active = false;
    this._bobPhase = 0;
  }

  spawn(x, y, rand01) {
    this.x = x;
    this.y = y;
    this._bobPhase = rand01 * 6.283;

    /* Fläche = (2*radius)^2, aber im Seitenverhältnis des Bildes. Die
     * freigestellte Banane ist 176x224, steht also hochkant. */
    const seite = this.cfg.bildSeite ?? 176 / 224;
    const h = 2 * this.radius * (this.cfg.spriteScale ?? 1);
    this.mesh.scale.set(h * seite, h, 1);
    this.mesh.position.set(x, y, 0);
    this.mesh.rotation.z = 0;
    this.mesh.visible = true;
    this.active = true;
  }

  update(dt, fallSpeed) {
    this.y -= fallSpeed * dt;
    this._bobPhase += dt * 2.4;
    // leichtes Pendeln, damit die Banane zwischen den Steinen auffällt
    this.x += Math.cos(this._bobPhase) * 0.55 * dt;

    this.mesh.position.x = this.x;
    this.mesh.position.y = this.y;
    // Sanftes Wiegen statt Rotation: ein flaches Bild, das sich um die
    // Hochachse dreht, verschwindet zwischendurch zu einem Strich.
    this.mesh.rotation.z = Math.sin(this._bobPhase) * 0.26;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
