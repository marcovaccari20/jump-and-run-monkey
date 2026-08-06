/**
 * Erzeugt und bewegt Steine und Bananen.
 *
 * Beide Entity-Typen liegen in Object Pools; im Frame-Loop wird nichts
 * allokiert. Spawn-Takt, Fallgeschwindigkeit und Burst-Grösse kommen
 * ausschliesslich aus der DifficultyCurve.
 */
import { Pool } from '../entities/Pool.js';
import { Rock, spriteHoehe } from '../entities/Rock.js';
import { Banana } from '../entities/Banana.js';
import { Coin } from '../entities/Coin.js';
import { Korridor } from './Korridor.js';

export class Spawner {
  /**
   * @param {import('three').Object3D} scene
   * @param {typeof import('../config.js').CONFIG} cfg
   * @param {import('./DifficultyCurve.js').DifficultyCurve} difficulty
   * @param {object} world  wirksame Spielfeldmasse (Referenz!). Game passt
   *   darin die Breite bei jedem Resize an — der Spawner sieht das dadurch
   *   automatisch und wirft im Hochformat nichts neben dem Bild ab.
   * @param {Map<string, import('three').Texture>|null} hazardTexturen
   *   Vorgeladene Objektbilder. Fehlen sie, baut Rock die Objekte prozedural.
   */
  constructor(scene, cfg, difficulty, world, hazardTexturen = null, coinTextur = null) {
    this.cfg = cfg;
    this.difficulty = difficulty;
    this.world = world ?? cfg.world;

    this.rocks = new Pool(cfg.rock.poolSize, (i) => new Rock(i, cfg.rock, hazardTexturen));
    this.bananas = new Pool(cfg.banana.poolSize, (i) => new Banana(i, cfg.banana));
    this.coins = new Pool(cfg.coin.poolSize, (i) => new Coin(i, cfg.coin, coinTextur));

    for (const rock of this.rocks.all) scene.add(rock.mesh);
    for (const banana of this.bananas.all) scene.add(banana.mesh);
    for (const coin of this.coins.all) scene.add(coin.mesh);

    this.timer = 0;
    this._poolExhaustedWarned = false;
    this._horizontGewarnt = false;

    /* Einmal aus der Config abgeleitet, statt Zahlen im Code zu wiederholen:
     * der grösste Trefferradius und der langsamste Fallfaktor über ALLE
     * Looks. Beide gehen in die Platzrechnung ein — mit hartcodierten Werten
     * würde eine neue Wand die Rechnung still ungültig machen. */
    this._groessterHitRadius = Math.max(...cfg.rock.types.map((t) => t.radius)) * cfg.rock.hitRadiusFactor;
    this._langsamsterFallfaktor = Math.min(
      ...Object.values(cfg.rock.looks).flatMap((look) =>
        cfg.rock.types.map(
          (t, i) => (t.fallFactor ?? 1) * (look.fallMulSlots?.[i] ?? look.fallMul ?? 1),
        ),
      ),
    );

    /* Taktgeber für den Einzelstrom. reset() setzt sie neu; hier stehen sie,
     * damit die Felder von Anfang an existieren. */
    this._salveRest = 0;
    this._gruppeGroesse = 1;
    this._wartenderTyp = null;

    /* Welches Objekt gerade fällt — wird von Game aus der aktuellen
     * Hintergrundstufe gesetzt (CONFIG.wall.stages[*].hazard).
     *
     * Bereits fliegende Objekte behalten ihr Aussehen: Beim Wandwechsel
     * wechselt nur, was NEU erzeugt wird. Ein Eiszapfen, der mitten im Bild
     * plötzlich zum Kürbis würde, wäre schlicht ein Fehler im Bild. */
    this.hazardLook = 'stein';

    /* Bananen für diesen Affen überhaupt zulassen (der weisse bekommt keine).
     *
     * Bewusst ein EIGENES Feld und nicht der Umweg über playerHasRevive:
     * dieser Parameter wirkt nur zusammen mit banana.suppressWhenStocked.
     * Stünde der Schalter irgendwann auf false, spawnten für den weissen
     * Affen wieder Bananen — ein Fehler, den niemand mit der Charakterwahl
     * in Verbindung bringen würde. CONFIG.banana.spawnChance anzufassen
     * scheidet ebenfalls aus: das ist ein geteiltes Objekt.
     */
    this.bananasEnabled = true;

    /* Die garantierte freie Bahn. Siehe Korridor.js — sie ist der Grund,
     * warum die Objekte nicht mehr zufällig verteilt werden. */
    this.korridor = new Korridor(cfg.rock.korridor);
    // Wiederverwendet, damit die Fensterabfrage nichts allokiert.
    this._spanne = { min: 0, max: 0 };

    /* Masse des gewählten Affen. Sie gehen in die Garantie ein: der
     * Trefferradius bestimmt, wie breit die Bahn freigehalten werden muss,
     * die Laufgeschwindigkeit, wie schnell sie sich bewegen darf. Game setzt
     * das bei jedem Charakterwechsel neu; bis dahin gelten die Referenzwerte
     * des braunen Affen. */
    this.spieler = {
      hitRadius: cfg.player.hitRadius,
      moveSpeed: cfg.player.moveSpeed,
      climbAssist: cfg.player.climbAssist,
      minScrollFactor: cfg.player.minScrollFactor,
    };
  }

  /** Masse des Affen übernehmen (Charakterwechsel). */
  setSpieler(pCfg) {
    this.spieler.hitRadius = pCfg.hitRadius;
    this.spieler.moveSpeed = pCfg.moveSpeed;
    this.spieler.climbAssist = pCfg.climbAssist;
    this.spieler.minScrollFactor = pCfg.minScrollFactor;
  }

  reset() {
    this.rocks.releaseAll((r) => r.despawn());
    this.bananas.releaseAll((b) => b.despawn());
    this.coins.releaseAll((c) => c.despawn());
    // Erste Münze nicht sofort: der Anfang gehört dem Klettern.
    this.coinTimer = this.muenzTakt * 0.6;
    // Die Bahn startet dort, wo der Affe steht — der erste Schritt soll kein
    // Sprint zur Seite sein.
    this.korridor.reset(this.cfg.player.startPosition[0]);
    // Kurze Schonfrist zu Spielbeginn, damit man nicht sofort getroffen wird.
    this.timer = this.difficulty.spawnDelay * 1.4;

    // Taktgeber für den Einzelstrom (siehe _einzelnesObjekt).
    this._salveRest = 0;
    this._gruppeGroesse = 1;
    this._wartenderTyp = null;
  }

  /**
   * Höchsttempo der Bahn: mitwachsend, aber nie schneller als der Affe.
   *
   * Der Anteil wächst mit der Spielzeit von `anteilStart` auf `anteilMax`.
   * Das ist der Hebel für das Spätspiel: ab etwa Wand 14 sind Tempo und
   * Dichte am Anschlag — mehr Objekte gäbe es nur, indem man sie
   * übereinanderlegt, und genau das soll nicht sein. Stattdessen wandert der
   * freie Weg schneller quer durchs Bild. Der Spieler muss also mehr laufen
   * statt mehr auszuweichen; schwerer wird es trotzdem.
   *
   * `anteilMax` MUSS unter 1.0 bleiben. Eine Bahn, der man nicht folgen kann,
   * ist keine Garantie mehr, sondern nur noch eine Behauptung.
   */
  get korridorTempo() {
    const k = this.cfg.rock.korridor;
    const fall = this.difficulty.rockFallSpeed + this.difficulty.scrollSpeed;
    const t = Math.min(1, this.difficulty.wand / k.anteilVollAbWand);
    const anteil = k.anteilStart + (k.anteilMax - k.anteilStart) * t;
    return Math.min(
      this.spieler.moveSpeed * anteil,
      fall * k.tempoAnteil,
      this._tempoDamitPlatzBleibt(fall),
    );
  }

  /**
   * Dritte Bremse für die Bahn: im schmalen Feld muss sie ruhiger wandern.
   *
   * Was ein Objekt an Breite sperrt, ist nicht die Bahn selbst, sondern wie
   * weit sie WÄHREND des Durchquerungsfensters wandert — die Spanne. Bei 3.3 s
   * Fenster und 2 Einheiten/s sind das schon 6.6 Einheiten. Im Querformat
   * (±5.0) bleibt daneben Platz; im Hochformat (±1.94) nicht mehr.
   *
   * Gemessen war die Folge: **27 % aller Objekte entfielen im Hochformat
   * ersatzlos**, weil `_freieStelle` keinen Platz mehr fand. Die Garantie war
   * dort also teilweise dadurch erfüllt, dass gar nichts fällt — formal
   * korrekt und trotzdem falsch, weil das Spiel auf dem Handy einfach leerer
   * ist als gedacht.
   *
   * Also wird die Bahn so weit gebremst, dass neben ihr immer noch ein
   * grosser Brocken Platz hat.
   */
  _tempoDamitPlatzBleibt(fall) {
    const k = this.cfg.rock.korridor;
    const world = this.world;
    const rand = this.spieler.hitRadius + this._groessterHitRadius;

    // Zeit, die das langsamste Objekt braucht, um das Band zu durchqueren.
    const langsamste = Math.max(0.2, this._langsamsterFallfaktor);
    const vLangsam = Math.max(0.5, fall * langsamste * this.spieler.minScrollFactor);
    const fenster = (world.spawnY - (world.bounds.minY - rand)) / vLangsam;

    // Was neben der Sperrzone übrig bleiben soll: ein grosser Brocken.
    const sperrRest = 2 * (k.halbbreite + rand + k.reserve) + 2 * this._groessterHitRadius;
    const maxSpanne = 2 * world.spawnHalfWidth - sperrRest;
    if (maxSpanne <= 0) return 0.05; // extrem schmal: Bahn praktisch anhalten
    return maxSpanne / fenster;
  }

  /**
   * @param {number} dt
   * @param {boolean} playerHasRevive unterdrückt Bananen, wenn schon eine gebunkert ist
   * @param {number} scroll  tatsächliche Scrollgeschwindigkeit dieses Frames
   *   (inkl. Kletter-Bonus durch W/S — nicht difficulty.scrollSpeed, sonst
   *   passen Bildschirmgeschwindigkeit und Weltbewegung nicht zusammen)
   */
  update(dt, playerHasRevive, scroll) {
    const world = this.world;
    const bananaCfg = this.cfg.banana;
    const rockSpeed = this.difficulty.rockFallSpeed + scroll;
    const bananaSpeed = this.difficulty.rockFallSpeed * bananaCfg.fallSpeedFactor + scroll;

    /* ---------------------------------------------------------- Korridor */
    // ZUERST, vor dem Spawnen: die Bahn muss schon in der Zukunft stehen,
    // wenn die Objekte dieser Welle daran ausgerichtet werden.
    this.korridor.update(
      dt,
      this.korridorTempo,
      world.bounds.minX,
      world.bounds.maxX,
      this.cfg.rock.korridor.horizont,
    );

    /* ------------------------------------------------------------- Spawn */
    this.timer -= dt;
    if (this.timer <= 0) {
      const bananaAllowed =
        this.bananasEnabled &&
        !(bananaCfg.suppressWhenStocked && playerHasRevive) &&
        Math.random() < bananaCfg.spawnChance;

      if (bananaAllowed) {
        this._spawnBanana(this._bananenX(bananaCfg), world.spawnY);
        this.timer += this.difficulty.spawnDelay;
      } else {
        this.timer += this._einzelnesObjekt();
      }
      // Bei Frame-Spitzen kann der Timer mehrfach negativ bleiben — dann auf
      // den nächsten Takt aufsetzen statt einen Stau abzuarbeiten.
      if (this.timer < 0) this.timer = this.difficulty.spawnDelay;
    }

    /* ------------------------------------------------------------- Münzen */
    this.coinTimer -= dt;
    if (this.coinTimer <= 0) {
      this.coinTimer += this.muenzTakt;
      if (this.coinTimer < 0) this.coinTimer = this.muenzTakt;
      this._spawnCoin();
    }

    const coinSpeed = this.difficulty.rockFallSpeed * this.cfg.coin.fallSpeedFactor + scroll;
    for (let i = this.coins.active.length - 1; i >= 0; i--) {
      const coin = this.coins.active[i];
      coin.update(dt, coinSpeed);
      if (coin.y < world.despawnY) {
        coin.despawn();
        this.coins.release(coin);
      }
    }

    /* ------------------------------------------------------------ Update */
    // Rückwärts iterieren: release() macht swap-remove auf `active`.
    for (let i = this.rocks.active.length - 1; i >= 0; i--) {
      const rock = this.rocks.active[i];
      rock.update(dt, rockSpeed);
      if (rock.y < world.despawnY) {
        rock.despawn();
        this.rocks.release(rock);
      }
    }

    for (let i = this.bananas.active.length - 1; i >= 0; i--) {
      const banana = this.bananas.active[i];
      banana.update(dt, bananaSpeed);
      if (banana.y < world.despawnY) {
        banana.despawn();
        this.bananas.release(banana);
      }
    }
  }

  /**
   * Wählt eine Steinart nach den aktuellen Gewichten.
   *
   * Die Gewichte sind relativ, müssen sich also nicht auf 100 summieren —
   * gewürfelt wird gegen ihre Summe. Ein Gewicht von 0 kann nie gezogen
   * werden, so bleiben grosse Steine in den ersten 30 Sekunden komplett aus.
   */
  _pickRockType() {
    const types = this.cfg.rock.types;
    const weights = this.difficulty.rockWeights;
    if (!weights || weights.length !== types.length) return types[0];

    let sum = 0;
    for (let i = 0; i < types.length; i++) sum += weights[i];
    if (sum <= 0) return types[0];

    let r = Math.random() * sum;
    for (let i = 0; i < types.length; i++) {
      r -= weights[i];
      if (r < 0) return types[i];
    }
    return types[types.length - 1];
  }

  /**
   * Wirft GENAU EIN Objekt ab und sagt, wann das nächste an der Reihe ist.
   *
   * ES KOMMT IMMER NUR EINES. Kein Burst, kein Haufen. Gelegentlich eine
   * kurze Salve von zwei oder drei — aber hintereinander, nie aufeinander.
   *
   * DIE REGEL GILT BEI DER ANKUNFT, NICHT BEIM ABWURF.
   * Das ist der Punkt, an dem die naheliegende Lösung scheitert: Objekte
   * fallen unterschiedlich schnell (klein 1.25x, gross 0.82x). Zwei sauber
   * versetzt abgeworfene Objekte kommen deshalb trotzdem gleichzeitig beim
   * Affen an — der kleine holt den Brocken ein. Verlangt wird also ein
   * Mindestabstand zwischen den ANKUNFTSZEITEN. Passt es noch nicht, wird
   * gewartet statt abgeworfen.
   *
   * @returns {number} Sekunden bis zum nächsten Abwurf
   */
  _einzelnesObjekt() {
    const d = this.difficulty;
    const world = this.world;

    // Typ einmal wählen und behalten: muss der Abwurf verschoben werden,
    // soll beim nächsten Versuch dasselbe Objekt kommen. Sonst würfelte man
    // sich so lange durch, bis zufällig ein schnelles passt — und der Strom
    // bestünde am Ende fast nur noch aus kleinen Steinen.
    const type = this._wartenderTyp ?? this._pickRockType();
    const v = this._fallTempo(type);

    const hoehe = spriteHoehe(this.cfg.rock, this.hazardLook, type);
    if (!this._darfFallen(v, hoehe, d.cfg.dichte.mindestAbstand)) {
      // Zu dicht am Vorgänger — warten. Der Typ bleibt reserviert, sonst
      // würfelte man sich so lange durch, bis zufällig ein passender kommt,
      // und der Strom bestünde am Ende fast nur aus kleinen Steinen.
      this._wartenderTyp = type;
      return 1 / 60;
    }
    this._wartenderTyp = null;

    const hitRadius = type.radius * this.cfg.rock.hitRadiusFactor;
    const x = this._freieStelle(type, hitRadius);
    if (x === null) {
      // Kein Platz neben der Bahn: dieses Objekt entfällt ganz. Die Garantie
      // schlägt die Wunschmenge.
      return d.spawnDelay;
    }

    const rock = this.rocks.acquire();
    if (!rock) {
      if (!this._poolExhaustedWarned) {
        console.warn('[Spawner] Objekt-Pool erschöpft — CONFIG.rock.poolSize erhöhen.');
        this._poolExhaustedWarned = true;
      }
      return d.spawnDelay;
    }
    rock.spawn(type, this.hazardLook, x, world.spawnY, Math.random(), Math.random(), Math.random());

    /* --- Wann kommt das nächste? ------------------------------------- */
    if (this._salveRest > 0) {
      this._salveRest--;
      // Dicht hinterher — aber die Ankunfts-Regel oben bleibt die Bremse.
      return d.mindestZeit;
    }

    // Die Gruppe ist zu Ende. Nächste planen: meist eine, manchmal zwei
    // oder drei kurz hintereinander.
    const dcfg = this.cfg.difficulty.dichte;
    let n = 1;
    if (Math.random() < dcfg.salveChance) {
      n = 2 + Math.floor(Math.random() * (dcfg.salveMax - 1));
    }

    /* Die Pause VOR der neuen Gruppe gleicht die eben beendete aus.
     * Eine Salve von drei verbraucht intern nur 2 x mindestZeit; ohne diesen
     * Ausgleich wären Salven ein heimlicher Dichte-Aufschlag, und je öfter
     * sie kämen, desto weiter liefe das Spiel von der eingestellten Dichte
     * weg. */
    const vorige = this._gruppeGroesse;
    this._gruppeGroesse = n;
    this._salveRest = n - 1;

    const soll = vorige / d.dichte;
    const schonVerbraucht = (vorige - 1) * d.mindestZeit;
    return Math.max(d.mindestZeit, soll - schonVerbraucht);
  }

  /**
   * Darf jetzt eines fallen, ohne dass zwei Objekte übereinanderliegen?
   *
   * DAS IST DIE REGEL "NIE AUFEINANDER, IMMER HINTEREINANDER" — und sie ist
   * schwieriger, als sie klingt. Der erste Versuch prüfte den Abstand nur bei
   * der Ankunft am Affen. Gemessen kamen sich Objekte in 3.68 % der Frames
   * trotzdem ins Gehege: weiter oben im Bild holt ein schnelles kleines
   * Objekt (Fallfaktor 1.25) einen langsamen Brocken (0.82) ein, und genau
   * dort sieht es dann nach Haufen aus.
   *
   * Geprüft wird deshalb der ENGSTE Moment über den ganzen sichtbaren Flug.
   * Weil beide mit konstantem Tempo fallen, ist der Abstand linear in der
   * Zeit — es genügt also, den Zeitpunkt auszurechnen, an dem der Vorsprung
   * auf `mindestAbstand` zusammengeschmolzen wäre, und ihn damit zu
   * vergleichen, wann der Vordermann aus dem Bild ist:
   *
   *     vorsprung(s) = vorsprung(0) - (vNeu - vAlt) * s
   *     nötig: vorsprung(0) >= mindest + max(0, vNeu - vAlt) * restflugzeit
   *
   * Ist das neue Objekt langsamer, kann es den Vordermann nie einholen —
   * dann reicht der Abstand im Moment des Abwurfs.
   *
   * @param {number} vNeu    Fallgeschwindigkeit des Anwärters
   * @param {number} mindest geforderter Abstand in Welt-Einheiten
   */
  _darfFallen(vNeu, hNeu, mindest) {
    const world = this.world;
    // Bis hierhin ist ein Objekt im Bild. Grosszügig gewählt: unterhalb des
    // Bewegungsbandes sieht man es noch eine Weile fallen.
    const sichtbarBis = world.bounds.minY - 1.6;
    const fall = this.difficulty.rockFallSpeed + this.difficulty.scrollSpeed;

    for (const alt of this.rocks.active) {
      if (!alt.active) continue;
      const vorsprung = world.spawnY - alt.y;
      if (vorsprung <= 0) continue; // liegt (noch) über uns — kann nicht sein

      /* Der nötige Abstand ist nicht konstant, sondern hängt an den BILDERN.
       * Zwei Eiszapfen (je 2.45 hoch) berühren sich schon bei 2.45 Abstand,
       * zwei Steine (je 1.0) erst bei 1.0. Eine gemeinsame Zahl wäre für das
       * eine zu knapp und für das andere unnötig weit. */
      const noetig = Math.max(mindest, (hNeu + alt.mesh.scale.y) / 2 + this.cfg.difficulty.dichte.luft);

      const vAlt = alt.fallFactor * fall;
      const restflug = Math.max(0, (alt.y - sichtbarBis) / Math.max(0.5, vAlt));
      const aufholen = Math.max(0, vNeu - vAlt);

      if (vorsprung < noetig + aufholen * restflug) return false;
    }
    return true;
  }

  /** Bildschirmtempo eines Objekts dieser Art an der aktuellen Wand. */
  _fallTempo(type) {
    const look = this.cfg.rock.looks[this.hazardLook] ?? this.cfg.rock.looks.stein;
    const i = Math.max(0, this.cfg.rock.types.indexOf(type));
    const fall = (type.fallFactor ?? 1) * (look.fallMulSlots?.[i] ?? look.fallMul ?? 1);
    return Math.max(0.5, (this.difficulty.rockFallSpeed + this.difficulty.scrollSpeed) * fall);
  }

  /**
   * Wo darf dieses Objekt hin, ohne die Bahn zu verstellen?
   *
   * DIE GARANTIE STECKT IN DIESER FUNKTION. Der Gedankengang:
   *
   * 1. Das Objekt fällt senkrecht, sein x steht also für sein ganzes Leben
   *    fest. Schon beim Abwurf ist klar, wo es den Affen passieren wird.
   * 2. Gefährlich ist es nicht in einem Moment, sondern während es das
   *    gesamte Bewegungsband des Affen durchquert — von der Oberkante
   *    (maxY) bis zur Unterkante (minY), jeweils um die beiden Trefferradien
   *    erweitert. Daraus wird ein ZEITFENSTER [tEin, tAus].
   * 3. Wie schnell es fällt, hängt auch am Spieler: mit W fällt alles
   *    schneller, mit S langsamer. Beide Extreme gehen in das Fenster ein —
   *    frühestmöglicher Eintritt, spätestmöglicher Austritt.
   * 4. Aus der Bahn wird geholt, wo sie in DIESEM Fenster überall verläuft.
   * 5. Das Objekt kommt ausserhalb dieser Spanne plus aller Radien.
   *
   * Damit kann es die Bahn nicht verstellen — egal wie der Spieler sich
   * verhält, egal wie sich die Welle mit anderen überlagert.
   *
   * @returns {number|null} x-Position, oder null wenn kein Platz mehr ist
   */
  _freieStelle(type, hitRadius) {
    const k = this.cfg.rock.korridor;
    const world = this.world;
    const look = this.cfg.rock.looks[this.hazardLook] ?? this.cfg.rock.looks.stein;
    const slot = this.cfg.rock.types.indexOf(type);
    const i = slot < 0 ? 0 : slot;
    const fall = (type.fallFactor ?? 1) * (look.fallMulSlots?.[i] ?? look.fallMul ?? 1);

    // Fallgeschwindigkeit, schnellster und langsamster Fall (Spieler-Eingabe).
    const basis = this.difficulty.scrollSpeed;
    const eigen = this.difficulty.rockFallSpeed;
    const sp = this.spieler;
    const vSchnell = (eigen + basis + sp.climbAssist) * fall;
    const vLangsam = (eigen + basis * sp.minScrollFactor) * fall;

    const rand = sp.hitRadius + hitRadius;
    const obenY = world.bounds.maxY + rand; // hier wird es zum ersten Mal gefährlich
    const untenY = world.bounds.minY - rand; // hier ist es vorbei

    const tEin = Math.max(0, (world.spawnY - obenY) / vSchnell - k.zeitReserve);
    const tAus = (world.spawnY - untenY) / vLangsam + k.zeitReserve;

    const jetzt = this.korridor.jetzt;
    // Die Bahn muss über das GANZE Fenster feststehen, bevor gefragt wird.
    // Sonst antwortet sie mit ihrem letzten bekannten Wert und die Zusicherung
    // gilt für eine Zukunft, die noch niemand entschieden hat.
    if (!this.korridor.sicherstellen(jetzt + tAus)) {
      if (!this._horizontGewarnt) {
        console.warn(
          '[Spawner] Bahn reicht nicht über das Fenster ' +
            `(${tAus.toFixed(2)} s) — CONFIG.rock.korridor.stuetzstellen erhöhen.`,
        );
        this._horizontGewarnt = true;
      }
      return null; // im Zweifel nichts abwerfen
    }
    const s = this.korridor.spanne(jetzt + tEin, jetzt + tAus, this._spanne);

    const abstand = k.halbbreite + rand + k.reserve;
    const sperreVon = s.min - abstand;
    const sperreBis = s.max + abstand;

    const halb = world.spawnHalfWidth;
    const linksBreite = Math.max(0, sperreVon - -halb);
    const rechtsBreite = Math.max(0, halb - sperreBis);
    const gesamt = linksBreite + rechtsBreite;

    // Kein Platz: dann fällt hier eben nichts. Die Garantie schlägt die
    // Wunsch-Anzahl — lieber ein Objekt weniger als eine dichte Wand.
    if (gesamt < 0.02) return null;

    const w = Math.random() * gesamt;
    return w < linksBreite ? -halb + w : sperreBis + (w - linksBreite);
  }

  /**
   * Bananen liegen AUF der Bahn.
   *
   * Vorher lagen sie irgendwo, was mit dem Korridor nicht mehr aufgeht: die
   * Objekte stehen jetzt gebündelt ausserhalb der Bahn, eine Banane
   * ausserhalb wäre also fast immer unerreichbar — die Wiederbelebung wäre
   * damit still abgeschafft worden, ohne dass jemand eine Zahl geändert hätte.
   */
  _bananenX(bananaCfg) {
    const basis = this.difficulty.scrollSpeed;
    const v = Math.max(
      0.5,
      (this.difficulty.rockFallSpeed * bananaCfg.fallSpeedFactor + basis) * 1,
    );
    const t = this.korridor.jetzt + (this.world.spawnY - this.cfg.player.startPosition[1]) / v;
    const mitte = this.korridor.bei(t);
    const streu = this.cfg.rock.korridor.halbbreite * 0.8;
    const x = mitte + (Math.random() * 2 - 1) * streu;
    const halb = this.world.spawnHalfWidth;
    return x < -halb ? -halb : x > halb ? halb : x;
  }

  /**
   * Münze abwerfen — AUF der freien Bahn.
   *
   * Die Hindernisse stehen gebündelt ausserhalb des Korridors. Eine Münze
   * daneben wäre also fast immer unerreichbar: man müsste durch die Wand, um
   * sie zu holen. Das wäre keine Belohnung, sondern eine Falle.
   */
  _spawnCoin() {
    const coin = this.coins.acquire();
    if (!coin) return; // Pool voll: dann eben keine Münze
    const cfg = this.cfg.coin;

    const v = Math.max(
      0.5,
      this.difficulty.rockFallSpeed * cfg.fallSpeedFactor + this.difficulty.scrollSpeed,
    );
    const t =
      this.korridor.jetzt +
      (this.world.spawnY - this.cfg.player.startPosition[1]) / v;
    const mitte = this.korridor.bei(t);

    // Nur wenig streuen: das Pendeln der Münze bringt die Bewegung, nicht der
    // Abwurfort.
    const streu = this.cfg.rock.korridor.halbbreite * 0.5;
    let x = mitte + (Math.random() * 2 - 1) * streu;

    /* Geklemmt wird auf die BEWEGUNGSGRENZEN, nicht auf die Abwurfbreite —
     * und zusätzlich um die Pendelweite nach innen.
     *
     * Vorher stand hier `spawnHalfWidth` (±5.0), dazu kam ungeklemmt das
     * Pendeln (±0.55) — Münzen landeten damit bei bis zu ±5.55, während der
     * Affe nur bis ±4.6 kommt. Gemessen 0.4 % aller Münzen: sichtbar,
     * hörbar versprochen, aber nicht erreichbar. Ein Bonus, den man sehen und
     * nicht holen kann, ist schlimmer als keiner. */
    const rand = Math.max(0, this.world.bounds.maxX - this.cfg.coin.pendelWeite);
    if (x < -rand) x = -rand;
    else if (x > rand) x = rand;

    coin.spawn(x, this.world.spawnY, Math.random());
  }

  _spawnBanana(x, y) {
    const banana = this.bananas.acquire();
    if (!banana) return; // kein Drama: dann eben keine Banane
    banana.spawn(x, y, Math.random());
  }

  /**
   * Räumt alle Objekte im Umkreis um einen Punkt weg.
   *
   * Gebraucht beim Weiterspielen nach dem Tod: an der Todesstelle steht der
   * Affe mitten in dem, was ihn gerade erwischt hat. Ohne Aufräumen wäre die
   * Werbung umsonst gewesen — er stürbe im nächsten Frame erneut.
   *
   * Nur Steine, nicht die Bananen: eine Banane in Reichweite ist ein
   * Geschenk, kein Problem.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {number} wie viele Objekte verschwunden sind
   */
  clearAround(x, y, radius) {
    const r2 = radius * radius;
    let weg = 0;
    // Rückwärts iterieren: release() macht swap-remove auf `active`.
    for (let i = this.rocks.active.length - 1; i >= 0; i--) {
      const rock = this.rocks.active[i];
      const dx = rock.x - x;
      const dy = rock.y - y;
      if (dx * dx + dy * dy <= r2) {
        rock.despawn();
        this.rocks.release(rock);
        weg++;
      }
    }
    return weg;
  }

  /**
   * Sekunden zwischen zwei Münzen.
   *
   * Abgeleitet statt konfiguriert: gewollt sind "drei Münzen je Gebiet", und
   * wie lang ein Gebiet ist, steht woanders (difficulty.sekundenProWand).
   * Zwei getrennte Zahlen würden beim nächsten Verlängern auseinanderlaufen.
   */
  get muenzTakt() {
    return this.cfg.difficulty.sekundenProWand / Math.max(1, this.cfg.coin.proGebiet);
  }

  /** Münze einsammeln -> zurück in den Pool. */
  collectCoin(coin) {
    coin.despawn();
    this.coins.release(coin);
  }

  /** Banane einsammeln -> zurück in den Pool. */
  collect(banana) {
    banana.despawn();
    this.bananas.release(banana);
  }

  get activeCount() {
    return this.rocks.activeCount + this.bananas.activeCount + this.coins.activeCount;
  }

  /** Aktive Steine nach Art, für das Debug-Overlay (F1). */
  rockTypeCounts() {
    const counts = new Map();
    for (const r of this.rocks.active) {
      counts.set(r.type.id, (counts.get(r.type.id) ?? 0) + 1);
    }
    return this.cfg.rock.types.map((t) => `${t.id[0]}${counts.get(t.id) ?? 0}`).join(' ');
  }
}
