/**
 * Hitbox-Overlay (Taste F1).
 *
 * Zeichnet die tatsächlich geprüften Kollisionskreise — nicht die Meshes.
 * Wenn Overlay und gefühlte Kollision auseinanderlaufen, liegt der Fehler
 * also in der Spiellogik und nicht in der Darstellung.
 *
 * Die Ringe werden EINMAL angelegt und danach nur ein-/ausgeblendet.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
} from 'three';

const SEGMENTS = 28;

function makeRingGeometry() {
  const positions = new Float32Array(SEGMENTS * 3);
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    positions[i * 3] = Math.cos(a);
    positions[i * 3 + 1] = Math.sin(a);
    positions[i * 3 + 2] = 0;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

export class DebugOverlay {
  /**
   * @param {import('three').Object3D} scene
   * @param {typeof import('../config.js').CONFIG.debug} cfg
   * @param {number} maxRings
   */
  constructor(scene, cfg, maxRings) {
    this.cfg = cfg;
    this.visible = cfg.showHitboxes;

    this.group = new Group();
    this.group.visible = this.visible;
    // Immer sichtbar, auch wenn ein Blatt davor liegt.
    this.group.renderOrder = 999;
    scene.add(this.group);

    this._geometry = makeRingGeometry();
    this._materials = {
      player: new LineBasicMaterial({ color: cfg.hitboxColor.player, depthTest: false }),
      rock: new LineBasicMaterial({ color: cfg.hitboxColor.rock, depthTest: false }),
      banana: new LineBasicMaterial({ color: cfg.hitboxColor.banana, depthTest: false }),
    };

    /** @type {LineLoop[]} */
    this._rings = [];
    for (let i = 0; i < maxRings; i++) {
      const ring = new LineLoop(this._geometry, this._materials.rock);
      ring.visible = false;
      ring.renderOrder = 999;
      ring.frustumCulled = false;
      this.group.add(ring);
      this._rings.push(ring);
    }
    this._used = 0;
  }

  toggle() {
    this.visible = !this.visible;
    this.group.visible = this.visible;
    return this.visible;
  }

  /**
   * @param {import('../entities/Player.js').Player} player
   * @param {import('../systems/Spawner.js').Spawner} spawner
   */
  update(player, spawner) {
    if (!this.visible) return;
    this._used = 0;

    this._ring(player.hitX, player.hitY, player.hitRadius, this._materials.player);

    for (const rock of spawner.rocks.active) {
      this._ring(rock.x, rock.y, rock.hitRadius, this._materials.rock);
    }
    for (const banana of spawner.bananas.active) {
      this._ring(banana.x, banana.y, banana.hitRadius, this._materials.banana);
    }

    for (let i = this._used; i < this._rings.length; i++) {
      this._rings[i].visible = false;
    }
  }

  _ring(x, y, radius, material) {
    const ring = this._rings[this._used];
    if (!ring) return; // mehr Entities als Ringe — sollte nicht vorkommen
    ring.position.set(x, y, 0.6);
    ring.scale.setScalar(radius);
    ring.material = material;
    ring.visible = true;
    this._used++;
  }

  dispose() {
    this._geometry.dispose();
    for (const m of Object.values(this._materials)) m.dispose();
  }
}
