/**
 * Expliziter Spielzustands-Automat.
 *
 * Zustände: MENU, PLAYING, PAUSED, GAME_OVER
 *
 * Erlaubte Übergänge sind hart definiert — ein unerlaubter Wechsel wirft,
 * statt das Spiel still in einen inkonsistenten Zustand zu bringen.
 */

export const GameState = Object.freeze({
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAME_OVER: 'GAME_OVER',
});

const TRANSITIONS = Object.freeze({
  [GameState.MENU]: [GameState.PLAYING],
  [GameState.PLAYING]: [GameState.PAUSED, GameState.GAME_OVER],
  [GameState.PAUSED]: [GameState.PLAYING, GameState.MENU],
  [GameState.GAME_OVER]: [GameState.PLAYING, GameState.MENU],
});

export class StateMachine {
  /**
   * @param {string} initial Startzustand
   */
  constructor(initial = GameState.MENU) {
    this.state = initial;
    this.previous = null;
    /** @type {Map<string, Array<Function>>} */
    this._onEnter = new Map();
    /** @type {Map<string, Array<Function>>} */
    this._onExit = new Map();
    /** @type {Array<Function>} */
    this._onChange = [];
  }

  /** Callback beim Betreten eines Zustands. */
  onEnter(state, fn) {
    if (!this._onEnter.has(state)) this._onEnter.set(state, []);
    this._onEnter.get(state).push(fn);
    return this;
  }

  /** Callback beim Verlassen eines Zustands. */
  onExit(state, fn) {
    if (!this._onExit.has(state)) this._onExit.set(state, []);
    this._onExit.get(state).push(fn);
    return this;
  }

  /** Callback bei jedem Wechsel: (from, to) => void */
  onChange(fn) {
    this._onChange.push(fn);
    return this;
  }

  is(...states) {
    return states.includes(this.state);
  }

  canTransitionTo(next) {
    return (TRANSITIONS[this.state] ?? []).includes(next);
  }

  /**
   * Wechselt den Zustand. Wirft bei unerlaubtem Übergang.
   * @param {string} next
   * @param {object} [payload] wird an die Callbacks durchgereicht
   */
  transitionTo(next, payload = undefined) {
    if (next === this.state) return false;
    if (!this.canTransitionTo(next)) {
      throw new Error(`Unerlaubter Zustandswechsel: ${this.state} -> ${next}`);
    }

    const from = this.state;
    for (const fn of this._onExit.get(from) ?? []) fn(payload, next);

    this.previous = from;
    this.state = next;

    for (const fn of this._onEnter.get(next) ?? []) fn(payload, from);
    for (const fn of this._onChange) fn(from, next, payload);
    return true;
  }
}
