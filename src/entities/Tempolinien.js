/**
 * Tempolinien — senkrechte Streifen, die während des Chili-Fluges vorbeiziehen.
 *
 * WARUM ES DIE ÜBERHAUPT GIBT
 *
 * Der Flug lief messbar mit dem 24-fachen der normalen Kletterstrecke, und man
 * sah es trotzdem nicht. Das ist kein Wahrnehmungsfehler des Spielers, sondern
 * Rechnerei:
 *
 *   Eine Wandkachel ist 9.5 Einheiten hoch. Beim Klettern wandert die Textur
 *   rund 0.19 Kachelhöhen je Sekunde, bei 60 Bildern also 0.003 Kacheln je
 *   Bild — winzige Schritte, das Auge verfolgt jedes Blatt.
 *
 *   Im Flug sind es etwa 4.4 Kachelhöhen je Sekunde, also 0.073 Kacheln je
 *   Bild. Die Blattstruktur wiederholt sich auf dieser Skala mehrfach. Zwei
 *   aufeinanderfolgende Bilder haben damit KEINE erkennbare Entsprechung
 *   mehr — es gibt kein Blatt, das man von Bild zu Bild weiterverfolgen
 *   könnte. Das Ergebnis ist Flimmern, und Flimmern liest sich als "steht".
 *
 * Schneller machen hilft an dieser Stelle nichts, im Gegenteil. Was fehlt,
 * sind Dinge, die man verfolgen KANN: lange Streifen, die über mehrere Bilder
 * hinweg dasselbe Objekt bleiben. Genau das sind diese Linien.
 *
 * Die Textur wird im Code gezeichnet (Canvas), es kommt also keine Datei dazu
 * — und sie kann sich damit an die Feldbreite anpassen, statt auf ein festes
 * Seitenverhältnis festgelegt zu sein.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
} from 'three';

/** Zeichnet die Streifentextur einmalig. */
function streifenTextur() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);

  /* Streifen ungleich verteilen. Gleichmässige Abstände ergeben ein Gitter,
   * und ein Gitter flimmert bei hohem Tempo genauso wie die Blattwand. */
  const zufall = (() => {
    let s = 1337;
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  })();

  for (let i = 0; i < 26; i++) {
    const x = zufall() * cv.width;
    const breite = 1 + zufall() * 2.5;
    const laenge = cv.height * (0.25 + zufall() * 0.5);
    const oben = zufall() * (cv.height - laenge);
    const kraft = 0.35 + zufall() * 0.65;

    // Oben und unten ausblenden, sonst reisst der Streifen hart ab.
    const farbe = g.createLinearGradient(0, oben, 0, oben + laenge);
    farbe.addColorStop(0, 'rgba(255,255,255,0)');
    farbe.addColorStop(0.5, `rgba(255,255,255,${kraft})`);
    farbe.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = farbe;
    g.fillRect(x, oben, breite, laenge);
  }

  const t = new CanvasTexture(cv);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  return t;
}

export class Tempolinien {
  /**
   * @param {object} cfg  CONFIG.chili.linien
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.textur = streifenTextur();

    this.mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: this.textur,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    /* Zwischen Wand (z = -0.9) und Affe (z ≈ 0.15). Die Linien liegen damit
     * VOR der Wand, aber HINTER der Figur — der Affe bleibt der klarste
     * Punkt im Bild, die Linien rauschen an ihm vorbei. */
    this.mesh.position.z = cfg.z;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;

    this.staerke = 0;
    this.versatz = 0;
  }

  get object3D() {
    return this.mesh;
  }

  /** Auf die sichtbare Fläche spannen. */
  groesseSetzen(bounds) {
    const b = Math.max(0.1, (bounds.maxX - bounds.minX) * 1.15);
    const h = Math.max(0.1, (bounds.maxY - bounds.minY) * 1.3);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new PlaneGeometry(b, h);
    this.mesh.position.y = (bounds.maxY + bounds.minY) / 2;
    // Waagerecht so oft wiederholen, dass die Streifen nicht gestreckt wirken.
    this.textur.repeat.set(Math.max(1, b / 6), 1);
  }

  /**
   * @param {number} dt      Bildzeit in Sekunden
   * @param {number} tempo   Vorbeiziehende Strecke in Weltteinheiten je Sekunde
   *                         (0 = kein Flug, dann blenden die Linien aus)
   */
  update(dt, tempo) {
    const ziel = tempo > 0 ? 1 : 0;
    // Ein- und Ausblenden, damit die Linien nicht aufploppen.
    const takt = ziel > this.staerke ? this.cfg.einblenden : this.cfg.ausblenden;
    this.staerke += (ziel - this.staerke) * (1 - Math.exp(-takt * dt));
    if (this.staerke < 0.01) {
      this.staerke = 0;
      this.mesh.visible = false;
      return;
    }

    this.mesh.visible = true;
    this.mesh.material.opacity = this.staerke * this.cfg.deckkraft;

    /* Die Linien laufen mit einem BRUCHTEIL der echten Strecke.
     *
     * Mit voller Geschwindigkeit hätten sie dasselbe Problem wie die Wand:
     * zu schnell, um sie zu verfolgen. Der Bruchteil ist so gewählt, dass ein
     * Streifen etwa drei bis fünf Bilder lang sichtbar bleibt — schnell genug,
     * dass es rast, langsam genug, dass das Auge mitkommt. */
    this.versatz += tempo * this.cfg.mitlauf * dt;
    this.textur.offset.y = -(this.versatz % 1);
  }

  /**
   * Sofort abschalten — für Abbrüche (neuer Lauf, Menü), NICHT für das
   * normale Flugende.
   *
   * Am regulären Ende blendet update() die Linien über `ausblenden` weich
   * heraus; wer hier hart abschaltet, schneidet sie mitten in voller
   * Deckkraft ab. Genau das passierte, weil _chiliAbbrechen beides erledigte
   * — der Parameter `ausblenden` war damit wirkungslos.
   */
  aus() {
    this.staerke = 0;
    this.mesh.visible = false;
    this.mesh.material.opacity = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.textur.dispose();
  }
}
