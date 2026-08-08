/**
 * Was der Adler fallen lässt.
 *
 * Drei Grössen (CONFIG.boss.kacke.arten). Ein Treffer wirkt genau wie ein
 * Stein: Wiederbelebung wenn eine gebunkert ist, sonst vorbei. Bewusst
 * dieselbe Regel — im Kampf soll niemand raten müssen, ob das hier "anders"
 * tödlich ist.
 *
 * UNTERSCHIED ZUM STEIN: kein Korridor, keine Bahnen.
 *
 * Die fallenden Objekte des normalen Spiels halten eine garantiert freie
 * Bahn frei (siehe Korridor.js). Hier gibt es die nicht — der Adler zielt,
 * wohin er will. Das ist der Grund, warum der Affe im Kampf nach unten
 * geht: die Reaktionszeit muss über den längeren Fallweg zurückkommen, weil
 * sie nicht mehr über eine zugesicherte Lücke kommt.
 *
 * Fällt IMMER senkrecht, wie der Stein. Sobald etwas seitlich wandert, kann
 * man beim Abwurf nicht mehr sagen, wo es ankommt.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

/** Eine Plane für alle — die Grösse macht mesh.scale. */
let geometrie = null;
/** Material je Art; die Bilder wechseln im Kampf nicht. */
let materialien = null;

/**
 * @param {typeof import('../config.js').CONFIG.boss.kacke} cfg
 * @param {Map<string, import('three').Texture>} texturen nach Bildpfad
 */
function geteiltes(cfg, texturen) {
  if (materialien) return materialien;
  geometrie = new PlaneGeometry(1, 1);
  materialien = new Map();
  for (const art of cfg.arten) {
    const tex = texturen?.get(art.bild) ?? null;
    if (!tex) {
      console.warn(`[Kacke] Bild fehlt: ${art.bild}`);
      continue;
    }
    materialien.set(art.id, {
      material: new MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.03,
        depthWrite: false,
        toneMapped: false,
      }),
      aspect: (tex.image?.width ?? 1) / (tex.image?.height ?? 1),
    });
  }
  return materialien;
}

/** Nur für Tests: erzwingt beim nächsten Kacke() einen Neuaufbau. */
export function _resetKackeAssets() {
  geometrie = null;
  materialien = null;
}

export class Kacke {
  /**
   * @param {number} _index
   * @param {typeof import('../config.js').CONFIG.boss.kacke} cfg
   * @param {Map<string, import('three').Texture>} texturen
   */
  constructor(_index, cfg, texturen) {
    this.cfg = cfg;
    this._geteilt = geteiltes(cfg, texturen);

    const erste = this._geteilt.get(cfg.arten[0].id);
    this.mesh = new Mesh(geometrie, erste?.material ?? new MeshBasicMaterial());
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    // Vor dem Adler, damit sie beim Loslassen nicht in ihm steckt.
    this.mesh.position.z = 0.2;

    this.x = 0;
    this.y = 0;
    this.art = cfg.arten[0];
    this.radius = this.art.radius;
    this.hitRadius = this.radius * cfg.hitRadiusFactor;
    this.active = false;
    // Damit die Kollisionsprüfung dieselben Felder findet wie beim Stein.
    this.type = { id: this.art.id };
    this._drehung = 0;
  }

  /**
   * @param {object} art  Eintrag aus CONFIG.boss.kacke.arten
   * @param {number} x
   * @param {number} y
   */
  spawn(art, x, y) {
    const g = this._geteilt.get(art.id);
    this.art = art;
    this.radius = art.radius;
    this.hitRadius = this.radius * this.cfg.hitRadiusFactor;
    this.type = { id: art.id };

    if (g) {
      this.mesh.material = g.material;
      // Über die Fläche skalieren, wie beim Stein: gleiche Masse, egal ob
      // das Bild breit oder hoch ist.
      const d = 2 * this.radius;
      const wurzel = Math.sqrt(g.aspect);
      this.mesh.scale.set(d * wurzel, d / wurzel, 1);
    }

    this.x = x;
    this.y = y;
    this._drehung = (Math.random() - 0.5) * 1.2;
    this.mesh.rotation.z = 0;
    this.mesh.position.set(x, y, 0.2);
    this.mesh.visible = true;
    this.active = true;
  }

  /**
   * @param {number} dt
   * @param {number} tempo Fallgeschwindigkeit (der Artfaktor kommt hier drauf)
   */
  update(dt, tempo) {
    this.y -= tempo * this.art.tempo * dt;
    this.mesh.position.y = this.y;
    // Leicht taumeln, damit es fällt und nicht schwebt. Kein Überschlag —
    // die Haufen haben oben und unten.
    this.mesh.rotation.z += this._drehung * dt;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
