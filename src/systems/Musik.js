/**
 * Gebietsmusik — ein Stück je Wand, in Dauerschleife, überblendet beim
 * Wechsel.
 *
 * ERSETZT die früheren prozeduralen Atmosphären (gefiltertes Rauschen plus
 * Dauertöne). Die waren ein Notbehelf, solange es keine Musik gab; jetzt gibt
 * es zwölf komponierte Stücke, und Notbehelf und Musik gleichzeitig wären nur
 * Matsch. Die kurzen EFFEKTE (Münze, Treffer, Game Over, Affenruf) bleiben
 * prozedural — die müssen im Millisekundenbereich auslösen, dafür ist eine
 * Datei der falsche Weg.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WARUM <audio> UND NICHT decodeAudioData
 *
 * Ein entpacktes Stück liegt als rohe Fliesskommadaten im Speicher: 155 s in
 * Stereo bei 44.1 kHz sind rund 55 MB. Mal zwölf Gebiete wäre das jenseits
 * von Gut und Böse, besonders auf dem Handy. `<audio>` streamt stattdessen
 * und hält nur einen kleinen Puffer. Über `MediaElementAudioSourceNode`
 * hängt es trotzdem am selben Mischpult wie die Effekte — Lautstärke,
 * Stummschaltung und Pause gelten also für alles gemeinsam.
 *
 * WARUM ZWEI ELEMENTE JE GEBIET
 * Die Stücke sind nicht als Schleife komponiert; ihr Ende führt nicht zurück
 * zum Anfang. `loop = true` spielt zwar lückenlos, aber der musikalische
 * Bruch bleibt hörbar. Deshalb laufen zwei Elemente abwechselnd: kurz vor
 * dem Ende startet das zweite von vorn, und beide werden ineinander
 * geblendet. Das kaschiert den Bruch und nebenbei auch die Kodierlücke, die
 * MP3 am Dateianfang hat.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { assetUrl } from '../core/AssetLoader.js';

/**
 * Blendkurve mit GLEICHER LEISTUNG statt gerader Linie.
 *
 * Zwei lineare Blenden, die sich kreuzen, stehen in der Mitte beide bei 0.5.
 * Für unkorrelierte Signale — und zwei verschiedene Musikstücke sind das —
 * addieren sich nicht die Pegel, sondern die LEISTUNGEN: √(0.5² + 0.5²) =
 * 0.71. Das ist ein hörbarer Einbruch von rund 3 dB, mitten in jedem
 * Gebietswechsel und an jedem Schleifenpunkt. Bei `eiszeit` (26 s) alle 26
 * Sekunden.
 *
 * Mit der Viertelwelle des Kosinus gilt cos²+sin²=1, die Summe der
 * Leistungen bleibt also konstant und man hört keine Delle.
 *
 * @param {number} von  Startwert
 * @param {number} bis  Zielwert
 * @param {number} n    Stützstellen (32 reichen für eine glatte Blende)
 */
function blendkurve(von, bis, n = 32) {
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 0..1 als Viertelwelle: sanft raus, sanft rein, in der Mitte 0.707.
    const t = i / (n - 1);
    const anteil = Math.sin((t * Math.PI) / 2);
    k[i] = von + (bis - von) * anteil;
  }
  return k;
}

export class Musik {
  /**
   * @param {typeof import('../config.js').CONFIG.klang.musik} cfg
   * @param {AudioContext} ctx
   * @param {AudioNode} ziel Mischpult (der Master von Klang)
   */
  constructor(cfg, ctx, ziel) {
    this.cfg = cfg;
    this.ctx = ctx;
    this.ziel = ziel;

    /** @type {Map<string, {a: object, b: object, gain: GainNode}>} */
    this._gebiete = new Map();
    /** Gerade laufendes Gebiet. */
    this._aktuell = null;
    /* Abspieler, deren play() der Browser abgelehnt hat. Die nächste echte
     * Nutzereingabe holt sie über `freischalten()` nach. */
    this._schuldig = new Set();
    /* Abspieler, die schon einmal aus einer Geste heraus liefen. Safari
     * verlangt das PRO Element. */
    this._freigeschaltet = new Set();
    this._endung = this._formatWaehlen();

    /* Abspieltempo. Steigt mit jedem Gebiet (siehe CONFIG.klang.musik.
     * tempoProGebiet). Wird hier gemerkt, weil neu angelegte Abspieler es
     * sofort brauchen — ein Gebiet, das erst spät zum ersten Mal auftaucht,
     * liefe sonst wieder auf 1.0, mitten im schnellsten Abschnitt. */
    this._tempo = 1;
    /** Läuft gerade eine Tempoblende? (id des setInterval) */
    this._tempoUhr = 0;

    /** Bossmusik: eigener Abspieler mit eigenen Schleifenpunkten. */
    this._bossSpieler = null;
    this._bossLaeuft = false;
    this._bossUhr = 0;
  }

  /**
   * Welches Format der Browser mag.
   *
   * Vorbis in OGG ist überall ausser auf sehr alten Apple-Geräten dabei und
   * hat den saubereren Schleifenpunkt. MP3 ist der Rückfall — dafür liegt
   * jedes Stück in beiden Formaten bereit.
   */
  _formatWaehlen() {
    const pruef = document.createElement('audio');
    const ogg = pruef.canPlayType('audio/ogg; codecs="vorbis"');
    return ogg === 'probably' || ogg === 'maybe' ? 'ogg' : 'mp3';
  }

  /**
   * ÜBER `assetUrl`, NICHT als roher Pfad.
   *
   * Hier stand `${this.cfg.ordner}${gebiet}.${endung}` und ergab
   * `/musik/gruen.ogg` — einen ABSOLUTEN Pfad. Die Portale liefern das Spiel
   * aber aus einem Unterordner aus, und dort zeigt ein führender Schrägstrich
   * auf die Wurzel der Portalseite. Ergebnis wäre gewesen: auf CrazyGames und
   * GameMonetize überhaupt keine Musik, ohne eine einzige Fehlermeldung —
   * `<audio>` schweigt bei 404 einfach.
   *
   * Genau dafür gibt es `assetUrl`: es löst gegen `base: './'` aus
   * vite.config.js auf. Jedes andere Asset im Spiel geht schon diesen Weg.
   */
  _pfad(gebiet) {
    return assetUrl(`${this.cfg.ordner}${gebiet}.${this._endung}`);
  }

  /** Legt (einmalig) die zwei Abspieler eines Gebiets an. */
  _anlegen(gebiet) {
    if (this._gebiete.has(gebiet)) return this._gebiete.get(gebiet);

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.ziel);

    const bauen = () => {
      const el = new Audio();
      el.src = this._pfad(gebiet);
      el.preload = 'auto';
      // KEIN loop: die Schleife macht der Wechsel zwischen a und b, sonst
      // liefen beide Mechanismen gegeneinander.
      el.loop = false;
      /* KEIN `crossOrigin`. Die Musik liegt im eigenen Build, ist also immer
       * gleicher Herkunft — dann braucht ein MediaElementAudioSourceNode
       * nichts dergleichen. Gesetzt bewirkt es das Gegenteil: es erzwingt
       * eine CORS-Anfrage. Antwortet der Server ohne die passende Kopfzeile
       * (Portal-CDN, oder `file://` in der Android-Hülle), liefert der Knoten
       * STILLE statt Musik — ohne Fehlermeldung. */
      // Tempo sofort mitgeben: ein Gebiet, das erst spät zum ersten Mal
      // auftaucht, liefe sonst wieder auf 1.0 an.
      this._tempoAnwenden(el);

      const quelle = this.ctx.createMediaElementSource(el);
      const eigen = this.ctx.createGain();
      eigen.gain.value = 0;
      quelle.connect(eigen).connect(gain);
      return { el, eigen };
    };

    const eintrag = { a: bauen(), b: bauen(), gain, aktiv: null, uhr: 0 };
    this._gebiete.set(gebiet, eintrag);
    return eintrag;
  }

  /**
   * Wechselt auf das Stück eines Gebiets. Mehrfachaufrufe mit demselben
   * Namen sind wirkungslos — Game ruft das jeden Frame.
   *
   * @param {string} gebiet Schlüssel aus CONFIG.wall.stages
   */
  spiele(gebiet) {
    if (this._aktuell === gebiet) return;
    const fade = this.cfg.wechselFade;
    const jetzt = this.ctx.currentTime;

    // Altes ausblenden — es läuft weiter, bis die Blende durch ist.
    if (this._aktuell) {
      const alt = this._gebiete.get(this._aktuell);
      if (alt) {
        alt.gain.gain.cancelScheduledValues(jetzt);
        alt.gain.gain.setValueCurveAtTime(blendkurve(alt.gain.gain.value, 0), jetzt, fade);
        const zuStoppen = alt;
        clearTimeout(zuStoppen.uhr);
        zuStoppen.uhr = setTimeout(() => {
          for (const s of [zuStoppen.a, zuStoppen.b]) {
            try {
              s.el.pause();
              s.el.currentTime = 0;
            } catch {
              /* egal */
            }
          }
          zuStoppen.aktiv = null;
        }, fade * 1000 + 120);
      }
    }

    this._aktuell = gebiet;
    const neu = this._anlegen(gebiet);
    clearTimeout(neu.uhr);

    // Von vorn beginnen: ein Gebiet soll mit dem Anfang seines Stücks
    // starten, nicht dort, wo man es beim letzten Mal verlassen hat.
    neu.aktiv = neu.a;
    neu.b.eigen.gain.value = 0;
    neu.a.eigen.gain.value = 1;
    try {
      neu.a.el.currentTime = 0;
    } catch {
      /* noch nicht geladen — dann fängt es ohnehin bei 0 an */
    }
    this._starten(neu.a.el);

    neu.gain.gain.cancelScheduledValues(jetzt);
    neu.gain.gain.setValueCurveAtTime(
      blendkurve(neu.gain.gain.value, this._pegel(gebiet)),
      jetzt,
      fade,
    );
  }

  /** Lautstärke eines Gebiets: einheitlich, sofern nichts anderes dasteht. */
  _pegel(gebiet) {
    return this.cfg.pegel?.[gebiet] ?? this.cfg.grundPegel;
  }

  /* ============================================================ Bossmusik */

  /**
   * Eigener Abspieler für den Adlerkampf.
   *
   * NUR EIN ELEMENT, anders als bei den Gebieten. Dort wechseln zwei
   * Abspieler einander ab, weil die Stücke nicht als Schleife komponiert
   * sind und ihr Ende nicht zum Anfang zurückführt. Hier ist der
   * Schleifenpunkt ABSICHTLICH GEWÄHLT (CONFIG…boss.schleifeVon/Bis) und
   * liegt musikalisch passend — ein einfacher Sprung genügt.
   */
  _bossAnlegen() {
    if (this._bossSpieler) return this._bossSpieler;
    const b = this.cfg.boss;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.ziel);

    const el = new Audio();
    el.src = assetUrl(`${this.cfg.ordner}${b.datei}.${this._endung}`);
    el.preload = 'auto';
    // KEIN loop: die Schleife macht update() über die eigenen Punkte.
    el.loop = false;

    const quelle = this.ctx.createMediaElementSource(el);
    quelle.connect(gain);

    this._bossSpieler = { el, gain };
    return this._bossSpieler;
  }

  /** Bosskampf beginnt: Gebietsmusik raus, Bossstück von vorn. */
  bossAn() {
    if (this._bossLaeuft) return;
    this._bossLaeuft = true;

    const b = this.cfg.boss;
    const jetzt = this.ctx.currentTime;

    // Gebietsmusik ausblenden — sie läuft weiter und wird beim Ende des
    // Kampfes wieder aufgedreht. Anhalten würde bedeuten, sie danach neu zu
    // starten, und ein Gebiet soll nicht mitten im Stück von vorn beginnen.
    const gebiet = this._aktuell && this._gebiete.get(this._aktuell);
    if (gebiet) {
      gebiet.gain.gain.cancelScheduledValues(jetzt);
      gebiet.gain.gain.setValueCurveAtTime(
        blendkurve(gebiet.gain.gain.value, 0), jetzt, b.fade,
      );
    }

    const s = this._bossAnlegen();
    try {
      s.el.currentTime = 0;
    } catch {
      /* noch nicht geladen — beginnt ohnehin bei 0 */
    }
    // Das Bossstück läuft in Normaltempo: es hat seinen eigenen Druck, und
    // ein zusätzlich beschleunigtes Stück wäre nur noch Hektik.
    try {
      s.el.preservesPitch = true;
      s.el.playbackRate = 1;
    } catch {
      /* egal */
    }
    this._starten(s.el);

    s.gain.gain.cancelScheduledValues(jetzt);
    s.gain.gain.setValueCurveAtTime(blendkurve(s.gain.gain.value, b.pegel), jetzt, b.fade);
  }

  /** Kampf vorbei: Bossstück raus, Gebietsmusik zurück. */
  bossAus() {
    if (!this._bossLaeuft) return;
    this._bossLaeuft = false;

    const b = this.cfg.boss;
    const jetzt = this.ctx.currentTime;
    const s = this._bossSpieler;

    if (s) {
      s.gain.gain.cancelScheduledValues(jetzt);
      s.gain.gain.setValueCurveAtTime(blendkurve(s.gain.gain.value, 0), jetzt, b.fade);
      clearTimeout(this._bossUhr);
      this._bossUhr = setTimeout(() => {
        if (this._bossLaeuft) return; // inzwischen wieder angefangen
        try {
          s.el.pause();
          s.el.currentTime = 0;
        } catch {
          /* egal */
        }
      }, b.fade * 1000 + 120);
    }

    const gebiet = this._aktuell && this._gebiete.get(this._aktuell);
    if (gebiet) {
      gebiet.gain.gain.cancelScheduledValues(jetzt);
      gebiet.gain.gain.setValueCurveAtTime(
        blendkurve(gebiet.gain.gain.value, this._pegel(this._aktuell)), jetzt, b.fade,
      );
    }
  }

  get bossLaeuft() {
    return this._bossLaeuft === true;
  }

  /** Schleifenpunkt des Bossstücks. Wird aus update() mitgeprüft. */
  _bossSchleife() {
    if (!this._bossLaeuft) return;
    const s = this._bossSpieler;
    if (!s || s.el.paused) return;
    const b = this.cfg.boss;
    if (s.el.currentTime >= b.schleifeBis) {
      try {
        s.el.currentTime = b.schleifeVon;
      } catch {
        /* egal */
      }
    }
  }

  /* ================================================================ Tempo */

  /**
   * Setzt das Abspieltempo EINES Elements.
   *
   * `preservesPitch` ist der ganze Punkt: ohne das steigt mit dem Tempo auch
   * die Tonhöhe, und das letzte Gebiet klänge wie ein zu schnell laufendes
   * Tonband. Die beiden Schreibweisen mit Präfix sind für ältere Safari- und
   * Firefox-Fassungen; wo es keine davon gibt, wird die Musik eben etwas
   * höher — das ist der harmlosere Ausfall gegenüber gar keinem Tempo.
   */
  _tempoAnwenden(el) {
    try {
      el.preservesPitch = true;
      el.mozPreservesPitch = true;
      el.webkitPreservesPitch = true;
      el.playbackRate = this._tempo;
    } catch {
      /* Ein Browser, der die Rate nicht mag, spielt eben in Normaltempo. */
    }
  }

  /**
   * Neues Abspieltempo, sanft angefahren.
   *
   * Ein Sprung mitten im Takt ist deutlich hörbar. Deshalb wird über
   * `tempoFade` Sekunden hinweg geschoben — das fällt mit der ohnehin
   * laufenden Wechselblende zusammen und bleibt dadurch unbemerkt.
   *
   * `playbackRate` kennt keine Automation wie ein AudioParam (es gehört dem
   * Medienelement, nicht dem Audiographen), deshalb hier von Hand in
   * Schritten statt über setValueCurveAtTime.
   *
   * @param {number} faktor 1 = Originaltempo
   */
  tempo(faktor) {
    const ziel = Math.max(0.5, Math.min(this.cfg.tempoMax ?? 2, faktor));
    if (Math.abs(ziel - this._tempo) < 0.001) return;

    clearInterval(this._tempoUhr);
    const von = this._tempo;
    const dauer = (this.cfg.tempoFade ?? 2) * 1000;
    const takt = 50;
    let t = 0;

    this._tempoUhr = setInterval(() => {
      t += takt;
      const anteil = Math.min(1, t / dauer);
      this._tempo = von + (ziel - von) * anteil;
      for (const e of this._gebiete.values()) {
        for (const s of [e.a, e.b]) this._tempoAnwenden(s.el);
      }
      if (anteil >= 1) {
        clearInterval(this._tempoUhr);
        this._tempoUhr = 0;
      }
    }, takt);
  }

  /** Zurück auf Originaltempo — ohne Blende, für den Rundenstart. */
  tempoZuruecksetzen() {
    clearInterval(this._tempoUhr);
    this._tempoUhr = 0;
    this._tempo = 1;
    for (const e of this._gebiete.values()) {
      for (const s of [e.a, e.b]) this._tempoAnwenden(s.el);
    }
  }

  _starten(el) {
    const p = el.play();
    if (!p?.catch) return;
    /* EIN ABGELEHNTES play() MUSS GEMERKT WERDEN.
     *
     * Hier stand nur `p.catch(() => {})`. Der Haken: `spiele()` setzt
     * `_aktuell` VOR dem Abspielversuch, und ihre erste Zeile ist
     * `if (this._aktuell === gebiet) return`. Ein abgelehntes play() liess das
     * Gebiet damit die ganze Sitzung stumm — ohne Fehlermeldung. Auf iOS ist
     * die Ablehnung der Normalfall, weil Gebietswechsel aus der Spielschleife
     * kommen und nicht aus einem Tipp.
     *
     * Gemerkt wird es in `_schuldig`; `nachholen()` versucht es bei der
     * nächsten echten Eingabe erneut. */
    p.catch(() => {
      this._schuldig.add(el);
    });
  }

  /**
   * Schaltet alle Abspieler frei und holt Abgelehntes nach.
   *
   * MUSS AUS EINER ECHTEN NUTZEREINGABE KOMMEN. Safari verlangt die Geste
   * PRO ELEMENT, nicht einmal pro Seite — deshalb bekommt hier jedes
   * angelegte Element ein play()/pause()-Paar. Ohne das lief auf dem iPhone
   * das erste Stück einmal durch und danach war Ruhe: der zweite Abspieler
   * (für den Schleifenpunkt) hat sein erstes play() erst nach zweieinhalb
   * Minuten bekommen, fern jeder Geste.
   */
  freischalten() {
    /* Der Bossabspieler MUSS mit freigeschaltet werden. Safari verlangt die
     * Nutzergeste pro <audio>-Element, und dieses hier bekommt sein erstes
     * play() erst mitten im Spiel, wenn der Adler kommt — fern jeder Geste.
     * Ohne diese Zeile bliebe der Bosskampf auf dem iPhone stumm.
     *
     * Angelegt wird er dafür schon jetzt, nicht erst beim ersten Kampf. */
    if (this.cfg.boss) {
      const s = this._bossAnlegen();
      if (!this._freigeschaltet.has(s.el) && s.el.paused) {
        const p = s.el.play();
        if (p?.then) {
          p.then(() => {
            s.el.pause();
            try {
              s.el.currentTime = 0;
            } catch {
              /* egal */
            }
            this._freigeschaltet.add(s.el);
          }).catch(() => {
            /* noch nicht erlaubt — nächste Eingabe versucht es wieder */
          });
        }
      }
    }

    for (const e of this._gebiete.values()) {
      for (const s of [e.a, e.b]) {
        if (s === e.aktiv) continue; // der läuft schon
        if (this._freigeschaltet.has(s.el)) continue;
        const p = s.el.play();
        if (p?.then) {
          p.then(() => {
            s.el.pause();
            try {
              s.el.currentTime = 0;
            } catch {
              /* egal */
            }
            this._freigeschaltet.add(s.el);
          }).catch(() => {
            /* noch nicht erlaubt — nächste Eingabe versucht es wieder */
          });
        } else {
          s.el.pause();
          this._freigeschaltet.add(s.el);
        }
      }
    }

    // Was vorhin abgelehnt wurde, jetzt nachholen.
    for (const el of [...this._schuldig]) {
      const p = el.play();
      if (p?.then) p.then(() => this._schuldig.delete(el)).catch(() => {});
      else this._schuldig.delete(el);
    }
  }

  /**
   * Muss jeden Frame laufen. Kümmert sich um den Schleifenpunkt: kurz vor
   * dem Ende startet der zweite Abspieler von vorn, und beide werden
   * ineinander geblendet.
   */
  update() {
    // Der Schleifenpunkt des Bossstücks — läuft unabhängig vom Gebiet.
    this._bossSchleife();

    if (!this._aktuell) return;
    const e = this._gebiete.get(this._aktuell);
    if (!e?.aktiv) return;

    const laufend = e.aktiv;
    const dauer = laufend.el.duration;
    if (!Number.isFinite(dauer) || dauer <= 0) return; // noch nicht geladen

    /* Die Restzeit muss in ECHTEN Sekunden gerechnet werden, nicht in
     * Stückzeit. `currentTime` und `duration` laufen in der Zeitachse des
     * Stücks; bei Tempo 1.35 vergeht davon pro echter Sekunde das 1.35-fache.
     * Ohne die Division setzte die Blende bei schneller Musik zu spät ein und
     * würde vom Ende abgeschnitten — genau an dem Bruch, den sie kaschieren
     * soll. */
    const tempo = laufend.el.playbackRate || 1;
    const fade = Math.min(this.cfg.schleifeFade, dauer / tempo / 3);
    const rest = (dauer - laufend.el.currentTime) / tempo;
    if (rest > fade) return;

    // Umschalten auf den anderen Abspieler.
    const anderer = laufend === e.a ? e.b : e.a;
    if (!anderer.el.paused && anderer.el.currentTime > 0.05) return; // läuft schon

    const jetzt = this.ctx.currentTime;
    try {
      anderer.el.currentTime = 0;
    } catch {
      /* egal */
    }
    this._starten(anderer.el);

    anderer.eigen.gain.cancelScheduledValues(jetzt);
    anderer.eigen.gain.setValueCurveAtTime(blendkurve(0, 1), jetzt, fade);

    laufend.eigen.gain.cancelScheduledValues(jetzt);
    laufend.eigen.gain.setValueCurveAtTime(blendkurve(laufend.eigen.gain.value, 0), jetzt, fade);

    e.aktiv = anderer;

    // Den ausgelaufenen Abspieler anhalten, sobald er still ist.
    setTimeout(
      () => {
        if (e.aktiv !== laufend) {
          try {
            laufend.el.pause();
            laufend.el.currentTime = 0;
          } catch {
            /* egal */
          }
        }
      },
      fade * 1000 + 120,
    );
  }

  /** Alles aus — im Hauptmenü nach einem Lauf. */
  aus() {
    const jetzt = this.ctx.currentTime;
    for (const e of this._gebiete.values()) {
      e.gain.gain.cancelScheduledValues(jetzt);
      e.gain.gain.setValueCurveAtTime(
        blendkurve(e.gain.gain.value, 0),
        jetzt,
        this.cfg.wechselFade,
      );
      clearTimeout(e.uhr);
      e.uhr = setTimeout(() => {
        for (const s of [e.a, e.b]) {
          try {
            s.el.pause();
            s.el.currentTime = 0;
          } catch {
            /* egal */
          }
        }
        e.aktiv = null;
      }, this.cfg.wechselFade * 1000 + 120);
    }
    this._aktuell = null;
  }

  /** Welches Gebiet gerade läuft (für Prüfungen und die Fehlersuche). */
  get aktuell() {
    return this._aktuell;
  }
}
