/**
 * Der garantierte Weg durch die fallenden Objekte.
 *
 * WARUM ES DEN KORRIDOR GIBT
 * "Pro Welle eine Lücke lassen" klingt richtig, reicht aber nicht. Gemessen
 * (scripts/fairness.mjs) starb der Affe regelmässig, obwohl im Bild 5 Einheiten
 * Platz waren — nur eben nicht dort, wo er noch hinkam. Er war schon
 * eingesperrt, bevor die tödliche Welle überhaupt fiel.
 *
 * Eine faire Lücke muss deshalb zwei Dinge sein: frei UND erreichbar. Beides
 * zusammen ist kein Zustand, sondern ein Weg — eine durchgehende Bahn durch
 * Raum und Zeit. Genau das ist der Korridor.
 *
 * WIE ER FUNKTIONIERT
 * Der Korridor ist eine Kurve x(t): wo die freie Bahn zum Zeitpunkt t liegt.
 * Er ist als Streckenzug gespeichert und reicht bewusst in die ZUKUNFT — denn
 * ein Objekt wird jetzt abgeworfen, kommt beim Affen aber erst in ein bis drei
 * Sekunden an. Der Spawner fragt deshalb nicht "wo ist der Korridor jetzt",
 * sondern "wo wird er sein, während dieses Objekt den Affen passiert".
 *
 * Damit ist die Garantie eine Rechnung und keine Hoffnung:
 *   - Objekte fallen senkrecht, ihr x ändert sich nie.
 *   - Also steht beim Abwurf fest, wo ein Objekt den Affen passieren wird.
 *   - Wird es ausserhalb der Korridor-Spanne dieses Zeitfensters gesetzt,
 *     kann es den Korridor nicht verstellen. Für kein Objekt, nie.
 *   - Der Korridor bewegt sich langsamer als der Affe laufen kann. Also ist
 *     er ihm auch folgen kann.
 *
 * WAS DER SPIELER DAVON SIEHT: nichts. Der Korridor ist unsichtbar und nicht
 * die einzige Lücke — zwischen den Objekten ausserhalb entstehen weitere.
 * Er ist die Zusicherung, dass es IMMER einen Weg gibt, nicht der einzige Weg.
 * (Mit F1 wird er als Band eingeblendet.)
 */

export class Korridor {
  /**
   * @param {typeof import('../config.js').CONFIG.rock.korridor} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;

    /* Streckenzug als Ringpuffer. Feste Grösse, damit im Frame-Loop nichts
     * allokiert wird. Zwischen zwei Stützstellen wird linear interpoliert. */
    const n = cfg.stuetzstellen ?? 96;
    this._t = new Float64Array(n);
    this._x = new Float64Array(n);
    this._kopf = 0; // Index der ältesten gültigen Stützstelle
    this._anzahl = 0;

    this.jetzt = 0;
    // Wechselt zwischen Wandern und Verweilen — sonst wäre die Bahn ein
    // gleichmässiges Hin und Her, das man nach zwei Minuten auswendig kann.
    this._wandert = true;
  }

  /** @param {number} x Startposition (dort steht der Affe beim Spielbeginn) */
  reset(x = 0) {
    this.jetzt = 0;
    this._kopf = 0;
    this._anzahl = 0;
    this._wandert = true;
    this._anfuegen(0, x);
  }

  _index(i) {
    return (this._kopf + i) % this._t.length;
  }

  _anfuegen(t, x) {
    const n = this._t.length;
    if (this._anzahl === n) {
      // Voll: älteste Stützstelle fällt weg. Passiert nur, wenn der Horizont
      // zu weit für den Puffer gewählt wurde — dann lieber vorne abschneiden
      // als hinten nicht weiterbauen zu können.
      this._kopf = (this._kopf + 1) % n;
      this._anzahl--;
    }
    const i = this._index(this._anzahl);
    this._t[i] = t;
    this._x[i] = x;
    this._anzahl++;
  }

  get letzteZeit() {
    return this._anzahl ? this._t[this._index(this._anzahl - 1)] : this.jetzt;
  }

  get letztesX() {
    return this._anzahl ? this._x[this._index(this._anzahl - 1)] : 0;
  }

  /** Position jetzt — nur für Anzeige und Debug. */
  get x() {
    return this.bei(this.jetzt);
  }

  /**
   * Zeit weiterdrehen und die Bahn so weit in die Zukunft verlängern, dass
   * jedes gerade abgeworfene Objekt sein ganzes Zeitfenster darin findet.
   *
   * @param {number} dt
   * @param {number} tempo   Höchstgeschwindigkeit der Bahn (Units/s)
   * @param {number} minX    linke Grenze des Spielfelds
   * @param {number} maxX    rechte Grenze
   * @param {number} horizont wie weit die Bahn im Voraus stehen muss (s)
   */
  update(dt, tempo, minX, maxX, horizont) {
    this.jetzt += dt;
    // Für spaeter merken: `sicherstellen()` und `grenzenAendern()` brauchen
    // dieselben Werte, werden aber vom Spawner gerufen, nicht von hier.
    this._tempo = tempo;
    this._minX = minX;
    this._maxX = maxX;

    // Vergangenes wegwerfen, aber IMMER eine Stützstelle vor `jetzt` behalten
    // — sonst liesse sich der laufende Abschnitt nicht mehr interpolieren.
    while (this._anzahl >= 2 && this._t[this._index(1)] <= this.jetzt) {
      this._kopf = (this._kopf + 1) % this._t.length;
      this._anzahl--;
    }

    if (this._anzahl === 0) this._anfuegen(this.jetzt, 0);

    const ziel = this.jetzt + horizont;
    let schutz = this._t.length; // gegen Endlosschleifen bei Fehlkonfiguration
    while (this.letzteZeit < ziel && schutz-- > 0) {
      this._naechsterAbschnitt(tempo, minX, maxX);
    }
  }

  _naechsterAbschnitt(tempo, minX, maxX) {
    const cfg = this.cfg;
    const t0 = this.letzteZeit;
    const x0 = this.letztesX;

    if (!this._wandert) {
      // Verweilen: gleiche Stelle, nur Zeit vergeht.
      const halt = cfg.haltMin + Math.random() * (cfg.haltMax - cfg.haltMin);
      this._anfuegen(t0 + Math.max(0.02, halt), x0);
      this._wandert = true;
      return;
    }

    /* Wandern: begrenzter Sprung, nie über das Spielfeld hinaus.
     *
     * DIE BAHN ZIEHT ZUM RAND, und das ist der Kern der gleichmässigen
     * Verteilung — auch wenn es zunächst widersinnig klingt.
     *
     * Objekte dürfen nur dort fallen, wo die Bahn NICHT ist. Ein Punkt in
     * der Bildmitte wird von der Sperrzone viel öfter getroffen als einer am
     * Rand: bei ihm liegt die ganze Sperrbreite im erreichbaren Bereich, beim
     * Randpunkt ragt die Hälfte davon ins Nichts. Eine gleichmässig
     * verteilte Bahn erzeugt deshalb eine RANDLASTIGE Objektverteilung —
     * gemessen kam die Bildmitte im Hochformat auf 13 % statt 33 %.
     *
     * Zieht die Bahn dagegen bevorzugt an die Ränder, ist die Mitte öfter
     * frei, und die Objekte verteilen sich. `randSog` steuert das: 0 = wie
     * bisher gleichmässig, 1 = ausschliesslich an die Ränder.
     *
     * Der Sog wirkt auf das ZIEL, nicht auf den Weg — die Bahn bleibt eine
     * durchgehende, langsam wandernde Linie, und die Lückengarantie hängt
     * allein daran, dass sie überhaupt existiert. */
    const spanne = cfg.maxSprung;
    let ziel = x0 + (Math.random() * 2 - 1) * spanne;
    if (ziel < minX) ziel = minX;
    if (ziel > maxX) ziel = maxX;

    const sog = cfg.randSog ?? 0;
    if (sog > 0 && maxX > minX) {
      const mitte = (minX + maxX) / 2;
      const halb = (maxX - minX) / 2;
      // Auf -1..+1 normieren, zum näheren Rand strecken, zurückrechnen.
      const u = (ziel - mitte) / halb;
      const gestreckt = Math.sign(u) * Math.pow(Math.abs(u), 1 - sog);
      ziel = mitte + gestreckt * halb;
      if (ziel < minX) ziel = minX;
      if (ziel > maxX) ziel = maxX;
    }

    const weg = Math.abs(ziel - x0);
    const v = Math.max(0.05, tempo);
    // Kurze Wege bekommen trotzdem eine Mindestdauer, sonst zuckt die Bahn.
    const dauer = Math.max(cfg.haltMin, weg / v);
    this._anfuegen(t0 + dauer, ziel);
    this._wandert = false;
  }

  /**
   * Stellt sicher, dass die Bahn mindestens bis `zielZeit` feststeht.
   *
   * WARUM DAS NICHT DER FESTE HORIZONT ERLEDIGT
   * Ein fester Vorlauf ist eine Wette darauf, wie langsam das langsamste
   * Objekt fällt. Nachgerechnet: an der Aschewand (Fallfaktor 0.64) braucht
   * ein grosser Brocken bei Anfangstempo 4.76 s, um aus dem Bild zu fallen —
   * der Vorlauf betrug 3.8 s. Dann liefert `bei(t)` still den LETZTEN
   * bekannten Wert, das Objekt wird gegen eine Bahn gesetzt, die noch gar
   * nicht entschieden ist, und die Bahn kann später in es hineinwandern.
   * Nichts stürzt ab, nichts warnt — die Garantie ist einfach weg.
   *
   * Heute fällt das nicht auf, weil Asche zufällig die 13. Wand ist und dort
   * schnell genug gefallen wird. Wer die Reihenfolge in CONFIG.wall.stages
   * umsortiert, zerstört die Zusicherung lautlos.
   *
   * Deshalb sagt der Spawner, wie weit er braucht, statt zu hoffen.
   */
  sicherstellen(zielZeit) {
    let schutz = this._t.length;
    while (this.letzteZeit < zielZeit && schutz-- > 0) {
      this._naechsterAbschnitt(this._tempo ?? 1, this._minX ?? -1, this._maxX ?? 1);
    }
    // Reicht der Puffer nicht bis dahin, ist die Zusicherung nicht mehr
    // gedeckt. Lieber laut als lautlos.
    return this.letzteZeit >= zielZeit;
  }

  /**
   * Neue Spielfeldgrenzen: die bereits geplante Zukunft mit hereinziehen.
   *
   * Die Bahn wird beim Erzeugen an die damaligen Grenzen geklemmt, danach
   * steht sie fest. Ändert sich das Feld — Handy drehen, aber auch **jeder
   * Charakterwechsel**, weil die Grenzen am Trefferradius hängen —, läge die
   * garantierte Bahn ausserhalb des Bandes, in dem der Affe sich überhaupt
   * bewegen darf. Die Zusicherung zeigte dann auf einen Ort, den es nicht
   * gibt.
   *
   * Nach innen klemmen ist dabei sicher: die neue Spanne ist eine Teilmenge
   * der alten, die Sperrzonen schrumpfen also. Objekte, die bereits nach der
   * alten Bahn platziert wurden, liegen weiterhin ausserhalb.
   */
  grenzenAendern(minX, maxX) {
    this._minX = minX;
    this._maxX = maxX;
    for (let k = 0; k < this._anzahl; k++) {
      const i = this._index(k);
      if (this._x[i] < minX) this._x[i] = minX;
      else if (this._x[i] > maxX) this._x[i] = maxX;
    }
  }

  /** Position der Bahn zum Zeitpunkt t (ausserhalb: erster/letzter Wert). */
  bei(t) {
    if (this._anzahl === 0) return 0;
    if (t <= this._t[this._index(0)]) return this._x[this._index(0)];
    const letzter = this._index(this._anzahl - 1);
    if (t >= this._t[letzter]) return this._x[letzter];

    for (let k = 1; k < this._anzahl; k++) {
      const i = this._index(k);
      if (this._t[i] >= t) {
        const j = this._index(k - 1);
        const spanne = this._t[i] - this._t[j];
        if (spanne <= 1e-9) return this._x[i];
        const f = (t - this._t[j]) / spanne;
        return this._x[j] + (this._x[i] - this._x[j]) * f;
      }
    }
    return this._x[letzter];
  }

  /**
   * Kleinster und grösster Wert der Bahn im Zeitfenster [t1, t2].
   *
   * DAS IST DIE ENTSCHEIDENDE FUNKTION. Ein Objekt ist nicht nur in einem
   * Moment gefährlich, sondern während der ganzen Zeit, in der es das
   * Bewegungsband des Affen durchquert. Es muss deshalb der Bahn über dieses
   * ganze Fenster ausweichen, nicht bloss ihrer Position zu einem Zeitpunkt.
   *
   * Weil die Bahn stückweise linear ist, liegen Minimum und Maximum immer auf
   * Stützstellen oder auf den Fensterrändern — mehr ist nicht zu prüfen.
   *
   * @param {number} t1
   * @param {number} t2
   * @param {{min:number, max:number}} aus wiederverwendetes Zielobjekt
   */
  spanne(t1, t2, aus) {
    const a = this.bei(t1);
    const b = this.bei(t2);
    let min = a < b ? a : b;
    let max = a > b ? a : b;

    for (let k = 0; k < this._anzahl; k++) {
      const i = this._index(k);
      const t = this._t[i];
      if (t <= t1) continue;
      if (t >= t2) break;
      const x = this._x[i];
      if (x < min) min = x;
      if (x > max) max = x;
    }

    aus.min = min;
    aus.max = max;
    return aus;
  }
}
