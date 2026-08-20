/**
 * Der Besitz des Spielers: Münzen und Freigeschaltetes.
 *
 * WARUM DAS EINE EIGENE SCHICHT IST
 * Heute liegt alles im Browser (localStorage). Das ist für den Anfang genau
 * richtig — kein Server, keine Kosten, keine Konten, keine Datenschutzfragen,
 * und offline spielbar. Es hat aber drei Grenzen, die irgendwann weh tun:
 *
 *   1. Ein anderes Gerät kennt den Fortschritt nicht.
 *   2. Browserdaten löschen = alles weg.
 *   3. Wer mag, setzt seinen Münzstand in der Konsole auf eine Million.
 *
 * Jede dieser Grenzen verschwindet erst mit einem Server. Damit dieser Wechsel
 * später kein Umbau wird, greift das Spiel NIE direkt auf localStorage zu,
 * sondern immer über diese Klasse — und die spricht mit einem austauschbaren
 * `speicher`. Ein Server-Speicher muss genau zwei Methoden können:
 *
 *     await speicher.laden()          -> { muenzen, frei: [...] }
 *     await speicher.sichern(stand)
 *
 * Mehr ist es nicht. Siehe README, Abschnitt "Server, Konten, Bestenliste".
 *
 * WICHTIG — DAS SPIEL DARF NIE AUF DEN SPEICHER WARTEN
 * Auch der Serverspeicher wird asynchron sein. Deshalb hält diese Klasse den
 * Stand IM SPEICHER und schreibt nur nebenher zurück. Ein hängender Server
 * darf das Menü nicht blockieren; im schlimmsten Fall geht der letzte
 * Zugewinn verloren, nicht das Spiel.
 */

/** Vereinheitlicht, was aus irgendeinem Speicher zurückkommt. */
function saeubern(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    muenzen: Number.isFinite(d.muenzen) ? Math.max(0, Math.floor(d.muenzen)) : 0,
    frei: Array.isArray(d.frei) ? d.frei.filter((x) => typeof x === 'string') : [],
  };
}

/**
 * Speicher im Browser. Synchron, kostenlos, gerätegebunden.
 *
 * Nimmt wahlweise eine localStorage-ÄHNLICHE Ablage entgegen — dadurch passt
 * hier auch der Speicher von CrazyGames hinein, der genau dieselbe
 * getItem/setItem-Form hat, aber am Spielerkonto hängt statt am Browser.
 */
export class LokalerSpeicher {
  constructor(schluessel, ablage = null) {
    this.schluessel = schluessel;
    this._ablage = ablage;
  }

  get ablage() {
    // Erst bei Bedarf holen: localStorage kann werfen (Privatmodus, gesperrter
    // Fremd-Rahmen), und das darf den Konstruktor nicht mitreissen.
    if (this._ablage) return this._ablage;
    try {
      return localStorage;
    } catch {
      return null;
    }
  }

  laden() {
    try {
      const roh = this.ablage?.getItem(this.schluessel);
      if (!roh) return null;
      return saeubern(JSON.parse(roh));
    } catch {
      // Gesperrt (Privatmodus) oder defekt — dann fängt man eben neu an.
      return null;
    }
  }

  sichern(stand) {
    try {
      this.ablage?.setItem(this.schluessel, JSON.stringify(stand));
    } catch {
      /* nicht schreibbar — der Stand gilt wenigstens für diese Sitzung */
    }
  }
}

/**
 * Fortschritt in der Supabase-Datenbank, an eine Spielerkennung gebunden.
 *
 * WAS DAS LÖST UND WAS NICHT — ehrlich, weil die Frage sonst später kommt:
 *
 * Die Kennung ist eine zufällige UUID, die im Browser liegt. Damit ist der
 * Fortschritt zwar auf dem SERVER, hängt aber weiterhin an diesem Browser:
 * gelöschte Browserdaten kosten die Kennung und damit den Zugang. Das wäre
 * für sich genommen kein Gewinn gegenüber localStorage.
 *
 * Der Gewinn entsteht erst durch den WIEDERHERSTELLUNGSCODE: die Kennung ist
 * lesbar und lässt sich auf einem anderen Gerät eingeben. Wer ihn notiert,
 * nimmt seine Münzen und Affen mit — ohne Konto, ohne Passwort, ohne
 * E-Mail-Adresse.
 *
 * Auf CrazyGames braucht es das alles nicht: dort hängt der Speicher am
 * Konto des Spielers (siehe Portal.datenSpeicher).
 */
/**
 * Ruft eine Datenbankfunktion auf.
 *
 * DIE SERVERMELDUNG MUSS DURCHKOMMEN. Die erste Fassung warf nur
 * `HTTP ${status}` — für das Laden und Sichern reichte das, weil dort jeder
 * Fehler gleich behandelt wird ("dann gilt eben der lokale Stand"). Beim
 * Übertragungscode ist es umgekehrt: "Dieser Code ist schon vergeben" und
 * "Zu viele Fehlversuche" sind genau das, was der Spieler lesen muss.
 * PostgREST liefert die Meldung aus `raise exception` im Feld `message`.
 *
 * @throws {Error} mit der Servermeldung, dazu `.status`
 */
async function rpc(cfg, fn, koerper) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), cfg.timeout);
  try {
    const antwort = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: cfg.schluessel,
        Authorization: `Bearer ${cfg.schluessel}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(koerper),
      signal: abbruch.signal,
    });
    const text = await antwort.text();

    if (!antwort.ok) {
      let meldung = `HTTP ${antwort.status}`;
      try {
        const d = JSON.parse(text);
        if (d?.message) meldung = d.message;
      } catch {
        /* keine JSON-Antwort — dann bleibt der Statuscode */
      }
      const fehler = new Error(meldung);
      fehler.status = antwort.status;
      throw fehler;
    }

    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(uhr);
  }
}

export class SupabaseSpeicher {
  /**
   * @param {typeof import('../config.js').CONFIG.bestenliste} cfg Adresse+Schlüssel
   * @param {string} spielerId
   */
  constructor(cfg, spielerId) {
    this.cfg = cfg;
    this.spielerId = spielerId;
  }

  async _ruf(fn, koerper) {
    return rpc(this.cfg, fn, koerper);
  }

  async laden() {
    try {
      const d = await this._ruf(this.cfg.standLadenFn, { p_spieler: this.spielerId });
      return saeubern(d);
    } catch {
      // Kein Netz: der lokale Stand gilt weiter. Nichts geht verloren.
      return null;
    }
  }

  async sichern(stand) {
    try {
      await this._ruf(this.cfg.standSichernFn, {
        p_spieler: this.spielerId,
        p_muenzen: Math.max(0, Math.floor(stand.muenzen)),
        p_frei: stand.frei,
      });
      return true;
    } catch {
      return false;
    }
  }
}

export class Fortschritt {
  /**
   * @param {typeof import('../config.js').CONFIG.fortschritt} cfg
   * @param {{laden: Function, sichern: Function}} [speicher]
   */
  /**
   * @param {typeof import('../config.js').CONFIG.fortschritt} cfg
   * @param {{laden: Function, sichern: Function}} [speicher] sofort verfügbar
   * @param {{laden: Function, sichern: Function}} [fern] asynchron (Server)
   */
  constructor(cfg, speicher = null, fern = null) {
    this.cfg = cfg;
    this.speicher = speicher ?? new LokalerSpeicher(cfg.storageKey);
    this.fern = fern;

    const geladen = this.speicher.laden();
    this.muenzen = geladen?.muenzen ?? cfg.startMuenzen;
    /** @type {Set<string>} */
    this.frei = new Set(geladen?.frei ?? []);

    // Was nichts kostet, ist immer frei — auch wenn es nie gespeichert wurde.
    for (const id of cfg.immerFrei) this.frei.add(id);

    /** (muenzen) => void — für die Anzeige. */
    this.onAendern = null;

    // Der Server kommt später dazu. Das Spiel läuft in der Zwischenzeit.
    if (this.fern) this._vomServerHolen();
  }

  /**
   * Hängt den zweiten Speicher nachträglich ein.
   *
   * Nötig, weil erst nach `portal.init()` feststeht, WO gespielt wird — und
   * damit, ob der Konto-Speicher von CrazyGames zur Verfügung steht oder ob
   * es Supabase sein muss. Das Menü steht zu diesem Zeitpunkt längst; der
   * Stand wird dann eben nachgezogen.
   *
   * @param {{laden: Function, sichern: Function}} fern
   */
  fernSetzen(fern) {
    if (!fern) return;
    this.fern = fern;
    return this._vomServerHolen();
  }

  /**
   * Holt den Serverstand nach und führt ihn mit dem lokalen zusammen.
   *
   * WARUM ZUSAMMENFÜHREN UND NICHT ÜBERSCHREIBEN
   * Beide Seiten können neuer sein: wer ohne Netz gespielt hat, hat lokal
   * mehr; wer auf einem anderen Gerät gespielt hat, hat auf dem Server mehr.
   * Ohne Zusammenführung verlöre bei jedem Start eine der beiden Seiten ihren
   * Zugewinn — und zwar stillschweigend.
   *
   * Die Regel ist bewusst grosszügig: mehr Münzen gewinnt, freigeschaltet
   * bleibt freigeschaltet. Wer sich in der Konsole Münzen erschwindelt,
   * schiebt sie damit auch auf den Server. Das ist hingenommen — Münzen
   * kaufen ausschliesslich Aussehen, nie Höhe, und die Bestenliste hat mit
   * ihnen nichts zu tun.
   */
  async _vomServerHolen() {
    const dort = await this.fern.laden();
    if (!dort) return; // kein Netz oder noch nie gespeichert

    const vorherMuenzen = this.muenzen;
    const vorherAnzahl = this.frei.size;

    this.muenzen = Math.max(this.muenzen, dort.muenzen);
    for (const id of dort.frei) this.frei.add(id);

    // Nur zurückschreiben, wenn die lokale Seite etwas beisteuert — sonst
    // erzeugt jeder Spielstart eine überflüssige Schreiboperation.
    const lokalWarVoraus = vorherMuenzen > dort.muenzen || this.frei.size > dort.frei.length;
    if (lokalWarVoraus) this._sichern();
    else if (this.muenzen !== vorherMuenzen || this.frei.size !== vorherAnzahl) {
      this.speicher.sichern({ muenzen: this.muenzen, frei: [...this.frei] });
      this.onAendern?.(this.muenzen);
    }
  }

  /* --------------------------------------------------------------- Münzen */

  /** @param {number} n */
  gutschreiben(n) {
    if (!(n > 0)) return;
    this.muenzen += Math.floor(n);
    this._sichern();
  }

  /* ---------------------------------------------------------- Freischalten */

  istFrei(id) {
    return this.frei.has(id);
  }

  /** Reicht der Bestand? (Sagt nichts darüber, ob es schon frei IST.) */
  kannKaufen(id, preis) {
    return !this.istFrei(id) && this.muenzen >= preis;
  }

  /**
   * Kauft frei. Bewusst hier und nicht in der UI: sonst gäbe es zwei Stellen,
   * an denen Münzen abgezogen werden, und eine davon wäre irgendwann falsch.
   *
   * @returns {boolean} false, wenn es nicht reicht oder schon frei ist
   */
  kaufen(id, preis) {
    if (this.istFrei(id)) return false;
    if (this.muenzen < preis) return false;
    this.muenzen -= preis;
    this.frei.add(id);
    this._sichern();
    return true;
  }

  /**
   * Sichert auf dem Server und WARTET darauf.
   *
   * `_sichern()` weiter unten feuert absichtlich und vergisst — ein langsamer
   * Server darf das Menü nicht anhalten. Für den Übertragungscode ist genau
   * das aber falsch: der Server vergibt einen Code nur noch an eine Kennung,
   * die er bereits kennt. Sonst könnte jemand mit frei erfundenen Kennungen
   * den ganzen Vorrat von 10 000 Codes belegen (gemessen: 500 Stück in
   * 46 Millisekunden) und damit jedem Spieler den Gerätewechsel verbauen.
   * Also muss die Zeile VORHER wirklich angekommen sein, nicht irgendwann.
   *
   * @returns {Promise<boolean>} true = angekommen
   */
  async fernSichernJetzt() {
    if (!this.fern) return false;
    try {
      return !!(await this.fern.sichern({ muenzen: this.muenzen, frei: [...this.frei] }));
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------- Intern */

  _sichern() {
    const stand = { muenzen: this.muenzen, frei: [...this.frei] };
    // Nicht abwarten: ein langsamer Server darf das Menü nicht anhalten.
    Promise.resolve(this.speicher.sichern(stand)).catch(() => {
      /* verloren geht höchstens der letzte Zugewinn, nie das Spiel */
    });
    // Der Server bekommt dasselbe, ebenfalls nebenher. Er ist die Kopie, die
    // ein neues Gerät wiederfindet — nicht die Quelle der Wahrheit.
    if (this.fern) {
      Promise.resolve(this.fern.sichern(stand)).catch(() => {
        /* lokal steht es trotzdem */
      });
    }
    this.onAendern?.(this.muenzen);
  }

  /** Nur für Tests und den Entwicklungsmodus. */
  zuruecksetzen() {
    this.muenzen = this.cfg.startMuenzen;
    this.frei = new Set(this.cfg.immerFrei);
    this._sichern();
  }
}

/* ==========================================================================
 *  SPIELERKENNUNG
 *
 *  Eine zufällige UUID, mehr nicht: kein Name, keine E-Mail, kein Passwort,
 *  nichts, was auf eine Person zeigt. Sie ist zugleich der Code, mit dem man
 *  seinen Fortschritt auf ein anderes Gerät holt.
 *
 *  Bewusst KEIN Konto. Ein Konto hiesse Registrierung, Passwort-Vergessen,
 *  E-Mail-Versand und Datenschutzerklärung — für ein Spiel, in dem man einem
 *  Affen beim Klettern zusieht, ist das die falsche Reihenfolge.
 * ======================================================================== */

/** @param {string} schluessel localStorage-Schlüssel */
export function spielerKennung(schluessel) {
  try {
    const vorhanden = localStorage.getItem(schluessel);
    if (vorhanden) return vorhanden;
  } catch {
    /* kein Speicher — dann eben eine flüchtige Kennung */
  }

  const neu = globalThis.crypto?.randomUUID?.() ?? _uuidNotnagel();

  try {
    localStorage.setItem(schluessel, neu);
  } catch {
    /* egal */
  }
  return neu;
}

/** Prüft die UUID-Form. Der Server nimmt ausschliesslich diese an. */
const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Ersatz für `crypto.randomUUID`, wo es das nicht gibt.
 *
 * ES MUSS EIN ECHTES UUID SEIN. Der erste Versuch hier war eine hübsche
 * Zeichenkette aus Zeitstempel und Zufall — und die hat der Server
 * zurückgewiesen, weil die Spalte `uuid` verlangt. Der Fehler wurde
 * verschluckt, also war der Serverspeicher dort einfach lautlos wirkungslos.
 * Betroffen: ältere Browser UND jede Seite über `http://` statt `https://`,
 * denn `crypto.randomUUID` gibt es nur in sicherem Kontext.
 *
 * `crypto.getRandomValues` gibt es auch unsicher; fehlt selbst das, tut es
 * Math.random — die Kennung muss eindeutig sein, nicht unvorhersagbar.
 */
function _uuidNotnagel() {
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);

  b[6] = (b[6] & 0x0f) | 0x40; // Version 4
  b[8] = (b[8] & 0x3f) | 0x80; // Variante

  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

/**
 * Übernimmt einen eingegebenen Wiederherstellungscode.
 * @returns {boolean} false, wenn er kein gültiger Code ist
 */
/* ==========================================================================
 *  ÜBERTRAGUNGSCODE — vier Ziffern
 *
 *  Die Kennung oben bleibt intern der Schlüssel. Sie ist aber 36 Zeichen
 *  lang, und niemand tippt das auf einem Handy ab. Deshalb sucht sich der
 *  Spieler VIER ZIFFERN aus, die noch frei sind; der Server merkt sich, zu
 *  welcher Kennung sie gehören.
 *
 *  Das ist eine bewusste Abwägung, keine Nachlässigkeit: vier Ziffern sind
 *  zehntausend Möglichkeiten, der Code ist also kein Geheimnis. Was das
 *  bedeutet und warum es hier vertretbar ist, steht ausführlich in
 *  scripts/bestenliste.sql im Abschnitt ÜBERTRAGUNGSCODE.
 * ======================================================================== */

/** Genau vier Ziffern. Führende Null erlaubt — '0042' ist ein gültiger Code. */
export const CODE_FORM = /^[0-9]{4}$/;

/** Vereinheitlicht Servermeldungen zu etwas, das im Spiel lesbar ist. */
function codeFehler(err) {
  // 404: die Funktionen sind noch nicht in der Datenbank. Das ist KEIN
  // Spielerfehler, und ohne diesen Hinweis sucht man den Fehler im Spiel.
  if (err?.status === 404) {
    return 'Der Server kennt die Übertragung noch nicht (SQL noch nicht eingespielt).';
  }
  if (err?.name === 'AbortError') return 'Der Server antwortet nicht.';
  return err?.message || 'Das hat nicht geklappt.';
}

/**
 * Belegt einen selbst gewählten Code für diese Kennung.
 * @returns {Promise<{ok: true, code: string} | {ok: false, meldung: string}>}
 */
export async function codeBelegen(cfg, spielerId, code) {
  const sauber = String(code ?? '').trim();
  if (!CODE_FORM.test(sauber)) {
    return { ok: false, meldung: 'Please enter exactly four digits.' };
  }
  try {
    const zurueck = await rpc(cfg, cfg.codeBelegenFn, {
      p_spieler: spielerId,
      p_code: sauber,
    });
    return { ok: true, code: String(zurueck ?? sauber) };
  } catch (err) {
    return { ok: false, meldung: codeFehler(err) };
  }
}

/**
 * Holt einen freien Code und belegt ihn sofort.
 *
 * Bewusst in einem Schritt: ein blosser Vorschlag wäre nicht verbindlich,
 * zwischen Vorschlag und Bestätigung könnte ihn jemand anders nehmen. Wer
 * schon einen Code hat, bekommt denselben zurück.
 *
 * @returns {Promise<{ok: true, code: string} | {ok: false, meldung: string}>}
 */
export async function codeVorschlag(cfg, spielerId) {
  try {
    const zurueck = await rpc(cfg, cfg.codeVorschlagFn, { p_spieler: spielerId });
    const code = String(zurueck ?? '');
    if (!CODE_FORM.test(code)) {
      return { ok: false, meldung: 'Der Server hat keinen Code herausgegeben.' };
    }
    return { ok: true, code };
  } catch (err) {
    return { ok: false, meldung: codeFehler(err) };
  }
}

/**
 * Löst einen Code in die dahinterliegende Kennung auf.
 * @returns {Promise<{ok: true, kennung: string} | {ok: false, meldung: string}>}
 */
/**
 * Löst einen Code in die dahinterliegende Kennung auf.
 *
 * Der Server meldet den erwarteten Fehlschlag über den RÜCKGABEWERT, nicht
 * über eine Ausnahme — sonst würde sein eigener Fehlversuchszähler mit
 * zurückgedreht und die Bremse wäre wirkungslos. Deshalb kommt hier ein
 * Objekt an und keine nackte Kennung. Ausführlich steht das in
 * scripts/bestenliste.sql bei code_aufloesen.
 *
 * @returns {Promise<{ok: true, kennung: string} | {ok: false, meldung: string}>}
 */
export async function codeAufloesen(cfg, code) {
  const sauber = String(code ?? '').trim();
  if (!CODE_FORM.test(sauber)) {
    return { ok: false, meldung: 'Please enter exactly four digits.' };
  }
  try {
    const d = await rpc(cfg, cfg.codeAufloesenFn, { p_code: sauber });

    if (d?.ok === true && typeof d.kennung === 'string' && UUID_FORM.test(d.kennung)) {
      return { ok: true, kennung: d.kennung };
    }

    const meldungen = {
      form: 'Please enter exactly four digits.',
      gebremst: 'Too many attempts. Please wait a minute.',
      unbekannt: 'Nothing is stored for that code.',
    };
    return { ok: false, meldung: meldungen[d?.grund] ?? 'Nothing is stored for that code.' };
  } catch (err) {
    return { ok: false, meldung: codeFehler(err) };
  }
}

export function kennungSetzen(schluessel, code) {
  const sauber = String(code ?? '').trim().toLowerCase();
  /* Gegen die UUID-Form prüfen, nicht nur gegen die Länge.
   *
   * Vorher galt "8 bis 64 Zeichen ohne Leerzeichen" — ein vertippter Code kam
   * damit durch, der Server wies ihn wegen des Typs ab, und der Fehler wurde
   * verschluckt. Der Spieler sah nichts und stand plötzlich ohne seine
   * Münzen da. Lieber hier sagen, dass der Code nicht stimmt. */
  if (!UUID_FORM.test(sauber)) return false;
  try {
    localStorage.setItem(schluessel, sauber);
    return true;
  } catch {
    return false;
  }
}
