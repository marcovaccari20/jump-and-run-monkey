/**
 * Die weltweite Bestenliste.
 *
 *     await liste.holen(anzahl)
 *       -> [{ name, score, rang, ad }]          | wirft bei Netzfehler
 *     await liste.laufStarten()
 *       -> Marke (string) | null                | wirft nie
 *     await liste.tick(marke)
 *       -> void                                 | wirft nie
 *     await liste.eintragen(marke, name, score, mitWerbung)
 *       -> { ok: true, rang? } | { ok: false, grund }
 *
 * `liste.weltweit` sagt, ob überhaupt eine da ist.
 *
 * Die SPIELZEIT taucht in keiner dieser Signaturen auf. Das ist Absicht: sie
 * kommt nicht aus dem Browser, sondern entsteht auf dem Server aus dem
 * Startstempel und den Lebenszeichen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DIE LOKALE LISTE STEHT NICHT MEHR HIER
 *
 * Früher gab es an dieser Stelle eine `LokaleListe` mit derselben
 * Schnittstelle, damit man beide gegeneinander austauschen kann. Das war ein
 * Trugschluss: die beiden sind keine Alternativen, sondern zwei SCHICHTEN.
 * `Game._submitName` trägt IMMER lokal ein (über den ScoreManager) und
 * zusätzlich weltweit, wenn eine Adresse konfiguriert ist. Die `LokaleListe`
 * wurde deshalb nie aufgerufen — und weil sie nie lief, war auch nie
 * aufgefallen, dass sie in acht Punkten anders funktionierte als die
 * Supabase-Fassung (Rückgabe von `rang`, Zahl der Parameter, `mitWerbung`,
 * Verhalten im Fehlerfall, Bedeutung von `ok: false` …). Beim Umschalten wäre
 * das alles auf einmal aufgeschlagen.
 *
 * Statt einer Schein-Alternative steht hier jetzt `KeineWeltliste`: ein
 * ehrliches "gibt es nicht".
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WARUM DIE PRÜFUNG AUF DEM SERVER SITZT UND NICHT HIER
 *
 * Der naheliegende Einwand lautet: "Man kann doch nur den Namen eingeben,
 * die Meter kommen aus dem Lauf — das lässt sich gar nicht fälschen."
 *
 * Das stimmt für dieses Spiel. Nur benutzt es niemand, der betrügen will.
 * Die Bestenliste ist eine Internetadresse, und der Zugangsschlüssel MUSS im
 * ausgelieferten JavaScript stehen, sonst könnte das Spiel nichts eintragen.
 * Damit kann jeder direkt schicken:
 *
 *     curl -X POST .../rpc/eintragen -H "apikey: …" -d '{"p_score":999999}'
 *
 * Kein clientseitiger Trick ändert daran etwas — Signaturen, Verschlüsselung,
 * verschleierter Code: der Schlüssel dazu liegt immer mit im Browser. Deshalb
 * steht die einzige wirksame Prüfung in der Datenbank (siehe
 * scripts/bestenliste.sql): die tatsächlich mögliche Kletterkurve, das
 * Verhältnis Punkte zu Spielzeit, Sperrfristen.
 *
 * Das hält keinen entschlossenen Angreifer auf. Es begrenzt den Schaden auf
 * eine Zahl, die auch ein sehr guter Mensch erreichen könnte — und mehr ist
 * bei einem Browserspiel ohne Anmeldung ehrlicherweise nicht zu holen.
 */

/**
 * Kein Server konfiguriert. Das Spiel läuft vollständig weiter, es gibt eben
 * nur die Liste dieses Geräts (die der ScoreManager führt).
 */
export class KeineWeltliste {
  constructor() {
    this.weltweit = false;
  }

  async holen() {
    return [];
  }

  async laufStarten() {
    return null;
  }

  async tick() {}

  async eintragen() {
    return { ok: false, grund: 'keine Weltliste eingerichtet' };
  }
}

/**
 * Gemeinsame Liste über eine Supabase-Datenbank.
 *
 * Bewusst OHNE die Supabase-Bibliothek, aus zwei Gründen:
 *  - Sie wiegt rund 40 KB, und das Spiel schleppt schon Three.js mit.
 *  - Ihr Anmeldeteil legt die Sitzung im Browserspeicher ab. Im Fremd-Rahmen
 *    eines Portals ist der abgetrennt oder gesperrt, und die Bibliothek
 *    stürzt dort ab. Zwei `fetch`-Aufrufe haben das Problem nicht: die
 *    REST-Schnittstelle authentifiziert über Kopfzeilen, nicht über Cookies.
 */
export class SupabaseListe {
  /**
   * @param {{url: string, schluessel: string, tabelle: string,
   *          eintragenFn: string, timeout: number}} cfg
   */
  constructor(cfg) {
    this.cfg = cfg;
    this.weltweit = true;
  }

  get _kopf() {
    return {
      apikey: this.cfg.schluessel,
      Authorization: `Bearer ${this.cfg.schluessel}`,
      'Content-Type': 'application/json',
    };
  }

  /** Bricht ab, statt das Menü hängen zu lassen. */
  async _ruf(pfad, optionen) {
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), this.cfg.timeout);
    try {
      const antwort = await fetch(`${this.cfg.url}${pfad}`, {
        ...optionen,
        headers: this._kopf,
        signal: abbruch.signal,
      });
      const text = await antwort.text();

      if (!antwort.ok) {
        /* Den Klartext der Datenbank durchreichen. Die Prüffunktion wirft
         * verständliche Meldungen ("Punktestand passt nicht zur Spielzeit"),
         * und die gehören dem Spieler gezeigt — "HTTP 400" schickt ihn auf
         * die Suche nach einem Netzproblem, das es nicht gibt. */
        let grund = `HTTP ${antwort.status}`;
        try {
          const koerper = JSON.parse(text);
          grund = koerper?.message || koerper?.hint || koerper?.details || grund;
        } catch {
          /* kein JSON — dann bleibt es beim Statuscode */
        }
        throw new Error(grund);
      }
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(uhr);
    }
  }

  async holen(anzahl = 10) {
    /* Zweites Sortierkriterium: bei Punktegleichstand ist die Reihenfolge
     * sonst zwischen zwei Abrufen nicht stabil, und zwei Spieler tauschen
     * scheinbar grundlos die Plätze. */
    const zeilen = await this._ruf(
      `/rest/v1/${this.cfg.tabelle}` +
        `?select=name,score,ad&order=score.desc,created_at.asc&limit=${anzahl}`,
      { method: 'GET' },
    );
    return (zeilen ?? []).map((z, i) => ({
      name: z.name,
      score: z.score,
      rang: i + 1,
      ad: z.ad === true,
    }));
  }

  /**
   * Meldet den Rundenbeginn an. Der Server stempelt den Zeitpunkt mit SEINER
   * Uhr und gibt eine Marke zurück; beim Eintragen rechnet er die Spielzeit
   * daraus selbst aus.
   *
   * Warum nicht einfach die Spielzeit mitschicken: dann bestimmte der
   * Angreifer beide Zahlen — höchste erlaubte Zeit plus den dazu passenden
   * Punktestand — und jede Verhältnisprüfung wäre wertlos.
   *
   * @returns {Promise<string|null>} Marke, oder null wenn es nicht klappte
   */
  async laufStarten() {
    try {
      // Leerer Rumpf, aber `{}` und nicht gar nichts: bei `Content-Type:
      // application/json` verlangen ältere PostgREST-Fassungen gültiges JSON.
      // Ohne das schlüge JEDER Rundenstart fehl — und zwar lautlos, weil der
      // Fehler hier geschluckt wird.
      return await this._ruf(`/rest/v1/rpc/${this.cfg.laufStartFn}`, {
        method: 'POST',
        body: '{}',
      });
    } catch {
      // Kein Netz beim Start. Der Lauf zählt dann nur lokal — das ist besser,
      // als ihn gar nicht erst beginnen zu lassen.
      return null;
    }
  }

  /**
   * Lebenszeichen während des Laufs. Ohne sie zählt vergangene Zeit nicht:
   * sonst genügte ein `sleep` zwischen zwei Aufrufen, um eine Stunde Spiel
   * zu behaupten.
   *
   * Fehler bleiben still — ein verlorenes Lebenszeichen darf den Lauf nicht
   * stören, und die Toleranz auf dem Server fängt einzelne Ausfälle ab.
   *
   * @param {string} lauf
   */
  async tick(lauf) {
    if (!lauf) return;
    try {
      await this._ruf(`/rest/v1/rpc/${this.cfg.tickFn}`, {
        method: 'POST',
        body: JSON.stringify({ p_lauf: lauf }),
      });
    } catch {
      /* egal */
    }
  }

  /**
   * @param {string} lauf Marke aus `laufStarten()`
   * @param {string} name
   * @param {number} score
   * @param {boolean} [mitWerbung] Lauf wurde per Werbung verlängert
   */
  async eintragen(lauf, name, score, mitWerbung = false) {
    if (!lauf) {
      return { ok: false, grund: 'Lauf war nicht angemeldet — nur lokal gewertet' };
    }
    try {
      const rang = await this._ruf(`/rest/v1/rpc/${this.cfg.eintragenFn}`, {
        method: 'POST',
        body: JSON.stringify({
          p_lauf: lauf,
          p_name: name,
          p_score: Math.floor(score),
          // Ohne das stünde ein Lauf mit zweitem Leben ununterscheidbar
          // neben einem ohne — die lokale Liste kennzeichnet es seit jeher.
          p_ad: mitWerbung === true,
        }),
      });
      return typeof rang === 'number' ? { ok: true, rang } : { ok: true };
    } catch (err) {
      // Abgelehnt (unplausibel, Sperrfrist) oder Netz weg. Beides darf den
      // Spielfluss nicht anhalten — der Grund geht an die Anzeige.
      return { ok: false, grund: err.message };
    }
  }
}

/**
 * @param {typeof import('../config.js').CONFIG.bestenliste} cfg
 */
export function erzeugeBestenliste(cfg) {
  if (!cfg?.url || !cfg?.schluessel) return new KeineWeltliste();
  return new SupabaseListe(cfg);
}
