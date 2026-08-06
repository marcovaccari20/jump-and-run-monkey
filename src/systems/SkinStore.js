/**
 * Welche Fellfarbe ist angelegt? — dauerhaft in localStorage.
 *
 * Aufbau bewusst identisch zu CharacterStore: Lese-Cache, und jeder
 * localStorage-Zugriff steckt in try/catch. Im Privatmodus ist der Speicher
 * gesperrt und wirft — das darf das Spiel nicht mitreissen, es fällt dann
 * still auf die Standardfarbe zurück.
 *
 * Gespeichert wird nur die ID, nie der Filter selbst: sonst wäre eine später
 * nachgebesserte Farbe bei jedem Spieler eingefroren, der sie schon einmal
 * angelegt hat.
 */

export class SkinStore {
  /**
   * @param {typeof import('../config.js').CONFIG.skins} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this._cache = null;
  }

  /** Alle Farben in Menü-Reihenfolge. */
  get all() {
    return Object.values(this.cfg.list);
  }

  /** Gespeicherte ID — oder der Standard, wenn nichts Gültiges dasteht. */
  /**
   * Prüft, ob eine ID freigeschaltet ist. Wird von aussen gesetzt (Game).
   *
   * Ohne diese Prüfung wäre das Freischalten wirkungslos: es genügte, im
   * Browserspeicher "orange" einzutragen, und der 150-Münzen-Affe wäre
   * gratis. Gemessen wurde genau das — deshalb sitzt die Bremse hier, an der
   * Stelle, die LIEST, und nicht nur in der Oberfläche.
   *
   * @type {((id: string) => boolean) | null}
   */
  istFrei = null;

  /** Gespeicherte ID — oder der Standard, wenn nichts Gültiges dasteht. */
  loadId() {
    if (this._cache) return this._cache;
    let id = this.cfg.default;
    try {
      const raw = localStorage.getItem(this.cfg.storageKey);
      // Gegen die tatsächlich vorhandenen Einträge prüfen: eine ID aus einer
      // älteren Fassung darf nicht zu einem undefined führen.
      if (raw && Object.hasOwn(this.cfg.list, raw)) id = raw;
    } catch {
      // Gesperrtes localStorage — Standard.
    }
    // Gesperrtes fällt auf den Standard zurück, egal wie es hineinkam.
    if (this.istFrei && !this.istFrei(id)) id = this.cfg.default;
    this._cache = id;
    return id;
  }

  /** Die gespeicherte Farbe als Objekt. */
  load() {
    return this.cfg.list[this.loadId()];
  }

  /**
   * Auswahl merken.
   * @returns {boolean} false, wenn die ID unbekannt ist (nichts gespeichert)
   */
  save(id) {
    if (!Object.hasOwn(this.cfg.list, id)) return false;
    // Zweite Bremse: was gesperrt ist, wird gar nicht erst gespeichert.
    if (this.istFrei && !this.istFrei(id)) return false;
    this._cache = id;
    try {
      localStorage.setItem(this.cfg.storageKey, id);
    } catch {
      // Nicht schreibbar — die Wahl gilt wenigstens für diese Sitzung.
    }
    return true;
  }
}
