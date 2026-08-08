/**
 * Der angekündigte Schnellangriff.
 *
 *   WARNUNG   Über ein bis drei Bahnen blinkt oben ein rotes Schild.
 *   STURZ     Genau dort schiessen Vögel herunter, viermal so schnell wie
 *             alles andere im Spiel.
 *   AUS       Kurze Pause, dann läuft der normale Strom weiter.
 *
 * ZWEI ZUSAGEN, DIE NICHT VERHANDELBAR SIND
 *
 * 1. NIE ALLE BAHNEN. Bei vier Bahnen sind höchstens drei bedroht. Ohne
 *    diese Regel wäre der Angriff nicht schwer, sondern unfair — es gäbe
 *    keinen Ort, an den man ausweichen kann.
 *
 * 2. WÄHREND DES ANGRIFFS FÄLLT SONST NICHTS. Der Spieler soll die
 *    Warnung lesen und die Bahn wechseln können, ohne dabei in einen
 *    normalen Stein zu laufen. Bereits fallende Objekte laufen aus — sie
 *    verschwinden zu lassen sähe nach Fehler aus.
 *
 * WARUM DIE VÖGEL KEINE GARANTIE ÜBER DEN KORRIDOR BRAUCHEN
 * Der Korridor (siehe Korridor.js) sichert zu, dass im normalen Strom immer
 * eine erreichbare Lücke bleibt. Hier ist die Lücke direkt gebaut: die
 * freie Bahn ist bekannt, sie steht schon beim Erscheinen der Warnung fest,
 * und sie ändert sich bis zum Ende des Angriffs nicht mehr.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { Pool } from '../entities/Pool.js';
import { circleOverlap } from './CollisionSystem.js';

export const SturzPhase = {
  AUS: 'aus',
  WARNUNG: 'warnung',
  STURZ: 'sturz',
};

/** Ein herabschiessender Vogel. Fällt senkrecht, wie alles andere auch. */
class Sturzvogel {
  constructor(cfg, texturen) {
    this.cfg = cfg;
    this._texturen = texturen;

    const erste = texturen[0];
    const bild = erste?.image;
    const aspect = bild && bild.height ? bild.width / bild.height : 0.4;

    this.material = new MeshBasicMaterial({
      map: erste ?? null,
      transparent: true,
      alphaTest: 0.03,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(cfg.vogelHoehe * aspect, cfg.vogelHoehe), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.position.z = 0.28;

    this.x = 0;
    this.y = 0;
    this.hitRadius = cfg.hitRadius;
    this.active = false;
  }

  spawn(x, y) {
    // Zufällige Art — die drei sehen verschieden aus, sind aber dieselbe
    // Gefahr (alle auf gleiche Höhe gebracht, siehe prepare-sturzflug.mjs).
    const tex = this._texturen[Math.floor(Math.random() * this._texturen.length)];
    if (tex && tex !== this.material.map) {
      this.material.map = tex;
      this.material.needsUpdate = true;
    }
    this.x = x;
    this.y = y;
    this.mesh.position.set(x, y, 0.28);
    this.mesh.visible = true;
    this.active = true;
  }

  update(dt) {
    this.y -= this.cfg.tempo * dt;
    this.mesh.position.y = this.y;
  }

  despawn() {
    this.active = false;
    this.mesh.visible = false;
  }
}

export class Sturzflug {
  /**
   * @param {import('three').Scene} scene
   * @param {typeof import('../config.js').CONFIG.sturzflug} cfg
   * @param {{voegel: import('three').Texture[], warnung: import('three').Texture|null}} bilder
   * @param {{onTreffer: Function, onEnde: Function, klang: object}} umgebung
   */
  constructor(scene, cfg, bilder, umgebung) {
    this.cfg = cfg;
    this.onTreffer = umgebung.onTreffer ?? (() => {});
    this.onEnde = umgebung.onEnde ?? (() => {});
    this.klang = umgebung.klang;

    this.phase = SturzPhase.AUS;
    this._uhr = 0;
    this._warnzeit = cfg.warnung.sekunden;
    this._bahnen = [];

    this.voegel = new Pool(cfg.poolSize, () => {
      const v = new Sturzvogel(cfg, bilder.voegel.filter(Boolean));
      scene.add(v.mesh);
      return v;
    });

    /* Warnschilder: eines je möglicher Bahn, damit im Angriff nichts
     * erzeugt werden muss. Es gibt nie mehr als `maxBahnen` gleichzeitig. */
    const wBild = bilder.warnung;
    const wAspect = wBild?.image?.height ? wBild.image.width / wBild.image.height : 0.72;
    this._schilder = [];
    for (let i = 0; i < cfg.maxBahnen; i++) {
      const m = new Mesh(
        new PlaneGeometry(cfg.warnung.hoehe * wAspect, cfg.warnung.hoehe),
        new MeshBasicMaterial({
          map: wBild ?? null,
          transparent: true,
          alphaTest: 0.03,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      m.frustumCulled = false;
      m.visible = false;
      m.position.z = 0.4;
      scene.add(m);
      this._schilder.push(m);
    }
  }

  get aktiv() {
    return this.phase !== SturzPhase.AUS;
  }

  /**
   * Welche Bahnen werden bedroht?
   *
   * Höchstens `maxBahnen`, UND immer mindestens eine frei — der kleinere
   * der beiden Werte gewinnt. Bei vier Bahnen und maxBahnen 3 sind das
   * drei; bei drei Bahnen wären es zwei.
   *
   * @param {number[]} bahnX
   * @param {number} staerke 0..1 — wie hart es sein soll (steigt mit dem Gebiet)
   */
  _bahnenWaehlen(bahnX, staerke) {
    const erlaubt = Math.min(this.cfg.maxBahnen, Math.max(1, bahnX.length - 1));

    /* WIE VIELE BAHNEN — gewürfelt, nicht gestaffelt.
     *
     * Hier stand `1 + floor(staerke * erlaubt)`. Bei zwei erlaubten Bahnen
     * heisst das: bis Stärke 0.5 immer EINE, danach immer ZWEI. Ab der Mitte
     * des Spiels sah damit jeder Angriff gleich aus.
     *
     * Verlangt ist Abwechslung — mal links, mal rechts, mal zwei auf einmal.
     * Die Zahl wird deshalb gewürfelt, und die Stärke verschiebt nur die
     * Wahrscheinlichkeit. Die Untergrenze bleibt eine Bahn, die Obergrenze
     * `erlaubt` — die Zusage "eine Bahn bleibt frei" gilt unverändert, sie
     * steckt in `erlaubt`.
     *
     * Der Faktor deckelt die Wahrscheinlichkeit bei der Hälfte. Ohne ihn ist
     * sie beim Deckel genau 1, und `Math.random() < 1` trifft immer — spät
     * wäre dann JEDER Angriff zweispurig, gemessen 100 Prozent ab Gebiet 8.
     * Zwei Schilder auf einmal sollen die Ausnahme bleiben, sonst sind sie
     * keine Steigerung mehr, sondern der Normalfall. */
    const ZWEITE_BAHN = 0.5;
    let anzahl = 1;
    for (let i = 1; i < erlaubt; i++) {
      if (Math.random() < staerke * ZWEITE_BAHN) anzahl++;
    }

    const misch = bahnX.slice();
    for (let i = misch.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [misch[i], misch[j]] = [misch[j], misch[i]];
    }
    return misch.slice(0, anzahl);
  }

  /**
   * Wie lange muss die Warnung stehen, damit man es SCHAFFT?
   *
   * "Eine Bahn bleibt frei" ist nur die halbe Zusage. Die zweite Hälfte:
   * man muss dort auch ankommen. Nachgerechnet fürs Querformat — die Bahnen
   * liegen bei ±4.77 und ±1.59, der Weg von ganz aussen zur einzig freien
   * Bahn am anderen Ende ist 9.54 Einheiten. Bei einer Laufgeschwindigkeit
   * von 8.4 sind das 1.14 s. Die feste Warnzeit von 1.15 s hätte davon
   * 0.01 s übrig gelassen.
   *
   * Deshalb wird sie hier AUSGERECHNET statt gesetzt: der weiteste Weg zur
   * nächstgelegenen freien Bahn, geteilt durch das Tempo des Affen, plus
   * die Fallzeit der Vögel (die zählt mit — sie sind noch nicht unten,
   * wenn sie erscheinen) und eine Reserve für die Trägheit. Die Zahl aus
   * der Config ist die UNTERGRENZE, nicht der Wert.
   *
   * @param {number[]} bahnen
   * @param {{bounds:{minY:number}, spawnY:number}} world
   * @param {number} tempoAffe
   */
  _warnzeitBerechnen(bahnen, world, tempoAffe) {
    const frei = bahnen.filter((x) => !this._bahnen.includes(x));
    if (frei.length === 0) return this.cfg.warnung.sekunden;

    let weitester = 0;
    for (const von of bahnen) {
      let naechste = Infinity;
      for (const zu of frei) naechste = Math.min(naechste, Math.abs(zu - von));
      weitester = Math.max(weitester, naechste);
    }

    // Fallzeit bis auf Spielerhöhe — so lange darf er noch unterwegs sein.
    const fallweg = world.spawnY - (world.bounds.minY + 1.5);
    const fallzeit = fallweg / Math.max(1, this.cfg.tempo);

    const noetig = weitester / Math.max(1, tempoAffe) + 0.25 - fallzeit;
    return Math.max(this.cfg.warnung.sekunden, noetig);
  }

  /**
   * Angriff beginnen.
   *
   * @param {{bounds:{maxY:number}, bahnX:number[], spawnY:number}} world
   * @param {number} staerke 0..1
   * @param {number} tempoAffe Laufgeschwindigkeit des gewählten Affen
   * @returns {boolean}
   */
  starten(world, staerke = 0, tempoAffe = 8.4) {
    if (this.aktiv) return false;
    const bahnen = world.bahnX;
    if (!bahnen?.length) return false;

    this._bahnen = this._bahnenWaehlen(bahnen, staerke);
    this._warnzeit = this._warnzeitBerechnen(bahnen, world, tempoAffe);
    this.phase = SturzPhase.WARNUNG;
    this._uhr = 0;

    // Schilder oben über die bedrohten Bahnen setzen.
    const y = world.bounds.maxY - this.cfg.warnung.hoehe * 0.55;
    this._schilder.forEach((m, i) => {
      const x = this._bahnen[i];
      m.visible = x !== undefined;
      if (x !== undefined) m.position.set(x, y, 0.4);
    });

    this.klang?.effekt?.('warnung');
    return true;
  }

  /** Sofort abräumen (Tod, Menü, neuer Lauf). */
  abbrechen() {
    if (!this.aktiv) return;
    this.phase = SturzPhase.AUS;
    this.voegel.releaseAll((v) => v.despawn());
    for (const m of this._schilder) m.visible = false;
    this._bahnen = [];
  }

  /**
   * @param {number} dt
   * @param {object} player
   * @param {{bounds:{minY:number}, spawnY:number}} world
   */
  update(dt, player, world) {
    if (!this.aktiv) return;
    this._uhr += dt;

    if (this.phase === SturzPhase.WARNUNG) {
      // Blinken: gut sichtbar, ohne die Sicht auf das Feld zu nehmen.
      const an = Math.sin(this._uhr * this.cfg.warnung.blinkProSekunde * Math.PI * 2) > -0.35;
      for (let i = 0; i < this._schilder.length; i++) {
        if (this._bahnen[i] !== undefined) this._schilder[i].visible = an;
      }

      if (this._uhr >= this._warnzeit) {
        for (const m of this._schilder) m.visible = false;
        for (const x of this._bahnen) {
          const v = this.voegel.acquire();
          if (v) v.spawn(x, world.spawnY);
        }
        this.klang?.effekt?.('sturz');
        this.phase = SturzPhase.STURZ;
        this._uhr = 0;
      }
      return;
    }

    /* --- Sturz --------------------------------------------------------- */
    const px = player.hitX;
    const py = player.hitY;
    const pr = player.hitRadius;
    const verwundbar = player.alive && !player.isInvulnerable;
    const untenRaus = world.bounds.minY - 2.0;

    for (let i = this.voegel.active.length - 1; i >= 0; i--) {
      const v = this.voegel.active[i];
      if (!v.active) continue;
      v.update(dt);

      if (v.y < untenRaus) {
        v.despawn();
        this.voegel.release(v);
        continue;
      }

      /* Der oranger Affe prallt an kleinen STEINEN ab — an einem Vogel im
       * Sturzflug nicht. Seine Fähigkeit heisst "hält was aus, was vom Berg
       * fällt", nicht "immun gegen alles". */
      if (verwundbar && circleOverlap(px, py, pr, v.x, v.y, v.hitRadius)) {
        v.despawn();
        this.voegel.release(v);
        this.onTreffer();
        return; // ein Treffer je Frame genügt
      }
    }

    if (this.voegel.activeCount === 0 && this._uhr >= this.cfg.nachlauf) {
      this.phase = SturzPhase.AUS;
      this._bahnen = [];
      this.onEnde();
    }
  }
}
