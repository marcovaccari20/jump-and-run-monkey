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

  _ereignis(event) {
    const name = event?.name;
    if (!this._offen) return;
    if (name === 'SDK_REWARDED_WATCH_COMPLETE') this._offen('belohnt');
    // Der Spot ist zu Ende — belohnt oder nicht, das Spiel geht weiter.
    else if (name === 'SDK_GAME_START') this._offen('abgebrochen');
    else if (name === 'SDK_ERROR') this._offen('fehler');
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
  spielStart() {
    try {
      window.sdk?.showBanner && null; // Banner nur über werbung(), nicht hier
    } catch {
      /* egal */
    }
  }
  spielStop() {}

  hatWerbung() {
    return this.bereit;
  }

  werbung() {
    if (!this.bereit) return Promise.resolve('fehler');
    return new Promise((resolve) => {
      let erledigt = false;
      const einmal = (wert) => {
        if (erledigt) return;
        erledigt = true;
        this._offen = null;
        clearTimeout(uhr);
        resolve(wert);
      };
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
    const cg = new CrazyGames(this.cfg);
    if (await cg.init()) {
      let umgebung = 'unbekannt';
      try {
        umgebung = cg.sdk.getEnvironment();
      } catch {
        /* ältere SDK-Fassung ohne die Funktion */
      }
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
  werbung() {
    return this.inner.werbung();
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
