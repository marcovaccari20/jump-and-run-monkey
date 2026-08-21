/**
 * Anbindung an die Spieleportale (CrazyGames, GameMonetize).
 *
 * WAS EIN PORTAL VOM SPIEL WILL
 * Portale verkaufen Werbung. Damit das funktioniert, müssen sie wissen, wann
 * gespielt wird und wann nicht — sonst legen sie einen Spot mitten in eine
 * Ausweichbewegung. Beide Portale wollen dafür dasselbe, nur mit anderen
 * Namen:
 *
 *   Spiel läuft   -> gameplayStart()  /  SDK_GAME_START
 *   Spiel pausiert-> gameplayStop()   /  SDK_GAME_PAUSE
 *   Ladevorgang   -> loadingStart/Stop
 *   Belohnte Werbung -> requestAd('rewarded') / showBanner()
 *
 * Deshalb genau EIN Adapter je Portal, mit derselben Schnittstelle:
 *
 *     await portal.init()          SDK laden, Freigabe abwarten
 *     portal.spielStart()          ab jetzt wird gespielt
 *     portal.spielStop()           Menü, Pause, Game Over
 *     await portal.werbung()       -> 'belohnt' | 'abgebrochen' | 'fehler'
 *
 * WICHTIG — DAS SPIEL DARF OHNE PORTAL LAUFEN
 * Das SDK kommt von einem fremden Server. Es kann geblockt sein (Werbeblocker),
 * langsam sein oder gar nicht antworten. Nichts davon darf das Spiel
 * aufhalten: `init()` hat ein hartes Zeitlimit und meldet danach einfach
 * "kein Portal da". Lokal, in der Entwicklung und auf der eigenen Website
 * läuft dann derselbe Build ohne jede Änderung.
 *
 * WELCHES PORTAL, entscheidet CONFIG.ad.provider — oder die Adresse:
 * `?portal=crazygames` überschreibt die Config, damit man EINEN Build für
 * beide Portale hochladen kann, statt zwei getrennte zu pflegen.
 */

/* ===================================================================== *
 *  ZAHLEN, DIE DAS GAMEMONETIZE-SDK VORGIBT
 *
 *  Beide stammen NICHT aus einer Doku, sondern aus dem ausgelieferten
 *  Skript selbst: api.gamemonetize.com/sdk.js ist verschleiert, seine
 *  Zeichenkettentabelle hex-kodiert. Entschluesselt steht dort woertlich
 *  `preroll:!0, midroll:180000` — beim Laden laeuft ein Spot, und
 *  zwischen zwei Spots liegen mindestens 180 Sekunden.
 * ===================================================================== */

/* Mindestabstand zwischen zwei EIGENEN Anfragen.
 *
 * ACHTUNG, HIER STAND 180000, UND DAS WAR EIN FEHLSCHLUSS.
 *
 * Die 180000 aus dem SDK sind der Takt, in dem das Portal von SICH AUS einen
 * Zwischenspot legt — keine Sperre für `showBanner()`. Gemessen am laufenden
 * SDK: 13 Sekunden nach dem Preroll auf Anfrage ein vollständiger Spot über
 * 10.5 Sekunden, mit der ganzen Ereigniskette von LOADED bis COMPLETE.
 *
 * Mit 180 Sekunden hätte der Knopf "Werbung ansehen" beim ERSTEN Game Over
 * gefehlt — der Preroll läuft ja schon beim Laden, und die erste Runde ist
 * kürzer als drei Minuten. Genau die Stelle, an der ein Weiterleben am
 * meisten wert ist.
 *
 * 60 Sekunden verhindern das Hämmern, ohne etwas zu verschenken. Kommt trotz
 * Anfrage kein Spot, meldet `_ereignis` sauber 'fehler' — der Spieler
 * bekommt dann "Keine Werbung verfügbar" statt eines Knopfes, der nichts
 * tut. */
const SPERRE_MS = 60000;

/* Ab dieser Dauer gilt ein Spot als WIRKLICH gelaufen.
 *
 * Zwischen SDK_GAME_PAUSE und SDK_GAME_START liegt bei einem echten Spot
 * die Laufzeit des Videos. Kommt gar keiner, folgt SDK_GAME_START fast
 * unmittelbar. 2 Sekunden trennen beides sicher: kuerzer ist kein Spot,
 * und der kuerzeste ausgelieferte liegt bei 5 Sekunden. */
const MIN_SPOTDAUER = 2000;

/**
 * Wo läuft das Spiel? — 'local' | 'crazygames' | 'disabled' | 'unbekannt'
 *
 * HIER STAND `sdk.getEnvironment()`, UND DAS HAT DAS PORTAL GEKOSTET.
 *
 * Geladen wird `crazygames-sdk-v3.js`. In v3 ist die Umgebung eine schlichte
 * EIGENSCHAFT (`SDK.environment`); die Funktion `getEnvironment()` stammt aus
 * v2 und existiert dort nicht mehr. Am ausgelieferten SDK nachgesehen:
 *
 *     typeof SDK.getEnvironment   ->  "undefined"
 *     SDK.getEnvironment()        ->  wirft "is not a function"
 *     typeof SDK.environment      ->  "string"
 *
 * Der Aufruf warf also JEDES MAL, das umschliessende `catch` schluckte es
 * kommentarlos, die Umgebung blieb auf "unbekannt" — und die Abfrage
 * `=== 'crazygames'` konnte nie zutreffen. Folge: auf CrazyGames wurde der
 * CrazyGames-Adapter nie aktiv, sondern GameMonetize. Damit kam nie ein
 * `gameplayStart()` beim Portal an.
 *
 * Sichtbar war das erst in deren Prüfliste, als "No detected SDK
 * functionalities" und "First Gameplay Start: No" — und daran, dass beim Tod
 * kein Angebot für ein zweites Leben erschien.
 *
 * Beide Schreibweisen werden gelesen, damit ein SDK-Wechsel in die eine oder
 * andere Richtung das nicht wieder still kippt.
 */
export function umgebungLesen(sdk) {
  if (!sdk) return 'unbekannt';

  // v3: schlichte Eigenschaft. Vor init() steht dort "uninitialized".
  const wert = sdk.environment;
  if (typeof wert === 'string' && wert && wert !== 'uninitialized') return wert;

  // v2: Funktion. Nur rufen, wenn es wirklich eine ist.
  if (typeof sdk.getEnvironment === 'function') {
    try {
      const alt = sdk.getEnvironment();
      if (typeof alt === 'string' && alt) return alt;
    } catch {
      /* dann eben nicht */
    }
  }
  return 'unbekannt';
}

/**
 * Läuft das Spiel in der Android-Hülle statt im Browser?
 *
 * Capacitor legt dafür `window.Capacitor` an. Gefragt wird aber nicht danach,
 * ob das Objekt existiert, sondern nach `isNativePlatform()` — in einer
 * Web-Ausgabe von Capacitor gäbe es das Objekt nämlich auch, und die Antwort
 * wäre dort korrekt `false`.
 *
 * Der Import ist bewusst dynamisch und in try/catch: im Bündel für die
 * Web-Portale ist Capacitor gar nicht dabei, und ein fehlgeschlagener Import
 * darf den Start nicht aufhalten — er heisst schlicht "kein App-Gehäuse".
 */
async function istNativeApp() {
  try {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform) {
      return window.Capacitor.isNativePlatform() === true;
    }
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

/** Lädt ein Skript und gibt auf, wenn es zu lange dauert. */
function skriptLaden(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    let fertig = false;
    const uhr = setTimeout(() => {
      if (fertig) return;
      fertig = true;
      el.remove();
      reject(new Error('Zeitüberschreitung: ' + url));
    }, timeoutMs);

    el.src = url;
    el.async = true;
    el.onload = () => {
      if (fertig) return;
      fertig = true;
      clearTimeout(uhr);
      resolve();
    };
    el.onerror = () => {
      if (fertig) return;
      fertig = true;
      clearTimeout(uhr);
      el.remove();
      reject(new Error('nicht ladbar (Werbeblocker?): ' + url));
    };
    document.head.appendChild(el);
  });
}

/** Kein Portal — eigene Website, lokale Entwicklung, blockiertes SDK. */
export class KeinPortal {
  constructor(grund = 'nicht konfiguriert') {
    this.name = 'keins';
    this.grund = grund;
    this.bereit = false;
  }
  async init() {
    return false;
  }
  spielStart() {}
  spielStop() {}
  ladenStart() {}
  ladenFertig() {}
  hatWerbung() {
    return false;
  }
  async werbung() {
    return 'fehler';
  }
  abbrechen() {}
  /** Kein Portalspeicher — der Fortschritt geht dann über Supabase/Browser. */
  datenSpeicher() {
    return null;
  }
}

/**
 * CrazyGames.
 *
 * SDK v3. `requestAd('rewarded')` liefert das Ergebnis über Callbacks, nicht
 * über ein Promise — deshalb hier eingepackt.
 *
 * `adFinished` heisst NICHT automatisch "belohnt": bei einem übersprungenen
 * oder fehlgeschlagenen Spot kommt `adError`. Nur der eine Weg gilt.
 */
export class CrazyGames {
  constructor(cfg) {
    this.name = 'crazygames';
    this.cfg = cfg;
    this.bereit = false;
    this.sdk = null;
    this._abbruch = null;
  }

  async init() {
    try {
      await skriptLaden('https://sdk.crazygames.com/crazygames-sdk-v3.js', this.cfg.sdkTimeout);
      this.sdk = window.CrazyGames?.SDK;
      if (!this.sdk) throw new Error('SDK-Objekt fehlt');
      await this.sdk.init();
      this.bereit = true;
      return true;
    } catch (err) {
      console.info('[Portal] CrazyGames nicht verfügbar:', err.message);
      return false;
    }
  }

  ladenStart() {
    try {
      this.sdk?.game?.loadingStart();
    } catch {
      /* egal */
    }
  }
  ladenFertig() {
    try {
      this.sdk?.game?.loadingStop();
    } catch {
      /* egal */
    }
  }
  spielStart() {
    try {
      this.sdk?.game?.gameplayStart();
    } catch {
      /* egal */
    }
  }
  /**
   * Der Speicher von CrazyGames — das Beste, was es hier gibt.
   *
   * Er hängt am CrazyGames-KONTO des Spielers, nicht am Browser. Wer sich
   * dort anmeldet, findet seine Münzen und Affen auf jedem Gerät wieder, und
   * gelöschte Browserdaten kosten ihn nichts. Genau die Lücke, die weder
   * localStorage noch eine selbstvergebene Kennung schliessen kann.
   *
   * Die Schnittstelle sieht aus wie localStorage (getItem/setItem), ist aber
   * synchron und wirft, wenn das SDK fehlt — deshalb alles in try/catch.
   *
   * @returns {{getItem: Function, setItem: Function}|null}
   */
  datenSpeicher() {
    const d = this.sdk?.data;
    if (!d) return null;
    return {
      getItem: (k) => {
        try {
          return d.getItem(k);
        } catch {
          return null;
        }
      },
      setItem: (k, v) => {
        try {
          d.setItem(k, v);
        } catch {
          /* egal */
        }
      },
    };
  }

  spielStop() {
    try {
      this.sdk?.game?.gameplayStop();
    } catch {
      /* egal */
    }
  }

  hatWerbung() {
    return this.bereit;
  }

  /**
   * @param {'rewarded'|'midgame'} art
   *   `rewarded` = belohnter Spot fürs Weiterspielen, `midgame` = kurzer
   *   Zwischenspot zwischen zwei Runden. CrazyGames unterscheidet beide und
   *   rechnet sie verschieden ab; ein Zwischenspot als `rewarded` zu melden
   *   wäre eine Falschangabe gegenüber dem Portal.
   * @returns {Promise<'belohnt'|'abgebrochen'|'fehler'>}
   */
  werbung(art = 'rewarded') {
    if (!this.bereit) return Promise.resolve('fehler');
    return new Promise((resolve) => {
      let erledigt = false;
      const einmal = (wert) => {
        if (erledigt) return;
        erledigt = true;
        clearTimeout(uhr);
        this._abbruch = null;
        // Während des Spots läuft kein Spiel — dem Portal sagen, sonst zählt
        // es die Werbezeit als Spielzeit.
        this.spielStart();
        resolve(wert);
      };

      /* NOTBREMSE — die wichtigste Zeile dieser Datei.
       *
       * `requestAd` meldet sich über Callbacks. Kommt keiner — SDK hakt, Spot
       * lädt ewig, Netz weg —, bliebe dieses Promise für immer offen: der
       * Werbe-Screen stünde still da, der Lauf wäre nur noch per Neuladen zu
       * retten. Gemessen wurde genau das: über 75 Sekunden eingefroren.
       *
       * Das Spiel darf nie an einem fremden Server hängen. Nach Ablauf gilt
       * der Spot als fehlgeschlagen, und der Lauf endet normal. */
      const uhr = setTimeout(() => {
        console.info('[Portal] CrazyGames-Spot antwortet nicht — abgebrochen.');
        einmal('fehler');
      }, this.cfg.werbungTimeout);

      // Von aussen abbrechbar machen (Knopf "Abbrechen", Rückkehr ins Menü).
      this._abbruch = () => einmal('abgebrochen');

      try {
        this.spielStop();
        this.sdk.ad.requestAd(art, {
          adFinished: () => einmal('belohnt'),
          adError: (err) => {
            console.info('[Portal] CrazyGames-Spot fehlgeschlagen:', err);
            einmal('fehler');
          },
          // Kommt beim Öffnen; nur zum Stummschalten interessant.
          adStarted: () => {},
        });
      } catch (err) {
        console.info('[Portal] CrazyGames requestAd warf:', err);
        einmal('fehler');
      }
    });
  }

  /** Laufenden Spot von aussen beenden. Ohne laufenden passiert nichts. */
  abbrechen() {
    this._abbruch?.();
  }
}

/**
 * GameMonetize.
 *
 * Das SDK meldet sich über `window.sdkEvents` bzw. den `onEvent`-Rückruf.
 * Der belohnte Spot ist dort `SDK_REWARDED_WATCH_COMPLETE`; ohne diesen
 * Ereignisnamen gilt der Spot als abgebrochen.
 *
 * `gameId` MUSS gesetzt sein (CONFIG.ad.gameMonetizeId) — die vergibt das
 * Portal beim Einreichen. Ohne sie lädt das SDK zwar, liefert aber nie einen
 * Spot; deshalb wird hier gar nicht erst initialisiert.
 */
export class GameMonetize {
  constructor(cfg) {
    this.name = 'gamemonetize';
    this.cfg = cfg;
    this.bereit = false;
    this._offen = null;
    /** Zeitpunkt von SDK_GAME_PAUSE — siehe _ereignis. 0 = kein Spot offen. */
    this._spotBegann = 0;
    /* Wann zuletzt ein Spot ANGEFORDERT wurde.
     *
     * Beim Laden zeigt das Portal selbst schon einen (im SDK steht
     * `preroll: !0`). Der Zähler startet deshalb NICHT bei null, sondern
     * jetzt — sonst fragt das Spiel Sekunden später zum zweiten Mal und
     * bekommt vom SDK ein stilles Nein. */
    this._letzterSpot = Date.now();
  }

  async init() {
    if (!this.cfg.gameMonetizeId) {
      console.info('[Portal] GameMonetize: keine gameId in CONFIG.ad — übersprungen.');
      return false;
    }
    try {
      window.SDK_OPTIONS = {
        gameId: this.cfg.gameMonetizeId,
        onEvent: (event) => this._ereignis(event),
      };
      await skriptLaden('https://api.gamemonetize.com/sdk.js', this.cfg.sdkTimeout);
      this.bereit = true;
      return true;
    } catch (err) {
      console.info('[Portal] GameMonetize nicht verfügbar:', err.message);
      return false;
    }
  }

  /**
   * DIESES SDK KENNT KEINE BELOHNTE WERBUNG.
   *
   * Hier stand eine Abfrage auf `SDK_REWARDED_WATCH_COMPLETE`. Dieses
   * Ereignis gibt es nicht — nachgewiesen, nicht vermutet: die
   * Zeichenkettentabelle von api.gamemonetize.com/sdk.js ist verschleiert
   * (hex-kodiert), entschlüsselt enthält sie genau
   *
   *   SDK_READY, SDK_ERROR, SDK_BLOCKED, SDK_GAME_DATA_READY,
   *   SDK_GAME_START, SDK_GAME_PAUSE, SDK_SHOW_BANNER, SDK_IMPLEMENTED,
   *   SDK_WHITELABEL, SDK_TESTING_ENABLED, SDK_OPTIONS
   *
   * und das Wort "reward" KEIN EINZIGES MAL. Das SDK kann showBanner(),
   * pauseGame(), resumeGame() — mehr nicht.
   *
   * Die Folge war im Spiel sichtbar, aber nicht als Fehler erkennbar: der
   * Spot lief, danach kam `SDK_GAME_START`, der alte Code meldete
   * "abgebrochen", und der Spieler landete ohne Weiterleben im
   * Game-Over-Screen. Genau die Beschwerde "ich drücke Werbung ansehen und es
   * passiert nichts".
   *
   * WAS STATTDESSEN GEZÄHLT WIRD: das Paar aus Anhalten und Weiterlaufen.
   * `SDK_GAME_PAUSE` heisst "ein Spot beginnt", `SDK_GAME_START` heisst "er
   * ist vorbei". Kam beides und lag genug Zeit dazwischen, hat der Spieler
   * wirklich etwas gesehen — dann ist die Belohnung verdient.
   *
   * DIE ZEITSCHWELLE IST DER KERN, nicht Feinschliff. Ohne sie wäre jedes
   * sofortige `SDK_GAME_START` ein Freifahrtschein — und genau das schickt
   * das SDK, wenn wegen der Dreiminutensperre gar kein Spot kommt. Das
   * Weiterleben gäbe es dann geschenkt, und zwar immer.
   */
  _ereignis(event) {
    const name = event?.name;

    /* NUR ZÄHLEN, SOLANGE WIR SELBST GEFRAGT HABEN.
     *
     * Am lebenden SDK nachgesehen: `onPauseGame()` und `onResumeGame()` sind
     * die öffentlichen Methoden — und sie FEUERN SDK_GAME_PAUSE bzw.
     * SDK_GAME_START selbst. Unsere eigenen Spielmeldungen erzeugen also
     * exakt die Ereignisse, an denen hier ein Spot erkannt wird.
     *
     * Ohne diese Schranke wäre die Kette: Spieler stirbt -> spielStop()
     * -> SDK_GAME_PAUSE -> `_spotBegann` gesetzt. Er liest in Ruhe den
     * Game-Over-Schirm, drückt nach zehn Sekunden "Werbung ansehen", es
     * kommt gar kein Spot, das SDK meldet sofort SDK_GAME_START — und die
     * Zeitprüfung sähe zehn Sekunden und schenkte ihm das Weiterleben.
     * Jedes Mal. */
    if (!this._offen) return;

    if (name === 'SDK_GAME_PAUSE') {
      this._spotBegann = Date.now();
      return;
    }

    if (name === 'SDK_GAME_START') {
      const gelaufen =
        this._spotBegann > 0 && Date.now() - this._spotBegann >= MIN_SPOTDAUER;
      this._spotBegann = 0;
      this._offen(gelaufen ? 'belohnt' : 'fehler');
    } else if (name === 'SDK_ERROR' || name === 'SDK_BLOCKED') {
      this._spotBegann = 0;
      this._offen('fehler');
    }
  }

  /* GameMonetize hat KEINEN Spielerspeicher.
   *
   * Das ist kein Versehen und keine fehlende Umsetzung: das SDK bietet
   * schlicht nichts dergleichen an — es kann Werbung und sonst nichts. Wer
   * dort spielt, hängt an Supabase bzw. am Browser. */
  datenSpeicher() {
    return null;
  }

  ladenStart() {}
  ladenFertig() {}

  /* DAS SDK WILL WISSEN, WANN GESPIELT WIRD — und es hat Methoden dafür.
   *
   * Hier stand `window.sdk?.showBanner && null;`, also eine Zeile, die nichts
   * tut, und darunter ein leeres spielStop(). Ohne diese Meldungen legt das
   * Portal seine eigenen Spots blind, und die Einreichung prüft, ob beides
   * kommt.
   *
   * DIE METHODEN HEISSEN `onPauseGame` UND `onResumeGame`, nicht
   * `pauseGame`/`resumeGame`. Beides steht in der Zeichenkettentabelle, aber
   * am lebenden Objekt existieren nur die `on`-Fassungen — die anderen sind
   * SDK-intern. Am echten `window.sdk` nachgesehen:
   *
   *   showBanner, onPauseGame, onResumeGame, play, customLog, openConsole
   *
   * Ein Aufruf von `pauseGame()` wäre stillschweigend wirkungslos gewesen.
   *
   * WÄHREND EINES SPOTS WIRD NICHTS GEMELDET. Beide Methoden feuern ihr
   * eigenes Ereignis (SDK_GAME_PAUSE bzw. SDK_GAME_START), und genau die
   * wertet `_ereignis` aus. Eine Meldung mitten in einer laufenden
   * Werbeanfrage würde diese sofort beenden. */
  spielStart() {
    if (this._offen) return;
    try {
      window.sdk?.onResumeGame?.('spiel laeuft', 'success');
    } catch {
      /* Das SDK darf uns nicht mit ins Verderben reissen. */
    }
  }

  spielStop() {
    if (this._offen) return;
    try {
      window.sdk?.onPauseGame?.('spiel pausiert', 'success');
    } catch {
      /* dito */
    }
  }

  /**
   * Gibt es überhaupt einen Spot zu holen?
   *
   * DIE SPERRE DES PORTALS WIRD MITGEFÜHRT. Im SDK steht `midroll: 180000` —
   * drei Minuten Mindestabstand zwischen zwei Spots, vom Portal erzwungen.
   * Fragt man früher, passiert schlicht NICHTS: kein Spot, keine Meldung,
   * kein Fehler. Für den Spieler sah das aus wie ein kaputter Knopf.
   *
   * Mit dieser Abfrage verschwindet der Knopf "Werbung ansehen" stattdessen
   * (Game._continueAvailable fragt ads.isReady()), solange die Sperre läuft.
   * Ein Angebot, das nicht eingelöst werden kann, ist schlimmer als keines.
   */
  hatWerbung() {
    return this.bereit && Date.now() - this._letzterSpot >= SPERRE_MS;
  }

  werbung() {
    if (!this.hatWerbung()) return Promise.resolve('fehler');
    this._letzterSpot = Date.now();
    return new Promise((resolve) => {
      let erledigt = false;
      const einmal = (wert) => {
        if (erledigt) return;
        erledigt = true;
        this._offen = null;
        this._spotBegann = 0;
        clearTimeout(uhr);
        resolve(wert);
      };
      // Sauber anfangen: was vorher an Pausen kam, gehört nicht zu DIESEM Spot.
      this._spotBegann = 0;
      this._offen = einmal;

      // Sicherheitsnetz: antwortet das SDK gar nicht, hängt sonst der
      // Werbe-Screen für immer und das Spiel ist verloren.
      const uhr = setTimeout(() => einmal('fehler'), this.cfg.werbungTimeout);

      try {
        window.sdk.showBanner();
      } catch (err) {
        console.info('[Portal] GameMonetize showBanner warf:', err);
        einmal('fehler');
      }
    });
  }

  /** Laufenden Spot von aussen beenden. Ohne laufenden passiert nichts. */
  abbrechen() {
    this._offen?.('abgebrochen');
  }
}

/**
 * AdMob — die Werbung der ANDROID-APP, nicht der Web-Portale.
 *
 * WARUM DAS EIN EIGENER ADAPTER IST
 *
 * Im Play Store läuft dasselbe Spiel, aber in einer nativen Hülle
 * (Capacitor, siehe scripts/app-huelle.md). Die Web-SDKs von CrazyGames und
 * GameMonetize würden dort nicht einmal laden — und dürften es auch nicht,
 * der Play Store verlangt für App-Werbung AdMob.
 *
 * DIE GUTE NACHRICHT gegenüber GameMonetize: hier muss nichts erschlossen
 * werden. `showRewardVideoAd()` LÖST ERST AUF, WENN DIE BELOHNUNG WIRKLICH
 * VERDIENT IST — bricht der Spieler ab, kommt stattdessen `Dismissed` und
 * das Versprechen wird abgelehnt. Die ganze Zeitmesserei aus dem
 * GameMonetize-Adapter (SDK_GAME_PAUSE, Mindestdauer, "die eigene Pause darf
 * nicht zählen") entfällt deshalb ersatzlos.
 *
 * ANZEIGEN WERDEN VORGELADEN. `prepare…` holt den Spot im Hintergrund,
 * `show…` zeigt ihn. Ohne Vorladen wartet der Spieler nach dem Klick
 * mehrere Sekunden vor einem leeren Bildschirm — deshalb wird direkt nach
 * jedem Spot der nächste vorbereitet.
 */
export class AdMobPortal {
  constructor(cfg) {
    this.name = 'admob';
    this.cfg = cfg;
    this.bereit = false;
    this.admob = null;
    /** Liegt ein belohnter Spot abrufbereit? */
    this._belohntBereit = false;
    /** Liegt ein Zwischenspot abrufbereit? */
    this._zwischenBereit = false;
    this._letzterSpot = 0;
    /** Beendet einen laufenden Spot von aussen (Notbremse, Abbrechen-Knopf). */
    this._abbruch = null;
  }

  /**
   * Lässt einen Spot höchstens `werbungTimeout` lang laufen und macht ihn
   * von aussen abbrechbar.
   *
   * DAS FEHLTE, UND ES WAR DAS ERNSTESTE LOCH DER APP.
   *
   * CrazyGames und GameMonetize haben beide eine solche Notbremse — dort
   * steht sogar im Kommentar, dass ein eingefrorener Spot einmal über
   * 75 Sekunden gemessen wurde. Ausgerechnet AdMob, der EINZIGE Anbieter,
   * der im Play Store überhaupt läuft, hatte keine. Settelte
   * `showRewardVideoAd()` nie, stand der Werbebildschirm still, und
   * `abbrechen()` war ein leerer Rumpf — der Knopf tat nichts. Der Spieler
   * kam nur durch einen Neustart der App heraus und verlor dabei Lauf und
   * gesammelte Münzen.
   *
   * @param {Promise<string>} spot löst mit 'belohnt' | 'abgebrochen' auf
   * @returns {Promise<'belohnt'|'abgebrochen'|'fehler'>}
   */
  _mitNotbremse(spot) {
    return new Promise((fertig) => {
      let erledigt = false;
      const einmal = (wert) => {
        // Wer zuerst kommt, gewinnt: Spot, Notbremse oder Abbrechen-Knopf.
        if (erledigt) return;
        erledigt = true;
        clearTimeout(uhr);
        this._abbruch = null;
        fertig(wert);
      };

      /* Der Rückfallwert ist nicht Zierde: `setTimeout(fn, undefined)` wird
       * als 0 gelesen und feuerte sofort — jeder Spot würde augenblicklich
       * als fehlgeschlagen gelten, und zwar lautlos. Fehlt die Einstellung,
       * ist eine grosszügige Frist die sichere Richtung. */
      const frist = this.cfg?.werbungTimeout ?? 45000;
      const uhr = setTimeout(() => {
        console.info('[Portal] AdMob-Spot antwortet nicht — abgebrochen.');
        einmal('fehler');
      }, frist);

      // Von aussen abbrechbar machen (Knopf "Abbrechen", Rückkehr ins Menü).
      this._abbruch = () => einmal('abgebrochen');

      spot.then(einmal, (err) => {
        console.info('[Portal] AdMob-Spot:', err?.message ?? err);
        einmal('abgebrochen');
      });
    });
  }

  async init() {
    const ids = this.cfg.admob;
    if (!ids?.belohnt || !ids?.zwischen) {
      console.info('[Portal] AdMob: keine Anzeigen-IDs in CONFIG.ad.admob — übersprungen.');
      return false;
    }
    try {
      /* Erst HIER laden, nicht oben als fester Import.
       *
       * Das Modul zieht Capacitor mit, und das gehört nicht in das Bündel
       * für die Web-Portale — dort läuft es nie. Der dynamische Import
       * landet in einem eigenen Stück, das im Browser gar nicht angefasst
       * wird. */
      const modul = await import('@capacitor-community/admob');
      this.admob = modul.AdMob;

      await this.admob.initialize({
        // Testgeräte und Testanzeigen steuert CONFIG.ad.admob.test.
        initializeForTesting: ids.test === true,
        // Nur familienfreundliche Anzeigeninhalte — siehe Kommentar bei
        // CONFIG.ad.admob.inhaltsrating.
        maxAdContentRating: ids.inhaltsrating ?? 'General',
      });

      this.bereit = true;
      // Beide Sorten schon einmal vorladen, damit der erste Spot sofort da ist.
      this._vorladen('belohnt');
      this._vorladen('zwischen');
      return true;
    } catch (err) {
      console.info('[Portal] AdMob nicht verfügbar:', err?.message ?? err);
      return false;
    }
  }

  /** Holt einen Spot im Hintergrund, damit `show` später nicht wartet. */
  async _vorladen(art) {
    const ids = this.cfg.admob;
    try {
      if (art === 'belohnt') {
        await this.admob.prepareRewardVideoAd({ adId: ids.belohnt, isTesting: ids.test === true });
        this._belohntBereit = true;
      } else {
        await this.admob.prepareInterstitial({ adId: ids.zwischen, isTesting: ids.test === true });
        this._zwischenBereit = true;
      }
    } catch (err) {
      // Kein Spot verfügbar ist ein normaler Zustand, kein Fehler.
      if (art === 'belohnt') this._belohntBereit = false;
      else this._zwischenBereit = false;
      console.info(`[Portal] AdMob ${art} nicht ladbar:`, err?.message ?? err);
    }
  }

  /* AdMob hat keinen Spielerspeicher — der Fortschritt läuft weiter über
   * Supabase bzw. den Browser der Hülle. */
  datenSpeicher() {
    return null;
  }

  /* AdMob will nicht wissen, wann gespielt wird — es legt keine eigenen
   * Spots. Alles Werbliche geht ausschliesslich über werbung(). */
  ladenStart() {}
  ladenFertig() {}
  spielStart() {}
  spielStop() {}

  hatWerbung() {
    return (
      this.bereit &&
      this._belohntBereit &&
      Date.now() - this._letzterSpot >= SPERRE_MS
    );
  }

  /**
   * @param {'rewarded'|'midgame'} art
   * @returns {Promise<'belohnt'|'abgebrochen'|'fehler'>}
   */
  async werbung(art = 'rewarded') {
    if (!this.bereit) return 'fehler';
    const zwischenspot = art === 'midgame';

    if (zwischenspot) {
      if (!this._zwischenBereit) return 'fehler';
      this._letzterSpot = Date.now();
      this._zwischenBereit = false;
      try {
        // Für den Zwischenspot zählt nur, DASS er lief — deshalb 'belohnt'.
        const ende = await this._mitNotbremse(
          this.admob.showInterstitial().then(() => 'belohnt'),
        );
        return ende === 'belohnt' ? 'belohnt' : 'fehler';
      } finally {
        this._vorladen('zwischen');
      }
    }

    if (!this._belohntBereit) return 'fehler';
    this._letzterSpot = Date.now();
    this._belohntBereit = false;
    try {
      /* HIER LIEGT DER GANZE UNTERSCHIED ZU GAMEMONETIZE.
       *
       * Diese Zusage löst NUR auf, wenn der Spieler den Spot wirklich zu
       * Ende gesehen hat — AdMob liefert dann den verdienten Lohn. Wer
       * abbricht, landet im catch. Es gibt hier also nichts zu erschliessen
       * und keine Mindestdauer zu messen. */
      return await this._mitNotbremse(
        this.admob.showRewardVideoAd().then((lohn) => (lohn ? 'belohnt' : 'abgebrochen')),
      );
    } finally {
      this._vorladen('belohnt');
    }
  }

  /**
   * Bricht das WARTEN auf einen Spot ab.
   *
   * Der alte Kommentar hier lautete: "Ein laufender AdMob-Spot gehört dem
   * Anbieter — er lässt sich von aussen nicht abbrechen." Das stimmt für das
   * native Overlay, war als Begründung für einen leeren Rumpf aber falsch.
   * Denn abzubrechen ist nicht der Spot, sondern unser Warten darauf: hängt
   * das Overlay oder kommt es nie, sass der Spieler ohne diesen Aufruf für
   * immer im Werbebildschirm fest.
   *
   * Der Lauf gilt dann als abgebrochen — also ohne Belohnung. Das ist die
   * sichere Richtung: lieber kein Extraleben als ein verschenktes für einen
   * Spot, den niemand gesehen hat.
   */
  abbrechen() {
    this._abbruch?.();
  }
}

/**
 * Erkennt das Portal SELBST, statt sich sagen zu lassen, wo es läuft.
 *
 * WARUM DAS NÖTIG IST — der erste Entwurf war hier falsch.
 * Ursprünglich hing die Wahl allein an `?portal=crazygames` in der Adresse,
 * damit ein Build für beide Portale reicht. Nur: CrazyGames lädt das ZIP hoch
 * und liefert es unter EINER EIGENEN Adresse aus, an die niemand einen
 * Parameter hängen kann. Dort wäre also nie ein SDK geladen worden — kein
 * gameplayStart, keine Werbung, nur der Platzhalter-Countdown. Ein Spiel, das
 * auf dem Portal keine Werbung zeigt, verdient nichts und fällt bei der
 * Prüfung durch.
 *
 * Deshalb fragt das SDK jetzt selbst: `getEnvironment()` liefert
 * 'crazygames', wenn das Spiel wirklich dort läuft, sonst 'local' oder
 * 'disabled'. Genau dafür ist die Funktion gedacht.
 *
 * Reihenfolge:
 *   0. Läuft das Ganze als ANDROID-APP? Dann AdMob, und sonst nichts.
 *   1. CrazyGames-SDK laden und fragen, ob wir dort sind.
 *   2. Sonst GameMonetize, sofern eine gameId eingetragen ist.
 *   3. Sonst kein Portal — Platzhalter, alles läuft weiter.
 */
export class AutoPortal {
  constructor(cfg) {
    this.name = 'auto';
    this.cfg = cfg;
    this.inner = new KeinPortal('noch nicht geprüft');
  }

  async init() {
    /* DIE APP ZUERST, und zwar ohne die Web-SDKs auch nur anzufassen.
     *
     * In der Android-Hülle wäre CrazyGames' `getEnvironment()` schlicht
     * 'local' — der Code liefe also weiter zu GameMonetize, lüde dort ein
     * Web-Werbe-SDK, und genau das verbietet der Play Store. Deshalb steht
     * diese Abfrage VOR allen anderen und steigt sofort aus.
     *
     * Erkannt wird es an Capacitor selbst (`isNativePlatform()`), nicht an
     * der Adresse: die Hülle liefert das Spiel unter http://localhost aus,
     * dieselbe Adresse wie der Entwicklungsserver. Wer daran unterscheiden
     * wollte, läge im Browser prompt falsch. */
    if (await istNativeApp()) {
      const admob = new AdMobPortal(this.cfg);
      if (await admob.init()) {
        this.inner = admob;
        this.name = 'admob';
        console.info('[Portal] Android-App erkannt, AdMob aktiv.');
        return true;
      }
      /* Native App, aber AdMob liess sich nicht einrichten: dann lieber GAR
       * KEINE Werbung als ein Web-SDK, das hier nicht hingehört. */
      this.inner = new KeinPortal('App ohne AdMob');
      this.name = 'keins';
      console.info('[Portal] Android-App, aber AdMob nicht verfügbar — ohne Werbung.');
      return false;
    }

    const cg = new CrazyGames(this.cfg);
    if (await cg.init()) {
      const umgebung = umgebungLesen(cg.sdk);

      if (umgebung === 'crazygames') {
        this.inner = cg;
        this.name = 'crazygames';
        console.info('[Portal] CrazyGames erkannt.');
        return true;
      }
      console.info(`[Portal] CrazyGames-SDK geladen, Umgebung "${umgebung}" — nicht dort.`);
    }

    if (this.cfg.gameMonetizeId) {
      const gm = new GameMonetize(this.cfg);
      if (await gm.init()) {
        this.inner = gm;
        this.name = 'gamemonetize';
        console.info('[Portal] GameMonetize aktiv.');
        return true;
      }
    }

    this.inner = new KeinPortal('kein Portal erkannt');
    this.name = 'keins';
    return false;
  }

  /* Ab hier nur durchreichen. */
  datenSpeicher() {
    return this.inner.datenSpeicher();
  }
  spielStart() {
    this.inner.spielStart();
  }
  spielStop() {
    this.inner.spielStop();
  }
  ladenStart() {
    this.inner.ladenStart();
  }
  ladenFertig() {
    this.inner.ladenFertig();
  }
  hatWerbung() {
    return this.inner.hatWerbung();
  }
  /* DIE WERBEART MUSS DURCH.
   *
   * Hier stand `werbung() { return this.inner.werbung(); }` — ohne
   * Parameter. Game meldet aber ausdruecklich 'midgame' fuer den
   * Zwischenspot; verschluckt an dieser Stelle, kam beim Portal der
   * Standardwert 'rewarded' an. Das ist eine Falschangabe gegenueber dem
   * Portal, das beide verschieden abrechnet — genau davor warnt der
   * Kommentar bei CrazyGames.werbung(). */
  werbung(art) {
    return this.inner.werbung(art);
  }
  abbrechen() {
    this.inner.abbrechen();
  }
  get grund() {
    return this.inner.grund;
  }
}

/**
 * Wählt das Portal.
 *
 * `?portal=…` in der Adresse schlägt alles — das ist der Testschalter, mit
 * dem sich beide Anbindungen lokal ausprobieren lassen. Ohne ihn entscheidet
 * CONFIG.ad.provider; 'auto' ist der Normalfall und erkennt selbst.
 */
export function erzeugePortal(cfg) {
  let name = cfg.provider;
  try {
    const p = new URLSearchParams(window.location.search).get('portal');
    if (p) name = p;
  } catch {
    /* kein window.location — dann bleibt die Config */
  }

  switch (name) {
    case 'auto':
      return new AutoPortal(cfg);
    case 'crazygames':
      return new CrazyGames(cfg);
    case 'gamemonetize':
      return new GameMonetize(cfg);
    default:
      return new KeinPortal(name === 'stub' ? 'Platzhalter' : `unbekannt: ${name}`);
  }
}
