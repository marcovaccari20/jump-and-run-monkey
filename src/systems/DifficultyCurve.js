/**
 * Schwierigkeit.
 *
 * DIE WAND IST DIE SCHWIERIGKEIT.
 *
 * Vorher liefen drei unabhängige Geraden über die Spielzeit, und der
 * Hintergrundwechsel fiel nur zufällig mit ihnen zusammen — man musste die
 * Sekundenzahlen von Hand synchron halten, und ab dem Deckel passierte gar
 * nichts mehr. Jetzt ist es umgekehrt: es gibt EINE Grösse, die Härte, und
 * die hängt am Wandindex. Jede Wand multipliziert sie mit `proWand`.
 *
 *      haerte(t) = proWand ^ (t / sekundenProWand)
 *
 * Bei proWand = 1.25 ist jede Wand ein Viertel schwerer als die davor. Der
 * Wandwechsel ist damit kein Anstrich mehr, sondern die Ansage.
 *
 * WORAUF SICH DIE HÄRTE VERTEILT
 * Zwei Stellschrauben, und ihre Exponenten summieren sich auf 1 — sonst
 * bedeutete "25 % mehr Härte" nicht 25 % mehr Druck:
 *
 *      tempo  ~ haerte^tempoExponent      wie schnell die Objekte fallen
 *      dichte ~ haerte^dichteExponent     wie viele pro Sekunde kommen
 *
 * Das TEMPO ist gedeckelt, die DICHTE nicht. Der Grund ist das
 * Reaktionsfenster: ein Objekt wird bei y≈5.05 sichtbar und wird beim Affen
 * auf Normalhöhe ab y≈-0.35 gefährlich, das sind 5.4 Einheiten Vorwarnung.
 * Bei Tempo 12 bleiben davon 0.45 s. Schneller wäre nicht schwerer, sondern
 * nur noch Glückssache. Voller wird es trotzdem — die freie Bahn
 * (src/systems/Korridor.js) sorgt dafür, dass "voll" nie "dicht" heisst.
 *
 * Alle Zahlen stehen in CONFIG.difficulty. Hier steht keine.
 */

export class DifficultyCurve {
  /**
   * @param {typeof import('../config.js').CONFIG.difficulty} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.elapsed = 0;

    // Mischung der Objektarten (CONFIG.rock.mix) — wird von aussen gesetzt,
    // weil sie nicht zur Difficulty-Config gehört, aber derselben Achse folgt.
    this.rockMix = null;

    /* DIE GEBIETSGRENZEN — hier steckt die eigentliche Steigerung.
     *
     * VORHER lief die Härte an einer festen Uhr: `elapsed / sekundenProWand`
     * mit sekundenProWand = 132. Die Gebiete dauern aber 37 bis 87 Sekunden.
     * Ein Gebietswechsel und ein Härteschritt hatten deshalb nichts
     * miteinander zu tun — mal fielen zwei Gebiete in einen Schritt, mal lag
     * der Schritt mitten in einem Gebiet. Gespielt fühlt sich das an, als
     * bliebe alles gleich und nur die Tapete wechsle.
     *
     * JETZT ist der Wandindex der ECHTE Gebietsindex (siehe `wand`). Damit
     * ist `proWand` wörtlich zu nehmen: jedes Gebiet ist um diesen Faktor
     * schwerer als das davor, und der Wechsel ist die Ansage.
     *
     * Die Liste hängt an CONFIG.difficulty und wird am Ende von config.js
     * aus CONFIG.wall.stages gefüllt — nicht hier importiert, sonst hinge
     * die Kurve an der ganzen Konfiguration statt nur an ihrem eigenen
     * Abschnitt. Fehlt sie, gilt die alte feste Uhr; damit laufen Werkzeuge
     * weiter, die die Kurve mit einer selbstgebauten Config bauen. */
    this.grenzen = cfg.gebietsGrenzen?.length ? cfg.gebietsGrenzen : null;
  }

  /** @param {Array<{abWand:number, weights:number[]}>} mix */
  setRockMix(mix) {
    this.rockMix = mix ? [...mix].sort((a, b) => b.abWand - a.abWand) : null;
  }

  reset() {
    this.elapsed = 0;
  }

  update(dt) {
    this.elapsed += dt;
  }

  /* ------------------------------------------------------------ Grundmass */

  /**
   * Wandindex als KONTINUIERLICHE Zahl (2.5 = Mitte der dritten Wand).
   *
   * Kontinuierlich und nicht ganzzahlig, damit die Schwierigkeit beim
   * Wandwechsel nicht springt. Der Sprung wäre spürbar unfair: man stünde
   * mitten in einer Welle, die plötzlich nach anderen Regeln fällt.
   */
  get wand() {
    const g = this.grenzen;
    if (!g) return this.elapsed / this.cfg.sekundenProWand;

    const t = this.elapsed;
    // Vor dem ersten Wechsel: linear vom Start in Gebiet 1 hinein.
    if (t <= g[0]) return 0;
    for (let i = 1; i < g.length; i++) {
      if (t < g[i]) {
        const spanne = g[i] - g[i - 1];
        return i - 1 + (spanne > 0 ? (t - g[i - 1]) / spanne : 0);
      }
    }
    /* HINTER DEM LETZTEN GEBIET geht es weiter, nicht zu Ende.
     *
     * Die Wände wiederholen sich ab hier (CONFIG.wall.stageLoopSeconds), das
     * Spiel aber soll schwerer werden statt stehenzubleiben — sonst hätte
     * ein sehr guter Spieler ab dem letzten Gebiet ewig Zeit. Weitergezählt
     * wird mit der Länge des LETZTEN Gebiets als Taktmass. */
    const letzte = g.length - 1;
    const takt = letzte > 0 ? g[letzte] - g[letzte - 1] : this.cfg.sekundenProWand;
    return letzte + (t - g[letzte]) / (takt > 0 ? takt : this.cfg.sekundenProWand);
  }

  /** Gesamtdruck. Jede Wand multipliziert ihn mit `proWand`. */
  get haerte() {
    return Math.pow(this.cfg.proWand, this.wand);
  }

  /* ------------------------------------------------------------- Tempo */

  /** Gesamtes Bildschirmtempo der Objekte (Scroll + Eigengeschwindigkeit). */
  get tempo() {
    const t = this.cfg.tempo;
    return Math.min(t.max, t.start * Math.pow(this.haerte, this.cfg.tempoExponent));
  }

  /**
   * Scrollgeschwindigkeit der Wand — und damit die Punkte pro Sekunde.
   *
   * Ein fester Anteil am Tempo statt einer eigenen Kurve: sonst driften
   * Bildgeschwindigkeit und Objektgeschwindigkeit auseinander, und die Wand
   * scheint sich unter den Objekten wegzuziehen.
   */
  get scrollSpeed() {
    return this.tempo * this.cfg.tempo.scrollAnteil;
  }

  /** Eigengeschwindigkeit der Objekte (ZUSÄTZLICH zum Scroll). */
  get rockFallSpeed() {
    return this.tempo * (1 - this.cfg.tempo.scrollAnteil);
  }

  /* ------------------------------------------------------------ Dichte */

  /**
   * Mindestabstand zwischen zwei ANKÜNFTEN beim Affen, in Sekunden.
   *
   * Umgerechnet aus einem Abstand in Welt-Einheiten: zwei Objekte sollen
   * immer mindestens `mindestAbstand` Fallstrecke auseinander sein. Bei
   * höherem Tempo wird daraus weniger Zeit, aber der ABSTAND IM BILD bleibt
   * gleich — und darauf kommt es an. Es sollen nie zwei Objekte
   * übereinanderliegen, sondern immer eines nach dem anderen kommen.
   */
  get mindestZeit() {
    return this.cfg.dichte.mindestAbstand / this.tempo;
  }

  /**
   * Objekte pro Sekunde.
   *
   * NICHT als eigene Potenz gerechnet, sondern als das, was zum Zieldruck
   * noch fehlt:
   *
   *      druck  = tempo * dichte     soll sich je Wand mit proWand multiplizieren
   *      dichte = druck / tempo
   *
   * Solange das Tempo mitwächst, ergibt das die gewünschte Aufteilung; hängt
   * es am Deckel, übernimmt die Dichte den ganzen Zuwachs.
   *
   * ABER: gedeckelt durch den Mindestabstand. Mehr als `1/mindestZeit`
   * Objekte pro Sekunde wären eine lückenlose Kette — und genau das soll es
   * nicht geben. `auslastung` lässt zusätzlich Luft, damit der Strom
   * unregelmässig bleibt und nicht wie ein Metronom tickt.
   */
  get dichte() {
    const zielDruck = this.cfg.tempo.start * this.cfg.dichte.start * this.haerte;
    const gewuenscht = zielDruck / this.tempo;
    const deckel = this.cfg.dichte.auslastung / this.mindestZeit;
    return Math.min(gewuenscht, deckel);
  }

  /** Sekunden bis zum nächsten Abwurf (es kommt immer genau eines). */
  get spawnDelay() {
    return Math.max(this.mindestZeit, 1 / this.dichte);
  }

  /**
   * Ab hier wird nichts mehr schwerer, weil beides am Anschlag ist.
   * Nur für die Anzeige und `npm run balance` — damit sichtbar ist, wo das
   * Spiel sein Maximum erreicht, statt dass man es erraten muss.
   */
  get amAnschlag() {
    const zielDruck = this.cfg.tempo.start * this.cfg.dichte.start * this.haerte;
    return zielDruck / this.tempo > this.cfg.dichte.auslastung / this.mindestZeit;
  }

  /* ------------------------------------------------------------ Mischung */

  /** Aktuelle Gewichte der Objektarten, oder null. */
  get rockWeights() {
    if (!this.rockMix) return null;
    const w = this.wand;
    for (const step of this.rockMix) {
      if (w >= step.abWand) return step.weights;
    }
    return this.rockMix[this.rockMix.length - 1]?.weights ?? null;
  }

  /* -------------------------------------------------------------- Anzeige */

  /** 0..1 — Anteil des Weges bis zum Tempodeckel (nur für die Anzeige). */
  get progress() {
    const t = this.cfg.tempo;
    if (t.max <= t.start) return 1;
    return Math.min(1, (this.tempo - t.start) / (t.max - t.start));
  }

  /**
   * Vorwarnzeit in Sekunden: wie lange ein Objekt vom Sichtbarwerden bis zum
   * Gefährlichwerden braucht. Die Zahl, an der sich entscheidet, ob das Spiel
   * noch fair ist — deshalb im Debug-Overlay (F1) sichtbar.
   *
   * @param {number} spielerY  Höhe des Affen
   * @param {number} randRadius Spieler- plus Objektradius
   */
  vorwarnung(spielerY = -1.4, randRadius = 1.06) {
    const sichtbarAb = 5.05; // Oberkante der Wandebene im Bild
    const gefaehrlichAb = spielerY + randRadius;
    return Math.max(0, (sichtbarAb - gefaehrlichAb) / this.tempo);
  }
}
