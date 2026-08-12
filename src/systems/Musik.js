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
