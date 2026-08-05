/**
 * Score (Höhenmeter) + lokale Top-10-Highscore-Tabelle via localStorage.
 *
 * Der Score ist die insgesamt zurückgelegte Kletterstrecke. Er kann nie
 * sinken, auch wenn der Spieler mit "S" den Aufstieg bremst — gezählt wird
 * die tatsächliche Aufwärtsbewegung.
 */

export class ScoreManager {
  /**
   * @param {typeof import('../config.js').CONFIG.score} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.height = 0; // in Units
    this._cache = null; // gelesene Highscore-Liste
  }

  reset() {
    this.height = 0;
  }

  /** @param {number} units zurückgelegte Strecke in World-Units (>= 0) */
  addHeight(units) {
    if (units > 0) this.height += units;
  }

  /** Aktueller Score in ganzen Höhenmetern. */
  get meters() {
    return Math.floor(this.height / this.cfg.unitsPerMeter);
  }

  /* ------------------------------------------------------------ Highscores */

  /**
   * @returns {Array<{name: string, score: number, date: string}>}
   */
  loadHighscores() {
    if (this._cache) return this._cache;
    let list = [];
    try {
      const raw = localStorage.getItem(this.cfg.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          list = parsed
            .filter(
              (e) => e && typeof e.name === 'string' && Number.isFinite(e.score),
            )
            .map((e) => ({
              name: String(e.name).slice(0, this.cfg.maxNameLength),
              score: Math.max(0, Math.floor(e.score)),
              date: typeof e.date === 'string' ? e.date : '',
            }));
        }
      }
    } catch {
      // Defektes oder gesperrtes localStorage (Privatmodus): leere Liste.
      list = [];
    }
    list.sort((a, b) => b.score - a.score);
    this._cache = list.slice(0, this.cfg.maxEntries);
    return this._cache;
  }

  /** Reicht dieser Score für die Tabelle? */
  qualifies(score) {
    if (score <= 0) return false;
    const list = this.loadHighscores();
    if (list.length < this.cfg.maxEntries) return true;
    return score > list[list.length - 1].score;
  }

  /** Ist das der neue Platz 1? (steuert die Roar-Animation) */
  isNewBest(score) {
    const list = this.loadHighscores();
    return score > 0 && (list.length === 0 || score > list[0].score);
  }

  /**
   * Trägt einen Score ein und schreibt die Liste zurück.
   * @returns {number} 0-basierter Rang, oder -1 wenn nicht qualifiziert
   */
  submit(name, score) {
    if (!this.qualifies(score)) return -1;

    const clean =
      (name ?? '').trim().slice(0, this.cfg.maxNameLength) ||
      this.cfg.defaultName;

    const list = this.loadHighscores().slice();
    const entry = { name: clean, score, date: new Date().toISOString().slice(0, 10) };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);

    const trimmed = list.slice(0, this.cfg.maxEntries);
    this._cache = trimmed;

    try {
      localStorage.setItem(this.cfg.storageKey, JSON.stringify(trimmed));
    } catch {
      // Nicht schreibbar — die Liste bleibt wenigstens für diese Sitzung gültig.
    }
    return trimmed.indexOf(entry);
  }

  clear() {
    this._cache = [];
    try {
      localStorage.removeItem(this.cfg.storageKey);
    } catch {
      /* ignorieren */
    }
  }
}
