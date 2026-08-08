/**
 * Fallendes Objekt — ein Treffer beendet das Spiel (sofern keine
 * Wiederbelebung gebunkert ist).
 *
 * ZWEI DINGE ENTSCHEIDEN, WIE EIN OBJEKT AUSSIEHT UND WIRKT
 *
 *   Grössenklasse (CONFIG.rock.types)   klein / mittel / gross
 *     Radius, Trefferkreis und Fallverhalten. Gilt an JEDER Wand gleich.
 *
 *   Look (CONFIG.rock.looks)            was gerade vom Himmel kommt
 *     Bild bzw. Form und Farbe. Wechselt mit der Hintergrundstufe.
 *
 * Beides wird erst beim spawn() zusammengesetzt — eine Pool-Instanz ist im
 * Laufe eines Spiels mal ein kleiner Stein, mal ein grosser Geist. Geometrie
 * und Material liegen deshalb NICHT beim einzelnen Objekt, sondern werden je
 * Kombination einmal angelegt und beim Spawnen zugewiesen.
 *
 * WARUM RADIUS UND LOOK GETRENNT BLEIBEN
 * Der Look tauscht nur das Aussehen. Radius und Trefferkreis kommen immer aus
 * der Grössenklasse. Im Spätspiel bleiben rund 0.24 s zum Reagieren — da muss
 * "klein" überall dasselbe bedeuten, sonst weiss der Spieler nicht mehr, was
 * ihn umbringt, und die Fähigkeit des orangen Affen ("überlebt die kleinen")
 * wäre an jeder Wand eine andere.
 *
 * Kollision läuft als 2D-Kreis in der Wandebene — keine 3D-Physik.
 */
import {
  ConeGeometry,
  DodecahedronGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
} from 'three';

/** Radius 1 — die tatsächliche Grösse macht mesh.scale. */
function baueGeometrie(form, detail) {
  switch (form) {
    case 'oktaeder':
      return new OctahedronGeometry(1, detail);
    case 'dodekaeder':
      return new DodecahedronGeometry(1, detail);
    case 'kugel':
      return new SphereGeometry(1, 14, 10);
    case 'kegel':
      // Spitze nach UNTEN: fallende Zapfen sollen mit der Spitze voran kommen.
      return new ConeGeometry(1, 2.2, 10).rotateX(Math.PI);
    case 'ikosaeder':
    default:
      return new IcosahedronGeometry(1, detail);
  }
}

/**
 * Alles Geteilte je (Look, Grössenklasse) — einmal für alle Objekte.
 *
 * @type {Map<string, {
 *   geometry: object,
 *   material: object,
 *   sprite: boolean,
 *   aspect: number,
 * }>}
 */
let geteilt = null;
/** Eine einzige Plane für ALLE Sprites; die Grösse macht mesh.scale. */
let spriteGeometrie = null;

/**
 * @param {typeof import('../config.js').CONFIG.rock} cfg
 * @param {Map<string, import('three').Texture>|null} texturen
 *   Vorgeladene Sprites, verschlüsselt nach dem Pfad aus cfg.spritePath.
 *   Fehlt die Map (oder ein einzelnes Bild darin), fällt der betroffene
 *   Eintrag auf den prozeduralen Körper zurück.
 */
function getShared(cfg, texturen) {
  if (geteilt) return geteilt;
  geteilt = new Map();
  spriteGeometrie = new PlaneGeometry(1, 1);

  for (const [lookId, look] of Object.entries(cfg.looks)) {
    cfg.types.forEach((t, i) => {
      const bildName = look.bilder?.[i] ?? null;
      const tex = bildName ? texturen?.get(spritePfad(cfg, bildName)) : null;

      if (tex) {
        /* Sprites bekommen MeshBasicMaterial: die Bilder sind bereits
         * beleuchtet. Ein zweites Mal von der Szene beleuchtet würde die
         * Glut dunkel und den Geist grau. */
        geteilt.set(`${lookId}/${t.id}`, {
          geometry: spriteGeometrie,
          material: new MeshBasicMaterial({
            map: tex,
            transparent: true,
            // Fast durchsichtige Randpixel gar nicht erst zeichnen — das
            // spart den Sortieraufwand bei überlappenden Objekten.
            alphaTest: 0.03,
            depthWrite: false,
            side: DoubleSide,
            toneMapped: false,
          }),
          sprite: true,
          // Seitenverhältnis der Datei. Es bestimmt die Form des Sprites —
          // deshalb wird `strecken` bei Bildern nicht angewandt.
          aspect: (tex.image?.width ?? 1) / (tex.image?.height ?? 1),
        });
        return;
      }

      // Nur meckern, wenn überhaupt Bilder mitgegeben wurden. Ohne Bildersatz
      // (Fairness-Prüfung, Tests) ist der prozedurale Pfad kein Fehler,
      // sondern der Zweck.
      if (bildName && texturen) {
        console.warn(
          `[Rock] Bild fehlt: ${spritePfad(cfg, bildName)} — ` +
            `${lookId}/${t.id} wird prozedural gebaut.`,
        );
      }

      const farbe = look.farben?.[i] ?? look.farben?.[look.farben.length - 1] ?? 0x808080;
      const glanz = look.glanz ?? 0;
      const leuchten = look.leuchten ?? 0;

      geteilt.set(`${lookId}/${t.id}`, {
        geometry: baueGeometrie(look.form, t.detail ?? 0),
        material: new MeshStandardMaterial({
          color: farbe,
          roughness: 0.94 - glanz * 0.7,
          metalness: 0.02 + glanz * 0.25,
          // Eigenleuchten macht ein prozedurales Objekt auch vor dunklen Wänden
          // sichtbar — dort reicht das Szenenlicht nicht.
          emissive: leuchten > 0 ? farbe : 0x000000,
          emissiveIntensity: leuchten,
          flatShading: look.form !== 'kugel',
        }),
        sprite: false,
        aspect: 1,
      });
    });
  }
  return geteilt;
}

function spritePfad(cfg, name) {
  return cfg.spritePath.replace('{n}', name);
}

/**
 * Wie hoch ein Objekt dieser Art im Bild wird.
 *
 * Der Spawner braucht das VOR dem Abwurf: er muss wissen, wieviel senkrechten
 * Abstand er halten muss, damit zwei Objekte nicht übereinanderliegen. Eine
 * feste Zahl reicht dafür nicht — ein Eiszapfen ist 2.45 Einheiten hoch, ein
 * Stein knapp 1.0. Mit einem gemeinsamen Wert wäre entweder der Zapfen zu
 * dicht am Vordermann oder der Stein unnötig weit weg.
 *
 * Dieselbe Rechnung wie in spawn(), damit beide nicht auseinanderlaufen
 * können.
 */
export function spriteHoehe(cfg, lookId, type) {
  const geteiltJetzt = geteilt;
  const look = cfg.looks[lookId] ?? cfg.looks.stein;
  const d = 2 * type.radius * (cfg.spriteScale ?? 1) * (look.bildScale ?? 1);
  const s = geteiltJetzt?.get(`${lookId}/${type.id}`);
  if (!s || !s.sprite) {
    // Prozedural: `strecken` verzerrt nur die Darstellung.
    const st = look.strecken;
    return st ? 2 * type.radius * st[1] : 2 * type.radius;
  }
  return d / Math.sqrt(s.aspect);
}

/**
 * Wie breit wird das BREITESTE Objekt, das überhaupt vorkommen kann?
 *
 * Gebraucht von Game._updateWorldBounds: das Spielfeld hört dort auf, wo
 * sonst etwas aus dem Bild ragen würde. Für den Affen ist das seine halbe
 * Bildbreite — für die Objekte muss dieselbe Frage gestellt werden, sonst
 * hängt auf der äussersten Bahn ein grosser Brocken halb draussen.
 * Gemessen war das der Feuerball ("feuer/gross", 1.788 breit gegen 1.403
 * beim Affen): er ragte 0.192 Einheiten über den Rand.
 *
 * Dieselbe Rechnung wie in spawn(), damit beide nicht auseinanderlaufen.
 * Ohne geladene Bilder (Fairness-Prüfung, Tests) wird über `strecken`
 * geschätzt — dort gibt es keine Bildschirmkante, an der etwas abschneiden
 * könnte.
 */
export function groessteSpriteBreite(cfg) {
  let max = 0;
  for (const [lookId, look] of Object.entries(cfg.looks)) {
    cfg.types.forEach((t, i) => {
      const s = geteilt?.get(`${lookId}/${t.id}`);
      let breite;
      if (s?.sprite) {
        const d = 2 * t.radius * (cfg.spriteScale ?? 1) * (look.bildScale ?? 1);
        breite = d * Math.sqrt(s.aspect);
      } else {
        const st = look.strecken;
        breite = st ? 2 * t.radius * st[0] : 2 * t.radius;
      }
      if (breite > max) max = breite;
    });
  }
  return max;
}

/** Alle Sprite-Pfade, die diese Config braucht — für das Vorladen. */
export function hazardSpriteUrls(cfg) {
  const urls = new Set();
  for (const look of Object.values(cfg.looks)) {
    for (const name of look.bilder ?? []) {
      if (name) urls.add(spritePfad(cfg, name));
    }
  }
  return [...urls];
}

/** Nur für Tests: erzwingt beim nächsten Rock() einen Neuaufbau. */
export function _resetSharedRockAssets() {
  geteilt = null;
  spriteGeometrie = null;
}

export class Rock {
  /**
   * @param {number} _index
   * @param {typeof import('../config.js').CONFIG.rock} cfg
   * @param {Map<string, import('three').Texture>|null} texturen vorgeladene Sprites
   */
  constructor(_index, cfg, texturen = null) {
    this.cfg = cfg;
    this._shared = getShared(cfg, texturen);

    const first = cfg.types[0];
    const s = this._shared.get(`stein/${first.id}`);
    this.mesh = new Mesh(s.geometry, s.material);
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;

    // Zustand
    this.x = 0;
    this.y = 0;
    this.type = first;
    this.lookId = 'stein';
    this.radius = first.radius;
    this.hitRadius = this.radius * cfg.hitRadiusFactor;
    this.fallFactor = first.fallFactor ?? 1;
    this.sprite = false;
    // Prozedural: Drehgeschwindigkeit. Sprite: Amplitude und Takt des Kippens.
    this.spinX = 0;
    this.spinZ = 0;
    this.taumelAmp = 0;
    this.taumelPhase = 0;
    this.active = false;
  }

  /**
   * @param {object} type     Grössenklasse aus CONFIG.rock.types
   * @param {string} lookId   Aussehen aus CONFIG.rock.looks (Wand bestimmt es)
   * @param {number} x        Startposition in der Wandebene
   * @param {number} y
   * @param {number} rand01a  vorberechnete Zufallswerte (keine Allokation)
   * @param {number} rand01b
   * @param {number} rand01c
   */
  spawn(type, lookId, x, y, rand01a, rand01b, rand01c) {
    const cfg = this.cfg;
    const look = cfg.looks[lookId] ?? cfg.looks.stein;
    const slot = cfg.types.indexOf(type);
    const i = slot < 0 ? 0 : slot;

    this.type = type;
    this.lookId = lookId;
    // Radius und Trefferkreis kommen IMMER aus der Grössenklasse, nie aus dem
    // Look — siehe Kopfkommentar.
    this.radius = type.radius;
    this.hitRadius = this.radius * cfg.hitRadiusFactor;

    // Feinjustierung: je Grössenklasse schlägt den Look-weiten Wert.
    const fallMul = look.fallMulSlots?.[i] ?? look.fallMul ?? 1;
    const spinMul = look.spinMulSlots?.[i] ?? look.spinMul ?? 1;
    this.fallFactor = (type.fallFactor ?? 1) * fallMul;

    // Aussehen zuweisen. Nur beim Spawnen, nicht im Frame-Loop.
    const s = this._shared.get(`${lookId}/${type.id}`) ?? this._shared.get(`stein/${type.id}`);
    this.mesh.geometry = s.geometry;
    this.mesh.material = s.material;
    this.sprite = s.sprite;

    const spin = type.spin;

    this.x = x;
    this.y = y;

    if (s.sprite) {
      /* --- Bild ---------------------------------------------------------
       * Grösse über die FLÄCHE, nicht über eine der beiden Kanten:
       *   sqrt(Breite * Höhe) = 2 * radius * spriteScale * bildScale
       * Ein Eiszapfen bleibt so lang und dünn, eine Kokosnuss rund — und
       * beide wirken trotzdem gleich schwer. Über eine feste Kante gerechnet
       * wäre der Zapfen entweder fadendünn oder bildschirmhoch.
       *
       * Sprites DREHEN sich nicht, sie kippen nur hin und her. Ein Kürbis
       * mit Gesicht, der sich überschlägt, sieht nach Fehler aus. */
      const d = 2 * this.radius * (cfg.spriteScale ?? 1) * (look.bildScale ?? 1);
      const wurzel = Math.sqrt(s.aspect);
      this.mesh.scale.set(d * wurzel, d / wurzel, 1);

      this.taumelAmp = ((look.taumeln ?? 0) * Math.PI) / 180;
      // Takt und Startwinkel streuen, damit ein Burst nicht im Gleichschritt
      // kippt.
      this.spinZ = (spin.min + (spin.max - spin.min) * rand01c) * spinMul * 0.5;
      this.taumelPhase = rand01a * 6.283;
      this.mesh.rotation.set(0, 0, Math.sin(this.taumelPhase) * this.taumelAmp);
    } else {
      /* --- Prozeduraler Körper ------------------------------------------
       * `strecken` verzerrt nur die DARSTELLUNG (lang und dünn statt rund) —
       * der Trefferkreis oben bleibt davon unberührt. */
      this.spinX = (spin.min + (spin.max - spin.min) * rand01b) * spinMul;
      this.spinZ = (spin.min + (spin.max - spin.min) * rand01c) * spinMul;
      this.taumelAmp = 0;

      const st = look.strecken;
      if (st) this.mesh.scale.set(this.radius * st[0], this.radius * st[1], this.radius * st[2]);
      else this.mesh.scale.setScalar(this.radius);
      this.mesh.rotation.set(rand01a * 6.283, rand01b * 6.283, rand01c * 6.283);
    }

    this.mesh.position.set(x, y, 0);
    this.mesh.visible = true;
    this.active = true;
  }

  /**
   * @param {number} dt
   * @param {number} fallSpeed Eigengeschwindigkeit + Scrollgeschwindigkeit.
   *   Der artabhängige Faktor wird HIER draufgerechnet, damit der Spawner nur
   *   eine Geschwindigkeit kennen muss.
   */
  update(dt, fallSpeed) {
    // NUR SENKRECHT. `x` bleibt das ganze Leben lang, wo es beim Spawnen war.
    //
    // Das ist keine Vereinfachung, sondern die Voraussetzung für die
    // Lücken-Garantie: sobald ein Objekt seitlich wandert, kann der Spawner
    // beim Abwurf nicht mehr wissen, wo es beim Spieler ankommt — und dann
    // lässt sich keine freie Bahn mehr zusichern, nur noch hoffen.
    this.y -= fallSpeed * this.fallFactor * dt;

    this.mesh.position.y = this.y;

    if (this.sprite) {
      this.taumelPhase += this.spinZ * dt;
      this.mesh.rotation.z = Math.sin(this.taumelPhase) * this.taumelAmp;
    } else {
      this.mesh.rotation.x += this.spinX * dt;
      this.mesh.rotation.z += this.spinZ * dt;
    }
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}
