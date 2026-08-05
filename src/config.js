/**
 * ZENTRALE KONFIGURATION — alle Balancing-Werte an einem Ort.
 *
 * Faustregeln:
 *   - Weltmasse sind "Units". 1 Unit == 1 Höhenmeter im Score.
 *   - Alle Geschwindigkeiten sind Units pro SEKUNDE (nie pro Frame).
 *   - Alle Zeiten sind Sekunden.
 *
 * Die Difficulty-Kurven haben durchgängig dieselbe Form:
 *      wert(t) = clamp(start + rate * t, min, max)
 * mit t = Spielzeit in Sekunden. Siehe src/systems/DifficultyCurve.js.
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
    moveSpeed: 6.4,
    // Glättungsraten in 1/s (nicht Beschleunigung im physikalischen Sinn):
    // v nähert sich dem Zielwert mit 1 - e^(-rate * dt).
    // Höher = direkter. acceleration gilt bei gedrückter Taste, damping beim Loslassen.
    acceleration: 16.0,
    damping: 12.0,
    // Unterhalb dieser Geschwindigkeit gilt der Affe als stehend (climbIdle).
    idleThreshold: 0.55,

    // Klettern: Vertikal-Input zahlt zusätzlich auf die Scrollgeschwindigkeit ein,
    // damit sich "W" wie echtes Steigen anfühlt und nicht nur wie Ausweichen.
    // Auf 0 setzen => reines Auto-Scrolling, W/S bewegen nur innerhalb des Bildes.
    climbAssist: 1.9,
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
   *  DIFFICULTY-KURVEN
   *  Alle drei Kurven laufen über die Spielzeit t (Sekunden) und sind
   *  gedeckelt, damit das Spiel schwer, aber nie unspielbar wird.
   * ================================================================== */
  difficulty: {
    // Grundgeschwindigkeit, mit der die Wand nach unten scrollt (= Steiggeschwindigkeit).
    scroll: {
      start: 2.3, // Units/s zu Spielbeginn
      rate: 0.052, // Units/s zusätzlich pro Sekunde Spielzeit
      max: 9.5, // Deckel (nach ~138 s erreicht)
    },
    // Zeit zwischen zwei Spawns. Wird KLEINER -> negative rate.
    spawnInterval: {
      start: 1.16, // s zwischen Steinen zu Beginn
      rate: -0.0092, // pro Sekunde Spielzeit kürzer
      min: 0.27, // Deckel (nach ~97 s erreicht)
    },
    // Eigengeschwindigkeit der Steine (zusätzlich zur Scrollgeschwindigkeit!).
    // Auf dem Bildschirm bewegt sich ein Stein mit rockSpeed + scrollSpeed.
    rockSpeed: {
      start: 3.9,
      rate: 0.078,
      max: 15.0, // Deckel (nach ~142 s erreicht)
    },
    // Wie viele Steine ein Spawn-Event gleichzeitig auswirft. Steigt in Stufen,
    // damit später auch "Wände" aus Steinen kommen und nicht nur schnellere Einzelsteine.
    //
    // Die Stufen sind auf CONFIG.wall.stages abgestimmt: sie liegen genau auf
    // den Sekunden, an denen der Hintergrund wechselt. Ab 138 s sind Scroll-
    // und Steingeschwindigkeit gedeckelt — danach kommt die Steigerung
    // ausschliesslich über die Burst-Grösse, damit auch die späten
    // Hintergrundwechsel (Lava, Asche) mit einem echten Sprung zusammenfallen.
    burst: [
      { afterSeconds: 0, count: 1 },
      { afterSeconds: 22, count: 2 },
      { afterSeconds: 66, count: 3 },
      { afterSeconds: 110, count: 4 },
      { afterSeconds: 154, count: 5 },
      { afterSeconds: 176, count: 6 },
    ],
  },

  /* ================================================================== *
   *  STEINE
   * ================================================================== */
  rock: {
    poolSize: 48, // gross genug für maximalen Burst + Nachlauf
    radius: { min: 0.30, max: 0.62 }, // visueller + Kollisionsradius
    hitRadiusFactor: 0.86, // Kollisionsradius = radius * factor (wohlwollend)
    spin: { min: 0.7, max: 3.1 }, // rad/s Eigenrotation
    drift: 0.55, // maximale seitliche Drift (Units/s)
    color: 0x6b6259,
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
   *  SCORE / HIGHSCORE
   * ================================================================== */
  score: {
    unitsPerMeter: 1.0, // 1 World-Unit == 1 Höhenmeter
    storageKey: 'jungle-climber.highscores.v1',
    maxEntries: 10,
    maxNameLength: 12,
    defaultName: 'AFFE',
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
     * ------------------------------------------------------------------ */
    // Jede Schwelle fällt mit einem echten Schwierigkeitssprung zusammen:
    // entweder steigt dort die Burst-Grösse (difficulty.burst) oder die
    // Scroll-/Steingeschwindigkeit läuft noch ihre Rampe hoch.
    stages: [
      {
        name: 'gruen',
        afterSeconds: 0,
        near: '/textures/stage1_green.webp',
        far: '/textures/stage1_green_far.webp',
      },
      {
        name: 'blumen',
        afterSeconds: 22,
        near: '/textures/stage2_flowers.webp',
        far: '/textures/stage2_flowers_far.webp',
      },
      {
        name: 'aeste',
        afterSeconds: 44,
        near: '/textures/stage3_branches.webp',
        far: '/textures/stage3_branches_far.webp',
      },
      {
        name: 'gift',
        afterSeconds: 66,
        near: '/textures/stage4_poison.webp',
        far: '/textures/stage4_poison_far.webp',
      },
      {
        name: 'halloween',
        afterSeconds: 88,
        near: '/textures/stage5_halloween.webp',
        far: '/textures/stage5_halloween_far.webp',
      },
      {
        name: 'eiszeit',
        afterSeconds: 110,
        near: '/textures/stage6_ice.webp',
        far: '/textures/stage6_ice_far.webp',
      },
      {
        name: 'wolken',
        afterSeconds: 132,
        near: '/textures/stage7_clouds.webp',
        far: '/textures/stage7_clouds_far.webp',
      },
      {
        name: 'lava',
        afterSeconds: 154,
        near: '/textures/stage8_lava.webp',
        far: '/textures/stage8_lava_far.webp',
      },
      {
        name: 'asche',
        afterSeconds: 176,
        near: '/textures/stage9_ash.webp',
        far: '/textures/stage9_ash_far.webp',
      },
    ],
    // Nach der letzten Stufe alle X Sekunden zur nächsten (zyklisch von vorne).
    stageLoopSeconds: 45,
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
