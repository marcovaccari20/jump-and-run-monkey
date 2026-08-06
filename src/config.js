/**
 * ZENTRALE KONFIGURATION — alle Balancing-Werte an einem Ort.
 *
 * Faustregeln:
 *   - Weltmasse sind "Units". 1 Unit == 1 Höhenmeter im Score.
 *   - Alle Geschwindigkeiten sind Units pro SEKUNDE (nie pro Frame).
 *   - Alle Zeiten sind Sekunden.
 *
 * Die Schwierigkeit hängt an der WAND, nicht an der Uhr:
 *      haerte = proWand ^ (Spielzeit / sekundenProWand)
 * Jede Wand ist ein Viertel schwerer als die davor. Siehe
 * src/systems/DifficultyCurve.js und `npm run balance` für die Tabelle.
 */

export const CONFIG = {
  /* ================================================================== *
   *  RENDERING / KAMERA
   * ================================================================== */
  render: {
    // Kamera steht fest. Sie schaut leicht von oben/hinten auf die Wand.
    // Die Wand liegt in der XY-Ebene bei z = 0, die Kamera davor bei +z.
    camera: {
      fov: 46,
      near: 0.1,
      far: 120,
      position: [0, 1.9, 11.5], // leicht oberhalb der Wandmitte
      lookAt: [0, 0.35, 0], //    Blick leicht nach unten auf die Wand
    },
    // Renderer
    antialias: true,
    maxPixelRatio: 2, // auf Retina/Mobile nicht über 2 gehen (Performance)
    clearColor: 0x0a1a0d, // dunkles Dschungelgrün, falls mal eine Lücke sichtbar wird
    // Beleuchtung: warmes Licht von schräg oben, grünes Füll-Licht von unten.
    // Das Ambient ist bewusst nur leicht grün — bei kräftigem Grün färbt sich
    // das Affenfell mit ein und die Figur verschwindet vor der Wand.
    lights: {
      ambient: { color: 0x9db393, intensity: 1.25 },
      key: { color: 0xfff0bd, intensity: 2.75, position: [4.5, 8, 7] },
      fill: { color: 0x4f9059, intensity: 0.7, position: [-5, -4, 5] },
    },
  },

  /* ================================================================== *
   *  SPIELFELD
   * ================================================================== */
  world: {
    // Bewegungsgrenzen des Affen in der Wandebene (Units, relativ zur Bildmitte).
    bounds: { minX: -4.6, maxX: 4.6, minY: -2.9, maxY: 2.7 },
    // Höhe, auf der Steine/Bananen erzeugt werden.
    // MUSS über der sichtbaren Oberkante liegen, und zwar mindestens um den
    // grössten Steinradius (0.62): sonst ploppt der Stein sichtbar ins Bild,
    // statt hereinzufallen. Die Oberkante liegt in der Wandebene bei y = 5.05
    // (unabhängig vom Seitenverhältnis, da das Sichtfeld vertikal definiert
    // ist) — 6.0 lässt genug Luft.
    spawnY: 6.0,
    // Unterhalb dieser Höhe werden Entities wieder in den Pool zurückgegeben.
    despawnY: -5.6,
    // Breite, über die Spawns horizontal verteilt werden.
    spawnHalfWidth: 5.0,
  },

  /* ================================================================== *
   *  SPIELER
   * ================================================================== */
  player: {
    /* Spielfigur: gezeichnetes Sprite oder das 3D-Modell.
     *
     *   'sprite'  Frame-Animation aus dem Bewegungsvideo
     *             (public/textures/move_00.webp …, siehe SpritePlayer)
     *   'model'   public/models/monkey.glb — das gerigte Makaken-Modell mit
     *             den 17 Clips und der clipMap (siehe README)
     *
     * Umschalten kostet nur diese eine Zeile; beide Pfade sind vollständig
     * implementiert. Im Sprite-Modus wird das GLB gar nicht erst geladen.
     */
    mode: 'sprite',

    // Zielhöhe des Affen in World-Units. Der tatsächliche Skalierungsfaktor
    // wird beim Laden aus der Bounding-Box berechnet — das Modell darf also
    // in beliebigen Quelleinheiten (cm/m) vorliegen.
    modelHeight: 1.5,
    // Höhe des Sprites in World-Units (sichtbare Bildhöhe ist ca. 10).
    spriteHeight: 2.5,
    startPosition: [0, -1.4, 0],

    // Horizontale/vertikale Bewegungsgeschwindigkeit in der Wandebene.
    moveSpeed: 8.4,
    // Glättungsraten in 1/s (nicht Beschleunigung im physikalischen Sinn):
    // v nähert sich dem Zielwert mit 1 - e^(-rate * dt).
    // Höher = direkter. acceleration gilt bei gedrückter Taste, damping beim Loslassen.
    acceleration: 30.0,
    damping: 20.0,
    // Unterhalb dieser Geschwindigkeit gilt der Affe als stehend (climbIdle).
    idleThreshold: 0.55,

    // Klettern: Vertikal-Input zahlt zusätzlich auf die Scrollgeschwindigkeit ein,
    // damit sich "W" wie echtes Steigen anfühlt und nicht nur wie Ausweichen.
    // Auf 0 setzen => reines Auto-Scrolling, W/S bewegen nur innerhalb des Bildes.
    climbAssist: 1.0,
    // Selbst bei vollem "S" bleibt dieser Anteil der Grundscrollgeschwindigkeit
    // erhalten — der Affe kann den Aufstieg also bremsen, aber nie ganz stoppen.
    minScrollFactor: 0.35,

    // Kollisionskreis in der Wandebene (Units). Bewusst kleiner als das Modell:
    // wohlwollende Hitbox fühlt sich fairer an ("coyote hitbox").
    hitRadius: 0.42,
    // Die Modellwurzel liegt im Körpermittelpunkt (siehe Player._measureRestPose),
    // der Kreis sitzt also bereits richtig — hier nur noch Feinkorrektur.
    hitOffsetY: 0.0,

    // Zusätzliche Neigung in Bewegungsrichtung (Grad) — rein kosmetisch, gibt
    // Gewicht. Kommt ZUSÄTZLICH zum rollDeg der clipMap, deshalb dezent halten:
    // beide zusammen dürfen den Affen nicht kippen lassen.
    leanPerSpeed: 2.2,
    maxLean: 14,
    leanSmoothing: 9.0,
  },

  /* ================================================================== *
   *  CHARAKTERE
   *
   *  Drei Affen zur Auswahl. BRAUN ist die Referenz und wiederholt die
   *  Werte aus CONFIG.player oben WÖRTLICH — wer dort etwas ändert, muss
   *  es hier mitziehen. Bewusst absolute Zahlen statt Faktoren: so steht
   *  in einer Zeile, was der Affe wirklich kann, und das Zusammenführen
   *  ist ein simpler Spread. Der Faktor gegenüber Braun steht daneben.
   *
   *  Zusammengeführt wird zur Laufzeit in Game._buildPlayer():
   *    player : { ...CONFIG.player, ...c.player }
   *    revive : { ...CONFIG.revive, maxStored: c.maxStored }
   *    sprite : { ...CONFIG.sprite, framePath, cycleSpeed, outline }
   *
   *  WICHTIG: niemals CONFIG.player selbst überschreiben. Game reicht die
   *  Objekte als Referenz an die Spielfigur weiter (SpritePlayer hält sie
   *  fest) — eine Mutation würde die braunen Referenzwerte dauerhaft
   *  zerstören, auch nach dem Zurückwechseln.
   * ================================================================== */
  /* ================================================================== *
   *  FELLFARBEN (SKINS)
   *
   *  Rein kosmetisch, gilt für JEDEN Affen. Es gibt dafür KEINE eigenen
   *  Bilddateien: die geladenen Frames werden beim Anlegen einmal durch ein
   *  Canvas mit CSS-Filter geschickt und als neue Texturen weiterverwendet.
   *  Ein Skin kostet damit null Byte Download und null Zeichenarbeit.
   *
   *  WARUM CANVAS UND NICHT material.color:
   *  Ein Material-Tint multipliziert nur — er kann also ausschliesslich
   *  abdunkeln. Aus dem braunen Fell liesse sich so nie ein helles Blau oder
   *  Gold machen. Der Canvas-Filter dreht dagegen den echten Farbton.
   *
   *  Die Zeichenkette ist ein CSS-Filter (dieselbe Syntax wie in CSS).
   *  'none' = Originalfell, dafür wird gar nicht erst umgefärbt.
   * ================================================================== */
  skins: {
    storageKey: 'jungle-climber.skin.v1',
    default: 'standard',

    /* GOLD UND SCHWARZ SIND RAUS. Beide gingen nicht über den Farbton,
     * sondern über Helligkeit und Sättigung — und sahen dadurch nicht wie
     * gefärbtes Fell aus, sondern wie ein Fehler in der Belichtung.
     *
     * `kosten` ist der Preis in Münzen. 0 = von Anfang an da.
     */
    list: {
      standard: { id: 'standard', label: 'Standard', filter: 'none', kosten: 0 },
      grau: { id: 'grau', label: 'Grau', filter: 'saturate(0.12)', kosten: 20 },
      rot: { id: 'rot', label: 'Rot', filter: 'hue-rotate(-28deg) saturate(1.9)', kosten: 20 },

      /* GRÜN braucht einen kräftigeren Umriss: vor der grünen Wand geht es
       * sonst unter. Der Umriss ist genau dafür da (CONFIG.sprite.outline),
       * er muss hier nur stärker ausfallen. `outline` überschreibt punktuell,
       * alles Nichtgenannte bleibt. */
      gruen: {
        id: 'gruen',
        label: 'Grün',
        filter: 'hue-rotate(72deg) saturate(1.3)',
        outline: { opacity: 0.72, scale: 1.1 },
        kosten: 20,
      },
      blau: { id: 'blau', label: 'Blau', filter: 'hue-rotate(160deg) saturate(1.5)', kosten: 20 },
      violett: {
        id: 'violett',
        label: 'Violett',
        filter: 'hue-rotate(215deg) saturate(1.5)',
        kosten: 20,
      },
      pink: {
        id: 'pink',
        label: 'Pink',
        filter: 'hue-rotate(280deg) saturate(1.8) brightness(1.08)',
        kosten: 20,
      },
    },
  },

  characters: {
    storageKey: 'jungle-climber.character.v1',
    default: 'braun',

    list: {
      braun: {
        id: 'braun',
        // Von Anfang an da — irgendwer muss den ersten Lauf machen.
        kosten: 0,
        label: 'Brauner Affe',
        blurb: 'Der Klassiker. Ausgewogen in allem.',
        preview: '/characters/brown.webp',
        framePath: '/textures/move_{n}.webp',
        // Je Affe eigene Bildzahl: die Videos enthalten unterschiedlich viele
        // WIRKLICH verschiedene Bilder pro Kletterzyklus. Wer stur zwölf
        // abtastet, bekommt Wiederholungen, und die Animation hakt sichtbar.
        // Die Zahl meldet `npm run video:frames -- extract …` am Ende.
        frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        cycleSpeed: 1.4, // = CONFIG.sprite.cycleSpeed
        artScale: 1.0, // skaliert den Versatz des Umrisses mit
        bananas: true,
        maxStored: 1, // -> CONFIG.revive.maxStored
        ignoreRockRadius: 0, // 0 = kein Stein wird ignoriert
        player: {
          spriteHeight: 2.5, // 1.00
          modelHeight: 1.5, // 1.00
          moveSpeed: 8.4, // 1.00
          acceleration: 30.0, // 1.00
          damping: 20.0, // 1.00
          climbAssist: 1.0, // 1.00
          minScrollFactor: 0.35,
          hitRadius: 0.42, // 1.00
          hitOffsetY: 0.0,
        },
      },

      weiss: {
        id: 'weiss',
        // Der Flinke. Halb so grosse Hitbox, aber keine Wiederbelebung.
        kosten: 100,
        label: 'Weisser Affe',
        blurb: 'Halb so gross und flinker. Keine Bananen, keine zweite Chance.',
        preview: '/characters/white.webp',
        framePath: '/textures/weiss/move_{n}.webp',
        frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], // 10 verschiedene Bilder im Zyklus
        // Muss gesetzt werden: die Bildrate wird auf moveSpeed NORMIERT
        // (SpritePlayer: speedRatio = animSpeed / cfg.moveSpeed), ein
        // höheres moveSpeed allein macht den Zyklus also NICHT schneller.
        cycleSpeed: 1.9, // x1.36
        artScale: 0.5,
        bananas: false,
        maxStored: 0, // zweiter Riegel gegen die Wiederbelebung
        ignoreRockRadius: 0,
        player: {
          spriteHeight: 1.25, // x0.50  halb so gross
          modelHeight: 0.75, // x0.50
          moveSpeed: 10.9, // x1.30  flinker
          acceleration: 37.0, // x1.23  spitzeres Anfahren
          damping: 25.0, // x1.25
          climbAssist: 1.3, // x1.30  steigt auch wirklich schneller
          minScrollFactor: 0.35,
          hitRadius: 0.21, // x0.50  halbe Hitbox
          hitOffsetY: 0.0,
        },
      },

      orange: {
        id: 'orange',
        // Der Schwere. Kleine Steine prallen ab — die teuerste Fähigkeit.
        kosten: 150,
        label: 'Oranger Affe',
        blurb: 'Dick und langsam — die kleinsten Steine prallen an ihm ab.',
        preview: '/characters/orange.webp',
        framePath: '/textures/orange/move_{n}.webp',
        frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        cycleSpeed: 1.1, // x0.79  schwerfälliger Zyklus
        artScale: 1.0,
        bananas: true,
        maxStored: 1,
        // Steine sind stufenlos 0.30–0.62 gross (CONFIG.rock.radius).
        // 0.38 ist das untere Viertel: (0.38-0.30)/(0.62-0.30) = 25 %.
        // Beim Median 0.46 wäre er gegen die HÄLFTE aller Steine immun —
        // das wäre kein Vorteil mehr, sondern ein anderes Spiel.
        ignoreRockRadius: 0.38,
        player: {
          spriteHeight: 2.5, // 1.00  (Breite folgt dem Seitenverhältnis)
          modelHeight: 1.5,
          moveSpeed: 6.7, // x0.80  langsamer in x UND y
          acceleration: 22.0, // x0.73  träge
          damping: 15.0, // x0.75  rollt länger aus
          climbAssist: 0.8, // x0.80  steigt auch wirklich langsamer
          minScrollFactor: 0.35,
          hitRadius: 0.42, // 1.00  bewusst NICHT grösser
          hitOffsetY: 0.0,
        },
      },
    },
  },

  /* ================================================================== *
   *  DIFFICULTY-KURVEN
   *  Alle drei Kurven laufen über die Spielzeit t (Sekunden) und sind
   *  gedeckelt, damit das Spiel schwer, aber nie unspielbar wird.
   * ================================================================== */
  difficulty: {
    /* ------------------------- DIE WAND IST DIE STUFE ------------------ *
     * Es gibt nur noch EINE Grösse: die Härte. Sie hängt am Wandindex, nicht
     * an der Uhr:
     *
     *      haerte = proWand ^ (Spielzeit / sekundenProWand)
     *
     * Jede Wand ist damit ein Viertel schwerer als die davor — der
     * Hintergrundwechsel ist die Ansage, nicht die Dekoration. Vorher liefen
     * drei getrennte Geraden über die Zeit und mussten von Hand mit den
     * Wandwechseln synchron gehalten werden; ab ihrem Deckel (138 s) wurde
     * gar nichts mehr schwerer.
     *
     * Kontinuierlich gerechnet, nicht in Stufen: sonst spränge die
     * Schwierigkeit mitten in eine fallende Welle hinein.
     * ------------------------------------------------------------------ */
    sekundenProWand: 132, // MUSS zum Abstand in CONFIG.wall.stages passen (dort 132 s)
    proWand: 1.25, // +25 % je Wand

    /* Wie sich die Härte auf die zwei Stellschrauben verteilt: dieser Anteil
     * geht ins TEMPO, der Rest in die Menge. Nur EINE Zahl — die Dichte wird
     * daraus abgeleitet (siehe DifficultyCurve.dichte), damit sie den ganzen
     * Zuwachs übernimmt, sobald das Tempo am Deckel hängt.
     *
     * WAR 0.34, UND DAS WAR ZU WENIG. Damit wuchs das Tempo nur um 7.9 % je
     * Wand — über ein 132 Sekunden langes Gebiet ist das nicht zu spüren, und
     * das Spiel fühlte sich durchgehend gleich schwer an. Der Zuwachs steckte
     * stattdessen in der Menge, und mehr Objekte lesen sich nicht als
     * "schneller", sondern als "voller".
     *
     * Mit 0.62 sind es +14.8 % je Wand: jedes neue Gebiet kommt sichtbar
     * zügiger herunter, und die Menge wächst dafür kaum noch. */
    tempoExponent: 0.62,

    /* --------------------------------- TEMPO (gedeckelt) --------------- *
     * Bildschirmtempo der Objekte: Scroll + Eigengeschwindigkeit zusammen.
     *
     * DER DECKEL IST DIE FAIRNESS-GRENZE. Ein Objekt wird bei y ≈ 5.05
     * sichtbar und wird beim Affen auf Normalhöhe ab y ≈ -0.35 gefährlich —
     * 5.4 Einheiten Vorwarnung. Bei Tempo 16 sind das 0.34 s — knapp, aber
     * noch Reaktion und nicht Raten. Zum Vergleich: ganz zu Anfang lief das
     * Spiel auf 24.5 hinaus, also 0.22 s, und war unspielbar.
     *
     * DIESER DECKEL IST DIE EINZIGE HARTE GRENZE des Spiels. Wer ihn anhebt,
     * verkauft Reaktionszeit — `npm run balance` zeigt in der letzten Spalte,
     * wieviel davon übrig ist.
     */
    tempo: {
      start: 3.8, // der Anfang soll wirklich langsam sein
      max: 16.0,
      // Anteil, der als Wandscrollen sichtbar wird. Der Rest ist
      // Eigengeschwindigkeit der Objekte. Ein fester Anteil statt zweier
      // Kurven: sonst zieht sich die Wand unter den Objekten weg.
      // Dieser Anteil ist zugleich die Punkte pro Sekunde.
      scrollAnteil: 0.42,
    },

    /* --------------------------------- DICHTE -------------------------- *
     * ES KOMMT IMMER NUR EIN OBJEKT. Kein Burst, kein Haufen — mal ein
     * grosser Brocken rechts, dann ein kleiner links, dann drei kleine
     * hintereinander. Nie alles auf einmal.
     *
     * Die Schwierigkeit kommt daher, dass der Strom schneller wird, nicht
     * dass er breiter wird.
     */
    dichte: {
      /* Objekte pro Sekunde zu Beginn.
       *
       * War 0.55 und damit zu wenig: gemessen fielen in den ersten 20
       * Sekunden zwar 11 Objekte, aber nur 1.8 davon verlangten überhaupt
       * eine Reaktion — ein Ausweichmanöver alle 11 Sekunden. "Am Anfang
       * langsamer" ist eine Aussage über die REAKTIONSZEIT (die bleibt bei
       * 1.17 s), nicht über Leere. */
      start: 0.85,

      /* DIE ZENTRALE REGEL: Mindestabstand zwischen zwei Objekten, gemessen
       * als Fallstrecke in Welt-Einheiten.
       *
       * Sie gilt bei der ANKUNFT beim Affen, nicht beim Abwurf — das ist der
       * Punkt, an dem die naheliegende Lösung scheitert. Objekte fallen
       * unterschiedlich schnell (klein 1.25x, gross 0.82x); zwei sauber
       * versetzt abgeworfene kommen deshalb trotzdem gleichzeitig an.
       *
       * 1.9 ist etwas mehr als der Durchmesser des grössten Objekts (1.48).
       * Damit können sich zwei nie überlappen, auch nicht knapp. */
      mindestAbstand: 1.9,

      /* Zusätzliche Luft über den halben Bildhöhen der beiden Nachbarn.
       * Der eigentliche Abstand kommt aus den BILDERN (siehe spriteHoehe):
       * zwei Eiszapfen brauchen mehr als zwei Steine. mindestAbstand ist nur
       * die Untergrenze für kleine, runde Objekte. */
      luft: 0.25,

      /* Wie voll der Strom höchstens werden darf. 1.0 wäre eine lückenlose
       * Kette im Mindestabstand — das sähe wieder nach Haufen aus, nur
       * senkrecht. 0.75 lässt Luft, damit der Takt unregelmässig bleibt.
       *
       * Zusammen mit mindestAbstand deckelt das die Dichte hart:
       *     hoechstens = auslastung * tempo / mindestAbstand
       * Bei Tempo 16 sind das rund 6.3 Objekte pro Sekunde. Mehr geht nicht,
       * ohne die Regel oben zu brechen — siehe `npm run balance`. */
      auslastung: 0.75,

      /* Salven: gelegentlich zwei oder drei kurz hintereinander, im
       * Mindestabstand. Danach eine längere Pause, damit die
       * Durchschnittsdichte stimmt und Salven kein heimlicher Aufschlag sind. */
      salveChance: 0.22,
      salveMax: 3,
    },
  },

  /* ================================================================== *
   *  STEINE
   * ================================================================== */
  rock: {
    poolSize: 48, // gross genug für maximalen Burst + Nachlauf
    hitRadiusFactor: 0.86, // Kollisionsradius = radius * factor (wohlwollend)

    /* --------------------------- BILDER STATT KÖRPER ------------------- *
     * Die fallenden Objekte sind freigestellte Bilder (Sprites), keine
     * 3D-Körper. Erzeugt von scripts/prepare-hazards.mjs aus den Vorlagen in
     * assets-src/hazards/, Ergebnis in public/hazards/.
     *
     * `{n}` wird durch den Namen aus looks[*].bilder ersetzt.
     *
     * Wo in einem Look `null` statt eines Namens steht, wird weiter der
     * prozedurale Körper gebaut (form/farben/strecken weiter unten). So
     * läuft eine neue Wand auch dann schon,
     * wenn die Grafik dafür noch fehlt.
     */
    spritePath: '/hazards/{n}.webp',

    /* ------------------------ DER GARANTIERTE WEG --------------------- *
     * Durch das Feld läuft eine unsichtbare freie Bahn, der Korridor. Kein
     * Objekt wird je so abgeworfen, dass es sie verstellt — siehe
     * src/systems/Korridor.js.
     *
     * Gemessen wurde vorher: in 16 von 16 Läufen entstand eine Wand, durch
     * die kein Spieler mehr durchkam (scripts/fairness.mjs). Und zwar meist
     * nicht, weil das Bild voll war — sondern weil der Affe schon in einer
     * Sackgasse stand, während anderswo 5 Einheiten Platz waren. Eine faire
     * Lücke muss deshalb frei UND erreichbar sein, und das ist kein Zustand,
     * sondern ein durchgehender Weg.
     *
     *   halbbreite     Wie weit der Affe von der idealen Linie abweichen darf
     *                  und trotzdem sicher ist. Kein Objekt kommt näher als
     *                  halbbreite + Spielerradius + Objektradius + reserve.
     *   tempoAnteil    Tempo der Bahn als Anteil der Fallgeschwindigkeit.
     *                  Mitwachsend, damit die Bahn im Spätspiel nicht
     *                  stillzustehen scheint.
     *   anteilStart / anteilMax / anteilVollAbWand
     *                  Harte Obergrenze als Anteil der Laufgeschwindigkeit
     *                  des gewählten Affen — wachsend von anteilStart auf
     *                  anteilMax bis zur Wand `anteilVollAbWand`.
     *                  Das ist der Spätspiel-Hebel: ab etwa Wand 14 sind
     *                  Tempo und Dichte am Anschlag (mehr Objekte gäbe es nur
     *                  übereinander, und das soll nicht sein). Ab da wandert
     *                  stattdessen der freie Weg schneller quer durchs Bild.
     *                  anteilMax MUSS unter 1.0 bleiben: eine Bahn, der man
     *                  nicht folgen kann, ist keine Garantie mehr. Gilt je
     *                  Affe, der langsame orange bekommt also eine ruhigere.
     *   maxSprung      Grösster Versatz eines Bahnabschnitts.
     *   haltMin/Max    Verweildauer zwischen zwei Abschnitten.
     *   horizont       Wie weit die Bahn im Voraus feststehen muss. MUSS
     *                  länger sein als das langsamste Objekt zum Durchqueren
     *                  des Bewegungsbandes braucht (früh ca. 2.6 s).
     *   zeitReserve    Puffer auf das Zeitfenster, deckt die Beschleunigung
     *                  der Difficulty-Kurven während des Fluges ab.
     */
    korridor: {
      halbbreite: 0.5,
      tempoAnteil: 0.17,
      anteilStart: 0.45,
      anteilMax: 0.85,
      anteilVollAbWand: 20,
      maxSprung: 3.4,
      haltMin: 0.14,
      haltMax: 0.55,
      horizont: 3.8,
      zeitReserve: 0.1,
      reserve: 0.1,
      stuetzstellen: 96,
    },

    /* Grösse des Bildes im Verhältnis zum Trefferkreis.
     *
     * Ein Bild hat ein Seitenverhältnis, ein Kreis nicht. Gerechnet wird
     * deshalb über die Fläche: das Sprite wird so skaliert, dass
     * sqrt(Breite * Höhe) = 2 * radius * spriteScale * bildScale ergibt.
     * Ein Eiszapfen bleibt dadurch lang und dünn, eine Kokosnuss rund — und
     * beide wirken trotzdem gleich "gross".
     *
     * Etwas GRÖSSER als der Trefferkreis ist Absicht: der Streifschuss, der
     * knapp nicht trifft, sieht dann nach Glück aus statt nach Bug. */
    spriteScale: 1.0,

    /* ------------------------- DREI STEINARTEN ------------------------ *
     * Feste Grössen statt eines Zufallsbereichs: nur so kann der Spieler
     * eine Art auf einen Blick erkennen und einschätzen, ob sie ihm gefährlich
     * wird. Das ist die Voraussetzung dafür, dass die Fähigkeit des orangen
     * Affen ("überlebt die kleinen") überhaupt lesbar ist.
     *
     * Jede Art unterscheidet sich in DREI Dingen gleichzeitig — Grösse, Farbe
     * und Fallverhalten —, damit sie auch im Augenwinkel auseinanderzuhalten
     * sind und nicht nur beim genauen Hinsehen.
     *
     * ALLES FÄLLT SENKRECHT. Es gibt kein seitliches Trudeln mehr — ein Objekt
     * behält sein x vom Abwurf bis zum Verschwinden. Das ist keine
     * Vereinfachung, sondern die Voraussetzung dafür, dass der Spawner eine
     * freie Bahn ZUSICHERN kann: bei wanderndem x wüsste er beim Abwurf nicht,
     * wo das Objekt beim Spieler ankommt, und könnte nur hoffen.
     *
     * ACHTUNG BEIM ÄNDERN DER RADIEN: CONFIG.characters.list.orange
     * .ignoreRockRadius (0.38) trennt "klein" von "mittel". Wer hier die
     * Radien verschiebt, muss diesen Wert mitziehen, sonst prallt der orange
     * Affe plötzlich an mittleren Steinen ab oder gar nicht mehr an kleinen.
     */
    types: [
      {
        id: 'klein',
        radius: 0.30,
        color: 0xa79c8f, // hell und sandig — liest sich als leicht
        detail: 0, // grobes Ikosaeder, kantig
        fallFactor: 1.25, // schnell und flink
        spin: { min: 2.2, max: 4.4 },
      },
      {
        id: 'mittel',
        radius: 0.48,
        color: 0x6b6259, // die Referenzfarbe
        detail: 1, // runder
        fallFactor: 1.0,
        spin: { min: 0.9, max: 2.2 },
      },
      {
        id: 'gross',
        radius: 0.74,
        color: 0x3f3934, // dunkel und schwer
        detail: 0,
        // Bewusst LANGSAMER als die anderen. Ein grosser Brocken, der auch
        // noch schnell fällt, ist nicht mehr auszuweichen, sondern nur noch
        // Glückssache. Langsam heisst: man sieht ihn kommen und muss handeln.
        fallFactor: 0.82,
        spin: { min: 0.3, max: 0.9 },
      },
    ],

    /* ------------------- WAS AN WELCHER WAND FÄLLT -------------------- *
     * Jede Hintergrundstufe wirft etwas anderes ab: an der Eiswand Eiszapfen,
     * an der Wolkenwand Tropfen, in der Lava Glutbrocken. Welcher Satz gilt, steht
     * bei der Stufe (CONFIG.wall.stages[*].hazard).
     *
     * WICHTIG — WAS SICH HIER NICHT ÄNDERN DARF:
     * Radius, Trefferkreis und Fallverhalten kommen WEITER aus `types` oben.
     * Ein Look tauscht nur Form und Farbe, plus optional kleine Faktoren.
     * Der Grund ist die Lesbarkeit: Bei rund 0.24 s Reaktionszeit im
     * Spätspiel muss "klein / mittel / gross" überall dasselbe bedeuten —
     * sonst weiss der Spieler nicht mehr, was ihn umbringt, und die Fähigkeit
     * des orangen Affen ("überlebt die kleinen") wäre an jeder Wand anders.
     *
     *   bilder     [klein, mittel, gross] — Dateinamen unter public/hazards/,
     *              oder null für "prozedural bauen" (siehe form/farben)
     *   bildScale  Feinjustierung der Bildgrösse (1.0 = wie spriteScale)
     *   taumeln    Grad, um die das Bild beim Fallen hin und her kippt.
     *              Sprites drehen NICHT durch wie die alten Körper — ein
     *              rotierender Kürbis mit Gesicht sähe albern aus.
     *   fallMul / spinMul   optionale Feinjustierung
     *
     * Nur für den prozeduralen Rückfall (bilder[i] === null):
     *   form       'ikosaeder' | 'oktaeder' | 'kugel' | 'kegel' | 'dodekaeder'
     *   farben     [klein, mittel, gross] — je Grössenklasse eine Farbe
     *   leuchten   0..1, Eigenleuchten
     *   glanz      0 = matt/kantig, 1 = glatt
     *   strecken   [x,y,z] Verzerrung — bei Bildern kommt die Form aus dem
     *              Seitenverhältnis der Datei, `strecken` bleibt wirkungslos
     */
    looks: {
      stein: {
        bilder: ['stein_klein', 'stein_mittel', 'stein_gross'],
        bildScale: 1.05,
        taumeln: 14,
        form: 'ikosaeder',
        farben: [0xa79c8f, 0x6b6259, 0x3f3934],
        leuchten: 0,
        glanz: 0,
      },
      kokosnuss: {
        // klein = die halbe Nuss, mittel und gross = dieselbe ganze Nuss.
        // Die Grössenklasse skaliert sie — es braucht kein zweites Bild.
        bilder: ['kokos_halb', 'kokos_ganz', 'kokos_ganz'],
        bildScale: 1.05,
        taumeln: 22,
        spinMul: 1.4,
        form: 'kugel',
        farben: [0x8d6a43, 0x6b4f31, 0x452f1c],
        leuchten: 0,
        glanz: 0.35,
      },
      pilz: {
        bilder: ['pilz_klein', 'pilz_mittel', 'pilz_gross'],
        bildScale: 1.1,
        taumeln: 18,
        form: 'kugel',
        farben: [0x8a6b4f, 0xe8dcc0, 0xd8402f],
        leuchten: 0,
        glanz: 0.2,
      },
      gift: {
        bilder: ['gift_klein', 'gift_mittel', 'gift_gross'],
        bildScale: 0.95,
        // Tropfen hängen an ihrer Spitze — sie taumeln, drehen sich aber nicht.
        taumeln: 12,
        // Blasen sind leicht: sie taumeln stärker und sinken langsamer.
        fallMul: 0.85,
        form: 'kugel',
        farben: [0xb9f05a, 0x2a2333, 0x9a4ed8],
        leuchten: 0.45,
        glanz: 0.7,
      },
      kuerbis: {
        // Der Kürbis deckt klein und mittel ab, der Geist ist der Brocken.
        bilder: ['kuerbis', 'kuerbis', 'geist'],
        bildScale: 1.05,
        taumeln: 10,
        form: 'dodekaeder',
        farben: [0xffa53d, 0xe8761a, 0xf2f0ff],
        leuchten: 0.4,
        glanz: 0.3,
      },
      meer: {
        bilder: ['meer_klein', 'meer_mittel', 'meer_gross'],
        bildScale: 1.0,
        taumeln: 16,
        // Unter Wasser sinkt alles langsamer und wird stärker abgetrieben.
        fallMul: 0.9,
        form: 'kugel',
        farben: [0xe8705c, 0x6fb6d8, 0x2a4a86],
        leuchten: 0,
        glanz: 0.4,
      },
      eiszapfen: {
        bilder: ['eis_klein', 'eis_mittel', 'eis_gross'],
        // Die Zapfen sind von Natur aus lang — ohne Dämpfung würden sie das
        // halbe Bild ausfüllen (Grösse folgt der Fläche, siehe spriteScale).
        bildScale: 0.85,
        // Ein Zapfen fällt mit der Spitze voran und kippt kaum.
        taumeln: 4,
        fallMul: 1.2,
        spinMul: 0.25,
        form: 'oktaeder',
        farben: [0xdff2ff, 0xa8dcf0, 0x6ba9c9],
        leuchten: 0.12,
        glanz: 0.85,
        strecken: [0.62, 1.75, 0.62],
      },
      kristall: {
        bilder: ['kristall_klein', 'kristall_mittel', 'kristall_gross'],
        bildScale: 1.0,
        taumeln: 9,
        form: 'oktaeder',
        farben: [0x5aa8f0, 0xf0b93a, 0xd8322a],
        leuchten: 0.5,
        glanz: 0.9,
      },
      feuer: {
        // Der Glutschweif reicht über den Ball hinaus — das Bild darf
        // deshalb grösser sein, ohne dass der Kern unfair wirkt.
        bilder: ['feuer_klein', 'feuer_mittel', 'feuer_gross'],
        bildScale: 1.2,
        taumeln: 8,
        form: 'ikosaeder',
        farben: [0xffc46b, 0xff7a2f, 0xc2340c],
        leuchten: 0.9,
        glanz: 0.2,
      },
      asche: {
        bilder: ['asche_klein', 'asche_mittel', 'asche_gross'],
        bildScale: 1.05,
        taumeln: 20,
        // Asche ist leicht: sie schwebt mehr, als dass sie fällt.
        fallMul: 0.78,
        form: 'ikosaeder',
        farben: [0x8f8880, 0x5c5751, 0x332f2c],
        leuchten: 0,
        glanz: 0,
      },

      wolken: {
        // Tropfen, Blatt, Hagel. Das Blatt ist bewusst die MITTLERE Klasse:
        // es ist gross zu sehen, aber der Trefferkreis bleibt der mittlere —
        // Radius kommt immer aus `types`, nie aus dem Bild.
        bilder: ['wolken_klein', 'wolken_mittel', 'wolken_gross'],
        bildScale: 1.05,
        taumeln: 20, // in der Luft trudelt alles stärker
        form: 'kugel',
        farben: [0x6cb8e8, 0x6fbf4a, 0xdcecf5],
        leuchten: 0.05,
        glanz: 0.6,
        // Ein Blatt sinkt, es fällt nicht. Der Hagel dagegen kommt zügig.
        fallMulSlots: [1.0, 0.72, 1.1],
      },
    },

    /* Mischungsverhältnis, verschiebt sich mit der Spielzeit.
     * Reihenfolge der Gewichte = Reihenfolge in `types` (klein, mittel, gross).
     * Es sind relative Gewichte, keine Prozente — sie müssen sich nicht auf
     * 100 summieren.
     *
     * Zu Beginn gibt es KEINE grossen Steine: der Spieler soll die kleinen
     * und mittleren erst kennenlernen, bevor der Brocken dazukommt.
     */
    // Gezählt wird in WÄNDEN, nicht in Sekunden — dieselbe Achse wie die
    // Schwierigkeit (CONFIG.difficulty). Wand 0 ist die grüne.
    mix: [
      { abWand: 0, weights: [70, 30, 0] },
      { abWand: 1.5, weights: [45, 45, 10] },
      { abWand: 3.5, weights: [30, 45, 25] },
      { abWand: 6, weights: [22, 43, 35] },
      // Ganz spät verschiebt sich der Druck von der Menge auf das Gewicht:
      // mehr Brocken statt noch mehr Objekte. Ein Brocken sperrt mehr Breite
      // und zwingt zu früherem Ausweichen, ohne den Bildschirm zuzustellen.
      { abWand: 9, weights: [18, 40, 42] },
      { abWand: 12, weights: [14, 36, 50] },
    ],
  },

  /* ================================================================== *
   *  TON
   *
   *  Es liegt KEINE Audiodatei im Build — alles hier ist ein Rezept, aus dem
   *  src/systems/Klang.js zur Laufzeit Klang baut. Die Begründung steht dort
   *  ausführlich; kurz: Rechte, Grösse, Anpassbarkeit.
   *
   *  EINE ATMOSPHÄRE besteht aus gefiltertem Rauschen (der Untergrund),
   *  optionalen Dauertönen (die Stimmung) und "Tupfern" — einzelnen Rufen,
   *  Tropfen, Knistern. Die Tupfer sind das Wichtigste: gleichmässiges
   *  Rauschen nimmt das Ohr nach zwanzig Sekunden nicht mehr wahr, einen
   *  unregelmässigen Vogelruf immer.
   *
   *    rauschen[]  { typ, frequenz, guete, gain }     Filter über weissem Rauschen
   *    drones[]    { frequenz, form, gain, schweben } schweben = leichte Verstimmung
   *    tupfer      { von, bis, dauer, gain, form }    einzelner Ruf/Tropfen
   * ================================================================== */
  klang: {
    anAmAnfang: true,
    // Merkt sich die Stummschaltung über das Neuladen hinweg.
    speicherSchluessel: 'jungle-climber.stumm.v1',
    lautstaerke: 0.32,
    atmoFade: 1.6, // Sekunden Überblendung beim Wandwechsel
    // Abstand zwischen zwei Tupfern (Sekunden, zufällig dazwischen).
    tupferMin: 2.4,
    tupferMax: 7.0,

    gebiete: {
      // Rückfall, falls eine Wand keinen eigenen Eintrag hat.
      standard: {
        gain: 0.9,
        rauschen: [{ typ: 'lowpass', frequenz: 900, guete: 0.7, gain: 0.05 }],
      },

      /* Dschungel: Blätterrauschen, hohe Vogelrufe. */
      gruen: {
        gain: 2.75,
        rauschen: [
          // Breit und mittig: dichtes, nahes Blattwerk.
          { typ: 'bandpass', frequenz: 1500, guete: 0.45, gain: 0.055 },
          { typ: 'lowpass', frequenz: 420, guete: 0.7, gain: 0.03 },
        ],
        tupfer: { von: 1900, bis: 2900, dauer: 0.16, gain: 0.09, form: 'sine' },
      },
      /* Blumen war messbar DERSELBE Klang wie Grün: die Bandmitten lagen 3.4
       * Halbtöne auseinander, die Durchlassbreite betrug aber 26-30 Halbtöne
       * — zwei Gebiete, ein Geräusch. Jetzt schmaler und höher gefiltert,
       * dazu ein warmer Dauerton und ein ABSTEIGENDER Ruf statt eines
       * aufsteigenden. */
      blumen: {
        gain: 1.7,
        rauschen: [
          /* Hoch und nur mässig schmal.
           *
           * Erster Versuch war Güte 2.6 — messbar ein Fehlgriff: ein schmaler
           * Bandpass lässt so wenig Rauschleistung durch, dass der Dauerton
           * übrig blieb und 57 % der Energie unter 300 Hz lagen. Eine
           * Blumenwiese, die brummt. Güte 1.4 lässt genug Luft durch, dass
           * das Rauschen die Farbe bestimmt. */
          { typ: 'bandpass', frequenz: 5200, guete: 1.4, gain: 0.075 },
        ],
        // Höher und leiser als vorher (262 -> 392 Hz): trägt noch, drückt
        // den Schwerpunkt aber nicht mehr in den Keller.
        drones: [{ frequenz: 392, form: 'sine', gain: 0.014, schweben: 0.004 }],
        tupfer: { von: 3400, bis: 2100, dauer: 0.22, gain: 0.08, form: 'sine' },
      },
      /* WARUM ALLE DAUERTÖNE HIER LEISE SIND
       *
       * `gain` heisst bei einem Sinus etwas völlig anderes als bei
       * gefiltertem Rauschen. Ein Sinus steckt seine ganze Leistung in eine
       * einzige Frequenz; ein Rauschband verteilt sie über hunderte Hertz.
       * Bei gleicher Zahl gewinnt der Sinus deutlich.
       *
       * Gemessen führte das dazu, dass sieben Gebiete zwischen 78 % und 99 %
       * ihrer Energie unter 300 Hz hatten — pilzwald/gift lagen 1 (!) von 200
       * Prozentpunkten auseinander, gift/halloween 3, halloween/wasser 6.
       * Vier Gebiete hintereinander, ein Brummen. Die Dauertöne sind deshalb
       * jetzt Beiwerk, und das Rauschband bestimmt die Farbe. */

      /* Äste: dunklerer Wind, knarrendes Holz (fallende Tonhöhe). */
      aeste: {
        gain: 1.68,
        rauschen: [{ typ: 'bandpass', frequenz: 900, guete: 0.5, gain: 0.085 }],
        drones: [{ frequenz: 72, form: 'sine', gain: 0.02, schweben: 0.008 }],
        tupfer: { von: 420, bis: 190, dauer: 0.42, gain: 0.06, form: 'triangle' },
      },
      /* Pilzwald: feucht und dumpf, einzelne Tropfen. */
      pilzwald: {
        gain: 2.04,
        rauschen: [{ typ: 'lowpass', frequenz: 620, guete: 0.8, gain: 0.1 }],
        drones: [{ frequenz: 58, form: 'sine', gain: 0.018, schweben: 0.006 }],
        tupfer: { von: 1500, bis: 620, dauer: 0.2, gain: 0.075, form: 'sine' },
      },
      /* Gift: blubbernd, aufsteigende Blasen. Güte 1.6 war zu schmal, um
       * gegen den Dauerton anzukommen — jetzt 0.9. */
      gift: {
        gain: 2.95,
        rauschen: [{ typ: 'bandpass', frequenz: 480, guete: 0.9, gain: 0.09 }],
        drones: [{ frequenz: 88, form: 'triangle', gain: 0.013, schweben: 0.012 }],
        tupfer: { von: 180, bis: 760, dauer: 0.17, gain: 0.07, form: 'sine' },
      },
      /* Halloween: die beiden Dauertöne liegen eine kleine Sekunde
       * auseinander — genau das Intervall, das im Ohr nicht aufgeht und
       * deshalb unbehaglich wirkt. Dazu ein absteigendes Heulen. */
      halloween: {
        gain: 1.64,
        // Bleibt bewusst das tiefste Gebiet — das ist sein Charakter. Es
        // unterscheidet sich von Wasser durch die Schwebung, nicht durch das
        // Band, deshalb hier eine noch engere Kappung statt einer Anhebung.
        rauschen: [{ typ: 'lowpass', frequenz: 230, guete: 0.9, gain: 0.05 }],
        drones: [
          { frequenz: 62, form: 'sawtooth', gain: 0.024, schweben: 0.01 },
          { frequenz: 65.7, form: 'sine', gain: 0.028, schweben: 0.004 },
        ],
        tupfer: { von: 900, bis: 200, dauer: 0.85, gain: 0.055, form: 'sine' },
      },
      /* Unterwasser: alles Hohe weg, dazu Blasen. Die Kappung liegt höher als
       * bei Halloween (520 statt 230 Hz), sonst wären die beiden direkt
       * aufeinanderfolgenden Gebiete messbar dasselbe Geräusch. */
      wasser: {
        gain: 1.96,
        rauschen: [
          { typ: 'lowpass', frequenz: 750, guete: 1.1, gain: 0.1 },
          // Etwas Strömung im Mittelband — ohne sie blieben Halloween und
          // Wasser nur 20 von 200 Prozentpunkten auseinander.
          { typ: 'bandpass', frequenz: 950, guete: 0.6, gain: 0.035 },
        ],
        drones: [{ frequenz: 48, form: 'sine', gain: 0.02, schweben: 0.005 }],
        tupfer: { von: 240, bis: 900, dauer: 0.13, gain: 0.06, form: 'sine' },
      },
      /* Wolken: luftig, fast nur Höhen. */
      wolken: {
        gain: 1.13,
        rauschen: [{ typ: 'highpass', frequenz: 1400, guete: 0.4, gain: 0.05 }],
        drones: [{ frequenz: 330, form: 'sine', gain: 0.018, schweben: 0.003 }],
        tupfer: { von: 1200, bis: 1800, dauer: 0.6, gain: 0.04, form: 'sine' },
      },
      /* Eiszeit: dünnes Flirren, klirrende Splitter. */
      eiszeit: {
        gain: 1.18,
        rauschen: [{ typ: 'highpass', frequenz: 3200, guete: 0.6, gain: 0.045 }],
        drones: [{ frequenz: 196, form: 'sine', gain: 0.022, schweben: 0.002 }],
        tupfer: { von: 4200, bis: 5600, dauer: 0.1, gain: 0.07, form: 'sine' },
      },
      /* Kristall: schmalbandig und resonant — das klingt nach Glocke. */
      kristall: {
        gain: 2.19,
        // Güte 3.5 war so schmal, dass fast keine Rauschleistung durchkam und
        // der Dauerton die Wand bestimmte (89 % unter 300 Hz). 1.8 klingt
        // immer noch nach Glocke, trägt aber.
        rauschen: [{ typ: 'bandpass', frequenz: 2600, guete: 1.8, gain: 0.085 }],
        drones: [{ frequenz: 147, form: 'sine', gain: 0.011, schweben: 0.004 }],
        tupfer: { von: 1760, bis: 1320, dauer: 0.9, gain: 0.06, form: 'sine' },
      },
      /* Lava: tiefes Grollen, knackende Glut. Darf tief bleiben — das ist
       * hier gewollt und steht nach dem hellen Kristall. */
      lava: {
        gain: 2.24,
        rauschen: [
          { typ: 'lowpass', frequenz: 180, guete: 1.2, gain: 0.09 },
          { typ: 'bandpass', frequenz: 1600, guete: 0.8, gain: 0.03 },
        ],
        drones: [{ frequenz: 41, form: 'sawtooth', gain: 0.028, schweben: 0.014 }],
        tupfer: { von: 700, bis: 140, dauer: 0.12, gain: 0.08, form: 'square' },
      },
      /* Asche: trockenes Zischen, weiche Plopps. Bei 800 Hz statt 1100, damit
       * es sich beim Rundenwechsel nicht mit Grün (1500 Hz) überschneidet. */
      asche: {
        gain: 2.0,
        rauschen: [{ typ: 'bandpass', frequenz: 800, guete: 0.45, gain: 0.075 }],
        drones: [{ frequenz: 54, form: 'sine', gain: 0.016, schweben: 0.007 }],
        // Kurzer trockener Plopp statt eines Glissandos: Äste benutzten
        // schon ein abfallendes Dreieck, und zweimal dieselbe Geste hört sich
        // nach derselben Wand an.
        tupfer: { von: 210, bis: 180, dauer: 0.09, gain: 0.06, form: 'square' },
      },
    },

    /* --------------------------------- KURZE EFFEKTE ------------------- *
     * Jeder Effekt ist eine Liste von Tönen mit optionaler Verzögerung.
     *   von / bis   Frequenz am Anfang und Ende (Gleiten)
     *   dauer       Ausklingzeit
     *   rauschen    true = Rauschen statt Oszillator (Schläge, Knistern)
     */
    effekte: {
      /* Münze: zwei Töne im Quintabstand, aufsteigend. Genau dieses Muster
       * liest jeder sofort als "eingesammelt". */
      muenze: {
        mindestAbstand: 0.05,
        toene: [
          { von: 988, bis: 988, dauer: 0.09, gain: 0.22, form: 'square' },
          { von: 1319, bis: 1319, dauer: 0.22, gain: 0.2, form: 'square', verzoegerung: 0.06 },
        ],
      },

      /* Treffer: tiefer Schlag plus kurzes Rauschen. Der Schlag allein klingt
       * nach Ton, das Rauschen allein nach Zischen — erst zusammen nach
       * Aufprall. */
      treffer: {
        mindestAbstand: 0.15,
        toene: [
          { von: 180, bis: 44, dauer: 0.3, gain: 0.34, form: 'sine' },
          { von: 1800, bis: 260, dauer: 0.16, gain: 0.2, rauschen: true, guete: 0.7 },
        ],
      },

      /* Game Over: drei absteigende Töne, der letzte Schritt fällt weiter als
       * die davor — das hört sich an wie "aus". */
      gameover: {
        toene: [
          { von: 392, bis: 392, dauer: 0.26, gain: 0.2, form: 'triangle' },
          { von: 311, bis: 311, dauer: 0.26, gain: 0.2, form: 'triangle', verzoegerung: 0.2 },
          { von: 196, bis: 186, dauer: 0.8, gain: 0.22, form: 'triangle', verzoegerung: 0.4 },
        ],
      },

      /* Affenlaut: zwei kurze Rufe, der zweite höher. Das schnelle Gleiten
       * hinauf und gleich wieder zurück macht das "Uh-uh" aus — nicht die
       * Tonhöhe selbst.
       *
       * Die vier Töne folgen ZEITLICH aufeinander, addieren sich also nie.
       * Bei den alten Werten kam der Ruf deshalb auf Spitze 0.049 heraus,
       * während die Gebietsatmosphäre allein schon 0.030-0.046 erreicht —
       * gemessen ging er im Hintergrund unter. Jetzt liegt er auf der Höhe
       * des Münzklangs. */
      affe: {
        mindestAbstand: 0.4,
        toene: [
          { von: 420, bis: 700, dauer: 0.11, gain: 0.24, form: 'sawtooth', anschlag: 0.015 },
          { von: 700, bis: 380, dauer: 0.1, gain: 0.2, form: 'sawtooth', verzoegerung: 0.1 },
          { von: 480, bis: 820, dauer: 0.1, gain: 0.23, form: 'sawtooth', verzoegerung: 0.26 },
          { von: 820, bis: 440, dauer: 0.12, gain: 0.19, form: 'sawtooth', verzoegerung: 0.35 },
        ],
      },

      /* Freigeschaltet: aufsteigender Dreiklang. */
      frei: {
        toene: [
          { von: 523, bis: 523, dauer: 0.14, gain: 0.18, form: 'square' },
          { von: 659, bis: 659, dauer: 0.14, gain: 0.18, form: 'square', verzoegerung: 0.1 },
          { von: 784, bis: 784, dauer: 0.3, gain: 0.2, form: 'square', verzoegerung: 0.2 },
        ],
      },
    },
  },

  /* ================================================================== *
   *  MÜNZEN
   *
   *  Die Währung. Gesammelt wird im Lauf, ausgegeben im Menü: neue Affen,
   *  neue Fellfarben.
   *
   *  SIE KAUFEN NIE KLETTERKRAFT. Der Punktestand IST die Höhe — wer sich
   *  Höhe kaufen könnte, entwertete jede Zahl in der Bestenliste. Münzen
   *  kaufen deshalb ausschliesslich Aussehen und Spielfiguren, und die drei
   *  Affen sind ausdrücklich gleich stark, nur anders.
   * ================================================================== */
  coin: {
    poolSize: 6,
    // Bild aus scripts/prepare-hazards.mjs (nur die KLEINSTE der drei
    // gelieferten Münzen, ausdrücklicher Wunsch).
    bild: '/hazards/muenze.webp',
    radius: 0.34,
    hitRadiusFactor: 1.35, // grosszügig: Einsammeln soll sich gut anfühlen
    // Langsamer als die Hindernisse. Eine Münze im Steintempo wäre kein
    // Bonus, sondern ein zweiter Reflextest.
    fallSpeedFactor: 0.55,
    // Pendeln um die Abwurfstelle — fällt im Bild auf, ohne davonzudriften.
    pendelWeite: 0.55,
    pendelTempo: 2.2,

    /* Wie viele Münzen ein Gebiet hergibt. Bei 132 s je Wand sind 3 Stück
     * etwa alle 40 Sekunden eine. Der weisse Affe kostet damit rund
     * 33 Gebiete — das ist Absicht: er soll ein Ziel sein, keine Formalität. */
    proGebiet: 3,
  },

  /* ================================================================== *
   *  BANANEN (Wiederbelebung)
   * ================================================================== */
  banana: {
    poolSize: 8,
    // Wahrscheinlichkeit, dass ein Spawn-Event eine Banane statt eines Steins wirft.
    spawnChance: 0.085,
    // Keine Banane spawnen, solange der Spieler schon eine gebunkert hat.
    suppressWhenStocked: true,
    radius: 0.38,
    hitRadiusFactor: 1.15, // Einsammeln soll grosszügig sein
    fallSpeedFactor: 0.72, // Bananen fallen langsamer als Steine
    spin: 1.6,
    color: 0xffd23f,
  },

  /* ================================================================== *
   *  WIEDERBELEBUNG
   * ================================================================== */
  revive: {
    maxStored: 1, // max. 1 gleichzeitig gebunkert
    invulnerableTime: 2.0, // Sekunden Unverwundbarkeit nach Verbrauch
    blinkFrequency: 9.0, // Blinken pro Sekunde während der Unverwundbarkeit
  },

  /* ================================================================== *
   *  ZWEITES LEBEN PER WERBUNG
   *
   *  Nach dem Tod einmal je Lauf: Spot ansehen, dann geht es an der
   *  Todesstelle weiter — gleiche Höhe, gleiche Schwierigkeit, gleicher
   *  Punktestand.
   *
   *  ANBIETER
   *  `provider: 'stub'` zeigt einen eingebauten Platzhalter ohne Netzwerk,
   *  damit der Ablauf jetzt schon vollständig spielbar und testbar ist. Ein
   *  echtes SDK kommt später dazu: src/systems/AdService.js beschreibt oben
   *  die Schnittstelle, es ist genau eine Methode.
   * ================================================================== */
  ad: {
    enabled: true,
    // Wie oft je Lauf. Bei 1 bleibt der Highscore eine Aussage über einen
    // Aufstieg; bei 3 wäre er eine Aussage darüber, wer am meisten Werbung
    // erträgt.
    maxPerRun: 1,
    // Unverwundbarkeit nach dem Weiterspielen. Länger als bei der Banane,
    // weil an der Todesstelle bereits alles voller Objekte ist.
    invulnerableTime: 3.0,
    // Alles in diesem Umkreis um den Affen verschwindet beim Weiterspielen.
    // Ohne das stirbt man sofort wieder am selben Stein.
    clearRadius: 3.4,
    // Länge des Platzhalter-Spots in Sekunden (nur für provider 'stub').
    stubDuration: 5,

    /* ----------------------------- PORTAL ------------------------------ *
     * 'auto'          erkennt SELBST, wo es läuft — der Normalfall
     * 'stub'          Platzhalter ohne Netzwerk, lädt gar kein SDK
     * 'crazygames'    erzwungen (nur zum Testen)
     * 'gamemonetize'  erzwungen (nur zum Testen)
     *
     * WARUM 'auto' UND NICHT DIE ADRESSZEILE
     * Der erste Entwurf liess das Portal über `?portal=crazygames` wählen.
     * Das funktioniert dort NICHT: CrazyGames liefert das hochgeladene ZIP
     * unter einer eigenen Adresse aus, an die niemand einen Parameter hängen
     * kann. Es wäre also nie ein SDK geladen worden — keine Werbung, kein
     * Erlös, und die Einreichung wäre durchgefallen. 'auto' fragt stattdessen
     * das SDK selbst (getEnvironment), wo es läuft.
     *
     * `?portal=…` bleibt als Testschalter erhalten und schlägt diesen Wert.
     *
     * Meldet sich kein SDK (Werbeblocker, lokal, offline), fällt das Spiel auf
     * den Platzhalter zurück — das zweite Leben bleibt spielbar, es wird nur
     * nichts abgerechnet. Das Spiel darf nie an einem fremden Server hängen. */
    provider: 'auto',

    /* Von GameMonetize beim Einreichen vergeben. Ohne sie wird das SDK gar
     * nicht erst geladen — es lädt zwar, liefert aber nie einen Spot. */
    gameMonetizeId: '',

    // Wie lange auf ein fremdes SDK gewartet wird, bevor ohne es gestartet
    // wird. Lieber ohne Werbung spielen als vor einem schwarzen Bild warten.
    sdkTimeout: 4000,
    // Notbremse, falls ein Spot gar nicht antwortet. Ohne sie hinge der
    // Werbe-Screen für immer und der Lauf wäre verloren.
    werbungTimeout: 45000,
  },

  /* ================================================================== *
   *  SPIELABLAUF
   * ================================================================== */
  flow: {
    // Wie lange nach dem tödlichen Treffer gewartet wird, bevor der
    // Game-Over-Screen kommt — gerade so lang, dass "Die" sichtbar ist.
    gameOverDelay: 1.35,
    // Scrollgeschwindigkeit der Wand in Menü und Game-Over-Screen (Units/s),
    // damit das Bild nicht komplett still steht.
    ambientScrollSpeed: 0.55,
  },

  /* ================================================================== *
   *  WELTWEITE BESTENLISTE
   *
   *  LEER = die Liste bleibt lokal. Das Spiel läuft dann unverändert, man
   *  spielt nur gegen sich selbst. Es gibt bewusst keinen zusätzlichen
   *  Schalter: was fehlt, ist aus.
   *
   *  ZUM AKTIVIEREN
   *   1. Auf supabase.com ein Projekt anlegen (Gratis-Kontingent reicht:
   *      500 MB fassen Millionen Einträge).
   *   2. scripts/bestenliste.sql einmal im SQL-Editor ausführen.
   *   3. Projekt-URL und den ÖFFENTLICHEN anon-Schlüssel hier eintragen.
   *
   *  Der anon-Schlüssel gehört ins ausgelieferte JavaScript — das ist so
   *  vorgesehen und kein Versehen. Er darf ausschliesslich lesen und die
   *  zwei geprüften Funktionen aufrufen; alles andere sperrt die
   *  Zugriffsregel in der Datenbank. Der geheime service_role-Schlüssel darf
   *  NIEMALS hierher.
   *
   *  WIE WEIT DAS GEGEN FÄLSCHUNG TRÄGT — ehrlich, weil die Frage kommt:
   *  Nicht bis "unmöglich". Der anon-Schlüssel steht zwangsläufig im
   *  ausgelieferten Code, also kann jeder die Funktionen direkt aufrufen.
   *  Was gebaut ist: der Server stempelt den Rundenstart mit SEINER Uhr und
   *  rechnet die Spielzeit selbst aus, statt sie vom Browser entgegen-
   *  zunehmen. Dazu die tatsächliche Kletterkurve als Obergrenze, ein
   *  Eintrag je Name, Sperrfristen und rationierte Startmarken. Aus "ein
   *  einziger Aufruf mit einer Fantasiezahl" wird damit "planen, warten,
   *  rationiert werden". Unmöglich wird es nicht — bei einem Browserspiel
   *  ohne Anmeldung geht mehr nicht.
   *
   *  ACHTUNG BEIM GRATIS-KONTINGENT: Supabase pausiert ein Projekt nach
   *  7 Tagen ohne jeden Zugriff. Läuft das Spiel, passiert das nie — läuft es
   *  nicht an, ist die Liste offline, bis man sie im Dashboard weckt.
   * ================================================================== */
  bestenliste: {
    url: 'https://tbhaxppbpzywpypmeopo.supabase.co',
    /* Der ÖFFENTLICHE Schlüssel (neue Supabase-Form `sb_publishable_…`, früher
     * "anon key"). Er gehört ins ausgelieferte JavaScript — anders könnte das
     * Spiel nichts eintragen. Er darf nur lesen und die geprüften Funktionen
     * aufrufen, alles andere sperren die Zugriffsregeln.
     *
     * HIER DARF NIEMALS der `service_role`- bzw. `sb_secret_…`-Schlüssel
     * stehen. Der hebelt sämtliche Regeln aus; wer ihn aus dem Quelltext
     * fischt, kann die Datenbank leeren. */
    schluessel: 'sb_publishable_kfoyLd6S4VUCEnMgh3lvYA_sSXgrelu',
    tabelle: 'bestenliste',
    eintragenFn: 'eintragen',
    // Meldet den Rundenbeginn an. Der Server misst die Spielzeit selbst —
    // sonst könnte ein Angreifer sie frei erfinden.
    laufStartFn: 'lauf_start',
    /* Lebenszeichen während des Laufs. Ohne sie genügte ein `sleep` zwischen
     * zwei Aufrufen, um eine Stunde Spiel zu behaupten — reines Warten kostet
     * nichts. MUSS zu `tick_sekunden` in scripts/bestenliste.sql passen. */
    tickFn: 'lauf_tick',
    tickSekunden: 20,
    // Fortschritt (Münzen, Affen, Fellfarben) auf dem Server.
    standLadenFn: 'stand_laden',
    standSichernFn: 'stand_sichern',

    /* Übertragung auf ein anderes Gerät per VIERSTELLIGEM CODE.
     *
     * Die Kennung bleibt intern der Schlüssel; der Code ist nur ein Zeiger
     * darauf. Vier Ziffern sind bewusst gewählt, obwohl es davon nur
     * zehntausend gibt — die Abwägung samt Folgen steht ausführlich in
     * scripts/bestenliste.sql, Abschnitt ÜBERTRAGUNGSCODE.
     *
     * Diese drei Funktionen müssen in der Datenbank angelegt sein. Solange
     * sie fehlen, antwortet der Server mit 404, und das Spiel sagt genau das
     * — statt den Fehler zu verschlucken. */
    codeBelegenFn: 'code_belegen',
    codeAufloesenFn: 'code_aufloesen',
    codeVorschlagFn: 'code_vorschlag',

    // Nach dieser Zeit wird abgebrochen. Eine hängende Bestenliste darf den
    // Game-Over-Screen nicht blockieren.
    timeout: 6000,
    anzahl: 10,
  },

  /* ================================================================== *
   *  BESITZ (Münzen + Freigeschaltetes)
   *
   *  DREI EBENEN, weil jede allein eine Lücke hat:
   *
   *   1. Browser (localStorage) — sofort da, offline, kostenlos.
   *      Lücke: anderes Gerät kennt nichts, Browserdaten löschen = weg.
   *   2. CrazyGames-Speicher — hängt am KONTO des Spielers, nicht am
   *      Browser. Auf CrazyGames die beste Ebene, sonst nicht verfügbar.
   *      (GameMonetize bietet nichts dergleichen an, das SDK kann nur
   *      Werbung.)
   *   3. Supabase — für die eigene Website. Gebunden an eine zufällige
   *      Kennung, die zugleich der Wiederherstellungscode ist.
   *
   *  Ebene 1 gilt immer und sofort; 2 bzw. 3 kommen nebenher dazu und
   *  werden zusammengeführt (mehr Münzen gewinnt, freigeschaltet bleibt
   *  freigeschaltet). Das Spiel wartet nie auf einen Speicher.
   * ================================================================== */
  fortschritt: {
    storageKey: 'jungle-climber.besitz.v1',
    // Die Spielerkennung = Wiederherstellungscode. Zufällig, ohne Bezug zu
    // einer Person.
    spielerKey: 'jungle-climber.spieler.v1',
    startMuenzen: 0,
    // Was nie etwas kostet. Ohne diese Liste stünde man beim allerersten
    // Start ohne Affen und ohne Fell da.
    immerFrei: ['braun', 'standard'],
  },

  /* ================================================================== *
   *  SCORE / HIGHSCORE
   * ================================================================== */
  score: {
    unitsPerMeter: 1.0, // 1 World-Unit == 1 Höhenmeter
    storageKey: 'jungle-climber.highscores.v2',
    maxEntries: 10,
    maxNameLength: 12,
    defaultName: 'AFFE',
    // Läufe mit Werbe-Weiterspielen in der Bestenliste markieren.
    //
    // Der Punktestand IST die Höhe — wer nach dem Tod weiterklettert, steht
    // sonst neben jemandem, der genauso hoch kam, ohne zu sterben. Ein
    // kleines Zeichen dahinter kostet nichts und hält die Liste ehrlich.
    // Auf false stellen, wenn das nicht gewünscht ist.
    markAdRevive: true,
  },

  /* ================================================================== *
   *  SPRITE-ANIMATION
   *
   *  Das gelieferte Bild ist EIN Einzelbild — es gibt keine Einzelphasen.
   *  Die Bewegung entsteht deshalb rein prozedural aus der Transformation:
   *  Auf/Ab-Nicken, wechselnde Neigung (liest sich als abwechselndes
   *  Greifen), Stauchen/Strecken und Neigung in Laufrichtung.
   * ================================================================== */
  sprite: {
    /* --------------------------- KLETTER-FRAMES ---------------------- *
     * Die Bewegung stammt aus dem gelieferten Video
     * (assets-src/art/monkey_movement.mp4): ein Kletterzyklus von 1.017 s,
     * in 12 Einzelbilder zerlegt und vom weissen Hintergrund freigestellt.
     * scripts/prepare-art.mjs richtet sie mittig aus und schreibt sie nach
     * public/textures/move_00.webp … move_11.webp.
     *
     * Hier steht die ABSPIELREIHENFOLGE. Umsortieren, kürzen oder einzelne
     * Frames auslassen geht ohne Codeänderung.
     *
     * ABWÄRTS benutzt dieselben Frames, nur rückwärts abgespielt — es gibt
     * keine eigene Abwärts-Sequenz.
     */
    framePath: '/textures/move_{n}.webp',
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    // Frame, der im Stillstand gehalten wird (Index INNERHALB von frames).
    idleFrame: 0,

    // Kletterzyklen pro Sekunde bei voller Bewegungsgeschwindigkeit.
    // Bildrate = cycleSpeed * frames.length (hier 1.4 * 12 ≈ 17 Bilder/s).
    // Der Zyklus im Video dauert 1.017 s, also entspricht 1.0 dem Originaltempo.
    cycleSpeed: 1.4,
    // Grundtakt im Stillstand, damit der Zyklus beim Anfahren nicht springt.
    idleCycleSpeed: 0.4,

    // Tempo des Kletterzyklus in MENÜ, CHARAKTERAUSWAHL und GAME OVER,
    // als Anteil der vollen Bewegung.
    //
    // Ohne diesen Wert stand der Affe hinter den Menüs reglos im Bild: die
    // Animation läuft normalerweise in SpritePlayer.update(), und die ruft
    // Game nur im laufenden Spiel. Die Wand scrollt dort aber weiter
    // (flow.ambientScrollSpeed) — ein starrer Affe vor bewegtem Hintergrund
    // sieht aus, als hinge das Bild.
    //
    // 0.55 ergibt mit cycleSpeed 1.4 rund einen Kletterzyklus pro Sekunde:
    // ruhig genug fürs Menü, deutlich genug, dass er sichtbar arbeitet.
    ambientCycleRatio: 0.55,

    /* KEINE prozedurale Zusatzbewegung.
     *
     * Frühere Fassungen haben das Sprite zusätzlich geneigt, genickt,
     * gestaucht und beim Richtungswechsel gespiegelt. Das ist bewusst
     * entfernt: die Bewegung soll ausschliesslich aus den Frames kommen.
     * Besonders die Spiegelung lief über scale.x durch die Null und sah aus,
     * als würde sich der Affe drehen.
     *
     * Der Affe wird also unverändert dargestellt — nur das Bild wechselt.
     */

    // Weicher dunkler Umriss hinter dem Sprite.
    //
    // NICHT nur Kosmetik: Der Affe ist braun, und auf der Lava-Stufe ist der
    // Hintergrund ebenfalls orange-braun — ohne Absetzung verschwindet die
    // Spielfigur dort fast. Der Umriss löst sie auf JEDER Stufe vom
    // Untergrund, ohne den Bildstil zu verändern.
    outline: {
      enabled: true,
      opacity: 0.45,
      scale: 1.07, // Vergrösserung gegenüber dem Sprite
      offset: [0.035, -0.045], // leichter Versatz -> wirkt wie Schlagschatten
      color: 0x120c08,
    },

    // Tod: der Affe sackt nach unten weg. Ohne Drehung — der Sturz-Spin ist
    // entfernt. Banane, Wiederbelebung und Start werden nur noch über das HUD
    // zurückgemeldet, nicht mehr über eine Sprite-Verformung.
    death: { duration: 1.2, drop: 0.9 },
  },

  /* ================================================================== *
   *  ANIMATION (nur für player.mode === 'model')
   *
   *  ---------------------------------------------------------------
   *  clipMap = die EINZIGE Stelle, die angefasst werden muss, wenn
   *  echte Kletteranimationen nachgeliefert werden (Stufe 2).
   *  Die Spiellogik kennt nur die logischen Namen (climbUp, climbDown,
   *  climbLeft, climbRight, climbIdle, dodge) — nie die Clip-Namen.
   *  ---------------------------------------------------------------
   *
   *  Felder pro Eintrag:
   *    clip       Clip-Name im GLB
   *    timeScale  Abspielgeschwindigkeit; negativ = rückwärts
   *    speedSync  true  -> timeScale wird zusätzlich mit der aktuellen
   *                        Bewegungsgeschwindigkeit skaliert
   *    rollDeg    Drehung um die Bild-Normale/Z (Grad): Neigung in
   *               Bewegungsrichtung innerhalb der Wandebene
   *    pitchDeg   Kippen um X (Grad): richtet einen VIERFÜSSIGEN Bodenlauf
   *               so auf, dass er als Klettern an der Wand gelesen wird
   *    loop       'repeat' | 'once'
   */
  animation: {
    crossFade: 0.2, // Standard-Blendzeit (Vorgabe: 0.15–0.25 s)
    crossFadeFast: 0.14, // für kurze Akzente (Dodge)

    /* ===================== DIE KLETTER-AUSRICHTUNG ======================= *
     * Run/RunR/Idle sind VIERFÜSSIGE BODEN-Clips: das Modell schaut in +Z,
     * der Rücken zeigt nach +Y, die Gliedmassen nach -Y.
     *
     * Damit daraus Klettern wird, muss der Affe mit dem BAUCH zur Wand und
     * dem KOPF nach oben stehen. Mit einer einzelnen Achse geht das nicht
     * (die nötige Abbildung wäre eine Spiegelung). Nötig sind ZWEI Drehungen:
     *
     *     pitchDeg 88  -> Bauch/Gliedmassen kippen in die Wand (-Z)
     *     rollDeg 180  -> dreht den dann kopfüber hängenden Affen richtig herum
     *
     * BASIS_ROLL (180) ist deshalb der Nullpunkt für seitliches Neigen:
     * links/rechts wird davon abgezogen bzw. addiert.
     *
     * ClimbIdle steckt in der UMGEKEHRTEN Konvention (aufrecht, Blick zur
     * Kamera) und steht in dieser Ausrichtung auf dem Kopf — siehe README,
     * Abschnitt "Kletteranimation nachrüsten".
     * ==================================================================== */
    clipMap: {
      // STUFE-1-FALLBACK. Es gibt im FBX keinen Kletter-Fortbewegungszyklus,
      // deshalb werden die Lauf-Clips als Kletterbewegung umgedeutet.
      climbUp: { clip: 'Run', timeScale: 1.0, speedSync: true, rollDeg: 180, pitchDeg: 88, loop: 'repeat' },
      // Abwärts: derselbe Clip rückwärts (negative timeScale).
      climbDown: { clip: 'Run', timeScale: -1.0, speedSync: true, rollDeg: 180, pitchDeg: 88, loop: 'repeat' },
      // ACHTUNG: 'RunL' existiert im gelieferten FBX NICHT (nur Run + RunR).
      // Links wird deshalb aus RunR mit gespiegeltem Roll gebaut. Sobald ein
      // echter RunL/climbLeft-Clip vorliegt: hier eintragen, sonst nichts ändern.
      climbLeft: { clip: 'RunR', timeScale: 1.0, speedSync: true, rollDeg: 156, pitchDeg: 86, loop: 'repeat' },
      climbRight: { clip: 'RunR', timeScale: 1.0, speedSync: true, rollDeg: 204, pitchDeg: 86, loop: 'repeat' },
      // Stillstand an der Wand.
      // ABWEICHUNG VON DER VORGABE: hier steht 'Idle' statt 'ClimbIdle'.
      // ClimbIdle ist in der umgekehrten Achsenkonvention animiert; gemischt
      // mit den Lauf-Clips würde der Affe bei JEDEM Anhalten um ~180° kippen.
      // 'Idle' ist wie Run ein Bodenclip und passt damit nahtlos.
      climbIdle: { clip: 'Idle', timeScale: 1.0, speedSync: false, rollDeg: 180, pitchDeg: 88, loop: 'repeat' },
      // Kurzer Ausweich-Akzent, wird ÜBER den Kletter-Clip geblendet.
      dodge: { clip: 'Jump', timeScale: 1.7, speedSync: false, rollDeg: 180, pitchDeg: 88, loop: 'once' },
    },

    // Ausrichtung für Ereignis-Clips (Die/Eat/Smile/Roar) und für Menü/Pause.
    // Alles Bodenclips -> dieselbe Kletter-Ausrichtung wie oben.
    eventOrientation: { pitchDeg: 88, rollDeg: 180 },

    /* ------------------------- Root Motion entfernen -------------------- *
     * Die Quell-Clips haben die Vorwärtsbewegung im Wurzel-Bone gebacken
     * (Run läuft tatsächlich los). Die Position des Affen kommt aber aus der
     * Steuerung — beides zusammen liesse die Figur aus dem Bild wandern.
     *
     * Zusätzlich meldet FBX2glTF beim Konvertieren:
     *   "node /RootNode/RL_BoneRoot uses unsupported transform inheritance
     *    type 'eInheritRrs'"
     * Dadurch sind genau diese Translationskanäle falsch skaliert. Beides
     * wird gelöst, indem die .position-Kanäle der Wurzel-Bones aus JEDEM Clip
     * entfernt werden; die Rotationen (= die eigentliche Animation) bleiben.
     *
     * Bei echten, in-place gebauten Kletter-Clips kann das hier abgeschaltet
     * werden — dann bitte vorher prüfen, ob die Clips wirklich in-place sind.
     */
    stripRootMotion: {
      enabled: true,
      bones: ['macaque_Pelvis_bone', 'SK_Mesh_Macaque', 'RL_BoneRoot'],
    },

    // Für Einträge mit speedSync:true wird die Abspielgeschwindigkeit an die
    // Bewegungsgeschwindigkeit gekoppelt:
    //     timeScale = entry.timeScale * clamp(speed / reference, min, max)
    // reference sollte CONFIG.player.moveSpeed entsprechen.
    speedSyncReference: 6.4,
    speedSyncClamp: { min: 0.42, max: 1.85 },

    // Wie schnell die Modellrotation (yawDeg/pitchDeg) nachgeführt wird.
    orientationSmoothing: 8.5,

    // Gewicht, mit dem der Dodge-Akzent additiv über den Kletterzustand
    // geblendet wird (0 = aus, 1 = ersetzt den Kletter-Clip vollständig).
    dodgeBlendWeight: 0.72,
    dodgeCooldown: 0.45, // s, damit Dauerdrücken nicht flackert
    dodgeTriggerSpeed: 4.3, // ab dieser Bewegungsgeschwindigkeit gilt es als "Ausweichen"

    // Einmal-Animationen für Spielereignisse.
    oneShots: {
      die: 'Die', //        Treffer / Game Over
      eat: 'Eat', //        Banane eingesammelt
      revive: 'Smile', //   Wiederbelebung verbraucht
      roar: 'Roar', //      Spielstart / neuer Highscore
    },
    // Nach dieser Zeit kehrt eine Einmal-Animation in den Kletterzustand zurück.
    // (null = Cliplänge verwenden)
    oneShotReturn: { eat: 0.95, revive: 0.9, roar: null, die: null },

    // Menü/Pause: diese Clips werden der Reihe nach abgespielt.
    menuIdleCycle: ['Idle', 'Sit', 'Idle2', 'SitIdle'],
    menuIdleHold: 3.4, // s pro Clip, bevor zum nächsten geblendet wird

    /* ---------------- Prozedurale Schwanz-Simulation ---------------- */
    // Läuft UNABHÄNGIG vom abgespielten Clip (nach mixer.update, direkt auf
    // den Bones). Nötig, weil bei jedem Retargeting humanoider Clips die
    // Tail-Kette NICHT mitübertragen wird — siehe README.
    tail: {
      enabled: true, // <- hier abschaltbar
      bones: [
        'macaque_Tail_1_bone',
        'macaque_Tail_2_bone',
        'macaque_Tail_3_bone',
        'macaque_Tail_4_bone',
        'macaque_Tail_5_bone',
        'macaque_Tail_6_bone',
        'macaque_Tail_7_bone',
      ],
      // Federkonstante — höher = folgt schneller. Kritische Dämpfung wäre
      // 2*sqrt(stiffness) ≈ 15.2; darunter schwingt der Schwanz nach, was hier
      // erwünscht ist.
      stiffness: 58.0,
      damping: 11.0,
      // ACHTUNG BEIM TUNEN: die Auslenkung pro Glied ist
      //     (gravity + speed * velocityInfluence) * falloff^index
      // und wird auf maxAngle geklammert. Bei 7 Gliedern ist falloff^6 ≈ 3.3 —
      // zu grosse Werte lassen den Schwanz dauerhaft am Anschlag kleben,
      // dann bewegt er sich sichtbar gar nicht mehr.
      velocityInfluence: 0.018,
      // Auslenkung nimmt zur Schwanzspitze hin zu (Faktor pro Glied).
      falloff: 1.22,
      maxAngle: 0.45, // rad (~26°), Sicherheitsklammer gegen Überschlagen
      gravity: 0.075, // konstante Auslenkung nach unten (Schwerkraft-Look)
    },
  },

  /* ================================================================== *
   *  PFLANZENWAND / PARALLAX
   *
   *  Alle Texturen liegen in public/textures/ und werden von
   *  scripts/generate-textures.mjs als Platzhalter erzeugt.
   *  Zum Austauschen: einfach die PNG-Datei am selben Pfad ersetzen
   *  (kachelbar, quadratisch, vertikal nahtlos).
   * ================================================================== */
  wall: {
    /* ------------------------- HINTERGRUND-STUFEN ---------------------- *
     * Die Wand wechselt das Aussehen NUR an diesen Schwellen — also genau
     * dann, wenn das Spiel schneller und schwerer wird. Dazwischen kachelt
     * dieselbe Textur endlos weiter.
     *
     * Die Schwellen liegen absichtlich auf denselben Sekunden wie die
     * Burst-Stufen in difficulty.burst: der Bildwechsel fällt damit mit dem
     * spürbaren Schwierigkeitssprung zusammen.
     *
     * Nach der letzten Stufe geht es zyklisch von vorne los (alle
     * stageLoopSeconds), die Hintergründe kommen also immer wieder.
     *
     *   near  Textur der Spielebene
     *   far   unscharfe, dunklere Fassung derselben Vorlage für die hintere
     *         Parallax-Ebene (erzeugt von scripts/prepare-art.mjs)
     *   hazard  welcher Look aus CONFIG.rock.looks hier herunterkommt
     *   tint    optionaler Farbstich (0xffffff = Original). Nur für Wände,
     *           vor denen die fallenden Objekte sonst untergehen.
     * ------------------------------------------------------------------ */
    // Jede Schwelle fällt mit einem echten Schwierigkeitssprung zusammen:
    // entweder steigt dort die Burst-Grösse (difficulty.burst) oder die
    // Scroll-/Steingeschwindigkeit läuft noch ihre Rampe hoch.
    //
    // DIESE LISTE IST DIE REIHENFOLGE. Die Nummer im Dateinamen ist nur die
    // Reihenfolge, in der die Bilder geliefert wurden — die vier später
    // dazugekommenen Wände tragen deshalb gar keine Nummer. Wer die Abfolge
    // ändern will, sortiert hier um und zieht `afterSeconds` mit; an den
    // Dateien ist nichts zu tun.
    stages: [
      {
        name: 'gruen',
        hazard: 'stein',
        afterSeconds: 0,
        near: '/textures/stage1_green.webp',
        far: '/textures/stage1_green_far.webp',
      },
      {
        name: 'blumen',
        hazard: 'stein',
        afterSeconds: 132,
        near: '/textures/stage2_flowers.webp',
        far: '/textures/stage2_flowers_far.webp',
      },
      {
        name: 'aeste',
        hazard: 'kokosnuss',
        afterSeconds: 264,
        near: '/textures/stage3_branches.webp',
        far: '/textures/stage3_branches_far.webp',
      },
      {
        name: 'pilzwald',
        hazard: 'pilz',
        afterSeconds: 396,
        near: '/textures/wall_mushroom.webp',
        far: '/textures/wall_mushroom_far.webp',
      },
      {
        name: 'gift',
        hazard: 'gift',
        afterSeconds: 528,
        near: '/textures/stage4_poison.webp',
        far: '/textures/stage4_poison_far.webp',
      },
      {
        name: 'halloween',
        hazard: 'kuerbis',
        afterSeconds: 660,
        near: '/textures/stage5_halloween.webp',
        far: '/textures/stage5_halloween_far.webp',
      },
      {
        name: 'wasser',
        hazard: 'meer',
        afterSeconds: 792,
        near: '/textures/wall_water.webp',
        far: '/textures/wall_water_far.webp',
      },
      {
        name: 'wolken',
        hazard: 'wolken',
        afterSeconds: 924,
        near: '/textures/stage7_clouds.webp',
        far: '/textures/stage7_clouds_far.webp',
        // Weisser Hagel vor weissen Wolken ist nicht zu sehen — und was man
        // nicht sieht, kann man nicht ausweichen. Der Farbstich dämpft die
        // Wand gerade so weit, dass die Körner wieder herausstechen.
        tint: 0xc6d4e2,
      },
      {
        name: 'eiszeit',
        hazard: 'eiszapfen',
        afterSeconds: 1056,
        near: '/textures/stage6_ice.webp',
        far: '/textures/stage6_ice_far.webp',
        // Gleicher Grund wie bei den Wolken: helle Zapfen vor heller Wand.
        tint: 0xa9c2d8,
      },
      {
        name: 'kristall',
        hazard: 'kristall',
        afterSeconds: 1188,
        near: '/textures/wall_crystal.webp',
        far: '/textures/wall_crystal_far.webp',
      },
      {
        name: 'lava',
        hazard: 'feuer',
        afterSeconds: 1320,
        near: '/textures/stage8_lava.webp',
        far: '/textures/stage8_lava_far.webp',
        // Feuerbälle vor einer Wand aus Feuer: die Wand muss zurücktreten,
        // sonst sieht man nicht mehr, was fällt und was Kulisse ist.
        tint: 0x9d8078,
      },
      {
        name: 'asche',
        hazard: 'asche',
        afterSeconds: 1452,
        near: '/textures/stage9_ash.webp',
        far: '/textures/stage9_ash_far.webp',
      },
    ],
    // Nach der letzten Stufe alle X Sekunden zur nächsten (zyklisch von vorne).
    stageLoopSeconds: 132,
    // Überblendzeit zwischen zwei Stufen (Sekunden). Kein harter Schnitt.
    stageFade: 1.8,
    // Seitenverhältnis der Stufentexturen (1252x676) — damit die Kacheln
    // unverzerrt bleiben.
    tileAspect: 1252 / 676,

    // Layer werden von HINTEN nach VORNE gerendert.
    //
    //   slot            'near' oder 'far' — welche Fassung der Stufe
    //   z               Tiefe der Ebene (Wandebene = 0, Kamera steht bei +z)
    //   parallax        Anteil der Scrollgeschwindigkeit (1.0 = voll)
    //   tileWorldHeight Höhe EINER Texturkachel in World-Units.
    //                   Kleiner = kleineres, dichteres Muster.
    //   tint            Multiplikativer Farbstich (0xffffff = Original)
    //
    // Die Plane-Grösse wird NICHT konfiguriert, sondern zur Laufzeit aus dem
    // Kamera-Frustum berechnet, damit jede Ebene bei jedem Seitenverhältnis
    // bildfüllend bleibt (siehe src/world/PlantWall.js).
    // Reihenfolge = Renderreihenfolge (hinten zuerst).
    //
    // Nur ZWEI Ebenen, und das mit Absicht: die Stufentexturen sind deckend.
    // Eine zweite deckende Ebene dahinter wäre komplett verdeckt und damit
    // wirkungslos. Tiefe entsteht deshalb über eine unscharfe, halbdurch-
    // sichtige Ebene VOR der Spielebene, die schneller scrollt — das liest
    // sich als nahes, unscharfes Blattwerk.
    layers: [
      {
        name: 'spielebene',
        slot: 'near',
        z: -0.9,
        parallax: 1.0,
        tileWorldHeight: 9.5,
        opacity: 1.0,
        tint: 0xffffff,
      },
      {
        name: 'vordergrund',
        slot: 'far', // unscharfe Fassung — wirkt wie Tiefenunschärfe
        z: 3.0,
        parallax: 1.5,
        tileWorldHeight: 17,
        // Bewusst schwach: die Ebene liegt VOR dem Affen und würde ihn sonst
        // verschlucken.
        opacity: 0.16,
        tint: 0xffffff,
      },
    ],
    // Sicherheitszuschlag auf die berechnete Plane-Grösse (1.0 = exakt bildfüllend).
    coverMargin: 1.18,
    // Lichtdurchbrüche: sanft pulsierende helle Flecken auf der Hauptebene.
    godrays: { enabled: true, intensity: 0.28, speed: 0.11 },
  },

  /* ================================================================== *
   *  EINGABE
   * ================================================================== */
  input: {
    // WASD + Pfeiltasten als Alias.
    keys: {
      up: ['KeyW', 'ArrowUp'],
      down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      pause: ['Escape', 'KeyP'],
      confirm: ['Enter', 'Space'],
      debug: ['F1'],
      // Ton an/aus. Eine Taste, kein Menü: wer den Ton weghaben will, will
      // ihn sofort weghaben.
      mute: ['KeyM'],
    },
    touch: {
      enabled: true, // virtueller Joystick unten links
      radius: 62, // px, Radius der Joystick-Basis
      deadZone: 0.16, // relativer Totbereich
      anchor: { left: 26, bottom: 26 }, // px vom Bildschirmrand
    },
  },

  /* ================================================================== *
   *  DEBUG
   * ================================================================== */
  debug: {
    showHitboxes: false, // zur Laufzeit mit F1 umschaltbar
    hitboxColor: { player: 0x00ff88, rock: 0xff3355, banana: 0xffe14d },
    showStats: false, // FPS/Entity-Zähler im HUD
  },
};

export default CONFIG;
