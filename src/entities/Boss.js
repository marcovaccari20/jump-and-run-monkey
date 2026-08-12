/**
 * Der Boss — eine Bildfolge, die oben quer durchs Bild wandert.
 *
 * Zwei Ausführungen, beide aus einem gelieferten Video (scripts/
 * prepare-bosskampf.mjs, je 30 Bilder):
 *
 *   gorilla   grosser Gorilla, hängt an einem Ast, wirft GRÜNE Bananen
 *   affe      kleiner Affe, klettert, wirft kleine GELBE Bananen
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DIE OBERE HAND LIEGT ÜBER DEM BILDRAND
 *
 * Beide Vorlagen zeigen die Figur samt Ast bzw. hochgestrecktem Arm. Im
 * Spiel sitzt sie so hoch, dass dieser obere Teil ausserhalb liegt — man
 * sieht einen Körper, der von oben hereinhängt, und nicht, woran er hängt.
 * `CONFIG.boss.ueberstand` ist der Anteil der Bildhöhe, der oben abgeschnitten
 * wird; der Trefferkreis sitzt entsprechend tiefer, damit er auf dem
 * SICHTBAREN Körper liegt und nicht auf der unsichtbaren Hand.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ER WIRD IMMER SCHNELLER
 *
 * Ein Boss, der von Anfang an mit vollem Tempo hin und her fährt, ist keine
 * Steigerung, sondern nur schwer. Deshalb hängt ALLES an einem einzigen
 * Fortschrittswert 0..1 (`_druck`), der über die Kampfdauer und mit jedem
 * kassierten Treffer steigt:
 *
 *   - seitliches Tempo         tempo.start   -> tempo.ende
 *   - Bilder je Sekunde        frameTakt.start -> frameTakt.ende
 *
 * Und weil der Wurf AN DER ANIMATION HÄNGT (siehe unten), wirft er dadurch
 * von selbst häufiger. Es gibt keinen zweiten Taktgeber, der auseinander-
 * laufen könnte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DER WURF KOMMT AUS DER ANIMATION, NICHT AUS EINER UHR
 *
 * "Immer wenn er die Wurfanimation macht, schmeisst er" — also genau so
 * gebaut: einmal je Durchlauf der Bildfolge, an der Stelle `loslassenBei`,
 * meldet `update` ein Wurfereignis. Gemessen (prepare-bosskampf.mjs schreibt
 * die Werte mit):
 *
 *   gorilla  Bild 23 von 30 — der Arm ist über den Kopf zurückgeholt
 *   affe     Bild  4 von 30 — der Arm ist zur Seite gestreckt
 *
 * Beim Gorilla taugte die automatische Messung („breitestes Bild") nicht:
 * sein SCHWUNG ist breiter als sein Ausholen, die Messung zeigte auf Bild 0.
 * Der Wert stammt deshalb aus dem Augenschein an den fertigen Bildern; die
 * Messung des kleinen Affen (Bild 4) deckte sich dagegen mit dem Bild.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

export class Boss {
  /**
   * @param {typeof import('../config.js').CONFIG.boss} cfg
   * @param {typeof import('../config.js').CONFIG.boss.arten[0]} art
   * @param {import('three').Texture[]} frames
   */
  constructor(cfg, art, frames) {
    this.cfg = cfg;
    this.art = art;
    this.frames = frames.filter(Boolean);

    const erstes = this.frames[0]?.image;
    const aspect = erstes && erstes.height ? erstes.width / erstes.height : 1;

    this.hoehe = art.hoehe;
    this.breite = art.hoehe * aspect;

    this.mesh = new Mesh(
      new PlaneGeometry(this.breite, this.hoehe),
      new MeshBasicMaterial({
        map: this.frames[0] ?? null,
        transparent: true,
        alphaTest: 0.02,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // Aus der Konfiguration, weil auch Game damit rechnet, wo das Bild oben
    // aufhört (CONFIG.boss.ebeneZ). Zwei getrennte Zahlen liefen auseinander.
    this.mesh.position.z = cfg.ebeneZ ?? 0.35;

    this.x = 0;
    this.y = 0;
    /** Blickrichtung: +1 = nach rechts unterwegs. */
    this.richtung = 1;
    /** 0..1 — steigt über den Kampf und mit jedem Treffer. */
    this._druck = 0;
    /** Laufende Bildnummer als Kommazahl. */
    this._bild = 0;
    /** Merker, damit je Durchlauf genau EIN Wurf ausgelöst wird. */
    this._hatGeworfen = false;
    /** Restsekunden Unverwundbarkeit nach einem Treffer. */
    this.blinken = 0;
    this.leben = cfg.treffer;
    this.aktiv = false;
  }

  /**
   * Trefferkreis — Mittelpunkt und Radius.
   *
   * Sitzt bewusst NICHT im Bildmittelpunkt: oben ragt die Figur über den
   * Bildrand hinaus (`ueberstand`), und ein Trefferkreis dort wäre für den
   * Spieler unsichtbar. Er sitzt auf dem sichtbaren Rumpf.
   */
  get trefferMitte() {
    return this.y - this.hoehe * this.cfg.ueberstand * 0.5;
  }

  get trefferRadius() {
    return this.hoehe * this.cfg.trefferAnteil;
  }

  /** @param {number} x @param {number} y */
  starten(x, y) {
    this.x = x;
    this.y = y;
    this.richtung = Math.random() < 0.5 ? -1 : 1;
    this._druck = 0;
    this._bild = 0;
    this._hatGeworfen = false;
    this.blinken = 0;
    this.leben = this.cfg.treffer;
    this.aktiv = true;
    this.mesh.visible = true;
    this.mesh.position.set(x, y, 0.35);
    this.mesh.material.opacity = 1;
    this._bildSetzen();
  }

  verstecken() {
    this.aktiv = false;
    this.mesh.visible = false;
  }

  /**
   * Treffer einstecken.
   * @returns {boolean} true, wenn er dadurch stirbt
   */
  treffer() {
    if (this.blinken > 0) return false;
    this.leben--;
    this.blinken = this.cfg.trefferPause;
    /* Jeder Treffer macht ihn wütender — der Druck springt sofort ein Stück
     * hoch, statt nur mit der Zeit zu wachsen. Sonst wäre der Kampf am Ende
     * am zähesten, wenn er eigentlich am dramatischsten sein soll. */
    this._druck = Math.min(1, this._druck + this.cfg.druckProTreffer);
    return this.leben <= 0;
  }

  /* --------------------------------------------------------------- Ablauf */

  /** Aktuelles seitliches Tempo, aus dem Druck. */
  get tempo() {
    const t = this.cfg.tempo;
    return t.start + (t.ende - t.start) * this._druck;
  }

  /** Aktuelle Bilder je Sekunde, aus dem Druck. */
  get frameTakt() {
    const f = this.cfg.frameTakt;
    return f.start + (f.ende - f.start) * this._druck;
  }

  /**
   * @param {number} dt
   * @param {number} minX linke Grenze der Wanderung
   * @param {number} maxX rechte Grenze
   * @returns {boolean} true in genau dem Bild, in dem er loslässt
   */
  update(dt, minX, maxX) {
    if (!this.aktiv) return false;

    // Druck steigt über die Kampfdauer …
    this._druck = Math.min(1, this._druck + dt / this.cfg.druckSekunden);
    if (this.blinken > 0) this.blinken = Math.max(0, this.blinken - dt);

    /* Seitlich hin und her. Am Rand kehrt er um — kein Zufallsziel wie beim
     * alten Adler: der Spieler muss VORHERSEHEN können, wo der Boss gleich
     * ist, sonst wird das Werfen zum Glücksspiel. Vorhersehbar heisst hier
     * nicht leicht: er wird schneller, und man muss trotzdem treffen. */
    this.x += this.richtung * this.tempo * dt;
    if (this.x <= minX) {
      this.x = minX;
      this.richtung = 1;
    } else if (this.x >= maxX) {
      this.x = maxX;
      this.richtung = -1;
    }
    this.mesh.position.x = this.x;
    this.mesh.position.y = this.y;

    /* Blinken nach einem Treffer: sichtbar, aber nicht so, dass man ihn
     * verliert. Halbe Deckkraft im Wechsel. */
    this.mesh.material.opacity =
      this.blinken > 0 ? (Math.sin(this.blinken * 40) > 0 ? 0.35 : 1) : 1;

    // Bildfolge weiterdrehen, dabei den Wurfmoment abpassen.
    const vorher = this._bild;
    this._bild += this.frameTakt * dt;
    const anzahl = this.frames.length || 1;

    let wirft = false;
    const loslassen = this.art.loslassenBei * anzahl;
    /* Der Wurfmoment kann in einem einzigen Schritt übersprungen werden,
     * wenn der Takt hoch und die Bildrate niedrig ist. Deshalb wird die
     * DURCHQUERUNG geprüft, nicht die Gleichheit. */
    if (!this._hatGeworfen && vorher < loslassen && this._bild >= loslassen) {
      wirft = true;
      this._hatGeworfen = true;
    }
    if (this._bild >= anzahl) {
      this._bild -= anzahl;
      this._hatGeworfen = false;
    }

    this._bildSetzen();
    return wirft;
  }

  _bildSetzen() {
    const anzahl = this.frames.length;
    if (!anzahl) return;
    const i = Math.min(anzahl - 1, Math.max(0, Math.floor(this._bild)));
    const t = this.frames[i];
    if (t && this.mesh.material.map !== t) {
      this.mesh.material.map = t;
      this.mesh.material.needsUpdate = true;
    }
    /* Nach links unterwegs = spiegeln. Die Vorlagen zeigen beide Figuren
     * seitlich; ohne Spiegelung liefe er rückwärts. */
    this.mesh.scale.x = this.richtung < 0 ? -1 : 1;
  }

  /** Wo die geworfene Banane die Hand verlässt. */
  get wurfY() {
    return this.y - this.hoehe * 0.25;
  }

  /** Halbe Bildbreite — die Grenze, ab der er aus dem Bild ragen würde. */
  get halbeBreite() {
    return this.breite / 2;
  }
}
