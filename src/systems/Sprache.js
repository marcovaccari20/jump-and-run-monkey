/**
 * Sprachumschaltung.
 *
 * WARUM OHNE SCHLÜSSEL IM MARKUP
 * Der übliche Weg wäre `data-i18n="menu.play"` an jedem Element und ein
 * Wörterbuch mit erfundenen Schlüsseln. Für dieses Spiel wäre das der
 * schlechtere Handel: 77 Textstellen im HTML müssten von Hand ausgezeichnet
 * werden, und jede vergessene bliebe stumm englisch, ohne dass es auffällt.
 *
 * Hier ist deshalb der ENGLISCHE TEXT SELBST der Schlüssel. Das hat drei
 * Folgen, die alle in dieselbe Richtung zeigen:
 *   - Am HTML muss nichts geändert werden. Was dort steht, ist bereits die
 *     englische Fassung und bleibt die Rückfallebene.
 *   - Fehlt eine Übersetzung, erscheint Englisch. Nie ein leeres Feld, nie
 *     ein roher Schlüssel wie "menu.play" — der schlimmste Fall ist der
 *     Zustand von vorher.
 *   - Das Wörterbuch ist beim Lesen selbsterklärend: links steht, was der
 *     Spieler heute sieht.
 *
 * Der Preis: wird ein englischer Text im HTML geändert, verliert er seine
 * Übersetzung (still, aber sichtbar — es steht dann Englisch da).
 * `npm run pruef:sprache` findet genau diesen Fall.
 */

/* -------------------------------------------------------------- Katalog */

/**
 * Alle Sprachen.
 *
 * WARUM JEDE IN EINER EIGENEN DATEI, DIE ERST BEI BEDARF GELADEN WIRD
 * 22 Wörterbücher zu je rund 130 Einträgen wiegen zusammen etwa 160 kB. Sie
 * alle in das Hauptbündel zu packen hiesse: jeder Spieler lädt 21 Sprachen
 * herunter, die er nie sieht — auf dem Handy über Mobilfunk, vor dem ersten
 * Bild. `import()` macht daraus je ein eigenes Stück, und geholt wird genau
 * eines.
 *
 * `laden: null` bei Englisch ist kein Sonderfall aus Bequemlichkeit: das
 * Spiel IST auf Englisch geschrieben. Ein Wörterbuch Englisch->Englisch wäre
 * 130 Zeilen, die nichts tun.
 *
 * `rtl` markiert Schriften, die von rechts nach links laufen.
 */
export const SPRACHEN = [
  { code: 'en', name: 'English', laden: null },
  { code: 'de', name: 'Deutsch', laden: () => import('../sprachen/de.js') },
  { code: 'es', name: 'Español', laden: () => import('../sprachen/es.js') },
  { code: 'fr', name: 'Français', laden: () => import('../sprachen/fr.js') },
  { code: 'it', name: 'Italiano', laden: () => import('../sprachen/it.js') },
  { code: 'pt', name: 'Português', laden: () => import('../sprachen/pt.js') },
  { code: 'nl', name: 'Nederlands', laden: () => import('../sprachen/nl.js') },
  { code: 'pl', name: 'Polski', laden: () => import('../sprachen/pl.js') },
  { code: 'cs', name: 'Čeština', laden: () => import('../sprachen/cs.js') },
  { code: 'sv', name: 'Svenska', laden: () => import('../sprachen/sv.js') },
  { code: 'no', name: 'Norsk', laden: () => import('../sprachen/no.js') },
  { code: 'da', name: 'Dansk', laden: () => import('../sprachen/da.js') },
  { code: 'fi', name: 'Suomi', laden: () => import('../sprachen/fi.js') },
  { code: 'tr', name: 'Türkçe', laden: () => import('../sprachen/tr.js') },
  { code: 'ru', name: 'Русский', laden: () => import('../sprachen/ru.js') },
  { code: 'uk', name: 'Українська', laden: () => import('../sprachen/uk.js') },
  { code: 'ar', name: 'العربية', laden: () => import('../sprachen/ar.js'), rtl: true },
  { code: 'hi', name: 'हिन्दी', laden: () => import('../sprachen/hi.js') },
  { code: 'id', name: 'Indonesia', laden: () => import('../sprachen/id.js') },
  { code: 'th', name: 'ไทย', laden: () => import('../sprachen/th.js') },
  { code: 'zh', name: '简体中文', laden: () => import('../sprachen/zh.js') },
  { code: 'ja', name: '日本語', laden: () => import('../sprachen/ja.js') },
  { code: 'ko', name: '한국어', laden: () => import('../sprachen/ko.js') },
];

/* ------------------------------------------------------------- Maschine */

const SPEICHER = 'jc_sprache';

/** Leerraum vereinheitlichen, damit mehrzeiliges HTML trotzdem trifft. */
const glatt = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Attribute, die sichtbaren oder vorgelesenen Text tragen.
 *
 * `title` fehlt bewusst: im Spiel steht dort nirgends etwas, und ein
 * Attribut mitzuübersetzen, das es nicht gibt, kostet bei jedem Durchlauf
 * Zeit über tausende Knoten.
 */
const ATTRIBUTE = ['placeholder', 'aria-label'];

export class Sprache {
  /**
   * @param {HTMLElement} wurzel Bereich, der übersetzt wird (das Overlay)
   */
  constructor(wurzel) {
    this.wurzel = wurzel;
    /** Merkt sich zu jedem Textknoten das englische Original. */
    this._urtext = new WeakMap();
    /** Dasselbe für Attribute: Element -> {attribut: Original}. */
    this._urattr = new WeakMap();
    /** (code) => void */
    this.onAendern = null;
    /** Geladene Wörterbücher, nach Code. Englisch braucht keines. */
    this._geladen = { en: null };

    this.code = this._startsprache();
  }

  get woerter() {
    return this._geladen[this.code] ?? null;
  }

  /** @returns {{code:string,name:string,rtl?:boolean}} */
  get eintrag() {
    return SPRACHEN.find((s) => s.code === this.code) ?? SPRACHEN[0];
  }

  /**
   * Holt ein Wörterbuch — einmal je Sprache.
   *
   * Scheitert das Laden (Netz weg, Stück nicht ausgeliefert), bleibt es bei
   * Englisch. Ein Spiel, das wegen einer fehlenden Übersetzungsdatei gar
   * nicht startet, wäre die schlechtere Antwort.
   */
  async _holen(code) {
    if (code in this._geladen) return this._geladen[code];
    const eintrag = SPRACHEN.find((s) => s.code === code);
    if (!eintrag?.laden) return (this._geladen[code] = null);
    try {
      const modul = await eintrag.laden();
      return (this._geladen[code] = modul.default);
    } catch (e) {
      console.warn(`[Sprache] ${code} liess sich nicht laden — bleibt englisch.`, e);
      return (this._geladen[code] = null);
    }
  }

  /**
   * Lädt die Startsprache und wendet sie an.
   *
   * Getrennt vom Konstruktor, weil Laden Zeit braucht und ein Konstruktor
   * nichts zurückgeben kann, worauf sich warten liesse. Bis das Wörterbuch
   * da ist, steht Englisch im Bild — das dauert Millisekunden und fällt
   * hinter dem Ladebildschirm ohnehin nicht auf.
   */
  async starten() {
    await this._holen(this.code);
    this._richtungSetzen();
    this.anwenden();
  }

  /**
   * Setzt Sprache und Schreibrichtung am Wurzelelement.
   *
   * `dir="rtl"` ist bei Arabisch kein Schönheitsfehler, wenn es fehlt:
   * Satzzeichen rutschen ans falsche Ende, und gemischte Zeilen wie
   * "Angemeldet als x@y.ch" stehen in verkehrter Reihenfolge. Der Browser
   * ordnet das selbst richtig — aber nur, wenn er die Richtung kennt.
   */
  _richtungSetzen() {
    document.documentElement.lang = this.code;
    document.documentElement.dir = this.eintrag.rtl ? 'rtl' : 'ltr';
  }

  /**
   * Welche Sprache beim allerersten Start?
   *
   * Reihenfolge: gemerkte Wahl, sonst die Sprache des Browsers, sonst
   * Englisch. Die Browsersprache MUSS abgeschnitten werden — sie kommt als
   * `de-CH` oder `de-DE`, unser Code ist `de`.
   */
  _startsprache() {
    try {
      const gemerkt = localStorage.getItem(SPEICHER);
      if (gemerkt && SPRACHEN.some((s) => s.code === gemerkt)) return gemerkt;
    } catch {
      /* Privater Modus — dann eben die Browsersprache. */
    }
    const vom = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return SPRACHEN.some((s) => s.code === vom) ? vom : 'en';
  }

  /**
   * Übersetzt einen einzelnen Text. Für Texte, die im JavaScript entstehen.
   *
   * @param {string} text englisches Original
   * @param {Record<string, string|number>} [werte] füllt {name}-Platzhalter
   */
  t(text, werte = null) {
    let s = this.woerter?.[glatt(text)] ?? text;
    if (werte) {
      for (const [k, v] of Object.entries(werte)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  }

  /** Umschalten: Wörterbuch holen, merken, anwenden. */
  async setzen(code) {
    if (!SPRACHEN.some((s) => s.code === code) || code === this.code) return;

    /* ERST HOLEN, DANN UMSCHALTEN. Andersherum stünde zwischen dem Setzen
     * von `this.code` und dem Eintreffen der Datei ein Zustand da, in dem
     * die Sprache schon gewechselt ist, das Wörterbuch aber noch fehlt —
     * `anwenden` aus dem Beobachter würde in dieser Lücke alles auf
     * Englisch zurückstellen. */
    await this._holen(code);
    this.code = code;
    try {
      localStorage.setItem(SPEICHER, code);
    } catch {
      /* dann gilt die Wahl nur bis zum Schliessen */
    }
    /* Das `lang`-Attribut ist nicht Zierde: Vorlesehilfen wählen danach ihre
     * Aussprache, und der Browser seine Silbentrennung. */
    this._richtungSetzen();
    this.anwenden();
    this.onAendern?.(code);
  }

  /**
   * Übersetzt alles unterhalb der Wurzel.
   *
   * Es wird IMMER vom englischen Original aus übersetzt, nie vom aktuell
   * sichtbaren Text. Sonst liefe ein Wechsel Deutsch -> Französisch ins
   * Leere, weil das Wörterbuch englische Schlüssel hat.
   *
   * @param {Node} [ab] nur diesen Teilbaum (der Beobachter nutzt das)
   */
  anwenden(ab = null) {
    let ziel = ab ?? this.wurzel;
    if (!ziel) return;

    /* Ist das Ziel selbst ein TEXTKNOTEN, muss sein Elternteil her.
     *
     * Ein TreeWalker besucht seine eigene Wurzel NIE, nur Nachfahren — und
     * ein Textknoten hat keine. Der Durchlauf täte also gar nichts.
     * Genau so ist es aufgefallen: `textContent = 'Sign in'` erzeugt einen
     * neuen Textknoten, der Beobachter reichte ihn hier herein, und die
     * Kontozeile blieb als einzige Stelle im deutschen Menü englisch. */
    if (ziel.nodeType === 3) ziel = ziel.parentElement ?? this.wurzel;

    /* DEN BEOBACHTER ABHÄNGEN, SOLANGE WIR SELBST SCHREIBEN.
     *
     * Hier stand ein Merker (`_laeuft = true` … `= false`), und der war
     * wirkungslos: der Rückruf eines MutationObserver läuft ASYNCHRON, als
     * Mikroaufgabe nach dem aktuellen Durchlauf. Wenn er endlich dran kommt,
     * steht der Merker längst wieder auf `false`. Der Beobachter sah damit
     * seine eigenen Änderungen, übersetzte erneut, löste sich wieder aus —
     * Endlosschleife. Die Seite fror beim Start ein; gemessen daran, dass
     * der Browser auf keine Abfrage mehr antwortete.
     *
     * `disconnect()` leert zugleich die bereits aufgelaufene Warteschlange.
     * Genau das ist gewollt: was wir selbst geschrieben haben, ist nichts,
     * worauf wir reagieren müssten. */
    const wachte = !!this._wacht;
    if (wachte) this._wacht.disconnect();
    try {
      this._textknoten(ziel);
      this._attribute(ziel);
    } finally {
      if (wachte) this._wachtStarten();
    }
  }

  _textknoten(ziel) {
    const gehen = document.createTreeWalker(ziel, NodeFilter.SHOW_TEXT, {
      acceptNode: (k) =>
        /* Skript- und Stilinhalte sind kein Text für Menschen. Ohne diese
         * Prüfung würde ein zufällig passender Codeschnipsel übersetzt. */
        k.parentElement && !/^(SCRIPT|STYLE)$/.test(k.parentElement.tagName)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const knoten = [];
    // Erst sammeln, dann ändern: wer beim Laufen schreibt, bringt den
    // TreeWalker durcheinander.
    for (let k = gehen.nextNode(); k; k = gehen.nextNode()) knoten.push(k);

    for (const k of knoten) {
      let ur = this._urtext.get(k);
      if (ur === undefined) {
        ur = k.nodeValue;
        // Reiner Leerraum und Zahlen bleiben unangetastet — das ist der
        // grosse Rest bei eingerücktem HTML.
        if (!/[A-Za-z]{2}/.test(ur)) continue;
        this._urtext.set(k, ur);
      }
      const neu = this.woerter?.[glatt(ur)];
      /* Den umgebenden Leerraum des Originals erhalten. Ohne ihn klebte
       * "Sign in" im Fliesstext am nächsten Wort. */
      if (neu !== undefined) {
        const [, vorn = '', , hinten = ''] = ur.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? [];
        k.nodeValue = vorn + neu + hinten;
      } else if (k.nodeValue !== ur) {
        k.nodeValue = ur; // zurück auf Englisch
      }
    }
  }

  _attribute(ziel) {
    const alle = ziel.nodeType === 1 ? [ziel, ...ziel.querySelectorAll('*')] : [];
    for (const el of alle) {
      for (const a of ATTRIBUTE) {
        if (!el.hasAttribute(a)) continue;
        let merk = this._urattr.get(el);
        if (!merk) this._urattr.set(el, (merk = {}));
        if (merk[a] === undefined) merk[a] = el.getAttribute(a);
        const neu = this.woerter?.[glatt(merk[a])];
        el.setAttribute(a, neu ?? merk[a]);
      }
    }
  }

  /**
   * Beobachtet Nachschub und übersetzt ihn mit.
   *
   * NÖTIG, NICHT BEQUEM: Kacheln, Bestenlisten, Meldungen und Einblendungen
   * entstehen erst zur Laufzeit. Ohne Beobachter müsste jede einzelne
   * Zeichenstelle daran denken, hinterher zu übersetzen — und genau eine
   * davon vergisst man. Der Beobachter kennt keine Ausnahmen.
   */
  beobachten() {
    if (!this.wurzel || this._wacht) return;
    this._wacht = new MutationObserver((eintraege) => {
      /* Erst sammeln, dann EINMAL übersetzen. Jedes `anwenden` hängt den
       * Beobachter ab und wieder an; das je Eintrag zu tun, wäre bei einer
       * neu gezeichneten Kachelliste dutzendfacher Leerlauf. */
      const ziele = new Set();
      for (const e of eintraege) {
        for (const k of e.addedNodes) ziele.add(k);
        if (e.type === 'characterData') {
          /* Von aussen neu gesetzter Text: der gemerkte Urtext ist überholt.
           * Ohne dieses Vergessen stellte der nächste Sprachwechsel den
           * ALTEN Text wieder her. */
          this._urtext.delete(e.target);
          ziele.add(e.target.parentElement ?? e.target);
        }
      }
      for (const z of ziele) this.anwenden(z);
    });
    this._wachtStarten();
  }

  _wachtStarten() {
    this._wacht.observe(this.wurzel, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}
