/**
 * Belohnte Werbung ("Rewarded Ad") — Spot ansehen, dafür weiterspielen.
 *
 * DIE SCHNITTSTELLE IST EINE EINZIGE METHODE
 *
 *     await adService.show(onTick) -> 'belohnt' | 'abgebrochen' | 'fehler'
 *
 * `onTick(restSekunden)` wird beim eingebauten Platzhalter jede Sekunde
 * gerufen, damit die UI mitzählen kann; ein echtes SDK ruft sie nie — dort
 * übernimmt der Werbeanbieter das ganze Bild.
 *
 * NUR 'belohnt' DARF WEITERSPIELEN AUSLÖSEN. Alles andere — abgebrochen,
 * Netzwerk weg, Werbeblocker, kein Spot verfügbar — endet den Lauf ganz
 * normal. Das ist der Grund, warum hier drei Rückgaben stehen statt eines
 * true/false: der Aufrufer soll "abgebrochen" (Spielerentscheidung) von
 * "fehler" (unser Problem) unterscheiden und dem Spieler das Passende sagen
 * können.
 *
 * EIN ECHTES SDK EINHÄNGEN
 * 1. Klasse mit derselben `show()`-Signatur schreiben, z. B. `AdMobAds`.
 * 2. In `createAdService()` unten einen Zweig ergänzen.
 * 3. In CONFIG.ad `provider` auf den neuen Namen setzen.
 * Am restlichen Spiel ist dann nichts zu tun — Game.js kennt nur `show()`.
 */

/**
 * Platzhalter ohne Netzwerk.
 *
 * Zeigt keinen echten Spot, wartet aber die konfigurierte Zeit ab und liefert
 * dieselben Rückgaben wie ein SDK. Damit ist der ganze Ablauf — Button, Warten,
 * Weiterspielen, Unverwundbarkeit — schon jetzt spielbar und prüfbar, bevor
 * ein Werbekonto existiert.
 */
export class StubAds {
  /**
   * @param {{stubDuration: number}} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this._abbruch = null;
  }

  /** Immer verfügbar — der Platzhalter kann nicht ausverkauft sein. */
  isReady() {
    return true;
  }

  /**
   * @param {(rest: number) => void} [onTick] Restsekunden, einmal je Sekunde
   * @returns {Promise<'belohnt'|'abgebrochen'|'fehler'>}
   */
  show(onTick) {
    const dauer = Math.max(1, Math.round(this.cfg.stubDuration ?? 5));

    return new Promise((resolve) => {
      let rest = dauer;
      onTick?.(rest);

      const timer = setInterval(() => {
        rest -= 1;
        onTick?.(Math.max(0, rest));
        if (rest <= 0) {
          aufraeumen();
          resolve('belohnt');
        }
      }, 1000);

      const aufraeumen = () => {
        clearInterval(timer);
        this._abbruch = null;
      };

      // Abbrechen von aussen (Spieler drückt Escape oder verlässt den Spot).
      this._abbruch = () => {
        aufraeumen();
        resolve('abgebrochen');
      };
    });
  }

  /** Bricht einen laufenden Spot ab. Ohne laufenden Spot passiert nichts. */
  cancel() {
    this._abbruch?.();
  }
}

/**
 * Dienst, der gar keine Werbung kennt.
 *
 * Greift, wenn CONFIG.ad.enabled auf false steht. `isReady()` sagt nein, der
 * Weiterspielen-Button erscheint deshalb erst gar nicht.
 */
export class NoAds {
  isReady() {
    return false;
  }

  async show() {
    return 'fehler';
  }

  cancel() {}
}

/**
 * Werbung über ein Spieleportal (CrazyGames, GameMonetize).
 *
 * Reicht nur durch: das Portal kennt schon dieselben drei Rückgaben, und die
 * Ereignisse "Spiel läuft / pausiert" schickt Game direkt an das Portal.
 * `onTick` bleibt ungenutzt — den Countdown zeigt der Anbieter selbst.
 */
export class PortalAds {
  /** @param {import('./Portal.js').CrazyGames} portal */
  constructor(portal) {
    this.portal = portal;
  }

  isReady() {
    return this.portal.hatWerbung();
  }

  /**
   * @param {(rest:number)=>void} _onTick wird vom Portal nicht gebraucht
   * @param {'rewarded'|'midgame'} art siehe Portal.werbung
   */
  show(_onTick, art = 'rewarded') {
    return this.portal.werbung(art);
  }

  /* Abbrechen MUSS durchgereicht werden.
   *
   * Hier stand vorher ein leerer Rumpf mit der Begründung, ein Spot gehöre
   * dem Anbieter. Das stimmt für das Werbefenster — aber nicht für unser
   * Warten darauf. Gemessen: Klick auf Abbrechen bewirkte nichts, der
   * Werbe-Screen blieb über 75 Sekunden stehen und der Lauf war nur per
   * Neuladen zu retten. */
  cancel() {
    this.portal.abbrechen?.();
  }
}

/**
 * @param {typeof import('../config.js').CONFIG.ad} cfg
 * @param {object|null} portal aus erzeugePortal(), bereits initialisiert
 */
export function createAdService(cfg, portal = null) {
  if (!cfg?.enabled) return new NoAds();

  // Ein bereitstehendes Portal schlägt immer den Platzhalter — auch wenn in
  // der Config noch 'stub' steht. Sonst liefe auf CrazyGames der
  // Countdown-Platzhalter statt eines echten Spots, und der Betreiber
  // bekäme kein Geld für ein Spiel, das er ausliefert.
  if (portal?.hatWerbung?.()) return new PortalAds(portal);

  switch (cfg.provider) {
    case 'stub':
      return new StubAds(cfg);
    case 'auto':
    case 'crazygames':
    case 'gamemonetize':
      /* Portal war vorgesehen, hat sich aber nicht gemeldet: eigene Website,
       * lokaler Test, Werbeblocker. Platzhalter statt gar nichts — das zweite
       * Leben bleibt spielbar, es wird nur nichts abgerechnet.
       *
       * `auto` gehörte hier zuerst NICHT dazu, und das war ein Rückschritt:
       * ausserhalb der Portale landete der Dienst auf NoAds, und damit war
       * das Weiterspielen nach dem Tod ersatzlos verschwunden — ohne dass
       * irgendwo eine Zahl danach ausgesehen hätte. */
      console.info(`[AdService] Kein Portal aktiv (${cfg.provider}) — Platzhalter.`);
      return new StubAds(cfg);
    default:
      console.warn(`[AdService] Unbekannter Anbieter "${cfg.provider}" — Werbung bleibt aus.`);
      return new NoAds();
  }
}
