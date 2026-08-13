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
  privacy: ['screen-privacy'],
  playing: ['screen-hud'],
  paused: ['screen-hud', 'screen-paused'],
  // Zwischenschritt vor dem Game Over, solange ein zweites Leben übrig ist.
  continue: ['screen-hud', 'screen-continue'],
  ad: ['screen-hud', 'screen-ad'],
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
      skinList: $('skin-list'),
      characterError: $('character-error'),
      btnCharactersBack: $('btn-characters-back'),
      btnPrivacy: $('btn-privacy'),
      btnPrivacyBack: $('btn-privacy-back'),

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

      continueScore: $('continue-score'),
      btnWatchAd: $('btn-watch-ad'),
      btnDeclineAd: $('btn-decline-ad'),
      adCountdown: $('ad-countdown'),
      btnCancelAd: $('btn-cancel-ad'),

      hudCoins: $('hud-coin-value'),
      besitzWert: $('besitz-wert'),
      btnCharactersGo: $('btn-characters-go'),
      naechstes: $('naechstes'),
      naechstesBild: $('naechstes-bild'),
      naechstesMeter: $('naechstes-meter'),

      weltPanel: $('welt-panel'),
      weltListe: $('welt-liste'),
      weltStatus: $('welt-status'),

      btnPause: $('btn-pause'),
      btnTon: $('btn-ton'),
      tonSymbol: $('ton-symbol'),

      uebertrag: $('uebertrag'),
      uebertragCode: $('uebertrag-code'),
      uebertragCodeZeile: $('uebertrag-code-zeile'),
      uebertragForm: $('uebertrag-form'),
      uebertragEingabe: $('uebertrag-eingabe'),
      uebertragBelegenForm: $('uebertrag-belegen-form'),
      uebertragBelegen: $('uebertrag-belegen'),
      btnCodeVorschlag: $('btn-code-vorschlag'),
      uebertragStatus: $('uebertrag-status'),
      btnCodeKopieren: $('btn-code-kopieren'),

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
      onPrivacy: () => {},
      onPrivacyBack: () => {},
      onCharactersBack: () => {},
      onPickCharacter: () => {},
      onPickSkin: () => {},
      onWatchAd: () => {},
      onDeclineAd: () => {},
      onCancelAd: () => {},
      onCharactersGo: () => {},
      onKaufen: () => {},
      onTonUmschalten: () => {},
      /** Pause-Knopf im HUD - am Handy der einzige Weg (kein Escape) */
      onPause: () => {},
      /** (code: string) => void — Fortschritt von einem anderen Gerät holen */
      onCodeLaden: () => {},
      /** (code: string) => void — vier Ziffern für dieses Gerät belegen */
      onCodeBelegen: () => {},
      /** () => void — freien Code vom Server vorschlagen lassen */
      onCodeVorschlag: () => {},
      // Wird beim ERSTEN echten Klick gerufen. Browser erlauben Ton nur aus
      // einer Nutzereingabe heraus — deshalb hier und nicht beim Laden.
      onErsteEingabe: () => {},
    };

    this._toastTimer = 0;
    this._lastScore = -1;
    this._current = 'loading';

    this._bind();
    this._detectTouch();
  }

  _bind() {
    /* Jeder Klick und jeder Tastendruck weckt den Ton. Browser erlauben Audio
     * nur aus einer Nutzereingabe heraus, deshalb überhaupt dieser Umweg.
     *
     * HIER STAND `{ once: true }`, UND DAS WAR EIN ERNSTER FEHLER.
     * `_bind()` läuft im Konstruktor, also sofort beim Seitenaufruf. Der
     * echte Weckruf wird aber erst am Ende von `Game.load()` eingehängt —
     * nach dem Portal, den Modellen und den Texturen. Wer im Ladebildschirm
     * einmal tippte, feuerte gegen den leeren Platzhalter oben, und `once`
     * meldete den Zuhörer danach ab. Auf dem Handy gibt es kein `keydown` als
     * zweite Chance: das Spiel blieb die GANZE Sitzung stumm. Isoliert
     * nachgestellt und bestätigt.
     *
     * Dauerhaft zuzuhören kostet praktisch nichts (ein Funktionsaufruf, der
     * sofort zurückkehrt, sobald der Ton läuft) und bringt zusätzlich etwas:
     * nach einem Tabwechsel ist der Tonkontext oft angehalten, und so weckt
     * ihn die nächste Eingabe von selbst wieder auf. */
    for (const ereignis of ['pointerdown', 'keydown', 'touchstart']) {
      window.addEventListener(ereignis, () => this.callbacks.onErsteEingabe(), { passive: true });
    }

    this.el.btnPause.addEventListener('click', (e) => {
      this.callbacks.onPause();
      // Fokus loslassen wie beim Ton-Schalter: sonst schluckt der Knopf Enter.
      if (e.detail > 0) this.el.btnPause.blur();
    });

    this.el.btnTon.addEventListener('click', (e) => {
      this.callbacks.onTonUmschalten();
      /* DEN FOKUS WIEDER LOSLASSEN — sonst schluckt der Schalter Enter.
       *
       * Er ist der einzige Knopf des Spiels, der nie ausgeblendet wird, und
       * behält den Tastaturfokus deshalb über jeden Bildschirmwechsel hinweg.
       * Der InputHandler gibt Enter und Leertaste an einen fokussierten
       * Button ab (damit sich Buttons normal bedienen lassen). Gemessene
       * Folge: EIN Mausklick hierauf, und das Spiel liess sich nicht mehr
       * per Enter starten oder nach dem Tod neu starten.
       *
       * `detail > 0` unterscheidet Maus/Finger von Tastatur: wer sich per Tab
       * hierher bewegt hat, behält den Fokus zu Recht — sonst wäre der
       * Schalter mit der Tastatur nicht mehr bedienbar. */
      if (e.detail > 0) this.el.btnTon.blur();
    });

    this.el.btnStart.addEventListener('click', () => this.callbacks.onStart());
    this.el.btnResume.addEventListener('click', () => this.callbacks.onResume());
    this.el.btnPauseMenu.addEventListener('click', () => this.callbacks.onMenu());
    this.el.btnRetry.addEventListener('click', () => this.callbacks.onRetry());
    this.el.btnGameoverMenu.addEventListener('click', () => this.callbacks.onMenu());

    this.el.btnWatchAd.addEventListener('click', () => this.callbacks.onWatchAd());
    this.el.btnDeclineAd.addEventListener('click', () => this.callbacks.onDeclineAd());
    this.el.btnCancelAd.addEventListener('click', () => this.callbacks.onCancelAd());

    this.el.btnCharacters.addEventListener('click', () => this.callbacks.onCharacters());
    this.el.btnCharactersBack.addEventListener('click', () => this.callbacks.onCharactersBack());
    this.el.btnPrivacy.addEventListener('click', () => this.callbacks.onPrivacy());
    this.el.btnPrivacyBack.addEventListener('click', () => this.callbacks.onPrivacyBack());
    this.el.btnCharactersGo.addEventListener('click', () => this.callbacks.onCharactersGo());

    // EIN Listener auf dem Container statt einer pro Kachel: die Kacheln
    // werden bei jedem Öffnen neu gezeichnet, einzeln gebundene Listener
    // müssten dabei jedes Mal wieder abgeräumt werden.
    this.el.skinList.addEventListener('click', (e) => {
      const kachel = e.target.closest('[data-skin]');
      if (!kachel || kachel.disabled) return;
      // Gesperrt: der Klick kauft, statt auszuwählen. Bewusst DERSELBE Klick
      // und kein zweiter Knopf — sonst müsste man erst herausfinden, wo man
      // kauft, und das Schloss wäre nur Dekoration.
      if (kachel.dataset.gesperrt === 'ja') {
        this.callbacks.onKaufen('skin', kachel.dataset.skin);
        return;
      }
      this.callbacks.onPickSkin(kachel.dataset.skin);
    });

    this.el.characterList.addEventListener('click', (e) => {
      const kachel = e.target.closest('[data-character]');
      if (!kachel || kachel.disabled) return;
      if (kachel.dataset.gesperrt === 'ja') {
        this.callbacks.onKaufen('charakter', kachel.dataset.character);
        return;
      }
      this.callbacks.onPickCharacter(kachel.dataset.character);
    });

    /* Nur Ziffern durchlassen, und zwar WÄHREND des Tippens.
     *
     * `inputmode="numeric"` bittet das Handy nur um die Zifferntastatur — auf
     * dem Rechner tippt man trotzdem Buchstaben, und `pattern` meldet sich
     * erst beim Absenden. Hier fällt alles andere sofort weg, dann steht im
     * Feld immer genau das, was der Server auch annimmt. */
    for (const feld of [this.el.uebertragEingabe, this.el.uebertragBelegen]) {
      feld.addEventListener('input', () => {
        const nur = feld.value.replace(/\D/g, '').slice(0, 4);
        if (feld.value !== nur) feld.value = nur;
      });
    }

    this.el.uebertragForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = this.el.uebertragEingabe.value;
      if (code.trim()) this.callbacks.onCodeLaden(code);
    });

    this.el.uebertragBelegenForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = this.el.uebertragBelegen.value;
      if (code.trim()) this.callbacks.onCodeBelegen(code);
    });

    this.el.btnCodeVorschlag.addEventListener('click', () =>
      this.callbacks.onCodeVorschlag(),
    );

    this.el.btnCodeKopieren.addEventListener('click', async () => {
      const code = this.el.uebertragCode.textContent;
      try {
        await navigator.clipboard.writeText(code);
        this.setUebertragStatus('Code copied.');
      } catch {
        /* Zwischenablage gesperrt (Fremd-Rahmen, kein HTTPS) — dann muss man
         * ihn eben markieren. Der Code steht ja sichtbar da. */
        this.setUebertragStatus('Copying is blocked — select the code by hand.');
      }
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
    /* Der Pause-Knopf gehört NUR ins laufende Spiel.
     *
     * Nicht in die Pause selbst (dort steht "Weiter"), nicht ins Game Over
     * und nicht während eines Werbespots — dort wäre er entweder sinnlos
     * oder schädlich. */
    this.el.btnPause.hidden = name !== 'playing';
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
      span.textContent = 'No entries yet — be the first.';
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

      // Läufe mit zweitem Leben markieren (CONFIG.score.markAdRevive).
      if (entry.ad && this.cfg.score.markAdRevive) {
        const mark = document.createElement('span');
        mark.className = 'score__mark';
        mark.textContent = '▸';
        mark.title = 'Run was continued after dying';
        li.appendChild(mark);
      }

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
  /**
   * Fellfarben-Kacheln.
   *
   * Die Vorschau ist das Charakterbild mit DEMSELBEN CSS-Filter, den auch das
   * Sprite bekommt — die Kachel zeigt also exakt, was im Spiel ankommt, ohne
   * dass dafür ein einziges zusätzliches Bild nötig wäre.
   *
   * @param {Array<{id:string,label:string,filter:string}>} liste
   * @param {string} aktiv
   * @param {string} [vorschauBild] Bild des gerade gewählten Affen
   */
  /**
   * @param {Array} liste
   * @param {string} aktiv
   * @param {string} [vorschauBild]
   * @param {{istFrei:Function, muenzen:number}} [besitz]
   */
  showSkins(liste, aktiv, vorschauBild, besitz = null) {
    const host = this.el.skinList;
    host.textContent = '';

    // Vorschau vom aktiven Charakter nehmen, sonst vom ersten Bild im Screen.
    const quelle =
      vorschauBild ??
      this.el.characterList.querySelector('.char.is-active .char__img')?.getAttribute('src') ??
      this.el.characterList.querySelector('.char__img')?.getAttribute('src');

    for (const s of liste) {
      const kachel = document.createElement('button');
      kachel.type = 'button';
      kachel.className = 'skin';
      kachel.dataset.skin = s.id;
      kachel.classList.toggle('is-active', s.id === aktiv);
      kachel.setAttribute('aria-pressed', String(s.id === aktiv));
      kachel.title = s.label;

      if (quelle) {
        const bild = document.createElement('img');
        bild.className = 'skin__img';
        bild.src = quelle;
        bild.alt = '';
        bild.width = 64;
        bild.height = 64;
        if (s.filter && s.filter !== 'none') bild.style.filter = s.filter;
        kachel.appendChild(bild);
      }

      const name = document.createElement('span');
      name.className = 'skin__name';
      name.textContent = s.label;
      kachel.appendChild(name);

      if (besitz) this._sperre(kachel, s.kosten ?? 0, besitz.istFrei(s.id), besitz.muenzen);
      host.appendChild(kachel);
    }
  }


  /**
   * Legt Schloss und Preis auf eine Kachel.
   *
   * Das Schloss liegt ÜBER der Kachel, verdeckt sie aber nicht: was ein Affe
   * kann, muss man lesen können, bevor man ihn kauft. Wer nicht weiss, wofür
   * er 150 Münzen ausgibt, gibt sie nicht aus.
   *
   * @param {HTMLElement} kachel
   * @param {number} preis
   * @param {boolean} frei
   * @param {number} bestand
   */
  _sperre(kachel, preis, frei, bestand) {
    kachel.dataset.gesperrt = frei ? 'nein' : 'ja';
    kachel.classList.toggle('is-locked', !frei);
    if (frei) return;

    const reicht = bestand >= preis;
    kachel.classList.toggle('is-affordable', reicht);

    const marke = document.createElement('span');
    marke.className = 'schloss';
    marke.textContent = reicht ? '🔓' : '🔒';
    kachel.appendChild(marke);

    const p = document.createElement('span');
    p.className = 'preis';
    p.textContent = `${preis}`;
    kachel.appendChild(p);

    kachel.title = reicht
      ? `Unlock for ${preis} coins`
      : `Costs ${preis} coins — you have ${bestand}`;
  }

  /**
   * @param {Array} liste
   * @param {string} aktiv
   * @param {{istFrei:Function, muenzen:number}} [besitz]
   */
  showCharacters(liste, aktiv, besitz = null) {
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
      if (besitz) this._sperre(kachel, c.kosten ?? 0, besitz.istFrei(c.id), besitz.muenzen);
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

  /**
   * Warnschild — vom gelöschten Bosskampf übrig.
   *
   * Bleibt als No-op stehen, weil der Aufruf an mehreren Stellen im
   * Zustandswechsel hängt und ein Absturz dort das Spiel anhalten würde.
   */
  zeigeWarnung() {}

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
    this.el.gameoverHeadline.textContent = isNewBest ? 'New record!' : 'Game Over';
    this.el.gameoverHeadline.classList.toggle('headline--best', isNewBest);

    /* Das Weltlisten-Feld zurücksetzen. Ohne das blieb ein "Weltliste nicht
     * erreichbar" vom letzten Mal stehen und sah aus, als beträfe es den
     * gerade beendeten Lauf. */
    this.el.weltPanel.classList.remove('is-visible');
    this.el.weltStatus.textContent = '';
    this.el.weltListe.textContent = '';

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

  /* ---------------------------------------------------------- Weiterspielen */

  /** Angebot "Werbung ansehen und weiterklettern". */
  showContinueOffer(score) {
    this.el.continueScore.textContent = String(score);
    this.clearToast();
    this.showScreen('continue');
  }

  /** Werbespot läuft. */
  showAd(restSekunden) {
    this.el.adCountdown.textContent = String(restSekunden);
    this.showScreen('ad');
  }

  /** Restsekunden im laufenden Spot. */
  setAdCountdown(restSekunden) {
    this.el.adCountdown.textContent = String(restSekunden);
  }

  /* -------------------------------------------------- Weltweite Liste */

  /**
   * Zeigt die weltweite Liste. Ohne Einträge bleibt das Feld unsichtbar —
   * eine leere Bestenliste sieht nach Fehler aus, auch wenn keiner vorliegt.
   */
  /**
   * @param {Array} eintraege
   * @param {{name?: string, rang?: number}} [eigen] eigener Eintrag, wird
   *   hervorgehoben; steht er ausserhalb der Top 10, sagt es der Hinweistext
   */
  showWeltListe(eintraege, eigen = null) {
    if (!eintraege?.length) {
      this.el.weltPanel.classList.remove('is-visible');
      return;
    }
    this.el.weltPanel.classList.add('is-visible');

    /* Den eigenen Eintrag markieren. Ohne das sucht man seinen Namen in
     * zehn Zeilen — und findet ihn nicht, wenn er gar nicht dabei ist. */
    let index = -1;
    if (eigen?.name) {
      const gesucht = eigen.name.trim().toLowerCase();
      index = eintraege.findIndex((e) => String(e.name).trim().toLowerCase() === gesucht);
    }

    this.renderHighscores(this.el.weltListe, eintraege, index);

    if (eigen?.rang && index < 0) {
      // Eingetragen, aber nicht in der Top 10 — das ist kein Fehler, und der
      // Platz gehört trotzdem gezeigt.
      this.el.weltStatus.textContent = `Your worldwide rank: ${eigen.rang}`;
    } else if (eigen?.rang) {
      this.el.weltStatus.textContent = `Rank ${eigen.rang} worldwide`;
    } else {
      this.el.weltStatus.textContent = '';
    }
  }

  /* --------------------------------------------------------- Ton-Schalter */

  /**
   * Bringt den Ton-Schalter auf den Stand des Klangsystems. Wird von beiden
   * Wegen gerufen — Klick auf den Schalter UND Taste M — damit die Anzeige
   * nie auseinanderläuft.
   *
   * @param {boolean} stumm
   */
  setTon(stumm) {
    // Der erste Aufruf kommt aus der Verdrahtung — ab hier ist der Knopf
    // wirksam und darf sichtbar werden.
    this.el.btnTon.hidden = false;
    this.el.btnTon.dataset.stumm = stumm ? 'ja' : 'nein';
    this.el.btnTon.setAttribute('aria-label', stumm ? 'Unmute' : 'Mute');
    this.el.tonSymbol.textContent = stumm ? '🔇' : '🔊';
  }

  /* ------------------------------------------------ Fortschritt mitnehmen */

  /**
   * Zeigt den Wiederherstellungscode. Ohne Code bleibt der ganze Abschnitt
   * verborgen — auf CrazyGames hängt der Stand am Konto, und ohne Server gibt
   * es nichts mitzunehmen. Ein Feld, das nichts tut, verwirrt nur.
   *
   * @param {string|null} code
   */
  setUebertragCode(code) {
    if (!code) {
      this.el.uebertragCodeZeile.hidden = true;
      return;
    }
    this.el.uebertrag.hidden = false;
    this.el.uebertragCodeZeile.hidden = false;
    this.el.uebertragCode.textContent = code;
    // Im Eingabefeld stehen lassen: so sieht man beim nächsten Öffnen sofort,
    // welche vier Ziffern die eigenen sind.
    this.el.uebertragBelegen.value = code;
  }

  /**
   * Blendet den ganzen Abschnitt ein oder aus.
   *
   * Getrennt von setUebertragCode(), weil beides verschiedene Fragen sind:
   * OB es etwas zu übertragen gibt (Server vorhanden) und OB schon ein Code
   * vergeben wurde. Vorher hing beides an derselben Methode — der Abschnitt
   * verschwand dadurch, sobald kein Code gesetzt war, und man kam gar nicht
   * erst an das Feld, um sich einen auszusuchen.
   */
  setUebertragVerfuegbar(ja) {
    this.el.uebertrag.hidden = !ja;
  }

  /** Sperrt die Eingaben, solange der Server antwortet. */
  setUebertragBesetzt(besetzt) {
    for (const el of [
      this.el.uebertragEingabe,
      this.el.uebertragBelegen,
      this.el.btnCodeVorschlag,
    ]) {
      el.disabled = besetzt;
    }
    for (const form of [this.el.uebertragForm, this.el.uebertragBelegenForm]) {
      for (const knopf of form.querySelectorAll('button')) knopf.disabled = besetzt;
    }
  }

  setUebertragStatus(text) {
    this.el.uebertragStatus.textContent = text;
  }

  /** Kurzer Hinweis über der Weltliste (lädt, nicht erreichbar …). */
  setWeltStatus(text) {
    this.el.weltPanel.classList.add('is-visible');
    this.el.weltStatus.textContent = text;
  }

  /* ------------------------------------------------------------- Münzen */

  /** Münzen DIESES Laufs (HUD). */
  setMuenzenLauf(n) {
    this.el.hudCoins.textContent = String(n);
    // Kurz aufblitzen, damit man das Einsammeln auch im Augenwinkel merkt.
    const box = this.el.hudCoins.parentElement;
    box.classList.remove('is-pop');
    void box.offsetWidth; // Reflow erzwingen, sonst startet die Animation nicht neu
    if (n > 0) box.classList.add('is-pop');
  }

  /** Gesamtbestand (Auswahlbildschirm). */
  setMuenzenGesamt(n) {
    this.el.besitzWert.textContent = String(n);
  }

  /* --------------------------------------------------- Nächstes Gebiet */

  /**
   * Zeigt, was als Nächstes kommt und wie weit es noch ist.
   *
   * @param {string|null} bildUrl Vorschau der nächsten Wand
   * @param {number} meter        verbleibende Höhenmeter
   */
  setNaechstesGebiet(bildUrl, meter) {
    if (!bildUrl) {
      this.el.naechstes.classList.remove('is-visible');
      return;
    }
    this.el.naechstes.classList.add('is-visible');
    const url = `url("${assetUrl(bildUrl)}")`;
    if (this.el.naechstesBild.style.backgroundImage !== url) {
      this.el.naechstesBild.style.backgroundImage = url;
    }
    this.el.naechstesMeter.textContent = `${Math.max(0, Math.round(meter))} m`;
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
