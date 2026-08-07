/**
 * Ton — das Mischpult. Musik je Gebiet plus die kurzen Effekte.
 *
 * ZWEI WEGE, UND DAS HAT EINEN GRUND
 *
 *   MUSIK  kommt aus Dateien (siehe Musik.js). Zwölf komponierte Stücke, je
 *          eins pro Wand, in Dauerschleife und beim Wechsel überblendet.
 *   EFFEKTE entstehen weiterhin zur Laufzeit aus Rauschen und Oszillatoren:
 *          Münze, Treffer, Game Over, Affenruf, Freischalten. Sie müssen im
 *          Millisekundenbereich auslösen und dutzendfach hintereinander —
 *          dafür ist eine Datei der falsche Weg, und sie kosten null Byte.
 *
 * Hier stand einmal, es liege "keine einzige Audiodatei im Build", samt
 * Begründung über Rechte und Grösse. Das gilt jetzt nur noch für die
 * Effekte. Für die Musik heisst es: die Stücke sind selbst erzeugt, und die
 * Zusicherung gegenüber den Portalen muss der Betreiber geben, nicht der
 * Code.
 *
 * ALLES HÄNGT AM SELBEN MASTER. Lautstärke, Stummschaltung, Pause und das
 * Stilllegen während eines Werbespots gelten deshalb für Musik und Effekte
 * gemeinsam — es gibt keinen zweiten Regler, den man vergessen könnte.
 *
 * WAS DER BROWSER VORSCHREIBT
 * Ton darf erst nach einer echten Nutzereingabe starten. Der AudioContext
 * wird deshalb nicht im Konstruktor gebaut, sondern beim ersten Klick
 * (`aufwecken()`). Ohne das bleibt er in Chrome dauerhaft "suspended" — man
 * hört nichts und sieht keinen Fehler.
 */

import { Musik } from './Musik.js';

export class Klang {
  /**
   * @param {typeof import('../config.js').CONFIG.klang} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.ctx = null;
    this.master = null;

    /* Die Stummschaltung überlebt das Neuladen. Münzen, Affe und Fell tun das
     * auch — wer den Ton abstellt, will ihn beim nächsten Mal nicht wieder
     * um die Ohren bekommen. Kaputter oder gesperrter Speicher (privater
     * Modus, Fremd-Rahmen eines Portals) darf das Spiel nicht aufhalten. */
    let gemerkt = null;
    try {
      gemerkt = localStorage.getItem(cfg.speicherSchluessel);
    } catch {
      /* kein Speicher — dann eben die Vorgabe */
    }
    this.stumm = gemerkt === null ? !cfg.anAmAnfang : gemerkt === '1';

    /** Zuletzt gewünschte Atmosphäre, auch wenn sie noch nicht klingen kann */
    this._wunsch = null;

    /* ABSICHTLICH STILL — Pause, Werbespot, versteckter Tab.
     *
     * Ohne diese Unterscheidung kann der Ton nicht wissen, ob "angehalten"
     * bedeutet "der Browser hat noch nicht freigegeben" oder "das Spiel will
     * gerade Ruhe". Gemessene Folge: seit die Weckruf-Zuhörer dauerhaft
     * lauschen, holte JEDER Klick den Ton mitten aus der Pause zurück — und
     * legte ihn im Zweifel über den laufenden Werbespot. */
    this._absichtlichStill = false;
    /** Gebietsmusik. Entsteht erst mit dem AudioContext (siehe aufwecken). */
    this.musik = null;
    /* Rauschpuffer für die Effekte (Treffer, Knistern). Die Atmosphären
     * brauchten ihn früher auch — die sind jetzt Musikdateien. */
    this._rauschen = null;
    // Nächster erlaubter Zeitpunkt je Effekt — gegen das Maschinengewehr,
    // wenn im selben Frame mehrere Münzen eingesammelt werden.
    this._letzte = new Map();
  }

  /* ==================================================================== Start */

  /**
   * Muss aus einer echten Nutzereingabe heraus gerufen werden (Klick, Taste).
   * Mehrfachaufrufe sind harmlos.
   */
  aufwecken() {
    if (this.ctx) {
      /* Nach einem Tabwechsel kann der Kontext wieder angehalten sein — dann
       * ist eine Eingabe genau das richtige Signal zum Weitermachen.
       * ABER NICHT, wenn das Spiel absichtlich Ruhe haben will (Pause,
       * Werbespot, Hintergrund).
       *
       * BEWUSST OHNE `document.hidden`-Prüfung, anders als in `fortsetzen()`:
       * Wer klickt oder tippt, SIEHT die Seite — das ist ein verlässlicherer
       * Beweis als die Sichtbarkeits-Schnittstelle. Gemessen: eine
       * eingebettete Vorschau meldet `hidden: true`, obwohl sie sichtbar ist.
       * Ohne diesen Weg käme der Ton dort nie zurück; so heilt die nächste
       * Eingabe den Fehler von selbst. */
      if (this.ctx.state === 'suspended' && !this._absichtlichStill) {
        this.ctx
          .resume()
          .then(() => this._wunschEinloesen())
          .catch(() => {});
      }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // sehr alter Browser — dann eben still

    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.stumm ? 0 : this.cfg.lautstaerke;
    this.master.connect(this.ctx.destination);

    // EIN Rauschpuffer für alles. Zwei Sekunden reichen: kürzer hört man die
    // Schleife, länger kostet nur Speicher.
    const laenge = Math.floor(this.ctx.sampleRate * 2);
    this._rauschen = this.ctx.createBuffer(1, laenge, this.ctx.sampleRate);
    const daten = this._rauschen.getChannelData(0);
    for (let i = 0; i < laenge; i++) daten[i] = Math.random() * 2 - 1;

    // Musik hängt am selben Mischpult wie die Effekte: Lautstärke,
    // Stummschaltung und Pause gelten damit für alles gemeinsam.
    this.musik = new Musik(this.cfg.musik, this.ctx, this.master);

    // Ein Menü, das schon vor der ersten Eingabe Musik angefordert hat,
    // bekommt sie jetzt — sonst bliebe das Startmenü als einziger Bildschirm
    // des Spiels ohne Ton.
    this._wunschEinloesen();
  }

  get bereit() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** @returns {boolean} neuer Zustand (true = stumm) */
  stummSchalten() {
    this.stumm = !this.stumm;
    try {
      localStorage.setItem(this.cfg.speicherSchluessel, this.stumm ? '1' : '0');
    } catch {
      /* kein Speicher — die Einstellung gilt dann nur für diese Sitzung */
    }
    if (this.master) {
      this.master.gain.setTargetAtTime(
        this.stumm ? 0 : this.cfg.lautstaerke,
        this.ctx.currentTime,
        0.05,
      );
    }
    return this.stumm;
  }

  /* =============================================================== Musik */

  /**
   * Wechselt die Gebietsmusik. Game ruft das jeden Frame; `Musik.spiele`
   * erkennt selbst, ob sich etwas geändert hat.
   *
   * HIER STAND DAS PROZEDURALE ATMOSPHÄREN-SYSTEM: gefiltertes Rauschen,
   * Dauertöne, einzelne Vogelrufe, dazu zwei Pegel und ein Abbau-Timer —
   * rund 200 Zeilen. Es war der Notbehelf, solange es keine Musik gab.
   * Jetzt gibt es zwölf komponierte Stücke, und beides gleichzeitig wäre nur
   * Matsch gewesen. Die kurzen EFFEKTE weiter unten bleiben prozedural — die
   * müssen im Millisekundenbereich auslösen.
   *
   * @param {string} name Wandname aus CONFIG.wall.stages
   */
  atmo(name) {
    /* Den Wunsch IMMER merken, auch wenn gerade kein Ton möglich ist.
     * Browser lassen `play()` erst nach einer Nutzereingabe zu; ohne das
     * bliebe das Startmenü stumm, bis zufällig ein Wandwechsel kommt. */
    this._wunsch = name;
    if (!this.bereit || !this.musik) return;
    this.musik.spiele(name);
  }

  /**
   * Muss jeden Frame laufen: kümmert sich um den Schleifenpunkt. Die Stücke
   * sind nicht als Schleife komponiert, deshalb blendet Musik.js kurz vor
   * dem Ende in den eigenen Anfang.
   */
  musikUpdate() {
    if (this.bereit) this.musik?.update();
  }

  /* ================================================================ Effekte */

  /**
   * Kurzer Effekt.
   * @param {'muenze'|'treffer'|'gameover'|'affe'|'frei'} name
   */
  effekt(name) {
    if (!this.ctx) return;

    /* resume() liefert ein Promise — unmittelbar danach steht der Kontext
     * noch auf "suspended", und die Prüfung unten wäre false. Gemessen: der
     * Startbrüller nach Pause → Menü → Start fiel deshalb komplett aus.
     * Also nachholen, sobald der Kontext wirklich läuft. */
    if (this.ctx.state === 'suspended') {
      this.ctx
        .resume()
        .then(() => this._effektJetzt(name))
        .catch(() => {});
      return;
    }
    this._effektJetzt(name);
  }

  _effektJetzt(name) {
    if (!this.bereit) return;
    const rezept = this.cfg.effekte[name];
    if (!rezept) return;

    // Mindestabstand: sonst summieren sich gleichzeitige Effekte zu einem
    // Knacken, und das Clipping hört man deutlicher als den Effekt selbst.
    const jetzt = this.ctx.currentTime;
    if (jetzt < (this._letzte.get(name) ?? 0)) return;
    this._letzte.set(name, jetzt + (rezept.mindestAbstand ?? 0.04));

    for (const ton of rezept.toene) {
      this._ton(ton, jetzt + (ton.verzoegerung ?? 0));
    }
  }

  _ton(t, start) {
    const g = this.ctx.createGain();
    g.connect(this.master);

    let quelle;
    if (t.rauschen) {
      quelle = this.ctx.createBufferSource();
      quelle.buffer = this._rauschen;
      const f = this.ctx.createBiquadFilter();
      f.type = t.filterTyp ?? 'bandpass';
      f.frequency.setValueAtTime(t.von, start);
      if (t.bis) f.frequency.exponentialRampToValueAtTime(Math.max(20, t.bis), start + t.dauer);
      f.Q.value = t.guete ?? 1;
      quelle.connect(f).connect(g);
    } else {
      quelle = this.ctx.createOscillator();
      quelle.type = t.form ?? 'sine';
      quelle.frequency.setValueAtTime(t.von, start);
      if (t.bis) {
        quelle.frequency.exponentialRampToValueAtTime(Math.max(20, t.bis), start + t.dauer);
      }
      quelle.connect(g);
    }

    // Hüllkurve: schneller Anschlag, exponentieller Abfall. Linear abfallend
    // klingt nach abgeschnitten, exponentiell nach ausklingen.
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(t.gain, start + (t.anschlag ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, start + t.dauer);

    quelle.start(start);
    quelle.stop(start + t.dauer + 0.05);
  }

  /**
   * Musik ausblenden — im Hauptmenue nach einem Lauf.
   *
   * Ohne das lief das zuletzt gespielte Stueck endlos weiter: nach einem
   * Lauf bis zur Lava dudelte im Hauptmenue weiter die Lava.
   */
  atmoAus() {
    // Auch den gemerkten Wunsch loeschen, sonst holt ihn 
    // gleich wieder zurueck.
    this._wunsch = null;
    this.musik?.aus();
  }
  anhalten() {
    this._absichtlichStill = true;
    if (this.ctx?.state === 'running') this.ctx.suspend().catch(() => {});
  }

  fortsetzen() {
    /* Ab hier ist Ton wieder erlaubt — das gilt auch dann, wenn wir gleich
     * unten nicht anwerfen. Sonst bliebe der Riegel in `aufwecken()` liegen. */
    this._absichtlichStill = false;
    /* Im versteckten Tab NICHT anwerfen. Ein Werbespot, der im Hintergrund
     * ausläuft, brächte sonst den Spielton in einem unsichtbaren Tab zurück.
     * Es geht nichts verloren: die Sichtbarkeitsprüfung ruft beim Zurück-
     * kommen erneut, und jede Eingabe tut es über `aufwecken()` ebenfalls. */
    if (document.hidden) return;
    if (this.ctx?.state === 'suspended') {
      this.ctx
        .resume()
        .then(() => this._wunschEinloesen())
        .catch(() => {});
      return;
    }
    this._wunschEinloesen();
  }

  /**
   * Holt Musik nach, die angefordert wurde, als noch kein Ton möglich war.
   * Ohne das bliebe der zuletzt gemerkte Wunsch liegen, bis zufällig ein
   * Wandwechsel `atmo()` erneut ruft.
   */
  _wunschEinloesen() {
    if (this._wunsch && this.bereit && this.musik?.aktuell !== this._wunsch) {
      this.atmo(this._wunsch);
    }
  }
}
