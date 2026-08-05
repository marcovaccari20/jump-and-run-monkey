/**
 * Banane — gibt beim Einsammeln EINE Wiederbelebung (max. 1 gebunkert).
 *
 * Fällt langsamer als ein Stein und hat eine grosszügigere Hitbox, damit das
 * Einsammeln sich gut anfühlt.
 */
import {
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Group,
} from 'three';

let sharedGeometry = null;
let sharedMaterial = null;

function getShared(cfg) {
  if (!sharedGeometry) {
    // Ein Torus-Ausschnitt ist von vorne die beste billige Bananenform:
    // gebogener Zylinder mit spitz zulaufenden Enden.
    sharedGeometry = new TorusGeometry(0.62, 0.2, 10, 22, Math.PI * 0.95);
    sharedGeometry.rotateZ(Math.PI * 0.5);
  }
  if (!sharedMaterial) {
    sharedMaterial = new MeshStandardMaterial({
      color: cfg.color,
      roughness: 0.42,
      metalness: 0.05,
      emissive: 0x4a3900,
      emissiveIntensity: 0.55,
    });
  }
  return { geometry: sharedGeometry, material: sharedMaterial };
}

export class Banana {
  /**
   * @param {number} _index
   * @param {typeof import('../config.js').CONFIG.banana} cfg
   */
  constructor(_index, cfg) {
    this.cfg = cfg;
    const { geometry, material } = getShared(cfg);

    // Group als Träger: der Mesh darin darf frei taumeln, ohne dass die
    // Positionierung davon betroffen ist.
    this.mesh = new Group();
    this.inner = new Mesh(geometry, material);
    this.mesh.add(this.inner);
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

    this.mesh.scale.setScalar(this.radius / 0.62);
    this.mesh.position.set(x, y, 0);
    this.inner.rotation.set(0, 0, 0);
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
    this.inner.rotation.y += this.cfg.spin * dt;
    this.inner.rotation.z = Math.sin(this._bobPhase) * 0.22;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
