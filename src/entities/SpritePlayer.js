/**
 * Der Affe als gezeichnetes Sprite.
 *
 * Alternative zum 3D-Modell (CONFIG.player.mode). Nach aussen verhält sich
 * diese Klasse exakt wie Player — Kollision, Wiederbelebung und Steuerung
 * sind identisch, die Spiellogik merkt keinen Unterschied.
 *
 * ANIMATION AUS EINEM EINZELBILD
 * Die Vorlage ist EIN Bild, es gibt keine Einzelphasen. Bewegung entsteht
 * deshalb rein aus der Transformation:
 *
 *   hoch    Kletterzyklus: Nicken + wechselnde Neigung (liest sich als
 *           abwechselndes Greifen links/rechts) + Stauchen/Strecken
 *   runter  derselbe Zyklus rückwärts und langsamer
 *   seitw.  Neigung in Laufrichtung, das Sprite wird gespiegelt, damit der
 *           greifende Arm zur Bewegungsrichtung zeigt
 *   Stand   ruhiges Atmen, damit die Figur nie ganz einfriert
 *
 * Die Zyklusgeschwindigkeit hängt an der Bewegungsgeschwindigkeit — bei
 * langsamer Bewegung klettert er langsam, bei voller Fahrt schnell.
 */
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

const TAU = Math.PI * 2;

export class SpritePlayer {
  /**
   * @param {import('three').Texture[]} frames Kletter-Frames in Abspielreihenfolge
   * @param {typeof import('../config.js').CONFIG.player} cfg
   * @param {typeof import('../config.js').CONFIG.revive} reviveCfg
   * @param {typeof import('../config.js').CONFIG.sprite} spriteCfg
   */
  constructor(frames, cfg, reviveCfg, spriteCfg) {
    this.cfg = cfg;
    this.reviveCfg = reviveCfg;
    this.sc = spriteCfg;

    this.frames = frames.filter(Boolean);
    if (this.frames.length === 0) {
      throw new Error('SpritePlayer: keine Kletter-Frames geladen');
    }
    this._frameIndex = -1;
    const texture = this.frames[0];

    /* --- Aufbau: root (Position) -> pivot (Animation) -> mesh ---------- */
    this.root = new Group();
    this.pivot = new Group();
    this.root.add(this.pivot);

    const img = texture.image;
    const aspect = img && img.height ? img.width / img.height : 0.55;
    const h = cfg.spriteHeight;
    const w = h * aspect;

    this.material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      // Verhindert dunkle Ränder an der freigestellten Silhouette.
      alphaTest: 0.02,
      depthWrite: false,
    });

    // Sprite und Umriss liegen zusammen in einer Gruppe, damit das Blinken
    // während der Unverwundbarkeit beide gleichzeitig erfasst.
    this.art = new Group();
    this.pivot.add(this.art);

    const geometry = new PlaneGeometry(w, h);

    // Umriss ZUERST hinzufügen und weiter hinten platzieren -> wird davor
    // gezeichnet und liegt damit hinter dem Affen.
    const ol = spriteCfg.outline;
    if (ol?.enabled) {
      this.outlineMaterial = new MeshBasicMaterial({
        map: texture,
        color: ol.color,
        transparent: true,
        opacity: ol.opacity,
        alphaTest: 0.02,
        depthWrite: false,
      });
      this.outline = new Mesh(geometry, this.outlineMaterial);
      this.outline.frustumCulled = false;
      this.outline.scale.set(ol.scale, ol.scale, 1);
      this.outline.position.set(ol.offset[0], ol.offset[1], 0.14);
      this.art.add(this.outline);
    }

    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    // Knapp vor der Wandebene, damit der Affe nie in einem Stein steckt.
    this.mesh.position.z = 0.15;
    this.art.add(this.mesh);

    this.spriteWidth = w;
    this.spriteHeight = h;

    /* --- Zustand (identisch zu Player) --------------------------------- */
    this.x = cfg.startPosition[0];
    this.y = cfg.startPosition[1];
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.revives = 0;
    this.invulnerableTimer = 0;
    this.alive = true;

    this._inputX = 0;
    this._inputY = 0;
    this._phase = 0;
    this._blinkPhase = 0;
    this._dieTimer = 0;
    // true, solange der Zyklus im Menü läuft (siehe updateAmbient)
    this._ambient = false;

    this.root.position.set(this.x, this.y, 0);

    // Fassade mit derselben API wie der AnimationController, damit Game
    // beide Spielfiguren gleich behandeln kann.
    this.animator = {
      clipNames: [`sprite:climb(${this.frames.length} Frames)`, 'sprite:eat', 'sprite:revive', 'sprite:roar', 'sprite:die'],
      tail: null,
      cfg: { dodgeTriggerSpeed: Infinity }, // Sprite hat keinen Dodge-Akzent
      mode: 'menu',
      _locomotionKey: 'climbIdle',
      setMode: (m) => { this.animator.mode = m; },
      reset: () => this._resetAnimation(),
      setLocomotion: () => {}, // wird aus der Bewegung selbst abgeleitet
      triggerDodge: () => {},
      playOneShot: (key) => this._playEvent(key),
      update: () => {}, // die Animation läuft in SpritePlayer.update()
    };
  }

  get object3D() {
    return this.root;
  }

  get hitX() {
    return this.x;
  }

  get hitY() {
    return this.y + this.cfg.hitOffsetY;
  }

  get hitRadius() {
    return this.cfg.hitRadius;
  }

  /**
   * Steine bis zu diesem Radius prallen an diesem Affen ab (oranger Affe).
   * 0 = keiner. Ausgewertet wird das im CollisionSystem, nicht hier.
   */
  get ignoreRockRadius() {
    return this.cfg.ignoreRockRadius ?? 0;
  }

  get isInvulnerable() {
    return this.invulnerableTimer > 0;
  }

  get animSpeed() {
    const intent = Math.hypot(this._inputX, this._inputY) * this.cfg.moveSpeed;
    return Math.max(this.speed, intent);
  }

  /**
   * Tauscht das angezeigte Kletter-Frame.
   * Der Umriss bekommt dieselbe Textur, sonst passt die Silhouette nicht mehr.
   */
  _setFrame(i) {
    if (i === this._frameIndex) return;
    this._frameIndex = i;
    const texture = this.frames[i];
    this.material.map = texture;
    this.material.needsUpdate = true;
    if (this.outlineMaterial) {
      this.outlineMaterial.map = texture;
      this.outlineMaterial.needsUpdate = true;
    }
  }

  _resetAnimation() {
    this._frameIndex = -1;
    this._phase = 0;
    this._dieTimer = 0;
    this.material.opacity = 1;
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    // Sofort auf die Ruhepose setzen, sonst zeigt der Affe bis zum ersten
    // update() noch das letzte Frame des vorherigen Laufs.
    this._setFrame(this.sc.idleFrame % this.frames.length);
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
    this._inputX = 0;
    this._inputY = 0;
    this.root.position.set(this.x, this.y, 0);
    this.art.visible = true;
    this._resetAnimation();
  }

  /**
   * Weiterspielen an der Todesstelle (zweites Leben per Werbung).
   *
   * Bewusst NICHT reset(): Position, gesammelte Bananen und der Punktestand
   * bleiben, wie sie waren. Zurückgesetzt wird nur, was der Tod angerichtet
   * hat — das Wegsacken und der tote Zustand.
   *
   * @param {number} invulnerableTime Sekunden Unverwundbarkeit
   * @returns {boolean} false, wenn der Affe gar nicht tot war
   */
  reviveInPlace(invulnerableTime) {
    if (this.alive) return false;
    this.alive = true;
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.invulnerableTimer = invulnerableTime;
    this._blinkPhase = 0;
    this.art.visible = true;
    this._resetAnimation();
    return true;
  }

  /* =============================================================== Loop */

  update(dt, axis, bounds) {
    const cfg = this.cfg;
    this._inputX = axis.x;
    this._inputY = axis.y;

    if (this.alive) {
      const targetVx = axis.x * cfg.moveSpeed;
      const targetVy = axis.y * cfg.moveSpeed;
      const rateX = axis.x !== 0 ? cfg.acceleration : cfg.damping;
      const rateY = axis.y !== 0 ? cfg.acceleration : cfg.damping;

      this.vx += (targetVx - this.vx) * (1 - Math.exp(-rateX * dt));
      this.vy += (targetVy - this.vy) * (1 - Math.exp(-rateY * dt));

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      if (this.x < bounds.minX) { this.x = bounds.minX; this.vx = 0; }
      else if (this.x > bounds.maxX) { this.x = bounds.maxX; this.vx = 0; }
      if (this.y < bounds.minY) { this.y = bounds.minY; this.vy = 0; }
      else if (this.y > bounds.maxY) { this.y = bounds.maxY; this.vy = 0; }
    } else {
      this.vx += (0 - this.vx) * (1 - Math.exp(-cfg.damping * dt));
      this.vy += (0 - this.vy) * (1 - Math.exp(-cfg.damping * dt));
    }

    this.root.position.x = this.x;
    this.root.position.y = this.y;
    this.speed = Math.hypot(this.vx, this.vy);

    this._animate(dt);
    this._updateInvulnerability(dt);
  }

  /**
   * Kletterzyklus in MENÜ, CHARAKTERAUSWAHL und GAME OVER weiterlaufen lassen.
   *
   * Dort ruft Game bewusst NICHT update() auf — es gibt keine Eingabe, keine
   * Physik und keine Kollision. Die Bildfolge steckte aber genau dort drin,
   * der Affe stand hinter den Menüs deshalb reglos im Bild, während die Wand
   * hinter ihm weiterscrollte.
   *
   * Hier läuft ausschliesslich die Animation: keine Bewegung, keine
   * Positionsänderung, keine Grenzen. Ist der Affe tot (Game-Over-Bildschirm),
   * hält _animate von selbst die Sturzpose — er fängt nicht wieder an zu
   * klettern.
   */
  updateAmbient(dt) {
    this._ambient = true;
    this._animate(dt);
    this._ambient = false;
    this._updateInvulnerability(dt);
  }

  /* ========================================================== Animation */

  /**
   * Die gesamte Bewegung steckt in den Frames.
   *
   * Es gibt hier bewusst KEINE prozedurale Zusatzbewegung mehr — keine
   * Neigung, kein Nicken, kein Stauchen und keine Spiegelung beim
   * Richtungswechsel. Das Sprite wird unverzerrt und ungedreht dargestellt,
   * es wechselt nur das Bild.
   */
  _animate(dt) {
    const sc = this.sc;

    /* --- Tod: sackt nach unten weg, ohne Drehung ---------------------- */
    if (!this.alive) {
      this._dieTimer = Math.min(this._dieTimer + dt, sc.death.duration);
      const t = this._dieTimer / sc.death.duration;
      this.pivot.position.set(0, -sc.death.drop * t * t, 0);
      return;
    }

    /* --- Kletterzyklus ------------------------------------------------- */
    // Im Menü gibt es weder Eingabe noch Geschwindigkeit; dort gibt
    // ambientCycleRatio den Takt vor (siehe updateAmbient).
    const speedRatio = this._ambient
      ? this.sc.ambientCycleRatio
      : Math.min(1, this.animSpeed / this.cfg.moveSpeed);
    const moving = this._ambient || speedRatio > 0.08;

    // Abwärts läuft der Zyklus rückwärts — dieselben Frames, andere Richtung.
    // Im Menü klettert er immer aufwärts.
    const downward =
      !this._ambient &&
      (this._inputY < -0.2 || (Math.abs(this._inputY) < 0.2 && this.vy < -0.5));
    const dir = downward ? -1 : 1;

    const rate = moving ? sc.cycleSpeed * (0.35 + 0.65 * speedRatio) : sc.idleCycleSpeed;
    this._phase += dir * rate * TAU * dt;
    if (this._phase > TAU) this._phase -= TAU;
    if (this._phase < -TAU) this._phase += TAU;

    /* --- Bildwechsel --------------------------------------------------- */
    const n = this.frames.length;
    if (moving) {
      // Doppeltes Modulo ist nötig: `(x % TAU) + TAU` landet bei POSITIVER
      // Phase in [TAU, 2*TAU) und bliebe damit dauerhaft im letzten Frame
      // hängen — aufwärts stünde die Animation still, abwärts liefe sie.
      const norm = (((this._phase % TAU) + TAU) % TAU) / TAU; // 0..1
      this._setFrame(Math.min(n - 1, Math.floor(norm * n)));
    } else {
      this._setFrame(sc.idleFrame % n);
    }
  }

  _updateInvulnerability(dt) {
    if (this.invulnerableTimer <= 0) return;
    this.invulnerableTimer -= dt;
    this._blinkPhase += dt * this.reviveCfg.blinkFrequency * Math.PI * 2;
    // Umriss und Affe zusammen blinken lassen.
    this.art.visible = Math.sin(this._blinkPhase) > -0.35;
    if (this.invulnerableTimer <= 0) {
      this.invulnerableTimer = 0;
      this.art.visible = true;
    }
  }

  /**
   * Spielereignisse.
   *
   * Nur 'die' hat noch eine Sprite-Reaktion (Wegsacken). Banane,
   * Wiederbelebung und Start werden ausschliesslich über das HUD
   * zurückgemeldet — die früheren Skalierungs-Impulse sind entfernt, damit
   * sich am Affen nichts ausser dem Bildwechsel bewegt.
   */
  _playEvent(key) {
    if (key === 'die') this._dieTimer = 0;
  }

  /* ============================================================ Aktionen */

  collectBanana() {
    // Zweiter Riegel neben maxStored: 0 und dem abgeschalteten Spawn. Bei
    // etwas so Sichtbarem wie "der weisse Affe bekommt keine zweite Chance"
    // soll keine einzelne übersehene Stelle genügen, um es doch zu erlauben.
    if (this.cfg.bananas === false) return false;

    const before = this.revives;
    this.revives = Math.min(this.reviveCfg.maxStored, this.revives + 1);
    this._playEvent('eat');
    return this.revives > before;
  }

  /** @returns {'revived'|'dead'|'ignored'} */
  applyHit() {
    if (!this.alive) return 'ignored';
    if (this.isInvulnerable) return 'ignored';

    if (this.revives > 0) {
      this.revives -= 1;
      this.invulnerableTimer = this.reviveCfg.invulnerableTime;
      this._blinkPhase = 0;
      this._playEvent('revive');
      return 'revived';
    }

    this.alive = false;
    this.art.visible = true;
    this._dieTimer = 0;
    return 'dead';
  }

  animContext(out) {
    out.speed = this.animSpeed;
    out.vx = this.vx;
    out.vy = this.vy;
    return out;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.outlineMaterial?.dispose();
  }
}
