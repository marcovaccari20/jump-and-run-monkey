/**
 * Der Adler — Gegner des Bosskampfs.
 *
 * Zwei Bildfolgen, beide aus gelieferten Videos zerlegt:
 *
 *   flug     Flügelschlag, läuft in Dauerschleife
 *   kacken   Er schaut nach unten, ballt die Krallen zusammen und öffnet
 *            sie wieder. GENAU BEIM ÖFFNEN fällt der Haufen — nicht am
 *            Anfang der Bewegung. Sonst sähe es aus, als käme er aus dem
 *            Nichts, statt aus dem Vogel.
 *
 * Aufgebaut wie SpritePlayer: eine Ebene, deren Textur getauscht wird. Kein
 * Spritesheet — die Einzelbilder sind unterschiedlich breit (die Flügel
 * spannen mal weit, mal eng), ein gemeinsames Raster würde sie stauchen.
 */
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

export class Adler {
  /**
   * @param {import('three').Texture[]} flug
   * @param {import('three').Texture[]} kacken
   * @param {typeof import('../config.js').CONFIG.boss} cfg
   */
  constructor(flug, kacken, cfg) {
    this.cfg = cfg;
    this.flug = flug.filter(Boolean);
    this.kacken = kacken.filter(Boolean);

    if (this.flug.length === 0) throw new Error('Adler: keine Flugbilder geladen');
    // Ohne Kackbilder kann er fliegen, aber nicht angreifen — das ist ein
    // brauchbarer Teilausfall und besser als gar kein Gegner.
    if (this.kacken.length === 0) this.kacken = this.flug;

    const bild = this.flug[0].image;
    const aspect = bild && bild.height ? bild.width / bild.height : 1.2;
    const h = cfg.adlerHoehe;

    this.material = new MeshBasicMaterial({
      map: this.flug[0],
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
    });

    this.root = new Group();
    this.mesh = new Mesh(new PlaneGeometry(h * aspect, h), this.material);
    this.mesh.frustumCulled = false;
    // Vor der Wand, aber hinter dem Affen: der Affe soll nie hinter ihm
    // verschwinden, wenn beide auf derselben Bahn stehen.
    this.mesh.position.z = 0.1;
    this.root.add(this.mesh);

    this.breite = h * aspect;
    this.hoehe = h;

    this.reset();
  }

  get object3D() {
    return this.root;
  }

  reset() {
    this.x = 0;
    this.y = this.cfg.adlerY;
    this.vx = 0;
    this.lebt = true;
    this.treffer = 0;
    /** Solange > 0: gerade getroffen, blinkt und zählt keinen zweiten Treffer. */
    this.pause = 0;

    this._phase = 0;
    this._frameIndex = -1;
    /** null = fliegt, sonst 0..1 Fortschritt der Kack-Bewegung */
    this._kackFortschritt = null;
    this._hatGekackt = false;
    this._zielX = 0;
    this._zielUhr = 0;

    this.root.position.set(this.x, this.y, 0);
    this.root.visible = true;
    this.material.opacity = 1;
  }

  _setFrame(bilder, i) {
    const n = bilder.length;
    const k = Math.max(0, Math.min(n - 1, i));
    const tex = bilder[k];
    if (tex === this.material.map) return;
    this.material.map = tex;
    this.material.needsUpdate = true;
  }

  /**
   * Neues Ziel wählen.
   *
   * Nicht einfach zufällig: ein Ziel, das zu nah am alten liegt, sieht aus
   * wie Zittern. Deshalb wird so lange neu gewürfelt, bis der Sprung gross
   * genug ist — mit Abbruch, damit ein schmales Feld die Schleife nicht
   * ewig laufen lässt.
   */
  _neuesZiel(minX, maxX) {
    const a = this.cfg.adler;
    const spanne = maxX - minX;
    let ziel = this._zielX;
    for (let i = 0; i < 8; i++) {
      const kandidat = minX + Math.random() * spanne;
      if (Math.abs(kandidat - this._zielX) >= spanne * a.minSprung) {
        ziel = kandidat;
        break;
      }
      ziel = kandidat;
    }
    this._zielX = ziel;
    this._zielUhr = a.zielWechsel.min + Math.random() * (a.zielWechsel.max - a.zielWechsel.min);
  }

  /**
   * @param {number} dt
   * @param {number} minX linke Grenze seiner Bahn
   * @param {number} maxX rechte Grenze
   * @returns {'kacke'|null} 'kacke' genau in dem Frame, in dem losgelassen wird
   */
  update(dt, minX, maxX) {
    const a = this.cfg.adler;

    /* --- Seitliche Bewegung ------------------------------------------- */
    this._zielUhr -= dt;
    if (this._zielUhr <= 0) this._neuesZiel(minX, maxX);

    const zielV = Math.max(-a.tempo, Math.min(a.tempo, (this._zielX - this.x) * 2.4));
    this.vx += (zielV - this.vx) * (1 - Math.exp(-a.beschleunigung * dt));
    this.x += this.vx * dt;
    if (this.x < minX) { this.x = minX; this.vx = 0; }
    else if (this.x > maxX) { this.x = maxX; this.vx = 0; }
    this.root.position.x = this.x;

    if (this.pause > 0) {
      this.pause -= dt;
      // Blinken, solange er unverwundbar ist — sonst sieht man den Treffer nicht.
      this.root.visible = Math.sin(this.pause * 40) > -0.3;
      if (this.pause <= 0) this.root.visible = true;
    }

    /* --- Bildfolge ----------------------------------------------------- */
    let ereignis = null;

    if (this._kackFortschritt !== null) {
      this._kackFortschritt += dt / this.cfg.kacke.dauer;

      // Genau beim Öffnen der Krallen loslassen, einmal je Angriff.
      if (!this._hatGekackt && this._kackFortschritt >= this.cfg.kacke.loslassenBei) {
        this._hatGekackt = true;
        ereignis = 'kacke';
      }

      if (this._kackFortschritt >= 1) {
        this._kackFortschritt = null;
        this._hatGekackt = false;
      } else {
        this._setFrame(
          this.kacken,
          Math.floor(this._kackFortschritt * this.kacken.length),
        );
        return ereignis;
      }
    }

    this._phase += a.flugZyklus * dt;
    if (this._phase > 1) this._phase -= 1;
    this._setFrame(this.flug, Math.floor(this._phase * this.flug.length));

    return ereignis;
  }

  /** Startet einen Angriff, sofern er nicht schon einen ausführt. */
  angreifen() {
    if (this._kackFortschritt !== null) return false;
    this._kackFortschritt = 0;
    this._hatGekackt = false;
    return true;
  }

  /** @returns {boolean} true, wenn dieser Treffer gezählt hat */
  trifft() {
    if (!this.lebt || this.pause > 0) return false;
    this.treffer += 1;
    this.pause = this.cfg.trefferPause;
    if (this.treffer >= this.cfg.treffer) this.lebt = false;
    return true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
