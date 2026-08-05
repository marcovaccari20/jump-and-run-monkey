/**
 * DOM-Overlay: Ladebildschirm, Menü, HUD, Pause, Game Over.
 *
 * Die UI kennt die Spiellogik nicht — sie meldet Klicks über Callbacks und
 * bekommt Werte über Setter. Das Spiel ruft niemals direkt in den DOM.
 */

import { assetUrl } from '../core/AssetLoader.js';

const $ = (id) => document.getElementById(id);

/** Welche Screens bei welchem Zustand sichtbar sind (HUD bleibt unterlegt). */
const SCREEN_SETS = {
  loading: ['screen-loading'],
  menu: ['screen-menu'],
  characters: ['screen-characters'],
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
      btnCharacters: $('btn-characters'),

      characterList: $('character-list'),
      characterError: $('character-error'),
      btnCharactersBack: $('btn-characters-back'),

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

    this.callbacks = {
      onStart: () => {},
      onResume: () => {},
      onRetry: () => {},
      onMenu: () => {},
      onSubmitName: () => {},
      onCharacters: () => {},
      onCharactersBack: () => {},
      onPickCharacter: () => {},
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

    this.el.btnCharacters.addEventListener('click', () => this.callbacks.onCharacters());
    this.el.btnCharactersBack.addEventListener('click', () => this.callbacks.onCharactersBack());

    // EIN Listener auf dem Container statt einer pro Kachel: die Kacheln
    // werden bei jedem Öffnen neu gezeichnet, einzeln gebundene Listener
    // müssten dabei jedes Mal wieder abgeräumt werden.
    this.el.characterList.addEventListener('click', (e) => {
      const kachel = e.target.closest('[data-character]');
      if (!kachel || kachel.disabled) return;
      this.callbacks.onPickCharacter(kachel.dataset.character);
    });

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

  /* ------------------------------------------------------------ Charaktere */

  /**
   * Zeichnet die Auswahl und zeigt sie an.
   *
   * @param {Array<{id:string,label:string,blurb:string,preview:string}>} liste
   * @param {string} aktiv ID des gewählten Affen
   */
  showCharacters(liste, aktiv) {
    const host = this.el.characterList;
    host.textContent = '';

    for (const c of liste) {
      const kachel = document.createElement('button');
      kachel.type = 'button';
      kachel.className = 'char';
      kachel.dataset.character = c.id;
      kachel.classList.toggle('is-active', c.id === aktiv);
      kachel.setAttribute('aria-pressed', String(c.id === aktiv));

      const bild = document.createElement('img');
      bild.className = 'char__img';
      // Über assetUrl, NICHT roh: vite.config.js benutzt base: './', damit der
      // Build auch in einem Unterordner läuft. Ein absoluter Pfad wie
      // '/characters/brown.webp' zeigt dort ins Leere.
      bild.src = assetUrl(c.preview);
      bild.alt = '';
      // Die Bilder liegen lokal und sind klein — aber ein fehlendes Bild darf
      // die Kachel nicht auf null Höhe zusammenfallen lassen.
      bild.width = 160;
      bild.height = 160;
      bild.loading = 'lazy';

      const name = document.createElement('span');
      name.className = 'char__name';
      name.textContent = c.label;

      const text = document.createElement('span');
      text.className = 'char__blurb';
      text.textContent = c.blurb;

      kachel.append(bild, name, text);
      host.appendChild(kachel);
    }

    this.showScreen('characters');
  }

  /**
   * Kacheln sperren, solange die Frames eines Affen nachgeladen werden.
   *
   * Auch der Zurück-Knopf wird gesperrt: sonst kann man die Auswahl mitten im
   * Nachladen verlassen, und der Wechsel schlägt hinterher ins bereits
   * laufende Spiel durch.
   */
  setCharactersBusy(busy) {
    for (const k of this.el.characterList.querySelectorAll('[data-character]')) {
      k.disabled = busy;
    }
    this.el.btnCharactersBack.disabled = busy;
    this.el.characterList.classList.toggle('is-busy', busy);
    if (busy) this.el.characterError.textContent = '';
  }

  /** Sichtbare Rückmeldung, wenn ein Affe sich nicht laden liess. */
  showCharacterError(text) {
    this.el.characterError.textContent = text;
  }

  /** Welcher Screen ist gerade oben? (Game sperrt darüber die Enter-Taste.) */
  get currentScreen() {
    return this._current;
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

  /**
   * Bananen-Anzeige ganz aus- oder einblenden.
   *
   * Für den weissen Affen genügt es NICHT, `is-active` einfach nie zu setzen:
   * .hud__revive arbeitet mit opacity, das Element belegt also weiter seinen
   * Platz und schiebt die Punktzahl zur Seite. Deshalb display:none per
   * eigener Klasse.
   */
  setReviveVisible(sichtbar) {
    this.el.hudRevive.classList.toggle('is-hidden', !sichtbar);
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
