/**
 * Die Pflanzenwand.
 *
 * ZWEI SACHEN PASSIEREN HIER
 *
 * 1. ENDLOSES SCROLLEN. Gescrollt wird nicht die Geometrie, sondern der
 *    Textur-Offset — dadurch ist der Lauf unendlich und nahtlos, solange die
 *    Textur vertikal kachelt (dafür sorgt scripts/prepare-art.mjs).
 *    Mehrere Ebenen in unterschiedlicher Tiefe scrollen unterschiedlich
 *    schnell (Parallax).
 *
 * 2. STUFENWECHSEL. Die Wand hat mehrere Erscheinungsbilder (grün → grün mit
 *    Blumen → Äste). Gewechselt wird NUR an den Schwellen aus
 *    CONFIG.wall.stages, also genau dann, wenn das Spiel schneller und
 *    schwerer wird. Dazwischen läuft dieselbe Textur endlos weiter. Nach der
 *    letzten Stufe geht es zyklisch von vorne los.
 *
 *    Der Wechsel ist eine Überblendung, kein Schnitt: jede Ebene hat zwei
 *    Meshes (A = aktuell, B = neu), die per Deckkraft ineinander übergehen.
 *    Beide teilen denselben Scroll-Offset, damit es als Auflösung wirkt und
 *    nicht als Verschiebung.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';

import { visibleRectAt } from '../core/viewport.js';
import { assetUrl } from '../core/AssetLoader.js';

/** Wiederverwendet — Stufenwechsel darf nichts allokieren. */
const HILFSFARBE = new Color();

/** Eine Parallax-Ebene mit Überblendung zwischen zwei Texturen. */
class WallLayer {
  constructor(cfg, geometry, tileAspect) {
    this.cfg = cfg;
    this.tileAspect = tileAspect;
    this.offset = 0;
    this.fade = 1; // 1 = nur A sichtbar, 0..1 während der Überblendung

    // MeshBasicMaterial: die gelieferte Grafik ist bereits beleuchtet
    // gerendert. Eine erneute Beleuchtung würde sie nur verfälschen.
    const make = () =>
      new Mesh(
        geometry,
        new MeshBasicMaterial({
          color: cfg.tint,
          transparent: true,
          opacity: cfg.opacity,
          depthWrite: false,
        }),
      );

    this.meshA = make();
    this.meshB = make();
    this.meshB.material.opacity = 0;
    this.meshB.visible = false;

    for (const m of [this.meshA, this.meshB]) {
      m.position.z = cfg.z;
      m.frustumCulled = false;
    }
    // B liegt minimal davor, damit die Reihenfolge eindeutig ist.
    this.meshB.position.z = cfg.z + 0.001;
  }

  get group() {
    return [this.meshA, this.meshB];
  }

  /**
   * Färbt eine Ebene ein: Ebenen-Tint mal Stufen-Tint.
   *
   * Der Stufen-Tint (CONFIG.wall.stages[*].tint) dämpft sehr helle Wände.
   * Vor der weissen Eiswand ist ein weisser Eiszapfen sonst kaum zu sehen —
   * und was man nicht sieht, kann man nicht ausweichen.
   *
   * @param {import('three').Mesh} mesh
   * @param {number} [stageTint]
   */
  _tint(mesh, stageTint) {
    mesh.material.color.setHex(this.cfg.tint);
    if (stageTint !== undefined && stageTint !== 0xffffff) {
      HILFSFARBE.setHex(stageTint);
      mesh.material.color.multiply(HILFSFARBE);
    }
  }

  /** Setzt die Textur sofort (ohne Überblendung). */
  setTextureImmediate(texture, stageTint) {
    this._apply(this.meshA, texture);
    this._tint(this.meshA, stageTint);
    this.meshA.material.opacity = this.cfg.opacity;
    this.meshB.visible = false;
    this.meshB.material.opacity = 0;
    this.fade = 1;
    this._syncOffset();
    this._applySize();
  }

  /** Startet die Überblendung auf eine neue Textur. */
  beginFade(texture, stageTint) {
    this._apply(this.meshB, texture);
    // Nur die EINGEHENDE Ebene umfärben. Würde man beide sofort umfärben,
    // sprünge die alte Wand für die Dauer der Überblendung in die neue Farbe.
    this._tint(this.meshB, stageTint);
    this.meshB.visible = true;
    this.meshB.material.opacity = 0;
    this.fade = 0;
    this._syncOffset();
    this._applySize();
  }

  /** @param {number} t 0..1 Fortschritt der Überblendung */
  setFade(t) {
    this.fade = t;
    this.meshA.material.opacity = this.cfg.opacity * (1 - t);
    this.meshB.material.opacity = this.cfg.opacity * t;
  }

  /** Überblendung abschliessen: B wird zu A. */
  finishFade() {
    const texB = this.meshB.material.map;
    this._apply(this.meshA, texB);
    this.meshA.material.color.copy(this.meshB.material.color);
    this.meshA.material.opacity = this.cfg.opacity;
    this.meshB.visible = false;
    this.meshB.material.opacity = 0;
    this.meshB.material.map = null;
    this.fade = 1;
    this._syncOffset();
    this._applySize();
  }

  _apply(mesh, texture) {
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
  }

  /** @param {number} distance Scrollstrecke dieses Frames in World-Units */
  scroll(distance) {
    // Der Affe steigt -> die Wand läuft nach unten -> Offset wächst.
    this.offset += (distance * this.cfg.parallax) / this.cfg.tileWorldHeight;
    // In [0,1) halten, sonst verliert der Float bei langen Läufen an Präzision.
    this.offset %= 1;
    this._syncOffset();
  }

  _syncOffset() {
    // Beide Texturen bekommen denselben Offset — sonst wirkt die Überblendung
    // wie ein Versatz statt wie eine Auflösung.
    const a = this.meshA.material.map;
    const b = this.meshB.material.map;
    if (a) a.offset.y = this.offset;
    if (b) b.offset.y = this.offset;
  }

  resize(width, height) {
    this._width = width;
    this._height = height;
    for (const m of [this.meshA, this.meshB]) m.scale.set(width, height, 1);
    this._applySize();
  }

  /** Kachelzahl so setzen, dass das Bild unverzerrt bleibt. */
  _applySize() {
    if (!this._width) return;
    const tileH = this.cfg.tileWorldHeight;
    const tileW = tileH * this.tileAspect;
    const rx = this._width / tileW;
    const ry = this._height / tileH;
    for (const m of [this.meshA, this.meshB]) {
      if (m.material.map) m.material.map.repeat.set(rx, ry);
    }
  }
}

export class PlantWall {
  /**
   * @param {typeof import('../config.js').CONFIG.wall} cfg
   * @param {(url: string) => import('three').Texture} getTexture liefert eine
   *   EIGENE Texturinstanz je Aufruf (Offset/Repeat dürfen sich nicht teilen)
   * @param {import('three').PerspectiveCamera} camera
   */
  constructor(cfg, getTexture, camera) {
    this.cfg = cfg;
    this.camera = camera;
    this.getTexture = getTexture;
    this.group = new Group();

    // Eine geteilte 1x1-Plane, per Mesh-Scale auf die jeweilige Grösse gebracht.
    this._geometry = new PlaneGeometry(1, 1);

    /** @type {WallLayer[]} */
    this.layers = [];
    for (const layerCfg of cfg.layers) {
      const layer = new WallLayer(layerCfg, this._geometry, cfg.tileAspect);
      this.layers.push(layer);
      this.group.add(...layer.group);
    }

    this.stageIndex = -1;
    /** @type {object|null} Sonderstufe (Gold-Gebiet), siehe sonderStufe(). */
    this._sonder = null;
    this._fadeTimer = 0;
    this._fading = false;

    this._godrays = [];
    if (cfg.godrays.enabled) this._buildGodrays();

    this._time = 0;
    this._rect = { width: 0, height: 0, centerX: 0, centerY: 0 };

    this.setStage(0, true);
  }

  /* ------------------------------------------------------------- Stufen */

  /**
   * Welche Stufe gehört zu dieser Spielzeit?
   *
   * Bis zur letzten Schwelle gilt die jeweils erreichte Stufe. Danach wird
   * alle stageLoopSeconds zyklisch weitergeschaltet — die Hintergründe kommen
   * also immer wieder.
   */
  stageIndexAt(seconds) {
    const stages = this.cfg.stages;
    const lastAt = stages[stages.length - 1].afterSeconds;

    if (seconds < lastAt) {
      let idx = 0;
      for (let i = 0; i < stages.length; i++) {
        if (seconds >= stages[i].afterSeconds) idx = i;
      }
      return idx;
    }

    const extra = Math.floor((seconds - lastAt) / this.cfg.stageLoopSeconds);
    return (stages.length - 1 + extra) % stages.length;
  }

  /**
   * SONDERSTUFE — ein Gebiet, das nicht in der Reihe steht.
   *
   * Das Gold-Gebiet gehört nicht in `cfg.stages`: es kommt nicht nach
   * Spielzeit, sondern weil jemand eine goldene Banane erwischt hat, und es
   * dauert 30 Sekunden statt 132. Stünde es in der Liste, käme es irgendwann
   * von selbst — und die Belohnung wäre keine mehr.
   *
   * Solange eine Sonderstufe gesetzt ist, schaltet `update` NICHT mehr nach
   * Spielzeit weiter. Beim Zurücksetzen (`null`) wird die Stufe gewählt, die
   * zur inzwischen verstrichenen Zeit gehört — man landet also dort, wo man
   * ohne den Abstecher auch gewesen wäre.
   *
   * @param {object|null} stage Stufenobjekt wie in cfg.stages, oder null
   * @param {number} elapsed Spielzeit, für die Rückkehr in die Reihe
   */
  sonderStufe(stage, elapsed = 0) {
    if (stage) {
      this._sonder = stage;
      this.stageIndex = -1; // erzwingt beim Zurückkehren ein echtes Umschalten
      this._stufeAnwenden(stage, false);
    } else if (this._sonder) {
      this._sonder = null;
      const idx = this.stageIndexAt(elapsed);
      this.stageIndex = -1;
      this.setStage(idx, false);
    }
  }

  /** Läuft gerade eine Sonderstufe? */
  get inSonderStufe() {
    return Boolean(this._sonder);
  }

  /** @param {boolean} immediate ohne Überblendung (Spielstart) */
  setStage(index, immediate = false) {
    if (index === this.stageIndex) return;
    const stage = this.cfg.stages[index];
    if (!stage) return;

    this.stageIndex = index;
    this._stufeAnwenden(stage, immediate);
  }

  /**
   * Texturen einer Stufe auf die Ebenen legen.
   *
   * Herausgezogen aus setStage, weil die Sonderstufe dasselbe tut, aber
   * keinen Index in cfg.stages hat.
   */
  _stufeAnwenden(stage, immediate) {
    for (const layer of this.layers) {
      const url = stage[layer.cfg.slot];
      const texture = this.getTexture(url);
      if (!texture) continue;
      if (immediate) layer.setTextureImmediate(texture, stage.tint);
      else layer.beginFade(texture, stage.tint);
    }

    /* DEN RAHMEN NEBEN DER BÜHNE MITFÄRBEN.
     *
     * Auf breiten Schirmen läuft das Spiel als mittige Säule; links und
     * rechts steht dieselbe Wand, unscharf und abgedunkelt (#app::before in
     * style.css). Ohne diese Zeile bliebe der Rahmen für immer grün, während
     * im Bild längst Lava oder Eis liegt.
     *
     * Genommen wird die UNSCHARFE Fassung: sie ist kleiner, wird ohnehin
     * geladen, und der Browser hat sie im Zwischenspeicher, sobald die Stufe
     * im Spiel steht. Es kommt also kein einziger Download dazu. */
    /* ÜBER assetUrl, NICHT der rohe Pfad.
     *
     * In stage.far steht "/textures/stage1_green_far.webp" — mit führendem
     * Schrägstrich. Als CSS-url() löst der Browser das gegen die WURZEL der
     * Domäne auf, nicht gegen den Ordner der Seite. Solange das Spiel unter
     * "/" liegt, fällt das nicht auf; die Portale liefern es aber aus einem
     * Unterordner aus (CrazyGames etwa unter /games/<name>/), und dort ist
     * es dann ein 404 — der Rahmen neben der Bühne bliebe schwarz. Genau
     * davor warnt auch deren Doku: nur relative Pfade verwenden.
     *
     * assetUrl hängt den Pfad an die Vite-Base (base: './'), macht also
     * daraus eine Adresse relativ zur Seite. Geprüft mit einem Server, der
     * das Bündel unter /games/<name>/ ausliefert. */
    const rahmen = stage.far ?? stage.near;
    if (rahmen && typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--wand-bild', `url("${assetUrl(rahmen)}")`);
    }

    if (immediate) {
      this._fading = false;
      this._fadeTimer = 0;
      this.resize();
    } else {
      this._fading = true;
      this._fadeTimer = 0;
    }
  }

  /* -------------------------------------------------------------- Loop */

  /**
   * @param {number} dt
   * @param {number} distance zurückgelegte Kletterstrecke dieses Frames
   * @param {number} elapsed  Spielzeit in Sekunden (steuert die Stufe);
   *                          null = Stufe nicht anfassen (Menü)
   */
  update(dt, distance, elapsed = null) {
    // Während einer Sonderstufe (Gold-Gebiet) hat die Spielzeit nichts zu
    // sagen — sonst schaltete sie sofort wieder auf das reguläre Gebiet.
    if (elapsed !== null && !this._fading && !this._sonder) {
      const want = this.stageIndexAt(elapsed);
      if (want !== this.stageIndex) this.setStage(want, false);
    }

    if (this._fading) {
      this._fadeTimer += dt;
      const t = Math.min(1, this._fadeTimer / this.cfg.stageFade);
      for (const layer of this.layers) layer.setFade(t);
      if (t >= 1) {
        for (const layer of this.layers) layer.finishFade();
        this._fading = false;
      }
    }

    for (const layer of this.layers) layer.scroll(distance);

    if (this._godrays.length) {
      this._time += dt * this.cfg.godrays.speed;
      for (const ray of this._godrays) {
        const pulse = 0.82 + 0.18 * Math.sin(this._time * 6.283 + ray.phase);
        ray.mesh.scale.setScalar(ray.baseScale * pulse);
      }
    }
  }

  /**
   * Nach jedem Resize aufrufen. Berechnet pro Ebene das sichtbare Gebiet in
   * ihrer Tiefe und zieht die Plane bildfüllend auf.
   *
   * Wichtig: die Ebene wird auch VERSCHOBEN (position.y). Die Kamera schaut
   * leicht nach unten, das sichtbare Gebiet liegt in jeder Tiefe also nicht
   * mittig um y = 0.
   */
  resize() {
    const margin = this.cfg.coverMargin;

    for (const layer of this.layers) {
      visibleRectAt(this.camera, layer.cfg.z, this._rect);
      layer.resize(this._rect.width * margin, this._rect.height * margin);
      for (const m of layer.group) {
        m.position.x = this._rect.centerX;
        m.position.y = this._rect.centerY;
      }
    }
  }

  /* ------------------------------------------------------- Lichtdurchbrüche */

  _buildGodrays() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0.0, 'rgba(255, 249, 214, 1)');
    grad.addColorStop(0.35, 'rgba(255, 240, 170, 0.45)');
    grad.addColorStop(1.0, 'rgba(255, 235, 150, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const texture = new CanvasTexture(canvas);
    this._godrayTexture = texture;

    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: this.cfg.godrays.intensity,
    });
    this._godrayMaterial = material;

    const spots = [
      { x: -3.4, y: 1.8, s: 5.5, phase: 0.0 },
      { x: 2.9, y: -0.6, s: 4.2, phase: 2.1 },
      { x: 0.4, y: 2.9, s: 6.4, phase: 4.0 },
      { x: -1.8, y: -2.4, s: 3.6, phase: 5.3 },
    ];

    for (const spot of spots) {
      const mesh = new Mesh(this._geometry, material);
      mesh.position.set(spot.x, spot.y, -0.55);
      mesh.scale.setScalar(spot.s);
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      this.group.add(mesh);
      this._godrays.push({ mesh, phase: spot.phase, baseScale: spot.s });
    }
  }

  /* Die Sonderstufe hat Vorrang. Wichtig vor allem für `stageName`: daran
   * hängt die Gebietsmusik (Game ruft `klang.atmo(wall.stageName)`), und im
   * Gold-Gebiet soll auch das Goldstück laufen. Ohne diesen Vorrang stünde
   * hier '-', weil `stageIndex` dann auf keine Stufe der Liste zeigt. */
  get stageName() {
    return this._sonder?.name ?? this.cfg.stages[this.stageIndex]?.name ?? '-';
  }

  /** Welches Objekt an dieser Wand herunterfällt (CONFIG.rock.looks). */
  get stageHazard() {
    return this._sonder?.hazard ?? this.cfg.stages[this.stageIndex]?.hazard ?? 'stein';
  }

  dispose() {
    this._geometry.dispose();
    for (const layer of this.layers) {
      layer.meshA.material.dispose();
      layer.meshB.material.dispose();
    }
    this._godrayMaterial?.dispose();
    this._godrayTexture?.dispose();
  }
}
