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
 *             wirkt wie ein Stein. Nebenher fallen Sammelbananen als
 *             Munition. Auf Tipp/Leertaste wirft der Affe senkrecht nach
 *             oben. Drei Treffer.
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
   *   munition: import('three').Texture|null,
   *   spielerWurf: import('three').Texture|null,
   * }} bilder
   * @param {{klang:object, ui:object, onTreffer:Function, onEnde:Function, onSieg:Function}} umgebung
   */
  constructor(scene, cfg, bilder, umgebung) {
    this.scene = scene;
    this.cfg = cfg;
    this.bilder = bilder;
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

    /* Munition: die Sammelbananen, die im Kampf herunterkommen. Eigener
     * Pool statt der Spawner-Bananen — die gehorchen der Korridor-Logik,
     * die hier nicht gilt. */
    this.munition = new Pool(cfg.munition.poolSize, (i) => {
      const b = new Bossbanane(i, { ...cfg.munition }, bilder.munition ?? null);
      scene.add(b.mesh);
      return b;
    });

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
    this._munitionsUhr = 0;
    /** Wieviele Bananen der Affe gerade in der Hand hat. */
    this.vorrat = 0;
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
    this._munitionsUhr = this.cfg.munition.takt;
    this.vorrat = this.cfg.munition.startVorrat;

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
     * Game aufruft (Tests). 6.8 ist die gemessene Oberkante bei fov 46. */
    const oben = world?.sichtbarObenY ?? 6.8;
    this._kampfY = oben + (this.cfg.ueberstand - 0.5) * this.boss.hoehe;

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
    this.munition.releaseAll((b) => b.despawn());
    this.wuerfe.releaseAll((b) => b.despawn());
    this.vorrat = 0;
    player?.hoeheAnsteuern?.(null);
    this.klang?.boss?.(false);
  }

  /**
   * Wurf anfordern (Tipp/Klick/Leertaste).
   *
   * Die Banane entsteht NICHT hier, sondern wenn der Arm gestreckt ist —
   * SpritePlayer meldet das als Ereignis 'wurf'. Sonst sähe es aus, als
   * fiele sie aus dem Ärmel.
   */
  wurfAnfordern(player) {
    if (this.phase !== BossPhase.KAMPF) return false;
    if (this._nachladen > 0) return false;
    if (this.vorrat <= 0) {
      this.ui?.toast?.('Keine Banane!', 'warn');
      return false;
    }
    if (!player?.werfen?.()) return false;
    this.vorrat--;
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

    /* Der Boss fährt die volle Feldbreite ab — nicht nur die Bahnen.
     * Stünde er nur auf Bahnen, wüsste man sofort, wo man sicher ist. So
     * muss man ihn lesen. */
    const minX = world.bounds.minX;
    const maxX = world.bounds.maxX;

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
        if (wirft) this._geschossAbwerfen();
        this._munitionSchritt(dt, minX, maxX);
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

  _geschossAbwerfen() {
    const g = this._aktiveGeschosse?.acquire();
    if (!g) return;
    g.spawn(this.boss.x, this.boss.wurfY);
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

  /* -------------------------------------------------------------- Munition */

  /**
   * Nachschub abwerfen UND die schon fallenden weiterbewegen.
   *
   * Beides in einer Methode, weil das Fallen sonst nirgends passierte: es
   * stand zuerst in einer eigenen `_munitionFallen`, die niemand rief — die
   * Bananen wären auf ihrer Abwurfhöhe stehen geblieben.
   */
  _munitionSchritt(dt, minX, maxX) {
    for (const b of this.munition.active) if (b.active) b.update(dt);

    this._munitionsUhr -= dt;
    if (this._munitionsUhr > 0) return;
    this._munitionsUhr = this.cfg.munition.takt;
    if (this.vorrat >= this.cfg.munition.maxVorrat) return;
    const b = this.munition.acquire();
    if (!b) return;
    /* Über die Feldbreite verteilt, mit Abstand zum Rand — man soll sie
     * holen können, ohne in die Ecke gedrängt zu werden. */
    const spanne = maxX - minX;
    /* Von der Abwurfhöhe des Bosses, nicht aus dem Nichts: die Munition
     * soll aussehen, als käme sie aus demselben Geschehen. */
    b.spawn(minX + spanne * (0.15 + Math.random() * 0.7), this._kampfY);
  }

  /**
   * Einsammeln prüfen. Wird von Game gerufen, weil dort schon die
   * Einsammel-Rückmeldungen sitzen (Klang, Anzeige).
   * @returns {number} wieviele in diesem Bild eingesammelt wurden
   */
  munitionEinsammeln(player, world) {
    if (!this.aktiv) return 0;
    const unten = world.bounds.minY - 1.5;
    let genommen = 0;
    // RÜCKWÄRTS, weil release() swap-remove benutzt (siehe Pool.js).
    for (let i = this.munition.active.length - 1; i >= 0; i--) {
      const b = this.munition.active[i];
      if (!b.active) continue;
      if (b.y < unten) {
        b.despawn();
        this.munition.release(b);
        continue;
      }
      if (
        player?.alive &&
        circleOverlap(b.x, b.y, b.hitRadius, player.x, player.y, player.hitRadius)
      ) {
        b.despawn();
        this.munition.release(b);
        if (this.vorrat < this.cfg.munition.maxVorrat) {
          this.vorrat++;
          genommen++;
        }
      }
    }
    return genommen;
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
    this.munition.releaseAll((b) => b.despawn());
    this.wuerfe.releaseAll((b) => b.despawn());
    this.vorrat = 0;
    player?.hoeheAnsteuern?.(null);
    this.klang?.boss?.(false);
    this.onSieg();
    this.onEnde();
  }
}
