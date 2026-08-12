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

import { assetUrl } from '../core/AssetLoader.js';
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
    /** Dasselbe für das Abspieltempo (steigt mit jedem Gebiet). */
    this._tempoWunsch = 1;
    /** Und für die Bossmusik. */

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
    /* Echte Aufnahmen für einzelne Effekte (Banane, Affenruf).
     *
     * Diese hier werden ENTPACKT gehalten, anders als die Musik: sie sind
     * unter anderthalb Sekunden lang (rund 250 KB entpackt), müssen ohne
     * jede Verzögerung auslösen und sich beliebig oft überlappen. Genau das
     * kann ein AudioBuffer und ein <audio>-Element nicht. */
    this._proben = new Map();
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
      /* JEDE Eingabe schaltet die Musikabspieler frei und holt Abgelehntes
       * nach. Safari verlangt die Geste pro <audio>-Element; ohne das lief
       * auf dem iPhone das erste Stück einmal durch und danach war Ruhe. */
      if (!this._absichtlichStill) this.musik?.freischalten();
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
    this._probenLaden();

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
   * Abspieltempo der Musik (1 = normal). Steigt mit jedem Gebiet.
   *
   * Wird ebenfalls IMMER gemerkt: der AudioContext entsteht erst mit der
   * ersten Eingabe, und ein Tempo, das vorher gesetzt wurde, dürfte dabei
   * nicht verlorengehen.
   */
  tempo(faktor) {
    this._tempoWunsch = faktor;
    if (this.bereit) this.musik?.tempo(faktor);
  }

  /** Zurück auf Normaltempo — beim Start einer neuen Runde. */
  tempoZuruecksetzen() {
    this._tempoWunsch = 1;
    this.musik?.tempoZuruecksetzen();
  }

  /**
   * Bossmusik an oder aus.
   *
   * Der Wunsch wird gemerkt wie bei atmo(): Der AudioContext entsteht erst
   * mit der ersten Nutzereingabe, und ein Kampf, der davor beginnt, dürfte
   * seine Musik nicht verlieren.
   */
  boss(an) {
    /* WIEDER ANGESCHLOSSEN. Hier stand ein `return;` aus der Zeit, als der
     * Bosskampf ausgebaut war — die Methode war ein stiller No-op. Der neue
     * Kampf rief sie brav auf, und es passierte nichts; public/musik/boss.ogg
     * lag die ganze Zeit da und wurde nie gespielt. Genau deshalb hielt ich
     * das Stück für ungenutzt. */
    this._bossWunsch = an === true;
    if (!this.bereit || !this.musik) return;
    if (an) this.musik.bossAn();
    else this.musik.bossAus();
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
   * Lädt die aufgenommenen Effekte und entpackt sie EINMAL in den Speicher.
   *
   * Läuft nebenher: bis sie da sind, greift für dieselben Namen das
   * prozedurale Rezept. Man hört dadurch nie Stille, höchstens in den ersten
   * Sekunden den erzeugten statt des aufgenommenen Klangs.
   *
   * Format wie bei der Musik über `canPlayType`, Pfad über `assetUrl` —
   * sonst bricht es im Unterordner der Portale.
   */
  async _probenLaden() {
    const proben = this.cfg.proben;
    if (!proben) return;

    const pruef = document.createElement('audio');
    const ogg = pruef.canPlayType('audio/ogg; codecs="vorbis"');
    const endung = ogg === 'probably' || ogg === 'maybe' ? 'ogg' : 'mp3';

    for (const [name, basis] of Object.entries(proben)) {
      try {
        const antwort = await fetch(assetUrl(`${basis}.${endung}`));
        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
        const roh = await antwort.arrayBuffer();
        this._proben.set(name, await this.ctx.decodeAudioData(roh));
      } catch (err) {
        /* Kein Beinbruch: dann bleibt es beim erzeugten Klang.
         *
         * ABER LAUT genug melden. Beim ersten Anlauf fehlte hier der Import
         * von `assetUrl` — der ReferenceError landete in genau diesem catch,
         * und die Aufnahmen blieben stumm, ohne dass etwas auffiel.
         * `console.warn` statt `info`, damit so etwas nicht wieder im
         * Grundrauschen verschwindet. */
        console.warn(`[Klang] Aufnahme "${name}" nicht geladen: ${err.message} — nehme das Rezept.`);
      }
    }
  }

  /**
   * Kurzer Effekt.
   * @param {'muenze'|'banane'|'treffer'|'gameover'|'affe'|'frei'} name
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
    const probe = this._proben.get(name);
    if (!rezept && !probe) return;

    // Mindestabstand: sonst summieren sich gleichzeitige Effekte zu einem
    // Knacken, und das Clipping hört man deutlicher als den Effekt selbst.
    const jetzt = this.ctx.currentTime;
    if (jetzt < (this._letzte.get(name) ?? 0)) return;
    this._letzte.set(name, jetzt + (rezept?.mindestAbstand ?? 0.04));

    /* AUFNAHME SCHLÄGT REZEPT.
     *
     * Wo eine echte Aufnahme geladen ist, gewinnt sie — das Rezept bleibt
     * als Rückfall stehen, solange die Datei noch lädt oder fehlt. Beides
     * gleichzeitig abzuspielen wäre Matsch. */
    if (probe) {
      const quelle = this.ctx.createBufferSource();
      quelle.buffer = probe;
      // Leichte Tonhöhenstreuung: derselbe Klang zwanzigmal exakt gleich
      // klingt nach Maschine. ±6 % fällt einzeln nicht auf, in der Summe
      // aber sehr wohl.
      quelle.playbackRate.value = 1 + (Math.random() * 2 - 1) * (this.cfg.probenStreuung ?? 0.06);
      const g = this.ctx.createGain();
      g.gain.value = this.cfg.probenPegel ?? 1;
      quelle.connect(g).connect(this.master);
      quelle.start(jetzt);
      return;
    }

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
    /* Das Tempo mit einlösen. Ohne das liefe die Musik nach einem Tabwechsel
     * mitten im zwölften Gebiet wieder auf Normaltempo an — der Ton kommt
     * dann zwar zurück, aber mit dem Schwung des ersten Gebiets. */
    if (this.bereit && this._tempoWunsch !== 1) {
      this.musik?.tempo(this._tempoWunsch);
    }
    /* Und einen laufenden Bosskampf. Ohne das käme der Spieler aus einem
     * Tabwechsel mit Gebietsmusik zurück, während der Adler noch angreift. */
    if (this.bereit && this._bossWunsch && !this.musik?.bossLaeuft) {
      this.musik?.bossAn();
    }
  }
}
