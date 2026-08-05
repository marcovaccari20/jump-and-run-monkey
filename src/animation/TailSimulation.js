/**
 * Prozedurale Sekundärbewegung für die Schwanzkette (Spring/Damping).
 *
 * WARUM DAS EXISTIERT
 * Beim Retargeting humanoider Clips (Mixamo & Co.) wird die Tail-Kette NICHT
 * mitübertragen — ein Menschen-Rig hat keinen Schwanz. Der Schwanz würde
 * dadurch steif in der Bindepose stehen. Diese Simulation läuft deshalb
 * UNABHÄNGIG vom gerade abgespielten Clip: sie greift nach mixer.update()
 * direkt auf die Bones zu und addiert eine Auslenkung auf die animierte
 * (oder eben nicht animierte) lokale Rotation.
 *
 * Abschaltbar über CONFIG.animation.tail.enabled.
 *
 * ACHSEN-UNABHÄNGIGKEIT
 * Die lokalen Achsen der Tail-Bones sind je nach Rig verschieden. Statt eine
 * Achse fest zu verdrahten, wird pro Bone die Richtung zum Kindbone als
 * "Längsachse" gelesen und quer dazu gebogen. Der Code funktioniert damit
 * auch, wenn später ein anders orientiertes Rig eingesetzt wird.
 */
import { Quaternion, Vector3 } from 'three';

export class TailSimulation {
  /**
   * @param {import('three').Object3D} root  Wurzel des geladenen Modells
   * @param {typeof import('../config.js').CONFIG.animation.tail} cfg
   */
  constructor(root, cfg) {
    this.cfg = cfg;
    this.enabled = cfg.enabled;

    /** @type {Array<{bone: import('three').Bone, forward: Vector3, falloff: number, state: Vector3, vel: Vector3}>} */
    this.links = [];

    if (!this.enabled) return;

    const byName = new Map();
    root.traverse((o) => byName.set(o.name, o));

    cfg.bones.forEach((name, i) => {
      const bone = byName.get(name);
      if (!bone) {
        console.warn(`[TailSimulation] Bone nicht gefunden: ${name}`);
        return;
      }
      // Längsachse = Richtung zum nächsten Kettenglied, im lokalen Raum
      // dieses Bones. Für das letzte Glied den Nub oder das erste Kind nehmen.
      const child = bone.children.find((c) => c.isBone) ?? bone.children[0];
      const forward =
        child && child.position.lengthSq() > 1e-8
          ? child.position.clone().normalize()
          : new Vector3(0, 1, 0);

      this.links.push({
        bone,
        forward,
        falloff: Math.pow(cfg.falloff, i),
        state: new Vector3(),
        vel: new Vector3(),
        // Basis = die vom Clip geschriebene lokale Rotation. Siehe update():
        // nicht jeder Clip animiert die Schwanzkette, deshalb darf die
        // Auslenkung nicht auf das Ergebnis des Vorframes addiert werden.
        base: bone.quaternion.clone(),
        lastResult: bone.quaternion.clone(),
      });
    });

    if (this.links.length === 0) this.enabled = false;

    // Wiederverwendete Temporaries — im Frame-Loop wird nichts allokiert.
    this._drive = new Vector3();
    this._local = new Vector3();
    this._perp = new Vector3();
    this._axis = new Vector3();
    this._accel = new Vector3();
    this._invWorld = new Quaternion();
    this._offset = new Quaternion();
  }

  reset() {
    for (const link of this.links) {
      link.state.set(0, 0, 0);
      link.vel.set(0, 0, 0);
      link.bone.quaternion.copy(link.base);
      link.lastResult.copy(link.base);
    }
  }

  /**
   * Muss NACH mixer.update() laufen.
   * @param {number} dt
   * @param {number} vx Geschwindigkeit des Affen in der Wandebene (Units/s)
   * @param {number} vy
   */
  update(dt, vx, vy) {
    if (!this.enabled || dt <= 0) return;
    const cfg = this.cfg;

    // Trägheit: der Schwanz wird der Bewegung entgegengesetzt ausgelenkt,
    // zusätzlich zieht die Schwerkraft ihn konstant nach unten.
    this._drive.set(
      -vx * cfg.velocityInfluence,
      -vy * cfg.velocityInfluence - cfg.gravity,
      0,
    );

    // Klammer gegen Explodieren bei Frame-Spikes.
    const step = dt > 0.05 ? 0.05 : dt;

    for (const link of this.links) {
      const { bone, forward, falloff, state, vel } = link;

      /* --------------------------------------------------------------- *
       * Basis bestimmen.
       *
       * NICHT jeder Clip animiert die Schwanzkette — 'Idle' etwa enthält nur
       * einen einzigen Tail-Track. Für die übrigen Bones schreibt der Mixer
       * dann nichts, und eine Auslenkung, die einfach auf bone.quaternion
       * multipliziert wird, addiert sich Frame für Frame auf: der Schwanz
       * dreht sich langsam immer weiter auf.
       *
       * Deshalb: hat der Mixer diesen Frame geschrieben (Wert weicht vom
       * zuletzt selbst gesetzten ab), ist das die neue Basis. Sonst bleibt
       * die alte Basis stehen und die Auslenkung wird erneut darauf
       * angewandt statt aufaddiert.
       * --------------------------------------------------------------- */
      if (!bone.quaternion.equals(link.lastResult)) {
        link.base.copy(bone.quaternion);
      }
      // Auf die Basis zurücksetzen, damit die Weltrotation unten die reine
      // Clip-Pose widerspiegelt und nicht die Auslenkung des Vorframes.
      bone.quaternion.copy(link.base);

      // Antriebsvektor in den lokalen Raum dieses Bones drehen.
      bone.getWorldQuaternion(this._invWorld).invert();
      this._local.copy(this._drive).applyQuaternion(this._invWorld);

      // Nur die Komponente QUER zur Längsachse biegt den Schwanz.
      this._perp
        .copy(this._local)
        .addScaledVector(forward, -this._local.dot(forward))
        .multiplyScalar(falloff);

      // Feder-Dämpfer gegen das Ziel.
      this._accel
        .copy(this._perp)
        .sub(state)
        .multiplyScalar(cfg.stiffness)
        .addScaledVector(vel, -cfg.damping);
      vel.addScaledVector(this._accel, step);
      state.addScaledVector(vel, step);

      // Auslenkung -> Quaternion: Drehachse steht senkrecht auf Längsachse
      // und Auslenkungsrichtung.
      const amount = state.length();
      this._axis.crossVectors(forward, state);
      const axisLen = this._axis.length();

      if (amount >= 1e-5 && axisLen >= 1e-6) {
        this._axis.divideScalar(axisLen);
        const angle = amount > cfg.maxAngle ? cfg.maxAngle : amount;
        this._offset.setFromAxisAngle(this._axis, angle);
        // Auslenkung im lokalen Raum AUF DIE BASIS legen (nicht auf das
        // Vorframe-Ergebnis) — die Clip-Animation bleibt damit erhalten.
        bone.quaternion.multiply(this._offset);
      }
      // Merken, was wir geschrieben haben: daran erkennt der nächste Frame,
      // ob der Mixer den Bone überhaupt angefasst hat.
      link.lastResult.copy(bone.quaternion);

      // Weltmatrix sofort nachziehen, damit das nächste Kettenglied bereits
      // mit der korrigierten Elternrotation rechnet.
      bone.updateWorldMatrix(false, false);
    }
  }
}
