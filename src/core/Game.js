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
import { groessteSpriteBreite, hazardSpriteUrls } from '../entities/Rock.js';
import { Sturzflug } from '../systems/Sturzflug.js';
import { BossKampf } from '../systems/BossKampf.js';
import { Tempolinien } from '../entities/Tempolinien.js';
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
import { halfWidthAt, topEdgeAt } from './viewport.js';

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

    /** Restsekunden Goldmodus (0 = aus). */
    this._goldRest = 0;
    /** @type {import('three').Texture[]|null} goldenes Fell, erst bei Bedarf geladen */
    this._goldFrames = null;

    /* --- Bosskampf ---------------------------------------------------- *
     * Wird erst beim ersten Mal geladen (rund 800 KB Bildfolgen für beide
     * Ausführungen) — bis Gebiet 3 ist dafür reichlich Zeit. */
    /** @type {import('../systems/BossKampf.js').BossKampf|null} */
    this.bossKampf = null;
    this._bossLaedt = false;
    /** Gebietsnummer des letzten Kampfes; hält den Mindestabstand ein. */
    this._letzterBossGebiet = -99;

    /** @type {import('../systems/Sturzflug.js').Sturzflug|null} */
    this.sturzflug = null;
    this._sturzLaedt = false;
    // Sekunden bis zum nächsten Sturzflug (0 = keiner geplant).
    this._sturzUhr = 0;
    // Wie viele Sturzfluege in DIESEM Gebiet schon gelaufen sind.
    this._sturzImGebiet = 0;

    /* Chili-Durchflug. `null` heisst: kein Flug — und das MUSS null sein und
     * nicht undefined. `_updatePlaying` schaltet den Nachschub über
     * `this._chiliFlug !== null` ab; stand das Feld auf undefined, war der
     * Vergleich dauerhaft wahr, und es fiel im ganzen Spiel nichts mehr.
     * @type {{rest: number, phase: number}|null} */
    this._chiliFlug = null;
    /** @type {import('three').Texture[]|null} Bilder des Fluges */
    this._chiliFrames = null;
    // In welchen Gebieten Goldbanane bzw. Chili schon gefallen sind.
    this._goldGebiet = -1;
    this._chiliGebiet = -1;

    /* Bahnwechsel: Merker für Doppelwisch (weiss) und Verzögerung (orange).
     * Siehe _wischen. */
    this._letzterWischZeit = -Infinity;
    this._letzterWischRichtung = 0;
    this._wischZiel = null;
    this._wischUhr = 0;

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
      onPowerup: (p) => this._onPowerupHit(p),
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

    /* MATRIZEN SOFORT NACHZIEHEN.
     *
     * `position.set` und `lookAt` schreiben nur Position und Drehung. Die
     * Weltmatrix, mit der `project`/`unproject` rechnen, zieht three.js
     * erst beim ersten Rendern nach — bis dahin ist sie die Einheitsmatrix:
     * keine Position, KEINE NEIGUNG.
     *
     * Genau in dieses Loch fielen zwei Messungen, die beide vor dem ersten
     * Bild laufen:
     *
     *   PlantWall.resize()     legte die Wandebenen auf y = 1.9 (die
     *                          Kamerahöhe) statt auf y = -0.08. Unten
     *                          blieben 1.145 Einheiten unbedeckt — der
     *                          grüne Streifen am unteren Bildrand.
     *   _updateWorldBounds()   mass die Feldbreite mit einer ungeneigten
     *                          Kamera.
     *
     * Beides heilte beim ersten Fenster-Resize von selbst. Deshalb war es
     * beim Ausprobieren am Rechner oft weg, sobald man einmal am Fenster
     * gezogen hatte — und auf dem Handy blieb es. */
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

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

    /* Die Wand des Gold-Gebiets gehört MIT VORGELADEN, obwohl sie nicht in
     * cfg.wall.stages steht.
     *
     * Sie kommt unangekündigt — in der Sekunde, in der jemand die goldene
     * Banane erwischt. Nachzuladen hiesse: der Umschwung passiert, und die
     * Wand kommt eine halbe Sekunde später. Zwei Bilder mehr im Vorlauf sind
     * der bessere Tausch. */
    const goldGebiet = this.cfg.goldbanane.gebiet;
    if (goldGebiet) textureUrls.push(goldGebiet.near, goldGebiet.far);

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

    /* Tempolinien für den Chili-Flug. Sie liegen vor der Wand und hinter dem
     * Affen; warum es sie braucht, steht in Tempolinien.js. */
    this.tempolinien = new Tempolinien(this.cfg.chili.linien);
    this.tempolinien.groesseSetzen(this.worldView.bounds);
    this.scene.add(this.tempolinien.object3D);

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

    /* Goldbanane und Chili nachladen. Ohne await: sie fallen fruehestens im
     * zweiten Gebiet, bis dahin sind die zwei Bilder laengst da. */
    loader
      .loadTexturesParallel([this.cfg.goldbanane.bild, this.cfg.chili.bild], 'Belohnungen…')
      .then((t) => this.spawner.setzePowerupBilder(t))
      .catch((f) => console.warn('[Belohnung] Bilder fehlen:', f));
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

  /* ============================================== Belohnungen vom Himmel */

  /**
   * Sollen goldene Banane oder Chili in diesem Gebiet fallen?
   *
   * Beide kommen NICHT in jedem Gebiet, sondern in unregelmässigen
   * Abständen — bei der Banane jedes zweite bis dritte, beim Chili jedes
   * dritte bis vierte. Der Abstand wird beim Auslösen neu gewürfelt, statt
   * fest zu sein: ein starrer Rhythmus wäre nach zehn Minuten auswendig
   * gelernt, und dann wartet man nur noch, statt zu spielen.
   *
   * Geworfen wird EINMAL je Gebiet, kurz nach dem Wechsel — bis dahin hat
   * sich der Bildschirm vom letzten Gebiet beruhigt.
   */
  _belohnungenPruefen() {
    const gebiet = this._gebietWechsel + 1;

    for (const [art, cfg, feld] of [
      ['gold', this.cfg.goldbanane, '_goldGebiet'],
      ['chili', this.cfg.chili, '_chiliGebiet'],
    ]) {
      if (gebiet < cfg.abGebiet) continue;
      // Beim ersten Mal auf das früheste erlaubte Gebiet setzen.
      if (this[feld] < 0) this[feld] = cfg.abGebiet - 1;
      if (gebiet <= this[feld]) continue;

      const j = cfg.jedesXteGebiet;
      const abstand = j.min + Math.floor(Math.random() * (j.max - j.min + 1));
      this[feld] = gebiet + abstand - 1;
      this.spawner.powerupWerfen(art);
      break; // nie beide im selben Gebiet
    }
  }

  /**
   * Belohnung eingesammelt.
   *
   * @param {import('../entities/Powerup.js').Powerup} p
   */
  _onPowerupHit(p) {
    const art = p.art;
    this.spawner.collectPowerup(p);
    if (art === 'gold') this._goldmodusStarten();
    else this._chiliStarten();
  }

  /* =============================================================== Chili */

  /**
   * Chili gegessen: Feuer aus dem Hintern, alles weg, ab ins nächste Gebiet.
   *
   * FÜNF SEKUNDEN, IN DENEN NICHTS PASSIEREN KANN. Alle fallenden Objekte
   * verschwinden, es kommt nichts nach, und die Wand rast vorbei. Das ist
   * ausdrücklich eine Pause vom Spiel und kein Teil davon — deshalb darf
   * sie auch selten sein (jedes dritte bis vierte Gebiet).
   *
   * WIE DAS GEBIET ÜBERSPRUNGEN WIRD
   * Die Wandstufe hängt an der Spielzeit (difficulty.elapsed), nicht an
   * gefahrenen Metern. Der Durchflug schiebt deshalb die UHR vor — dadurch
   * stimmen Wand, Schwierigkeit und Punktestand hinterher wieder zusammen,
   * ohne dass irgendwo ein Sonderfall stehen muss.
   */
  _chiliStarten() {
    if (this._chiliFlug !== null) return;
    const c = this.cfg.chili;

    /* Wie viel Spielzeit bis zum nächsten Gebiet noch fehlt. Genau die wird
     * abgearbeitet — höchstens in `sekunden`, aber schneller, wenn sonst
     * kein Schub zu sehen wäre.
     *
     * DIE FLUGDAUER IST DAS ERGEBNIS, NICHT DIE VORGABE. Steht er kurz vor
     * dem Gebietswechsel, sind nur noch ein paar Sekunden Gebietszeit übrig;
     * die über volle fünf Sekunden zu strecken hiesse, eine Flammenanimation
     * zu zeigen, während sich die Wand kaum bewegt. Deshalb wird die Dauer
     * so gekürzt, dass mindestens `tempoMin`-faches Tempo herauskommt. */
    const dauerGebiet = this.cfg.difficulty.sekundenProWand;
    const imGebiet = this.difficulty.elapsed % dauerGebiet;
    const restGebiet = dauerGebiet - imGebiet;

    /* DIE STRECKE STEHT ZUERST FEST, DANN ERST DIE DAUER.
     *
     * Gefordert ist beides: mindestens achtfaches Tempo UND im nächsten
     * Gebiet ankommen. Das geht nur, wenn die Strecke die Vorgabe ist —
     * der Rest des Gebiets plus ein Stück hinein — und die Dauer sich
     * danach richtet.
     *
     * Reicht `sekunden`, um das mit dem achtfachen Tempo zu schaffen, wird
     * genau achtfach geflogen. Reicht es nicht (am Gebietsanfang sind 132
     * Sekunden offen), wird schneller geflogen statt länger. Der Faktor ist
     * also eine Untergrenze, kein Sollwert. */
    /* DIE MINDESTDAUER DARF DEN FAKTOR NICHT DRÜCKEN.
     *
     * Gemessen bei 97 Prozent Gebietsfortschritt: Reststrecke 4 Sekunden,
     * durch `minSekunden` auf 2.5 Sekunden Flugzeit gestreckt — macht Faktor
     * 5.8 statt 8. Genau am Gebietsende, wo der Chili am ehesten fällt, war
     * der Flug also am langsamsten.
     *
     * Die Untergrenze gehört deshalb an die STRECKE, nicht an die Zeit: bei
     * einer kurzen Reststrecke fliegt er einfach weiter ins nächste Gebiet
     * hinein, statt langsamer zu werden. */
    const strecke = Math.max(
      restGebiet + dauerGebiet * c.einstieg,
      c.minSekunden * c.tempoFaktor,
    );

    /* Zeit bei genau achtfachem Tempo: in einer echten Sekunde vergehen acht
     * Spielsekunden. Länger als `sekunden` darf es nicht dauern. */
    const dauerBeiAcht = strecke / c.tempoFaktor;
    const dauer = Math.max(c.minSekunden, Math.min(c.sekunden, dauerBeiAcht));

    this._chiliFlug = {
      rest: dauer,
      dauer,
      phase: 0,
      uhrRest: strecke,
      // Nur für die Anzeige: mit welchem Vielfachen es tatsächlich läuft.
      faktor: strecke / dauer,
    };
    this.player.hoeheAnsteuern?.(c.flughoehe);
    /* ALLES weg, nicht nur Steine und Bananen.
    *
    * Die Münzen blieben liegen und fielen mit ihrem normalen Tempo weiter,
    * während die Welt mit dem Acht- bis Achtundzwanzigfachen an ihnen
    * vorbeizog — sie standen dadurch scheinbar in der Luft. Für den Spieler
    * ist "im Chili-Flug ist die Bahn frei" eine Zusage; eine hängende Münze
    * bricht sie sichtbar. */
    this.spawner.rocks.releaseAll((r) => r.despawn());
    this.spawner.bananas.releaseAll((b) => b.despawn());
    this.spawner.coins?.releaseAll?.((m) => m.despawn());
    this.sturzflug?.abbrechen();
    this.bossKampf?.abbrechen(this.player);

    this.ui.toast('Feuer frei!', 'banana');
    this.klang.effekt('chili');

    // Bildfolge beim ersten Mal nachladen.
    if (!this._chiliFrames) this._chiliFramesLaden();
    else this._chiliFellSetzen();
  }

  /**
   * Legt das Flugfell an und lässt es im Videotakt DURCHLAUFEN.
   *
   * Der Takt kommt aus CONFIG.chili.frameTakt (Bilder je Sekunde) geteilt
   * durch die Bildzahl des Satzes — so läuft die Flammenschleife genau so
   * schnell wie in der Vorlage und nicht im Kletterakt des Affen. Ohne das
   * flackerte das Feuer mit rund 1.26 Durchläufen je Sekunde statt mit 3
   * und sah aus wie eine Lavalampe.
   */
  _chiliFellSetzen() {
    const n = this._chiliFrames?.length ?? 0;
    if (!n) return;
    this.player.fellWechseln?.(this._chiliFrames);
    this.player.taktVorgeben?.(this.cfg.chili.frameTakt / n);
  }

  /** Lädt die Flugbilder des gewählten Affen. */
  _chiliFramesLaden() {
    const c = this.cfg.chili;
    const id = this.character?.id ?? 'braun';
    const muster = c.frames[id] ?? c.frames.braun;
    // Bildzahl JE CHARAKTER — die Sätze sind unterschiedlich lang, siehe config.
    const anzahl = c.frameAnzahl[id] ?? c.frameAnzahl.braun;
    const pfade = Array.from({ length: anzahl }, (_, i) =>
      muster.replace('{n}', String(i).padStart(2, '0')),
    );
    this._loader
      .loadTexturesParallel(pfade, 'Chili…')
      .then((t) => {
        let geladen = pfade.map((p) => t.get(p)).filter(Boolean);

        /* HIN UND ZURÜCK, wenn der Satz keine geschlossene Schleife ist.
         * Aus 0..11 wird 0..11,10..1 — jeder Bildwechsel ist damit ein
         * Schritt zwischen Nachbarn, der harte Rücksprung entfällt.
         * Begründung samt Messung in CONFIG.chili.pendeln. */
        if (c.pendeln?.[id] && geladen.length > 2) {
          geladen = [...geladen, ...geladen.slice(1, -1).reverse()];
        }
        this._chiliFrames = geladen;
        if (this._chiliFlug) this._chiliFellSetzen();
      })
      .catch((f) => console.warn('[Chili] Flugbilder fehlen:', f));
  }

  /**
   * Der Durchflug, ein Frame.
   *
   * @returns {number} zusätzliche Spielzeit für diesen Frame (Sekunden)
   */
  _chiliSchritt(dt) {
    const f = this._chiliFlug;
    if (!f) return 0;

    const vorher = f.rest;
    f.rest = Math.max(0, f.rest - dt);
    f.phase += dt;

    /* DIE RESTLICHE GEBIETSZEIT WIRD AUFGEBRAUCHT, nicht geschätzt.
     *
     * Verteilt wird nach dem ANTEIL DER RESTLICHEN FLUGZEIT, den dieser
     * Frame ausmacht — nicht nach `dt / sekunden`. Der Unterschied zählt am
     * Ende: bei Rucklern oder einem letzten kurzen Frame bliebe sonst ein
     * Rest stehen, und der Affe käme kurz VOR dem neuen Gebiet heraus.
     *
     * So ist es exakt: was an Gebietszeit übrig ist, wird über die noch
     * verbleibende Flugzeit verteilt. Im letzten Frame ist der Anteil 1,
     * also geht der ganze Rest raus. */
    const genutzt = vorher - f.rest;
    const anteil = vorher > 0 ? genutzt / vorher : 1;
    const schub = f.uhrRest * anteil;
    f.uhrRest -= schub;

    /* HIN UND HER SCHWENKEN.
     *
     * Eine Rakete, die schnurgerade nach oben geht, sieht aus wie ein Aufzug.
     * Der Affe pendelt deshalb während des Flugs zur Seite — zwei volle
     * Schwünge über die Flugdauer, gedämpft an beiden Enden, damit er weich
     * losschwingt und wieder mittig ankommt.
     *
     * Das ist ein reiner ANZEIGE-Versatz (SpritePlayer.versatzX): Bahn und
     * Trefferkreis bleiben, wo sie sind. Während des Flugs fällt ohnehin
     * nichts, es kann also nichts danebengehen.
     *
     * Die Weite hängt am Feld, nicht an einer festen Zahl — im Hochformat
     * wären zwei Einheiten der halbe Bildschirm.
     *
     * ER MUSS DABEI IM BILD BLEIBEN, und das war er nicht.
     *
     * Die Bahnen liegen bei -maxX / 0 / +maxX, also bereits am Rand des
     * nutzbaren Feldes. Ein Schwung von zusätzlich 55 Prozent trug ihn auf
     * den Aussenbahnen um bis zu 1.5·maxX nach draussen. Nachgerechnet mit
     * der echten Kamera: im Querformat war der Affe rund eine halbe Sekunde
     * am Stück GAR NICHT zu sehen und über die halbe Flugzeit angeschnitten
     * — ausgerechnet im Moment der Belohnung. Auf dem Handy blieb dauerhaft
     * ein Viertel von ihm ausserhalb.
     *
     * Der Schwung wird deshalb geklemmt: die ANGEZEIGTE Position darf nie
     * weiter aussen liegen als die äusserste Bahn. Genau dort steht der Affe
     * im normalen Spiel auch, und dort ist er nachweislich vollständig zu
     * sehen — `_updateWorldBounds` rechnet maxX aus der halben Bildbreite der
     * Figur. Auf der Mittelbahn ändert die Klemme nichts, dort ist Platz
     * genug; auf den Aussenbahnen schwingt er nach INNEN aus, statt nach
     * draussen zu verschwinden. */
    const fortschritt = 1 - f.rest / f.dauer;
    const daempfung = Math.sin(Math.min(1, fortschritt) * Math.PI);
    const roh = Math.sin(fortschritt * Math.PI * 4) * daempfung;

    const rand = this.worldView.bounds.maxX;
    const ziel = this.player.x + roh * rand * 0.55;
    this.player.versatzX = Math.max(-rand, Math.min(rand, ziel)) - this.player.x;
    // Er legt sich in die Kurve — dieselbe Richtung wie beim Ausweichen.
    this.player.neigungVorgeben?.(-Math.cos(fortschritt * Math.PI * 4) * 0.22 * daempfung);

    /* DER KAMERASTOSS.
     *
     * Ein weiterer Bildwinkel schiebt die Ränder nach aussen. Das ist der
     * einzige Hinweis auf Tempo, der ohne verfolgbare Struktur auskommt —
     * er wirkt selbst dann, wenn die Wand flimmert. */
    if (this.camera) {
      const soll = this.cfg.render.camera.fov + this.cfg.chili.fovStoss * daempfung;
      if (Math.abs(this.camera.fov - soll) > 0.01) {
        this.camera.fov = soll;
        this.camera.updateProjectionMatrix();
      }
    }

    if (f.rest <= 0) {
      const offen = f.uhrRest;
      this._chiliAbbrechen({ hart: false });
      // Was an Gebietszeit noch offen ist, kommt im letzten Schub mit.
      return schub + offen;
    }
    return schub;
  }

  /**
   * Setzt ALLES zurück, was der Flug verstellt hat.
   *
   * Eigene Methode, weil der Flug nicht nur regulär endet: stirbt man kurz
   * danach oder startet man einen neuen Lauf, blieben sonst Bildwinkel,
   * Flughöhe, Neigung und Flugfell stehen. Der Bildwinkel ist dabei der
   * unangenehmste — er wird nur hier zurückgesetzt, und ein hängengebliebener
   * Wert hätte den ganzen nächsten Lauf verzerrt.
   */
  _chiliAbbrechen({ hart = true } = {}) {
    this._chiliFlug = null;
    if (this.player) {
      this.player.versatzX = 0;
      this.player.neigungVorgeben?.(null);
      this.player.hoeheAnsteuern?.(null);
      this.player.taktVorgeben?.(null);
      this.player.fellWechseln?.(this._goldRest > 0 ? this._goldFrames : null);
    }
    // Am regulären Ende weich auslaufen lassen (siehe Tempolinien.aus).
    if (hart) this.tempolinien?.aus();
    if (this.camera && this.camera.fov !== this.cfg.render.camera.fov) {
      this.camera.fov = this.cfg.render.camera.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /* ========================================================= Bahnwechsel */

  /**
   * Ein Wisch nach links oder rechts.
   *
   * DREI AFFEN, DREI ARTEN ZU LAUFEN — und beide Sonderfälle stehen hier,
   * damit man sie nebeneinander sieht:
   *
   *   braun    ein Wisch = eine Bahn, sofort. Der Massstab.
   *   orange   ein Wisch = eine Bahn, aber erst nach einer halben Sekunde.
   *            Sein Nachteil: er prallt an kleinen Steinen ab, dafür muss
   *            er früher entscheiden.
   *   weiss    ein Wisch = eine Bahn; zwei Wische kurz hintereinander =
   *            ZWEI Bahnen. Sein Vorteil: er kommt quer durchs Feld,
   *            während die anderen noch nachrücken.
   *
   * @param {number} richtung -1 oder +1
   */
  _wischen(richtung, world) {
    const char = this.character ?? {};
    const anzahl = world.bahnX?.length ?? 3;

    /* Doppelwisch (weisser Affe): kam der letzte Wisch in dieselbe Richtung
     * und innerhalb des Fensters, wird daraus ein Sprung über zwei Bahnen.
     * Gemessen wird gegen die Spielzeit, nicht gegen die Wanduhr — sie
     * steht in der Pause still, und das ist hier richtig. */
    let weite = 1;
    const fenster = char.doppelwischFenster ?? 0;
    if (
      fenster > 0 &&
      richtung === this._letzterWischRichtung &&
      this.difficulty.elapsed - this._letzterWischZeit <= fenster
    ) {
      weite = 2;
      // Verbraucht: drei Wische ergeben nicht 2 + 2 Bahnen.
      this._letzterWischZeit = -Infinity;
    } else {
      this._letzterWischZeit = this.difficulty.elapsed;
    }
    this._letzterWischRichtung = richtung;

    const ziel = Math.max(0, Math.min(anzahl - 1, this.player.zielBahn + richtung * weite));

    /* Verzögerung (oranger Affe): der Wunsch wird gemerkt und erst später
     * ausgeführt. Ein zweiter Wisch in der Wartezeit ÜBERSCHREIBT den
     * ersten — sonst staute sich eine Warteschlange, und er liefe noch
     * Sekunden später los. */
    const verzug = char.wischVerzoegerung ?? 0;
    if (verzug > 0) {
      this._wischZiel = ziel;
      this._wischUhr = verzug;
      return;
    }
    this.player.zielBahn = ziel;
  }

  /** Lässt die Verzögerung des orangen Affen ablaufen. */
  _wischUhrLaufen(dt, world) {
    if (this._wischUhr <= 0) return;
    this._wischUhr -= dt;
    if (this._wischUhr > 0) return;
    this._wischUhr = 0;
    if (this._wischZiel === null) return;
    const anzahl = world.bahnX?.length ?? 3;
    this.player.zielBahn = Math.max(0, Math.min(anzahl - 1, this._wischZiel));
    this._wischZiel = null;
  }

  /* =========================================================== Goldmodus */

  /**
   * Goldene Banane eingesammelt: der Affe wird SOFORT golden.
   *
   * Der Goldmodus hing früher am Bosskampf — er war dessen Belohnung. Der
   * Kampf ist weg, der Goldmodus bleibt: die goldene Banane fällt jetzt
   * einfach ab und zu vom Himmel (siehe CONFIG.goldbanane).
   *
   * SOFORT heisst sofort. Sind die Goldbilder noch nicht geladen, läuft der
   * Modus trotzdem an und das Fell kommt nach — die dreifachen Münzen sind
   * die Belohnung, nicht das Fell, und auf ein Nachladen zu warten hiesse,
   * dem Spieler Sekunden seiner 30 zu stehlen.
   */
  _goldmodusStarten() {
    const b = this.cfg.goldbanane;
    this._goldRest = b.sekunden;
    this.ui.toast('Gold-Gebiet!', 'banana');
    this.klang.effekt('banane');

    /* INS GOLD-GEBIET WECHSELN.
     *
     * Die goldene Wand wird als Sonderstufe eingehängt (PlantWall.
     * sonderStufe). Damit wechselt in einem Zug auch die Musik: Game meldet
     * jeden Frame `klang.atmo(wall.stageName)`, und der Name der Sonderstufe
     * ist 'gold' — also läuft public/musik/gold.ogg, überblendet wie jeder
     * andere Gebietswechsel auch.
     *
     * Beim Zurückkehren steht in `difficulty.elapsed` die inzwischen
     * verstrichene Zeit; die Wand landet also dort, wo sie ohne den
     * Abstecher auch stünde — 30 Sekunden weiter, notfalls ein Gebiet
     * weiter. */
    this.wall.sonderStufe(b.gebiet, this.difficulty.elapsed);

    if (this._goldFrames) {
      this.player.fellWechseln?.(this._goldFrames);
      return;
    }
    /* Bildzahl aus der Konfiguration statt fest verdrahtet.
     *
     * Hier stand `{ length: 12 }`. Das Goldfell ist inzwischen ein
     * geschlossener Kletterzyklus aus seinem Video (19 Posen) — mit der
     * festen 12 hätte man sieben davon nie gesehen, und die Bewegung bräche
     * mitten im Zyklus ab. Umgekehrt hätte eine zu grosse Zahl den bekannten
     * stillen Fehler ausgelöst: der Entwicklungsserver liefert für fehlende
     * Bilder index.html mit Status 200. `npm run pruef:bilder` vergleicht die
     * Angabe jetzt mit der Platte. */
    const pfade = Array.from(
      { length: b.frameAnzahl },
      (_, i) => b.framePath.replace('{n}', String(i).padStart(2, '0')),
    );
    this._loader
      .loadTexturesParallel(pfade, 'Goldaffe…')
      .then((t) => {
        this._goldFrames = pfade.map((p) => t.get(p)).filter(Boolean);
        // Nur anziehen, wenn der Goldmodus dann noch läuft.
        if (this._goldRest > 0) this.player.fellWechseln?.(this._goldFrames);
      })
      .catch((f) => console.warn('[Gold] Goldfell fehlt:', f));
  }

  /** Zählt den Goldmodus herunter und zieht dem Affen das Fell wieder aus. */
  _goldmodusSchritt(dt) {
    if (this._goldRest <= 0) return;
    this._goldRest -= dt;
    if (this._goldRest <= 0) {
      this._goldRest = 0;
      this.player.fellWechseln?.(null);
      // Zurück in die reguläre Reihe — Wand und Musik zugleich.
      this.wall.sonderStufe(null, this.difficulty.elapsed);
      this.ui.toast('Gold-Gebiet vorbei', 'revive');
    }
  }

  /**
   * Goldmodus beenden — Fell UND Restzeit.
   *
   * Beide gehören zusammen, und genau daran hing ein Fehler: `player.reset()`
   * zog dem Affen das Goldfell aus, `_goldRest` lief aber weiter. Nach dem
   * Weiterspielen per Werbung gab es dann dreifache Münzen ohne goldenen
   * Affen — ein Vorteil, den man weder sieht noch erklären kann.
   */
  _goldmodusAus() {
    this._goldRest = 0;
    this.player?.fellWechseln?.(null);
    /* Und aus dem Gold-GEBIET heraus, nicht nur aus dem Goldfell.
     *
     * Dieselbe Falle wie oben, nur eine Ebene höher: wer beim Abbruch die
     * Sonderstufe stehen lässt, spielt den Rest der Runde vor goldener Wand
     * mit Goldmusik — und weil die Sonderstufe die Zeitsteuerung aussetzt,
     * käme nie wieder ein Gebietswechsel. */
    this.wall?.sonderStufe?.(null, this.difficulty?.elapsed ?? 0);
  }

  /** Münzfaktor dieses Augenblicks — 1 normal, 3 im Goldrausch. */
  get _muenzFaktor() {
    return this._goldRest > 0 ? this.cfg.goldbanane.muenzFaktor : 1;
  }

  /* =========================================================== Sturzflug */

  /**
   * Wie viele Sturzflüge gehören in dieses Gebiet?
   *
   * Ab `abGebiet` einer, alle paar Gebiete einer mehr — gedeckelt bei `max`.
   */
  _sturzProGebiet() {
    const s = this.cfg.sturzflug;
    const gebiet = this._gebietWechsel + 1;
    if (gebiet < s.abGebiet) return 0;
    /* Eine Tabelle statt einer Formel: der Nutzer wollte ausdrueckliche
     * Zahlen je Gebietsbereich (2-4 drei Angriffe, 5-8 fuenf bis sechs, ab 9
     * sieben). Eine Formel haette das nur ungefaehr getroffen. Der letzte
     * Eintrag gilt fuer alles danach. */
    const st = s.proGebiet.stufen;
    const i = Math.min(st.length - 1, gebiet - s.abGebiet);
    return Math.min(s.proGebiet.max, st[i]);
  }

  /**
   * Uhr für den nächsten Sturzflug stellen.
   *
   * Ein Gebiet dauert so lange wie der Abstand zweier Wandstufen. Bei n
   * Angriffen wird es in n+1 Abschnitte geteilt, damit keiner direkt am
   * Gebietswechsel klebt — dort ist ohnehin schon Bewegung im Bild.
   */
  _sturzUhrStellen() {
    const n = this._sturzProGebiet();

    /* DIE QUOTE WIRD GEZÄHLT, nicht nur ausgerechnet.
     *
     * Ohne Zähler stellte sich die Uhr nach jedem Angriff einfach neu, und
     * in ein Gebiet passte, was zeitlich hineinpasste: gemessen kamen im
     * Gebiet 2 ZWEI Angriffe, obwohl einer vorgesehen war. Die Zahl in der
     * Config hätte damit nur den Abstand bestimmt, nicht die Menge — und
     * "ab dem zweiten Gebiet einer" wäre eine Behauptung ohne Deckung. */
    if (n <= 0 || this._sturzImGebiet >= n) {
      this._sturzUhr = 0;
      return;
    }
    const stages = this.cfg.wall.stages;
    const dauer = stages.length > 1 ? stages[1].afterSeconds - stages[0].afterSeconds : 132;
    const abschnitt = dauer / (n + 1);
    // Streuung, sonst kommt er immer an derselben Stelle im Gebiet.
    this._sturzUhr = abschnitt * (0.7 + Math.random() * 0.6);
  }

  /** Zählt die Uhr herunter und löst aus, wenn nichts anderes läuft. */
  _sturzflugSchritt(dt) {
    if (this._sturzUhr <= 0) return;
    // Ein laufender Sturzflug oder Chili-Flug darf keinen zweiten anstossen.
    if (this.sturzflug?.aktiv || this._chiliFlug !== null) return;
    this._sturzUhr -= dt;
    if (this._sturzUhr > 0) return;
    this._sturzUhr = 0;
    this.sturzflugStarten(); // ohne await, siehe dort
  }

  /**
   * Sturzflug auslösen. Lädt beim ersten Mal die Bilder nach.
   *
   * BEWUSST OHNE await AUFGERUFEN — der Lauf soll nicht auf das Netz warten.
   * Kommen die Bilder zu spät, fällt dieser eine Angriff eben aus.
   */
  async sturzflugStarten() {
    if (this.sturzflug?.aktiv || this._sturzLaedt) return false;
    if (!this.states.is(GameState.PLAYING)) return false;

    const s = this.cfg.sturzflug;

    if (!this.sturzflug) {
      this._sturzLaedt = true;
      try {
        const pfade = [...s.bilder, s.warnung.bild];
        const t = await this._loader.loadTexturesParallel(pfade, 'Vögel…');
        this.sturzflug = new Sturzflug(
          this.scene,
          s,
          {
            voegel: s.bilder.map((p) => t.get(p)),
            warnung: t.get(s.warnung.bild) ?? null,
          },
          {
            klang: this.klang,
            // Ein Vogeltreffer wirkt wie ein Stein — über Leben und Tod
            // entscheidet weiter genau eine Stelle.
            onTreffer: () => this._onRockHit(null),
            onEnde: () => this._sturzUhrStellen(),
          },
        );
      } catch (fehler) {
        console.error('[Sturzflug] konnte nicht geladen werden:', fehler);
        return false;
      } finally {
        this._sturzLaedt = false;
      }
      if (!this.states.is(GameState.PLAYING) || !this.player.alive) return false;
    }

    /* Stärke: 0 im ersten erlaubten Gebiet, 1 ab dem Deckel. Sie entscheidet,
     * wie wahrscheinlich ZWEI Bahnen gleichzeitig bedroht werden.
     *
     * HIER STAND `s.proGebiet.start`, UND DIESES FELD GIBT ES NICHT.
     *
     * Es ist aus der Zeit übrig, als die Häufigkeit eine Formel war
     * (Startwert plus Steigerung). Seit sie als Tabelle `stufen` dasteht,
     * war `start` undefined — und damit die ganze Rechnung NaN. Der
     * Vergleich `Math.random() < NaN` ist immer falsch, also wurde nie eine
     * zweite Bahn gezogen: über 22 Minuten Spielzeit kamen 49 Angriffe, alle
     * einspurig. Gemeldet hat das nichts, NaN wirft nicht.
     *
     * Die Spanne kommt jetzt aus der Tabelle selbst: vom ersten Eintrag bis
     * zum Deckel. */
    const stufen = s.proGebiet.stufen;
    const anfang = stufen[0];
    const spanne = Math.max(1, s.proGebiet.max - anfang);
    const staerke = Math.min(1, Math.max(0, (this._sturzProGebiet() - anfang) / spanne));
    const los = this.sturzflug.starten(this.worldView, staerke, this.player.cfg?.moveSpeed ?? this.cfg.player.moveSpeed);
    if (los) this._sturzImGebiet++;
    return los;
  }

  /* ========================================================== Bosskampf */

  /**
   * Beim Gebietswechsel würfeln, ob ein Boss kommt.
   *
   * ZUFÄLLIG UND NICHT NACH PLAN — der Schreck ist der halbe Boss. Ein
   * fester Takt („jedes vierte Gebiet") wäre nach zwei Runden durchschaut.
   * Zwei Bedingungen zähmen den Zufall: nicht vor Gebiet `abGebiet`, und
   * nicht zu dicht hintereinander (`mindestAbstandGebiete`).
   */
  _bossPruefen() {
    const b = this.cfg.boss;
    const gebiet = this._gebietWechsel + 1;
    if (gebiet < b.abGebiet) return;
    if (gebiet - this._letzterBossGebiet < b.mindestAbstandGebiete) return;
    // Nicht mitten in etwas anderem, das den Bildschirm beansprucht.
    if (this.bossKampf?.aktiv || this.sturzflug?.aktiv || this._chiliFlug !== null) return;
    if (this._goldRest > 0) return;
    if (Math.random() >= b.chanceProGebiet) return;

    this._letzterBossGebiet = gebiet;
    this.bossStarten(); // ohne await, siehe dort
  }

  /**
   * Bosskampf auslösen. Lädt beim ersten Mal die Bildfolgen nach.
   *
   * BEWUSST OHNE await AUFGERUFEN — der Lauf soll nicht auf das Netz warten.
   * Kommen die Bilder zu spät, fällt dieser eine Kampf eben aus. Dasselbe
   * Vorgehen wie beim Sturzflug, und aus demselben Grund.
   */
  async bossStarten() {
    if (this.bossKampf?.aktiv || this._bossLaedt) return false;
    if (!this.states.is(GameState.PLAYING)) return false;

    const b = this.cfg.boss;

    if (!this.bossKampf) {
      this._bossLaedt = true;
      try {
        /* Alles auf einmal anfordern: die Bildfolgen beider Ausführungen,
         * ihre Geschosse, die Sammelbanane und die Wurfbilder des Affen. */
        const pfade = [];
        for (const art of b.arten) {
          for (let i = 0; i < art.frameAnzahl; i++) {
            pfade.push(art.framePath.replace('{n}', String(i).padStart(2, '0')));
          }
          pfade.push(art.wurf.bild);
        }
        for (let i = 0; i < b.wurf.frameAnzahl; i++) {
          pfade.push(b.wurf.framePath.replace('{n}', String(i).padStart(2, '0')));
        }
        pfade.push(this.cfg.banana.bild);

        const t = await this._loader.loadTexturesParallel([...new Set(pfade)], 'Boss…');

        const arten = new Map();
        for (const art of b.arten) {
          const frames = [];
          for (let i = 0; i < art.frameAnzahl; i++) {
            const p = art.framePath.replace('{n}', String(i).padStart(2, '0'));
            const tex = t.get(p);
            if (tex) frames.push(tex);
          }
          if (frames.length) arten.set(art.id, { frames, wurf: t.get(art.wurf.bild) ?? null });
        }

        this.bossKampf = new BossKampf(
          this.scene,
          b,
          {
            arten,
            munition: t.get(this.cfg.banana.bild) ?? null,
            spielerWurf: t.get(this.cfg.banana.bild) ?? null,
          },
          {
            klang: this.klang,
            ui: this.ui,
            // Ein Bossgeschoss wirkt wie ein Stein — über Leben und Tod
            // entscheidet weiter genau eine Stelle.
            onTreffer: () => this._onRockHit(null),
            onSieg: () => this._goldmodusStarten(),
            onEnde: () => {},
          },
        );

        /* Die Wurfbilder an den Affen geben. Die Maschinerie dafür sitzt
         * schon in SpritePlayer (setzeWurfFrames/werfen) — sie stammt aus
         * dem alten Adlerkampf und wartete seither auf jemanden, der sie
         * füttert. */
        const wurfFrames = [];
        for (let i = 0; i < b.wurf.frameAnzahl; i++) {
          const p = b.wurf.framePath.replace('{n}', String(i).padStart(2, '0'));
          const tex = t.get(p);
          if (tex) wurfFrames.push(tex);
        }
        this.player.setzeWurfFrames?.(wurfFrames, b.wurf);
      } catch (fehler) {
        console.error('[Boss] konnte nicht geladen werden:', fehler);
        return false;
      } finally {
        this._bossLaedt = false;
      }
      if (!this.states.is(GameState.PLAYING) || !this.player.alive) return false;
    }

    if (!this.bossKampf.bereit) {
      console.warn('[Boss] keine einzige Bildfolge geladen — Kampf fällt aus.');
      return false;
    }
    return this.bossKampf.starten(this.player, this.worldView);
  }

  /**
   * Musiktempo für das aktuelle Gebiet.
   *
   * Steht hier und nicht im Loop, weil es an ZWEI Stellen gebraucht wird:
   * beim Gebietswechsel und nach dem Chili-Durchflug, der ein Gebiet
   * überspringt. Zwei Kopien derselben Formel wären genau die Art Fehler,
   * die man erst hört und dann sucht.
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
      /* DER SOCKEL MUSS MITWANDERN.
       *
       * `idleCycleSpeed` ist die Untergrenze des Takts (siehe SpritePlayer),
       * und im Spiel klettert der Affe fast immer geradeaus — der Sockel IST
       * damit das normale Tempo und nicht der Sonderfall. Blieb hier der
       * globale Wert stehen, lief jeder Affe im selben Takt, egal wie lang
       * sein eigener Kletterzyklus ist. Der orange hat 21 Bilder statt 19;
       * mit fremdem Sockel abgespielt stimmt seine Bewegung nicht mehr mit
       * seiner Vorlage überein. */
      idleCycleSpeed: char.cycleSpeed,
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

    /* FLUGBILDER GEHÖREN ZUM AFFEN, NICHT ZUM SPIEL.
     *
     * `_chiliFramesLaden` lädt nur, wenn `_chiliFrames` noch leer ist. Ohne
     * dieses Zurücksetzen behielte ein gewechselter Affe die Flugbilder des
     * vorherigen: wer als brauner spielt und dann auf orange wechselt, flöge
     * mit braunem Fell — und beim weissen wäre es noch auffälliger, weil
     * seine Folge nur acht Bilder hat statt zwölf. */
    this._chiliFrames = null;

    // Die seitlichen Grenzen hängen am Trefferradius — nach einem Wechsel neu
    // rechnen, sonst gälte bis zum nächsten Resize das alte Band.
    this._updateWorldBounds();
    this.tempolinien?.groesseSetzen(this.worldView.bounds);

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
    this.player.reset(this.worldView.bahnX);
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
     * Sturzflug-Zaehler leer sein. */
    this.sturzflug?.abbrechen();
    this.bossKampf?.abbrechen(this.player);
    // Auch der Boss-Mindestabstand gehört zum Lauf: sonst käme im neuen
    // Lauf erst dann wieder einer, wenn die Gebietszählung den Stand des
    // ALTEN Laufs eingeholt hat.
    this._letzterBossGebiet = -99;
    this._sturzUhr = 0;
    this._sturzImGebiet = 0;
    this._goldmodusAus();
    this._chiliAbbrechen();

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

    /* Goldfell wieder anziehen, solange der Goldmodus läuft.
     *
     * `reviveInPlace` geht über `_resetAnimation`, und das setzt das Fell auf
     * das normale zurück — `_goldRest` lief aber weiter. Ergebnis: dreifache
     * Münzen an einem ganz normal aussehenden Affen. Ein Vorteil, den man
     * weder sieht noch erklären kann, ist schlimmer als gar keiner. */
    if (this._goldRest > 0 && this._goldFrames) {
      this.player.fellWechseln?.(this._goldFrames);
    }

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
    this.player.reset(this.worldView.bahnX);
    // Der Sturzflug gehört zum Lauf, nicht zum Menü.
    this.sturzflug?.abbrechen();
    this.bossKampf?.abbrechen(this.player);
    this._goldmodusAus();
    /* Auch der Chili-Flug. Er verstellt zwei Dinge, die `player.reset()` NICHT
     * anfasst: den Bildwinkel der Kamera und die Tempolinien. Ein Tabwechsel
     * pausiert von selbst, und aus der Pause führt ein Knopf ins Hauptmenü —
     * wer das mitten im Flug tut, sah bis dahin ein herausgezoomtes Menü mit
     * weissen Streifen darüber. Schlimmer: ein Charakterwechsel im Menü misst
     * dann die Feldbreite mit dem hängengebliebenen Bildwinkel, und die Bahnen
     * lägen den ganzen nächsten Lauf zu weit aussen. */
    this._chiliAbbrechen();
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

    /* Der Chili-Durchflug schiebt die SPIELUHR vor — daran hängen Wandstufe,
     * Schwierigkeit und Musiktempo. Er muss deshalb VOR difficulty.update
     * laufen, sonst zählt der Schub einen Frame zu spät. */
    const chiliSchub = this._chiliSchritt(dt);
    this.difficulty.update(dt + chiliSchub);

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

    /* DER CHILI-DURCHFLUG RAST — Wand, Meter und Wandstufe gemeinsam.
     *
     * `chiliSchub` ist die zusätzliche SPIELZEIT dieses Frames. Wird sie
     * hier auf die Kletterstrecke mitgerechnet, bewegt sich die ganze Welt
     * um genau diese Zeit weiter: die Wand rauscht nach unten, der
     * Meterzähler springt, und die Wandstufe wechselt am selben Punkt wie
     * sonst auch.
     *
     * Erst ging der Schub allein in `difficulty.update`, und hier stand nur
     * `base * dt`. Ergebnis: das Gebiet wechselte zwar, aber im Bild
     * passierte nichts — er stand mit brennendem Hintern da und wartete.
     * Genau das ist der Unterschied zwischen "die Uhr springt" und "er
     * fliegt durch". */
    const climbed = base * (dt + chiliSchub);

    // Die Wand scrollt während der Sterbe-Verzögerung weiter (sonst friert das
    // Bild abrupt ein), der Score aber NICHT — sonst bekäme man für die
    // Sekunde nach dem tödlichen Treffer noch Höhenmeter gutgeschrieben.
    if (this.player.alive) this.score.addHeight(climbed);
    // Die Spielzeit steuert die Hintergrundstufe — der Wechsel fällt damit
    // mit dem Schwierigkeitssprung zusammen.
    this.wall.update(dt, climbed, this.difficulty.elapsed);

    /* Tempolinien mit der TATSÄCHLICH zurückgelegten Strecke dieses Frames,
     * nicht mit einem Schätzwert. Ausserhalb des Fluges ist der Wert 0,
     * dann blenden sie von selbst aus. */
    this.tempolinien?.update(dt, this._chiliFlug ? climbed / Math.max(dt, 1e-4) : 0);
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
    /* DAS GOLD-GEBIET ZÄHLT NICHT ALS GEBIETSWECHSEL.
     *
     * An diesem Block hängt alles, was „ein neues Gebiet" bedeutet:
     * Musiktempo, Sturzflug-Kontingent, die Prüfung auf goldene Banane und
     * Chili, der Bananenzähler. Der Abstecher ins Gold-Gebiet und zurück
     * würde hier ZWEI Wechsel auslösen — das Musiktempo spränge um zwei
     * Stufen, und die Belohnungsprüfung liefe mitten im Goldrausch erneut,
     * was eine zweite goldene Banane hätte fallen lassen können.
     *
     * Solange die Sonderstufe läuft, bleibt `_letztesGebiet` deshalb auf dem
     * Gebiet stehen, aus dem man gekommen ist. Beim Zurückkehren wird nur
     * dann gezählt, wenn sich das ECHTE Gebiet inzwischen geändert hat. */
    if (!this.wall.inSonderStufe && this.wall.stageName !== this._letztesGebiet) {
      if (this._letztesGebiet !== null) this._gebietWechsel++;
      this._letztesGebiet = this.wall.stageName;
      this.klang.tempo(this._musikTempo());

      // Neues Gebiet, neue Sturzflüge — Zahl und Zeitpunkt hängen daran.
      this._sturzImGebiet = 0;
      this._sturzUhrStellen();

      // Goldene Banane bzw. Chili fuer dieses Gebiet.
      this._belohnungenPruefen();
      // Gelbe Banane: hoechstens eine je Gebiet (siehe CONFIG.banana).
      this.spawner.neuesGebiet();
      // Und ob diesmal ein Boss kommt.
      this._bossPruefen();
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
        this._wischen(richtung, world);
      }
      this._letzteRichtung = richtung;
      this._wischUhrLaufen(dt, world);
    }

    /* ---- Tipp/Klick/Leertaste: der Bananenwurf --------------------------- *
     * Er wird IMMER abgeholt, auch ausserhalb des Kampfes — sonst staut sich
     * ein Tipp auf und zündet später im Menü. Gebraucht wird er nur im
     * Kampf; `wurfAnfordern` prüft das selbst. */
    const tipp = this.input.consumeTipp?.();
    if (tipp && this.bossKampf?.kaempft && this.player.alive) {
      this.bossKampf.wurfAnfordern(this.player);
    }

    /* ---- Entities ----------------------------------------------------- */
    const spielerEreignis = this.player.update(
      dt,
      this.player.alive ? axis : ZERO_AXIS,
      world.bounds,
      world.bahnX,
    );

    /* Die Banane verlässt die Hand — der Affe meldet das genau ein Bild
     * lang, wenn der Arm gestreckt ist. Erst dann fliegt sie los; früher
     * sähe es aus, als fiele sie aus dem Ärmel. */
    if (spielerEreignis === 'wurf') this.bossKampf?.bananeLoslassen(this.player);

    this.spawner.update(dt, this.player.revives > 0, base);
    // Kampf und Sturzflug NACH dem Spieler: beide prüfen gegen dessen
    // frische Position.
    this._sturzflugSchritt(dt);
    this.sturzflug?.update(dt, this.player, world);
    this.bossKampf?.update(dt, this.player, world);
    if (this.bossKampf?.munitionEinsammeln(this.player, world)) {
      this.klang.effekt('banane');
    }

    /* NACHSCHUB: EINE Stelle entscheidet.
     *
     * Bosskampf, Sturzflug und Chili-Durchflug raeumen alle drei den
     * Bildschirm frei. Setzte jedes den Schalter selbst, schaltete das eine
     * ihn beim Aufraeumen wieder ein, waehrend das andere noch laeuft.
     * Deshalb wird er hier jeden Frame aus allen Zustaenden gebildet. */
    this.spawner.nachschubAus =
      (this.sturzflug?.aktiv ?? false) ||
      (this.bossKampf?.aktiv ?? false) ||
      this._chiliFlug !== null;

    this._goldmodusSchritt(dt);
    this.spawner.goldrauschSetzen(this._goldRest > 0);

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
        // Sonst liefen Sturzflug und Bosskampf über den Game-Over-Screen weiter.
        this.sturzflug?.abbrechen();
        this.bossKampf?.abbrechen(this.player);
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
    /* Auch hier: die beiden Messungen unten rechnen mit der WELTMATRIX, und
     * die ist nach einem Seitenverhältnis-Wechsel bis zum nächsten Bild
     * veraltet. Ein `updateProjectionMatrix` allein genügt nicht — siehe
     * die ausführliche Begründung in _buildScene. */
    this.camera.updateMatrixWorld(true);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.cfg.render.maxPixelRatio));
    this.renderer.setSize(w, h);

    this._updateWorldBounds();

    this.tempolinien?.groesseSetzen(this.worldView.bounds);
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

    /* IMMER MIT DEM NORMALEN BILDWINKEL MESSEN.
     *
     * Der Chili-Flug weitet `camera.fov` um bis zu 9 Grad (Kamerastoss). Wird
     * währenddessen das Fenster gedreht oder in der Grösse verändert, läuft
     * diese Messung mit dem geweiteten Winkel — und die Bahnen bleiben für den
     * REST DES LAUFS zu weit aussen, denn nach dem Flug wird nicht neu
     * gemessen. Gerechnet ergibt das bis zu einem Drittel zu breite Bahnen,
     * auf denen der Affe teils aus dem Bild steht.
     *
     * Deshalb wird für die Messung kurz auf den Normalwert zurückgeschaltet.
     * Das Feld ist damit eine Eigenschaft des Spiels und nicht davon abhängig,
     * ob gerade eine Animation läuft. */
    const fovJetzt = this.camera.fov;
    const fovNormal = this.cfg.render.camera.fov;
    if (fovJetzt !== fovNormal) {
      this.camera.fov = fovNormal;
      this.camera.updateProjectionMatrix();
    }
    const half = halfWidthAt(this.camera, 0, affenHoehe);
    if (fovJetzt !== fovNormal) {
      this.camera.fov = fovJetzt;
      this.camera.updateProjectionMatrix();
    }
    if (!Number.isFinite(half)) return;

    /* DER RAND IST DIE HALBE BILDBREITE DES AFFEN, NICHT SEIN TREFFERRADIUS.
     *
     * Hier stand `hitRadius * 1.6`. Das war eine Faustzahl für "etwas Rand
     * lassen" und hat nichts damit zu tun, wann der Affe wirklich beschnitten
     * wird — beschnitten wird er, wenn sein BILD über den Rand ragt, und das
     * Bild ist 1.40 Einheiten breit, während hitRadius·1.6 nur 0.67 ergab.
     *
     * Der Unterschied ist gering (0.03 Einheiten), aber die Bedeutung nicht:
     * jetzt ist `limit` genau die Stelle, an der der Affe bündig mit dem
     * Bildrand steht. Deshalb darf die äusserste Bahn auch bei 1.0 liegen —
     * ganz in der Ecke, wie es sein soll.
     *
     * Vom SPIELER genommen, nicht aus CONFIG: der weisse Affe ist halb so
     * gross und bekommt dadurch ein breiteres Feld. */
    /* DER RAND MUSS AUCH DAS BREITESTE OBJEKT FASSEN, nicht nur den Affen.
     *
     * Auf der äussersten Bahn steht nicht nur der Affe — dort fällt auch,
     * was ihn treffen soll. Gemessen ragte der Feuerball ("feuer/gross",
     * 1.788 breit) 0.192 Einheiten über den Bildrand hinaus, während der
     * Affe (1.403) bündig abschloss.
     *
     * Der Affe steht dadurch nicht mehr exakt am Rand, sondern 0.192
     * Einheiten davor — im Hochformat rund 16 Bildpunkte. Das ist der
     * richtige Tausch: "in der Ecke" bleibt es sichtbar, "halb aus dem Bild"
     * wäre ein Fehler. */
    const halbeBreite = Math.max(
      (this.player?.spriteWidth ?? 1.4) / 2,
      groessteSpriteBreite(this.cfg.rock) / 2,
    );
    const limit = Math.max(0.9, half - halbeBreite);

    /* Die BISHERIGE Bahnbreite, nicht die bisherige Feldbreite.
     *
     * Hier stand `view.bounds.maxX`. Seit der Bahnabstand gedeckelt wird
     * (siehe unten), sind das zwei verschiedene Dinge: auf einem breiten
     * Schirm ist das Feld 9.05 breit, die Bahnen liegen aber bei 2.2. Die
     * Streckung unten würde dann mit 2.2/9.05 rechnen und jedes fallende
     * Objekt beim kleinsten Anlass quer über den Schirm ziehen. */
    const altesFeld = view._halbFeld ?? view.bounds.maxX;

    view.bounds.minX = Math.max(base.bounds.minX, -limit);
    view.bounds.maxX = Math.min(base.bounds.maxX, limit);
    view.bounds.minY = base.bounds.minY;
    view.bounds.maxY = base.bounds.maxY;

    /* Die Bahnen aus den Anteilen. Hängen am tatsächlichen Feld, nicht an
     * festen Weltkoordinaten — im Hochformat ist es weniger als halb so
     * breit wie im Querformat.
     *
     * ABER GEDECKELT. Ungedeckelt wächst der Bahnabstand linear mit der
     * Bildbreite, während der Trefferradius gleich bleibt: auf einem
     * 16:9-Schirm klaffen zwischen zwei Bahnen 6.2 Einheiten, in denen
     * NICHTS fallen kann. Ein Spieler, der dort hin und her pendelt, ist
     * unverwundbar — gemessen zehn von zehn Läufen über 15 Minuten ohne
     * einen Treffer, während derselbe Spieler auf dem Handy nach zwei
     * Sekunden stirbt. Die ausführliche Begründung samt Zahlen steht bei
     * CONFIG.world.bahnDeckel.
     *
     * Das Spielfeld rückt dadurch auf breiten Schirmen in die Mitte. Der
     * Affe, die Objekte und die Wand behalten ihre Grösse — nur die Strecke,
     * die er zwischen den Bahnen zurücklegt, ist überall dieselbe. */
    const halbFeld = Math.min(view.bounds.maxX, base.bahnDeckel ?? Infinity);
    view._halbFeld = halbFeld;
    view.bahnX = base.bahnen.map((anteil) => anteil * halbFeld);

    /* Wo hört das Bild oben auf?
     *
     * Der Boss hängt absichtlich darüber hinaus — man soll die Hand, mit der
     * er sich festhält, NICHT sehen. Dafür braucht BossKampf die echte
     * Oberkante; `bounds.maxY` ist sie NICHT, das ist die Bewegungsgrenze des
     * Affen (2.7 gegenüber tatsächlich rund 6.8). */
    view.sichtbarObenY = topEdgeAt(this.camera, 0);

    /* WAS SCHON FÄLLT, MUSS MITWANDERN.
     *
     * Die Bahnen sind Anteile der Feldbreite. Ändert sich die Breite — Handy
     * drehen, Fenster ziehen, und ebenso JEDER CHARAKTERWECHSEL, weil das
     * Feld an der Bildbreite des Affen hängt —, dann verschieben sich alle
     * Bahnen, ein bereits fallender Stein aber nicht. Er liegt danach
     * zwischen zwei Spuren: entweder harmlos oder halb auf einer Bahn, und
     * die Zusicherung "auf deiner Spur liegt nichts" gilt für ihn nicht mehr,
     * weil sie für die ALTEN Spuren ausgerechnet wurde.
     *
     * Weil die Bahnen Anteile sind, genügt eine Streckung: x mal dem
     * Verhältnis der Feldbreiten. Ein Objekt auf Bahn 2 bleibt danach exakt
     * auf Bahn 2, egal wie sich das Feld ändert. Es rutscht dabei sichtbar
     * zur Seite — das ist richtig so, das ganze Bild ändert ja gerade seine
     * Breite.
     *
     * Der Korridor wird unten zusätzlich geklemmt; er ist eine Kurve über
     * die Zeit und wird deshalb anders behandelt. */
    if (altesFeld > 0.01 && Math.abs(halbFeld - altesFeld) > 1e-6) {
      const streckung = halbFeld / altesFeld;
      for (const pool of [this.spawner?.rocks, this.spawner?.bananas, this.spawner?.coins]) {
        for (const o of pool?.active ?? []) {
          if (!o.active) continue;
          o.x *= streckung;
          // Die Münze pendelt um ihre Abwurfstelle — die muss mit.
          if (o._mitteX !== undefined) o._mitteX *= streckung;
          o.mesh.position.x = o.x;
        }
      }
    }

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
