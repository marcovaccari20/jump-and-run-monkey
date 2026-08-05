/**
 * Stein — fällt von oben, ein Treffer beendet das Spiel (sofern keine
 * Wiederbelebung gebunkert ist).
 *
 * Die Instanzen werden EINMAL beim Start erzeugt (siehe Pool) und danach nur
 * noch per reset() wiederverwendet. Im Frame-Loop wird nichts allokiert.
 *
 * Kollision läuft als 2D-Kreis in der Wandebene — keine 3D-Physik.
 */
import { Mesh, MeshStandardMaterial, IcosahedronGeometry } from 'three';

/** Geometrien werden zwischen allen Steinen geteilt (ein Draw-Call-Batch weniger). */
let sharedGeometries = null;

function getGeometries() {
  if (!sharedGeometries) {
    // Drei Varianten mit unterschiedlicher Kantigkeit, damit die Steine nicht
    // alle gleich aussehen. detail=0 ist ein Ikosaeder, detail=1 runder.
    sharedGeometries = [
      new IcosahedronGeometry(1, 0),
      new IcosahedronGeometry(1, 1),
      new IcosahedronGeometry(1, 0),
    ];
  }
  return sharedGeometries;
}

export class Rock {
  /**
   * @param {number} index
   * @param {typeof import('../config.js').CONFIG.rock} cfg
   */
  constructor(index, cfg) {
    this.cfg = cfg;

    const geometries = getGeometries();
    this.mesh = new Mesh(
      geometries[index % geometries.length],
      new MeshStandardMaterial({
        color: cfg.color,
        roughness: 0.94,
        metalness: 0.02,
        flatShading: true,
      }),
    );
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    // Zustand
    this.x = 0;
    this.y = 0;
    this.radius = cfg.radius.min;
    this.hitRadius = this.radius * cfg.hitRadiusFactor;
    this.vx = 0;
    this.spinX = 0;
    this.spinZ = 0;
    this.active = false;
  }

  /**
   * @param {number} x  Startposition in der Wandebene
   * @param {number} y
   * @param {number} rand01a  vorberechnete Zufallswerte (keine Allokation)
   * @param {number} rand01b
   * @param {number} rand01c
   */
  spawn(x, y, rand01a, rand01b, rand01c) {
    const cfg = this.cfg;
    this.radius = cfg.radius.min + (cfg.radius.max - cfg.radius.min) * rand01a;
    this.hitRadius = this.radius * cfg.hitRadiusFactor;

    this.x = x;
    this.y = y;
    this.vx = (rand01b * 2 - 1) * cfg.drift;
    this.spinX = cfg.spin.min + (cfg.spin.max - cfg.spin.min) * rand01b;
    this.spinZ = cfg.spin.min + (cfg.spin.max - cfg.spin.min) * rand01c;

    this.mesh.scale.setScalar(this.radius);
    this.mesh.rotation.set(rand01a * 6.283, rand01b * 6.283, rand01c * 6.283);
    this.mesh.position.set(x, y, 0);
    this.mesh.visible = true;
    this.active = true;
  }

  /**
   * @param {number} dt
   * @param {number} fallSpeed Eigengeschwindigkeit + Scrollgeschwindigkeit
   * @param {number} minX
   * @param {number} maxX
   */
  update(dt, fallSpeed, minX, maxX) {
    this.y -= fallSpeed * dt;
    this.x += this.vx * dt;

    // An den Seitenrändern abprallen, statt aus dem Bild zu driften.
    if (this.x < minX) {
      this.x = minX;
      this.vx = -this.vx;
    } else if (this.x > maxX) {
      this.x = maxX;
      this.vx = -this.vx;
    }

    this.mesh.position.x = this.x;
    this.mesh.position.y = this.y;
    this.mesh.rotation.x += this.spinX * dt;
    this.mesh.rotation.z += this.spinZ * dt;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
