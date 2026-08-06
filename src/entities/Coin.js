/**
 * Münze — die Währung des Spiels.
 *
 * Gesammelt wird sie im Lauf, ausgegeben wird sie im Menü: neue Affen und
 * neue Fellfarben. Sie ist kein Hindernis und macht nichts kaputt; wer sie
 * ignoriert, spielt genauso weit.
 *
 * WARUM SIE SENKRECHT FÄLLT, ABER NICHT WIE EIN STEIN
 * Fallende Objekte dürfen nicht seitlich wandern — daran hängt die
 * Lücken-Garantie (siehe Korridor.js). Für die Münze gilt das nicht: sie ist
 * ungefährlich, also darf sie pendeln. Genau das macht sie im Bild auffällig,
 * ohne dass irgendeine Zusicherung leidet.
 *
 * Sie fällt LANGSAMER als die Hindernisse. Eine Münze, die so schnell
 * herunterkommt wie ein Brocken, wäre nicht einsammelbar, sondern ein zweiter
 * Reflextest — und für etwas Freiwilliges ist das der falsche Preis.
 */
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

let geteilteGeometrie = null;
let geteiltesMaterial = null;

export class Coin {
  /**
   * @param {number} _index
   * @param {typeof import('../config.js').CONFIG.coin} cfg
   * @param {import('three').Texture|null} textur vorgeladenes Bild
   */
  constructor(_index, cfg, textur = null) {
    this.cfg = cfg;

    if (!geteilteGeometrie) geteilteGeometrie = new PlaneGeometry(1, 1);
    if (!geteiltesMaterial) {
      geteiltesMaterial = new MeshBasicMaterial({
        map: textur,
        transparent: true,
        alphaTest: 0.03,
        depthWrite: false,
        side: DoubleSide,
        // Das Bild ist bereits beleuchtet — Tonemapping würde das Gold
        // stumpf machen.
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
    this._phase = 0;
    this._mitteX = 0;
  }

  spawn(x, y, rand01) {
    this.x = x;
    this.y = y;
    this._mitteX = x;
    this._phase = rand01 * 6.283;

    const d = this.radius * 2;
    this.mesh.scale.set(d, d, 1);
    this.mesh.position.set(x, y, 0.05); // knapp vor den Hindernissen
    this.mesh.visible = true;
    this.active = true;
  }

  update(dt, fallSpeed) {
    this.y -= fallSpeed * dt;
    this._phase += dt * this.cfg.pendelTempo;

    // Um die Abwurfstelle pendeln, nicht davondriften.
    this.x = this._mitteX + Math.sin(this._phase) * this.cfg.pendelWeite;

    this.mesh.position.x = this.x;
    this.mesh.position.y = this.y;
    // Leichtes Kippen — die Münze soll blinken, nicht rotieren: ein sich
    // überschlagendes Bild wird unlesbar.
    this.mesh.rotation.z = Math.sin(this._phase * 0.7) * 0.25;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
