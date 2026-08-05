/**
 * Object Pool.
 *
 * Alle Instanzen werden EINMAL beim Start erzeugt. Im Frame-Loop wird nichts
 * mehr allokiert — acquire() nimmt aus der Freiliste, release() legt zurück.
 *
 * `active` ist ein stabiles Array, über das der Loop iterieren kann. release()
 * benutzt swap-remove, tauscht also das letzte Element an die frei gewordene
 * Stelle. Deshalb muss beim Iterieren mit Entfernen RÜCKWÄRTS gelaufen werden:
 *
 *     for (let i = pool.active.length - 1; i >= 0; i--) { ... }
 */
export class Pool {
  /**
   * @param {number} size      feste Poolgrösse
   * @param {() => object} factory  erzeugt eine Instanz (nur beim Konstruieren aufgerufen)
   */
  constructor(size, factory) {
    /** @type {object[]} */
    this.all = new Array(size);
    /** @type {object[]} */
    this.free = new Array(size);
    /** @type {object[]} */
    this.active = [];

    for (let i = 0; i < size; i++) {
      const item = factory(i);
      item.__poolIndex = -1; // Position in `active`, -1 = inaktiv
      this.all[i] = item;
      this.free[i] = item;
    }
  }

  get size() {
    return this.all.length;
  }

  get activeCount() {
    return this.active.length;
  }

  /** @returns {object|null} null, wenn der Pool erschöpft ist */
  acquire() {
    const item = this.free.pop();
    if (item === undefined) return null;
    item.__poolIndex = this.active.length;
    this.active.push(item);
    return item;
  }

  /** Gibt eine Instanz zurück in den Pool (swap-remove, O(1)). */
  release(item) {
    const idx = item.__poolIndex;
    if (idx < 0) return; // schon freigegeben
    const last = this.active.pop();
    if (last !== item) {
      this.active[idx] = last;
      last.__poolIndex = idx;
    }
    item.__poolIndex = -1;
    this.free.push(item);
  }

  /** Gibt alle aktiven Instanzen zurück. `onRelease` wird pro Instanz gerufen. */
  releaseAll(onRelease) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      if (onRelease) onRelease(item);
      this.release(item);
    }
  }
}
