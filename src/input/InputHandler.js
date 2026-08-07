/**
 * Eingabe: Tastatur (A/D + Pfeiltasten als Alias) und Touch.
 *
 * NUR EINE ACHSE. Der Affe bewegt sich ausschliesslich nach links und rechts
 * und steht senkrecht fest — hoch und runter gibt es nicht mehr. `axis.y`
 * bleibt als Feld bestehen, weil Player, SpritePlayer und Game es lesen, ist
 * aber dauerhaft 0.
 *
 * TOUCH GREIFT ÜBERALL. Früher lag unten links ein virtueller Joystick mit
 * festem Platz, und ein Finger wurde nur dort angenommen. Jetzt tippt man
 * irgendwo hin und zieht nach links oder rechts; der Ring erscheint unter dem
 * Finger. Bedienelemente — Knöpfe, Eingabefelder, Aufklapper — haben
 * weiterhin Vorrang, siehe `onControl` in _bindTouch. Das ist seitdem der
 * EINZIGE Schutz vor Fehlgriffen: die Geometrie, die vorher das obere Drittel
 * ausnahm, gibt es nicht mehr.
 *
 * Nach aussen liefert der Handler nur `axis` plus Edge-Events für
 * Pause/Confirm/Debug. Die Spiellogik weiss nicht, ob gerade Tastatur oder
 * Finger benutzt wird.
 */

export class InputHandler {
  /**
   * @param {typeof import('../config.js').CONFIG.input} cfg
   * @param {HTMLElement} touchHost Container für den virtuellen Joystick
   */
  constructor(cfg, touchHost) {
    this.cfg = cfg;
    this.axis = { x: 0, y: 0 };

    /** @type {Set<string>} gedrückte Tastencodes */
    this._down = new Set();
    /** Edge-Flags, werden von consume*() zurückgesetzt */
    this._pausePressed = false;
    this._confirmPressed = false;
    this._debugPressed = false;
    this._mutePressed = false;
    this._anyPressed = false;

    // Umgekehrte Zuordnung code -> aktion, damit keydown O(1) ist.
    this._keyToAction = new Map();
    for (const [action, codes] of Object.entries(cfg.keys)) {
      for (const code of codes) this._keyToAction.set(code, action);
    }

    /* Nur x — es gibt keine senkrechte Steuerung mehr. `originY` bleibt, weil
     * der Griffpunkt für die Optik des Knopfes gebraucht wird; eine
     * y-Auslenkung wird gar nicht erst gemessen. */
    this._touch = {
      id: null,
      originX: 0,
      originY: 0,
      x: 0,
      active: false,
    };

    // Der Joystick greift nur im laufenden Spiel. In Menüs würde er sonst
    // Tipps auf Buttons abfangen bzw. das Scrollen der Bestenliste blockieren.
    this._captureEnabled = false;

    this._bindKeyboard();
    if (cfg.touch.enabled) this._bindTouch(touchHost);
  }

  /* ------------------------------------------------------------- Tastatur */

  _bindKeyboard() {
    this._onKeyDown = (e) => {
      const action = this._keyToAction.get(e.code);
      if (!action) return;

      const target = e.target instanceof Element ? e.target : null;

      /* Textfelder haben absoluten Vorrang.
       *
       * Ohne diese Prüfung schluckt das preventDefault unten die Buchstaben
       * W, A, S, D, P, das Leerzeichen, Enter und die Pfeiltasten — im
       * Highscore-Namensfeld liess sich damit nicht einmal der vorgegebene
       * Name "AFFE" tippen, und Enter löste kein Absenden aus. */
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      /* Enter/Leertaste auf einem per Tab fokussierten Button gehören dem
       * Button, nicht dem Spiel. Sonst cancelt preventDefault die native
       * Aktivierung, und der Confirm-Flag löst im nächsten Frame die falsche
       * Aktion aus (auf dem Game-Over-Screen startete "Hauptmenü" ein neues
       * Spiel). Bewegungstasten bleiben absichtlich aktiv, damit sich das
       * Spiel auch mit fokussiertem Button noch steuern lässt. */
      if (action === 'confirm' && target?.closest('button, a[href]')) return;

      // F1 (Debug) und Leertaste/Pfeile abfangen, damit der Browser nicht
      // scrollt oder die Hilfe öffnet.
      e.preventDefault();

      if (e.repeat) return;
      this._anyPressed = true;

      if (action === 'pause') this._pausePressed = true;
      else if (action === 'confirm') this._confirmPressed = true;
      else if (action === 'debug') this._debugPressed = true;
      else if (action === 'mute') this._mutePressed = true;

      this._down.add(action);
    };

    this._onKeyUp = (e) => {
      const action = this._keyToAction.get(e.code);
      if (action) this._down.delete(action);
    };

    // Fenster verlassen => alle Tasten loslassen, sonst "klebt" die Bewegung.
    this._onBlur = () => this._down.clear();

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  /* ---------------------------------------------------------------- Touch */

  _bindTouch(host) {
    const { radius, anchor } = this.cfg.touch;

    const base = document.createElement('div');
    base.className = 'joystick';
    base.style.left = `${anchor.left}px`;
    base.style.bottom = `${anchor.bottom}px`;
    base.style.width = base.style.height = `${radius * 2}px`;

    const knob = document.createElement('div');
    knob.className = 'joystick__knob';
    base.appendChild(knob);
    host.appendChild(base);

    this._joystickEl = base;
    this._knobEl = knob;

    /* GEGRIFFEN WIRD ÜBERALL.
     *
     * Hier stand eine Trefferprüfung auf das untere linke Viertel
     * (clientX < 55 % der Breite und clientY > 35 % der Höhe) — der Joystick
     * hatte einen festen Platz, und nur dort nahm er einen Finger an. Genau
     * das ist weg: man tippt irgendwo hin und zieht.
     *
     * Damit ist `onControl` unten der EINZIGE Schutz vor Fehlgriffen. Vorher
     * war die Geometrie das zweite Netz — das obere Drittel mit Pause- und
     * Ton-Schalter war schon durch `hit` ausgeschlossen. Die Liste unten
     * musste deshalb erweitert werden.
     */

    /* Bedienelemente haben Vorrang: eine Berührung auf einem Knopf ist ein
     * Klick, kein Steuergriff.
     *
     * `summary` und `details` sind dazugekommen — daran hängt der Aufklapper
     * "Fortschritt auf ein anderes Gerät mitnehmen". `[role="button"]` deckt
     * Elemente ab, die wie ein Knopf gemeint sind, ohne einer zu sein. */
    const onControl = (t) =>
      t.target instanceof Element &&
      t.target.closest(
        'button, input, a, select, textarea, label, summary, details, [role="button"]',
      );

    this._onTouchStart = (e) => {
      if (!this._captureEnabled) return;
      if (this._touch.id !== null) return;
      for (const t of e.changedTouches) {
        if (onControl(t)) continue;

        // Erst jetzt ist erwiesen, dass wirklich per Finger gespielt wird —
        // Geräte melden Touch-Fähigkeit auch, wenn eine Maus benutzt wird.
        document.body.classList.add('is-coarse');
        this._touch.id = t.identifier;
        this._touch.originX = t.clientX;
        this._touch.originY = t.clientY;
        this._touch.x = 0;

        this._touch.active = true;
        this._anyPressed = true;
        base.style.left = `${t.clientX - radius}px`;
        base.style.bottom = `${window.innerHeight - t.clientY - radius}px`;
        base.classList.add('joystick--active');
        e.preventDefault();
        break;
      }
    };

    this._onTouchMove = (e) => {
      if (this._touch.id === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touch.id) continue;

        /* NUR NOCH WAAGERECHT. Die senkrechte Auslenkung wird gar nicht mehr
         * gemessen — der Affe bewegt sich ausschliesslich nach links und
         * rechts, und was nicht gemessen wird, kann auch nicht versehentlich
         * irgendwo einfliessen. */
        let dx = (t.clientX - this._touch.originX) / radius;
        if (dx > 1) dx = 1;
        else if (dx < -1) dx = -1;

        this._touch.x = dx;
        // Der Knopf zeigt jetzt genau das, was die Steuerung tut: nur seitlich.
        knob.style.transform = `translate(${dx * radius * 0.62}px, 0)`;
        e.preventDefault();
        break;
      }
    };

    this._onTouchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touch.id) continue;
        this._touch.id = null;
        this._touch.active = false;
        this._touch.x = 0;

        knob.style.transform = 'translate(0px, 0px)';
        base.classList.remove('joystick--active');
        base.style.left = `${anchor.left}px`;
        base.style.bottom = `${anchor.bottom}px`;
        break;
      }
    };

    // WICHTIG: die Listener hängen am window, NICHT am Joystick-Container.
    // Der Container liegt über dem gesamten Viewport; bekäme er
    // pointer-events:auto, um Berührungen zu empfangen, würde er sämtliche
    // Buttons blockieren (auf Geräten mit Touchscreen auch bei Mausbedienung).
    window.addEventListener('touchstart', this._onTouchStart, { passive: false });
    window.addEventListener('touchmove', this._onTouchMove, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd);
    window.addEventListener('touchcancel', this._onTouchEnd);
  }

  /** Joystick-Eingabe an/aus (nur im Zustand PLAYING aktiv). */
  setTouchCapture(enabled) {
    this._captureEnabled = enabled;
    if (!enabled) this._releaseTouch();
  }

  _releaseTouch() {
    this._touch.id = null;
    this._touch.active = false;
    this._touch.x = 0;

    if (this._knobEl) this._knobEl.style.transform = 'translate(0px, 0px)';
    if (this._joystickEl) {
      this._joystickEl.classList.remove('joystick--active');
      // Auch an den Anker zurücksetzen: _onTouchEnd tut das zwar ebenfalls,
      // greift hier aber nicht mehr (die Touch-ID ist bereits null). Ohne das
      // bliebe der Ring nach dem Tod mitten auf dem Game-Over-Screen kleben.
      const { anchor } = this.cfg.touch;
      this._joystickEl.style.left = `${anchor.left}px`;
      this._joystickEl.style.bottom = `${anchor.bottom}px`;
    }
  }

  /* ------------------------------------------------------------- Abfrage */

  /** Muss einmal pro Frame VOR der Spiellogik laufen. */
  update() {
    let x = 0;

    if (this._down.has('left')) x -= 1;
    if (this._down.has('right')) x += 1;

    /* SENKRECHT GIBT ES NICHT MEHR.
     *
     * Hoch/Runter (W/S bzw. die Pfeiltasten) bewegen den Affen nicht mehr; er
     * steht fest auf seiner Höhe und weicht ausschliesslich seitlich aus.
     * Damit entfällt auch die frühere Diagonaldämpfung — es gibt keine
     * Diagonale mehr, die man dämpfen könnte.
     *
     * Die Tasten bleiben in CONFIG.input.keys BELEGT, obwohl sie nichts mehr
     * bewegen: _onKeyDown kehrt bei unbekannten Tasten früh zurück, und dann
     * fiele auch das preventDefault weg — die Pfeiltasten würden wieder die
     * Seite scrollen. */

    // Touch überschreibt die Tastatur, sobald gezogen wird.
    if (this._touch.active) {
      /* Totzone auf dem BETRAG der seitlichen Auslenkung, nicht mehr auf der
       * Länge eines Vektors: es gibt nur noch eine Achse. Mit hypot() über
       * ein x allein wäre das dasselbe Ergebnis, aber die Absicht wäre
       * unklar. */
      const len = Math.abs(this._touch.x);
      if (len > this.cfg.touch.deadZone) {
        // Totbereich herausrechnen, damit kleine Auslenkungen sauber bei 0 starten.
        const scaled = (len - this.cfg.touch.deadZone) / (1 - this.cfg.touch.deadZone);
        /* Das √2 bleibt: es stammt aus der Zeit, als der Vollausschlag auf
         * dem Einheitskreis lag und seitwärts damit nie 1.0 erreichte. Ohne
         * den Faktor wäre Ausweichen per Finger schwächer als per Tastatur —
         * genau der Unterschied, den das Projekt einmal ausdrücklich
         * beseitigt hat. */
        x = Math.max(-1, Math.min(1, Math.sign(this._touch.x) * scaled * Math.SQRT2));
      } else {
        x = 0;
      }
    }

    this.axis.x = x;
    // Bleibt als Feld bestehen — Player, SpritePlayer und Game lesen es.
    this.axis.y = 0;
  }

  /** true genau einmal pro Tastendruck. */
  consumePause() {
    const v = this._pausePressed;
    this._pausePressed = false;
    return v;
  }

  consumeConfirm() {
    const v = this._confirmPressed;
    this._confirmPressed = false;
    return v;
  }

  consumeDebug() {
    const v = this._debugPressed;
    this._debugPressed = false;
    return v;
  }

  consumeMute() {
    const v = this._mutePressed;
    this._mutePressed = false;
    return v;
  }

  consumeAny() {
    const v = this._anyPressed;
    this._anyPressed = false;
    return v;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    if (this._onTouchStart) {
      window.removeEventListener('touchstart', this._onTouchStart);
      window.removeEventListener('touchmove', this._onTouchMove);
      window.removeEventListener('touchend', this._onTouchEnd);
      window.removeEventListener('touchcancel', this._onTouchEnd);
    }
  }
}
