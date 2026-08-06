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
  Line,
  LineBasicMaterial,
  LineLoop,
} from 'three';

const SEGMENTS = 28;
/** Stützpunkte der eingeblendeten Bahn (nur Anzeige). */
const BAHN_PUNKTE = 40;

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

    /* `transparent: true` ist hier KEIN Schönheitsfehler, sondern nötig.
     *
     * Three.js zeichnet erst alle undurchsichtigen Objekte, dann alle
     * durchsichtigen — und `renderOrder` sortiert nur INNERHALB eines
     * Durchgangs. Seit die fallenden Objekte freigestellte Sprites sind
     * (also durchsichtig), landeten die undurchsichtigen Ringe im ersten
     * Durchgang und wurden anschliessend von den Sprites übermalt: Das
     * Overlay war eingeschaltet, aber unsichtbar. Mit `transparent` liegen
     * beide im selben Durchgang, und renderOrder 999 zieht die Ringe nach
     * vorne.
     */
    const linie = (color) =>
      new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 1 });

    this._materials = {
      player: linie(cfg.hitboxColor.player),
      rock: linie(cfg.hitboxColor.rock),
      banana: linie(cfg.hitboxColor.banana),
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

    /* --- Die garantierte Bahn -----------------------------------------
     * Drei Linien: die Mitte und die beiden Ränder des Korridors. Sie sind
     * im Spiel unsichtbar — hier eingeblendet, weil man einer Zusicherung
     * ansehen können muss, ob sie stimmt. Läuft ein Objekt durch das Band,
     * ist die Garantie verletzt und man sieht es sofort.
     *
     * Die x-Achse ist die ZEIT (nach oben = später), nicht der Raum: die
     * Bahn wird ja im Voraus geplant. Oben im Bild steht also, wo sie sein
     * wird, wenn die dort fallenden Objekte unten ankommen. */
    this._bahnMaterial = new LineBasicMaterial({
      color: 0x35d0ff,
      depthTest: false,
      transparent: true, // siehe oben — sonst malen die Sprites sie zu
      opacity: 1,
    });
    this._randMaterial = new LineBasicMaterial({
      color: 0x1d6d8c,
      depthTest: false,
      transparent: true,
      opacity: 0.7,
    });
    this._bahnen = [];
    for (let i = 0; i < 3; i++) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(BAHN_PUNKTE * 3), 3));
      const linie = new Line(geo, i === 0 ? this._bahnMaterial : this._randMaterial);
      linie.renderOrder = 999;
      linie.frustumCulled = false;
      this.group.add(linie);
      this._bahnen.push(linie);
    }
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

    this._bahn(spawner);
  }

  /**
   * Zeichnet die garantierte Bahn über die Bildhöhe.
   *
   * Umgerechnet wird von Zeit auf Höhe: ein Objekt, das jetzt bei y liegt,
   * erreicht den Affen in (y - spielerY) / tempo Sekunden. Die Bahn wird
   * also genau dort eingezeichnet, wo sie für die Objekte auf dieser Höhe
   * gilt — nur so lässt sich mit einem Blick prüfen, ob eines von ihnen
   * hineinragt.
   */
  _bahn(spawner) {
    const korridor = spawner.korridor;
    if (!korridor) return;

    const world = spawner.world;
    const k = spawner.cfg.rock.korridor;
    const tempo = Math.max(
      0.5,
      spawner.difficulty.rockFallSpeed + spawner.difficulty.scrollSpeed,
    );
    const spielerY = spawner.cfg.player.startPosition[1];
    const halb = k.halbbreite + spawner.spieler.hitRadius;

    const yOben = world.spawnY;
    const yUnten = world.bounds.minY;

    for (let l = 0; l < 3; l++) {
      const versatz = l === 0 ? 0 : l === 1 ? -halb : halb;
      const pos = this._bahnen[l].geometry.attributes.position;
      for (let i = 0; i < BAHN_PUNKTE; i++) {
        const f = i / (BAHN_PUNKTE - 1);
        const y = yUnten + (yOben - yUnten) * f;
        const t = korridor.jetzt + Math.max(0, (y - spielerY) / tempo);
        pos.setXYZ(i, korridor.bei(t) + versatz, y, 0.55);
      }
      pos.needsUpdate = true;
      this._bahnen[l].geometry.computeBoundingSphere();
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
    for (const l of this._bahnen) l.geometry.dispose();
    this._bahnMaterial.dispose();
    this._randMaterial.dispose();
  }
}
