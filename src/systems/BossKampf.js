/**
 * Der Bosskampf gegen den Adler.
 *
 * ABLAUF — vier Abschnitte, streng nacheinander:
 *
 *   WARNUNG   Das Schild blinkt, die Bossmusik setzt ein. Der Nachschub ist
 *             abgestellt; was noch fällt, fällt zu Ende und verlässt das
 *             Bild. Der Affe rutscht schon los.
 *   EINFLUG   Der Adler kommt von oben herein, der Affe sitzt unten am Rand.
 *             Noch schiesst keiner.
 *   KAMPF     Der Adler wandert unvorhersehbar und kackt; getroffen wird man
 *             wie von einem Stein. Auf Tipp/Klick wirft der Affe eine Banane
 *             senkrecht nach oben. Drei Treffer.
 *   ENDE      Der Adler kippt weg, die goldene Banane fliegt zum Affen, der
 *             Affe steigt wieder auf Normalhöhe, der Nachschub geht an.
 *
 * WARUM DAS EIN EIGENES SYSTEM IST
 * Während des Kampfes gelten andere Regeln als im Rest des Spiels: keine
 * Bahnen für die Gefahr, keine garantierte Lücke (siehe Korridor.js), eine
 * zweite Bildfolge für den Affen und ein Gegner mit Lebenspunkten. Das in
 * den Spawner zu falten hiesse, zwei Spiele in eine Schleife zu quetschen.
 *
 * Was NICHT hier drin steckt: was ein Treffer für den Affen bedeutet.
 * Wiederbelebung, Tod und Verzögerung bis zum Game Over gehören dem Spiel
 * und werden über `handlers.onTreffer` an Game zurückgegeben — sonst gäbe
 * es zwei Stellen, die entscheiden, wann jemand stirbt.
 */
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { Adler3D } from '../entities/Adler3D.js';
import { Kacke } from '../entities/Kacke.js';
import { Wurfbanane } from '../entities/Wurfbanane.js';
import { Pool } from '../entities/Pool.js';
import { circleOverlap } from './CollisionSystem.js';

export const BossPhase = {
  AUS: 'aus',
  WARNUNG: 'warnung',
  EINFLUG: 'einflug',
  KAMPF: 'kampf',
  ENDE: 'ende',
};

export class BossKampf {
  /**
   * @param {import('three').Scene} scene
   * @param {typeof import('../config.js').CONFIG.boss} cfg
   * @param {{
   *   flug: import('three').Texture[],
   *   kacken: import('three').Texture[],
   *   kacke: Map<string, import('three').Texture>,
   *   banane: import('three').Texture|null,
   *   goldBanane: import('three').Texture|null,
   * }} bilder
   * @param {{
   *   klang: object, ui: object, spawner: object,
   *   onTreffer: Function, onEnde: Function, onBelohnung: Function,
   * }} umgebung
   */
  constructor(scene, cfg, bilder, umgebung) {
    this.scene = scene;
    this.cfg = cfg;
    this.bilder = bilder;
    this.klang = umgebung.klang;
    this.ui = umgebung.ui;
    this.spawner = umgebung.spawner;
    this.onTreffer = umgebung.onTreffer ?? (() => {});
    this.onEnde = umgebung.onEnde ?? (() => {});
    this.onBelohnung = umgebung.onBelohnung ?? (() => {});

    this.phase = BossPhase.AUS;
    this._uhr = 0;

    this.adler = new Adler3D(cfg);
    this.adler.object3D.visible = false;
    scene.add(this.adler.object3D);

    this.kacke = new Pool(cfg.kacke.poolSize, (i) => {
      const k = new Kacke(i, cfg.kacke, bilder.kacke);
      scene.add(k.mesh);
      return k;
    });

    this.bananen = new Pool(cfg.wurf.poolSize, (i) => {
      const b = new Wurfbanane(i, cfg.wurf, bilder.banane);
      scene.add(b.mesh);
      return b;
    });

    /* Die goldene Banane. Ein einzelnes Objekt, kein Pool — es gibt nie
     * zwei davon. */
    this._goldBanane = null;
    if (bilder.goldBanane) {
      const bild = bilder.goldBanane.image;
      const aspect = bild && bild.height ? bild.width / bild.height : 0.85;
      const h = cfg.belohnung.hoehe;
      this._goldBanane = new Mesh(
        new PlaneGeometry(h * aspect, h),
        new MeshBasicMaterial({
          map: bilder.goldBanane,
          transparent: true,
          alphaTest: 0.03,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      this._goldBanane.frustumCulled = false;
      this._goldBanane.visible = false;
      this._goldBanane.position.z = 0.3;
      scene.add(this._goldBanane);
    }
    this._goldFlug = null; // {vonX, vonY, t}

    this._angriffUhr = 0;
    this._nachladen = 0;
  }

  get aktiv() {
    return this.phase !== BossPhase.AUS;
  }

  /** Kämpft der Adler gerade, oder ist er noch im Anflug bzw. schon tot? */
  get kaempft() {
    return this.phase === BossPhase.KAMPF;
  }

  /* ============================================================== Steuerung */

  /**
   * Kampf beginnen.
   *
   * @param {object} player wird auf Kampfhöhe geschickt
   * @param {{bounds:{minX:number,maxX:number}}} [world] Feld, an das der
   *   Adler in der Grösse angepasst wird
   */
  starten(player, world) {
    if (this.aktiv) return false;

    this.phase = BossPhase.WARNUNG;
    this._uhr = 0;

    /* GRÖSSE ANS FELD ANPASSEN.
     *
     * Der Adler ist 2.4 Einheiten hoch und damit 2.9 breit. Im Querformat
     * ist das Feld 9.9 breit — kein Problem. Im Hochformat sind es 3.2, und
     * sobald er die äussere Bahn anfliegt, hängen die Flügelspitzen 0.75
     * Einheiten über dem sichtbaren Rand.
     *
     * Ganz vermeiden lässt sich das nicht: er müsste dafür so schmal werden
     * wie der Affe, dann wäre er kein Boss mehr. Höchstens 62 % der
     * Feldbreite ist der Kompromiss — im Hochformat bleibt ein Überstand
     * von rund 0.28 Einheiten, was als "grosser Vogel" liest und nicht als
     * "abgeschnittenes Bild". */
    if (world) {
      const feldBreite = world.bounds.maxX - world.bounds.minX;
      const seite = this.adler.breiteJeHoehe ?? 1.2;
      const maxHoehe = (feldBreite * 0.62) / seite;
      this.adler.groesseSetzen(Math.min(this.cfg.adlerHoehe, maxHoehe));
    }

    this.adler.reset();
    // Über dem Bildrand parken; der Einflug holt ihn herunter.
    this.adler.y = this.cfg.adlerY + this.cfg.adlerHoehe * 2.2;
    this.adler.object3D.position.y = this.adler.y;
    this.adler.object3D.visible = false;

    /* Den Nachschub schaltet GAME ab, nicht dieses System.
     *
     * Es gibt inzwischen zwei Ereignisse, die den Bildschirm freiräumen —
     * den Bosskampf und den Sturzflug. Setzte jedes den Schalter selbst,
     * würde das eine ihn beim Aufräumen wieder einschalten, während das
     * andere noch läuft. Game.js rechnet ihn jeden Frame aus
     * (`nachschubAus = boss.aktiv || sturzflug.aktiv`); hier steht deshalb
     * nichts mehr. */

    // Der Affe rutscht sofort los, nicht erst wenn der Adler da ist: bis der
    // Kampf beginnt, soll er unten stehen.
    player.hoeheAnsteuern?.(this.cfg.affeY);

    this.ui.zeigeWarnung(true);
    this.klang.boss(true);
    return true;
  }

  /** Sofort abräumen (Tod, Menü, neuer Lauf). Ohne Belohnung. */
  abbrechen(player) {
    if (!this.aktiv) return;
    this.phase = BossPhase.AUS;
    this.adler.object3D.visible = false;
    this.kacke.releaseAll((k) => k.despawn());
    this.bananen.releaseAll((b) => b.despawn());
    if (this._goldBanane) this._goldBanane.visible = false;
    this._goldFlug = null;
    player?.hoeheAnsteuern?.(null);
    this.ui.zeigeWarnung(false);
    this.klang.boss(false);
  }

  /** Wurf auslösen (Tipp/Klick). Die Banane entsteht erst beim Loslassen. */
  wurfAnfordern(player) {
    if (this.phase !== BossPhase.KAMPF) return false;
    if (this._nachladen > 0) return false;
    if (!player.werfen?.()) return false;
    this._nachladen = this.cfg.wurf.dauer + this.cfg.wurf.nachladen;
    return true;
  }

  /** Die Banane verlässt die Hand — vom Spieler gemeldet (Ereignis 'wurf'). */
  bananeLoslassen(player) {
    if (this.phase !== BossPhase.KAMPF) return;
    const b = this.bananen.acquire();
    if (!b) return;
    // Etwas über der Bildmitte des Affen: sie kommt aus der Hand, nicht
    // aus den Füssen.
    b.spawn(player.x, player.y + (player.spriteHeight ?? 2.4) * 0.25);
    this.klang.effekt?.('wurf');
  }

  /* =================================================================== Loop */

  /**
   * @param {number} dt
   * @param {object} player
   * @param {{bounds:{minX:number,maxX:number,minY:number}}} world
   * @param {number} fallTempo Grundgeschwindigkeit für die Kacke
   */
  update(dt, player, world, fallTempo) {
    if (!this.aktiv) return;
    this._uhr += dt;
    this._nachladen = Math.max(0, this._nachladen - dt);

    /* SEIN MITTELPUNKT DARF DIE GANZE FELDBREITE ABFAHREN.
     *
     * Hier stand ein Rand von 0.3 Sprite-Breiten, damit die Flügel im Bild
     * bleiben. Gemessen im Hochformat: das Feld ist ±1.58 breit, der Adler
     * knapp 2.9 — der Rand hätte seinen Mittelpunkt auf ±0.71 eingesperrt,
     * während die äusseren Bahnen bei ±1.04 liegen. Die beiden Aussenbahnen
     * wären damit dauerhaft sicher gewesen, und der ganze Kampf hiesse
     * "stell dich nach links".
     *
     * Überstehende Flügelspitzen sind das kleinere Übel — es ist ein grosser
     * Vogel, und getroffen wird sowieso über den Körper, nicht die Federn. */
    const minX = world.bounds.minX;
    const maxX = world.bounds.maxX;

    switch (this.phase) {
      case BossPhase.WARNUNG:
        if (this._uhr >= this.cfg.warnungSekunden) {
          this.ui.zeigeWarnung(false);
          this.adler.object3D.visible = true;
          this.phase = BossPhase.EINFLUG;
          this._uhr = 0;
        }
        break;

      case BossPhase.EINFLUG: {
        const t = Math.min(1, this._uhr / this.cfg.einflugSekunden);
        // Weich abbremsen statt gleichmässig — er landet auf seiner Höhe,
        // er fällt nicht darauf.
        const weich = 1 - (1 - t) * (1 - t);
        const oben = this.cfg.adlerY + this.cfg.adlerHoehe * 2.2;
        this.adler.y = oben + (this.cfg.adlerY - oben) * weich;
        this.adler.object3D.position.y = this.adler.y;
        this.adler.update(dt, minX, maxX, world.bahnX);
        if (t >= 1) {
          this.phase = BossPhase.KAMPF;
          this._uhr = 0;
          this._angriffUhr = this.cfg.kacke.abstand.min;
        }
        break;
      }

      case BossPhase.KAMPF: {
        const ereignis = this.adler.update(dt, minX, maxX, world.bahnX);
        if (ereignis === 'kacke') this._kackeAbwerfen(world.bahnX);

        /* ER GREIFT AN, WENN ER ANGEKOMMEN IST — nicht unterwegs.
         *
         * Vorher lief nur eine Uhr, und wenn sie ablief, kackte er sofort,
         * auch mitten im Anflug. Weil der Haufen auf die nächstgelegene Bahn
         * gelegt wird, landete er dann auf einer Bahn, die er gerade nur
         * überquerte — gemessen kam die Kacke zu 63 % auf den beiden inneren
         * Bahnen herunter, obwohl er alle vier gleich oft ansteuert.
         *
         * Mit dieser Bedingung fällt sie dort, wo er hinwollte. Nebenbei
         * wird der Kampf lesbar: er fliegt sichtbar hin und lässt dann los,
         * statt im Vorbeiflug zu streuen.
         *
         * Kein Deadlock möglich: die Uhr bleibt abgelaufen und der Angriff
         * kommt im ersten Frame, in dem er nah genug ist. */
        this._angriffUhr -= dt;
        if (this._angriffUhr <= 0 && this.adler.beiZiel(this._zielToleranz(world))) {
          const a = this.cfg.kacke.abstand;
          this._angriffUhr = a.min + Math.random() * (a.max - a.min);
          this.adler.angreifen();
        }
        break;
      }

      case BossPhase.ENDE:
        this._endeSchritt(dt, player);
        break;
    }

    this._kackeSchritt(dt, player, world, fallTempo);
    this._bananenSchritt(dt, world);
  }

  /* --------------------------------------------------------------- Details */

  /**
   * @param {number[]} bahnen x-Positionen der Bahnen
   */
  _kackeAbwerfen(bahnen) {
    const k = this.kacke.acquire();
    if (!k) return;
    const arten = this.cfg.kacke.arten;
    const art = arten[Math.floor(Math.random() * arten.length)];

    /* AUF DIE NÄCHSTE BAHN, wie alles andere, was herunterkommt.
     *
     * Sonst fiele sie an einer stufenlosen Stelle — zwischen zwei Bahnen
     * kann der Affe nicht stehen, und dort ist sie entweder harmlos oder
     * (wenn sie eine Bahn streift) unfair, je nachdem wie der Adler gerade
     * schwebt. Beides ist Zufall statt Spiel. */
    const x = this._naechsteBahn(this.adler.x, bahnen);
    k.spawn(art, x, this.adler.y - this.adler.hoehe * 0.28);
  }

  _naechsteBahn(x, bahnen) {
    if (!bahnen?.length) return x;
    let beste = bahnen[0];
    for (const b of bahnen) if (Math.abs(b - x) < Math.abs(beste - x)) beste = b;
    return beste;
  }

  /**
   * Wie nah "angekommen" heisst: ein Drittel des Bahnabstands.
   *
   * Als Anteil und nicht als feste Zahl, weil der Abstand vom Format abhängt
   * — im Hochformat gut eine Einheit, im Querformat mehr als drei.
   */
  _zielToleranz(world) {
    const b = world.bahnX;
    if (!b || b.length < 2) return 0.3;
    return Math.abs(b[1] - b[0]) / 3;
  }

  _kackeSchritt(dt, player, world, fallTempo) {
    const px = player.hitX;
    const py = player.hitY;
    const pr = player.hitRadius;
    const untenRaus = world.bounds.minY - 1.5;
    const verwundbar = player.alive && !player.isInvulnerable;

    for (let i = this.kacke.active.length - 1; i >= 0; i--) {
      const k = this.kacke.active[i];
      if (!k.active) continue;
      k.update(dt, fallTempo);

      if (k.y < untenRaus) {
        k.despawn();
        this.kacke.release(k);
        continue;
      }

      /* Der oranger Affe prallt an kleinen STEINEN ab — an Kacke nicht.
       * Seine Fähigkeit ist "hält was aus, was vom Berg fällt", nicht
       * "immun gegen den Boss": sonst stünde er den halben Kampf einfach
       * unter dem Adler und wartete.
       *
       * Deshalb steht hier bewusst kein ignoreRockRadius. */
      if (verwundbar && circleOverlap(px, py, pr, k.x, k.y, k.hitRadius)) {
        k.despawn();
        this.kacke.release(k);
        this.onTreffer();
        return; // ein Treffer pro Frame genügt
      }
    }
  }

  _bananenSchritt(dt, world) {
    const obenRaus = Math.max(world.bounds.maxY, this.cfg.adlerY) + 2.5;
    const trefferbar = this.phase === BossPhase.KAMPF && this.adler.lebt;

    for (let i = this.bananen.active.length - 1; i >= 0; i--) {
      const b = this.bananen.active[i];
      if (!b.active) continue;
      b.update(dt);

      if (
        trefferbar &&
        circleOverlap(
          b.x,
          b.y,
          b.hitRadius,
          this.adler.x,
          this.adler.y,
          this.adler.hoehe * this.cfg.adlerTrefferAnteil,
        )
      ) {
        b.despawn();
        this.bananen.release(b);
        if (this.adler.trifft()) {
          this.klang.effekt?.('treffer');
          if (!this.adler.lebt) this._sterben();
        }
        continue;
      }

      if (b.y > obenRaus) {
        b.despawn();
        this.bananen.release(b);
      }
    }
  }

  _sterben() {
    this.phase = BossPhase.ENDE;
    this._uhr = 0;
    // Alles, was noch in der Luft hängt, gehört dem Kampf und geht mit ihm.
    this.kacke.releaseAll((k) => k.despawn());

    if (this._goldBanane) {
      this._goldBanane.position.set(this.adler.x, this.adler.y, 0.3);
      this._goldBanane.visible = true;
      this._goldFlug = { vonX: this.adler.x, vonY: this.adler.y, t: 0 };
    }
    this.klang.boss(false);
  }

  _endeSchritt(dt, player) {
    /* Der Adler kippt aus dem Bild. Kein Verpuffen: er ist ein Tier, er
     * fällt. */
    const a = this.adler;
    a.y -= 6.5 * dt;
    a.object3D.position.y = a.y;
    a.object3D.rotation.z += 3.2 * dt;
    a.object3D.visible = a.y > -14;

    if (!this._goldFlug) {
      // Ohne Belohnungsbild: nach kurzer Pause einfach aufräumen.
      if (this._uhr > 1.2) this._abschliessen(player);
      return;
    }

    const f = this._goldFlug;
    f.t = Math.min(1, f.t + dt / this.cfg.belohnung.flugSekunden);
    // Weich anfahren und weich ankommen.
    const w = f.t * f.t * (3 - 2 * f.t);
    const zielY = player.y + (player.spriteHeight ?? 2.4) * 0.2;
    this._goldBanane.position.set(
      f.vonX + (player.x - f.vonX) * w,
      f.vonY + (zielY - f.vonY) * w,
      0.3,
    );
    // Dreht sich im Flug und wird zum Schluss grösser — sie kommt an.
    this._goldBanane.rotation.z += 4 * dt;
    const s = 1 + 0.35 * Math.sin(w * Math.PI);
    this._goldBanane.scale.set(s, s, 1);

    if (f.t >= 1) {
      this._goldBanane.visible = false;
      this._goldFlug = null;
      this.onBelohnung();
      this._abschliessen(player);
    }
  }

  _abschliessen(player) {
    this.phase = BossPhase.AUS;
    this.adler.object3D.visible = false;
    this.adler.object3D.rotation.z = 0;
    this.bananen.releaseAll((b) => b.despawn());
    this.kacke.releaseAll((k) => k.despawn());
    player?.hoeheAnsteuern?.(null);
    this.onEnde();
  }
}
