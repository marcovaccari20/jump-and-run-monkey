/**
 * Goldene Banane und Chilischote — die zwei Belohnungen, die vom Himmel
 * fallen.
 *
 * Beide funktionieren gleich: ein Bild, das senkrecht herunterkommt und
 * eingesammelt werden will. Deshalb EINE Klasse mit einer `art` statt zwei
 * fast gleicher Dateien — was sie unterscheidet, ist ausschliesslich, was
 * beim Einsammeln passiert, und das steht in Game.
 *
 * Sie fallen langsamer als alles andere (fallSpeedFactor 0.6). Das ist kein
 * Gefallen, sondern nötig: sie sind selten, und wer eine sieht, muss die
 * Bahn wechseln können, ohne dabei in einen Stein zu laufen.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

/** Eine Plane für alle — die Grösse macht mesh.scale. */
let geometrie = null;

export class Powerup {
  /**
   * @param {number} _index
   * @param {{gold: object, chili: object}} cfgs CONFIG.goldbanane / CONFIG.chili
   * @param {Map<string, import('three').Texture>} texturen nach Bildpfad
   */
  constructor(_index, cfgs, texturen) {
    this.cfgs = cfgs;
    if (!geometrie) geometrie = new PlaneGeometry(1, 1);

    this._material = {};
    this._aspect = {};
    for (const [art, cfg] of Object.entries(cfgs)) {
      const tex = texturen?.get(cfg.bild) ?? null;
      if (!tex) console.warn(`[Powerup] Bild fehlt: ${cfg.bild}`);
      this._material[art] = new MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.03,
        depthWrite: false,
        toneMapped: false,
      });
      this._aspect[art] = (tex?.image?.width ?? 1) / (tex?.image?.height ?? 1);
    }

    this.mesh = new Mesh(geometrie, this._material.gold);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.position.z = 0.22;

    this.art = 'gold';
    this.x = 0;
    this.y = 0;
    this.hitRadius = 0.5;
    this.fallSpeedFactor = 0.6;
    this.active = false;
    this._phase = 0;
  }

  /**
   * @param {'gold'|'chili'} art
   * @param {number} x
   * @param {number} y
   * @param {number} rand01
   */
  spawn(art, x, y, rand01) {
    const cfg = this.cfgs[art];
    this.art = art;
    this.mesh.material = this._material[art];

    this.hitRadius = cfg.radius * cfg.hitRadiusFactor;
    this.fallSpeedFactor = cfg.fallSpeedFactor;

    // Über die Fläche skalieren, wie bei den Steinen: gleiche Masse, egal
    // ob das Bild breit oder hoch ist.
    const d = 2 * cfg.radius * (cfg.spriteScale ?? 1);
    const wurzel = Math.sqrt(this._aspect[art]);
    this.mesh.scale.set(d * wurzel, d / wurzel, 1);

    this.x = x;
    this.y = y;
    this._phase = rand01 * 6.283;
    this.mesh.position.set(x, y, 0.22);
    this.mesh.rotation.z = 0;
    this.mesh.visible = true;
    this.active = true;
  }

  update(dt, fallSpeed) {
    this.y -= fallSpeed * this.fallSpeedFactor * dt;
    this._phase += dt * 2.6;
    // Leichtes Wippen — sie sollen auffallen, ohne von der Bahn zu wandern.
    this.mesh.position.y = this.y;
    this.mesh.rotation.z = Math.sin(this._phase) * 0.22;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
