/**
 * Der Adler als ECHTE 3D-FIGUR.
 *
 * WARUM NICHT MEHR ALS BILDFOLGE
 * Vorher war er ein Sprite: 12 aus einem Video zerlegte Einzelbilder, die
 * durchgetauscht wurden. Das sah bei jeder Grösse nach abgefilmtem Video aus
 * — die Bilder bringen ihre eigene Beleuchtung, ihre eigene Perspektive und
 * ihre eigene Kantenschärfe mit, und nichts davon passt zur Szene.
 *
 * Jetzt ist er gebaut und wird von denselben Lichtern beleuchtet wie alles
 * andere. Er neigt sich in die Kurve, schlägt mit den Flügeln, dreht den
 * Kopf — und ist bei jeder Grösse scharf, weil es kein Bild gibt, das man
 * vergrössern könnte.
 *
 * WARUM DIE FLÜGEL FLÄCHEN SIND UND KEINE KÖRPER
 * Zwei Anläufe zuvor bestanden sie aus aneinandergereihten Kegeln, einer je
 * Feder. Beides sah falsch aus: einmal wie ein Ball mit Stummeln, dann wie
 * ein Affe mit erhobenen Armen. Der Grund ist die SILHOUETTE — einen Vogel
 * erkennt man am Umriss des Flügels, nicht an einzelnen Federn. Ein Umriss
 * lässt sich aber nicht aus Kegeln zusammenlegen, er muss gezeichnet werden.
 *
 * Deshalb ist jeder Flügel eine flach ausgezogene Kurve: vorne die glatte
 * Anströmkante, hinten die geschwungene Hinterkante, aussen die vier
 * gespreizten Fingerfedern. Genau daran erkennt man einen Greifvogel.
 *
 * DER SCHLAG
 * Der Flügel hat ein Gelenk. Der Aussenteil hinkt dem Innenteil nach
 * (`nachlauf`) und dreht sich beim Aufschlag um die eigene Achse — deshalb
 * wirkt ein echter Vogel beim Hochziehen schmaler. Ohne das ist der Schlag
 * ein Scheibenwischer.
 */
import {
  Box3,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  Vector3,
} from 'three';

const GRAD = Math.PI / 180;

/** Alle Geometrien und Materialien einmal für alle Adler. */
let geteilt = null;

/**
 * Innenflügel (Armschwingen): vom Körper bis zum Gelenk.
 * Vorne fast gerade, hinten ausgestellt — das ist der tragende Teil.
 */
function armUmriss() {
  const s = new Shape();
  s.moveTo(0, 0.17);
  s.quadraticCurveTo(0.3, 0.185, 0.54, 0.12);
  s.lineTo(0.54, -0.2);
  s.quadraticCurveTo(0.3, -0.3, 0, -0.19);
  s.closePath();
  return s;
}

/**
 * Aussenflügel (Handschwingen): ab dem Gelenk, mit den vier gespreizten
 * Fingerfedern an der Spitze. Der Wurzelquerschnitt passt genau auf die
 * Spitze des Innenflügels, damit kein Knick entsteht.
 */
function handUmriss() {
  const s = new Shape();
  s.moveTo(0, 0.12);
  s.quadraticCurveTo(0.26, 0.1, 0.46, 0.025);
  // Vier Finger, jeder etwas kürzer und tiefer als der davor.
  s.lineTo(0.62, -0.005);
  s.lineTo(0.48, -0.045);
  s.lineTo(0.61, -0.085);
  s.lineTo(0.45, -0.115);
  s.lineTo(0.56, -0.17);
  s.lineTo(0.4, -0.185);
  s.lineTo(0.47, -0.25);
  s.lineTo(0.3, -0.225);
  s.quadraticCurveTo(0.15, -0.235, 0, -0.2);
  s.closePath();
  return s;
}

/** Schwanzfächer: fünf Federn, angedeutet durch Kerben an der Kante. */
function schwanzUmriss() {
  const s = new Shape();
  s.moveTo(-0.1, 0.02);
  s.lineTo(-0.19, -0.36);
  for (let i = 0; i < 4; i++) {
    const x = -0.19 + ((i + 1) * 0.38) / 4;
    s.lineTo(x - 0.03, -0.32);
    s.lineTo(x, -0.37);
  }
  s.lineTo(0.19, -0.36);
  s.lineTo(0.1, 0.02);
  s.closePath();
  return s;
}

function flach(umriss, tiefe) {
  const geo = new ExtrudeGeometry(umriss, {
    depth: tiefe,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 10,
  });
  // Mittig um z = 0, damit das Drehen um die Längsachse sauber aussieht.
  geo.translate(0, 0, -tiefe / 2);
  return geo;
}

function bauGeteiltes() {
  if (geteilt) return geteilt;

  const stoff = (farbe, rauheit = 0.86) =>
    new MeshStandardMaterial({
      color: farbe,
      roughness: rauheit,
      metalness: 0.02,
      // Die Flügel sind dünn und werden von beiden Seiten gesehen, sobald
      // er sich in die Kurve legt.
      side: DoubleSide,
    });

  geteilt = {
    // Farben von der Vorlage abgenommen: warmes Braun, heller Bauch,
    // rostroter Schwanz, gelber Schnabel mit dunkler Spitze.
    braun: stoff(0x9c6435),
    braunDunkel: stoff(0x6d4425),
    bauch: stoff(0xd9b183),
    rost: stoff(0xbe5f28),
    gelb: stoff(0xe8b53a, 0.55),
    horn: stoff(0x2f2a26, 0.5),
    auge: stoff(0x171310, 0.35),

    kugel: new SphereGeometry(1, 18, 14),
    kegel: new ConeGeometry(1, 1, 12),
    walze: new CylinderGeometry(1, 1, 1, 10),
    arm: flach(armUmriss(), 0.03),
    hand: flach(handUmriss(), 0.024),
    schwanz: flach(schwanzUmriss(), 0.02),
  };
  return geteilt;
}

/** Nur für Tests: erzwingt beim nächsten Adler einen Neuaufbau. */
export function _resetAdler3DAssets() {
  geteilt = null;
}

export class Adler3D {
  /**
   * @param {typeof import('../config.js').CONFIG.boss} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    const g = bauGeteiltes();

    this.root = new Group();
    /* Die Figur hängt in einer eigenen Gruppe, damit Skalierung und
     * Zentrierung die Position nicht anfassen. */
    this.figur = new Group();
    this.root.add(this.figur);

    /* GEBAUT WIRD IN FIGURENEINHEITEN, nicht in Welteinheiten. Am Ende wird
     * die fertige Figur GEMESSEN und auf cfg.adlerHoehe gebracht — so kann
     * man hier an den Massen schrauben, ohne dass er im Spiel die Grösse
     * wechselt. */
    const RUMPF_B = 0.115; // Halbbreite des Rumpfes
    const RUMPF_H = 0.27; // halbe Rumpfhöhe

    /* --- Rumpf --------------------------------------------------------- */
    this.koerper = new Mesh(g.kugel, g.braun);
    this.koerper.scale.set(RUMPF_B, RUMPF_H, 0.115);
    this.figur.add(this.koerper);

    // Heller Brustlatz, deutlich schmaler als der Rumpf: er soll den Körper
    // gliedern, nicht ihn ersetzen.
    const brust = new Mesh(g.kugel, g.bauch);
    brust.scale.set(RUMPF_B * 0.66, RUMPF_H * 0.72, 0.075);
    brust.position.set(0, -0.05, 0.075);
    this.figur.add(brust);

    /* --- Kopf ---------------------------------------------------------- */
    this.kopf = new Group();
    this.kopf.position.set(0, RUMPF_H + 0.045, 0.025);
    this.figur.add(this.kopf);

    const schaedel = new Mesh(g.kugel, g.bauch);
    schaedel.scale.set(0.105, 0.095, 0.098);
    this.kopf.add(schaedel);

    // Dunkle Haube: der Kopf muss sich vom hellen Brustlatz absetzen, sonst
    // verschmelzen beide zu einer Erdnuss.
    const haube = new Mesh(g.kugel, g.braunDunkel);
    haube.scale.set(0.103, 0.072, 0.094);
    haube.position.set(0, 0.04, -0.012);
    this.kopf.add(haube);

    // Bartstreif unter dem Auge — die Zeichnung des Falken aus der Vorlage.
    for (const s of [-1, 1]) {
      const streif = new Mesh(g.kugel, g.braunDunkel);
      streif.scale.set(0.022, 0.045, 0.02);
      streif.position.set(s * 0.055, -0.045, 0.072);
      this.kopf.add(streif);
    }

    const schnabel = new Mesh(g.kegel, g.gelb);
    schnabel.scale.set(0.045, 0.105, 0.045);
    schnabel.position.set(0, -0.045, 0.085);
    schnabel.rotation.x = 114 * GRAD;
    this.kopf.add(schnabel);

    const spitze = new Mesh(g.kegel, g.horn);
    spitze.scale.set(0.034, 0.05, 0.034);
    spitze.position.set(0, -0.082, 0.122);
    spitze.rotation.x = 126 * GRAD;
    this.kopf.add(spitze);

    for (const s of [-1, 1]) {
      const auge = new Mesh(g.kugel, g.auge);
      auge.scale.setScalar(0.024);
      auge.position.set(s * 0.062, 0.012, 0.075);
      this.kopf.add(auge);
    }

    /* --- Schwanz ------------------------------------------------------- */
    this.schwanz = new Group();
    this.schwanz.position.set(0, -RUMPF_H + 0.03, -0.02);
    this.figur.add(this.schwanz);
    const fächer = new Mesh(g.schwanz, g.rost);
    this.schwanz.add(fächer);

    /* --- Krallen ------------------------------------------------------- */
    this.krallen = new Group();
    this.krallen.position.set(0, -RUMPF_H * 0.66, 0.055);
    this.figur.add(this.krallen);
    for (const s of [-1, 1]) {
      const bein = new Mesh(g.walze, g.gelb);
      bein.scale.set(0.024, 0.085, 0.024);
      bein.position.set(s * 0.055, -0.042, 0.008);
      this.krallen.add(bein);
      for (let k = -1; k <= 1; k++) {
        const zehe = new Mesh(g.kegel, g.horn);
        zehe.scale.set(0.015, 0.06, 0.015);
        zehe.position.set(s * 0.055 + k * 0.021, -0.1, 0.02);
        zehe.rotation.set(-34 * GRAD, 0, k * 22 * GRAD);
        this.krallen.add(zehe);
      }
    }

    /* --- Flügel -------------------------------------------------------- */
    this.schultern = [];
    this.haende = [];
    for (const s of [-1, 1]) {
      /* SPIEGELN UND DREHEN MÜSSEN GETRENNT SEIN.
       *
       * Erst standen beide auf demselben Objekt: `scale.x = s` für die
       * Spiegelung und `rotation.z` für den Schlag. Three.js setzt die
       * Matrix als T·R·S zusammen — die Drehung wirkt also NACH der
       * Spiegelung und wird von ihr nicht mitgedreht. Ergebnis im Bild:
       * beide Flügel drehten in dieselbe Richtung, einer hoch, einer runter.
       * Der Vogel sah aus, als würde er umkippen.
       *
       * Jetzt hängt das Gelenk INNERHALB der gespiegelten Gruppe. Dieselbe
       * lokale Drehung ergibt dort von selbst die spiegelbildliche
       * Bewegung — ohne Vorzeichen im Animationscode. */
      const spiegel = new Group();
      spiegel.position.set(s * RUMPF_B * 0.85, 0.075, -0.005);
      spiegel.scale.x = s;
      this.figur.add(spiegel);

      const schulter = new Group();
      spiegel.add(schulter);
      this.schultern.push({ gruppe: schulter, seite: s });

      const arm = new Mesh(g.arm, g.braun);
      schulter.add(arm);

      // Schulterdeckfedern: der weiche Übergang vom Rumpf zum Flügel.
      const deck = new Mesh(g.kugel, g.braunDunkel);
      deck.scale.set(0.085, 0.075, 0.055);
      deck.position.set(0.06, 0.0, 0.03);
      schulter.add(deck);

      // Gelenk am Ende des Innenflügels.
      const hand = new Group();
      hand.position.set(0.54, -0.04, 0);
      schulter.add(hand);
      this.haende.push({ gruppe: hand, seite: s });

      const feder = new Mesh(g.hand, g.braunDunkel);
      hand.add(feder);
    }

    /* --- Auf die gewünschte Höhe normieren ----------------------------- *
     *
     * GEMESSEN, NICHT GESCHÄTZT. Die Figur besteht aus zwei Dutzend Teilen;
     * wie hoch sie am Ende ist, lässt sich aus den Einzelmassen kaum
     * ablesen — beim ersten Anlauf lag ich um mehr als das Doppelte daneben.
     * Three.js kann es ausrechnen, also soll es das tun. */
    const kasten = new Box3().setFromObject(this.figur);
    const masse = kasten.getSize(new Vector3());
    this._rohHoehe = masse.y || 1;
    this._rohBreite = masse.x || 1;
    this.breiteJeHoehe = this._rohBreite / this._rohHoehe;

    /* Die Figur sitzt nicht symmetrisch um ihren Ursprung — Kopf oben,
     * Schwanz unten. Einmal zentrieren, damit `root.position` wirklich die
     * Mitte der Figur meint. */
    const mitte = kasten.getCenter(new Vector3());
    this.figur.position.set(-mitte.x, -mitte.y, -mitte.z);

    this.hoehe = cfg.adlerHoehe;
    this.breite = this.hoehe * this.breiteJeHoehe;
    this.figur.scale.setScalar(this.hoehe / this._rohHoehe);

    this.reset();
  }

  get object3D() {
    return this.root;
  }

  /** @param {number} hoehe World-Units */
  groesseSetzen(hoehe) {
    this.hoehe = hoehe;
    this.breite = hoehe * this.breiteJeHoehe;
    // Über die gemessene Rohhöhe — siehe Normierung im Konstruktor.
    this.figur.scale.setScalar(hoehe / this._rohHoehe);
  }

  reset() {
    this.x = 0;
    this.y = this.cfg.adlerY;
    this.vx = 0;
    this.lebt = true;
    this.treffer = 0;
    this.pause = 0;

    this._schlag = 0;
    this._kackFortschritt = null;
    this._hatGekackt = false;
    this._zielX = 0;
    this._verweil = 0;
    this._zielFrist = 0;
    this._neigung = 0;

    this.root.position.set(this.x, this.y, 0);
    this.root.visible = true;
    this.root.rotation.set(0, 0, 0);
    this.figur.rotation.set(0, 0, 0);
  }

  /**
   * Neues Ziel wählen — er fliegt BAHNEN an, keine Zufallspunkte.
   *
   * Seine Kacke wird auf die nächstgelegene Bahn gelegt; steuerte er
   * stufenlose Punkte an, käme sie fast nur in der Mitte herunter (gemessen
   * 8/26/16/4 auf die vier Bahnen).
   */
  _neuesZiel(minX, maxX, bahnen) {
    const a = this.cfg.adler;
    let ziel = this._zielX;

    if (bahnen?.length > 1) {
      let kandidaten = bahnen.filter((x) => Math.abs(x - this._zielX) > 0.01);
      if (kandidaten.length === 0) kandidaten = bahnen;
      ziel = kandidaten[Math.floor(Math.random() * kandidaten.length)];
    } else {
      const spanne = maxX - minX;
      for (let i = 0; i < 8; i++) {
        ziel = minX + Math.random() * spanne;
        if (Math.abs(ziel - this._zielX) >= spanne * a.minSprung) break;
      }
    }

    this._zielX = ziel;
    this._verweil = a.zielWechsel.min + Math.random() * (a.zielWechsel.max - a.zielWechsel.min);
    this._zielFrist = 3.5;
  }

  /** Ist er nah genug an der Bahn, die er anfliegt? */
  beiZiel(toleranz) {
    return Math.abs(this.x - this._zielX) <= toleranz;
  }

  /**
   * @param {number} dt
   * @param {number} minX
   * @param {number} maxX
   * @param {number[]} [bahnen]
   * @returns {'kacke'|null}
   */
  update(dt, minX, maxX, bahnen) {
    const a = this.cfg.adler;

    /* --- Ziel und seitliche Bewegung ---------------------------------- *
     * Erst ankommen, dann das nächste Ziel — sonst pendelt er um die Mitte,
     * weil er die andere Feldseite nie erreicht. */
    const da = Math.abs(this._zielX - this.x) <= 0.12;
    if (da) this._verweil -= dt;
    this._zielFrist -= dt;
    if ((da && this._verweil <= 0) || this._zielFrist <= 0) {
      this._neuesZiel(minX, maxX, bahnen);
    }

    const zielV = Math.max(-a.tempo, Math.min(a.tempo, (this._zielX - this.x) * 2.4));
    this.vx += (zielV - this.vx) * (1 - Math.exp(-a.beschleunigung * dt));
    this.x += this.vx * dt;
    if (this.x < minX) {
      this.x = minX;
      this.vx = 0;
    } else if (this.x > maxX) {
      this.x = maxX;
      this.vx = 0;
    }
    this.root.position.x = this.x;

    /* IN DIE KURVE LEGEN. Ein Vogel, der zur Seite fliegt, kippt in die
     * Richtung. Ohne das schiebt er sich flach über den Bildschirm. */
    const zielNeigung = Math.max(-0.42, Math.min(0.42, -this.vx * 0.12));
    this._neigung += (zielNeigung - this._neigung) * (1 - Math.exp(-6 * dt));
    this.figur.rotation.z = this._neigung;
    this.figur.rotation.y = this._neigung * 0.55;

    if (this.pause > 0) {
      this.pause -= dt;
      this.root.visible = Math.sin(this.pause * 40) > -0.3;
      if (this.pause <= 0) this.root.visible = true;
    }

    /* --- Angriff ------------------------------------------------------- */
    let ereignis = null;
    let kackPose = 0; // 0..1, wie weit er in der Kackhaltung ist
    if (this._kackFortschritt !== null) {
      this._kackFortschritt += dt / this.cfg.kacke.dauer;

      if (!this._hatGekackt && this._kackFortschritt >= this.cfg.kacke.loslassenBei) {
        this._hatGekackt = true;
        ereignis = 'kacke';
      }
      if (this._kackFortschritt >= 1) {
        this._kackFortschritt = null;
        this._hatGekackt = false;
      } else {
        // Anspannen bis zum Loslassen, danach schnell wieder lösen.
        const p = this._kackFortschritt / this.cfg.kacke.loslassenBei;
        kackPose =
          p <= 1 ? p : Math.max(0, 1 - (this._kackFortschritt - this.cfg.kacke.loslassenBei) * 6);
      }
    }

    this._animieren(dt, kackPose);
    return ereignis;
  }

  /**
   * Flügelschlag, Körperbewegung, Kackhaltung.
   *
   * @param {number} dt
   * @param {number} kackPose 0 = fliegt normal, 1 = Krallen ganz angezogen
   */
  _animieren(dt, kackPose) {
    const a = this.cfg.adler;

    /* Beim Kacken schlägt er schneller: er muss auf der Stelle stehen
     * bleiben, und das kostet einen Vogel mehr Kraft, nicht weniger. */
    const takt = a.flugZyklus * (1 + kackPose * 0.55);
    this._schlag += takt * Math.PI * 2 * dt;
    if (this._schlag > Math.PI * 2) this._schlag -= Math.PI * 2;

    const s = Math.sin(this._schlag);
    // Der Aussenflügel hinkt nach — daher die Phasenverschiebung.
    const sHand = Math.sin(this._schlag - a.nachlauf);

    for (const { gruppe } of this.schultern) {
      /* Der Aufschlag geht weiter über den Rücken, als der Abschlag unter
       * den Bauch reicht. Mit gleichen Werten sähe es aus wie ein
       * Scheibenwischer.
       *
       * Das Vorzeichen braucht KEINE Seitenunterscheidung: die linke
       * Schulter ist über scale.x = -1 gespiegelt, eine Drehung um z dreht
       * dort also von selbst in die andere Richtung. */
      gruppe.rotation.z = s > 0 ? s * a.schlagAuf : s * a.schlagAb;
      // Beim Abschlag zieht er die Flügel leicht nach vorn.
      gruppe.rotation.y = -s * 0.16;
    }

    for (const { gruppe } of this.haende) {
      gruppe.rotation.z = sHand > 0 ? sHand * a.schlagAuf * 0.7 : sHand * a.schlagAb * 0.85;
      // Anstellwinkel: beim Hochziehen stellt er die Handschwingen schmal.
      gruppe.rotation.x = sHand * 0.55;
    }

    /* Körper: hebt sich beim Abschlag, sinkt beim Aufschlag — gegenläufig
     * zu den Flügeln, sonst wirkt er schwerelos. */
    this.koerper.position.y = -s * 0.02;
    this.figur.rotation.x = -s * 0.07 + kackPose * 0.3;

    // Der Kopf bleibt ruhiger als der Rumpf (Vögel stabilisieren ihn) und
    // schaut beim Kacken nach unten.
    this.kopf.rotation.x = s * 0.05 + kackPose * 0.55;

    // Schwanz: wippt im Takt, fächert beim Kacken auf.
    this.schwanz.rotation.x = -s * 0.12 - kackPose * 0.45;
    this.schwanz.scale.x = 1 + kackPose * 0.4;

    // Krallen: im Flug angezogen, beim Kacken erst zusammen, dann geöffnet.
    this.krallen.rotation.x = -1.0 + kackPose * 1.35;
    this.krallen.scale.setScalar(1 - kackPose * 0.25);
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
    // Geometrien und Materialien sind geteilt und bleiben stehen.
  }
}
