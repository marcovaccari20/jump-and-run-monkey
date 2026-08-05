/**
 * Der Affe.
 *
 * Aufbau (drei verschachtelte Objekte, damit sich die Transformationen nicht
 * gegenseitig überschreiben):
 *
 *   root   -> Position in der Wandebene (x/y), von der Spiellogik gesetzt
 *     pivot -> Ausrichtung: pitch (in die Wand), yaw (Drehung), roll (Lean)
 *       model -> das geladene GLB, nur skaliert
 *
 * Die Fortbewegungs-Animation wird NICHT hier ausgewählt, sondern nur der
 * logische Zustand bestimmt (climbUp/…/climbIdle) und an den
 * AnimationController gemeldet. Welcher Clip das ist, steht in der clipMap.
 */
import { Box3, Group, MathUtils, Vector3 } from 'three';

const DEG2RAD = Math.PI / 180;

export class Player {
  /**
   * @param {import('three').Object3D} modelScene  gltf.scene
   * @param {import('./../animation/AnimationController.js').AnimationController} anim
   * @param {typeof import('../config.js').CONFIG.player} cfg
   * @param {typeof import('../config.js').CONFIG.revive} reviveCfg
   */
  constructor(modelScene, anim, cfg, reviveCfg) {
    this.cfg = cfg;
    this.reviveCfg = reviveCfg;
    this.anim = anim;

    this.root = new Group();
    this.pivot = new Group();
    // Reihenfolge so, dass Lean (Z) zuletzt im lokalen Raum wirkt.
    this.pivot.rotation.order = 'ZYX';
    this.model = modelScene;

    this.pivot.add(this.model);
    this.root.add(this.pivot);

    /* --- Grösse einmessen und auf die Zielhöhe skalieren ---------------- */
    // Gemessen wird die RUHEPOSE DES SKELETTS, nicht die Bounding-Box des
    // Meshes: Bei einem SkinnedMesh liegt die Geometrie im Bind-Raum, die
    // tatsächlich gezeichnete Position ergibt sich aber aus den Bones. Das
    // Quellrig hat spürbare Wurzel-Offsets — nach der Mesh-Box skaliert und
    // positioniert landet der Affe neben dem Bild.
    const rest = this._measureRestPose();
    const scale = cfg.modelHeight / rest.height;

    this.model.scale.setScalar(scale);
    // Den KÖRPERMITTELPUNKT auf die Wurzel legen (nicht die Füsse): die
    // Kletter-Ausrichtung kippt das Modell um bis zu 90° in die Wandebene,
    // und nur um den Mittelpunkt gedreht bleibt der Affe dabei an Ort und
    // Stelle. Mit den Füssen als Drehpunkt würde er beim Kippen nach vorne
    // zur Kamera hin ausschlagen.
    this.model.position.set(
      -rest.center.x * scale,
      -rest.center.y * scale,
      -rest.center.z * scale,
    );

    this.measuredHeight = rest.height;
    this.appliedScale = scale;

    // SkinnedMeshes dürfen nicht gecullt werden: three.js berechnet ihre
    // Bounding-Sphere aus der Bindepose, nicht aus der aktuellen Pose.
    this.model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.frustumCulled = false;
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });

    /* --- Zustand -------------------------------------------------------- */
    this.x = cfg.startPosition[0];
    this.y = cfg.startPosition[1];
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;

    this.revives = 0;
    this.invulnerableTimer = 0;
    this.alive = true;

    this._lean = 0;
    this._prevSpeed = 0;
    this._blinkPhase = 0;
    this._inputX = 0;
    this._inputY = 0;

    this.root.position.set(this.x, this.y, 0);
  }

  /**
   * Misst die Ruhepose über die Bone-Positionen ein.
   * @returns {{height:number, floor:number, center:{x:number,z:number}}}
   */
  _measureRestPose() {
    // Alle Transformationen neutralisieren, sonst misst man sich selbst mit.
    this.model.position.set(0, 0, 0);
    this.model.scale.setScalar(1);
    this.pivot.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);

    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const p = new Vector3();
    let bones = 0;

    this.model.traverse((o) => {
      if (!o.isBone) return;
      o.getWorldPosition(p);
      min.min(p);
      max.max(p);
      bones++;
    });

    if (bones === 0) {
      // Kein Skelett (z. B. Platzhaltermodell) — dann doch die Mesh-Box.
      const box = new Box3().setFromObject(this.model);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      return {
        height: Math.max(size.y, 1e-6),
        center: { x: center.x, y: center.y, z: center.z },
      };
    }

    // Die Bone-Kette endet vor der Silhouette: Kopfoberseite und Fusssohlen
    // liegen ausserhalb. Deshalb ein Zuschlag, sonst wirkt der Affe zu gross.
    const boneSpan = Math.max(max.y - min.y, 1e-6);
    const margin = boneSpan * 0.09;

    return {
      height: boneSpan + margin * 2,
      center: {
        x: (min.x + max.x) * 0.5,
        y: (min.y + max.y) * 0.5,
        z: (min.z + max.z) * 0.5,
      },
    };
  }

  get object3D() {
    return this.root;
  }

  /** Mittelpunkt der Kollisionsscheibe in der Wandebene. */
  get hitX() {
    return this.x;
  }

  get hitY() {
    return this.y + this.cfg.hitOffsetY;
  }

  get hitRadius() {
    return this.cfg.hitRadius;
  }

  get isInvulnerable() {
    return this.invulnerableTimer > 0;
  }

  reset() {
    this.x = this.cfg.startPosition[0];
    this.y = this.cfg.startPosition[1];
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.revives = 0;
    this.invulnerableTimer = 0;
    this.alive = true;
    this._lean = 0;
    this._prevSpeed = 0;
    this._inputX = 0;
    this._inputY = 0;
    this.root.position.set(this.x, this.y, 0);
    this.pivot.rotation.set(0, 0, 0);
    this.model.visible = true;
  }

  /**
   * Bewegung + Animationszustand.
   * @param {number} dt
   * @param {{x:number, y:number}} axis normalisierte Eingabe (-1..1)
   * @param {typeof import('../config.js').CONFIG.world.bounds} bounds
   */
  update(dt, axis, bounds) {
    const cfg = this.cfg;
    // Eingabe merken: der Animationszustand richtet sich nach der ABSICHT,
    // nicht nur nach der tatsächlichen Geschwindigkeit. Sonst schaltet der
    // Affe auf climbIdle, sobald er am oberen Rand des Bewegungsbandes
    // anliegt — obwohl der Spieler weiter "W" hält und tatsächlich steigt.
    this._inputX = axis.x;
    this._inputY = axis.y;

    if (this.alive) {
      /* ------------------------------------------------ Geschwindigkeit */
      const targetVx = axis.x * cfg.moveSpeed;
      const targetVy = axis.y * cfg.moveSpeed;

      const rateX = axis.x !== 0 ? cfg.acceleration : cfg.damping;
      const rateY = axis.y !== 0 ? cfg.acceleration : cfg.damping;

      this.vx += (targetVx - this.vx) * (1 - Math.exp(-rateX * dt));
      this.vy += (targetVy - this.vy) * (1 - Math.exp(-rateY * dt));

      /* ------------------------------------------------------ Position */
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // An den Rändern hart stoppen (Geschwindigkeit auf 0), damit der Affe
      // nicht "gegen die Wand drückt" und die Animation weiterläuft.
      if (this.x < bounds.minX) {
        this.x = bounds.minX;
        this.vx = 0;
      } else if (this.x > bounds.maxX) {
        this.x = bounds.maxX;
        this.vx = 0;
      }
      if (this.y < bounds.minY) {
        this.y = bounds.minY;
        this.vy = 0;
      } else if (this.y > bounds.maxY) {
        this.y = bounds.maxY;
        this.vy = 0;
      }
    } else {
      // Nach dem Tod nur noch ausrollen.
      this.vx += (0 - this.vx) * (1 - Math.exp(-cfg.damping * dt));
      this.vy += (0 - this.vy) * (1 - Math.exp(-cfg.damping * dt));
    }

    this.root.position.x = this.x;
    this.root.position.y = this.y;
    this.speed = Math.hypot(this.vx, this.vy);

    /* ------------------------------------------------ Animationszustand */
    const animSpeed = this.animSpeed;
    if (this.alive) {
      this.anim.setLocomotion(this._locomotionKey());

      // Ausweich-Akzent, wenn aus dem Stand heraus schnell beschleunigt wird.
      const trigger = this.anim.cfg.dodgeTriggerSpeed;
      if (this._prevSpeed < trigger && animSpeed >= trigger) {
        this.anim.triggerDodge();
      }
    }
    this._prevSpeed = animSpeed;

    /* ------------------------------------------------------------- Lean */
    const targetLean = MathUtils.clamp(
      -this.vx * cfg.leanPerSpeed,
      -cfg.maxLean,
      cfg.maxLean,
    );
    this._lean += (targetLean - this._lean) * (1 - Math.exp(-cfg.leanSmoothing * dt));

    // Reihenfolge 'ZYX': erst pitch (Kippen in die Wand), dann roll um die
    // Bild-Normale. Der kosmetische Lean addiert sich auf den Roll der clipMap.
    this.pivot.rotation.x = this.anim.pitchDeg * DEG2RAD;
    this.pivot.rotation.y = 0;
    this.pivot.rotation.z = (this.anim.rollDeg + this._lean) * DEG2RAD;

    /* ------------------------------------------------ Unverwundbarkeit */
    if (this.invulnerableTimer > 0) {
      this.invulnerableTimer -= dt;
      this._blinkPhase += dt * this.reviveCfg.blinkFrequency * Math.PI * 2;
      this.model.visible = Math.sin(this._blinkPhase) > -0.35;
      if (this.invulnerableTimer <= 0) {
        this.invulnerableTimer = 0;
        this.model.visible = true;
      }
    }
  }

  _locomotionKey() {
    // 1) Eingabe gewinnt: auch am Rand des Bewegungsbandes klettert der Affe
    //    sichtbar weiter, solange die Taste gehalten wird.
    const ix = this._inputX;
    const iy = this._inputY;
    if (Math.abs(ix) > 0.12 || Math.abs(iy) > 0.12) {
      // Seitwärts hat leichten Vorrang, sonst flackert es auf Diagonalen.
      if (Math.abs(ix) > Math.abs(iy) * 1.15) return ix > 0 ? 'climbRight' : 'climbLeft';
      return iy >= 0 ? 'climbUp' : 'climbDown';
    }

    // 2) Ohne Eingabe: solange er noch ausrollt, weiter die Bewegung zeigen.
    if (this.speed < this.cfg.idleThreshold) return 'climbIdle';
    if (Math.abs(this.vx) > Math.abs(this.vy) * 1.15) {
      return this.vx > 0 ? 'climbRight' : 'climbLeft';
    }
    return this.vy >= 0 ? 'climbUp' : 'climbDown';
  }

  /**
   * Geschwindigkeit für speedSync und Schwanzsimulation.
   * Am Rand des Bewegungsbandes ist die reale Geschwindigkeit 0, der Affe
   * klettert aber weiter — dann zählt die Eingabe.
   */
  get animSpeed() {
    const intent = Math.hypot(this._inputX, this._inputY) * this.cfg.moveSpeed;
    return Math.max(this.speed, intent);
  }

  /** Banane eingesammelt: Wiederbelebung gutschreiben (gedeckelt). */
  collectBanana() {
    const before = this.revives;
    this.revives = Math.min(this.reviveCfg.maxStored, this.revives + 1);
    this.anim.playOneShot('eat');
    return this.revives > before;
  }

  /**
   * Treffer verarbeiten.
   * @returns {'revived'|'dead'|'ignored'}
   */
  applyHit() {
    if (!this.alive) return 'ignored';
    if (this.isInvulnerable) return 'ignored';

    if (this.revives > 0) {
      this.revives -= 1;
      this.invulnerableTimer = this.reviveCfg.invulnerableTime;
      this._blinkPhase = 0;
      this.anim.playOneShot('revive');
      return 'revived';
    }

    this.alive = false;
    this.model.visible = true;
    this.anim.playOneShot('die');
    return 'dead';
  }

  /** Kontext für den AnimationController (speedSync + Schwanzsimulation). */
  animContext(out) {
    out.speed = this.animSpeed;
    out.vx = this.vx;
    out.vy = this.vy;
    return out;
  }
}
