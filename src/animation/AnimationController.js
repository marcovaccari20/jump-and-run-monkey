/**
 * AnimationController
 *
 * ----------------------------------------------------------------------------
 * DIE SPIELLOGIK KENNT KEINE CLIP-NAMEN.
 *
 * Nach aussen gibt es nur logische Zustände:
 *     Fortbewegung : climbUp | climbDown | climbLeft | climbRight | climbIdle
 *     Akzent       : dodge
 *     Ereignisse   : die | eat | revive | roar
 *
 * Welcher GLB-Clip dahintersteckt, mit welcher Geschwindigkeit und mit welcher
 * Modellrotation, steht ausschliesslich in CONFIG.animation.clipMap.
 * Kommen echte Kletteranimationen ins GLB, wird NUR diese Map angepasst —
 * an dieser Datei und an der Spiellogik ändert sich nichts.
 * ----------------------------------------------------------------------------
 *
 * Alle Übergänge laufen über crossFadeTo (0.15–0.25 s), es gibt keine harten Cuts.
 * Der Dodge-Akzent wird ADDITIV über den laufenden Kletter-Clip geblendet
 * (AdditiveAnimationBlendMode), überschreibt ihn also nicht.
 */
import {
  AdditiveAnimationBlendMode,
  AnimationClip,
  AnimationMixer,
  AnimationUtils,
  LoopOnce,
  LoopRepeat,
} from 'three';

import { TailSimulation } from './TailSimulation.js';

/** Diese Ereignisse laufen NICHT automatisch in die Fortbewegung zurück. */
const HOLD_ONE_SHOTS = new Set(['die']);

export class AnimationController {
  /**
   * @param {import('three').Object3D} model  geladene GLB-Szene
   * @param {import('three').AnimationClip[]} clips
   * @param {typeof import('../config.js').CONFIG.animation} cfg
   */
  constructor(model, clips, cfg) {
    this.cfg = cfg;
    this.model = model;
    this.mixer = new AnimationMixer(model);
    this.clipNames = clips.map((c) => c.name);

    /** @type {Map<string, import('three').AnimationAction>} */
    this.locomotion = new Map();
    /** @type {Map<string, import('three').AnimationAction>} */
    this.oneShots = new Map();
    /** @type {Array<import('three').AnimationAction>} */
    this.menuActions = [];

    this._missing = [];
    this._strippedTracks = 0;

    /* --------------------------------------------------------------------
     * Fortbewegung: pro clipMap-SCHLÜSSEL eine eigene Action.
     *
     * Wichtig: mixer.clipAction(clip) cached pro (clip, root). climbUp und
     * climbDown zeigen beide auf 'Run' — ohne Klon bekämen sie dieselbe
     * Action und liessen sich nicht gegeneinander überblenden. Deshalb wird
     * der Clip pro Schlüssel geklont und umbenannt.
     * ------------------------------------------------------------------ */
    for (const [key, entry] of Object.entries(cfg.clipMap)) {
      if (key === 'dodge') continue;
      const source = this._findClip(clips, entry.clip, key);
      if (!source) continue;

      const clip = this._prepareClip(source, `__loco_${key}`);

      const action = this.mixer.clipAction(clip);
      action.setLoop(entry.loop === 'once' ? LoopOnce : LoopRepeat, Infinity);
      action.clampWhenFinished = entry.loop === 'once';
      action.setEffectiveTimeScale(entry.timeScale);
      this.locomotion.set(key, action);
    }

    /* ------------------------------------------------ Dodge (additiv) --- */
    const dodgeEntry = cfg.clipMap.dodge;
    const dodgeSource = dodgeEntry
      ? this._findClip(clips, dodgeEntry.clip, 'dodge')
      : null;
    if (dodgeSource) {
      // makeClipAdditive rechnet die erste Frame-Pose heraus, sodass der Clip
      // als Differenz auf den laufenden Kletter-Clip addiert werden kann.
      const additive = AnimationUtils.makeClipAdditive(
        this._prepareClip(dodgeSource, '__dodge_src'),
      );
      additive.name = '__dodge_additive';

      const action = this.mixer.clipAction(additive);
      action.blendMode = AdditiveAnimationBlendMode;
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = false;
      this._dodgeAction = action;
      this._dodgeDuration = additive.duration / Math.abs(dodgeEntry.timeScale || 1);
    } else {
      this._dodgeAction = null;
      this._dodgeDuration = 0;
    }

    /* ------------------------------------------------------ Ereignisse --- */
    for (const [key, clipName] of Object.entries(cfg.oneShots)) {
      const source = this._findClip(clips, clipName, `oneShots.${key}`);
      if (!source) continue;
      const action = this.mixer.clipAction(this._prepareClip(source, `__once_${key}`));
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      this.oneShots.set(key, action);
    }

    /* ------------------------------------------------- Menü-Leerlauf ---- */
    for (const clipName of cfg.menuIdleCycle) {
      const source = this._findClip(clips, clipName, 'menuIdleCycle');
      if (!source) continue;
      const clip = this._prepareClip(source, `__menu_${clipName}`);
      const action = this.mixer.clipAction(clip);
      action.setLoop(LoopRepeat, Infinity);
      this.menuActions.push(action);
    }

    if (this._missing.length) {
      console.warn(
        `[AnimationController] Fehlende Clips im GLB: ${this._missing.join(', ')}\n` +
          `Vorhanden: ${this.clipNames.join(', ')}`,
      );
    }

    /* ------------------------------------------------------- Zustand ---- */
    this.mode = 'menu'; //  'menu' | 'locomotion'
    this._activeFull = null; //  aktuell dominante Ganzkörper-Action
    this._locomotionKey = null;
    this._pendingLocomotion = null;
    this._oneShotKey = null;
    this._oneShotTimer = 0;
    this._menuIndex = 0;
    this._menuTimer = 0;
    this._dodgeCooldown = 0;
    this._dodgeElapsed = -1;

    // Modellausrichtung (Grad), wird weich nachgeführt.
    // rollDeg = Drehung um die Bild-Normale (Z), pitchDeg = Kippen in die Wand (X).
    this.rollDeg = cfg.clipMap.climbIdle?.rollDeg ?? 0;
    this.pitchDeg = cfg.clipMap.climbIdle?.pitchDeg ?? 0;
    this._targetRoll = this.rollDeg;
    this._targetPitch = this.pitchDeg;

    this.tail = new TailSimulation(model, cfg.tail);
  }

  _findClip(clips, name, usedBy) {
    const clip = AnimationClip.findByName(clips, name);
    if (!clip) this._missing.push(`${name} (für ${usedBy})`);
    return clip ?? null;
  }

  /**
   * Klont einen Clip und entfernt dabei die Root-Motion.
   *
   * Immer diese Methode statt clip.clone() benutzen — sonst wandert die Figur
   * aus dem Bild (siehe CONFIG.animation.stripRootMotion).
   */
  _prepareClip(source, name) {
    const clip = source.clone();
    if (name) clip.name = name;

    const strip = this.cfg.stripRootMotion;
    if (strip?.enabled) {
      const drop = new Set(strip.bones.map((b) => `${b}.position`));
      const before = clip.tracks.length;
      clip.tracks = clip.tracks.filter((t) => !drop.has(t.name));
      this._strippedTracks += before - clip.tracks.length;
    }
    return clip;
  }

  /** Liste der im GLB tatsächlich vorhandenen Clips (für Diagnose). */
  hasClip(name) {
    return this.clipNames.includes(name);
  }

  /* ====================================================== öffentliche API */

  /**
   * Wechselt den Fortbewegungszustand.
   * @param {'climbUp'|'climbDown'|'climbLeft'|'climbRight'|'climbIdle'} key
   */
  setLocomotion(key) {
    if (this.mode !== 'locomotion') return;
    if (this._locomotionKey === key) return;
    if (!this.locomotion.has(key)) return;

    // Während einer Ereignis-Animation nur vormerken.
    if (this._oneShotKey) {
      this._pendingLocomotion = key;
      return;
    }
    this._applyLocomotion(key, this.cfg.crossFade);
  }

  _applyLocomotion(key, duration) {
    const action = this.locomotion.get(key);
    if (!action) return;
    const entry = this.cfg.clipMap[key];

    this._locomotionKey = key;
    this._targetRoll = entry.rollDeg ?? 0;
    this._targetPitch = entry.pitchDeg ?? 0;

    // Rückwärts abgespielte Clips müssen am Ende starten, sonst laufen sie
    // aus der Zeit heraus, bevor der erste Frame sichtbar wird.
    const startAtEnd = entry.timeScale < 0;
    this._fadeTo(action, duration, startAtEnd);
    action.setEffectiveTimeScale(entry.timeScale);
  }

  /**
   * Spielt eine Ereignis-Animation. 'die' bleibt stehen, alle anderen kehren
   * automatisch in den vorherigen Zustand zurück.
   * @param {'die'|'eat'|'revive'|'roar'} key
   */
  playOneShot(key) {
    const action = this.oneShots.get(key);
    if (!action) return;

    const configured = this.cfg.oneShotReturn?.[key];
    const duration = configured ?? action.getClip().duration;

    this._oneShotKey = key;
    this._oneShotTimer = HOLD_ONE_SHOTS.has(key) ? Infinity : duration;

    // Ereignis-Clips sind Bodenclips und brauchen dieselbe Kletter-Ausrichtung
    // wie die Lauf-Clips — sonst liegt der Affe für die Dauer des Clips falsch
    // herum an der Wand.
    const orient = this.cfg.eventOrientation;
    if (orient) {
      this._targetPitch = orient.pitchDeg;
      this._targetRoll = orient.rollDeg;
    }

    action.setEffectiveTimeScale(1);
    this._fadeTo(action, this.cfg.crossFade, false);
  }

  /** Kurzer Ausweich-Akzent, additiv über den Kletter-Clip. */
  triggerDodge() {
    if (!this._dodgeAction || this._dodgeCooldown > 0) return;
    if (this.mode !== 'locomotion' || this._oneShotKey) return;

    const entry = this.cfg.clipMap.dodge;
    const action = this._dodgeAction;

    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(entry.timeScale);
    action.setEffectiveWeight(this.cfg.dodgeBlendWeight); // stoppt laufendes Fading
    action.play();
    action.fadeIn(this.cfg.crossFadeFast);

    this._dodgeCooldown = this.cfg.dodgeCooldown;
    this._dodgeElapsed = 0;
  }

  /** Menü/Pause: Idle-Clips im Wechsel. */
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;

    if (mode === 'menu') {
      this._locomotionKey = null;
      this._pendingLocomotion = null;
      // 'die' läuft mit _oneShotTimer = Infinity und würde sonst NIE ablaufen:
      // der Menü-Leerlauf (Idle -> Sit -> Idle2 -> SitIdle) bliebe nach dem
      // ersten Tod dauerhaft im ersten Clip stehen.
      this._oneShotKey = null;
      this._oneShotTimer = 0;
      // Auch im Menü hängt der Affe an der Wand — gleiche Ausrichtung.
      this._targetRoll = this.cfg.eventOrientation?.rollDeg ?? 0;
      this._targetPitch = this.cfg.eventOrientation?.pitchDeg ?? 0;
      this._menuIndex = 0;
      this._menuTimer = this.cfg.menuIdleHold;
      if (this.menuActions.length) {
        this._fadeTo(this.menuActions[0], this.cfg.crossFade, false);
      }
    } else {
      this._oneShotKey = null;
      this._oneShotTimer = 0;
      this._applyLocomotion('climbIdle', this.cfg.crossFade);
    }
  }

  /** Setzt alles auf Anfang (neues Spiel). */
  reset() {
    this.mixer.stopAllAction();
    this._activeFull = null;
    this._locomotionKey = null;
    this._pendingLocomotion = null;
    this._oneShotKey = null;
    this._oneShotTimer = 0;
    this._dodgeCooldown = 0;
    this._dodgeElapsed = -1;
    this.mode = 'locomotion';
    this._applyLocomotion('climbIdle', 0);
    this.tail?.reset();
  }

  /**
   * @param {number} dt
   * @param {{speed:number, vx:number, vy:number}} ctx Bewegung des Affen
   */
  update(dt, ctx) {
    /* --------------------------------------------------- Ereignis-Timer */
    if (this._oneShotKey) {
      this._oneShotTimer -= dt;
      if (this._oneShotTimer <= 0) {
        const pending = this._pendingLocomotion;
        this._oneShotKey = null;
        this._oneShotTimer = 0;
        this._pendingLocomotion = null;

        if (this.mode === 'locomotion') {
          this._applyLocomotion(pending ?? this._locomotionKey ?? 'climbIdle', this.cfg.crossFade);
        } else if (this.menuActions.length) {
          this._fadeTo(this.menuActions[this._menuIndex], this.cfg.crossFade, false);
        }
      }
    }

    /* ------------------------------------------------- Menü-Leerlauf --- */
    if (this.mode === 'menu' && !this._oneShotKey && this.menuActions.length > 1) {
      this._menuTimer -= dt;
      if (this._menuTimer <= 0) {
        this._menuTimer = this.cfg.menuIdleHold;
        this._menuIndex = (this._menuIndex + 1) % this.menuActions.length;
        this._fadeTo(this.menuActions[this._menuIndex], this.cfg.crossFade, false);
      }
    }

    /* ------------------------------------------------------- speedSync - */
    if (this.mode === 'locomotion' && this._locomotionKey && !this._oneShotKey) {
      const entry = this.cfg.clipMap[this._locomotionKey];
      const action = this.locomotion.get(this._locomotionKey);
      if (entry && action) {
        let scale = entry.timeScale;
        if (entry.speedSync) {
          const { min, max } = this.cfg.speedSyncClamp;
          const ratio = ctx.speed / this.cfg.speedSyncReference;
          scale *= ratio < min ? min : ratio > max ? max : ratio;
        }
        action.setEffectiveTimeScale(scale);
      }
    }

    /* ----------------------------------------------------------- Dodge - */
    if (this._dodgeCooldown > 0) this._dodgeCooldown -= dt;
    if (this._dodgeElapsed >= 0) {
      this._dodgeElapsed += dt;
      const fadeAt = Math.max(0, this._dodgeDuration - this.cfg.crossFadeFast);
      if (this._dodgeElapsed >= fadeAt) {
        this._dodgeAction.fadeOut(this.cfg.crossFadeFast);
        this._dodgeElapsed = -1;
      }
    }

    /* ------------------------------------------------- Ausrichtung ----- */
    const k = 1 - Math.exp(-this.cfg.orientationSmoothing * dt);
    this.rollDeg += (this._targetRoll - this.rollDeg) * k;
    this.pitchDeg += (this._targetPitch - this.pitchDeg) * k;

    /* --------------------------------------------------------- Mixer --- */
    this.mixer.update(dt);

    // Schwanz NACH dem Mixer: die Simulation addiert auf das Clip-Ergebnis.
    this.tail?.update(dt, ctx.vx, ctx.vy);
  }

  /* ---------------------------------------------------------- intern --- */

  _fadeTo(action, duration, startAtEnd) {
    const prev = this._activeFull;
    if (prev === action) {
      // Gleiche Action erneut angefordert (z. B. Ereignis wiederholt) —
      // sauber neu starten statt mit sich selbst zu blenden.
      action.reset();
      if (startAtEnd) action.time = action.getClip().duration;
      action.setEffectiveWeight(1);
      action.play();
      return;
    }

    action.reset();
    if (startAtEnd) action.time = action.getClip().duration;
    action.enabled = true;
    action.play();

    if (prev && prev.isRunning() && duration > 0) {
      prev.crossFadeTo(action, duration, false);
    } else {
      if (prev) prev.stop();
      action.setEffectiveWeight(1);
    }
    this._activeFull = action;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}
