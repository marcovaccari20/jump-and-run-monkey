/**
 * Der Bosskampf.
 *
 * ABLAUF — vier Abschnitte, streng nacheinander:
 *
 *   WARNUNG   Die Ansage steht, die Bossmusik setzt ein. Der Nachschub ist
 *             abgestellt; was noch fällt, fällt zu Ende und verlässt das
 *             Bild. Der Affe rutscht schon auf Kampfhöhe.
 *   EINFLUG   Der Boss kommt von oben herein, der Affe sitzt unten. Noch
 *             wirft keiner.
 *   KAMPF     Der Boss wandert quer und wirft Bananen; getroffen zu werden
 *             wirkt wie ein Stein. AUSSER seinen Würfen fällt nichts —
 *             keine Steine, keine Münzen, keine Sammelbananen. Auf
 *             Tipp/Leertaste wirft der Affe senkrecht nach oben, und zwar
 *             so oft er will: Bananen sind unbegrenzt. Drei Treffer.
 *   ENDE      Der Boss kippt weg, der Affe steigt wieder auf Normalhöhe,
 *             der Nachschub geht an, der Goldrausch beginnt.
 *
 * WARUM DAS EIN EIGENES SYSTEM IST
 * Während des Kampfes gelten andere Regeln als im Rest des Spiels: keine
 * Bahnen für die Gefahr, keine garantierte Lücke (siehe Korridor.js), eine
 * zweite Bildfolge für den Affen und ein Gegner mit Lebenspunkten. Das in
 * den Spawner zu falten hiesse, zwei Spiele in eine Schleife zu quetschen.
 *
 * Was NICHT hier drin steckt: was ein Treffer für den Affen bedeutet.
 * Wiederbelebung, Tod und Verzögerung bis zum Game Over gehören dem Spiel
 * und werden über `onTreffer` an Game zurückgegeben — sonst gäbe es zwei
 * Stellen, die entscheiden, wann jemand stirbt.
 */
import { Boss } from '../entities/Boss.js';
import { Bossbanane } from '../entities/Bossbanane.js';
import { Wurfbanane } from '../entities/Wurfbanane.js';
import { Pool } from '../entities/Pool.js';
import { circleOverlap } from './CollisionSystem.js';
import { halfWidthAt } from '../core/viewport.js';

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
   *   arten: Map<string, {frames: import('three').Texture[], wurf: import('three').Texture|null}>,
   *   spielerWurf: import('three').Texture|null,
   * }} bilder
   * @param {{klang:object, ui:object, onTreffer:Function, onEnde:Function, onSieg:Function}} umgebung
   */
  constructor(scene, cfg, bilder, umgebung) {
    this.scene = scene;
    this.cfg = cfg;
    this.bilder = bilder;
    /* Die Kamera, um auszurechnen, wieviel auf SEINER Höhe sichtbar ist.
     * Das ist nicht dasselbe wie die Bewegungsgrenze des Affen: die gilt
     * weit unten im Bild, der Boss hängt weit oben. */
    this.camera = umgebung.camera ?? null;
    this.klang = umgebung.klang;
    this.ui = umgebung.ui;
    this.onTreffer = umgebung.onTreffer ?? (() => {});
    this.onEnde = umgebung.onEnde ?? (() => {});
    this.onSieg = umgebung.onSieg ?? (() => {});

    this.phase = BossPhase.AUS;
    this._uhr = 0;

    /* Für jede Art ein fertiger Boss und ein eigener Geschoss-Pool. Beide
     * werden einmal gebaut und danach nur noch ein- und ausgeblendet —
     * mitten im Kampf Meshes anzulegen ruckelt. */
    this._bosse = new Map();
    this._geschosse = new Map();
    for (const art of cfg.arten) {
      const daten = bilder.arten?.get(art.id);
      if (!daten?.frames?.length) continue;
      const boss = new Boss(cfg, art, daten.frames);
      scene.add(boss.mesh);
      this._bosse.set(art.id, boss);
      this._geschosse.set(
        art.id,
        new Pool(art.wurf.poolSize, (i) => {
          const b = new Bossbanane(i, art.wurf, daten.wurf ?? null);
          scene.add(b.mesh);
          return b;
        }),
      );
    }

    /* KEINE MUNITION MEHR.
     *
     * Hier lag ein zweiter Pool mit Sammelbananen, die im Kampf herunter-
     * fielen und den Wurfvorrat auffüllten. Beides ist raus: im Kampf soll
     * ausser den Würfen des Bosses NICHTS herunterkommen, und Bananen sind
     * unbegrenzt. Siehe wurfAnfordern(). */

    /* Die vom Affen geworfenen Bananen. */
    this.wuerfe = new Pool(cfg.wurf.poolSize, (i) => {
      const b = new Wurfbanane(i, cfg.wurf, bilder.spielerWurf ?? null);
      scene.add(b.mesh);
      return b;
    });

    /** @type {Boss|null} */
    this.boss = null;
    /** @type {import('../entities/Pool.js').Pool|null} */
    this._aktiveGeschosse = null;

    this._nachladen = 0;
  }

  get aktiv() {
    return this.phase !== BossPhase.AUS;
  }

  /** Kämpft er gerade, oder ist er noch im Anflug bzw. schon tot? */
  get kaempft() {
    return this.phase === BossPhase.KAMPF;
  }

  /** Konnte überhaupt eine Art geladen werden? */
  get bereit() {
    return this._bosse.size > 0;
  }

  /* ============================================================== Steuerung */

  /**
   * Kampf beginnen.
   *
   * @param {object} player wird auf Kampfhöhe geschickt
   * @param {{bounds:{minX:number,maxX:number}}} world
   * @param {string} [artId] welche Ausführung; ohne Angabe ausgewürfelt
   */
  starten(player, world, artId = null) {
    if (this.aktiv || !this.bereit) return false;

    const ids = [...this._bosse.keys()];
    const id = artId && this._bosse.has(artId) ? artId : ids[(Math.random() * ids.length) | 0];
    this.boss = this._bosse.get(id);
    this._aktiveGeschosse = this._geschosse.get(id);

    this.phase = BossPhase.WARNUNG;
    this._uhr = 0;
    this._nachladen = 0;
    /** true = die Zeit war um, er ist nicht besiegt worden (keine Belohnung). */
    this._aufgeben = false;

    /* KAMPFHÖHE AUS DER BILDOBERKANTE, nicht aus einer festen Zahl.
     *
     * Gewünscht ist: „seine obere Hand liegt leicht über dem Bildschirm,
     * dass man sie nicht sieht." Das ist eine Aussage über den BILDRAND,
     * also muss sie am Bildrand hängen. Mit dem festen `cfg.bossY = 3.6`
     * stand der Gorilla mit Oberkante 5.70 bei einer Bildoberkante von 6.78
     * — die Hand UND der Ast, an dem er hängt, waren voll zu sehen; der
     * gemessene Überstand war -0.26 statt +0.25.
     *
     * Und es muss JE AUSFÜHRUNG gerechnet werden: der Gorilla ist 4.2 hoch,
     * der kleine Affe 3.0. Ein gemeinsames y kann nicht bei beiden dasselbe
     * Stück verdecken.
     *
     *     Mitte = Oberkante + (ueberstand - 0.5) * Bildhöhe
     */
    /* Der Rückfallwert ist nur für den Fall, dass jemand dieses System ohne
     * Game aufruft (Tests).
     *
     * ER STAND AUF 6.8 UND DAS WAR FALSCH — das war meine Schätzung über
     * `tan(fov/2) * distanz`, die die Neigung der Kamera nicht kennt.
     * Gemessen sind es 4.96 in der Ebene des Bosses. Mit 6.8 hätte der
     * Gorilla auf y = 5.75 gehangen, seine Unterkante bei 3.65 — komplett
     * über dem Bildrand, also unsichtbar. */
    const oben = world?.sichtbarObenY ?? 4.96;
    this._kampfY = oben + (this.cfg.ueberstand - 0.5) * this.boss.hoehe;

    /* WIE WEIT DARF ER ZUR SEITE — so weit, dass er ganz im Bild bleibt.
     *
     * Vorher lief er bis an `world.bounds.maxX`. Das ist die Grenze für den
     * AFFEN, gemessen weit unten im Bild; der Boss hängt aber oben, wo das
     * Bild schmaler ist, und ist viel breiter als der Affe. Gemessen im
     * Hochformat: der Gorilla ist 3.68 breit, auf seiner Höhe sind ±3.18
     * sichtbar, und er lief bis ±2.65 — er hing also um 1.31 Einheiten aus
     * dem Bild, gut ein Drittel von ihm. Auf dem Bildschirmfoto war das
     * sofort zu sehen.
     *
     * Jetzt wird auf SEINER Höhe gemessen und seine halbe Bildbreite
     * abgezogen. Bleibt dabei zu wenig übrig, gewinnt die Sichtbarkeit —
     * lieber ein Boss, der eine engere Bahn zieht, als einer, der halb
     * abgeschnitten ist. Dass er trotzdem alle drei Bahnen bedroht,
     * garantiert `_geschossAbwerfen`: der Wurf rastet auf die nächste Bahn. */
    const halb = this.camera
      ? halfWidthAt(this.camera, this.cfg.ebeneZ ?? 0.35, this._kampfY)
      : (world?.bounds?.maxX ?? 3);
    this._randX = Math.max(0.3, halb - this.boss.halbeBreite);

    /* Über dem Bildrand parken; der Einflug holt ihn herunter. */
    this.boss.starten(0, this._kampfY + this.boss.hoehe * 1.6);
    this.boss.mesh.visible = false;

    /* Den Nachschub schaltet GAME ab, nicht dieses System — es gibt mehrere
     * Ereignisse, die den Bildschirm freiräumen (Bosskampf, Sturzflug,
     * Chili-Flug). Setzte jedes den Schalter selbst, schaltete das eine ihn
     * beim Aufräumen wieder ein, während das andere noch läuft. */

    // Der Affe rutscht sofort los: bis der Kampf beginnt, soll er unten stehen.
    player?.hoeheAnsteuern?.(this.cfg.affeY);

    this.ui?.toast?.(`${this.boss.art.label} greift an!`, 'boss');
    this.klang?.effekt?.('warnung');
    this.klang?.boss?.(true);
    return true;
  }

  /** Sofort abräumen (Tod, Menü, neuer Lauf). Ohne Belohnung. */
  abbrechen(player) {
    if (!this.aktiv) return;
    this.phase = BossPhase.AUS;
    this.boss?.verstecken();
    this.boss = null;
    for (const p of this._geschosse.values()) p.releaseAll((g) => g.despawn());
    this._aktiveGeschosse = null;
    this.wuerfe.releaseAll((b) => b.despawn());
    player?.hoeheAnsteuern?.(null);
    this.klang?.boss?.(false);
  }

  /**
   * Wurf anfordern (Tipp/Klick/Leertaste).
   *
   * BANANEN SIND UNBEGRENZT. Es gab hier einen Vorrat, der aus herunter-
   * fallenden Sammelbananen aufgefüllt werden musste — das ist raus, und
   * zwar aus zwei Gründen, die zusammengehören: im Kampf soll AUSSER den
   * Würfen des Bosses nichts herunterkommen, und ohne Nachschub wäre ein
   * Vorrat eine Sackgasse. Wer keine Banane mehr hätte, könnte den Kampf
   * nicht mehr gewinnen und müsste warten, bis ihn etwas trifft.
   *
   * Begrenzt bleibt nur die WURFRATE (`nachladen`) — die ergibt sich aus der
   * Wurfanimation und ist kein Vorrat, sondern Timing. Schneller als der Arm
   * kann niemand werfen.
   *
   * Die Banane entsteht NICHT hier, sondern wenn der Arm gestreckt ist —
   * SpritePlayer meldet das als Ereignis 'wurf'. Sonst sähe es aus, als
   * fiele sie aus dem Ärmel.
   */
  wurfAnfordern(player) {
    if (this.phase !== BossPhase.KAMPF) return false;
    if (this._nachladen > 0) return false;
    if (!player?.werfen?.()) return false;
    this._nachladen = this.cfg.wurf.dauer + this.cfg.wurf.nachladen;
    return true;
  }

  /** Die Banane verlässt die Hand — vom Spieler gemeldet (Ereignis 'wurf'). */
  bananeLoslassen(player) {
    if (this.phase !== BossPhase.KAMPF) return;
    const b = this.wuerfe.acquire();
    if (!b) return;
    // Etwas über der Bildmitte: sie kommt aus der Hand, nicht aus den Füssen.
    b.spawn(player.x, player.y + (player.spriteHeight ?? 2.4) * 0.25);
    /* 'sturz' ist ein abfallender Rauschsweep (2200 -> 300 Hz) und damit das
     * Wurfgeräusch, das es schon gibt. Einen eigenen Namen wie 'wurf' zu
     * benutzen wäre TONLOS geblieben: Klang._effektJetzt steigt bei einem
     * unbekannten Namen still aus, ohne Warnung. */
    this.klang?.effekt?.('sturz');
  }

  /* =================================================================== Loop */

  /**
   * @param {number} dt
   * @param {object} player
   * @param {{bounds:{minX:number,maxX:number,minY:number}, bahnX:number[]}} world
   */
  update(dt, player, world) {
    if (!this.aktiv) return;
    this._uhr += dt;
    this._nachladen = Math.max(0, this._nachladen - dt);

    /* Er fährt seine eigene Spanne ab — die, in der er ganz sichtbar bleibt
     * (siehe `_randX` in starten). Stünde er nur auf Bahnen, wüsste man
     * sofort, wo man sicher ist; so muss man ihn lesen. */
    const maxX = this._randX ?? world.bounds.maxX;
    const minX = -maxX;

    switch (this.phase) {
      case BossPhase.WARNUNG:
        if (this._uhr >= this.cfg.warnungSekunden) {
          this.boss.mesh.visible = true;
          this.phase = BossPhase.EINFLUG;
          this._uhr = 0;
        }
        break;

      case BossPhase.EINFLUG: {
        const t = Math.min(1, this._uhr / this.cfg.einflugSekunden);
        // Weich abbremsen statt gleichmässig — er landet auf seiner Höhe,
        // er fällt nicht darauf.
        const weich = 1 - (1 - t) * (1 - t);
        const start = this._kampfY + this.boss.hoehe * 1.6;
        this.boss.y = start + (this._kampfY - start) * weich;
        this.boss.update(dt, minX, maxX);
        if (t >= 1) {
          this.boss.y = this._kampfY;
          this.phase = BossPhase.KAMPF;
          this._uhr = 0;
        }
        break;
      }

      case BossPhase.KAMPF: {
        const wirft = this.boss.update(dt, minX, maxX);
        if (wirft) this._geschossAbwerfen(world.bahnX);
        /* ZEITLIMIT. Ohne es bleibt ein Spieler, der nur ausweicht und nie
         * wirft, beliebig lange im Kampf — und sammelt dort gefahrlos
         * Höhenmeter, weil ausser dem Boss nichts fällt. Begründung samt
         * Messwerten bei CONFIG.boss.maxSekunden. */
        if (this._uhr >= this.cfg.maxSekunden) {
          this._aufgeben = true;
          this.phase = BossPhase.ENDE;
          this._uhr = 0;
          this.ui?.toast?.('Er zieht ab', 'revive');
        }
        break;
      }

      case BossPhase.ENDE:
        /* Er sinkt aus dem Bild. Der Kampf ist vorbei, gefährlich ist
         * nichts mehr — nur die schon fliegenden Geschosse zählen noch. */
        this.boss.y -= 4.5 * dt;
        this.boss.mesh.position.y = this.boss.y;
        this.boss.mesh.material.opacity = Math.max(0, 1 - this._uhr / 0.9);
        if (this._uhr >= 0.9) {
          this._beenden(player);
          return;
        }
        break;
    }

    this._geschosseSchritt(dt, player, world);
    this._wuerfeSchritt(dt, world);
  }

  /* ------------------------------------------------------------- Geschosse */

  /**
   * Der Boss wirft. Die Banane rastet auf die NÄCHSTE BAHN ein.
   *
   * Zwei Gründe, und beide zählen:
   *
   * ERSTENS FAIRNESS. Der Affe steht immer auf einer Bahn — er kann gar
   * nicht dazwischen stehenbleiben. Eine Banane, die zwischen zwei Bahnen
   * herunterkommt, trifft deshalb nie und ist reine Deko; eine, die knapp
   * neben einer Bahn liegt, trifft, ohne dass man es kommen sieht. Auf der
   * Bahn ist beides eindeutig: sie ist entweder auf deiner Spur oder nicht.
   *
   * ZWEITENS REICHWEITE. Der Gorilla ist so breit, dass er nur die mittleren
   * Einheiten abfahren kann, ohne aus dem Bild zu ragen (siehe `_randX`).
   * Ohne Einrasten wären die äusseren Bahnen dauerhaft sicher und der ganze
   * Kampf hiesse "stell dich nach links".
   *
   * NICHT die NÄCHSTE Bahn, sondern die ANTEILIG passende.
   *
   * „Nächste Bahn" war der erste Versuch und ergab beim Gorilla 15 Würfe auf
   * die Mitte gegen 2 links und 1 rechts — bei einer Patrouille von ±1.34
   * und Bahnen bei ±2.20 ist die Mitte fast immer die nächste. Aussen stand
   * man praktisch sicher.
   *
   * Deshalb wird seine Position ANTEILIG auf die Bahnen abgebildet: ganz
   * links in seiner Spanne heisst linke Bahn, ganz rechts heisst rechte
   * Bahn, unabhängig davon, wie weit er tatsächlich ausschwingt. Vorhersehbar
   * bleibt es trotzdem — man sieht an seiner Stelle in der Spanne, wohin der
   * nächste Wurf geht.
   *
   * @param {number[]} bahnX
   */
  _geschossAbwerfen(bahnX) {
    const g = this._aktiveGeschosse?.acquire();
    if (!g) return;
    let x = this.boss.x;
    if (bahnX?.length) {
      const spanne = this._randX || 1;
      // 0 .. 1 innerhalb seiner Patrouille
      const t = Math.max(0, Math.min(1, (x / spanne + 1) / 2));
      /* GLEICHE DRITTEL, nicht runden.
       *
       * Mit Math.round(t * (n-1)) bekommt die MITTLERE Bahn die halbe Spanne
       * und jede äussere nur ein Viertel — gemessen 55 % / 18 % / 28 % beim
       * Gorilla. Die Mitte wäre damit dauerhaft die gefährlichste Bahn, und
       * das ist eine Regel, die niemand ausgesprochen hat. Mit floor auf n
       * gleich grosse Abschnitte bekommt jede Bahn genau ein Drittel. */
      const i = Math.min(bahnX.length - 1, Math.floor(t * bahnX.length));
      x = bahnX[i];
    }
    g.spawn(x, this.boss.wurfY);
    this.klang?.effekt?.('sturz');
  }

  _geschosseSchritt(dt, player, world) {
    if (!this._aktiveGeschosse) return;
    const unten = world.bounds.minY - 1.5;
    // RÜCKWÄRTS, weil release() swap-remove benutzt (siehe Pool.js).
    for (let i = this._aktiveGeschosse.active.length - 1; i >= 0; i--) {
      const g = this._aktiveGeschosse.active[i];
      if (!g.active) continue;
      g.update(dt);
      if (g.y < unten) {
        g.despawn();
        this._aktiveGeschosse.release(g);
        continue;
      }
      /* Treffer am Affen. Über `onTreffer` zurück ans Spiel — über Leben
       * und Tod entscheidet weiter genau eine Stelle. */
      if (
        player?.alive &&
        circleOverlap(g.x, g.y, g.hitRadius, player.x, player.y, player.hitRadius)
      ) {
        g.despawn();
        this._aktiveGeschosse.release(g);
        this.onTreffer();
      }
    }
  }

  /* ----------------------------------------------------------- Eigene Würfe */

  _wuerfeSchritt(dt, world) {
    const oben = world.bounds.maxY + 3;
    // RÜCKWÄRTS, weil release() swap-remove benutzt (siehe Pool.js).
    for (let i = this.wuerfe.active.length - 1; i >= 0; i--) {
      const b = this.wuerfe.active[i];
      if (!b.active) continue;
      b.update(dt);
      if (b.y > oben) {
        b.despawn();
        this.wuerfe.release(b);
        continue;
      }
      if (this.phase !== BossPhase.KAMPF || !this.boss) continue;
      if (
        circleOverlap(
          b.x,
          b.y,
          b.hitRadius,
          this.boss.x,
          this.boss.trefferMitte,
          this.boss.trefferRadius,
        )
      ) {
        b.despawn();
        this.wuerfe.release(b);
        const tot = this.boss.treffer();
        // 'muenze' = heller Treffer-Ping, 'frei' = der Aufstiegsakkord.
        // Beides gibt es schon; erfundene Namen blieben still (siehe oben).
        this.klang?.effekt?.(tot ? 'frei' : 'muenze');
        if (tot) {
          this.phase = BossPhase.ENDE;
          this._uhr = 0;
          this.ui?.toast?.('Besiegt!', 'banana');
        } else {
          this.ui?.toast?.(`Treffer! Noch ${this.boss.leben}`, 'coin');
        }
      }
    }
  }

  /* ------------------------------------------------------------------ Ende */

  _beenden(player) {
    this.phase = BossPhase.AUS;
    this.boss?.verstecken();
    this.boss = null;
    for (const p of this._geschosse.values()) p.releaseAll((g) => g.despawn());
    this._aktiveGeschosse = null;
    this.wuerfe.releaseAll((b) => b.despawn());
    player?.hoeheAnsteuern?.(null);
    this.klang?.boss?.(false);
    /* Der Goldrausch ist die Belohnung fürs BESIEGEN. Zieht der Boss nach
     * Ablauf der Zeit von selbst ab, hat niemand etwas gewonnen — dann gibt
     * es ihn auch nicht. Sonst wäre Nichtstun die beste Taktik: abwarten,
     * 45 Sekunden gefahrlos klettern, Goldrausch kassieren. */
    if (!this._aufgeben) this.onSieg();
    this._aufgeben = false;
    this.onEnde();
  }
}
