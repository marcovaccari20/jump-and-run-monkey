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
    this._endung = this._formatWaehlen();
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

  _starten(el) {
    const p = el.play();
    // Browser lehnen `play()` ohne Nutzergeste ab; das ist erwartbar und
    // kein Fehler — der nächste Aufruf nach der ersten Eingabe zieht.
    if (p?.catch) p.catch(() => {});
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

    const fade = Math.min(this.cfg.schleifeFade, dauer / 3);
    const rest = dauer - laufend.el.currentTime;
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
