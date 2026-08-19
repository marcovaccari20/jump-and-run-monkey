/**
 * Konto: Anmeldung mit E-Mail-Adresse und Passwort (Supabase Auth).
 *
 * WARUM ÜBERHAUPT EIN KONTO
 * Ohne Konto hängt der Fortschritt an einer zufälligen Kennung im
 * localStorage dieses einen Geräts (siehe Fortschritt.js). Das reicht im
 * Browser, aber nicht im Play Store: wer das Handy wechselt oder die App neu
 * installiert, stünde sonst wieder bei null. Mit Konto folgen Münzen und
 * Affen dem Spieler.
 *
 * WARUM KEIN supabase-js
 * Die Bibliothek wiegt gepackt rund 50 kB — mehr als der halbe Spielcode.
 * Gebraucht werden davon fünf Endpunkte, die alle schlichte POSTs sind.
 * Bestenliste.js und Fortschritt.js sprechen aus demselben Grund direkt per
 * `fetch` mit dem Server; diese Datei hält sich daran.
 *
 * WAS GESPEICHERT WIRD
 * Supabase legt E-Mail-Adresse und einen Hash des Passworts ab (bcrypt, das
 * Passwort selbst sieht auch der Server nie). Hier im Browser liegen nur die
 * beiden Sitzungsmerkmale (`access_token`, `refresh_token`) — kein Passwort.
 */

/** localStorage-Schlüssel der Sitzung. */
const SITZUNG = 'jc_sitzung';

/**
 * Sicherheitsabstand vor dem Ablauf des Zugangsmerkmals.
 *
 * Supabase gibt ein `access_token` mit einer Stunde Laufzeit aus. Würde erst
 * bei Ablauf erneuert, träfe ein Aufruf, der genau in die Lücke fällt, auf
 * ein bereits totes Merkmal — und der Spieler verlöre mitten im Spiel die
 * Anmeldung. 60 Sekunden Vorlauf decken jede realistische Verzögerung ab.
 */
const VORLAUF_MS = 60_000;

/**
 * Übersetzt Supabase-Meldungen in Sätze, die ein Spieler versteht.
 *
 * Die englischen Originale sind für Entwickler geschrieben ("Invalid login
 * credentials"). Wer sich vertippt hat, soll lesen, WAS zu tun ist.
 * Unbekannte Meldungen kommen unverändert durch — lieber eine sperrige
 * echte Meldung als ein nichtssagendes "Something went wrong".
 */
function klartext(meldung) {
  const m = String(meldung || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'Wrong e-mail or password.';
  if (m.includes('email not confirmed')) return 'Please confirm your e-mail address first.';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'This e-mail already has an account. Try signing in.';
  if (m.includes('password should be at least'))
    return 'Password too short - use at least 6 characters.';
  if (m.includes('unable to validate email') || m.includes('invalid format'))
    return 'That does not look like an e-mail address.';
  /* Zwei verschiedene Grenzen, die sich leicht verwechseln lassen — und der
   * Spieler kann nur bei einer davon etwas tun:
   *   - E-Mail-Grenze: der Postausgang des Servers ist erschöpft. Das liegt
   *     NICHT an diesem Spieler; "zu viele Versuche" wäre ein Vorwurf an den
   *     Falschen. Gemessen am eigenen Projekt: der eingebaute Versand von
   *     Supabase blockt schon beim ersten Anlauf einer Stunde.
   *   - Anfragegrenze: derselbe Browser hat zu schnell hintereinander
   *     gedrückt. Da hilft Warten wirklich. */
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit'))
    return 'We cannot send e-mail right now. Please try again later.';
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Too many attempts. Please wait a minute.';
  if (m.includes('same password')) return 'That is your current password - pick a new one.';
  return meldung || 'Something went wrong. Please try again.';
}

export class Konto {
  /**
   * @param {typeof import('../config.js').CONFIG.bestenliste} cfg Adresse + öffentlicher Schlüssel
   */
  constructor(cfg) {
    this.cfg = cfg;
    /** @type {{zugang:string, erneuern:string, ablauf:number, email:string, id:string}|null} */
    this.sitzung = this._sitzungLesen();
    /** (konto|null) => void — Menü und Fortschritt hängen sich hier ein. */
    this.onAendern = null;
    /** Läuft gerade eine Erneuerung? Verhindert doppelte Anfragen. */
    this._erneuerung = null;
  }

  get angemeldet() {
    return !!this.sitzung;
  }

  get email() {
    return this.sitzung?.email ?? null;
  }

  get id() {
    return this.sitzung?.id ?? null;
  }

  // ------------------------------------------------------------- Sitzung

  _sitzungLesen() {
    try {
      const roh = localStorage.getItem(SITZUNG);
      if (!roh) return null;
      const s = JSON.parse(roh);
      // Ein Datensatz ohne Erneuerungsmerkmal ist wertlos: die Sitzung liesse
      // sich nie verlängern und stürbe spätestens nach einer Stunde.
      return s?.erneuern && s?.zugang ? s : null;
    } catch {
      return null;
    }
  }

  _sitzungSchreiben(s) {
    this.sitzung = s;
    try {
      if (s) localStorage.setItem(SITZUNG, JSON.stringify(s));
      else localStorage.removeItem(SITZUNG);
    } catch {
      /* Privater Modus: dann gilt die Anmeldung eben nur bis zum Schliessen. */
    }
    this.onAendern?.(s ? { email: s.email, id: s.id } : null);
  }

  /** Formt die Supabase-Antwort in unseren Datensatz um. */
  _uebernehmen(d) {
    if (!d?.access_token) return null;
    const s = {
      zugang: d.access_token,
      erneuern: d.refresh_token,
      // `expires_in` ist relativ (Sekunden ab jetzt) — absolut gerechnet
      // übersteht der Wert auch das Schliessen und Wiederöffnen des Spiels.
      ablauf: Date.now() + (d.expires_in ?? 3600) * 1000,
      email: d.user?.email ?? this.sitzung?.email ?? '',
      id: d.user?.id ?? this.sitzung?.id ?? '',
    };
    this._sitzungSchreiben(s);
    return s;
  }

  // -------------------------------------------------------------- Aufrufe

  async _ruf(pfad, koerper, zugang = null) {
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), this.cfg.timeout ?? 8000);
    try {
      const antwort = await fetch(`${this.cfg.url}/auth/v1/${pfad}`, {
        method: 'POST',
        headers: {
          apikey: this.cfg.schluessel,
          // Ohne Anmeldung ist der öffentliche Schlüssel das Merkmal;
          // mit Anmeldung das persönliche Zugangsmerkmal.
          Authorization: `Bearer ${zugang ?? this.cfg.schluessel}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(koerper),
        signal: abbruch.signal,
      });
      const text = await antwort.text();
      const daten = text ? JSON.parse(text) : null;

      if (!antwort.ok) {
        // Supabase Auth meldet mal `error_description`, mal `msg`, mal
        // `message` — je nach Endpunkt und Fassung. Alle drei abklappern.
        const fehler = new Error(klartext(daten?.error_description || daten?.msg || daten?.message));
        fehler.status = antwort.status;
        throw fehler;
      }
      return daten;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('No connection. Please try again.');
      throw e;
    } finally {
      clearTimeout(uhr);
    }
  }

  /**
   * Liefert ein gültiges Zugangsmerkmal — erneuert es, wenn nötig.
   *
   * Mehrere gleichzeitige Aufrufe teilen sich EINE Erneuerung. Sonst würden
   * beim Start Laden und Sichern zwei Erneuerungen anstossen; Supabase
   * entwertet das alte Erneuerungsmerkmal beim ersten Gebrauch, die zweite
   * Anfrage liefe ins Leere und würfe den Spieler hinaus.
   *
   * @returns {Promise<string|null>} null = nicht (mehr) angemeldet
   */
  async zugang() {
    if (!this.sitzung) return null;
    if (Date.now() < this.sitzung.ablauf - VORLAUF_MS) return this.sitzung.zugang;

    if (!this._erneuerung) {
      this._erneuerung = this._ruf('token?grant_type=refresh_token', {
        refresh_token: this.sitzung.erneuern,
      })
        .then((d) => this._uebernehmen(d)?.zugang ?? null)
        .catch(() => {
          /* Merkmal abgelaufen oder zurückgezogen: sauber abmelden statt mit
           * einer toten Sitzung weiterzumachen. Der lokale Stand bleibt. */
          this._sitzungSchreiben(null);
          return null;
        })
        .finally(() => {
          this._erneuerung = null;
        });
    }
    return this._erneuerung;
  }

  // ------------------------------------------------------------- Handlungen

  /**
   * Legt ein Konto an. Liefert `{sofortAngemeldet}`.
   *
   * Ist in Supabase "Confirm email" eingeschaltet, kommt eine Antwort OHNE
   * Sitzung zurück — der Spieler muss erst den Link in der E-Mail anklicken.
   * Beide Fälle müssen behandelt werden, sonst zeigt das Menü nach dem
   * Registrieren fälschlich "angemeldet" an.
   */
  async registrieren(email, passwort) {
    const d = await this._ruf('signup', { email: email.trim(), password: passwort });
    const s = this._uebernehmen(d);
    return { sofortAngemeldet: !!s };
  }

  async anmelden(email, passwort) {
    const d = await this._ruf('token?grant_type=password', {
      email: email.trim(),
      password: passwort,
    });
    if (!this._uebernehmen(d)) throw new Error('Sign-in failed. Please try again.');
    return true;
  }

  /**
   * Meldet ab. Der lokale Fortschritt bleibt liegen — abmelden ist kein
   * Löschen. Beim nächsten Anmelden führt `konto_verknuepfen` beide Stände
   * wieder zusammen.
   */
  async abmelden() {
    const zugang = this.sitzung?.zugang;
    this._sitzungSchreiben(null);
    // Erst örtlich abmelden, dann dem Server Bescheid geben: scheitert das
    // (kein Netz), ist der Spieler hier trotzdem abgemeldet.
    if (zugang) await this._ruf('logout', {}, zugang).catch(() => {});
  }

  /**
   * Schickt eine E-Mail zum Zurücksetzen des Passworts.
   *
   * `redirect_to` bestimmt, wo der Link landet. Muss in Supabase unter
   * "URL Configuration -> Redirect URLs" eingetragen sein, sonst fällt der
   * Link stillschweigend auf die Site-URL zurück.
   */
  async passwortVergessen(email) {
    await this._ruf('recover', {
      email: email.trim(),
      ...(this.cfg.passwortZielUrl ? { redirect_to: this.cfg.passwortZielUrl } : {}),
    });
    return true;
  }

  /** Setzt das Passwort. Nur mit gültiger Sitzung (auch der aus dem Mail-Link). */
  async passwortSetzen(neu) {
    const zugang = await this.zugang();
    if (!zugang) throw new Error('Your reset link has expired. Please request a new one.');
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), this.cfg.timeout ?? 8000);
    try {
      const antwort = await fetch(`${this.cfg.url}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: this.cfg.schluessel,
          Authorization: `Bearer ${zugang}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: neu }),
        signal: abbruch.signal,
      });
      const text = await antwort.text();
      const d = text ? JSON.parse(text) : null;
      if (!antwort.ok) throw new Error(klartext(d?.msg || d?.message));
      return true;
    } finally {
      clearTimeout(uhr);
    }
  }

  /**
   * Fängt den Rücksetz-Link ab, mit dem das Spiel geöffnet wurde.
   *
   * Supabase hängt die Merkmale als URL-FRAGMENT an (`#access_token=…`), nicht
   * als Abfrage. Das ist Absicht: ein Fragment wird nie an den Server
   * geschickt, das Merkmal steht also in keinem Server-Protokoll. Wir müssen
   * es hier selbst auslesen.
   *
   * Das Fragment wird danach sofort aus der Adresszeile entfernt — sonst
   * bliebe ein gültiges Zugangsmerkmal im Verlauf des Browsers stehen.
   *
   * @returns {boolean} true = das Spiel wurde über einen Rücksetz-Link geöffnet
   */
  ruecksetzungAusUrl() {
    const roh = location.hash?.slice(1);
    if (!roh) return false;
    const p = new URLSearchParams(roh);
    if (p.get('type') !== 'recovery' || !p.get('access_token')) return false;

    this._uebernehmen({
      access_token: p.get('access_token'),
      refresh_token: p.get('refresh_token'),
      expires_in: Number(p.get('expires_in')) || 3600,
    });
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }
}

/**
 * Fortschrittsspeicher für angemeldete Spieler.
 *
 * Gleiche Form wie `SupabaseSpeicher` (laden/sichern), damit
 * `Fortschritt.fernSetzen()` ihn ohne Weiteres übernehmen kann. Der
 * Unterschied steckt allein im Merkmal: hier das persönliche Zugangsmerkmal,
 * und die Datenbankfunktionen leiten die Kennung daraus selbst ab
 * (`auth.uid()`). Der Client kann also nicht behaupten, jemand anderes zu
 * sein — anders als bei den anonymen Funktionen, die die Kennung als
 * Parameter entgegennehmen.
 */
export class KontoSpeicher {
  /**
   * @param {typeof import('../config.js').CONFIG.bestenliste} cfg
   * @param {Konto} konto
   */
  constructor(cfg, konto) {
    this.cfg = cfg;
    this.konto = konto;
  }

  async _ruf(fn, koerper = {}) {
    const zugang = await this.konto.zugang();
    if (!zugang) throw new Error('nicht angemeldet');
    const antwort = await fetch(`${this.cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: this.cfg.schluessel,
        Authorization: `Bearer ${zugang}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(koerper),
    });
    const text = await antwort.text();
    if (!antwort.ok) {
      let meldung = `HTTP ${antwort.status}`;
      try {
        meldung = JSON.parse(text)?.message ?? meldung;
      } catch {
        /* keine JSON-Antwort */
      }
      throw new Error(meldung);
    }
    return text ? JSON.parse(text) : null;
  }

  async laden() {
    try {
      const d = await this._ruf(this.cfg.standLadenKontoFn);
      if (!d) return null;
      return {
        muenzen: Math.max(0, Math.floor(Number(d.muenzen) || 0)),
        frei: Array.isArray(d.frei) ? d.frei.filter((x) => typeof x === 'string') : [],
      };
    } catch {
      return null;
    }
  }

  async sichern(stand) {
    try {
      await this._ruf(this.cfg.standSichernKontoFn, {
        p_muenzen: Math.max(0, Math.floor(stand.muenzen)),
        p_frei: stand.frei,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Übernimmt den bisherigen anonymen Stand dieses Geräts ins Konto.
   *
   * Einmal beim Anmelden. Die Datenbank führt zusammen statt zu ersetzen
   * (mehr Münzen gewinnt, freigeschaltet bleibt freigeschaltet) — anmelden
   * kann also nur gewinnen, nie verlieren.
   */
  async verknuepfen(anonymeId) {
    if (!anonymeId) return null;
    try {
      return await this._ruf(this.cfg.kontoVerknuepfenFn, { p_spieler: anonymeId });
    } catch {
      return null;
    }
  }
}
