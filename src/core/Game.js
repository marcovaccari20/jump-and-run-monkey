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
import { PlantWall } from '../world/PlantWall.js';
import { DifficultyCurve } from '../systems/DifficultyCurve.js';
import { Spawner } from '../systems/Spawner.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { ScoreManager } from '../systems/ScoreManager.js';
import { CharacterStore } from '../systems/CharacterStore.js';
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
    this.difficulty = new DifficultyCurve(CONFIG.difficulty);
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

    // Wirksame Spielfeldmasse. Start = Config, die seitlichen Grenzen werden
    // aber bei jedem Resize an das tatsächlich Sichtbare angepasst (siehe
    // _onResize). Spawner und Player halten eine Referenz auf DIESES Objekt,
    // damit sie die Anpassung ohne Umweg mitbekommen.
    this.worldView = {
      ...CONFIG.world,
      bounds: { ...CONFIG.world.bounds },
    };

    this._buildRenderer();
    this._buildScene();

    // Wiederverwendeter Kontext für den AnimationController (keine Allokation).
    this._animCtx = { speed: 0, vx: 0, vy: 0 };

    // Kollisions-Handler einmal binden statt pro Frame Closures zu erzeugen.
    this._collisionHandlers = {
      onRock: (rock) => this._onRockHit(rock),
      onBanana: (banana) => this._onBananaHit(banana),
    };

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

  /* ================================================================== Laden */

  async load() {
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

    /* --- Spawner + Debug ----------------------------------------------- */
    this.spawner = new Spawner(this.scene, this.cfg, this.difficulty, this.worldView);
    // Der Spawner entsteht NACH der Spielfigur — _buildPlayer konnte sein
    // Bananen-Flag oben also noch nicht setzen. Hier nachholen, sonst fielen
    // für den weissen Affen beim ersten Laden doch Bananen (nur nach einem
    // Wechsel wäre es richtig gewesen).
    if (this.character) this.spawner.bananasEnabled = this.character.bananas;
    this.debug = new DebugOverlay(
      this.scene,
      this.cfg.debug,
      this.cfg.rock.poolSize + this.cfg.banana.poolSize + 1,
    );

    this._wireUI();
    this._wireStates();

    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => {
      // Im Hintergrund automatisch pausieren — sonst läuft man beim
      // Zurückkommen in einen riesigen dt und stirbt sofort.
      if (document.hidden && this.states.is(GameState.PLAYING)) this._pause();
    });

    this._onResize();

    this.anim.setMode('menu');
    this.ui.showMenu(this.score.loadHighscores());
    this.ui.setStats(this.cfg.debug.showStats ? '' : null);

    return {
      mode: this.cfg.player.mode,
      clips: this.anim.clipNames ?? [],
      stages: this.cfg.wall.stages.map((s) => `${s.name}@${s.afterSeconds}s`),
    };
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
      },
    };

    this.player = new SpritePlayer(
      this._frameCache.get(char.id),
      playerCfg,
      reviveCfg,
      spriteCfg,
    );
    this.anim = this.player.animator;
    this.scene.add(this.player.object3D);
    this.character = char;

    // Die seitlichen Grenzen hängen am Trefferradius — nach einem Wechsel neu
    // rechnen, sonst gälte bis zum nächsten Resize das alte Band.
    this._updateWorldBounds();

    // Der weisse Affe bekommt gar keine Bananen: weder Spawn noch Anzeige.
    if (this.spawner) this.spawner.bananasEnabled = char.bananas;
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
  async _pickCharacter(id) {
    const char = this.cfg.characters.list[id];
    if (!char) return;
    if (char.id === this.character?.id) {
      this._closeCharacters();
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
    this._closeCharacters();
  }

  _openCharacters() {
    // KEIN Zustandswechsel: der Automat erlaubt aus MENU nur PLAYING und
    // wirft bei allem anderen. Die Auswahl ist reine Oberfläche.
    this.ui.showCharacters(this.characters.all, this.characters.loadId());
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
  }

  _wireStates() {
    // Joystick nur im laufenden Spiel annehmen — in Menüs gehören Berührungen
    // den Buttons.
    this.states.onChange((_from, to) => {
      this.input.setTouchCapture(to === GameState.PLAYING);
    });

    this.states.onEnter(GameState.MENU, () => {
      this.anim.setMode('menu');
      this.ui.showMenu(this.score.loadHighscores());
    });

    this.states.onEnter(GameState.PLAYING, (_payload, from) => {
      this.ui.showScreen('playing');
      if (from !== GameState.PAUSED) {
        this.anim.setMode('locomotion');
        this.anim.reset();
        this.anim.playOneShot('roar');
      }
    });

    this.states.onEnter(GameState.PAUSED, () => this.ui.showScreen('paused'));

    this.states.onEnter(GameState.GAME_OVER, () => {
      const meters = this.score.meters;
      this.ui.showGameOver({
        score: meters,
        qualifies: this.score.qualifies(meters),
        isNewBest: this.score.isNewBest(meters),
        highscores: this.score.loadHighscores(),
      });
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

    this.ui.updateScore(0);
    this.ui.setRevive(false);
    this.ui.clearToast();

    this.states.transitionTo(GameState.PLAYING);
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
    // PLAYING -> MENU ist kein erlaubter Direktübergang (der Automat kennt nur
    // PAUSED/GAME_OVER -> MENU). Ein laufendes Spiel wird deshalb erst
    // angehalten — so bleibt die Übergangstabelle streng, ohne dass der
    // Aufrufer die Reihenfolge kennen muss.
    if (this.states.is(GameState.PLAYING)) this.states.transitionTo(GameState.PAUSED);
    this.spawner.reset();
    this.player.reset();
    this.states.transitionTo(GameState.MENU);
  }

  _submitName(name) {
    const meters = this.score.meters;
    const wasBest = this.score.isNewBest(meters);
    const rank = this.score.submit(name, meters);
    this.ui.updateGameOverHighscores(this.score.loadHighscores(), rank);
    // Neuer Highscore -> Roar (Vorgabe aus dem Animations-Mapping).
    if (wasBest && rank === 0) this.anim.playOneShot('roar');
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

  _handleGlobalKeys() {
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

    if (this.input.consumeConfirm()) {
      if (this.states.is(GameState.MENU)) this._startRun();
      else if (this.states.is(GameState.GAME_OVER)) this._startRun();
      else if (this.states.is(GameState.PAUSED)) this._resume();
    }
  }

  _updatePlaying(dt) {
    // Vom SPIELER, nicht aus CONFIG: climbAssist und minScrollFactor werden
    // hier an der Spielfigur vorbei gelesen. Mit this.cfg.player wäre der
    // orange Affe seitlich langsamer, würde aber unverändert schnell steigen.
    const pCfg = this.player.cfg;
    const world = this.worldView; // seitengrössenabhängig, siehe _onResize
    this.difficulty.update(dt);

    /* ---- Kletterstrecke dieses Frames -------------------------------- */
    // Vertikaler Input zahlt auf die Scrollgeschwindigkeit ein, damit sich
    // "W" wie Steigen anfühlt. Nach unten ist der Aufstieg gebremst, aber
    // nie ganz gestoppt.
    const base = this.difficulty.scrollSpeed;
    const axis = this.input.axis;
    const assisted = base + (this.player.alive ? axis.y * pCfg.climbAssist : 0);
    const effectiveScroll = Math.max(assisted, base * pCfg.minScrollFactor);
    const climbed = effectiveScroll * dt;

    // Die Wand scrollt während der Sterbe-Verzögerung weiter (sonst friert das
    // Bild abrupt ein), der Score aber NICHT — sonst bekäme man für die
    // Sekunde nach dem tödlichen Treffer noch Höhenmeter gutgeschrieben.
    if (this.player.alive) this.score.addHeight(climbed);
    // Die Spielzeit steuert die Hintergrundstufe — der Wechsel fällt damit
    // mit dem Schwierigkeitssprung zusammen.
    this.wall.update(dt, climbed, this.difficulty.elapsed);

    /* ---- Entities ----------------------------------------------------- */
    this.player.update(dt, this.player.alive ? axis : ZERO_AXIS, world.bounds);
    this.spawner.update(dt, this.player.revives > 0, effectiveScroll);

    if (this.player.alive) {
      CollisionSystem.check(this.player, this.spawner, this._collisionHandlers);
    }

    this.anim.update(dt, this.player.animContext(this._animCtx));

    /* ---- HUD ---------------------------------------------------------- */
    this.ui.updateScore(this.score.meters);
    this.debug.update(this.player, this.spawner);

    /* ---- Tod: kurze Verzögerung, damit "Die" sichtbar wird ------------ */
    if (!this.player.alive) {
      this._deathTimer -= dt;
      if (this._deathTimer <= 0) {
        this.states.transitionTo(GameState.GAME_OVER);
      }
    }
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
    if (result === 'revived') {
      this.ui.setRevive(false);
      this.ui.toast('Wiederbelebt!', 'revive');
    } else if (result === 'dead') {
      this._deathTimer = this.cfg.flow.gameOverDelay;
    }
  }

  _onBananaHit(banana) {
    this.spawner.collect(banana);
    if (this.player.collectBanana()) {
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
    this.ui.setStats(
      `${this._fps.toFixed(0)} fps\n` +
        `t        ${this.difficulty.elapsed.toFixed(1)} s\n` +
        `scroll   ${this.difficulty.scrollSpeed.toFixed(2)} u/s\n` +
        `rockSpd  ${this.difficulty.rockFallSpeed.toFixed(2)} u/s\n` +
        `interval ${this.difficulty.spawnDelay.toFixed(2)} s\n` +
        `burst    ${this.difficulty.burstCount}\n` +
        `steine   ${this.spawner.rocks.activeCount}/${this.spawner.rocks.size}\n` +
        `bananen  ${this.spawner.bananas.activeCount}/${this.spawner.bananas.size}\n` +
        `stufe    ${this.wall.stageName} (${this.wall.stageIndex})\n` +
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

    const half = halfWidthAt(this.camera, 0, base.bounds.maxY);
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

    // Steine nur dort erzeugen, wo sie auch zu sehen sind — sonst fällt der
    // Grossteil im Hochformat unsichtbar neben dem Bild herunter.
    view.spawnHalfWidth = Math.min(base.spawnHalfWidth, limit + 0.4);
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
