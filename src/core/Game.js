/**
 * Game — Aufbau, Zustandsautomat und Frame-Loop.
 *
 * Der Loop ist strikt deltatime-basiert; kein Wert wird pro Frame gerechnet,
 * ohne mit dt multipliziert zu werden. Grosse Zeitsprünge (Tab im Hintergrund)
 * werden gekappt, damit Entities nicht durch Kollisionen hindurchspringen.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  WebGLRenderer,
} from 'three';

import { CONFIG } from '../config.js';
import { GameState, StateMachine } from './StateMachine.js';
import { AssetLoader } from './AssetLoader.js';
import { AnimationController } from '../animation/AnimationController.js';
import { Player } from '../entities/Player.js';
import { SpritePlayer } from '../entities/SpritePlayer.js';
import { hazardSpriteUrls } from '../entities/Rock.js';
import { BossKampf } from '../systems/BossKampf.js';
import { PlantWall } from '../world/PlantWall.js';
import { DifficultyCurve } from '../systems/DifficultyCurve.js';
import { Spawner } from '../systems/Spawner.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { ScoreManager } from '../systems/ScoreManager.js';
import { CharacterStore } from '../systems/CharacterStore.js';
import { SkinStore } from '../systems/SkinStore.js';
import {
  Fortschritt,
  LokalerSpeicher,
  SupabaseSpeicher,
  spielerKennung,
  kennungSetzen,
  codeBelegen,
  codeAufloesen,
  codeVorschlag,
} from '../systems/Fortschritt.js';
import { Klang } from '../systems/Klang.js';
import { erzeugeBestenliste } from '../systems/Bestenliste.js';
import { createAdService } from '../systems/AdService.js';
import { erzeugePortal } from '../systems/Portal.js';
import { recolorFrames } from './recolor.js';
import { InputHandler } from '../input/InputHandler.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { UI } from '../ui/UI.js';
import { halfWidthAt } from './viewport.js';

export class Game {
  /**
   * @param {HTMLElement} viewport Container für den Canvas
   */
  constructor(viewport) {
    this.cfg = CONFIG;
    this.viewport = viewport;

    this.ui = new UI(CONFIG);
    this.input = new InputHandler(CONFIG.input, this.ui.touchHost);
    this.score = new ScoreManager(CONFIG.score);
    this.characters = new CharacterStore(CONFIG.characters);
    this.skins = new SkinStore(CONFIG.skins);
    // Münzen und Freigeschaltetes. Liegt hinter einer Schnittstelle, damit
    // ein Serverkonto später kein Umbau wird (siehe Fortschritt.js).
    /* Ton. Der AudioContext entsteht ERST beim ersten Klick — Browser
     * verbieten Ton ohne Nutzereingabe, und ein zu früh gebauter Kontext
     * bleibt dauerhaft stumm, ohne einen Fehler zu melden. */
    /* Weltweite Bestenliste. Ohne Zugangsdaten in CONFIG.bestenliste ist es
     * die lokale Liste — dieselbe Schnittstelle, nur ein anderer Ort. */
    this.bestenliste = erzeugeBestenliste(CONFIG.bestenliste);
    // Zählt jede Weltlisten-Anfrage mit. Eine Antwort, die nach dem nächsten
    // Lauf eintrudelt, darf den neuen Bildschirm nicht mehr beschriften.
    this._eintragNummer = 0;
    // Dasselbe für die Lauf-Marke der Weltliste.
    this._laufNummer = 0;
    this._weltLauf = null;
    /** Zuletzt eingetragener Name + Platz, damit die Liste ihn hervorhebt. */
    this._eigenerEintrag = null;
    // Wechselnde Abstaende fuer den Affenruf (siehe _affenRuf).
    this._affenSchritt = 0;
    this._affenTimer = 6;

    this.klang = new Klang(CONFIG.klang);

    this.fortschritt = new Fortschritt(CONFIG.fortschritt);
    /* MUSS vor dem ersten loadId() stehen: die Stores merken sich ihr
     * Ergebnis, ein zu spät gesetzter Prüfer käme nie zum Zug. */
    this.characters.istFrei = (id) => this.fortschritt.istFrei(id);
    this.skins.istFrei = (id) => this.fortschritt.istFrei(id);
    this.fortschritt.onAendern = (m) => this.ui.setMuenzenGesamt(m);
    // Im laufenden Lauf gesammelt — getrennt vom Gesamtbestand, damit man
    // sieht, was DIESER Versuch gebracht hat.
    this._muenzenImLauf = 0;
    // Umgefärbte Texturen gehören der Spielfigur und müssen beim nächsten
    // Wechsel wieder freigegeben werden — die Originale dagegen NICHT, die
    // liegen im Frame-Cache und werden weiterbenutzt.
    this._eigeneTexturen = [];
    this.difficulty = new DifficultyCurve(CONFIG.difficulty);
    // Die Steinmischung folgt derselben Zeitachse wie die Difficulty-Kurven,
    // steht aber bei den Steinen — deshalb hier zusammengeführt.
    this.difficulty.setRockMix(CONFIG.rock.mix);
    this.states = new StateMachine(GameState.MENU);

    // Geladene Kletter-Frames je Charakter. Beim Start wird nur der gewählte
    // Satz geladen; die anderen kommen beim ersten Auswählen dazu. Drei Sätze
    // vorzuladen würde die Ladeschritte von 30 auf 54 erhöhen — der
    // AssetLoader arbeitet die Liste streng nacheinander ab.
    this._frameCache = new Map();
    this._loader = null;
    this.character = null;
    // Laufende Nummer gegen verschränkte Charakterwechsel (siehe _pickCharacter).
    this._wechselNummer = 0;

    // Bosskampf. Beides bleibt null, bis der Adler zum ersten Mal gebraucht
    // wird — seine 26 Einzelbilder werden nicht auf Vorrat geladen.
    /** @type {import('../systems/BossKampf.js').BossKampf|null} */
    this.boss = null;
    this._bossLaedt = false;
    // In welchen Gebieten schon gekaempft wurde — jedes nur einmal.
    this._bossGehabt = new Set();
    /** Restsekunden Goldmodus (0 = aus). */
    this._goldRest = 0;
    /** @type {import('three').Texture[]|null} goldenes Fell, erst bei Bedarf geladen */
    this._goldFrames = null;

    // Wirksame Spielfeldmasse. Start = Config, die seitlichen Grenzen werden
    // aber bei jedem Resize an das tatsächlich Sichtbare angepasst (siehe
    // _onResize). Spawner und Player halten eine Referenz auf DIESES Objekt,
    // damit sie die Anpassung ohne Umweg mitbekommen.
    this.worldView = {
      ...CONFIG.world,
      bounds: { ...CONFIG.world.bounds },
      // Wird in _updateWorldBounds aus CONFIG.world.bahnen berechnet.
      bahnX: CONFIG.world.bahnen.map((a) => a * CONFIG.world.bounds.maxX),
    };

    this._buildRenderer();
    this._buildScene();

    // Wiederverwendeter Kontext für den AnimationController (keine Allokation).
    this._animCtx = { speed: 0, vx: 0, vy: 0 };

    // Kollisions-Handler einmal binden statt pro Frame Closures zu erzeugen.
    this._collisionHandlers = {
      onRock: (rock) => this._onRockHit(rock),
      onBanana: (banana) => this._onBananaHit(banana),
      onCoin: (coin) => this._onCoinHit(coin),
    };

    // Zweites Leben per Werbung. `ads` ist austauschbar (siehe AdService.js);
    // das Spiel kennt davon nur show() und isReady().
    // Portal (CrazyGames / GameMonetize). Wird in load() initialisiert;
    // bis dahin steht der Platzhalter, damit nichts auf ein fremdes SDK wartet.
    this.portal = erzeugePortal(CONFIG.ad);
    this.ads = createAdService(CONFIG.ad);
    this._adsUsed = 0;
    this._adRunning = false;

    // Musiktempo: Zahl der Gebietswechsel seit Rundenbeginn (siehe
    // _updatePlaying) und das zuletzt gesehene Gebiet.
    this._gebietWechsel = 0;
    this._letztesGebiet = null;

    this._deathTimer = 0;
    this._lastTime = 0;
    this._running = false;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fps = 0;

    this._tick = this._tick.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  /* ==================================================================== Setup */

  _buildRenderer() {
    const { render } = this.cfg;
    this.renderer = new WebGLRenderer({
      antialias: render.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, render.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(render.clearColor, 1);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.viewport.appendChild(this.renderer.domElement);
  }

  _buildScene() {
    const { render } = this.cfg;
    this.scene = new Scene();

    const cam = render.camera;
    this.camera = new PerspectiveCamera(
      cam.fov,
      window.innerWidth / window.innerHeight,
      cam.near,
      cam.far,
    );
    this.camera.position.set(...cam.position);
    this.camera.lookAt(...cam.lookAt);

    const ambient = new AmbientLight(render.lights.ambient.color, render.lights.ambient.intensity);
    this.scene.add(ambient);

    const key = new DirectionalLight(render.lights.key.color, render.lights.key.intensity);
    key.position.set(...render.lights.key.position);
    this.scene.add(key);

    const fill = new DirectionalLight(render.lights.fill.color, render.lights.fill.intensity);
    fill.position.set(...render.lights.fill.position);
    this.scene.add(fill);
  }

  /**
   * Wählt den zweiten Speicher für Münzen und Freigeschaltetes.
   *
   * Erst NACH `portal.init()` möglich: vorher steht nicht fest, wo gespielt
   * wird. Die Reihenfolge ist eine Rangfolge, keine Geschmacksfrage:
   *
   *  1. CrazyGames — hängt am Konto des Spielers. Wer sich dort anmeldet,
   *     findet seine Münzen auf jedem Gerät wieder, ganz ohne Code.
   *  2. Supabase — für die eigene Website. Gebunden an eine selbstvergebene
   *     Kennung, die zugleich der Wiederherstellungscode ist.
   *  3. Nichts weiter — dann bleibt es beim Browserspeicher, und das Spiel
   *     funktioniert vollständig, nur eben auf diesem Gerät.
   */
  _fortschrittSpeicherWaehlen() {
    const portalSpeicher = this.portal.datenSpeicher?.();
    if (portalSpeicher) {
      this.fortschritt.fernSetzen(
        new LokalerSpeicher(this.cfg.fortschritt.storageKey, portalSpeicher),
      );
      console.info('[Fortschritt] Portalspeicher aktiv — hängt am Spielerkonto.');
      return;
    }

    const b = this.cfg.bestenliste;
    if (b?.url && b?.schluessel) {
      this.spielerId = spielerKennung(this.cfg.fortschritt.spielerKey);
      this.fortschritt.fernSetzen(new SupabaseSpeicher(b, this.spielerId));
      console.info('[Fortschritt] Supabase aktiv.');
      return;
    }

    console.info('[Fortschritt] Nur Browserspeicher — kein Portal, keine Datenbank.');
  }

  /**
   * Fortschritt von einem anderen Gerät holen.
   *
   * BEWUSST OHNE ZUSAMMENFÜHREN: hier wird der Stand des eingegebenen Codes
   * geladen und der bisherige ersetzt. Würde ich wie beim normalen Start
   * zusammenführen ("mehr Münzen gewinnt"), bekäme man beim Übertragen die
   * Summe aus zwei Ständen — und das ist ein Weg, sich Münzen zu verdoppeln,
   * ohne zu spielen.
   */
  async _codeLaden(code) {
    const b = this.cfg.bestenliste;
    if (!b?.url || !b?.schluessel) {
      this.ui.setUebertragStatus('Ohne Server gibt es nichts zu übertragen.');
      return;
    }

    this.ui.setUebertragBesetzt(true);
    this.ui.setUebertragStatus('wird geladen…');

    /* ERST AUFLÖSEN, DANN DIE EIGENE KENNUNG ÜBERSCHREIBEN.
     *
     * Die vorige Fassung rief `kennungSetzen(code)` als ERSTES und lud
     * danach. Wer einen gültig geformten, aber unbekannten Code eintippte,
     * hatte damit schon seine eigene Kennung überschrieben — die Meldung
     * "Zu diesem Code ist nichts gespeichert" kam zu spät, der Zugang zum
     * eigenen Serverstand war weg. Jetzt wird nichts angefasst, bevor der
     * Server die Kennung wirklich herausgegeben hat. */
    const auf = await codeAufloesen(b, code);
    if (!auf.ok) {
      this.ui.setUebertragBesetzt(false);
      this.ui.setUebertragStatus(auf.meldung);
      return;
    }

    const speicher = new SupabaseSpeicher(b, auf.kennung);
    const stand = await speicher.laden();
    if (!stand) {
      this.ui.setUebertragBesetzt(false);
      this.ui.setUebertragStatus('Zu diesem Code ist nichts gespeichert.');
      return;
    }

    // Jetzt erst umschalten — ab hier ist der Wechsel vollzogen.
    kennungSetzen(this.cfg.fortschritt.spielerKey, auf.kennung);
    this.spielerId = auf.kennung;
    this.fortschritt.fern = speicher;
    this.fortschritt.muenzen = stand.muenzen;
    this.fortschritt.frei = new Set([...stand.frei, ...this.cfg.fortschritt.immerFrei]);
    this.fortschritt._sichern();

    this.ui.setUebertragBesetzt(false);
    this.ui.setUebertragCode(String(code).trim());
    this.ui.setUebertragStatus(`Übernommen: ${stand.muenzen} Münzen.`);
    // Die Kacheln zeigen sonst weiter die alten Schlösser.
    this._openCharacters();
  }

  /**
   * Vier Ziffern für dieses Gerät belegen.
   *
   * Ein Code wird ERST HIER vergeben, nicht schon beim ersten Spielstart.
   * Es gibt nur zehntausend davon; wer nie das Gerät wechselt, soll keinen
   * verbrauchen.
   */
  async _codeBelegen(code) {
    const b = this.cfg.bestenliste;
    if (!b?.url || !b?.schluessel) {
      this.ui.setUebertragStatus('Ohne Server gibt es nichts zu übertragen.');
      return;
    }
    if (!this.spielerId) {
      this.ui.setUebertragStatus('Noch keine Kennung — bitte einmal spielen.');
      return;
    }

    this.ui.setUebertragBesetzt(true);
    this.ui.setUebertragStatus('wird eingetragen…');

    const erg = await codeBelegen(b, this.spielerId, code);
    this.ui.setUebertragBesetzt(false);

    if (!erg.ok) {
      this.ui.setUebertragStatus(erg.meldung);
      return;
    }

    /* Gleich einmal sichern, damit hinter dem Code auch etwas steht.
     *
     * Der Serverstand entsteht sonst erst beim ersten Münzgewinn. Wer sich
     * einen Code aussucht, bevor er je eine Münze eingesammelt hat, und ihn
     * sofort auf dem zweiten Gerät eingibt, bekäme "Zu diesem Code ist
     * nichts gespeichert" — und würde völlig zu Recht denken, das Belegen
     * habe nicht funktioniert. */
    this.fortschritt._sichern();

    this.ui.setUebertragCode(erg.code);
    this.ui.setUebertragStatus(`Code ${erg.code} gehört jetzt dir.`);
  }

  /**
   * Einen freien Code holen — und zwar verbindlich.
   *
   * Der Server sucht und belegt in einem Zug. Ein blosser Vorschlag hätte
   * dem Spieler "ist frei" gesagt und beim anschliessenden Bestätigen
   * "schon vergeben" — bei zehntausend Plätzen kein Randfall.
   */
  async _codeVorschlag() {
    const b = this.cfg.bestenliste;
    if (!b?.url || !b?.schluessel) {
      this.ui.setUebertragStatus('Ohne Server gibt es nichts zu übertragen.');
      return;
    }
    if (!this.spielerId) {
      this.ui.setUebertragStatus('Noch keine Kennung — bitte einmal spielen.');
      return;
    }

    this.ui.setUebertragBesetzt(true);
    this.ui.setUebertragStatus('wird geholt…');
    const erg = await codeVorschlag(b, this.spielerId);
    this.ui.setUebertragBesetzt(false);

    if (!erg.ok) {
      this.ui.setUebertragStatus(erg.meldung);
      return;
    }

    // Gleich sichern, damit hinter dem Code auch etwas steht — sonst meldet
    // das zweite Gerät "nichts gespeichert" (siehe _codeBelegen).
    this.fortschritt._sichern();

    this.ui.setUebertragCode(erg.code);
    this.ui.setUebertragStatus(`Code ${erg.code} gehört jetzt dir.`);
  }

  /* ================================================================== Laden */

  async load() {
    /* Portal ZUERST: es will wissen, dass geladen wird, und der Spot-Anbieter
     * muss stehen, bevor der erste Game-Over-Screen kommen kann. Schlägt es
     * fehl, läuft alles Weitere unverändert weiter — siehe Portal.js. */
    await this.portal.init();
    this.portal.ladenStart();
    this.ads = createAdService(this.cfg.ad, this.portal);
    this._fortschrittSpeicherWaehlen();

    const loader = new AssetLoader();
    loader.onProgress = (fraction, label) => this.ui.setProgress(fraction, label);
    this._loader = loader; // bleibt für das Nachladen weiterer Affen erhalten

    const spriteMode = this.cfg.player.mode === 'sprite';

    // Der Modell-Modus kennt keine Charaktere — es gibt nur ein GLB. Er läuft
    // deshalb unverändert mit den Werten aus CONFIG.player.
    const char = spriteMode ? this.characters.load() : null;

    // Alle Stufentexturen vorladen: der Wechsel soll später ruckelfrei
    // überblenden, nicht erst nachladen.
    const textureUrls = [];
    for (const stage of this.cfg.wall.stages) textureUrls.push(stage.near, stage.far);

    // Nur die Frames laden, die der Zyklus wirklich benutzt — im Ordner
    // liegen alle 20 aus dem Spritesheet.
    const frameUrls = spriteMode
      ? charFrames(char).map((n) => frameUrl(n, char.framePath))
      : [];
    textureUrls.push(...frameUrls);

    const { gltf, textures } = await loader.loadAll({
      modelUrl: spriteMode ? null : '/models/monkey.glb',
      textureUrls,
    });

    /* --- Wand ---------------------------------------------------------- *
     * Jede Ebene braucht eine EIGENE Texturinstanz: Offset und Kachelzahl
     * liegen auf der Textur, geteilte Instanzen würden sich gegenseitig
     * überschreiben. clone() teilt die GPU-Daten, kostet also kaum Speicher.
     */
    const getTexture = (url) => {
      const base = textures.get(url);
      if (!base) {
        console.warn(`[Game] Textur fehlt: ${url}`);
        return null;
      }
      const t = base.clone();
      t.wrapS = RepeatWrapping;
      t.wrapT = RepeatWrapping;
      t.needsUpdate = true;
      return t;
    };

    this.wall = new PlantWall(this.cfg.wall, getTexture, this.camera);
    this.scene.add(this.wall.group);

    /* --- Affe ---------------------------------------------------------- */
    if (spriteMode) {
      this._frameCache.set(char.id, frameUrls.map((u) => textures.get(u)));
      this._buildPlayer(char);
    } else {
      this.anim = new AnimationController(gltf.scene, gltf.animations, this.cfg.animation);
      this.player = new Player(gltf.scene, this.anim, this.cfg.player, this.cfg.revive);
      this.scene.add(this.player.object3D);
    }

    /* --- Fallende Objekte ---------------------------------------------- *
     * Erst NACH den grossen Texturen und parallel: knapp 30 kleine Bilder,
     * die nacheinander nur Latenz kosten würden. */
    const hazardTexturen = await loader.loadTexturesParallel([
      ...hazardSpriteUrls(this.cfg.rock),
      this.cfg.coin.bild,
      this.cfg.banana.bild,
    ]);

    /* --- Spawner + Debug ----------------------------------------------- */
    this.spawner = new Spawner(
      this.scene,
      this.cfg,
      this.difficulty,
      this.worldView,
      hazardTexturen,
      hazardTexturen.get(this.cfg.coin.bild) ?? null,
      hazardTexturen.get(this.cfg.banana.bild) ?? null,
    );
    // Der Spawner entsteht NACH der Spielfigur — _buildPlayer konnte sein
    // Bananen-Flag oben also noch nicht setzen. Hier nachholen, sonst fielen
    // für den weissen Affen beim ersten Laden doch Bananen (nur nach einem
    // Wechsel wäre es richtig gewesen).
    if (this.character) this.spawner.bananasEnabled = this.character.bananas;
    this.portal.ladenFertig();
    this.debug = new DebugOverlay(
      this.scene,
      this.cfg.debug,
      this.cfg.rock.poolSize + this.cfg.banana.poolSize + 1,
    );

    this._wireUI();
    this._wireStates();

    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Im Hintergrund automatisch pausieren — sonst läuft man beim
        // Zurückkommen in einen riesigen dt und stirbt sofort.
        if (this.states.is(GameState.PLAYING)) this._pause();
        /* Ton IMMER stilllegen, nicht nur im laufenden Spiel. Vorher dudelte
         * die Atmosphäre im Menü und auf dem Game-Over-Bildschirm in einem
         * versteckten Tab munter weiter — auf einer Portalseite mit mehreren
         * offenen Spielen ist das ein berechtigter Beschwerdegrund. */
        this.klang.anhalten();
      } else if (!this.states.is(GameState.PAUSED) && !this._adRunning) {
        /* `_adRunning` ist der zweite Wächter und nicht überflüssig: während
         * eines Spots ist der Zustand GAME_OVER, nicht PAUSED. Ohne ihn legte
         * die Rückkehr aus einem anderen Tab den Spielton über die Werbung. */
        this.klang.fortsetzen();
      }
    });

    this._onResize();

    this.anim.setMode('menu');
    /* Das Startmenü bekommt seine Atmosphäre auf demselben Weg wie jedes
     * spätere Menü. Nötig, weil der Zustandsautomat beim Anlegen KEIN
     * onEnter feuert — das erste Menü ist der einzige Bildschirm, den kein
     * Übergang erreicht, und blieb deshalb als einziger stumm. `atmo()` merkt
     * sich den Wunsch und löst ihn bei der ersten Eingabe ein. */
    this.klang.atmo('gruen');
    this.ui.showMenu(this.score.loadHighscores());
    this.ui.setStats(this.cfg.debug.showStats ? '' : null);

    return {
      mode: this.cfg.player.mode,
      clips: this.anim.clipNames ?? [],
      stages: this.cfg.wall.stages.map((s) => `${s.name}@${s.afterSeconds}s`),
    };
  }

  /* ============================================================ Bosskampf */

  /**
   * Ist in diesem Gebiet ein Bosskampf fällig?
   *
   * Gezählt werden Gebietswechsel seit Rundenbeginn — dieselbe Zählung, die
   * auch das Musiktempo steuert. Ab `abGebiet` der erste, danach alle
   * `jedesXteGebiet`.
   *
   * @param {number} gebiet 0-basierte Nummer des gerade erreichten Gebiets
   */
  _bossFaellig(gebiet) {
    const b = this.cfg.boss;
    if (gebiet + 1 < b.abGebiet) return false;
    return (gebiet + 1 - b.abGebiet) % b.jedesXteGebiet === 0;
  }

  /**
   * Kampf starten. Lädt beim ersten Mal die Bilder nach.
   *
   * BEWUSST OHNE await AUFGERUFEN: der Lauf soll nicht stehenbleiben,
   * während 26 Adlerbilder über die Leitung kommen. Kommen sie zu spät,
   * beginnt der Kampf eben eine halbe Sekunde später — die Warnung steht ja
   * ohnehin davor.
   */
  async bossStarten() {
    if (this.boss?.aktiv) return false;
    if (this._bossLaedt) return false;
    if (!this.states.is(GameState.PLAYING)) return false;

    if (!this.boss) {
      this._bossLaedt = true;
      try {
        this.boss = await this._bossBauen();
      } catch (fehler) {
        console.error('[Boss] konnte nicht geladen werden:', fehler);
        return false;
      } finally {
        this._bossLaedt = false;
      }
      // Während des Ladens kann der Lauf zu Ende sein.
      if (!this.states.is(GameState.PLAYING) || !this.player.alive) return false;
    }

    return this.boss.starten(this.player);
  }

  /**
   * Baut den Kampf samt aller Bilder auf. Läuft höchstens einmal je Sitzung —
   * danach bleibt `this.boss` bestehen und wird wiederverwendet.
   */
  async _bossBauen() {
    const b = this.cfg.boss;

    const adlerPfade = [];
    for (const [satz, n] of [
      ['flug', 12],
      ['kacken', 14],
    ]) {
      for (let i = 0; i < n; i++) {
        adlerPfade.push(`/boss/adler_${satz}/f_${String(i).padStart(2, '0')}.webp`);
      }
    }
    const kackPfade = b.kacke.arten.map((a) => a.bild);
    const wurfPfade = Array.from(
      { length: 12 },
      (_, i) => `/textures/wurf/move_${String(i).padStart(2, '0')}.webp`,
    );

    const texturen = await this._loader.loadTexturesParallel(
      [...adlerPfade, ...kackPfade, ...wurfPfade, b.belohnung.bild, this.cfg.banana.bild],
      'Adler…',
    );

    // Wurfbilder gehören dem Affen, nicht dem Kampf — er behält sie.
    this.player.setzeWurfFrames?.(
      wurfPfade.map((p) => texturen.get(p)),
      b.wurf,
    );

    const kackBilder = new Map();
    for (const p of kackPfade) kackBilder.set(p, texturen.get(p));

    return new BossKampf(
      this.scene,
      b,
      {
        flug: adlerPfade.slice(0, 12).map((p) => texturen.get(p)),
        kacken: adlerPfade.slice(12).map((p) => texturen.get(p)),
        kacke: kackBilder,
        // Dieselbe Banane wie zum Einsammeln, nur halb so gross geworfen.
        banane: texturen.get(this.cfg.banana.bild) ?? null,
        goldBanane: texturen.get(b.belohnung.bild) ?? null,
      },
      {
        klang: this.klang,
        ui: this.ui,
        spawner: this.spawner,
        // Ein Kacketreffer wirkt GENAU wie ein Stein — Wiederbelebung, Tod
        // und Verzögerung bis zum Game Over gehören dem Spiel, nicht dem
        // Kampf. Sonst gäbe es zwei Stellen, die über den Tod entscheiden.
        onTreffer: () => this._onRockHit(null),
        onBelohnung: () => this._goldmodusStarten(),
        onEnde: () => {
          // Nach dem Kampf wieder die normale Gebietsmusik, im Tempo des
          // erreichten Gebiets.
          this.klang.tempo?.(this._musikTempo());
        },
      },
    );
  }

  /**
   * Goldene Banane eingesammelt: 30 Sekunden goldener Affe, dreifache Münzen.
   */
  _goldmodusStarten() {
    const b = this.cfg.boss.belohnung;
    this._goldRest = b.goldSekunden;
    this.ui.toast(`Goldmodus! ${b.muenzFaktor}× Münzen`, 'banana');
    this.klang.effekt('banane');

    // Das goldene Fell beim ersten Mal nachladen und dann behalten.
    if (this._goldFrames) {
      this.player.fellWechseln?.(this._goldFrames);
      return;
    }
    const pfade = Array.from(
      { length: 12 },
      (_, i) => `/textures/gold/move_${String(i).padStart(2, '0')}.webp`,
    );
    this._loader
      .loadTexturesParallel(pfade, 'Goldaffe…')
      .then((t) => {
        this._goldFrames = pfade.map((p) => t.get(p)).filter(Boolean);
        // Nur anziehen, wenn der Goldmodus dann noch läuft.
        if (this._goldRest > 0) this.player.fellWechseln?.(this._goldFrames);
      })
      .catch((f) => console.warn('[Boss] Goldfell fehlt:', f));
  }

  /** Zählt den Goldmodus herunter und zieht dem Affen das Fell wieder aus. */
  _goldmodusSchritt(dt) {
    if (this._goldRest <= 0) return;
    this._goldRest -= dt;
    if (this._goldRest <= 0) {
      this._goldRest = 0;
      this.player.fellWechseln?.(null);
      this.ui.toast('Goldmodus vorbei', 'revive');
    }
  }

  /** Münzfaktor dieses Augenblicks — 1 normal, 3 im Goldmodus. */
  get _muenzFaktor() {
    return this._goldRest > 0 ? this.cfg.boss.belohnung.muenzFaktor : 1;
  }

  /**
   * Musiktempo für das aktuelle Gebiet.
   *
   * Steht hier und nicht im Loop, weil es an ZWEI Stellen gebraucht wird:
   * beim Gebietswechsel und nach dem Bosskampf, wenn von der Bossmusik
   * zurückgeblendet wird. Zwei Kopien derselben Formel wären genau die Art
   * Fehler, die man erst hört und dann sucht.
   */
  _musikTempo() {
    const m = this.cfg.klang.musik;
    return Math.min(m.tempoMax, 1 + this._gebietWechsel * m.tempoProGebiet);
  }

  /* ========================================================== Charaktere */

  /**
   * Baut die Spielfigur für einen Charakter — beim Start und bei jedem
   * Wechsel.
   *
   * NEU BAUEN, nicht umkonfigurieren: die Sprite-Masse stecken nach dem
   * Konstruktor in der PlaneGeometry (SpritePlayer erzeugt sie aus
   * spriteHeight mal Seitenverhältnis der Textur) und ändern sich danach
   * nie wieder. Ein blosser Austausch des cfg-Objekts ergäbe einen Affen mit
   * neuen Zahlen, aber alter Grösse.
   *
   * Die drei Config-Objekte werden KOPIERT. Game reicht sie als Referenz an
   * die Spielfigur weiter und SpritePlayer hält sie fest — würde man
   * CONFIG.player direkt verändern, wären die braunen Referenzwerte
   * dauerhaft weg, auch nach dem Zurückwechseln.
   */
  _buildPlayer(char) {
    const alt = this.player;
    if (alt) {
      this.scene.remove(alt.object3D);
      alt.dispose?.();
    }

    // Texturen des VORHERIGEN Skins freigeben. Nur die selbst erzeugten —
    // die Originale liegen im Frame-Cache und werden weiterverwendet.
    for (const t of this._eigeneTexturen) t.dispose();
    this._eigeneTexturen = [];

    const skin = this.skins.load();
    const { textures: frames, erzeugt } = recolorFrames(
      this._frameCache.get(char.id),
      skin?.filter,
    );
    if (erzeugt) this._eigeneTexturen = frames;
    this.skin = skin;

    const playerCfg = {
      ...this.cfg.player,
      ...char.player,
      // Charakterregeln, die die Spielfigur selbst auswerten muss.
      bananas: char.bananas,
      ignoreRockRadius: char.ignoreRockRadius,
    };
    const reviveCfg = { ...this.cfg.revive, maxStored: char.maxStored };

    const ol = this.cfg.sprite.outline;
    const spriteCfg = {
      ...this.cfg.sprite,
      framePath: char.framePath,
      cycleSpeed: char.cycleSpeed,
      outline: {
        ...ol,
        // Der Versatz ist ein ABSOLUTES Weltmass. Beim halb so grossen Affen
        // bliebe der Schatten sonst gleich gross und wirkte doppelt so schwer.
        offset: [ol.offset[0] * char.artScale, ol.offset[1] * char.artScale],
        // Manche Fellfarben brauchen einen kräftigeren Umriss, um sich von der
        // Wand abzuheben (grün vor grün, schwarz vor dunklem Laub).
        ...(this.skin?.outline ?? {}),
      },
    };

    this.player = new SpritePlayer(frames, playerCfg, reviveCfg, spriteCfg);
    this.anim = this.player.animator;
    this.scene.add(this.player.object3D);
    this.character = char;

    // Die seitlichen Grenzen hängen am Trefferradius — nach einem Wechsel neu
    // rechnen, sonst gälte bis zum nächsten Resize das alte Band.
    this._updateWorldBounds();

    // Der weisse Affe bekommt gar keine Bananen: weder Spawn noch Anzeige.
    if (this.spawner) {
      this.spawner.bananasEnabled = char.bananas;
      // Die Lücken-Garantie hängt an den Massen des Affen: sein Trefferradius
      // bestimmt, wie breit die Bahn frei bleiben muss, seine Geschwindigkeit,
      // wie schnell sie sich bewegen darf. Ohne diese Zeile behielte der
      // langsame orange Affe die Bahn des schnellen weissen — und käme ihr
      // nicht hinterher.
      this.spawner.setSpieler(this.player.cfg);
    }
    this.ui.setReviveVisible(char.bananas && char.maxStored > 0);
  }

  /** Kletter-Frames eines Charakters holen — beim ersten Mal nachladen. */
  async _ensureFrames(char) {
    if (this._frameCache.has(char.id)) return;
    const urls = charFrames(char).map((n) => frameUrl(n, char.framePath));
    const { textures } = await this._loader.loadAll({ textureUrls: urls });
    this._frameCache.set(char.id, urls.map((u) => textures.get(u)));
  }

  /**
   * Charakter wählen.
   *
   * VERSCHRÄNKUNG: Diese Methode ist async (die Frames werden beim ersten Mal
   * nachgeladen), wird aber aus einem Klick-Callback ohne await gerufen.
   * Zwischen Klick und Fertigstellung kann der Spieler weiterklicken —
   * "Zurück" drücken, ein Spiel starten, die Auswahl erneut öffnen und einen
   * anderen Affen nehmen. Ohne Absicherung passierte dann Folgendes:
   *
   *   - Der fertig geladene Wechsel riss hinterher das Hauptmenü über das
   *     bereits laufende Spiel; der Zustand blieb PLAYING, "Spiel starten"
   *     reagierte nicht mehr.
   *   - Bei zwei Wechseln gewann der zuletzt FERTIGE, nicht der zuletzt
   *     GEKLICKTE — und wurde dauerhaft gespeichert.
   *
   * Deshalb eine laufende Nummer: Beim Eintritt wird sie erhöht und gemerkt.
   * Nach dem await zählt der Wechsel nur noch, wenn er immer noch der
   * aktuellste ist UND die Auswahl überhaupt noch offen steht.
   */
  /**
   * Fellfarbe anlegen.
   *
   * Anders als der Charakterwechsel ist das SYNCHRON — es wird nichts
   * nachgeladen, die vorhandenen Frames werden nur umgefärbt. Der
   * Auswahl-Screen bleibt deshalb offen: man kann Farben durchprobieren und
   * sieht das Ergebnis sofort auf den Kacheln.
   */
  _pickSkin(id) {
    if (!this.skins.save(id)) return;
    if (this.character) this._buildPlayer(this.character);
    this.anim.setMode('menu');
    this.anim.reset();
    this.ui.showSkins(this.skins.all, this.skins.loadId(), undefined, this._besitzSicht);
  }

  async _pickCharacter(id) {
    const char = this.cfg.characters.list[id];
    if (!char) return;
    // Schon gewählt? Dann ist nichts zu tun — die Auswahl bleibt OFFEN,
    // damit danach noch das Fell drankommt.
    if (char.id === this.character?.id) return;

    /* Gesperrtes lässt sich hier nicht auswählen. Die UI fängt es schon ab,
     * aber das ist die Stelle, die WIRKT — und sie wird auch aus load()
     * heraus mit einer gespeicherten ID gerufen. */
    if (!this.fortschritt.istFrei(id)) {
      this.ui.showCharacterError(`${char.label} ist noch gesperrt.`);
      return;
    }

    const meineNummer = ++this._wechselNummer;
    this.ui.setCharactersBusy(true);

    try {
      await this._ensureFrames(char);
    } catch (err) {
      console.warn('[Game] Charakter liess sich nicht laden:', err);
      if (meineNummer === this._wechselNummer) {
        this.ui.setCharactersBusy(false);
        this.ui.showCharacterError(`${char.label} liess sich nicht laden.`);
      }
      return;
    }

    // Überholt worden oder die Auswahl ist gar nicht mehr offen? Dann still
    // aussteigen — die Frames liegen jetzt im Cache, mehr sollte nicht
    // passieren.
    if (meineNummer !== this._wechselNummer) return;
    if (this.ui.currentScreen !== 'characters') {
      this.ui.setCharactersBusy(false);
      return;
    }

    this.characters.save(id);
    this._buildPlayer(char);
    this.anim.setMode('menu');
    this.anim.reset();

    this.ui.setCharactersBusy(false);
    /* NICHT schliessen. Der Ablauf ist "Affe, dann Fell, dann Los!" — wer
     * hier zumacht, nimmt dem Spieler den zweiten Schritt weg, obwohl der
     * Bildschirm ihn ausdrücklich verspricht. */
    this._zeichneAuswahl();
  }

  /** Nur-Lese-Sicht auf den Besitz für die Anzeige. */
  get _besitzSicht() {
    return {
      istFrei: (id) => this.fortschritt.istFrei(id),
      muenzen: this.fortschritt.muenzen,
    };
  }

  /**
   * Kachel angeklickt, die noch gesperrt ist.
   *
   * Der Kauf passiert in Fortschritt.kaufen — bewusst NICHT hier: sonst gäbe
   * es zwei Stellen, an denen Münzen abgezogen werden, und eine davon wäre
   * irgendwann falsch.
   */
  _kaufen(art, id) {
    const eintrag =
      art === 'skin' ? this.cfg.skins.list[id] : this.cfg.characters.list[id];
    if (!eintrag) return;

    const preis = eintrag.kosten ?? 0;
    if (!this.fortschritt.kaufen(id, preis)) {
      const fehlt = preis - this.fortschritt.muenzen;
      this.ui.showCharacterError(
        `${eintrag.label} kostet ${preis} Münzen — dir fehlen noch ${fehlt}.`,
      );
      return;
    }

    this.ui.showCharacterError('');
    this.klang.effekt('frei');
    this.ui.toast(`${eintrag.label} freigeschaltet!`, 'banana');
    // Frisch Gekauftes gleich auswählen: wer 150 Münzen ausgibt, will es
    // benutzen und nicht danach noch einmal klicken.
    if (art === 'skin') this._pickSkin(id);
    else this._pickCharacter(id);
    this._zeichneAuswahl();
  }

  /** Beide Listen neu zeichnen (Besitz hat sich geändert). */
  _zeichneAuswahl() {
    this.ui.setMuenzenGesamt(this.fortschritt.muenzen);
    this.ui.showCharacters(this.characters.all, this.characters.loadId(), this._besitzSicht);
    this.ui.showSkins(
      this.skins.all,
      this.skins.loadId(),
      undefined,
      this._besitzSicht,
    );
  }

  _openCharacters() {
    // KEIN Zustandswechsel: der Automat erlaubt aus MENU nur PLAYING und
    // wirft bei allem anderen. Die Auswahl ist reine Oberfläche.
    this._zeichneAuswahl();
    this.ui.showScreen('characters');
  }

  _closeCharacters() {
    // Einen noch laufenden Wechsel für ungültig erklären: wer die Auswahl
    // verlässt, will keinen Affen mehr getauscht bekommen.
    this._wechselNummer++;
    this.ui.showMenu(this.score.loadHighscores());
  }

  /* =============================================================== Verdrahtung */

  _wireUI() {
    this.ui.callbacks.onStart = () => this._startRun();
    this.ui.callbacks.onRetry = () => this._startRun();
    this.ui.callbacks.onResume = () => this._resume();
    this.ui.callbacks.onMenu = () => this._toMenu();
    this.ui.callbacks.onSubmitName = (name) => this._submitName(name);
    this.ui.callbacks.onCharacters = () => this._openCharacters();
    this.ui.callbacks.onCharactersBack = () => this._closeCharacters();
    this.ui.callbacks.onPickCharacter = (id) => this._pickCharacter(id);
    this.ui.callbacks.onPickSkin = (id) => this._pickSkin(id);
    this.ui.callbacks.onKaufen = (art, id) => this._kaufen(art, id);
    this.ui.callbacks.onErsteEingabe = () => this.klang.aufwecken();
    this.ui.callbacks.onTonUmschalten = () => this._tonUmschalten();
    // Pause per Knopf. Am Handy der einzige Weg: dort gibt es kein Escape.
    this.ui.callbacks.onPause = () => this._pause();
    this.ui.callbacks.onCodeLaden = (code) => this._codeLaden(code);
    this.ui.callbacks.onCodeBelegen = (code) => this._codeBelegen(code);
    this.ui.callbacks.onCodeVorschlag = () => this._codeVorschlag();

    /* Der Bereich ist nur sinnvoll, wenn es einen Server gibt. Angezeigt wird
     * ANFANGS KEIN CODE: einen zu vergeben kostet einen von zehntausend
     * Plätzen, und das soll nur passieren, wenn jemand wirklich übertragen
     * will. Wer schon einen hat, holt ihn sich über "Code merken" zurück —
     * dieselbe Kennung bekommt denselben Code wieder. */
    const hatServer = Boolean(this.cfg.bestenliste?.url && this.cfg.bestenliste?.schluessel);
    this.ui.setUebertragVerfuegbar(hatServer && Boolean(this.spielerId));
    // Der Schalter muss zeigen, was gespeichert ist — sonst steht dort nach
    // einem Neuladen "Ton an", obwohl er ausgeschaltet bleibt.
    this.ui.setTon(this.klang.stumm);
    // "Los!" startet direkt aus der Auswahl — man hat gerade seinen Affen und
    // sein Fell gewählt, der Umweg über das Hauptmenü wäre ein Klick zu viel.
    this.ui.callbacks.onCharactersGo = () => {
      this._wechselNummer++;
      this._startRun();
    };
    this.ui.callbacks.onWatchAd = () => this._watchAd();
    this.ui.callbacks.onDeclineAd = () => this._showGameOverScreen();
    this.ui.callbacks.onCancelAd = () => this.ads.cancel();
  }

  _wireStates() {
    // Joystick nur im laufenden Spiel annehmen — in Menüs gehören Berührungen
    // den Buttons.
    this.states.onChange((_from, to) => {
      this.input.setTouchCapture(to === GameState.PLAYING);

      /* Dem Portal sagen, wann wirklich gespielt wird. Es legt seine Spots
       * danach — ohne dieses Signal kommt einer mitten in eine
       * Ausweichbewegung. Bewusst HIER und nicht an den einzelnen
       * Aufrufstellen: der Zustandsautomat ist die einzige Stelle, an der
       * kein Übergang vergessen werden kann. */
      if (to === GameState.PLAYING) this.portal.spielStart();
      else this.portal.spielStop();
    });

    this.states.onEnter(GameState.MENU, () => {
      /* Erst den Ton wieder anwerfen, dann umschalten.
       *
       * Über "Pause -> Hauptmenü" kommt man hier mit angehaltenem Tonkontext
       * an (die Pause hat ihn stillgelegt). Ohne dieses `fortsetzen()` blieb
       * das Hauptmenü auf diesem Weg komplett stumm, während es nach "Game
       * Over -> Hauptmenü" den Dschungel spielte — derselbe Bildschirm klang
       * je nach Weg dorthin verschieden. */
      this.klang.fortsetzen();
      /* Im Menue laeuft die gruene Wand — dann soll auch der Dschungel zu
       * hoeren sein und nicht die Lava des letzten Laufs.
       *
       * ZUERST DAS TEMPO ZURÜCK. `Musik.tempo()` legt die Rate auf ALLE
       * Gebietseinträge, also auch auf 'gruen'. Ohne diese Zeile spielte das
       * Hauptmenü nach einem langen Lauf mit bis zu 1.35 weiter — bis der
       * Spieler die nächste Runde startet, wo _startRun ohnehin zurücksetzt. */
      this.klang.tempoZuruecksetzen();
      this.klang.atmo('gruen');
      this.anim.setMode('menu');
      this.ui.showMenu(this.score.loadHighscores());
    });

    this.states.onEnter(GameState.PLAYING, (payload, from) => {
      this.ui.showScreen('playing');
      this.klang.fortsetzen();
      // Der Brüller gehört zum Start, nicht zum Aufstehen nach Werbung.
      if (from !== GameState.PAUSED && !payload?.weiter) this.klang.effekt('affe');
      // Beim Weiterspielen NICHT zurücksetzen: der Affe steht schon richtig
      // (reviveInPlace hat das erledigt) und blinkt gerade unverwundbar. Ein
      // anim.reset() würde das Blinken abwürgen, der Brüller wäre fehl am
      // Platz — er gehört zum Start, nicht zum Aufstehen.
      if (from !== GameState.PAUSED && !payload?.weiter) {
        this.anim.setMode('locomotion');
        this.anim.reset();
        this.anim.playOneShot('roar');
      }
    });

    this.states.onEnter(GameState.PAUSED, () => {
      this.klang.anhalten();
      this.ui.showScreen('paused');
    });

    this.states.onEnter(GameState.GAME_OVER, () => {
      // Solange ein zweites Leben zu haben ist, kommt zuerst das Angebot.
      // Erst wenn es abgelehnt oder aufgebraucht ist, folgt der eigentliche
      // Game-Over-Screen mit der Bestenliste — sonst könnte man sich
      // eintragen UND weiterklettern und stünde zweimal in der Liste.
      this.klang.effekt('gameover');
      if (this._continueAvailable()) {
        this.ui.showContinueOffer(this.score.meters);
      } else {
        this._showGameOverScreen();
      }
    });
  }

  /* ============================================================ Ablauf */

  _startRun() {
    this.score.reset();
    this.difficulty.reset();
    this.player.reset();
    this.spawner.reset();
    // Ohne Überblendung zurück auf Stufe 1 — ein neuer Lauf fängt sichtbar
    // von vorne an, statt aus der letzten Stufe herüberzublenden.
    this.wall.setStage(0, true);
    this._deathTimer = 0;
    this._adsUsed = 0;
    this._muenzenImLauf = 0;
    this.ui.setMuenzenLauf(0);

    // Musiktempo zurück auf Anfang: eine neue Runde beginnt im ersten Gebiet
    // und soll auch so klingen, egal wie hektisch die vorige endete.
    this._gebietWechsel = 0;
    this._letztesGebiet = null;
    this.klang.tempoZuruecksetzen();

    /* Ein noch offener Adler darf nicht in den neuen Lauf hineinragen.
     * Und: die Gebietszählung fängt bei 0 an, also muss auch die Liste der
     * schon bekämpften Gebiete leer sein — sonst bliebe der erste Boss der
     * zweiten Runde aus. */
    this.boss?.abbrechen(this.player);
    this._bossGehabt.clear();
    this._goldRest = 0;
    // player.reset() oben hat das Fell schon zurückgesetzt; hier steht nur,
    // dass der Goldmodus wirklich zu Ende ist.

    /* Runde bei der Weltliste anmelden. Der Server stempelt den Start mit
     * seiner Uhr und misst die Spielzeit später selbst — nur deshalb lässt
     * sie sich nicht erfinden.
     *
     * BEWUSST OHNE await: der Affe soll sofort losklettern, nicht auf eine
     * Netzantwort warten. Die Marke wird erst am Ende gebraucht, und bis
     * dahin ist sie längst da. Klappt es nicht, zählt der Lauf lokal — das
     * ist besser, als ihn gar nicht beginnen zu lassen. */
    this._weltLauf = null;
    // Der Eintrag des VORIGEN Laufs darf den nächsten Game-Over-Screen nicht
    // mehr beschriften.
    this._eigenerEintrag = null;
    /* Erstes Lebenszeichen SOFORT, sobald die Marke da ist.
     *
     * Hier stand ein voller Takt (20 s) — mit fatalem Ergebnis: ein Lauf, der
     * vorher endet, hatte null Lebenszeichen, damit rechnete der Server null
     * Sekunden Spielzeit und wies JEDEN Punktestand als unplausibel ab. Wer
     * nach zwölf Sekunden stirbt, bekam eine Betrugsmeldung — auch beim
     * allerersten Eintrag auf einer leeren Liste.
     *
     * Der Zähler läuft ohnehin erst, wenn `_weltLauf` steht (siehe
     * _updatePlaying), es geht also nichts ins Leere. */
    this._tickTimer = 0;
    // Der erste Ruf soll nicht sofort im Startmoment kommen.
    this._affenSchritt = 0;
    this._affenTimer = 6 + Math.random() * 4;
    if (this.bestenliste.weltweit) {
      const marke = ++this._laufNummer;
      this.bestenliste.laufStarten().then((id) => {
        // Nur übernehmen, wenn inzwischen kein neuer Lauf begonnen hat.
        if (marke === this._laufNummer) this._weltLauf = id;
      });
    }

    this.ui.updateScore(0);
    this.ui.setRevive(false);
    this.ui.clearToast();

    this.states.transitionTo(GameState.PLAYING);
  }

  /* ------------------------------------------------- Zweites Leben (Werbung) */

  /** Ist in diesem Lauf noch ein Weiterspielen zu haben? */
  _continueAvailable() {
    const cfg = this.cfg.ad;
    return cfg.enabled && this._adsUsed < cfg.maxPerRun && this.ads.isReady();
  }

  _showGameOverScreen() {
    const meters = this.score.meters;

    /* Namensfeld zeigen, wenn der Lauf FÜR IRGENDEINE Liste zählt.
     *
     * Vorher hing es allein an der lokalen Top 10. Wer die auf diesem Gerät
     * nicht schlug, konnte sich nicht eintragen — auch dann nicht, wenn er
     * weltweit Erster gewesen wäre. Genau der Spieler, den eine Weltrangliste
     * halten soll, kam nicht hinein. */
    const zaehlt = this.score.qualifies(meters) || (this.bestenliste.weltweit && meters > 0);

    this.ui.showGameOver({
      score: meters,
      qualifies: zaehlt,
      isNewBest: this.score.isNewBest(meters),
      highscores: this.score.loadHighscores(),
    });

    /* Die Weltliste hing vorher allein an einer erfolgreichen Namenseingabe.
     * Wer den Sprung in die eigene Liste nicht schafft — also die grosse
     * Mehrheit der Läufe — bekam sie damit NIE zu sehen, obwohl gerade sie
     * der Grund ist, es nochmal zu versuchen. Jetzt lädt sie bei jedem
     * Spielende. Kein await: der Bildschirm steht sofort, die Liste tröpfelt
     * nach, und wenn der Server schweigt, bleibt es beim Hinweistext. */
    if (this.bestenliste.weltweit) {
      this.ui.setWeltStatus('Weltliste wird geladen…');
      this._zeigeWeltListe();
    }
  }

  async _watchAd() {
    // Doppelklick auf den Button darf nicht zwei Spots starten.
    if (this._adRunning || !this._continueAvailable()) return;
    this._adRunning = true;

    const cfg = this.cfg.ad;
    /* Waehrend des Spots ist der Spielton still. Der Werbeanbieter bringt
     * seinen eigenen mit; beides gleichzeitig klingt nach Fehler und ist bei
     * den Portalen ein berechtigter Beschwerdegrund. */
    this.klang.anhalten();
    this.ui.showAd(cfg.stubDuration);

    let ergebnis = 'fehler';
    try {
      ergebnis = await this.ads.show((rest) => this.ui.setAdCountdown(rest));
    } catch (err) {
      console.warn('[Game] Werbung fehlgeschlagen:', err);
    }
    this._adRunning = false;
    this.klang.fortsetzen();

    // Der Spot lief asynchron. Wer inzwischen "Hauptmenü" gedrückt oder neu
    // gestartet hat, will nicht plötzlich im alten Lauf landen.
    if (!this.states.is(GameState.GAME_OVER)) return;

    if (ergebnis === 'belohnt') {
      this._continueRun();
      return;
    }

    if (ergebnis === 'fehler') this.ui.toast('Keine Werbung verfügbar', 'revive');
    this._showGameOverScreen();
  }

  /**
   * Weiter an der Todesstelle.
   *
   * Nichts wird zurückgesetzt ausser dem Tod selbst: Höhe, Punktestand,
   * Spielzeit und damit auch Schwierigkeit und Hintergrundstufe laufen weiter,
   * wo sie waren. Nur der Bildschirm wird um den Affen herum freigeräumt —
   * ohne das stürbe er im selben Frame erneut an dem Objekt, das ihn gerade
   * erwischt hat.
   */
  _continueRun() {
    const cfg = this.cfg.ad;
    this._adsUsed++;

    const weg = this.spawner.clearAround(this.player.hitX, this.player.hitY, cfg.clearRadius);
    this.player.reviveInPlace(cfg.invulnerableTime);
    this._deathTimer = 0;

    this.states.transitionTo(GameState.PLAYING, { weiter: true });
    this.ui.toast('Weiter geht’s!', 'revive');
    if (this.cfg.debug.showStats) {
      console.info(`[Game] Weiterspielen — ${weg} Objekte weggeräumt`);
    }
  }

  _pause() {
    if (!this.states.is(GameState.PLAYING)) return;
    this.states.transitionTo(GameState.PAUSED);
  }

  _resume() {
    if (!this.states.is(GameState.PAUSED)) return;
    this.states.transitionTo(GameState.PLAYING);
  }

  _toMenu() {
    if (this.states.is(GameState.MENU)) return;
    // Ein laufender Spot hält sonst eine Promise offen, die nach der Rückkehr
    // ins Menü noch "belohnt" liefern und den alten Lauf wiederbeleben würde.
    this.ads.cancel();
    // PLAYING -> MENU ist kein erlaubter Direktübergang (der Automat kennt nur
    // PAUSED/GAME_OVER -> MENU). Ein laufendes Spiel wird deshalb erst
    // angehalten — so bleibt die Übergangstabelle streng, ohne dass der
    // Aufrufer die Reihenfolge kennen muss.
    if (this.states.is(GameState.PLAYING)) this.states.transitionTo(GameState.PAUSED);
    this.spawner.reset();
    this.player.reset();
    // Der Adler gehört zum Lauf, nicht zum Menü — samt Bossmusik.
    this.boss?.abbrechen(this.player);
    this.states.transitionTo(GameState.MENU);
  }

  async _submitName(name) {
    const meters = this.score.meters;
    const wasBest = this.score.isNewBest(meters);
    const mitWerbung = this._adsUsed > 0;

    /* EINMAL normalisieren, für beide Listen dieselbe Regel.
     *
     * Vorher normalisierte nur die lokale Liste (leer -> "AFFE"). An den
     * Server ging der Rohwert: ein leeres Feld erzeugte dort einen Fehler,
     * und der Spieler stand lokal als AFFE in der Liste, weltweit nirgends —
     * ohne dass irgendwo stand, warum. */
    const sauber =
      (name ?? '').trim().slice(0, this.cfg.score.maxNameLength).toUpperCase() ||
      this.cfg.score.defaultName;

    // Lokal IMMER eintragen: die eigene Liste soll auch dann stimmen, wenn
    // der Server nicht erreichbar ist.
    const rank = this.score.submit(sauber, meters, mitWerbung);
    this.ui.updateGameOverHighscores(this.score.loadHighscores(), rank);
    if (wasBest && rank === 0) this.anim.playOneShot('roar');

    if (!this.bestenliste.weltweit) return;

    /* Der Spot lief asynchron, und "Nochmal" wartet nicht. Ohne diese Marke
     * schreibt die späte Antwort eines alten Laufs in den Bildschirm des
     * neuen. */
    const marke = ++this._eintragNummer;

    /* Weltweit dazu. Die Spielzeit steht NICHT hier drin — sie kommt aus der
     * Marke, die der Server beim Rundenstart gestempelt hat. */
    this.ui.setWeltStatus('wird eingetragen…');
    const antwort = await this.bestenliste.eintragen(this._weltLauf, sauber, meters, mitWerbung);
    if (marke !== this._eintragNummer) return;

    if (!antwort.ok) {
      // Den ECHTEN Grund zeigen. "Nicht erreichbar" für eine fachliche
      // Ablehnung (zu kurzer Lauf, Sperrfrist) schickt den Spieler auf die
      // Suche nach einem Netzproblem, das es gar nicht gibt.
      this.ui.setWeltStatus(antwort.grund ?? 'Weltliste nicht erreichbar');
      return;
    }
    /* Name und Platz merken, damit die Liste sie danach ANZEIGT und stehen
     * lässt — sonst hat man gerade etwas eingetragen und sieht nur zehn
     * fremde Zeilen. */
    this._eigenerEintrag = { name: sauber, rang: antwort.rang };
    await this._zeigeWeltListe(marke);
  }

  /**
   * Holt die weltweite Liste und zeigt sie an. Fehler bleiben still.
   * @param {number} [marke] Lauf-Marke; eine veraltete Antwort wird verworfen
   */
  async _zeigeWeltListe(marke) {
    if (!this.bestenliste.weltweit) return;
    const meine = marke ?? ++this._eintragNummer;
    try {
      const eintraege = await this.bestenliste.holen(this.cfg.bestenliste.anzahl);
      if (meine !== this._eintragNummer) return;
      this.ui.showWeltListe(eintraege, this._eigenerEintrag);
    } catch {
      if (meine !== this._eintragNummer) return;
      this.ui.setWeltStatus('Weltliste nicht erreichbar');
    }
  }

  /* ================================================================ Loop */

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    requestAnimationFrame(this._tick);
  }

  _tick(now) {
    requestAnimationFrame(this._tick);

    // Deltatime in Sekunden, gekappt gegen Frame-Spikes und Tab-Wechsel.
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;

    this.input.update();
    this._handleGlobalKeys();

    switch (this.states.state) {
      case GameState.PLAYING:
        this._updatePlaying(dt);
        break;
      case GameState.MENU:
      case GameState.GAME_OVER:
        this._updateIdleScene(dt);
        break;
      case GameState.PAUSED:
        // Bewusst nichts aktualisieren — Standbild, aber weiter rendern.
        break;
    }

    this._updateStats(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Lässt den Affen ab und zu von sich hören.
   *
   * WECHSELNDE ABSTÄNDE, nicht ein fester Takt. Ein Ruf alle zehn Sekunden
   * ist nach zwei Minuten ein Metronom und danach eine Belästigung. Die Folge
   * in CONFIG.klang.affenRuf.abstaende wird reihum durchlaufen und jeder Wert
   * noch gestreut — mal kommt schnell einer, mal dauert es eine halbe Minute.
   *
   * Läuft NUR im Spiel (dieser Zweig gehört zu _updatePlaying): in der Pause,
   * im Menü und während eines Werbespots ist Ruhe.
   */
  _affenRuf(dt) {
    const cfg = this.cfg.klang.affenRuf;
    if (!cfg?.abstaende?.length) return;

    this._affenTimer -= dt;
    if (this._affenTimer > 0) return;
    this._affenTimer = this._naechsterAffenAbstand();
    this.klang.effekt('affe');
  }

  _naechsterAffenAbstand() {
    const cfg = this.cfg.klang.affenRuf;
    const wert = cfg.abstaende[this._affenSchritt % cfg.abstaende.length];
    this._affenSchritt++;
    const streu = 1 + (Math.random() * 2 - 1) * (cfg.streuung ?? 0);
    return Math.max(2, wert * streu);
  }

  /**
   * Freudenruf nach einem Erfolg — mit Wahrscheinlichkeit, nicht immer.
   *
   * Verzögert, damit er HINTER dem Münz- bzw. Bananenklang liegt. Beide
   * gleichzeitig klingt nach Fehler, nacheinander nach Reaktion.
   *
   * Setzt den regulären Timer zurück: sonst käme kurz nach dem Freudenruf
   * womöglich gleich der nächste planmässige.
   */
  _affeFreutSich(wahrscheinlichkeit) {
    if (Math.random() >= wahrscheinlichkeit) return;
    const cfg = this.cfg.klang.affenRuf;
    setTimeout(
      () => {
        if (this.states.is(GameState.PLAYING)) this.klang.effekt('affe');
      },
      (cfg.nachErfolgVerzoegerung ?? 0.3) * 1000,
    );
    this._affenTimer = this._naechsterAffenAbstand();
  }

  /**
   * Ton an/aus. Der einzige Weg — Taste M und der Schalter oben rechts landen
   * beide hier, damit Zustand und Anzeige nie auseinanderlaufen.
   */
  _tonUmschalten() {
    /* Ein Klick auf den Schalter ist eine echte Nutzereingabe. Wer als
     * allererstes hier hindrückt, soll damit auch den Ton freigeben statt
     * einen Schalter umzulegen, hinter dem noch gar kein Tonkontext steht. */
    this.klang.aufwecken();
    const stumm = this.klang.stummSchalten();
    this.ui.setTon(stumm);
    this.ui.toast(stumm ? 'Ton aus' : 'Ton an', 'revive');
  }

  _handleGlobalKeys() {
    // M schaltet stumm. Bewusst KEIN Menüpunkt: wer den Ton weghaben will,
    // will ihn sofort weghaben, nicht nach zwei Klicks.
    if (this.input.consumeMute?.()) this._tonUmschalten();

    // F2: Bossvorschau an/aus — nur im laufenden Spiel sinnvoll.
    if (this.input.consumeBoss?.() && this.states.is(GameState.PLAYING)) {
      this.bossStarten();
    }

    if (this.input.consumeDebug()) {
      const on = this.debug.toggle();
      this.cfg.debug.showStats = on;
      this.ui.setStats(on ? '' : null);
    }

    // Während der Namenseingabe gehen Tasten an das Textfeld, nicht ans Spiel.
    if (this.ui.isTyping) {
      this.input.consumePause();
      this.input.consumeConfirm();
      return;
    }

    if (this.input.consumePause()) {
      if (this.states.is(GameState.PLAYING)) this._pause();
      else if (this.states.is(GameState.PAUSED)) this._resume();
    }

    // Die Charakterauswahl liegt ÜBER dem Menü, ohne den Automaten zu
    // wechseln (aus MENU führt nur PLAYING heraus). Ohne diese Sperre würde
    // Enter den Lauf mit dem alten Affen starten, während die Auswahl noch
    // offen ist.
    if (this.ui.currentScreen === 'characters') {
      this.input.consumeConfirm();
      return;
    }

    // Weiterspielen-Angebot und laufender Spot: hier gibt es keine
    // Standardantwort. Enter würde sonst einen neuen Lauf starten und die
    // gerade erreichte Höhe wegwerfen — dieselbe Taste, die im Game Over
    // "Nochmal" heisst, hiesse hier "Angebot ausschlagen".
    if (this.ui.currentScreen === 'continue' || this.ui.currentScreen === 'ad') {
      this.input.consumeConfirm();
      return;
    }

    if (this.input.consumeConfirm()) {
      if (this.states.is(GameState.MENU)) this._startRun();
      else if (this.states.is(GameState.GAME_OVER)) this._startRun();
      else if (this.states.is(GameState.PAUSED)) this._resume();
    }
  }

  _updatePlaying(dt) {
    const world = this.worldView; // seitengrössenabhängig, siehe _onResize
    this.difficulty.update(dt);

    /* ---- Kletterstrecke dieses Frames -------------------------------- */
    /* DIE WAND SCROLLT MIT FESTEM TEMPO.
     *
     * Hier zahlte früher der senkrechte Input über `climbAssist` auf die
     * Scrollgeschwindigkeit ein — "W" fühlte sich wie Steigen an. Das ist
     * doppelt überholt: `climbAssist` steht seit dem Balancing überall auf
     * 0.0 (es gab dem weissen Affen einen Punktevorteil), und seit dem
     * Wegfall der Vertikalen gibt es gar keinen senkrechten Input mehr.
     * Übrig blieb eine Rechnung, die garantiert `base` ergibt. */
    const base = this.difficulty.scrollSpeed;
    const axis = this.input.axis;
    const climbed = base * dt;

    // Die Wand scrollt während der Sterbe-Verzögerung weiter (sonst friert das
    // Bild abrupt ein), der Score aber NICHT — sonst bekäme man für die
    // Sekunde nach dem tödlichen Treffer noch Höhenmeter gutgeschrieben.
    if (this.player.alive) this.score.addHeight(climbed);
    // Die Spielzeit steuert die Hintergrundstufe — der Wechsel fällt damit
    // mit dem Schwierigkeitssprung zusammen.
    this.wall.update(dt, climbed, this.difficulty.elapsed);
    // Jede Wand wirft etwas anderes ab. Bereits fallende Objekte behalten ihr
    // Aussehen — es wechselt nur, was ab jetzt neu erzeugt wird.
    this.spawner.hazardLook = this.wall.stageHazard;

    /* Atmosphäre folgt der Wand. atmo() erkennt selbst, ob sich etwas
     * geändert hat — hier jeden Frame zu rufen ist billiger als den
     * Wandwechsel an einer zweiten Stelle mitzuführen. */
    this.klang.atmo(this.wall.stageName);

    /* Mit jedem Gebiet läuft die Musik ein Stück schneller.
     *
     * Gezählt werden die WECHSEL SEIT RUNDENBEGINN, nicht wall.stageIndex:
     * nach dem letzten Gebiet geht es zyklisch bei 0 weiter, und ein
     * index-basiertes Tempo fiele dort mitten im schwersten Abschnitt auf
     * Normaltempo zurück. */
    if (this.wall.stageName !== this._letztesGebiet) {
      if (this._letztesGebiet !== null) this._gebietWechsel++;
      this._letztesGebiet = this.wall.stageName;
      this.klang.tempo(this._musikTempo());

      /* Bosskampf? Beim Betreten eines Gebiets entschieden, nicht mitten
       * darin: so weiss man immer, woran man ist, und die Warnung fällt mit
       * dem Wandwechsel zusammen.
       *
       * `_bossGehabt` verhindert einen zweiten Kampf im selben Gebiet, falls
       * die Wand über die Zeitschwelle hin- und herwackelt. */
      if (
        !this.boss?.aktiv &&
        this._bossFaellig(this._gebietWechsel) &&
        !this._bossGehabt.has(this._gebietWechsel)
      ) {
        this._bossGehabt.add(this._gebietWechsel);
        this.bossStarten(); // ohne await, siehe dort
      }
    }
    /* Kümmert sich um den Schleifenpunkt der Musik. Hier stand vorher ein
     * Zufallstakt für einzelne Vogelrufe — die gehörten zu den prozeduralen
     * Atmosphären und sind mit ihnen weg. */
    this.klang.musikUpdate();
    this._affenRuf(dt);

    /* Lebenszeichen an die Weltliste.
     *
     * BEWUSST HIER und nicht in einem eigenen Timer: dieser Zweig läuft nur,
     * solange wirklich gespielt wird. In der Pause, während eines Werbespots
     * und im versteckten Tab schweigt er — und genau das ist der Sinn.
     * Vergangene Zeit ohne Lebenszeichen wird nicht angerechnet, sonst
     * genügte ein `sleep`, um eine Stunde Spiel zu behaupten. */
    if (this._weltLauf) {
      this._tickTimer -= dt;
      if (this._tickTimer <= 0) {
        this._tickTimer = this.cfg.bestenliste.tickSekunden;
        this.bestenliste.tick(this._weltLauf); // ohne await, Fehler bleiben still
      }
    }

    /* ---- Bahnwechsel --------------------------------------------------- *
     * Die Eingabe liefert einen Dauerwert (-1 / 0 / +1). Ein Bahnwechsel ist
     * aber ein EREIGNIS: bei gedrückter Taste soll er EINMAL wechseln, nicht
     * jeden Frame weiterrutschen. Deshalb die Flanke auswerten — gewechselt
     * wird nur, wenn die Richtung vorher nicht schon anlag. */
    if (this.player.alive) {
      const richtung = axis.x < -0.5 ? -1 : axis.x > 0.5 ? 1 : 0;
      if (richtung !== 0 && richtung !== this._letzteRichtung) {
        const anzahl = world.bahnX?.length ?? 3;
        this.player.zielBahn = Math.max(
          0,
          Math.min(anzahl - 1, this.player.zielBahn + richtung),
        );
      }
      this._letzteRichtung = richtung;
    }

    /* ---- Bosskampf ----------------------------------------------------- *
     * Der Wurf wird VOR dem Spieler-Update angefordert, damit die Animation
     * noch in diesem Frame anläuft; die Banane selbst entsteht erst, wenn
     * player.update() das Ereignis 'wurf' meldet — also wenn der Arm
     * gestreckt ist, nicht beim Tippen. */
    const tipp = this.input.consumeTipp?.();
    if (tipp && this.boss?.kaempft && this.player.alive) {
      this.boss.wurfAnfordern(this.player);
    }

    /* ---- Entities ----------------------------------------------------- */
    const spielerEreignis = this.player.update(
      dt,
      this.player.alive ? axis : ZERO_AXIS,
      world.bounds,
      world.bahnX,
    );
    if (spielerEreignis === 'wurf') this.boss?.bananeLoslassen(this.player);

    this.spawner.update(dt, this.player.revives > 0, base);
    // Der Kampf NACH dem Spieler: er prüft gegen dessen frische Position.
    this.boss?.update(dt, this.player, world, this.difficulty.rockFallSpeed + base);
    this._goldmodusSchritt(dt);

    if (this.player.alive) {
      CollisionSystem.check(this.player, this.spawner, this._collisionHandlers);
    }

    this.anim.update(dt, this.player.animContext(this._animCtx));

    /* ---- HUD ---------------------------------------------------------- */
    this.ui.updateScore(this.score.meters);
    this._zeigeNaechstesGebiet();
    this.debug.update(this.player, this.spawner);

    /* ---- Tod: kurze Verzögerung, damit "Die" sichtbar wird ------------ */
    if (!this.player.alive) {
      this._deathTimer -= dt;
      if (this._deathTimer <= 0) {
        // Sonst bliebe der Adler stehen und die Bossmusik liefe über den
        // Game-Over-Screen weiter.
        this.boss?.abbrechen(this.player);
        this.states.transitionTo(GameState.GAME_OVER);
      }
    }
  }

  /**
   * "Noch 240 m bis zum Pilzwald" — samt Vorschaubild der nächsten Wand.
   *
   * Die Meter sind eine Hochrechnung, keine exakte Zahl: die Wand wechselt
   * nach SEKUNDEN, der Punktestand zählt aber METER, und die
   * Scrollgeschwindigkeit wächst dazwischen noch. Gerechnet wird mit dem
   * aktuellen Tempo — die Anzeige läuft dadurch minimal vor, was der
   * ehrlichere Fehler ist: sie verspricht nie mehr Strecke, als kommt.
   */
  _zeigeNaechstesGebiet() {
    const stages = this.cfg.wall.stages;
    const t = this.difficulty.elapsed;
    const naechster = (this.wall.stageIndex + 1) % stages.length;

    // Nach der letzten Wand geht es zyklisch weiter — dann zählt der
    // Schleifentakt, nicht die (längst überschrittene) Startsekunde.
    const letzte = stages[stages.length - 1];
    let zielZeit;
    if (this.wall.stageIndex >= stages.length - 1 || t >= letzte.afterSeconds) {
      const seitLetzter = t - letzte.afterSeconds;
      const runde = Math.floor(seitLetzter / this.cfg.wall.stageLoopSeconds) + 1;
      zielZeit = letzte.afterSeconds + runde * this.cfg.wall.stageLoopSeconds;
    } else {
      zielZeit = stages[naechster].afterSeconds;
    }

    const rest = Math.max(0, zielZeit - t);
    this.ui.setNaechstesGebiet(stages[naechster].near, rest * this.difficulty.scrollSpeed);
  }

  /** Menü und Game-Over: Wand scrollt langsam weiter, Affe klettert weiter. */
  _updateIdleScene(dt) {
    // elapsed = null: im Menü und nach dem Tod bleibt die Stufe stehen.
    this.wall.update(dt, this.cfg.flow.ambientScrollSpeed * dt, null);
    this._animCtx.speed = 0;
    this._animCtx.vx = 0;
    this._animCtx.vy = 0;
    this.anim.update(dt, this._animCtx);

    // Der Sprite animiert sich sonst nur in update(), und das ruft Game hier
    // bewusst nicht. Ohne diese Zeile stünde der Affe reglos vor der
    // weiterscrollenden Wand. (Der Modell-Modus läuft schon über anim.update.)
    this.player.updateAmbient?.(dt);
  }

  _onRockHit(_rock) {
    const result = this.player.applyHit();
    if (result !== 'ignored') this.klang.effekt('treffer');
    if (result === 'revived') {
      this.ui.setRevive(false);
      this.ui.toast('Wiederbelebt!', 'revive');
    } else if (result === 'dead') {
      this._deathTimer = this.cfg.flow.gameOverDelay;
    }
  }

  _onCoinHit(coin) {
    this.spawner.collectCoin(coin);
    this.klang.effekt('muenze');
    this._affeFreutSich(this.cfg.klang.affenRuf?.beiMuenze ?? 0);
    /* Im Goldmodus zählt jede Münze dreifach.
     *
     * Der Faktor greift auf die GUTSCHRIFT, nicht auf die Fallrate: es
     * fallen genauso viele Münzen wie sonst, sie sind nur mehr wert. Mehr
     * Münzen fallen zu lassen hiesse, mitten in den Korridor zu greifen —
     * und dessen Garantie hängt an der Zahl der Objekte. */
    const wert = this._muenzFaktor;
    this._muenzenImLauf += wert;
    this.fortschritt.gutschreiben(wert);
    this.ui.setMuenzenLauf(this._muenzenImLauf);
  }

  _onBananaHit(banana) {
    this.spawner.collect(banana);
    if (this.player.collectBanana()) {
      /* Klang NUR wenn sie auch gezählt hat.
       *
       * `collectBanana()` gibt false zurück, wenn das Lager schon voll ist
       * (maxStored) oder die Figur gar keine Wiederbelebung kennt — der
       * weisse Affe. Der Klang gehört zur Gutschrift, nicht zur Berührung:
       * ein Fanfarenstoss für eine Banane, die nichts bringt, wäre eine
       * Lüge. */
      this.klang.effekt('banane');
      this._affeFreutSich(this.cfg.klang.affenRuf?.beiBanane ?? 0);
      this.ui.setRevive(true);
      this.ui.toast('+1 Wiederbelebung', 'banana');
    }
  }

  /* =============================================================== Sonstiges */

  _updateStats(dt) {
    if (!this.cfg.debug.showStats) return;
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.35) {
      this._fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
    const d = this.difficulty;
    const warn = d.vorwarnung(this.player.hitY, this.player.hitRadius + 0.636);
    this.ui.setStats(
      `${this._fps.toFixed(0)} fps\n` +
        `t        ${d.elapsed.toFixed(1)} s\n` +
        `wand     ${d.wand.toFixed(2)}  (${this.wall.stageName})\n` +
        `härte    ${d.haerte.toFixed(2)}\n` +
        `tempo    ${d.tempo.toFixed(2)} u/s  (scroll ${d.scrollSpeed.toFixed(2)})\n` +
        // Die Zahl, an der Fairness hängt: so lange bleibt vom Sichtbarwerden
        // bis zum Gefährlichwerden. Unter ~0.3 s wird es Glückssache.
        `vorwarn  ${warn.toFixed(2)} s\n` +
        `dichte   ${d.dichte.toFixed(2)}/s  (alle ${d.spawnDelay.toFixed(2)}s${d.amAnschlag ? ', max' : ''})\n` +
        `abstand  ${d.mindestZeit.toFixed(2)}s min\n` +
        `steine   ${this.spawner.rocks.activeCount}/${this.spawner.rocks.size}` +
        ` (${this.spawner.rockTypeCounts()})\n` +
        `mix      ${(d.rockWeights ?? []).join('/')}\n` +
        `bahn     x ${this.spawner.korridor.x.toFixed(2)}\n` +
        `bananen  ${this.spawner.bananas.activeCount}/${this.spawner.bananas.size}\n` +
        `anim     ${this.anim._locomotionKey ?? '-'}`,
    );
  }

  _onResize() {
    // Mindestens 1px: ein verstecktes bzw. noch nicht gelayoutetes Fenster
    // liefert 0 und würde camera.aspect auf NaN setzen — danach ist die
    // gesamte Szene unsichtbar, auch nachdem das Fenster wieder da ist.
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.cfg.render.maxPixelRatio));
    this.renderer.setSize(w, h);

    this._updateWorldBounds();
    this.wall?.resize();
  }

  /**
   * Passt die seitlichen Spielfeldgrenzen an das an, was tatsächlich zu sehen
   * ist.
   *
   * CONFIG.world.bounds ist auf ein Querformat ausgelegt. Die sichtbare Breite
   * hängt aber vom Seitenverhältnis ab (das Sichtfeld ist vertikal definiert):
   * im Hochformat schrumpft sie auf einen Bruchteil. Ohne diese Korrektur
   * fährt der Affe seitlich aus dem Bild, bleibt dort steuerbar und wird von
   * unsichtbaren Steinen getroffen.
   *
   * Gemessen wird am oberen Rand des Bewegungsbandes — dort ist die Wand der
   * Kamera am nächsten und damit am schmalsten.
   */
  _updateWorldBounds() {
    const base = this.cfg.world;
    const view = this.worldView;

    /* GEMESSEN WIRD AUF DER HÖHE DES AFFEN.
     *
     * Vorher stand hier `base.bounds.maxY` — der obere Rand des damaligen
     * Bewegungsbandes, wo die Wand der Kamera am nächsten und damit am
     * schmalsten ist. Das war richtig, solange der Affe dort hinkonnte. Seit
     * er senkrecht festgenagelt ist, verschenkt diese Messung Breite: auf
     * seiner tatsächlichen Höhe ist die Wand breiter. */
    const affenHoehe = this.cfg.player.startPosition[1];
    const half = halfWidthAt(this.camera, 0, affenHoehe);
    if (!Number.isFinite(half)) return;

    // Etwas Rand lassen, damit der Affe nicht halb im Bildrand klebt.
    // Radius vom Spieler, nicht aus CONFIG: der weisse Affe hat die halbe
    // Hitbox und bekommt dadurch ein etwas breiteres Band.
    const hitRadius = this.player?.hitRadius ?? this.cfg.player.hitRadius;
    const limit = Math.max(0.9, half - hitRadius * 1.6);

    view.bounds.minX = Math.max(base.bounds.minX, -limit);
    view.bounds.maxX = Math.min(base.bounds.maxX, limit);
    view.bounds.minY = base.bounds.minY;
    view.bounds.maxY = base.bounds.maxY;

    /* Die drei Bahnen aus den Anteilen. Hängen am tatsächlichen Feld, nicht
     * an festen Weltkoordinaten — im Hochformat ist es weniger als halb so
     * breit wie im Querformat. */
    const halbFeld = view.bounds.maxX;
    view.bahnX = base.bahnen.map((anteil) => anteil * halbFeld);

    /* Objekte nur dort erzeugen, wo sie auch zu sehen sind — sonst fällt der
     * Grossteil im Hochformat unsichtbar neben dem Bild herunter.
     *
     * DER ZUSCHLAG WAR 0.4 UND IST JETZT 0.8. Nachgerechnet fürs Hochformat
     * (390x844, brauner Affe): mit 0.4 blieb dem garantierten Korridor nach
     * Abzug aller Sperrbreiten eine NEGATIVE Spanne (-0.18) — die Bahn stand
     * praktisch still, gemessen 0.85 Einheiten Wanderung in 60 s und nur
     * 17.3 % der Objekte im mittleren Drittel (gleichverteilt wären 33.3 %).
     * Solange man auch senkrecht ausweichen konnte, fiel das kaum auf. Jetzt,
     * wo x die einzige Achse ist, wäre es das ganze Spiel: der Affe sitzt in
     * der Mitte, alles fällt aussen vorbei, minutenlang passiert nichts.
     * Mit 0.8 wird die Spanne wieder positiv und die Bahn wandert spürbar. */
    view.spawnHalfWidth = Math.min(base.spawnHalfWidth, limit + 0.8);

    /* Die garantierte Bahn steht schon für die nächsten Sekunden fest, und
     * zwar geklemmt an die BISHERIGEN Grenzen. Wird das Feld enger, läge sie
     * ausserhalb dessen, was der Affe überhaupt erreichen darf — die
     * Zusicherung zeigte dann auf einen Ort, den es nicht mehr gibt.
     *
     * Das passiert nicht nur beim Drehen des Geräts: die Grenzen hängen am
     * Trefferradius, also verschiebt sie AUCH JEDER CHARAKTERWECHSEL. */
    this.spawner?.korridor.grenzenAendern(view.bounds.minX, view.bounds.maxX);
  }
}

/** Konstanter Null-Input für den toten Affen (keine Allokation pro Frame). */
const ZERO_AXIS = Object.freeze({ x: 0, y: 0 });

/**
 * Abspielreihenfolge eines Charakters.
 *
 * Jeder Affe kann eine eigene Bildzahl haben — die Videos enthalten
 * unterschiedlich viele wirklich verschiedene Bilder pro Kletterzyklus.
 * Ohne eigene Liste fällt er auf die gemeinsame aus CONFIG.sprite zurück.
 */
function charFrames(char) {
  return char?.frames ?? CONFIG.sprite.frames;
}

/**
 * Pfad eines Kletter-Frames.
 * @param {number} n Frame-Nummer aus der Liste des Charakters
 * @param {string} framePath Muster des Charakters, z. B. '/textures/weiss/move_{n}.webp'
 */
function frameUrl(n, framePath) {
  return framePath.replace('{n}', String(n).padStart(2, '0'));
}
