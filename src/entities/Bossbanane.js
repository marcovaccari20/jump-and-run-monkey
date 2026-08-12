/**
 * Die vom BOSS geworfene Banane — das, was von oben kommt.
 *
 * Jede Boss-Art hat ihre eigene: der Gorilla wirft grosse GRÜNE Bananen
 * (public/hazards/banane_gruen.webp, aus der gelben umgefärbt), der kleine
 * Affe kleine GELBE (dieselbe Datei wie die Sammelbanane, nur klein).
 *
 * WARUM GRÜN, UND WARUM ÜBERHAUPT EINE BANANE
 * Der Affe sammelt gelbe Bananen ein — sie sind das Gute im Spiel. Etwas
 * gänzlich anderes vom Boss werfen zu lassen wäre einfacher gewesen, aber
 * die Banane ist der Witz: dasselbe Ding, das man sonst aufhebt, kommt hier
 * als Geschoss zurück. Damit niemand danach greift, ist es grün — dieselbe
 * Form, unmissverständlich andere Farbe. Die kleine gelbe des Affen bleibt
 * gelb, ist aber halb so gross und kommt von oben; verwechseln kann man sie
 * nicht, weil im Kampf ohnehin nichts zum Einsammeln fällt.
 *
 * FÄLLT SENKRECHT. Genau wie alles andere im Spiel und aus demselben Grund
 * (siehe Rock.js): ein seitlich driftendes Objekt kann man beim Abwurf nicht
 * eindeutig einer Bahn zuordnen, und dann lässt sich über Fairness nicht
 * mehr reden. Hier ist es sogar wichtiger als sonst — im Kampf gibt es keine
 * garantierte freie Bahn.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

export class Bossbanane {
  /**
   * @param {number} _index
   * @param {{radius:number, tempo:number, hitRadiusFactor:number}} cfg
   * @param {import('three').Texture|null} textur
   */
  constructor(_index, cfg, textur) {
    this.cfg = cfg;

    const aspect = (textur?.image?.width ?? 1) / (textur?.image?.height ?? 1);
    this.mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: textur,
        transparent: true,
        alphaTest: 0.03,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;

    /* Fläche über den Radius, Seitenverhältnis über die Wurzel — dieselbe
     * Rechnung wie bei Rock und Wurfbanane, damit "Radius" überall dasselbe
     * bedeutet und der Trefferkreis zum Bild passt. */
    const d = 2 * cfg.radius;
    const wurzel = Math.sqrt(aspect);
    this.mesh.scale.set(d * wurzel, d / wurzel, 1);

    this.x = 0;
    this.y = 0;
    // Wohlwollend wie bei den Steinen: das Bild darf grösser sein als der
    // Trefferkreis, nie umgekehrt.
    this.hitRadius = cfg.radius * cfg.hitRadiusFactor;
    this.active = false;
    this._drehung = 0;
  }

  spawn(x, y) {
    this.x = x;
    this.y = y;
    // Zufällige Drehrichtung — sonst trudeln alle gleich und es sieht
    // nach Kopiervorlage aus.
    this._drehung = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 3);
    this.mesh.rotation.z = Math.random() * Math.PI * 2;
    this.mesh.position.set(x, y, 0.22);
    this.mesh.visible = true;
    this.active = true;
  }

  /**
   * @param {number} dt
   * @param {number} zusatz Scrollgeschwindigkeit der Wand. Im Kampf steht
   *   die Wand still, dann ist sie 0 — der Parameter bleibt trotzdem, damit
   *   sich nichts ändern muss, falls der Kampf einmal im Fallen stattfindet.
   */
  update(dt, zusatz = 0) {
    this.y -= (this.cfg.tempo + zusatz) * dt;
    this.mesh.position.y = this.y;
    this.mesh.rotation.z += this._drehung * dt;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
