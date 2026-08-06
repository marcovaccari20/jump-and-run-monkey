/**
 * Ton — Atmosphäre je Gebiet plus die kurzen Effekte.
 *
 * WARUM ERZEUGT STATT ABGESPIELT
 * Es liegt keine einzige Audiodatei im Build. Alles hier entsteht zur Laufzeit
 * aus Rauschen und Oszillatoren. Drei Gründe, in dieser Reihenfolge:
 *
 *   1. RECHTE. Die Developer Terms von CrazyGames verlangen die Zusicherung,
 *      alle Inhalte rechtmässig nutzen zu dürfen, samt Freistellung bei
 *      Ansprüchen Dritter. Bei selbst erzeugtem Klang gibt es diese Frage
 *      nicht — und zwar dauerhaft, nicht nur bis jemand nachfragt.
 *   2. GRÖSSE. Zwölf Atmosphären als Schleifen wären schnell 15–20 MB, mehr
 *      als das ganze übrige Spiel. Hier sind es null Byte.
 *   3. ANPASSBARKEIT. Eine Wand mehr heisst: ein Eintrag in CONFIG.klang.
 *      Kein Aufnehmen, kein Schneiden, kein Konvertieren.
 *
 * ECHTE AUFNAHMEN NACHRÜSTEN
 * Das ist vorgesehen, nicht verbaut. `atmo(name)` und `effekt(name)` sind die
 * einzigen zwei Methoden, die das Spiel kennt. Wer Dateien will, ersetzt deren
 * Innenleben durch einen Buffer-Player — am Rest ändert sich nichts.
 *
 * WAS DER BROWSER VORSCHREIBT
 * Ton darf erst nach einer echten Nutzereingabe starten. Der AudioContext
 * wird deshalb nicht im Konstruktor gebaut, sondern beim ersten Klick
 * (`aufwecken()`). Ohne das bleibt er in Chrome dauerhaft "suspended" — man
 * hört nichts und sieht keinen Fehler.
 */

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
    /** Laufende Atmosphäre: { name, quellen[], gain } */
    this._atmo = null;
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

    // Ein Menü, das schon vor der ersten Eingabe eine Atmosphäre angefordert
    // hat, bekommt sie jetzt — sonst bliebe das Startmenü als einziger
    // Bildschirm des Spiels ohne Ton.
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

  /* ================================================================ Bausteine */

  /** Rauschquelle mit Filter — die Grundlage jeder Atmosphäre. */
  _rauschQuelle({ typ, frequenz, guete, gain }) {
    const q = this.ctx.createBufferSource();
    q.buffer = this._rauschen;
    q.loop = true;

    const f = this.ctx.createBiquadFilter();
    f.type = typ;
    f.frequency.value = frequenz;
    f.Q.value = guete;

    const g = this.ctx.createGain();
    g.gain.value = gain;

    q.connect(f).connect(g);
    q.start();
    return { quelle: q, ausgang: g };
  }

  /** Dauerton — gibt einer Atmosphäre ihre Stimmung (tief = bedrohlich). */
  _drone({ frequenz, form, gain, schweben }) {
    const o = this.ctx.createOscillator();
    o.type = form;
    o.frequency.value = frequenz;

    const g = this.ctx.createGain();
    g.gain.value = gain;

    /* Zweiter, leicht verstimmter Ton — aber DEUTLICH LEISER.
     *
     * Hier lag ein Fehler, den man nur mit einer Messung findet: vorher liefen
     * beide Oszillatoren mit derselben Amplitude in denselben Gain. Zwei
     * gleich laute Sinus löschen sich einmal je Schwebungsperiode VOLLSTÄNDIG
     * aus — der Dauerton verschwand also periodisch ganz und kam wieder.
     * Gemessen wurden bis zu 21.6 dB Pegeleinbruch bei 0.24–1.06 Hz, und das
     * hört sich nicht nach Schimmer an, sondern nach Wackelkontakt.
     *
     * Mit halber Amplitude bleibt der Grundton immer stehen und der zweite
     * moduliert ihn nur — das ist die Schwebung, die gemeint war. */
    let o2 = null;
    if (schweben) {
      o2 = this.ctx.createOscillator();
      o2.type = form;
      o2.frequency.value = frequenz * (1 + schweben);

      // Eigener Pegel, dann in denselben Ausgang: so bleibt der zweite Ton
      // unter der Lautstärkeregelung der Atmosphäre.
      const g2 = this.ctx.createGain();
      g2.gain.value = gain * 0.45;
      o2.connect(g2);
      g2.connect(g);
      o2.start();
    }

    o.connect(g);
    o.start();
    return { quelle: o, quelle2: o2, ausgang: g };
  }

  /* ============================================================== Atmosphäre */

  /**
   * Wechselt die Hintergrundatmosphäre — überblendet, nie hart geschnitten.
   *
   * @param {string} name Schlüssel aus CONFIG.klang.gebiete (= Wandname)
   */
  atmo(name) {
    /* Den Wunsch IMMER merken, auch wenn gerade kein Ton möglich ist.
     *
     * Vorher wurde der Aufruf hier ersatzlos verworfen. Gemessene Folgen:
     * das Hauptmenü war nach "Pause -> Hauptmenü" komplett stumm (der
     * Kontext war noch angehalten), und `_atmo` zeigte weiter auf das letzte
     * Gebiet — wer danach im Affenladen etwas kaufte, weckte damit den Ton
     * und bekam im Hauptmenü plötzlich die Lava zu hören. */
    this._wunsch = name;
    if (!this.bereit) return;
    if (this._atmo?.name === name) return;

    const rezept = this.cfg.gebiete[name] ?? this.cfg.gebiete.standard;
    const jetzt = this.ctx.currentTime;
    const fade = this.cfg.atmoFade;

    // Alte ausblenden und danach abbauen.
    if (this._atmo) this._abbauen(this._atmo);

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);

    /* ZWEITER PEGEL, NUR FÜR DIE TUPFER.
     *
     * Der Vogelruf soll mit überblenden, aber NICHT den Gebietspegel
     * mitnehmen. Der ist ein Ausgleich für die sehr unterschiedliche Leistung
     * der Rauschbetten (1.13 bis 2.95) und hat mit der Lautstärke eines Rufs
     * nichts zu tun. Hingen die Tupfer am selben Knoten, wäre der Vogel in
     * einem Gebiet fast dreimal so laut wie im nächsten — obwohl in der
     * Konfiguration überall dieselbe Zahl steht.
     *
     * Also: gleiche Überblendung, eigener Pegel. */
    const tupferGain = this.ctx.createGain();
    tupferGain.gain.value = 0;
    tupferGain.connect(this.master);

    const teile = [];
    for (const r of rezept.rauschen ?? []) {
      const t = this._rauschQuelle(r);
      t.ausgang.connect(gain);
      teile.push(t);
    }
    for (const d of rezept.drones ?? []) {
      const t = this._drone(d);
      t.ausgang.connect(gain);
      teile.push(t);
    }

    gain.gain.setTargetAtTime(rezept.gain ?? 1, jetzt, fade / 3);
    tupferGain.gain.setTargetAtTime(1, jetzt, fade / 3);
    this._atmo = { name, teile, gain, tupferGain, rezept };
  }

  /**
   * Blendet eine Atmosphäre aus und räumt sie danach ab.
   *
   * Stand vorher zweimal fast gleich im Code — einmal beim Wandwechsel,
   * einmal in `atmoAus()`. Beim Nachrüsten des zweiten Pegels (`tupferGain`)
   * hätte man ihn an einer der beiden Stellen zwangsläufig vergessen.
   *
   * Der Timer ist nötig: ein sofort gestopptes Oszillatornetz knackt hörbar.
   *
   * @param {{teile: Array, gain: GainNode, tupferGain?: GainNode}} alt
   */
  _abbauen(alt) {
    const jetzt = this.ctx.currentTime;
    const fade = this.cfg.atmoFade;
    alt.gain.gain.setTargetAtTime(0, jetzt, fade / 3);
    alt.tupferGain?.gain.setTargetAtTime(0, jetzt, fade / 3);

    setTimeout(() => {
      for (const t of alt.teile) {
        try {
          t.quelle.stop();
          t.quelle2?.stop();
        } catch {
          /* schon gestoppt */
        }
      }
      for (const knoten of [alt.gain, alt.tupferGain]) {
        try {
          knoten?.disconnect();
        } catch {
          /* egal */
        }
      }
    }, fade * 1000 + 200);
  }

  /**
   * Einzelne Umgebungsgeräusche — Vogel, Tropfen, Knistern.
   *
   * Wird von Game im Takt gerufen. Sie sind der Unterschied zwischen "da
   * rauscht etwas" und "da ist ein Wald": ein gleichmässiges Rauschen nimmt
   * das Ohr nach zwanzig Sekunden nicht mehr wahr, ein unregelmässiger Ruf
   * immer.
   */
  atmoTupfer() {
    if (!this.bereit || !this._atmo) return;
    const t = this._atmo.rezept.tupfer;
    if (!t) return;

    const jetzt = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = t.form ?? 'sine';

    const g = this.ctx.createGain();
    const von = t.von * (0.85 + Math.random() * 0.3);
    const bis = t.bis * (0.85 + Math.random() * 0.3);
    o.frequency.setValueAtTime(von, jetzt);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, bis), jetzt + t.dauer);

    g.gain.setValueAtTime(0, jetzt);
    g.gain.linearRampToValueAtTime(t.gain, jetzt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, jetzt + t.dauer);

    /* An den Tupfer-Pegel der Atmosphäre hängen, nicht direkt an den Master.
     *
     * Vorher ging der Tupfer an der 1.6-Sekunden-Überblendung vorbei: direkt
     * nach einem Wandwechsel ertönte der Vogel des neuen Gebiets in voller
     * Lautstärke, während dessen Rauschbett noch einblendete. Jetzt blendet
     * er mit — aber über einen eigenen Pegel, damit der Gebietsausgleich
     * ihn nicht mitzieht (siehe atmo()). */
    o.connect(g).connect(this._atmo.tupferGain);
    o.start(jetzt);
    o.stop(jetzt + t.dauer + 0.05);
  }

  /* ================================================================= Effekte */

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
   * Atmosphäre ausblenden und abbauen.
   *
   * Ohne das lief die zuletzt gespielte Wand endlos weiter — nach einem Lauf
   * bis zur Lava grollte im Hauptmenü weiter die Lava.
   */
  atmoAus() {
    // Auch den gemerkten Wunsch löschen, sonst holt ihn `fortsetzen()` gleich
    // wieder zurück.
    this._wunsch = null;
    if (!this._atmo || !this.ctx) return;
    const alt = this._atmo;
    // ERST abhängen, dann abbauen: ein Tupfer, der genau jetzt fiele, würde
    // sich sonst noch an den sterbenden Pegel hängen.
    this._atmo = null;
    this._abbauen(alt);
  }

  /* ================================================================ Aufräumen */

  /** Bei Pause, Werbung und im Hintergrund: still, aber nicht abgebaut. */
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
   * Holt eine Atmosphäre nach, die angefordert wurde, als noch kein Ton
   * möglich war. Ohne das bliebe der zuletzt gemerkte Wunsch liegen, bis
   * zufällig ein Wandwechsel `atmo()` erneut ruft.
   */
  _wunschEinloesen() {
    if (this._wunsch && this.bereit && this._atmo?.name !== this._wunsch) {
      this.atmo(this._wunsch);
    }
  }
}
