/**
 * Der Affe als gezeichnetes Sprite.
 *
 * Alternative zum 3D-Modell (CONFIG.player.mode). Nach aussen verhält sich
 * diese Klasse exakt wie Player — Kollision, Wiederbelebung und Steuerung
 * sind identisch, die Spiellogik merkt keinen Unterschied.
 *
 * NUR EINE ACHSE
 * Der Affe steht senkrecht FEST (auf cfg.startPosition[1]) und bewegt sich
 * ausschliesslich nach links und rechts. `update()` fasst `this.y` nicht mehr
 * an, `this.vy` bleibt dauerhaft 0 und existiert nur noch, weil
 * `animContext()` es liest.
 *
 * ANIMATION
 * Der Kletterzyklus läuft IMMER und immer vorwärts — die Wand scrollt
 * durchgehend, also klettert der Affe durchgehend. `idleCycleSpeed` ist der
 * Sockel, seitliches Ausweichen beschleunigt den Takt. Dazu kommt eine
 * Neigung in Laufrichtung.
 *
 * Den früheren Rückwärtslauf für die Abwärtsbewegung gibt es nicht mehr; er
 * wäre seit dem Wegfall der Vertikalen unerreichbar. Eine eigene
 * Abwärts-Bildfolge gab es ohnehin nie.
 */
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

const GRAD = Math.PI / 180;

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
    this._phase = 0;
    this._lean = 0;
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
    // Nur die waagerechte Absicht — eine zweite Achse gibt es nicht mehr.
    const intent = Math.abs(this._inputX) * this.cfg.moveSpeed;
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
    // Ohne das startet ein neuer Lauf mit der Schräglage des letzten.
    this._lean = 0;
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

  /**
   * NUR NOCH WAAGERECHT.
   *
   * `this.y` wird hier bewusst NICHT MEHR ANGEFASST. Der Affe steht auf der
   * Höhe, die Konstruktor und reset() aus cfg.startPosition[1] gesetzt haben,
   * und weicht ausschliesslich seitlich aus. `this.vy` bleibt als Feld
   * bestehen (animContext liest es) und ist dauerhaft 0.
   *
   * Auch `bounds.minY/maxY` werden nicht mehr ausgewertet. Die beiden Werte
   * bleiben in CONFIG.world.bounds stehen, bedeuten aber etwas anderes als
   * früher: nicht mehr das Bewegungsband des Affen, sondern das Gefahren-
   * und Sichtbarkeitsband der fallenden Objekte (siehe Spawner).
   */
  update(dt, axis, bounds) {
    const cfg = this.cfg;
    this._inputX = axis.x;

    if (this.alive) {
      const targetVx = axis.x * cfg.moveSpeed;
      const rateX = axis.x !== 0 ? cfg.acceleration : cfg.damping;

      this.vx += (targetVx - this.vx) * (1 - Math.exp(-rateX * dt));
      this.x += this.vx * dt;

      if (this.x < bounds.minX) { this.x = bounds.minX; this.vx = 0; }
      else if (this.x > bounds.maxX) { this.x = bounds.maxX; this.vx = 0; }
    } else {
      this.vx += (0 - this.vx) * (1 - Math.exp(-cfg.damping * dt));
    }

    this.root.position.x = this.x;
    this.speed = Math.abs(this.vx);

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
   * Kein Nicken, kein Stauchen, keine Spiegelung beim Richtungswechsel — das
   * Sprite wird unverzerrt dargestellt und wechselt nur das Bild. EINE
   * Ausnahme: eine dezente Neigung in Bewegungsrichtung (siehe unten).
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

    /* DER ZYKLUS LÄUFT IMMER VORWÄRTS.
     *
     * Hier stand ein Rückwärtslauf für die Abwärtsbewegung — dieselben
     * Frames, andere Richtung. Seit es kein Runter mehr gibt, wäre die
     * Bedingung dauerhaft falsch und der Zweig unerreichbar. Weg damit,
     * samt dem negativen Modulo unten, das es nur wegen der negativen Phase
     * gab. Verloren geht nichts: eine eigene Abwärts-Bildfolge gab es nie.
     *
     * DER ZYKLUS LÄUFT AUCH IM STILLSTAND.
     *
     * Hier stand eine Stillstandsschwelle (`speedRatio > 0.08`): ohne
     * Seitwärtsbewegung fror der Affe auf einem Einzelbild ein. Das ist
     * falsch — die Wand scrollt durchgehend, der Affe steigt also
     * durchgehend, und ein eingefrorener Affe vor bewegter Wand sieht aus,
     * als klebte er am Bildschirm.
     *
     * `idleCycleSpeed` ist jetzt der SOCKEL, nicht der Sonderfall: er
     * kraxelt immer mindestens in diesem Takt und wird schneller, wenn man
     * zusätzlich ausweicht. */
    const rate = Math.max(sc.idleCycleSpeed, sc.cycleSpeed * (0.35 + 0.65 * speedRatio));
    this._phase += rate * TAU * dt;
    if (this._phase > TAU) this._phase -= TAU;

    /* --- Bildwechsel --------------------------------------------------- */
    const n = this.frames.length;
    // Die Phase kann nicht mehr negativ werden (kein Rückwärtslauf), ein
    // einfaches Modulo genügt.
    const norm = (this._phase % TAU) / TAU; // 0..1
    this._setFrame(Math.min(n - 1, Math.floor(norm * n)));

    /* --- Neigung in Bewegungsrichtung --------------------------------- */
    /* Vorzeichen: `-vx`. Der Affe schaut aus dem Bild heraus, seine Rechte
     * liegt also auf unserer Linken — ohne das Minus lehnte er sich gegen die
     * Laufrichtung. Im Menü bleibt er gerade: dort gibt es keine echte
     * Seitwärtsbewegung, nur den Kletterzyklus. */
    const lean = sc.lean;
    if (lean) {
      const ziel = this._ambient
        ? 0
        : Math.max(-lean.max, Math.min(lean.max, -this.vx * lean.proTempo));
      // Exponentielle Annäherung statt linearer: bildratenunabhängig.
      this._lean += (ziel - this._lean) * (1 - Math.exp(-lean.glaettung * dt));
      this.pivot.rotation.z = this._lean * GRAD;
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
