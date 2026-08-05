/**
 * Welcher Affe ist gewählt? — dauerhaft in localStorage.
 *
 * Aufbau bewusst wie ScoreManager: gelesen wird über einen Cache, und jeder
 * localStorage-Zugriff steckt in try/catch. Im Privatmodus ist der Speicher
 * gesperrt und wirft — das darf das Spiel nicht mitreissen, es fällt dann
 * still auf den Standardaffen zurück.
 *
 * Gespeichert wird nur die ID ('braun' | 'weiss' | 'orange'), nie das ganze
 * Charakterobjekt: sonst wären Balancing-Änderungen an CONFIG bei jedem
 * Spieler eingefroren, der schon mal gewählt hat.
 */

export class CharacterStore {
  /**
   * @param {typeof import('../config.js').CONFIG.characters} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this._cache = null;
  }

  /** Alle wählbaren Charaktere in Menü-Reihenfolge. */
  get all() {
    return Object.values(this.cfg.list);
  }

  /** Gespeicherte ID — oder der Standard, wenn nichts Gültiges dasteht. */
  loadId() {
    if (this._cache) return this._cache;
    let id = this.cfg.default;
    try {
      const raw = localStorage.getItem(this.cfg.storageKey);
      // Gegen die tatsächlich vorhandenen Charaktere prüfen: eine ID aus einer
      // älteren Fassung darf nicht zu einem undefined-Charakter führen.
      if (raw && Object.hasOwn(this.cfg.list, raw)) id = raw;
    } catch {
      // Gesperrtes localStorage — Standard.
    }
    this._cache = id;
    return id;
  }

  /** Der gespeicherte Charakter als Objekt. */
  load() {
    return this.cfg.list[this.loadId()];
  }

  /**
   * Auswahl merken.
   * @returns {boolean} false, wenn die ID unbekannt ist (nichts gespeichert)
   */
  save(id) {
    if (!Object.hasOwn(this.cfg.list, id)) return false;
    this._cache = id;
    try {
      localStorage.setItem(this.cfg.storageKey, id);
    } catch {
      // Nicht schreibbar — die Wahl gilt wenigstens für diese Sitzung.
    }
    return true;
  }
}
