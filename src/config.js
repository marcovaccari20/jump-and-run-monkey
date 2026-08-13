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

    /* HÖCHSTES SEITENVERHÄLTNIS DER SPIELFLÄCHE (Breite geteilt durch Höhe).
     *
     * Das Spiel hat drei Bahnen, und ihr Abstand ist nach oben gedeckelt
     * (world.bahnDeckel) — sonst entstünde dazwischen ein Platz, auf dem
     * einen nichts treffen kann. Die Kamera wuchs aber ungebremst mit der
     * Fensterbreite mit. Gemessen war vom sichtbaren Bild bespielt:
     *
     *     Handy 390x844     100 %
     *     Portal 800x600     36 %
     *     PC 16:9            26 %
     *     PC 2:1             23 %
     *
     * Drei Viertel des Schirms waren Wand, auf der nie etwas passiert.
     *
     * DIE LEINWAND IST DER EINZIGE HEBEL. Bei einer Perspektivkamera gilt
     * sichtbare Breite = sichtbare Höhe x Seitenverhältnis; weder Bildwinkel
     * noch Kameraabstand ändern daran etwas, beide skalieren beide Achsen
     * zugleich. Ein Zoom mit derselben Wirkung hätte die Vorwarnzeit für
     * fallende Objekte von 0.46 s auf 0.10 s gedrückt — die Kommentare bei
     * `difficulty` nennen 0.22 s "unspielbar". Also wird die FLÄCHE schmaler
     * statt die Sicht enger.
     *
     * 0.5625 ist 9:16 und keine neue Zahl: genau dieses Format ist die
     * Grundlage, aus der world.bahnDeckel hergeleitet wurde. Damit füllt der
     * braune Affe die Säule zu 100 % aus, der weisse (halber Trefferradius,
     * also engerer Deckel) zu 86 %.
     *
     * Grösser heisst mehr Bild und mehr Leerlauf: 0.60 -> 98 %, 0.65 -> 87 %,
     * 0.75 -> 79 %. Die Zahl geht als CSS-Variable an #buehne. */
    maxSeitenverhaeltnis: 0.5625,

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
    /* Grenzen in der Wandebene (Units, relativ zur Bildmitte).
     *
     * minX/maxX sind weiterhin das Bewegungsband des Affen.
     *
     * minY/maxY sind es NICHT MEHR: der Affe steht senkrecht fest. Die beiden
     * Werte bedeuten seither das GEFAHREN- UND SICHTBARKEITSBAND der
     * fallenden Objekte und werden genau dafür gelesen —
     * Spawner._freieStelle (Durchquerungsfenster), Spawner._darfFallen
     * (`sichtbarBis = minY - 1.6`) und das Zeitfenster der Korridor-Garantie.
     *
     * SIE DÜRFEN DESHALB NICHT auf die Affenhöhe zusammengezogen werden. Wer
     * das tut, schiebt `sichtbarBis` von -4.5 auf -1.7, während Objekte bis
     * despawnY (-5.6) sichtbar bleiben — gemessen kippt der Anteil der Frames
     * mit überlappenden Objektbildern dadurch von 0.000 % auf 0.278 %. */
    /* minX/maxX sind nur noch eine SICHERUNG NACH OBEN, keine Spielfeldbreite.
     *
     * Bis hierher stand da ±4.6, und das war die eigentliche Fessel: im
     * Querformat sind auf Affenhöhe ±5.66 Einheiten zu sehen, gespielt wurde
     * aber nur bis ±4.6 — und die äusserste Bahn lag bei 0.66 davon, also
     * bei ±3.04. Gemessen: der Affe erreichte 53.6 % der sichtbaren Breite,
     * die Ecken links und rechts waren totes Bild.
     *
     * Jetzt bestimmt allein die Kamera die Breite (Game._updateWorldBounds);
     * ±9 fängt nur noch absurde Seitenverhältnisse ab. */
    bounds: { minX: -9, maxX: 9, minY: -2.9, maxY: 2.7 },

    /* VIER BAHNEN — bis in beide Ecken.
     *
     * Der Affe springt zwischen festen Spuren statt sich stufenlos zu
     * bewegen. Das ist kein Vereinfachen: bei freier Bewegung fielen Objekte
     * auch dort, wo er im Hochformat gar nicht hinkam. Mit Bahnen fällt alles
     * genau dort, wo man auch hin kann — und ALLES heisst alles, Steine,
     * Münzen, Bananen und die Kacke des Adlers.
     *
     * Die Werte sind ANTEILE der nutzbaren Halbbreite, keine Weltkoordinaten:
     * das Feld ist im Hochformat weniger als halb so breit wie im Querformat,
     * feste Zahlen lägen dort ausserhalb. Game._updateWorldBounds rechnet
     * daraus die tatsächlichen x-Positionen (worldView.bahnX).
     *
     * ±1.0 UND NICHT MEHR ±0.66. Der alte Wert stand da, weil der Affe "ganz
     * am Rand halb im Bildrand klebte" — das lag aber nicht am Rand, sondern
     * daran, dass der Rand mit seinem TREFFERRADIUS berechnet wurde
     * (hitRadius·1.6 = 0.67) statt mit seiner halben BILDBREITE (0.70). Jetzt
     * wird mit der Bildbreite gerechnet, und dann steht er auf der äussersten
     * Bahn exakt bündig mit dem Bildrand, ohne Beschnitt.
     *
     * VIER statt drei: mit drei Bahnen über die volle Breite läge die Mitte
     * allein zwischen zwei sehr weit entfernten Aussenbahnen; im Querformat
     * wären das 5 Einheiten Sprung. Vier Bahnen halbieren den Abstand auf
     * zwei Drittel der Halbbreite. */
    /* DREI BAHNEN. Waren kurzzeitig vier — das war zu viel.
     *
     * Mit vier Spuren liegt keine in der Mitte: der Affe startet neben der
     * Bildachse, und jeder Wechsel ist nur ein Drittel der Breite. Das
     * Ausweichen wurde dadurch kleinteilig statt entschieden. Mit drei
     * Spuren gibt es wieder eine Mitte, und ein Wechsel ist eine halbe
     * Feldbreite — man sieht, dass man sich bewegt hat.
     *
     * Die Werte sind ANTEILE der nutzbaren Halbbreite, keine
     * Weltkoordinaten. ±1.0 heisst: bis in die Ecke. */
    bahnen: [-1, 0, 1],

    /* ================================================================== *
     *  OBERGRENZE FÜR DEN BAHNABSTAND — der Handy/PC-Unterschied
     *
     *  DAS PROBLEM. `bahnen` sind Anteile der Feldbreite, und die Feldbreite
     *  hängt am Seitenverhältnis. Gemessen (scripts/_pcvshandy.mjs):
     *
     *      9:19.5 Handy   Bahnabstand 1.61
     *      9:16   Handy               2.13
     *      16:9   Laptop              8.31      ← fünfmal so weit
     *
     *  Gefährlich ist ein Bereich von `spieler.hitRadius + objekt.hitRadius`
     *  um jede Bahn, beim braunen Affen und einem grossen Objekt 1.06. Zwei
     *  Nachbarbahnen decken also 2.11 Einheiten ab. Solange sie NÄHER
     *  beieinander liegen, gibt es zwischen ihnen keinen sicheren Ort.
     *
     *  Bei 8.31 Abstand bleiben 6.2 Einheiten dazwischen frei. Wer auf dem
     *  PC dauernd links/rechts drückt, steht damit fast nur noch zwischen
     *  den Bahnen — und dort fällt nichts. Gemessen: ab 3:4 aufwärts zehn von
     *  zehn Läufen über 15 Minuten OHNE EINEN EINZIGEN TREFFER. Auf dem Handy
     *  stirbt derselbe Spieler nach zwei Sekunden.
     *
     *  WARUM NICHT EINFACH SCHNELLER LAUFEN. Naheliegend wäre, `moveSpeed`
     *  mit der Feldbreite mitwachsen zu lassen, damit ein Bahnwechsel überall
     *  gleich lange dauert. Das behebt es NICHT: die Lücke zwischen den
     *  Bahnen bliebe 6.2 Einheiten breit, der Spieler wäre nur schneller
     *  darin unterwegs. Der Anteil sicherer Zeit bleibt derselbe.
     *
     *  DIE LÖSUNG ist deshalb geometrisch: der Bahnabstand wird gedeckelt.
     *  2.2 entspricht einem 9:16-Handy — dem Gerät, für das das Spiel gebaut
     *  ist. Auf schmaleren Handys ändert sich gar nichts (dort ist das Feld
     *  ohnehin enger). Auf breiten Bildschirmen rücken die Bahnen zusammen
     *  und liegen mittig; der Rest der Breite bleibt Wand. Das ist genau das
     *  „automatisch anpassen je nach Handy oder PC", nur andersherum als man
     *  zuerst denkt: nicht das Handy aufblasen, sondern den PC bändigen.
     *
     *  Der Wert begrenzt die HALBE Feldbreite und damit zugleich den Abstand
     *  zweier benachbarter Bahnen (bei [-1,0,1] sind beide gleich).
     *
     *  ─────────────────────────────────────────────────────────────────
     *  ER WIRD GERECHNET, NICHT FESTGESCHRIEBEN — und das ist der Kern.
     *
     *  Hier stand fest 2.2. Die Bedingung „zwischen zwei Bahnen darf kein
     *  sicherer Ort liegen" heisst aber:
     *
     *      Bahnabstand  <=  2 * (Trefferradius Affe + Trefferradius Objekt)
     *
     *  und der Trefferradius des Affen ist JE CHARAKTER verschieden:
     *
     *      braun / orange   hitRadius 0.42  ->  hoechstens 2.113
     *      weiss            hitRadius 0.21  ->  hoechstens 1.693
     *
     *  Mit festen 2.2 war der Deckel für alle drei zu weit — und für den
     *  weissen Affen so deutlich, dass der ursprüngliche Fehler bei ihm
     *  vollständig zurückkam: gemessen 0.00 Treffer je Minute über dreimal
     *  600 Sekunden auf jedem Format ab 3:4, während derselbe Affe auf einem
     *  schmalen Handy 18.63 kassiert. Ausgerechnet der teuerste Charakter
     *  (1000 Münzen) war auf dem PC unverwundbar.
     *
     *  `bahnDeckel` ist deshalb nur noch die OBERGRENZE für den Fall, dass
     *  die Rechnung einmal einen unsinnig grossen Wert liefert. Gerechnet
     *  wird in Game._updateWorldBounds aus den Massen des gewählten Affen.
     * ================================================================== */
    bahnDeckel: 2.2,

    // Höhe, auf der Steine/Bananen erzeugt werden.
    // MUSS über der sichtbaren Oberkante liegen, und zwar mindestens um den
    // grössten Steinradius (0.62): sonst ploppt der Stein sichtbar ins Bild,
    // statt hereinzufallen. Die Oberkante liegt in der Wandebene bei y = 5.05
    // (unabhängig vom Seitenverhältnis, da das Sichtfeld vertikal definiert
    // ist) — 6.0 lässt genug Luft.
    spawnY: 6.0,
    // Unterhalb dieser Höhe werden Entities wieder in den Pool zurückgegeben.
    despawnY: -5.6,
    /* Breite, über die Spawns horizontal verteilt werden — heute nur noch
     * eine Obergrenze, die nie greifen soll.
     *
     * Der Wert stand auf 5.0 und passte zu den alten bounds von ±4.6. Seit
     * das Feld der Kamera folgt, reicht es im Querformat (16:9) bis ±7.98 —
     * `Math.min(5.0, limit + 0.8)` hätte dem Korridor dort eine Breite
     * vorgerechnet, die es gar nicht mehr gibt, und ihn unnötig gebremst.
     * Gefallen wäre trotzdem alles richtig (die Objekte liegen auf Bahnen,
     * nicht auf spawnHalfWidth), aber die Bahn hätte träger gewirkt als
     * nötig. 12 liegt über jedem Format, das die ±9-Sicherung durchlässt. */
    spawnHalfWidth: 12.0,
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
    /* Startposition — und zugleich die FESTE HÖHE des Affen.
     *
     * Der Affe bewegt sich nur noch seitlich; y wird nach dem Setzen nie
     * wieder angefasst (SpritePlayer.update). Der Wert ist damit keine
     * Startposition mehr, sondern seine Höhe für den ganzen Lauf.
     *
     * WARUM -0.1 UND NICHT 0.35 (die echte Pixelmitte)
     * Kamera bei [0, 1.9, 11.5], Blick auf [0, 0.35, 0], vertikales Sichtfeld
     * 46° — Welt-y 0.35 liegt exakt in der Bildmitte. Genau dort hin wäre
     * aber teuer: Objekte fallen von oben, wer höher sitzt, sieht sie später.
     *
     *   y = -1.4 (früher)   Vorwarnung 0.337 s bei Höchsttempo
     *   y = -0.1 (jetzt)    Vorwarnung 0.256 s   (-24 %)
     *   y =  0.35 (Mitte)   Vorwarnung 0.228 s   (-32 %)
     *
     * -0.1 liegt 4.5 % der Bildhöhe unter der Pixelmitte — auf einem 844 px
     * hohen Telefon rund 38 px, im Spiel nicht wahrnehmbar — und kauft acht
     * Prozentpunkte Vorwarnzeit zurück. Es ist ausserdem die Mitte des
     * früheren Bewegungsbandes, wodurch das Gefahrenfenster in
     * Spawner._freieStelle symmetrisch um den Affen liegt.
     *
     * Wer diesen Wert ändert, muss difficulty.tempo.max nachziehen —
     * die beiden hängen über die Vorwarnzeit zusammen. */
    /* DER AFFE SITZT TIEFER — eine ganze Körperlänge.
     *
     * Er stand auf -0.1, also fast in der Bildmitte. Von dort aus sieht man
     * zwar viel, aber die Objekte kommen einem entgegen wie eine Wand: die
     * Vorwarnstrecke ist die Strecke von der Bildoberkante bis zu ihm, und
     * die war kurz.
     *
     * Jetzt -2.6: das ist genau seine Bildhöhe (2.5) tiefer, wie gewünscht
     * — die Kopfspitze steht dort, wo vorher die Schwanzspitze war. Er ist
     * damit im unteren Drittel, aber nicht am Rand: das Spielfeld reicht
     * bis -2.9, und sein Bild geht noch tiefer.
     *
     * Diese Zahl gehört zu difficulty.tempo.max — wer eine ändert, muss die
     * andere nachrechnen. Die längere Vorwarnstrecke ist der Grund, warum
     * das Tempo überhaupt steigen durfte. */
    startPosition: [0, -2.6, 0],

    /* Wie lange ein Bahnwechsel dauert (Sekunden bis praktisch angekommen).
     *
     * Steht hier statt bei world, weil es eine Eigenschaft DES AFFEN ist:
     * der weisse ist der flinke, er wechselt schneller. Die Werte je
     * Charakter stehen in CONFIG.characters.
     *
     * Nicht 0: ein harter Sprung nimmt dem Ausweichen jedes Gefühl.
     * Nicht zu gross: sonst steht man beim Wechsel zu lange dazwischen und
     * wird genau dort getroffen. */
    bahnWechselZeit: 0.16,

    /* Seitliche Höchstgeschwindigkeit — WIEDER EIN POSITIONSWERT.
     *
     * Hier stand, seit der Umstellung auf Bahnen werde der Wert nur noch für
     * die Animation gebraucht und die Position komme allein aus
     * `bahnWechselZeit`. Das galt genau so lange, wie die Bahnen dicht
     * beieinander lagen. Seit sie über die volle Bildbreite gehen, wäre eine
     * wegunabhängige Wechselzeit im Querformat ein Sprung mit 20
     * Einheiten/s — SpritePlayer deckelt den Schritt deshalb auf `moveSpeed`.
     *
     * Damit bestimmt dieser Wert wieder mit, wie lange ein Bahnwechsel
     * dauert, und er ist zugleich die Grösse, mit der scripts/fairness.mjs
     * die erreichbare Restmenge aufweitet. Wer ihn senkt, macht das Spiel
     * nicht nur träger, sondern verschiebt die bewiesene Grenze. */
    moveSpeed: 10.76,
    // Glättungsraten in 1/s (nicht Beschleunigung im physikalischen Sinn):
    // v nähert sich dem Zielwert mit 1 - e^(-rate * dt).
    // Höher = direkter. acceleration gilt bei gedrückter Taste, damping beim Loslassen.
    acceleration: 38.4,
    damping: 20.0,
    // Unterhalb dieser Geschwindigkeit gilt der Affe als stehend (climbIdle).
    idleThreshold: 0.55,

    /* AUF NULL, UND DAS IST DER WICHTIGE TEIL.
     *
     * Der Vertikal-Input zahlte auf die Scrollgeschwindigkeit ein — und die
     * steuert nicht nur die Wand, sondern auch das Tempo ALLER fallenden
     * Objekte (Game.js -> Spawner.update). Gemessen an der ersten Wand:
     *
     *     kein Input   Objekt 3.80 Einheiten/s
     *     W gedrückt   Objekt 4.80   (+26 %)
     *     S gedrückt   Objekt 2.80   (−26 %)
     *
     * Wer sich unten hielt, spielte also dauerhaft auf 74 % Tempo. Dazu kam
     * ein zweiter, rein geometrischer Vorteil: unten hat ein Objekt 7.12
     * statt 5.62 Einheiten Weg — nochmal +72 % Reaktionszeit. Beides zusammen
     * machte "unten kleben" zur überlegenen Strategie.
     *
     * Mit 0 fällt alles immer gleich schnell, egal wo der Affe steht. W und S
     * bewegen ihn nur noch im Bild — und genau das ist bei einem
     * Ausweichspiel auch ihre Aufgabe.
     *
     * WAS ES KOSTET: "W" bringt keine Punkte mehr. Das trifft alle gleich,
     * die Bestenliste bleibt also stimmig — und es behebt nebenbei, dass der
     * weisse Affe (climbAssist 1.3) dort im Vorteil war, obwohl die drei
     * ausdrücklich gleich stark sein sollen.
     * ⚠ scripts/bestenliste.sql (klettern_max) muss mitgezogen werden. */
    climbAssist: 0.0,
    /* Ohne climbAssist ist das hier wirkungslos — der Scroll hängt nicht mehr
     * am Input, es gibt also nichts mehr zu bremsen. Bleibt stehen, weil zwei
     * Stellen im Spawner damit den langsamstmöglichen Fall abschätzen. */
    minScrollFactor: 1.0,

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
      grau: { id: 'grau', label: 'Grau', filter: 'saturate(0.12)', kosten: 200 },
      rot: { id: 'rot', label: 'Red', filter: 'hue-rotate(-28deg) saturate(1.9)', kosten: 200 },

      /* GRÜN braucht einen kräftigeren Umriss: vor der grünen Wand geht es
       * sonst unter. Der Umriss ist genau dafür da (CONFIG.sprite.outline),
       * er muss hier nur stärker ausfallen. `outline` überschreibt punktuell,
       * alles Nichtgenannte bleibt. */
      gruen: {
        id: 'gruen',
        label: 'Green',
        filter: 'hue-rotate(72deg) saturate(1.3)',
        outline: { opacity: 0.72, scale: 1.1 },
        kosten: 200,
      },
      blau: { id: 'blau', label: 'Blue', filter: 'hue-rotate(160deg) saturate(1.5)', kosten: 200 },
      violett: {
        id: 'violett',
        label: 'Purple',
        filter: 'hue-rotate(215deg) saturate(1.5)',
        kosten: 200,
      },
      pink: {
        id: 'pink',
        label: 'Pink',
        filter: 'hue-rotate(280deg) saturate(1.8) brightness(1.08)',
        kosten: 200,
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
        label: 'Brown Monkey',
        blurb: 'The classic. Balanced in every way.',
        preview: '/characters/brown.webp',
        framePath: '/textures/move_{n}.webp',
        // Je Affe eigene Bildzahl: die Videos enthalten unterschiedlich viele
        // WIRKLICH verschiedene Bilder pro Kletterzyklus. Wer stur zwölf
        // abtastet, bekommt Wiederholungen, und die Animation hakt sichtbar.
        // Die Zahl meldet `npm run video:frames -- extract …` am Ende.
        frames: [0, 1, 1, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10, 10, 11, 12, 13, 13],
        cycleSpeed: 1.263, // = CONFIG.sprite.cycleSpeed = Videotempo
        artScale: 1.0, // skaliert den Versatz des Umrisses mit
        bananas: true,
        maxStored: 1, // -> CONFIG.revive.maxStored
        ignoreRockRadius: 0, // 0 = kein Stein wird ignoriert
        player: {
          spriteHeight: 2.5, // 1.00
          modelHeight: 1.5, // 1.00
          moveSpeed: 10.76, // 1.00
          acceleration: 38.4, // 1.00
          damping: 20.0, // 1.00
          // Alle drei auf 0: siehe CONFIG.player.climbAssist. Objekte müssen
          // gleich schnell fallen, egal wo der Affe steht — und die drei
          // Affen sollen gleich stark sein, was mit einem Punktebonus je
          // Figur nicht zusammenging.
          climbAssist: 0.0,
          minScrollFactor: 1.0,
          hitRadius: 0.42, // 1.00
          hitOffsetY: 0.0,
        },
      },

      weiss: {
        id: 'weiss',
        // Der Flinke. Halb so grosse Hitbox, aber keine Wiederbelebung.
        kosten: 1000,
        label: 'White Monkey',
        blurb: 'Half the size and quicker. No bananas, no second chance.',
        preview: '/characters/white.webp',
        framePath: '/textures/weiss/move_{n}.webp',
        /* ZWÖLF BILDER, NICHT ZEHN — es ist jetzt der eingefärbte BRAUNE.
         *
         * Der gelieferte weisse Affe hatte einen sichtbaren Fehler im
         * Bewegungsablauf: sein Video gab nur zehn wirklich verschiedene
         * Bilder her, und an einer Stelle sprang er. Statt daran
         * herumzuflicken ist er jetzt der braune Affe in Weiss
         * (scripts/prepare-weiss.mjs) — gleiche saubere Bewegung, gleiche
         * zwölf Bilder, nur anderes Fell. */
        frames: [0, 1, 1, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10, 10, 11, 12, 13, 13],
        // Muss gesetzt werden: die Bildrate wird auf moveSpeed NORMIERT
        // (SpritePlayer: speedRatio = animSpeed / cfg.moveSpeed), ein
        // höheres moveSpeed allein macht den Zyklus also NICHT schneller.
        cycleSpeed: 1.263, // gleiche Bilder wie braun -> gleiches Videotempo
        artScale: 0.5,

        /* ZWEI BAHNEN AUF EINMAL.
         *
         * Sein Vorteil ist nicht mehr nur "schneller", sondern eine andere
         * Bewegungsart: wer zweimal kurz hintereinander wischt, springt
         * gleich zwei Spuren weit. Beim braunen und beim orangen Affen ist
         * ein Wisch immer genau eine Bahn.
         *
         * Der zweite Wisch muss innerhalb dieses Fensters kommen. 0.35 s ist
         * knapp genug, dass es eine Absicht bleibt, und weit genug, dass man
         * es mit dem Daumen schafft. */
        doppelwischFenster: 0.35,

        bananas: false,
        maxStored: 0, // zweiter Riegel gegen die Wiederbelebung
        ignoreRockRadius: 0,
        player: {
          spriteHeight: 1.25, // x0.50  halb so gross
          modelHeight: 0.75, // x0.50
          moveSpeed: 13.97, // x1.30  flinker
          acceleration: 47.4, // x1.23  spitzeres Anfahren
          damping: 25.0, // x1.25
          climbAssist: 0.0, // war 1.3 — gab ihm einen Punktevorteil
          minScrollFactor: 1.0,
          hitRadius: 0.21, // x0.50  halbe Hitbox
          hitOffsetY: 0.0,
        },
      },

      orange: {
        id: 'orange',
        // Der Schwere. Kleine Steine prallen ab — die teuerste Fähigkeit.
        kosten: 1500,
        label: 'Orange Monkey',
        blurb: 'Heavy and slow — the smallest rocks bounce right off.',
        preview: '/characters/orange.webp',
        framePath: '/textures/orange/move_{n}.webp',
        // 21 Bilder: eigenes Video, eigene Periode (0.875 s).
        frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        cycleSpeed: 1.143, // Videotempo seines eigenen Videos
        artScale: 1.0,
        bananas: true,
        maxStored: 1,
        // Steine sind stufenlos 0.30–0.62 gross (CONFIG.rock.radius).
        // 0.38 ist das untere Viertel: (0.38-0.30)/(0.62-0.30) = 25 %.
        // Beim Median 0.46 wäre er gegen die HÄLFTE aller Steine immun —
        // das wäre kein Vorteil mehr, sondern ein anderes Spiel.
        ignoreRockRadius: 0.38,
        /* EINE HALBE SEKUNDE VERZÖGERUNG.
         *
         * Sein Nachteil. Er prallt an kleinen Steinen ab — das ist die
         * stärkste Fähigkeit im Spiel, und sie braucht ein Gegengewicht,
         * das man SPÜRT. Langsamer laufen reicht dafür nicht: man merkt es
         * kaum, weil der Bahnwechsel ohnehin kurz ist.
         *
         * Deshalb setzt sein Bahnwechsel erst nach dieser Zeit ein. Man
         * wischt, und er geht los, wenn die halbe Sekunde um ist. Wer mit
         * ihm spielt, muss früher entscheiden — genau das ist der Handel. */
        wischVerzoegerung: 0.5,

        player: {
          spriteHeight: 2.5, // 1.00  (Breite folgt dem Seitenverhältnis)
          modelHeight: 1.5,
          moveSpeed: 8.58, // x0.80  langsamer in x UND y
          acceleration: 28.2, // x0.73  träge
          damping: 15.0, // x0.75  rollt länger aus
          climbAssist: 0.0, // war 0.8 // x0.80  steigt auch wirklich langsamer
          minScrollFactor: 1.0,
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
    /* Zeitmass der HÄRTE — nicht mehr der Abstand der Wandwechsel.
     *
     * Das waren einmal dieselben 132 Sekunden, und der Kommentar hier
     * versprach entsprechend "jede Wand ist ein Viertel schwerer als die
     * davor". DAS GILT NICHT MEHR, und es ist wichtig, das hier stehen zu
     * haben, statt es stillschweigend falsch zu lassen.
     *
     * Die Gebiete sind jetzt nach METERN geschnitten (150 bis 200, siehe
     * CONFIG.wall.stages): feste Sekunden hiessen bei wachsendem Tempo immer
     * mehr Meter, gemessen von 263 m im zweiten Gebiet bis 793 m ab dem
     * elften. Ein Gebiet dauert dadurch heute zwischen 86 s (früh, langsam)
     * und 37 s (spät, schnell).
     *
     * Die Härte hängt weiter allein an der ZEIT — stetig, ohne Stufen, ohne
     * die Gebietsliste zu lesen. Sie ist damit vom Wandwechsel entkoppelt:
     * der Hintergrund wechselt jetzt öfter als die Härte um 25 % steigt. Das
     * ist Absicht. Der Wandwechsel ist die Abwechslung, die Härtekurve ist
     * die Schwierigkeit, und die beiden müssen nicht denselben Takt haben.
     *
     * Wer die Zahl ändert, ändert das ganze Spiel — sie ist der Nenner in
     * `haerte = proWand ^ (t / sekundenProWand)`. Die Gebietslängen dagegen
     * rechnet scripts/_gebietsmeter.mjs aus. */
    /* NUR NOCH RÜCKFALL. Solange `gebietsGrenzen` gesetzt ist (das ist im
     * Spiel immer der Fall, siehe Ende dieser Datei), zählt die Härte an den
     * echten Gebieten und diese Zahl wird nicht benutzt. Sie bleibt für
     * Werkzeuge stehen, die die Kurve ohne Gebietsliste bauen. */
    sekundenProWand: 132,

    /* +13 % JE GEBIET — und „Gebiet" heisst jetzt wirklich Gebiet.
     *
     * Vorher stand hier 1.25, aber die Härte lief an einer 132-Sekunden-Uhr,
     * während ein Gebiet 37 bis 87 Sekunden dauert. Pro Gebiet kamen davon
     * je nach Länge nur 7 bis 19 % an, und der Schritt lag irgendwo mitten
     * im Gebiet statt an seinem Anfang. Deshalb war die Steigerung nicht zu
     * spüren, obwohl sie rechnerisch da war.
     *
     * Jetzt greift der Faktor genau am Gebietswechsel. 1.25 wäre damit
     * masslos: über 20 Wechsel ergäbe das die 87-fache Härte, Tempo und
     * Dichte hingen ab Gebiet 10 am Anschlag und die letzten sieben Gebiete
     * wären untereinander völlig gleich.
     *
     * 1.0905 über 20 Wechsel ergibt Härte 5.6 — und genau damit erreicht
     * das Tempo im Weltall seinen Deckel von 20.5. Gerechnet, nicht geschätzt:
     *     proWand = ((tempoMax / tempoStart)^(1/tempoExponent))^(1/20) */
    proWand: 1.0905,

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
      /* 7.0 STATT 4.18 — DER ANFANG WAR DER EIGENTLICHE FEHLER.
       *
       * Drei Runden lang lautete die Rückmeldung "immer noch zu einfach",
       * zuletzt: "ich kam locker auf Stufe 5". Nachgemessen war das kein
       * Gefühl, sondern Arithmetik. Vorwarnzeit = Reaktionsstrecke / Tempo,
       * mit 6.491 Einheiten Strecke:
       *
       *     Gebiet 1   4.18  ->  1553 ms
       *     Gebiet 5   5.47  ->  1186 ms
       *
       * Anderthalb Sekunden, um einem Stein auszuweichen, der aus drei
       * möglichen Bahnen fällt. Das ist kein Geschicklichkeitsspiel, das ist
       * Zusehen. Und weil die Kurve beim Startwert beginnt, half jede
       * Erhöhung am OBEREN Ende nichts für die ersten fünf Minuten — genau
       * die Minuten, die jeder Spieler sieht.
       *
       * Mit 7.0:
       *     Gebiet 1  ->  927 ms
       *     Gebiet 5  ->  743 ms   (-37 %)
       *
       * Der Preis steht im Kommentar zu `proWand`: ein höherer Start staucht
       * die Kurve, der Schritt je Gebiet sinkt von 11.4 auf 9.1 %. Das ist
       * der richtige Tausch — die absolute Härte an jeder Stelle zählt mehr
       * als die Grösse des Sprungs zwischen zwei Gebieten. */
      start: 7.0,
      /* 16.0 -> 13.6, WEIL DER AFFE HÖHER SITZT.
       *
       * Seit er senkrecht festgenagelt ist, steht er auf y = -0.1 statt -1.4,
       * also 1.30 Einheiten weiter oben. Die Vorwarnstrecke schrumpft dadurch
       * von 5.394 auf 4.094 Einheiten (-24 %); bei Tempo 16.0 blieben nur noch
       * 0.256 s — unter der Schwelle, die dieser Abschnitt selbst als Grenze
       * zwischen Reagieren und Raten nennt.
       *
       * 13.6 stellt die alte Vorwarnzeit wieder her:
       *   vorher   5.394 / 16.0 = 0.337 s
       *   jetzt    4.094 / 13.6 = 0.301 s
       * Derselbe Schwierigkeitsgrad, nur mit kürzerem Weg und weniger Tempo.
       *
       * Diese Zahl gehört zu player.startPosition[1]. Wer eine ändert, muss
       * die andere nachrechnen. */
      /* 20.5 statt 16.0 — UND DIE WENDIGKEIT WÄCHST MIT.
       *
       * Der Absatz oben rechnet mit einer Vorwarnstrecke von 4.094
       * Einheiten. Das stimmte, als der Affe auf y = -0.1 sass. Er sitzt
       * längst auf y = -2.6 (player.startPosition). Nachgemessen im
       * laufenden Spiel, durch echte Unprojektion der oberen Bildkante auf
       * die Spielebene z = 0:
       *
       *     sichtbar oben            5.051
       *     Affenmitte              -2.600
       *     minus Trefferradien     -1.160   (0.42 Affe + 0.74 grosses Objekt)
       *     -----------------------------------
       *     Reaktionsstrecke         6.491 Einheiten
       *
       * ACHTUNG, HIER IRRT MAN SICH LEICHT: `1.9 + 11.5 * tan(fov/2)` ergibt
       * 6.781 und ist FALSCH. Die Kamera ist um 7.68 Grad nach unten
       * geneigt; die halbe Bildhöhe einer ungeneigten Kamera hat mit der
       * Sichtkante auf der Spielebene nichts zu tun. Wer nachmisst, muss
       * unprojizieren, nicht den Tangens nehmen — sonst kommen 21 % zu viel
       * heraus.
       *
       * Immer noch deutlich mehr als die 4.094 von damals. Bei Tempo 14.3
       * blieben dadurch 454 ms Vorwarnung; die Kurve war für ein Spiel
       * getunt, das es nicht mehr gibt, und genau deshalb liess sich der
       * Deckel mühelos ausspielen.
       *
       * 20.5 lässt 6.491 / 20.5 = 317 ms und wird erst im letzten Gebiet
       * (Weltall) erreicht.
       *
       * WARUM DAS TROTZDEM FAIR BLEIBT — und warum es vorher bei 16 endete.
       *
       * Der Fairness-Prüfer wies 18 einmal ab, und zwar wegen des trägsten
       * Affen: der orange erreichte im kürzesten Fenster nur noch 15 % seiner
       * Höchstgeschwindigkeit. Der Engpass war also nicht das SEHEN, sondern
       * das AUSWEICHEN.
       *
       * Deshalb wächst jetzt die Wendigkeit mit: moveSpeed und acceleration
       * aller drei Affen sind mit demselben Faktor 20.5/16 = 1.28 skaliert.
       * Der Trägheitsfaktor hängt am Produkt a×T mit T = mindestAbstand /
       * tempo.max — steigen a und tempo.max gemeinsam, bleibt a×T gleich und
       * die Geometrie damit unverändert fair.
       *
       * SCHWERER WIRD ES TROTZDEM, denn eines skaliert nicht mit: die
       * menschliche Reaktionszeit. Die Vorwarnung sinkt von 406 auf 317 ms,
       * und das ist der ganze Punkt.
       *
       * WER HIER DREHT, MUSS DIE WENDIGKEIT MITZIEHEN und danach messen:
       *     node scripts/fairness.mjs --sekunden 1100 */
      max: 20.5,
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
      start: 1.0,

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

      /* ─── ZWEI AUF EINMAL ─────────────────────────────────────────────
       *
       * Salven kommen NACHEINANDER — man weicht einer nach der anderen aus,
       * und bei drei Bahnen sind in jedem Moment zwei sicher. Das war zu
       * einfach: man konnte fast stehenbleiben.
       *
       * Ein Doppelabwurf legt zwei Objekte GLEICHZEITIG auf zwei
       * verschiedene Bahnen. Damit bleibt genau eine frei — und zwar die,
       * die der Korridor ohnehin zusichert. Der Affe muss also wirklich
       * dorthin, statt nur ungefähr auszuweichen.
       *
       * Die Garantie bleibt wörtlich unangetastet: beide Objekte stammen aus
       * derselben Liste freier Bahnen, die auch der Einzelabwurf benutzt
       * (Spawner._freieStelle -> _letzteFreie).
       *
       * `abWand` und `vollAbWand` sind WANDINDIZES — und die zählen jetzt
       * GEBIETE: 0 = erstes Gebiet, 20 = Weltall. Vorher waren es
       * 132-Sekunden-Blöcke; die alten Werte 1.0 und 5.0 lagen damit bei
       * rund zwei und elf Minuten Spielzeit. */
      doppel: {
        /* AB GEBIET 2, VOLL AB GEBIET 8.
         *
         * Auf der alten Zeitskala fing die Rampe nach zwei Minuten an und
         * war nach elf Minuten fertig — gemessen kamen über zwölf Minuten
         * nur 9.7 % der Abwurfmomente doppelt. Auf der Gebietsskala
         * bedeuteten dieselben Zahlen sogar noch weniger, weil ein Gebiet
         * kürzer ist als ein 132-Sekunden-Block.
         *
         * 1.0 heisst: gleich nach dem Einstiegsgebiet fällt zum ersten Mal
         * etwas von zwei Seiten. 8.0 heisst: ab der Spielmitte ist es der
         * Normalfall. chanceMax 0.7 statt 0.5, damit „von zwei Seiten" im
         * Endspiel wirklich die Regel ist und nicht die Ausnahme.
         *
         * Die Lückengarantie bleibt davon unberührt — beide Objekte kommen
         * aus derselben Liste freier Bahnen. Nachgewiesen mit
         * npm run test:fair. */
        abWand: 1.0,
        vollAbWand: 8.0,
        chanceMax: 0.7,
      },
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
      /* WIRD SEIT DER BAHN-UMSTELLUNG NIRGENDWO MEHR GELESEN.
       *
       * Der Wert stammt aus der Zeit der stufenlosen Platzierung: die freie
       * Bahn sperrte links und rechts einen Streifen dieser Halbbreite, in
       * dem nichts fallen durfte. Er wurde von 0.5 auf 0.28 gesenkt, weil im
       * Hochformat sonst 63 % des Feldes dauerhaft blockiert waren.
       *
       * Beide Stellen, die ihn benutzt haben, rechnen inzwischen anders:
       *
       *   Spawner._freieStelle          sperrt BAHNEN (_noetigeBahnen) und
       *                                 misst den Abstand mit `rand +
       *                                 reserve`. Kein Band mehr.
       *   Spawner._tempoDamitPlatzBleibt leitet die erlaubte Wanderung aus
       *                                 derselben Schwelle her.
       *
       * Der Eintrag bleibt stehen, weil ein gelöschter Schlüssel in einer
       * Konfigurationsdatei aussieht, als hätte man ihn vergessen. Wer ihn
       * ändert, ändert nichts — das ist die einzige wichtige Aussage hier. */
      halbbreite: 0.28,
      tempoAnteil: 0.17,
      anteilStart: 0.45,
      anteilMax: 0.85,
      anteilVollAbWand: 20,
      maxSprung: 3.4,
      /* Zug der freien Bahn zum Rand (0 = keiner, 1 = nur noch Rand).
       * Damit die Objekte in der MITTE ankommen — die Begründung steht in
       * Korridor._naechsterAbschnitt und ist gegen die Anschauung.
       *
       * SEIT DER BAHN-SPERRE (Spawner._noetigeBahnen) MACHT DER WERT KAUM
       * NOCH EINEN UNTERSCHIED. Gemessen über je 500 s im Hochformat, Anteil
       * der Objekte je Bahn:
       *
       *     0.00   29.3 / 20.6 / 21.2 / 28.9
       *     0.32   28.2 / 22.6 / 22.2 / 27.1
       *     0.65   27.4 / 23.5 / 23.7 / 25.4
       *     1.00   27.3 / 22.9 / 22.2 / 27.7
       *
       * Die Unterschiede liegen im Rauschen einzelner Läufe. Der Rest —
       * aussen rund 28 %, innen rund 22 % statt je 25 % — ist keine
       * Einstellungssache, sondern Geometrie: eine innere Bahn hat zwei
       * Nachbarn, eine äussere nur einen, also wird sie öfter mitgesperrt.
       * Vor der Umstellung waren es 35 / 16 / 14 / 35 — DAS war eine
       * Schlagseite, das hier ist eine Nuance. Bleibt bei 0.32; ein anderer
       * Wert würde nur Rauschen nachfahren. */
      randSog: 0.32,

      /* Keine Bahn laenger als so viele Sekunden ohne Objekt.
       * Siehe Spawner._bahnWaehlen; 0 schaltet die Schranke ab. */
      maxTrockenZeit: 2.5,

      /* BAHNZIELE — die Bahn zielt auf Spuren statt auf beliebige Punkte.
       *
       * STEHT AUF false, es ändert sich also nichts. Eingebaut, weil die
       * Objekte sich ungleich über die Breite verteilen und `randSog` das
       * nachweislich nicht richten kann (Messung und Herleitung stehen bei
       * Korridor._bahnZiel).
       *
       * Auf true gestellt wählt die Bahn ihr Ziel unter den Spuren aus, mit
       * demselben Ausgleichszähler, den der Spawner für die Objekte benutzt:
       * wer selten dran war, kommt eher dran. Die Bahn GLEITET weiterhin —
       * sie springt nicht, sie zielt nur anders.
       *
       * Wer umschaltet, misst danach beides nach:
       *     node scripts/_bahnverteilung.mjs     Verteilung je Bahn
       *     npm run test:fair                    bleibt jedes Bild passierbar */
      bahnZiele: true,
      haltMin: 0.14,
      haltMax: 0.55,
      horizont: 3.8,
      zeitReserve: 0.1,
      reserve: 0.06, // war 0.1 — siehe oben
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
        fallFactor: 1.32, // schnell und flink
        spin: { min: 2.2, max: 4.4 },
      },
      {
        id: 'mittel',
        radius: 0.48,
        color: 0x6b6259, // die Referenzfarbe
        detail: 1, // runder
        fallFactor: 1.14,
        spin: { min: 0.9, max: 2.2 },
      },
      {
        id: 'gross',
        radius: 0.74,
        color: 0x3f3934, // dunkel und schwer
        detail: 0,
        /* 0.82 -> 1.0. NICHT MEHR LANGSAMER ALS DER REST.
         *
         * Der alte Wert stammt aus derselben Zeit wie der alte Tempodeckel:
         * damals blieben bei einem grossen Brocken rechnerisch 4.094 / 14.3
         * = 286 ms, und da war Bremsen richtig. Heute sind es 6.491 / 14.3 =
         * 454 ms, und der Brocken schleicht mit 0.82 auf 554 ms — er fiel
         * sichtbar aus dem Rhythmus und war das am leichtesten auszulassende
         * Objekt im Spiel.
         *
         * Mit 1.0 bleiben bei vollem Tempo 317 ms. Er ist damit immer noch
         * das langsamste der drei — klein 1.32, mittel 1.14 —, also bleibt
         * die Grössenklasse am Fallverhalten erkennbar. Er ist nur kein
         * Geschenk mehr. */
        fallFactor: 1.0,
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
      holz: {
        // Stock, Baumscheibe, Stamm. Der Stamm ist beim Aufbereiten um 90°
        // gedreht worden und fällt mit der Schnittfläche voran.
        bilder: ['holz_klein', 'holz_mittel', 'holz_gross'],
        /* NUR DER STOCK WIRD DOPPELT SO GROSS, nicht der ganze Satz.
         *
         * Der Stock ist lang und dünn und war vor der Blumenwand kaum vom
         * Gestrüpp zu unterscheiden — was man nicht sieht, kann man nicht
         * ausweichen, und dann ist es kein Hindernis, sondern eine Falle.
         *
         * Erst stand hier `bildScale: 2.1` für alle drei. Das hat auch den
         * STAMM verdoppelt, und der füllte damit ein Drittel des
         * Bildschirms. Scheibe und Stamm stehen deshalb wieder genau auf
         * ihrem alten Wert (1.05); nur der Stock ist grösser. */
        bildScaleSlots: [2.1, 1.05, 1.05],
        // Weniger Taumeln als beim Stein: Holz ist länglich, und was sich
        // schnell dreht, liest sich schlechter in seiner Fallrichtung.
        taumeln: 10,
        form: 'zylinder',
        // Rückfallfarben, falls ein Bild fehlt — Rinde und Kernholz.
        farben: [0xa9855c, 0x7a5433, 0x4e3520],
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

      /* --- Die vier späten Wände ---------------------------------------- */

      metall: {
        // Schraube, Wellblech, Zahnrad.
        bilder: ['metall_klein', 'metall_mittel', 'metall_gross'],
        bildScale: 1.05,
        // Schrott dreht sich beim Fallen kräftig — es ist kantig und leicht.
        taumeln: 22,
        form: 'dodekaeder',
        farben: [0x8a6a52, 0x7f8a90, 0x5f4a3c],
        leuchten: 0,
        glanz: 0.45,
      },

      bonbon: {
        // Bonbon, Keks, Lutscher.
        bilder: ['bonbon_klein', 'bonbon_mittel', 'bonbon_gross'],
        bildScale: 1.0,
        taumeln: 14,
        form: 'kugel',
        farben: [0xf2a0c0, 0xd8a05a, 0xef6f9e],
        leuchten: 0,
        glanz: 0.5,
      },

      kaktus: {
        // Stück, Ohr, Säulenkaktus. Der grosse ist gedreht und fällt mit
        // der Krone voran.
        bilder: ['kaktus_klein', 'kaktus_mittel', 'kaktus_gross'],
        bildScale: 1.1,
        // Wenig Taumeln: ein Kaktus ist schwer und länglich.
        taumeln: 8,
        form: 'zylinder',
        farben: [0x6f9e52, 0x84ac5e, 0x5c8a46],
        leuchten: 0,
        glanz: 0.1,
      },

      ruine: {
        // Ziegel, Schriftplatte, Steinkopf.
        bilder: ['ruine_klein', 'ruine_mittel', 'ruine_gross'],
        bildScale: 1.05,
        taumeln: 11,
        form: 'dodekaeder',
        farben: [0xb06a4a, 0xa89880, 0x8a8c8e],
        leuchten: 0,
        glanz: 0.05,
      },

      /* ---------------------------------------------------------------- *
       *  DIE FÜNF ENDGEBIETE
       *
       *  Alle fünf liegen HINTER dem bisherigen Spielende. Wer sie sieht,
       *  ist schon weiter gekommen als die alte Reihe überhaupt reichte —
       *  entsprechend ist hier nichts mehr freundlich gemeint.
       * ---------------------------------------------------------------- */
      pirat: {
        // Enterhaken, Pulverfass, Anker.
        bilder: ['pirat_klein', 'pirat_mittel', 'pirat_gross'],
        bildScale: 1.05,
        taumeln: 12,
        form: 'dodekaeder',
        farben: [0x8a8f96, 0xa9713f, 0x9aa0a6],
        leuchten: 0,
        glanz: 0.12, // Metall
      },
      biene: {
        // Honigtropfen, Wabenstück, triefende Grosswabe.
        bilder: ['biene_klein', 'biene_mittel', 'biene_gross'],
        bildScale: 1.05,
        taumeln: 9, // zäh, kein hektisches Trudeln
        form: 'ikosaeder',
        farben: [0xe8a33d, 0xf0b545, 0xd98f2a],
        leuchten: 0.05,
        glanz: 0.2, // Honig glänzt
      },
      buch: {
        // Schreibfeder, rotes Buch, beschlagener Wälzer.
        bilder: ['buch_klein', 'buch_mittel', 'buch_gross'],
        bildScale: 1.05,
        taumeln: 15, // Bücher überschlagen sich
        form: 'wuerfel',
        farben: [0xe8e8ee, 0x9c3b39, 0x7a5638],
        leuchten: 0,
        glanz: 0.04,
        /* Die Bibliothekswand ist dunkles Holz bei Kerzenlicht — dieselbe
         * Lage wie bei der Ruine. Die Objekte werden deshalb aufgehellt,
         * sonst verschwindet der braune Wälzer im Regal. */
      },
      zirkus: {
        // Kegel, Wasserball, Kanonenkugel.
        bilder: ['zirkus_klein', 'zirkus_mittel', 'zirkus_gross'],
        bildScale: 1.05,
        taumeln: 16,
        form: 'ikosaeder',
        farben: [0xe04b4b, 0x3fa9e0, 0x2a2a2e],
        leuchten: 0,
        glanz: 0.16,
      },
      meteor: {
        // Brennender Meteor, Lavabrocken, grauer Asteroid.
        bilder: ['meteor_klein', 'meteor_mittel', 'meteor_gross'],
        bildScale: 1.05,
        taumeln: 7, // im Vakuum trudelt nichts hektisch
        form: 'ikosaeder',
        farben: [0xff7a2a, 0xd8452a, 0x9a9086],
        leuchten: 0.35, // der brennende Meteor glüht
        glanz: 0,
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
    /* GROSSE OBJEKTE KOMMEN VIEL FRÜHER UND VIEL ÖFTER.
     *
     * Vorher tauchten sie erst ab Wand 1.5 überhaupt auf und blieben lange
     * die Ausnahme (10 %, 25 %, 35 %). Im Spiel sah man fast nur Kiesel.
     * Dabei sind die Brocken das, was man am besten LIEST — sie sind gross,
     * sie kündigen sich an, und ihnen auszuweichen fühlt sich nach einer
     * Entscheidung an.
     *
     * Jetzt sind die drei Grössen von Anfang an fast gleich verteilt und
     * bleiben es. Die Lückengarantie hängt nicht an der Grössenmischung,
     * sondern am Korridor — geprüft mit npm run test:fair. */
    /* ACHTUNG, DIE SKALA HAT SICH GEÄNDERT.
     *
     * `abWand` zählt jetzt GEBIETE: 0 = erstes Gebiet, 20 = Weltall. Vorher
     * zählte es 132-Sekunden-Blöcke und kam am Spielende gerade auf 6.7 —
     * die beiden letzten Zeilen (9 und 12) waren toter Code, sie wurden nie
     * erreicht. Auf die neue Skala gestreckt bleibt die Mischung bis ins
     * letzte Gebiet in Bewegung. */
    mix: [
      { abWand: 0, weights: [40, 35, 25] },
      { abWand: 3, weights: [35, 35, 30] },
      { abWand: 6, weights: [32, 34, 34] },
      { abWand: 9, weights: [30, 35, 35] },
      // Ganz spät verschiebt sich der Druck von der Menge auf das Gewicht:
      // mehr Brocken statt noch mehr Objekte. Ein Brocken sperrt mehr Breite
      // und zwingt zu früherem Ausweichen, ohne den Bildschirm zuzustellen.
      { abWand: 13, weights: [26, 35, 39] },
      { abWand: 17, weights: [22, 35, 43] },
    ],
  },

  /* ================================================================== *
   *  TON — zwei getrennte Wege
   *
   *  MUSIK kommt aus Dateien: zwölf komponierte Stücke, eins je Wand, in
   *  public/musik. Sie entstehen mit `npm run prep:musik` aus den Vorlagen.
   *
   *  EFFEKTE (Münze, Treffer, Game Over, Affenruf, Freischalten) entstehen
   *  weiterhin zur Laufzeit aus Rauschen und Oszillatoren — sie müssen im
   *  Millisekundenbereich auslösen und kosten so null Byte.
   *
   *  Hier standen 150 Zeilen Rezepte für prozedurale Gebietsatmosphären:
   *  gefiltertes Rauschen, Dauertöne, einzelne Vogelrufe. Der Notbehelf,
   *  solange es keine Musik gab. Beides gleichzeitig wäre nur Matsch
   *  gewesen — die Rezepte sind raus.
   *
   *    toene[]  { von, bis, dauer, gain, form, rauschen, verzoegerung }
   * ================================================================== */
  klang: {
    anAmAnfang: true,
    // Merkt sich die Stummschaltung über das Neuladen hinweg.
    speicherSchluessel: 'jungle-climber.stumm.v1',
    lautstaerke: 0.32,

    /* ECHTE AUFNAHMEN für einzelne Effekte.
     *
     * Sie schlagen das Rezept unten, sobald sie geladen sind — das Rezept
     * bleibt als Rückfall, solange die Datei noch unterwegs ist oder fehlt.
     * Entstehen mit `npm run prep:klaenge` aus den Vorlagen im
     * Downloads-Ordner (scripts/prepare-klaenge.mjs).
     *
     * Ohne Endung: Musik.js und Klang.js wählen .ogg oder .mp3 selbst. */
    proben: {
      banane: '/klang/banane',
      affe: '/klang/affe',
    },
    /* WANN DER AFFE VON SICH HÖREN LÄSST.
     *
     * Ein fester Takt fällt sofort als Takt auf und wird zur Belästigung.
     * Deshalb eine Folge WECHSELNDER Abstände, die reihum durchlaufen wird —
     * mal kommt schnell einer, mal dauert es. Dazu eine kleine Streuung, damit
     * auch die Folge selbst nicht erkennbar wird.
     *
     * `beiMuenze` / `beiBanane`: mit dieser Wahrscheinlichkeit ruft er direkt
     * nach dem Einsammeln — als würde er sich freuen. Das ist die Stelle, an
     * der der Ruf am meisten Sinn ergibt, deshalb häufiger als von allein.
     * `nachErfolgVerzoegerung` schiebt ihn hinter den Münzklang, sonst reden
     * beide gleichzeitig. */
    affenRuf: {
      abstaende: [10, 20, 15, 20, 5, 25, 12, 30],
      streuung: 0.25, // ±25 % auf jeden Abstand
      beiMuenze: 0.18,
      beiBanane: 0.65,
      nachErfolgVerzoegerung: 0.28,
    },

    /* Pegel der Aufnahmen gegenüber den erzeugten Effekten.
     *
     * Gemessen bei 0.85: Banane Spitze 0.265, Affe 0.248 — gegen die Münze
     * mit 0.069 also fast das VIERFACHE. Die Aufnahmen sind zudem länger und
     * wirken dadurch nochmal lauter. 0.42 bringt sie auf rund das
     * Anderthalbfache der Münze: hörbar wichtiger, aber kein Schreck. */
    probenPegel: 0.42,
    /* Zufällige Tonhöhenstreuung je Auslösung (±Anteil). Derselbe Klang
     * zwanzigmal exakt gleich klingt nach Maschine; 6 % fallen einzeln nicht
     * auf, in der Wiederholung aber sehr wohl. */
    probenStreuung: 0.06,

    /* --------------------------------- GEBIETSMUSIK -------------------- *
     * Je Wand ein komponiertes Stueck, in Dauerschleife, ueberblendet beim
     * Wechsel. Die Dateien entstehen aus den Vorlagen mit
     * `npm run prep:musik` (siehe scripts/prepare-musik.mjs) und liegen in
     * zwei Formaten bereit; Musik.js waehlt beim Start aus.
     *
     * HIER STANDEN 150 ZEILEN REZEPTE fuer prozedurale Atmosphaeren:
     * gefiltertes Rauschen, Dauertoene, einzelne Vogelrufe. Die waren der
     * Notbehelf, solange es keine Musik gab. Beides gleichzeitig laufen zu
     * lassen waere nur Matsch gewesen, also sind sie raus.
     *
     * Die kurzen EFFEKTE weiter unten bleiben prozedural: Muenze, Treffer,
     * Game Over und Affenruf muessen im Millisekundenbereich ausloesen,
     * dafuer ist eine Datei der falsche Weg.
     * ------------------------------------------------------------------ */
    musik: {
      ordner: '/musik/',
      /* EINHEITLICHE LAUTSTAERKE fuer alle zwoelf Stuecke.
       *
       * Das ist keine Bequemlichkeit, sondern das Ergebnis der Aufbereitung:
       * prepare-musik.mjs gleicht jedes Stueck auf -17 LUFS an (EBU R128,
       * dasselbe Verfahren wie Radio und Streamingdienste). Sie sind danach
       * gleich laut, also braucht es hier keine Einzelwerte mehr — frueher
       * stand bei jedem Gebiet ein eigener Faktor, weil die prozeduralen
       * Klaenge um bis zu 12 dB auseinanderlagen.
       *
       * `pegel` bleibt als Ausnahmefach: traegt man dort ein Gebiet ein,
       * gilt der Wert nur fuer dieses. Absichtlich leer. */
      /* WELCHES TONFORMAT AUSGELIEFERT WIRD.
       *
       * 'mp3'  = nur MP3 im Paket. Spielt JEDER Browser, auch iOS vor 17.
       * 'ogg'  = nur Ogg.
       * 'auto' = beide Formate liegen bei, der Browser wählt.
       *
       * Stand auf 'auto', und beides wurde mitgeliefert — die Musik lag also
       * doppelt im Paket und machte allein 54 von 63 MB aus. Ein Browser lädt
       * aber immer nur EINES davon; die zweite Fassung ist reiner Ballast auf
       * dem Weg zum Portal.
       *
       * Jetzt nur MP3. Nicht Ogg, obwohl es etwas kleiner wäre: MP3 spielt
       * wirklich überall, Ogg fehlt auf älteren iPhones. Bei einem Format ist
       * die verlässlichere Wahl die richtige.
       *
       * ACHTUNG: Dieser Wert und das, was `npm run prep:musik` erzeugt,
       * gehören zusammen. Steht hier 'mp3', im Ordner liegen aber nur .ogg,
       * ist das Spiel STUMM — und zwar lautlos, weil `<audio>` einen 404
       * nicht meldet. `npm run paket` prüft das jetzt mit. */
      format: 'mp3',

      grundPegel: 0.55,
      pegel: {},
      // Ueberblendung beim Gebietswechsel (Sekunden).
      wechselFade: 2.2,
      /* Ueberblendung am Schleifenpunkt. Die Stuecke sind nicht als
       * Schleife komponiert — ihr Ende fuehrt nicht zurueck zum Anfang.
       * Musik.js startet deshalb kurz vor Schluss einen zweiten Abspieler
       * von vorn und blendet ueber. */
      schleifeFade: 3.0,

      /* ------------------------------------------------------ TEMPO ------ *
       * Mit jedem Gebiet läuft die Musik ein Stück schneller.
       *
       * Gezählt werden die GEBIETSWECHSEL SEIT RUNDENBEGINN, nicht der Index
       * in CONFIG.wall.stages: nach dem letzten Gebiet geht es zyklisch von
       * vorn los, ein index-basiertes Tempo fiele dort auf 1.0 zurück und
       * das Spiel würde mitten im schwersten Abschnitt wieder gemütlich.
       *
       *   Gebiet 1    1.00   normal
       *   Gebiet 6    1.16   zügig
       *   Gebiet 12   1.35   hektisch (Deckel)
       *
       * TONHÖHE BLEIBT: `preservesPitch` hält sie fest. Ohne das klänge das
       * letzte Gebiet wie ein zu schnell laufendes Tonband — schneller UND
       * schriller. So klingt die Musik weiter nach sich selbst.
       *
       * Der Deckel ist Pflicht, nicht Vorsicht: die Wände laufen zyklisch
       * endlos weiter. Ohne ihn wäre die Musik nach einer halben Stunde
       * unhörbar schnell. */
      /* 0.0275 JE GEBIET, DECKEL 1.55 — so gewählt, dass der Deckel exakt im
       * letzten Gebiet erreicht wird:  1 + 20 × 0.0275 = 1.55.
       *
       * Vorher: 0.032 mit Deckel 1.35. Der Deckel fiel damit schon in
       * Gebiet 12, und die letzten zehn Gebiete liefen alle gleich schnell —
       * ausgerechnet dort, wo der Druck am stärksten steigen soll, stand die
       * Musik still. Jetzt zieht sie über die ganze Strecke mit an: jedes
       * einzelne Gebiet ist hörbar schneller als das davor.
       *
       * Der Deckel bleibt Pflicht, weil die Wände hinter dem Weltall
       * zyklisch weiterlaufen — ohne ihn wäre die Musik nach einer halben
       * Stunde unhörbar schnell. */
      tempoProGebiet: 0.0275,

      tempoMax: 1.55,
      /* Wie lange das neue Tempo braucht (Sekunden). Ein Sprung mitten im
       * Takt ist deutlich hörbar; über die Wechselblende hinweg fällt die
       * Änderung nicht auf. */
      tempoFade: 2.2,
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

      /* Banane: ein zweites LEBEN, kein Kleingeld — und das muss man hören.
       *
       * Die Münze sind zwei kurze, harte Rechteck-Töne. Die Banane bekommt
       * bewusst das Gegenteil: ein aufsteigender Dreiklang aus weichen
       * Dreieckstönen, spürbar länger, mit einem vierten Ton eine Oktave
       * über dem ersten als Abschluss. Aufsteigend heisst "gewonnen", die
       * Länge heisst "wichtig", das weiche Timbre unterscheidet es vom
       * Klimpern der Münzen.
       *
       * Bis hierher hatte das Einsammeln einer Banane ÜBERHAUPT keinen
       * Klang — man bekam ein zweites Leben und merkte es nur am Symbol. */
      banane: {
        mindestAbstand: 0.2,
        toene: [
          { von: 523, bis: 523, dauer: 0.16, gain: 0.2, form: 'triangle' },
          { von: 659, bis: 659, dauer: 0.16, gain: 0.2, form: 'triangle', verzoegerung: 0.075 },
          { von: 784, bis: 784, dauer: 0.2, gain: 0.21, form: 'triangle', verzoegerung: 0.15 },
          { von: 1047, bis: 1047, dauer: 0.5, gain: 0.19, form: 'triangle', verzoegerung: 0.24 },
          // Leiser Oberton darüber: gibt Glanz, ohne schriller zu werden.
          { von: 2093, bis: 2093, dauer: 0.4, gain: 0.05, form: 'sine', verzoegerung: 0.24 },
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

      /* --- Chili und Goldrausch ------------------------------------------ *
       * Beide bewusst KURZ. Sie kommen mitten im Spiel, und ein langer
       * Klang legt sich über die Geräusche, an denen man sich orientiert. */
      chili: {
        mindestAbstand: 0.2,
        // Aufsteigendes Zischen: der Schub.
        toene: [
          { von: 180, bis: 1400, dauer: 0.55, gain: 0.2, rauschen: true, guete: 0.6 },
          { von: 330, bis: 990, dauer: 0.4, gain: 0.14, form: 'sawtooth' },
        ],
      },

      warnung: {
        mindestAbstand: 0.3,
        // Zwei harte Stösse — das liest man als "Achtung", nicht als Melodie.
        toene: [
          { von: 740, bis: 700, dauer: 0.1, gain: 0.18, form: 'square' },
          { von: 740, bis: 700, dauer: 0.1, gain: 0.18, form: 'square', verzoegerung: 0.16 },
        ],
      },

      sturz: {
        mindestAbstand: 0.15,
        // Abwärtsrauschen: etwas kommt herunter.
        toene: [{ von: 2200, bis: 300, dauer: 0.35, gain: 0.16, rauschen: true, guete: 0.8 }],
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
    /* 20 STATT 6 — VORSORGE FÜRS GOLD-GEBIET, kein behobener Fehler.
     *
     * Ehrlich gemessen, nachdem ich mich zuerst selbst hereingelegt hatte:
     * im Gold-Gebiet fällt alle 0.88 s eine Münze, und es sind dabei nur
     * RUND VIER gleichzeitig unterwegs (Flugzeit knapp 3 s bei Anfangstempo,
     * später weniger, weil alles schneller fällt). Sechs Plätze hätten also
     * gereicht.
     *
     * Trotzdem 20, und zwar wegen der Art des Fehlers: läuft der Pool leer,
     * steigt `_spawnCoin` STILL aus (`if (!coin) return`) — keine Warnung,
     * kein Protokolleintrag, nur weniger Münzen als gedacht. Bei vier von
     * sechs belegten Plätzen ist der Abstand zum stillen Ausfall zu klein;
     * ein langsamerer Fall oder ein kürzerer Takt genügte. Ein Pool-Platz
     * ist ein Mesh und kostet praktisch nichts.
     *
     * (Die Fehlmessung, die mich zuerst auf „nur 5 statt 34 Münzen" brachte,
     * zählte Münz-OBJEKTE statt Abwürfe — bei einem Pool wird dasselbe
     * Objekt wiederverwendet, mehr als `poolSize` verschiedene kann es gar
     * nicht geben. Der Goldregen war die ganze Zeit richtig.) */
    poolSize: 20,
    // Bild aus scripts/prepare-hazards.mjs (nur die KLEINSTE der drei
    // gelieferten Münzen, ausdrücklicher Wunsch).
    bild: '/hazards/muenze.webp',
    /* ZURÜCK AUF 0.34. Ich hatte das kurzzeitig auf 0.47 gezogen — falsch
     * verstanden: die Münze IM SPIEL war schon richtig gross. Zu klein war
     * das Symbol in der Anzeige oben, und das ist ein eigenes Bild
     * (.hud__coin-icon in style.css). */
    radius: 0.34,
    hitRadiusFactor: 1.35, // grosszügig: Einsammeln soll sich gut anfühlen
    // Langsamer als die Hindernisse. Eine Münze im Steintempo wäre kein
    // Bonus, sondern ein zweiter Reflextest.
    fallSpeedFactor: 0.55,
    /* Pendeln um die Abwurfstelle — fällt im Bild auf, ohne davonzudriften.
     *
     * 0.28 STATT 0.55. Die Münze wird jetzt auf einer Bahn abgeworfen, und
     * dort muss sie auch bleiben. Nachgerechnet für den weissen Affen, der
     * die kleinste Hitbox hat: sein Radius 0.21 plus der Münzradius
     * 0.34·1.35 = 0.46 ergibt 0.67 Einsammelreichweite. Bei ±0.55 Ausschlag
     * blieben davon 0.12 übrig — man musste die Münze im richtigen Moment
     * des Pendelns erwischen. Mit 0.28 ist sie über den ganzen Ausschlag
     * erreichbar, und man sieht das Schwingen immer noch. */
    pendelWeite: 0.28,
    pendelTempo: 2.2,

    /* Wie viele Münzen ein Gebiet hergibt.
     *
     * ALLES MAL ZEHN — Münzen wie Preise. Der Aufwand für einen Affen bleibt
     * damit exakt derselbe (rund 33 Gebiete für den weissen), aber die Zahlen
     * fühlen sich nach mehr an: "30 gesammelt" liest sich besser als "3", und
     * "1000" ist ein Ziel, "100" ist Kleingeld.
     *
     * Bei 132 s je Wand kommt jetzt etwa alle 4 Sekunden eine. */
    proGebiet: 30,
  },

  /* ================================================================== *
   *  BANANEN (Wiederbelebung)
   * ================================================================== */
  banana: {
    // Freigestelltes Bild statt der früheren Torus-Form.
    bild: '/hazards/banane.webp',
    // 176x224 — die Banane steht hochkant.
    bildSeite: 176 / 224,
    spriteScale: 1.7,
    poolSize: 8,
    // Wahrscheinlichkeit, dass ein Spawn-Event eine Banane statt eines Steins wirft.
    spawnChance: 0.085,
    // Keine Banane spawnen, solange der Spieler schon eine gebunkert hat.
    suppressWhenStocked: true,

    /* FRÜHESTENS AM ENDE DES ZWEITEN GEBIETS.
     *
     * Im ersten Gebiet lernt man das Spiel. Eine zweite Chance, bevor man
     * die erste verstanden hat, nimmt dem Anfang den Ernst — und wer sie
     * dort einsammelt, weiss gar nicht, was er da hat.
     *
     * Ein Gebiet dauert 132 s, das zweite endet also bei 264 s. 230 s liegt
     * kurz davor: sie taucht im letzten Viertel des zweiten Gebiets auf. */
    abSekunde: 230,

    /* HÖCHSTENS EINE JE GEBIET.
     *
     * Sie ist ein zweites Leben, kein Sammelobjekt. Zwei davon in einem
     * Gebiet wären keine Belohnung mehr, sondern ein Polster — und mit
     * Polster spielt man anders, nämlich schlechter. */
    proGebiet: 1,

    /* SPERRFRIST NACH EINEM VERBRAUCHTEN EXTRALEBEN, gezählt in Gebieten.
     *
     * Wer einen Treffer mit der Banane überlebte, fand im nächsten Gebiet
     * sofort die nächste — `proGebiet` wird beim Gebietswechsel ja
     * zurückgesetzt, und eine weitere Regel gab es nicht. Ein Treffer kostete
     * damit nur eine Schrecksekunde statt des Laufs.
     *
     * Ein bis zwei Gebiete, zufällig gewählt: bei einem festen Wert wüsste
     * man nach dem zweiten Wechsel genau, dass sie wieder kommt, und spielte
     * bis dahin auf Sicherheit. So bleibt der Zeitpunkt offen. */
    sperreGebiete: { min: 1, max: 2 },

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

    /* ================================================================== *
     *  ZWISCHENSPOT — Werbung zwischen zwei Runden
     *
     *  Kommt beim Druck auf „Nochmal", also NACH einer Runde und VOR der
     *  nächsten. Nicht beim Erscheinen des Game-Over-Bildschirms: dort will
     *  man erst seine Meter sehen, und ein Spot, der einem das Ergebnis
     *  wegnimmt, ist der sicherste Weg zu einer schlechten Bewertung.
     *
     *  DIE SPERRE IST DER EIGENTLICHE PUNKT.
     *
     *  Wer viermal in zwanzig Sekunden stirbt — und das passiert in diesem
     *  Spiel ständig, gerade am Anfang —, bekäme sonst vier Spots in zwanzig
     *  Sekunden. Das ist der Moment, in dem Leute das Spiel schliessen und
     *  nicht wiederkommen; die Portale werten so etwas auch selbst ab.
     *
     *  Deshalb: mindestens 90 Sekunden zwischen zwei Spots, gerechnet ab dem
     *  ENDE des letzten. Die Sperre gilt für ALLE Spots gemeinsam — auch für
     *  den belohnten, mit dem man weiterspielt. Wer eben einen gesehen hat,
     *  um weiterzumachen, bekommt danach nicht sofort noch einen.
     * ================================================================== */
    zwischenspot: {
      an: true,
      /* Sekunden zwischen zwei Spots, ab dem Ende des vorigen.
       *
       * 120 statt 90. Im SDK steht `midroll: 180000` — der Takt, in dem das
       * Portal von sich aus einen Zwischenspot legt. Gemessen liefert es auf
       * ausdrückliche Anfrage aber auch deutlich früher (13 Sekunden nach dem
       * Preroll ein voller Spot), es ist also keine harte Sperre.
       *
       * 120 liegt bewusst darunter: der Zwischenspot soll den Takt des
       * Portals nicht doppelt bedienen, aber auch nicht drei Minuten lang
       * ausfallen. Der belohnte Spot fürs Weiterspielen hat seine eigene,
       * kürzere Sperre (SPERRE_MS in Portal.js) — er ist der wertvollere von
       * beiden und darf öfter. */
      mindestAbstand: 120,
      /* Nach der allerersten Runde noch keiner.
       *
       * Die erste Runde ist der Eindruck, über den jemand entscheidet, ob er
       * bleibt. Wer dort schon eine Werbung sieht, bevor er das Spiel
       * überhaupt verstanden hat, ist weg. */
      abRunde: 2,
    },
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
    /* 'auto' erkennt das Portal selbst — ausser beim Play-Store-Bau.
     *
     * In einer Android-App gibt es kein Portal, und die Web-SDKs von
     * CrazyGames und GameMonetize laden dort gar nicht erst. `KeinPortal`
     * ist dann die richtige Antwort: das Spiel läuft, es kommt nur keine
     * Werbung (bis AdMob in der Hülle sitzt, siehe scripts/app-huelle.md).
     *
     * Umgestellt wird das beim BAUEN, nicht von Hand:
     *     VITE_ZIEL=playstore npm run build
     * `npm run paket` setzt die Variable für das Play-Store-ZIP selbst. So
     * kann niemand vergessen, sie vor dem Hochladen zurückzustellen. */
    provider: import.meta.env?.VITE_ZIEL === 'playstore' ? 'none' : 'auto',

    /* Von GameMonetize beim Anlegen des Spiels vergeben.
     *
     * SIE MUSS DRIN STEHEN, BEVOR MAN EINREICHT. Ist sie leer, überspringt
     * Portal.js die Anbindung komplett (`if (!this.cfg.gameMonetizeId)`) und
     * `api.gamemonetize.com/sdk.js` wird nie angefordert. Das Portal prüft
     * beim Einreichen aber, ob sein SDK eingebaut ist — genau daran ist der
     * erste Upload gescheitert. */
    gameMonetizeId: '8xm1lwmqdvr54tcjyi0t91qn87yzipz7',

    // Wie lange auf ein fremdes SDK gewartet wird, bevor ohne es gestartet
    // wird. Lieber ohne Werbung spielen als vor einem schwarzen Bild warten.
    sdkTimeout: 4000,
    // Notbremse, falls ein Spot gar nicht antwortet. Ohne sie hinge der
    // Werbe-Screen für immer und der Lauf wäre verloren.
    werbungTimeout: 45000,
  },

  /* ================================================================== *
   *  GOLDENE BANANE — der Goldrausch
   *
   *  Sie fällt ab und zu ganz normal vom Himmel, wie eine Münze. Wer sie
   *  einsammelt, wird SOFORT golden, und für 30 Sekunden regnet es Münzen.
   *
   *  WARUM DAS DEN BOSSKAMPF ERSETZT
   *  Sie war früher die Belohnung dafür, einen Adler dreimal zu treffen.
   *  Der Kampf ist raus — die Belohnung war aber das Beste daran, und sie
   *  funktioniert allein besser: kein Bruch im Spielfluss, kein
   *  Sonderzustand, nur ein Ding, das man haben will.
   * ================================================================== */
  goldbanane: {
    bild: '/hazards/banane_gold.webp',

    /* Das Goldfell — derselbe Kletterzyklus, nur golden. Die Zahl stand
     * früher fest verdrahtet in Game.js und passte nach dem Neuschnitt nicht
     * mehr (19 Posen statt 12). Sie gehört hierher, damit
     * `npm run pruef:bilder` sie gegen die Platte halten kann. */
    framePath: '/textures/gold/move_{n}.webp',
    frameAnzahl: 19,

    radius: 0.4,
    hitRadiusFactor: 1.3,
    fallSpeedFactor: 0.6,
    spriteScale: 1.7,
    poolSize: 2,

    /* AB GEBIET 2, dann jedes vierte bis fünfte. Im ersten Gebiet lernt man
     * das Spiel; ein Sonderobjekt, dessen Wirkung man noch nicht einordnen
     * kann, ist dort verschenkt.
     *
     * Vorher stand hier 2 bis 3. Auf dem Papier war das häufiger — in
     * Wirklichkeit kam die Banane fast nie, weil jeder fehlgeschlagene Wurf
     * den Zähler trotzdem weiterschob (siehe Game._belohnungenPruefen). Der
     * Fehler ist behoben; damit die Belohnung jetzt nicht ins Gegenteil
     * kippt und alle zwei Gebiete kommt, steht hier der Abstand, der auch
     * gespielt so ankommt: alle vier bis fünf Gebiete. */
    abGebiet: 2,
    jedesXteGebiet: { min: 4, max: 5 },

    /* ─── DAS GOLD-GEBIET ───────────────────────────────────────────────
     *
     * Wer die goldene Banane erwischt, kommt für 30 Sekunden in ein eigenes
     * Gebiet: goldene Wand, eigenes Musikstück, der Affe selbst golden — und
     * es fallen NUR NOCH MÜNZEN. Danach geht es dort weiter, wo man war.
     *
     * Es ist kein Gebiet aus CONFIG.wall.stages und darf keines werden: die
     * Liste läuft nach Spielzeit ab, das Gold-Gebiet kommt als Belohnung.
     * PlantWall.sonderStufe() hängt es deshalb daneben ein. */
    sekunden: 30,

    /* Die Wand des Gold-Gebiets. Gleicher Aufbau wie ein Eintrag in
     * CONFIG.wall.stages — `name` ist zugleich der Name des Musikstücks
     * (public/musik/gold.ogg). */
    gebiet: {
      name: 'gold',
      hazard: 'stein', // wird nie gebraucht: es fällt nichts Gefährliches
      near: '/textures/stage_gold.webp',
      far: '/textures/stage_gold_far.webp',
    },

    /* NUR MÜNZEN. Alles andere bleibt oben: keine Steine, keine Bananen,
     * keine Sturzflüge. Das ist der ganze Reiz — dreissig Sekunden, in denen
     * man nur einsammelt und nichts passieren kann. */
    nurMuenzen: true,

    /* FÜNFMAL SO VIELE MÜNZEN wie sonst, verteilt auf alle drei Bahnen.
     *
     * Der Takt ist die Menge: normal liefert ein Gebiet `coin.proGebiet` (30)
     * Münzen auf `sekundenProWand` (132 s), also eine alle 4.4 s. Fünffach
     * heisst eine alle 0.88 s — in 30 Sekunden rund 34 Stück. Steht 4.4/5
     * ausgerechnet hier, weil beide Ausgangswerte an anderen Stellen stehen
     * und sich ändern können; `npm run balance` rechnet es nach. */
    muenzTakt: 0.88,

    /* Reihum auf alle drei Bahnen, damit man quer durchs Bild sammelt statt
     * in einer Spur stehen zu bleiben. */
    alleBahnen: true,

    /* Wert JE Münze — davon unabhängig. Das war schon immer so und bleibt:
     * die Verfünffachung betrifft die ANZAHL („fünfmal so viele"), nicht den
     * Wert. Beides gleichzeitig zu verfünffachen wäre das Fünfundzwanzig-
     * fache und hätte die Preise sofort bedeutungslos gemacht. */
    muenzFaktor: 3,
  },

  /* ================================================================== *
   *  CHILI — der Durchflug
   *
   *  Ab und zu fällt eine Chilischote. Wer sie einsammelt, bekommt Feuer
   *  aus dem Hintern, alle Objekte verschwinden, und er schiesst in fünf
   *  Sekunden durch das restliche Gebiet ins nächste.
   *
   *  ES IST EINE BELOHNUNG, KEIN HINDERNIS: während des Durchflugs kann
   *  nichts passieren. Genau das ist der Reiz — einmal alles egal.
   * ================================================================== */
  chili: {
    bild: '/hazards/chili.webp',
    radius: 0.34,
    hitRadiusFactor: 1.3,
    fallSpeedFactor: 0.6,
    spriteScale: 1.6,
    poolSize: 2,

    /* Alle drei bis vier Gebiete. Seltener als die goldene Banane: der
     * Durchflug überspringt Spielzeit, und was Spielzeit überspringt, darf
     * nicht ständig kommen. */
    abGebiet: 2,
    jedesXteGebiet: { min: 3, max: 4 },

    /* Wie lange der Schub HÖCHSTENS dauert. */
    sekunden: 5.0,

    /* Und wie lange MINDESTENS.
     *
     * Ohne Untergrenze richtete sich die Dauer allein nach dem, was vom
     * Gebiet übrig war. Wer die Schote kurz vor dem Wechsel aufhob, bekam
     * einen Flug von 1.2 Sekunden — technisch mit 10-fachem Tempo, aber
     * vorbei, bevor man hinsieht. Genau das las sich als "er war gleich
     * schnell wie beim Klettern".
     *
     * Jetzt gilt: mindestens 2.5 Sekunden. Reicht die restliche
     * Gebietsstrecke dafür nicht, fliegt er eben ins nächste Gebiet hinein
     * — das ist ohnehin das Ziel. */
    minSekunden: 2.5,

    /* MINDESTENS ACHTFACHES TEMPO — und zwar auf die normale KLETTERSTRECKE
     * bezogen, nicht auf irgendeine innere Grösse.
     *
     * Reicht das nicht, um das Gebiet in `sekunden` zu Ende zu bringen, wird
     * schneller geflogen, nicht länger: er soll im nächsten Gebiet ankommen.
     * Bei 132 Sekunden Gebietsdauer und 5 Sekunden Flug sind das bis zum
     * 26-fachen. Der Faktor ist also die UNTERGRENZE, kein Sollwert. */
    tempoFaktor: 8,

    /* Wie weit er ins neue Gebiet hineinfliegt, als Anteil der Gebietsdauer.
     * Ohne diesen Zuschlag endet der Flug exakt auf der Gebietsgrenze, und
     * man landet im Wechsel statt im neuen Gebiet. */
    einstieg: 0.08,

    /* WIE HOCH ER IM BILD STEIGT.
     *
     * Beim Klettern steht der Affe fest auf seiner Hoehe, und nur die Wand
     * bewegt sich. Im Flug reicht das NICHT: der Bildschirm rast zwar mit
     * dem Achtfachen, aber die Wand ist ein dichtes, sich wiederholendes
     * Blattmuster — bei diesem Tempo liest es sich als Rauschen, nicht als
     * Fahrt. Was fehlt, ist ein fester Bezugspunkt, und der ist der Affe
     * selbst.
     *
     * Er steigt deshalb waehrend des Fluges sichtbar nach oben und sinkt am
     * Ende zurueck. Erst dadurch sieht man, dass er faehrt und nicht nur
     * die Tapete wechselt. */
    flughoehe: 1.6,

    /* MINDESTENS ZEHNFACHES TEMPO.
     *
     * Wie schnell er fliegt, ergibt sich normalerweise aus der Rechnung
     * "restliche Gebietszeit in `sekunden` abarbeiten". Steht er beim
     * Aufheben aber schon kurz vor dem Gebietswechsel, wäre der Rest klein
     * und der Flug entsprechend lahm — die Animation liefe fünf Sekunden,
     * und die Wand bewegte sich kaum. Das sähe nach Fehler aus, nicht nach
     * Schub.
     *
     * Die Flugdauer ist das ERGEBNIS, nicht die Vorgabe: die Strecke steht
     * fest (Rest des Gebiets plus `einstieg`), die Dauer folgt aus
     * `tempoFaktor` und wird auf [minSekunden, sekunden] gedeckelt.
     *
     * Hier stand ein zweiter Wert `tempoMin: 7.5`, der die Dauer aus der
     * Strecke rechnete. Seit `tempoFaktor` das tut, wurde er nirgends mehr
     * gelesen — er stand nur noch als falsche Auskunft im Weg. */

    /* Bildfolgen des Fluges, je Charakter. Fehlt einer, klettert er eben
     * weiter — der Schub wirkt trotzdem. */
    frames: {
      braun: '/textures/chili/move_{n}.webp',
      weiss: '/textures/chili_weiss/move_{n}.webp',
      orange: '/textures/chili_orange/move_{n}.webp',
    },
    /* MUSS ZUR ZAHL DER EXPORTIERTEN BILDER PASSEN — JE CHARAKTER.
     *
     * Stand hier eine einzelne 14, während `npm run prep:boss` zwölf Bilder
     * schrieb. Der Loader forderte move_12 und move_13 an, bekam vom
     * Entwicklungsserver die index.html mit Status 200, warf — und weil der
     * Fehler nur in einem `catch` mit `console.warn` landete, sah man im
     * Spiel bloss einen Affen, der beim Chili weiterkletterte statt zu
     * fliegen.
     *
     * Seit die Bildfolgen als geschlossene Zyklen geschnitten werden
     * (video-frames.mjs --zyklus), hat jede Vorlage ihre EIGENE Länge: der
     * braune Flug ist eine Flammenperiode von 8 Bildern, der orange stammt
     * aus einem anderen Video mit 12. Eine gemeinsame Zahl kann es deshalb
     * nicht mehr geben. `npm run pruef:bilder` vergleicht diese Angaben mit
     * dem, was wirklich in public/ liegt — und lässt den Fehler nicht mehr
     * bis ins Spiel durch. */
    frameAnzahl: { braun: 8, weiss: 8, orange: 12 },

    /* HIN UND ZURÜCK ABSPIELEN statt hart zurückzuspringen.
     *
     * Der orange Satz ist der einzige, den es nicht als geschlossenen Zyklus
     * gibt: sein Quellvideo liegt nicht im Projekt, die zwölf Bilder stammen
     * noch aus der alten Zerlegung. Gemessen sind die Schritte INNERHALB des
     * Satzes gleichmässig (8 bis 20 auf der Abstandsskala), der Rücksprung
     * vom letzten aufs erste Bild aber 52 — ein sichtbarer Ruck, zweimal je
     * Sekunde.
     *
     * Hin und zurück abgespielt gibt es diese Nahtstelle nicht mehr: jeder
     * Bildwechsel ist ein Schritt zwischen Nachbarn. Für eine Flamme ist das
     * unauffällig, sie flackert ohnehin in beide Richtungen. Kommt das Video
     * nach, wird der Satz normal geschnitten und der Eintrag hier fällt weg. */
    pendeln: { orange: true },

    /* Bilder je Sekunde der Flugfolge.
     *
     * Beim braunen und weissen Affen ist das eine echte Flammenschleife (8
     * Bilder = 0.333 s im Video), die DURCHGEHEND läuft — 24 ist genau das
     * Videotempo. Der orange Satz stammt noch aus der alten Zerlegung. */
    frameTakt: 24,

    /* TEMPOLINIEN.
     *
     * Der Grund steht ausführlich in src/entities/Tempolinien.js: ab etwa
     * 1/20 Kachelhöhe je Bild lässt sich die Wandstruktur nicht mehr von Bild
     * zu Bild verfolgen, und was man nicht verfolgen kann, sieht man nicht
     * fahren. Die Linien sind der Bezugspunkt, den die Wand bei diesem Tempo
     * nicht mehr liefern kann. */
    linien: {
      z: -0.4, // zwischen Wand (-0.9) und Affe (~0.15)
      deckkraft: 0.5,
      einblenden: 14, // Glättung beim Aufblenden (1/s)
      ausblenden: 6,
      /* Anteil der echten Fluggeschwindigkeit, mit dem die Streifen laufen.
       * Voll wäre wieder zu schnell zum Verfolgen — genau der Fehler, den
       * die Linien beheben sollen. */
      mitlauf: 0.06,
    },

    /* KAMERASTOSS. Ein grösserer Bildwinkel zieht die Ränder nach aussen; das
     * liest sich als Beschleunigung, noch bevor man die Wand ansieht. Der
     * Wert kommt zu CONFIG.render.camera.fov (46) hinzu. */
    fovStoss: 9,
  },

  /* ================================================================== *
   *  STURZFLUG — angekündigter Schnellangriff
   *
   *  Ablauf, drei Abschnitte:
   *
   *    warnung   Über ein bis drei Bahnen erscheint oben ein rotes Schild
   *              und blinkt. Der Nachschub ist abgestellt; was noch fällt,
   *              fällt zu Ende.
   *    sturz     Genau auf diesen Bahnen schiessen Vögel herunter — viel
   *              schneller als alles andere im Spiel.
   *    aus       Kurz durchatmen, dann läuft der normale Strom weiter.
   *
   *  NIE ALLE BAHNEN. Bei vier Bahnen sind höchstens drei bedroht — eine
   *  bleibt immer frei. Das ist keine Nettigkeit, sondern dieselbe Zusage
   *  wie beim Korridor: es muss einen Weg geben, sonst ist der Tod nicht
   *  Fehler des Spielers, sondern des Spiels.
   *
   *  WARUM DIE WARNUNG ÜBERHAUPT NÖTIG IST
   *  Die Vögel sind mit 22 Einheiten/s rund viermal so schnell wie ein
   *  Stein im Spätspiel. Auf Reaktion allein ist das nicht zu schaffen —
   *  das Schild ist die Reaktionszeit, nicht Deko.
   * ================================================================== */
  sturzflug: {
    /* Ab dem zweiten Gebiet. Im ersten lernt man das Spiel; ein Angriff,
     * den man noch nicht einordnen kann, ist kein Reiz, sondern Pech. */
    abGebiet: 2,

    /* Wie oft je Gebiet. Wächst mit der Zahl der Gebietswechsel — pro drei
     * Gebiete einer mehr, gedeckelt bei `max`. Der Nutzer wollte "ein bis
     * dreimal, und immer öfter, je höher man kommt". */
    /* WIE OFT JE GEBIET — ab dem zweiten Gebiet einer mehr, Gebiet für
     * Gebiet:
     *
     *     Gebiet 2    2 Angriffe
     *     Gebiet 3    3
     *     Gebiet 4    4        … und so weiter
     *     ab Gebiet 9   9  (Deckel)
     *
     * Vorher stand hier eine Staffel, die bei DREI anfing (Gebiet 2 bis 4
     * je drei). Verlangt ist ein sauberes Ansteigen von unten: im zweiten
     * Gebiet zweimal, im dritten dreimal, danach immer mehr. Der Anfang ist
     * damit ruhiger und die Steigerung deutlicher zu spüren.
     *
     * Bedroht sind ein bis zwei Bahnen — bei drei Spuren bleibt immer
     * mindestens eine frei. */
    proGebiet: { stufen: [2, 3, 4, 5, 6, 7, 8, 9], max: 9 },

    /* Vorwarnung.
     *
     * 1.5 s statt 1.15. Man soll es erst SEHEN und dann ausweichen; bei
     * 1.15 fiel beides zusammen — das Schild erschien, und man war schon
     * am Reagieren. Eine knappe halbe Sekunde mehr reicht für den Blick
     * nach oben und lässt trotzdem keine Zeit zum Überlegen.
     *
     * Der Wert ist die UNTERGRENZE: die tatsächliche Warnzeit rechnet
     * Sturzflug._warnzeitBerechnen aus dem weitesten Weg zur nächsten
     * freien Bahn aus. */
    warnung: {
      sekunden: 1.5,
      bild: '/hazards/warnung_bahn.webp',
      /* 1.15 statt 0.85. Bei 0.85 war das Schild im Bild kaum grösser als
       * eine Blume an der Wand — gemessen 74 Bildpunkte hoch im Querformat.
       * Eine Warnung, die man suchen muss, ist keine. */
      hoehe: 1.15,
      blinkProSekunde: 5,
    },

    /* Höchstens so viele Bahnen gleichzeitig — UND nie alle. Der kleinere
     * der beiden Werte gewinnt (siehe Sturzflug._bahnenWaehlen). */
    /* Höchstens zwei Bahnen gleichzeitig — bei drei Spuren bleibt damit
     * immer eine frei. Der Wert wird zusätzlich gegen (Bahnzahl - 1)
     * gedeckelt, siehe Sturzflug._bahnenWaehlen. */
    maxBahnen: 2,

    /* Die Vögel. Bilder aus der Vorlage des Nutzers, von oben im Sturz. */
    bilder: ['/hazards/vogel_1.webp', '/hazards/vogel_2.webp', '/hazards/vogel_3.webp'],
    /* 1.8 statt 1.15. Kleiner las sich der Vogel als Pfeil, nicht als
     * Tier — bei diesem Tempo hat man nur die Silhouette, und die muss
     * auf den ersten Blick sitzen. Zum Vergleich: der Affe ist 2.5 hoch. */
    vogelHoehe: 1.8,
    tempo: 22.0, // Units/s — bewusst weit über allem anderen
    hitRadius: 0.26, // schmaler als das Bild: getroffen wird der Körper
    poolSize: 4,

    /* Pause nach dem letzten Vogel, bevor der normale Strom weiterläuft.
     * Ohne sie fällt einem der erste Stein direkt hinterher, und der
     * Angriff hat kein Ende. */
    nachlauf: 0.45,
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
    frames: [0, 1, 1, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 10, 10, 11, 12, 13, 13],
    // Frame, der im Stillstand gehalten wird (Index INNERHALB von frames).
    idleFrame: 0,

    // Kletterzyklen pro Sekunde bei voller Bewegungsgeschwindigkeit.
    // Bildrate = cycleSpeed * frames.length (hier 1.4 * 12 ≈ 17 Bilder/s).
    // Der Zyklus im Video dauert 1.017 s, also entspricht 1.0 dem Originaltempo.
    /* 0.85 STATT 1.4 — der Zyklus lief zu hektisch.
     *
     * Der Wert kommt aus der Zeit der alten Kletterbilder. Das neue Video
     * zeigt einen ruhigeren, weiter ausholenden Klettergang; mit demselben
     * Takt abgespielt wirkte er, als würde er die Wand hochrennen statt
     * klettern. Bei 12 Bildern sind das jetzt rund 10 Bilder je Sekunde
     * statt 17. */
    /* 0.425 — nochmals HALBIERT. Der Affe soll klettern, nicht die Wand
     * hochrennen. Bei 12 Bildern sind das rund 5 Bilder je Sekunde. */
    cycleSpeed: 1.263,
    /* DER AFFE KLETTERT IMMER — auch ohne Eingabe.
     *
     * Ich hatte das erst missverstanden und den Zyklus im Stillstand
     * angehalten. Falsch: die Wand scrollt durchgehend, der Affe steigt also
     * durchgehend. Ein Affe, der bei laufender Wand einfriert, klebt
     * sichtbar am Bild. Er bewegt sich immer, nur schneller, wenn man
     * zusätzlich ausweicht.
     *
     * 0.7 heisst: im Stillstand die halbe Bildrate der vollen Bewegung —
     * ruhiges, gleichmässiges Kraxeln, das nicht mit dem Ausweichen
     * konkurriert. */
    /* GLEICH cycleSpeed — und das ist Absicht.
     *
     * Der Takt ist max(idleCycleSpeed, cycleSpeed * (0.35 + 0.65 * Tempo)).
     * Wer geradeaus klettert, hat Tempo 0 und landet damit bei 35 Prozent
     * des eingestellten Werts. Genau das ist aber der Normalfall: der Affe
     * klettert die ganze Zeit und wischt nur gelegentlich. Der Sockel IST
     * also das Tempo, das man sieht.
     *
     * GEMESSEN, nicht geschätzt: mit 0.63 hier und 1.263 dort lief der
     * Zyklus im Spiel mit 0.626 Durchläufen je Sekunde — halb so schnell wie
     * die Vorlage, obwohl in cycleSpeed das Videotempo stand. Deshalb steht
     * hier derselbe Wert; damit läuft der Kletterakt konstant genau so
     * schnell wie im Video. Je Charakter wird er in Game._buildPlayer auf
     * dessen eigenen Wert gezogen. */
    idleCycleSpeed: 1.263,

    /* Neigung in Bewegungsrichtung.
     *
     * Hier stand einmal ausdrücklich "keine prozedurale Zusatzbewegung". Auf
     * Wunsch wieder da, aber DEZENT: das Sprite ist eine flache Ebene, und
     * eine stark gedrehte Ebene sieht sofort nach Papier aus. 8 Grad reichen,
     * um Gewicht anzudeuten — der Modell-Pfad darf mit 14 mehr, weil ein
     * echtes Modell die Drehung verträgt.
     *
     * Die Trefferprüfung hängt NICHT daran: CollisionSystem rechnet mit
     * this.x/this.y, nicht mit der Darstellung. Geprüft. */
    lean: {
      // Nach dem ersten Anlauf deutlicher gestellt: 8 Grad waren zu zaghaft,
      // man sah sie kaum. 15 Grad zeigen die Richtung klar, ohne dass das
      // flache Sprite nach umkippendem Papier aussieht.
      proTempo: 2.6, // Grad je Einheit/s Seitwärtsgeschwindigkeit
      max: 15, // Grad
      glaettung: 11.0, // je höher, desto schneller folgt die Neigung
    },

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
        // Holz statt Stein: Stock (klein), Baumscheibe (mittel), Stamm (gross).
        hazard: 'holz',
        afterSeconds: 33.1,
        near: '/textures/stage2_flowers.webp',
        far: '/textures/stage2_flowers_far.webp',
      },
      {
        name: 'aeste',
        hazard: 'kokosnuss',
        afterSeconds: 85.8,
        near: '/textures/stage3_branches.webp',
        far: '/textures/stage3_branches_far.webp',
      },
      {
        name: 'pilzwald',
        hazard: 'pilz',
        afterSeconds: 141.1,
        near: '/textures/wall_mushroom.webp',
        far: '/textures/wall_mushroom_far.webp',
      },
      {
        name: 'gift',
        hazard: 'gift',
        afterSeconds: 185.4,
        near: '/textures/stage4_poison.webp',
        far: '/textures/stage4_poison_far.webp',
      },
      {
        name: 'halloween',
        hazard: 'kuerbis',
        afterSeconds: 237.5,
        near: '/textures/stage5_halloween.webp',
        far: '/textures/stage5_halloween_far.webp',
      },
      {
        name: 'wasser',
        hazard: 'meer',
        afterSeconds: 281.8,
        near: '/textures/wall_water.webp',
        far: '/textures/wall_water_far.webp',
      },
      {
        name: 'wolken',
        hazard: 'wolken',
        afterSeconds: 320.6,
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
        afterSeconds: 364,
        near: '/textures/stage6_ice.webp',
        far: '/textures/stage6_ice_far.webp',
        // Gleicher Grund wie bei den Wolken: helle Zapfen vor heller Wand.
        tint: 0xa9c2d8,
      },
      {
        name: 'kristall',
        hazard: 'kristall',
        afterSeconds: 407.1,
        near: '/textures/wall_crystal.webp',
        far: '/textures/wall_crystal_far.webp',
      },
      {
        name: 'lava',
        hazard: 'feuer',
        afterSeconds: 441.4,
        near: '/textures/stage8_lava.webp',
        far: '/textures/stage8_lava_far.webp',
        // Feuerbälle vor einer Wand aus Feuer: die Wand muss zurücktreten,
        // sonst sieht man nicht mehr, was fällt und was Kulisse ist.
        tint: 0x9d8078,
      },
      {
        name: 'asche',
        hazard: 'asche',
        afterSeconds: 477.4,
        near: '/textures/stage9_ash.webp',
        far: '/textures/stage9_ash_far.webp',
      },
      {
        name: 'schrott',
        hazard: 'metall',
        afterSeconds: 506.2,
        near: '/textures/stage_schrott.webp',
        far: '/textures/stage_schrott_far.webp',
        /* Die Wand ist selbst rostbraun und voller Kanten. Ohne Dämpfung
         * verschwindet ein rostiges Zahnrad darin — dieselbe Regel wie bei
         * der Lavawand. */
        tint: 0xa79a92,
      },
      {
        name: 'bonbon',
        hazard: 'bonbon',
        afterSeconds: 540.1,
        near: '/textures/stage_bonbon.webp',
        far: '/textures/stage_bonbon_far.webp',
        // Sehr helle, bunte Wand — sonst geht ein rosa Bonbon darin unter.
        tint: 0xbdb0b4,
      },
      {
        name: 'kakteen',
        hazard: 'kaktus',
        afterSeconds: 568.9,
        near: '/textures/stage_kakteen.webp',
        far: '/textures/stage_kakteen_far.webp',
      },
      {
        name: 'ruine',
        hazard: 'ruine',
        afterSeconds: 594.2,
        near: '/textures/stage_ruine.webp',
        far: '/textures/stage_ruine_far.webp',
        /* Die Ruinenwand ist die dunkelste im Spiel. Hier wird AUFGEHELLT,
         * nicht gedämpft: ein grauer Steinkopf vor fast schwarzem Mauerwerk
         * ist sonst nur ein Schatten. */
        tint: 0xffffff,
      },

      /* ================================================================ *
       *  DAS ENDSPIEL — fünf Gebiete hinter dem bisherigen Schluss.
       *
       *  Hierhin kam bisher niemand, weil es hier nichts gab. Die Reihe
       *  endete bei `ruine` und begann von vorn. Wer jetzt so weit kommt,
       *  läuft in fünf Wände, die härter sind als alles davor — und ganz
       *  am Ende ins Weltall, das absichtlich an der Grenze des Machbaren
       *  liegt.
       *
       *  Die afterSeconds errechnet scripts/_gebietsmeter.mjs --ziel; sie
       *  stehen nicht willkürlich hier. Wer sie von Hand ändert, ändert
       *  damit auch die Länge JEDES Gebiets in Metern.
       * ================================================================ */
      {
        name: 'pirat',
        hazard: 'pirat',
        afterSeconds: 622.4,
        near: '/textures/stage_pirat.webp',
        far: '/textures/stage_pirat_far.webp',
        /* Dunkles Nassholz. Metall davor braucht Aufhellung, sonst ist der
         * graue Anker vor der grauen Planke nicht zu sehen. */
        tint: 0xffffff,
      },
      {
        name: 'biene',
        hazard: 'biene',
        afterSeconds: 650.5,
        near: '/textures/stage_biene.webp',
        far: '/textures/stage_biene_far.webp',
        /* Die Wabenwand ist das hellste Bild im Spiel, und die Objekte sind
         * derselbe Bernstein. Hier wird deshalb GEDÄMPFT statt aufgehellt —
         * sonst löst sich der fallende Honig in der Wand auf. */
        tint: 0xdcd0c4,
      },
      {
        name: 'bibliothek',
        hazard: 'buch',
        afterSeconds: 672.8,
        near: '/textures/stage_bibliothek.webp',
        far: '/textures/stage_bibliothek_far.webp',
        // Kerzenlicht auf dunklem Holz — wie die Ruine, also aufhellen.
        tint: 0xffffff,
      },
      {
        name: 'zirkus',
        hazard: 'zirkus',
        afterSeconds: 696.2,
        near: '/textures/stage_zirkus.webp',
        far: '/textures/stage_zirkus_far.webp',
        /* Rot-weisses Zeltstreifenmuster, sehr unruhig. Leicht gedämpft,
         * damit die bunten Objekte davor überhaupt herausstechen. */
        tint: 0xdedad6,
      },
      {
        name: 'weltall',
        hazard: 'meteor',
        afterSeconds: 714.9,
        near: '/textures/stage_weltall.webp',
        far: '/textures/stage_weltall_far.webp',
        /* DAS LETZTE GEBIET. Weiss-rote Rakete vor schwarzem All: das
         * hellste Umfeld überhaupt für die grauen Asteroiden. Kräftig
         * gedämpft, sonst verschwimmt der Asteroid mit der Bordwand. */
        tint: 0xd2d8de,
      },
    ],
    /* Reihenfolge der einundzwanzig Gebiete, wie sie oben steht:
     *   1 gruen    2 blumen     3 aeste       4 pilzwald  5 gift
     *   6 halloween 7 wasser    8 wolken      9 eiszeit  10 kristall
     *  11 lava     12 asche    13 schrott    14 bonbon   15 kakteen
     *  16 ruine    17 pirat    18 biene      19 bibliothek 20 zirkus
     *  21 weltall  ← das letzte und schwerste
     * Die Nummern zählen für goldbanane/chili/sturzflug (abGebiet). */

    /* Nach der letzten Stufe alle X Sekunden zur nächsten (zyklisch von vorne).
     *
     * 26 STATT 40. Hinter dem Weltall hängt das Tempo am Deckel von 16, das
     * Wandscrollen also bei 16 × 0.42 = 6.72 m/s. 26 Sekunden sind dort rund
     * 175 Meter und liegen damit mitten in der Spanne, in der auch jedes
     * andere Gebiet liegt (157–200 m). Mit 40 wären es 269 Meter gewesen —
     * der zyklische Nachlauf wäre länger als alles davor.
     *
     * DIESE ZAHL HÄNGT AN tempo.max. Stand hier vorübergehend 21, als der
     * Deckel noch 18 war; nach dem Absenken auf 16 wären daraus 141 Meter
     * geworden, also kürzer als jedes echte Gebiet. Wer am Deckel dreht,
     * rechnet hier nach:  Sekunden = Zielmeter / (tempo.max × scrollAnteil) */
    stageLoopSeconds: 21,
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
      enabled: true, // Ziehen auf dem ganzen Bildschirm
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

/* ==================================================================== *
 *  ABGELEITETES
 *
 *  Was sich aus dem Obigen ERRECHNET, steht hier — nicht im Objekt selbst.
 *  Innerhalb eines Objektliterals kann ein Abschnitt nicht auf einen
 *  späteren zugreifen (difficulty steht vor wall), und zwei von Hand
 *  gepflegte Kopien derselben Zahlenreihe wären genau die Stelle, an der
 *  später jemand nur eine von beiden ändert.
 * ==================================================================== */

/* Die Sekundenmarken der Gebietswechsel, für DifficultyCurve.
 *
 * Damit läuft die Schwierigkeit an den GEBIETEN statt an einer festen Uhr:
 * `difficulty.proWand` gilt wörtlich je Gebiet. Siehe die ausführliche
 * Begründung im Konstruktor von DifficultyCurve. */
CONFIG.difficulty.gebietsGrenzen = CONFIG.wall.stages.map((s) => s.afterSeconds ?? 0);

export default CONFIG;
