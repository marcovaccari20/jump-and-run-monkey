/**
 * DOM-Overlay: Ladebildschirm, Menü, HUD, Pause, Game Over.
 *
 * Die UI kennt die Spiellogik nicht — sie meldet Klicks über Callbacks und
 * bekommt Werte über Setter. Das Spiel ruft niemals direkt in den DOM.
 */

const $ = (id) => document.getElementById(id);

/** Welche Screens bei welchem Zustand sichtbar sind (HUD bleibt unterlegt). */
const SCREEN_SETS = {
  loading: ['screen-loading'],
  menu: ['screen-menu'],
  playing: ['screen-hud'],
  paused: ['screen-hud', 'screen-paused'],
  gameover: ['screen-hud', 'screen-gameover'],
};

export class UI {
  /**
   * @param {typeof import('../config.js').CONFIG} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;

    this.el = {
      loadingFill: $('loading-fill'),
      loadingLabel: $('loading-label'),

      menuHighscores: $('menu-highscores'),
      btnStart: $('btn-start'),

      hudScore: $('hud-score'),
      hudRevive: $('hud-revive'),
      hudToast: $('hud-toast'),
      hudStats: $('hud-stats'),

      btnResume: $('btn-resume'),
      btnPauseMenu: $('btn-pause-menu'),

      gameoverHeadline: $('gameover-headline'),
      gameoverScore: $('gameover-score'),
      gameoverHighscores: $('gameover-highscores'),
      nameForm: $('name-form'),
      nameInput: $('name-input'),
      btnRetry: $('btn-retry'),
      btnGameoverMenu: $('btn-gameover-menu'),

      touchLayer: $('touch-layer'),
    };

    this.el.nameInput.maxLength = cfg.score.maxNameLength;
    this.el.nameInput.placeholder = cfg.score.defaultName;

    /** @type {{onStart:Function, onResume:Function, onRetry:Function, onMenu:Function, onSubmitName:Function}} */
    this.callbacks = {
      onStart: () => {},
      onResume: () => {},
      onRetry: () => {},
      onMenu: () => {},
      onSubmitName: () => {},
    };

    this._toastTimer = 0;
    this._lastScore = -1;
    this._current = 'loading';

    this._bind();
    this._detectTouch();
  }

  _bind() {
    this.el.btnStart.addEventListener('click', () => this.callbacks.onStart());
    this.el.btnResume.addEventListener('click', () => this.callbacks.onResume());
    this.el.btnPauseMenu.addEventListener('click', () => this.callbacks.onMenu());
    this.el.btnRetry.addEventListener('click', () => this.callbacks.onRetry());
    this.el.btnGameoverMenu.addEventListener('click', () => this.callbacks.onMenu());

    this.el.nameForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // .name-input zeigt den Namen per text-transform in Grossbuchstaben an —
      // das ändert aber nur die Darstellung, nicht den Wert. Ohne die
      // Umwandlung stünde in der Bestenliste "marco", obwohl der Spieler
      // "MARCO" bestätigt hat.
      const name = this.el.nameInput.value.toUpperCase();
      this.el.nameForm.classList.remove('is-visible');
      this.callbacks.onSubmitName(name);
    });
  }

  /**
   * Zwei getrennte Fragen — sie werden gern verwechselt:
   *
   *   is-touch   Das Gerät KANN Touch. Windows-Notebooks mit Touchscreen
   *              melden `maxTouchPoints: 10`, auch wenn mit Maus gearbeitet
   *              wird. Taugt NICHT als Schalter für die Bedienoberfläche.
   *   is-coarse  Touch ist das PRIMÄRE Eingabegerät (`pointer: coarse`).
   *              Erst dann Joystick zeigen und Tastaturhinweise ausblenden.
   *
   * Wer beides gleichsetzt, blendet auf Touch-Notebooks die Tastaturhilfe aus
   * und legt eine unsichtbare Touch-Fläche über die Buttons.
   */
  _detectTouch() {
    const hasTouch =
      'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;

    if (hasTouch) document.body.classList.add('is-touch');
    if (isCoarse) document.body.classList.add('is-coarse');

    this.hasTouch = hasTouch;
    this.isTouch = isCoarse; // steuert z. B. den Autofokus der Namenseingabe
  }

  get touchHost() {
    return this.el.touchLayer;
  }

  /* --------------------------------------------------------------- Screens */

  /** @param {'loading'|'menu'|'playing'|'paused'|'gameover'} name */
  showScreen(name) {
    const active = new Set(SCREEN_SETS[name] ?? []);
    for (const set of Object.values(SCREEN_SETS)) {
      for (const id of set) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('is-visible', active.has(id));
      }
    }
    this._current = name;
  }

  /* ------------------------------------------------------------- Ladebalken */

  setProgress(fraction, label) {
    this.el.loadingFill.style.width = `${Math.round(fraction * 100)}%`;
    if (label) this.el.loadingLabel.textContent = label;
  }

  setError(message) {
    this.el.loadingLabel.textContent = message;
    this.el.loadingLabel.classList.add('loader__label--error');
    this.el.loadingFill.style.width = '100%';
    this.el.loadingFill.style.background = 'var(--danger)';
  }

  /* ------------------------------------------------------------ Highscores */

  /**
   * @param {HTMLElement} listEl
   * @param {Array<{name:string, score:number}>} entries
   * @param {number} highlightIndex -1 = keiner
   */
  renderHighscores(listEl, entries, highlightIndex = -1) {
    listEl.textContent = '';

    if (!entries.length) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'empty';
      span.textContent = 'Noch keine Einträge — sei der Erste.';
      li.appendChild(span);
      listEl.appendChild(li);
      return;
    }

    entries.forEach((entry, i) => {
      const li = document.createElement('li');
      if (i === highlightIndex) li.classList.add('is-new');

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = `${i + 1}.`;

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.name; // textContent -> kein HTML-Injection

      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = `${entry.score} m`;

      li.append(rank, name, score);
      listEl.appendChild(li);
    });
  }

  showMenu(highscores) {
    this.renderHighscores(this.el.menuHighscores, highscores);
    this.showScreen('menu');
  }

  /* -------------------------------------------------------------------- HUD */

  updateScore(meters) {
    if (meters === this._lastScore) return; // DOM nur bei Änderung anfassen
    this._lastScore = meters;
    this.el.hudScore.textContent = String(meters);
  }

  setRevive(hasRevive) {
    this.el.hudRevive.classList.toggle('is-active', hasRevive);
  }

  setStats(text) {
    if (text === null) {
      this.el.hudStats.classList.remove('is-visible');
      return;
    }
    this.el.hudStats.classList.add('is-visible');
    this.el.hudStats.textContent = text;
  }

  /**
   * @param {string} text
   * @param {'banana'|'revive'} kind
   * @param {number} durationMs
   */
  toast(text, kind, durationMs = 1300) {
    const el = this.el.hudToast;
    el.textContent = text;
    el.className = `hud__toast hud__toast--${kind} is-visible`;

    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
    }, durationMs);
  }

  clearToast() {
    clearTimeout(this._toastTimer);
    this.el.hudToast.classList.remove('is-visible');
  }

  /* -------------------------------------------------------------- Game Over */

  /**
   * @param {{score:number, qualifies:boolean, isNewBest:boolean, highscores:Array}} data
   */
  showGameOver({ score, qualifies, isNewBest, highscores }) {
    this.el.gameoverScore.textContent = String(score);
    this.el.gameoverHeadline.textContent = isNewBest ? 'Neuer Rekord!' : 'Game Over';
    this.el.gameoverHeadline.classList.toggle('headline--best', isNewBest);

    this.el.nameForm.classList.toggle('is-visible', qualifies);
    if (qualifies) {
      this.el.nameInput.value = '';
      // Auf Touch nicht automatisch fokussieren — sonst springt die Tastatur auf.
      if (!this.isTouch) setTimeout(() => this.el.nameInput.focus(), 60);
    }

    this.renderHighscores(this.el.gameoverHighscores, highscores);
    this.clearToast();
    this.showScreen('gameover');
  }

  /** Nach dem Eintragen: Liste neu zeichnen und den neuen Eintrag hervorheben. */
  updateGameOverHighscores(highscores, highlightIndex) {
    this.renderHighscores(this.el.gameoverHighscores, highscores, highlightIndex);
  }

  /** true, wenn gerade in ein Textfeld getippt wird (Tasten nicht ans Spiel geben). */
  get isTyping() {
    return document.activeElement === this.el.nameInput;
  }
}
