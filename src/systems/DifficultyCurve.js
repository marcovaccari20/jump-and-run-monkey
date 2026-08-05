/**
 * Difficulty-Kurven.
 *
 * Einheitliche Form für alle Kurven:
 *      wert(t) = clamp(start + rate * t, min, max)
 *
 * `rate` darf negativ sein (z. B. Spawn-Intervall, das kürzer wird). Ob
 * gedeckelt oder gebodent wird, ergibt sich aus den vorhandenen Feldern
 * `max` bzw. `min` in der Config.
 *
 * Alle Werte kommen aus CONFIG.difficulty — hier steht keine Zahl.
 */

export class Curve {
  /**
   * @param {{start:number, rate:number, min?:number, max?:number}} cfg
   */
  constructor(cfg) {
    this.start = cfg.start;
    this.rate = cfg.rate;
    this.min = cfg.min ?? -Infinity;
    this.max = cfg.max ?? Infinity;
  }

  /** @param {number} t Spielzeit in Sekunden */
  at(t) {
    const v = this.start + this.rate * t;
    return v < this.min ? this.min : v > this.max ? this.max : v;
  }

  /** Sekunde, ab der die Kurve ihren Deckel erreicht (Infinity wenn nie). */
  get plateauAt() {
    if (this.rate === 0) return Infinity;
    const target = this.rate > 0 ? this.max : this.min;
    if (!Number.isFinite(target)) return Infinity;
    return (target - this.start) / this.rate;
  }
}

export class DifficultyCurve {
  /**
   * @param {typeof import('../config.js').CONFIG.difficulty} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.scroll = new Curve(cfg.scroll);
    this.spawnInterval = new Curve(cfg.spawnInterval);
    this.rockSpeed = new Curve(cfg.rockSpeed);
    // Absteigend sortiert, damit die erste passende Stufe gewinnt.
    this.burst = [...cfg.burst].sort((a, b) => b.afterSeconds - a.afterSeconds);
    this.elapsed = 0;
  }

  reset() {
    this.elapsed = 0;
  }

  update(dt) {
    this.elapsed += dt;
  }

  /** Scrollgeschwindigkeit der Wand in Units/s. */
  get scrollSpeed() {
    return this.scroll.at(this.elapsed);
  }

  /** Sekunden bis zum nächsten Spawn-Event. */
  get spawnDelay() {
    return this.spawnInterval.at(this.elapsed);
  }

  /** Eigengeschwindigkeit der Steine in Units/s (ohne Scroll-Anteil). */
  get rockFallSpeed() {
    return this.rockSpeed.at(this.elapsed);
  }

  /** Anzahl Objekte pro Spawn-Event. */
  get burstCount() {
    for (const step of this.burst) {
      if (this.elapsed >= step.afterSeconds) return step.count;
    }
    return 1;
  }

  /** 0..1 — grober Fortschritt bis alle Kurven ihren Deckel erreicht haben. */
  get progress() {
    const plateau = Math.max(
      this.scroll.plateauAt,
      this.spawnInterval.plateauAt,
      this.rockSpeed.plateauAt,
    );
    if (!Number.isFinite(plateau) || plateau <= 0) return 1;
    return Math.min(1, this.elapsed / plateau);
  }
}
