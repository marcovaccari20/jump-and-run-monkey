/**
 * Sprachumschaltung.
 *
 * WARUM OHNE SCHLÜSSEL IM MARKUP
 * Der übliche Weg wäre `data-i18n="menu.play"` an jedem Element und ein
 * Wörterbuch mit erfundenen Schlüsseln. Für dieses Spiel wäre das der
 * schlechtere Handel: 77 Textstellen im HTML müssten von Hand ausgezeichnet
 * werden, und jede vergessene bliebe stumm englisch, ohne dass es auffällt.
 *
 * Hier ist deshalb der ENGLISCHE TEXT SELBST der Schlüssel. Das hat drei
 * Folgen, die alle in dieselbe Richtung zeigen:
 *   - Am HTML muss nichts geändert werden. Was dort steht, ist bereits die
 *     englische Fassung und bleibt die Rückfallebene.
 *   - Fehlt eine Übersetzung, erscheint Englisch. Nie ein leeres Feld, nie
 *     ein roher Schlüssel wie "menu.play" — der schlimmste Fall ist der
 *     Zustand von vorher.
 *   - Das Wörterbuch ist beim Lesen selbsterklärend: links steht, was der
 *     Spieler heute sieht.
 *
 * Der Preis: wird ein englischer Text im HTML geändert, verliert er seine
 * Übersetzung (still, aber sichtbar — es steht dann Englisch da).
 * `npm run pruef:sprache` findet genau diesen Fall.
 */

/* ------------------------------------------------------------ Wörterbuch */

/**
 * Deutsch. Links der englische Text WÖRTLICH so, wie er im Spiel steht.
 *
 * Leerraum spielt keine Rolle — beim Nachschlagen wird beidseitig auf
 * einfache Leerzeichen normalisiert. Mehrzeilige Absätze aus dem HTML werden
 * dadurch trotzdem gefunden.
 */
const DE = {
  // ---------------------------------------------------------------- Menü
  'Loading…': 'Lädt…',
  'Climb as high as you can. Dodge the falling rocks.':
    'Klettere so hoch du kannst. Weiche den fallenden Felsen aus.',
  Play: 'Spielen',
  Characters: 'Affen',
  'Best runs': 'Beste Läufe',
  'Sign in to save your progress': 'Anmelden und Fortschritt sichern',
  or: 'oder',
  'arrow keys': 'Pfeiltasten',
  '— move left and right': '— nach links und rechts',
  '— pause ·': '— Pause ·',
  '— hitboxes': '— Trefferflächen',
  'Tap anywhere and drag left or right':
    'Irgendwo antippen und nach links oder rechts ziehen',

  // --------------------------------------------------------- Datenschutz
  'Privacy & data': 'Datenschutz',
  'You can play Jungle Climber without an account and without giving away anything about yourself. An account is optional — it exists only so your progress survives a new phone.':
    'Du kannst Jungle Climber ohne Konto spielen und ohne irgendetwas über dich preiszugeben. Ein Konto ist freiwillig — es gibt es nur, damit dein Fortschritt ein neues Handy übersteht.',
  'What is stored': 'Was gespeichert wird',
  'Your coins and unlocked monkeys are kept under a random number that this game makes up on your device. That number is not tied to your name, your e-mail or your account anywhere else.':
    'Deine Münzen und freigeschalteten Affen liegen unter einer Zufallszahl, die sich das Spiel auf deinem Gerät ausdenkt. Diese Zahl hängt an keinem Namen, keiner E-Mail-Adresse und an keinem Konto anderswo.',
  'If you do create an account, we store your e-mail address and a scrambled form of your password — never the password itself, not even we can read it. The e-mail address is used for two things only: signing you in, and sending you a reset link if you forget your password. No newsletters, ever.':
    'Wenn du ein Konto anlegst, speichern wir deine E-Mail-Adresse und eine verwürfelte Form deines Passworts — nie das Passwort selbst, auch wir können es nicht lesen. Die Adresse dient genau zwei Dingen: dich anzumelden und dir einen Link zu schicken, falls du dein Passwort vergisst. Niemals Werbepost.',
  'If you enter a name for the worldwide leaderboard, that name and the height you reached are sent to our server and shown to other players. Pick any name you like — it does not have to be your real one.':
    'Wenn du einen Namen für die weltweite Bestenliste einträgst, gehen dieser Name und deine Höhe an unseren Server und werden anderen Spielern gezeigt. Nimm einen beliebigen Namen — er muss nicht dein echter sein.',
  'What is not': 'Was nicht',
  'No location, no contacts, no photos, no address book, no tracking across other websites. We do not sell anything to anyone. Without an account we hold no e-mail address at all.':
    'Kein Standort, keine Kontakte, keine Fotos, kein Adressbuch, keine Verfolgung über andere Webseiten. Wir verkaufen nichts an niemanden. Ohne Konto haben wir gar keine E-Mail-Adresse von dir.',
  Advertising: 'Werbung',
  'Ads come from the games portal you are playing on, not from us. What they collect is covered by their own privacy policy.':
    'Die Werbung kommt vom Spieleportal, auf dem du spielst, nicht von uns. Was dort erhoben wird, regelt deren eigene Datenschutzerklärung.',
  'Removing your data': 'Daten löschen lassen',
  'Clearing your browser data removes the number on your device. To have a leaderboard entry taken down, or to have your account and e-mail address deleted for good, write to':
    'Wenn du deine Browserdaten löschst, verschwindet die Zahl auf deinem Gerät. Für das Entfernen eines Bestenlisteneintrags oder die endgültige Löschung deines Kontos samt E-Mail-Adresse schreib an',
  '. For a leaderboard entry, tell us the name and the score; for an account, write from the address you signed up with.':
    '. Bei einem Bestenlisteneintrag nenn uns Name und Punktzahl; beim Konto schreib von der Adresse aus, mit der du dich angemeldet hast.',

  // --------------------------------------------------------------- Konto
  'Sign in': 'Anmelden',
  'Create account': 'Konto anlegen',
  'Reset password': 'Passwort zurücksetzen',
  'New password': 'Neues Passwort',
  'Your account': 'Dein Konto',
  'Your coins and monkeys follow you to any device.':
    'Deine Münzen und Affen folgen dir auf jedes Gerät.',
  'Pick any e-mail and password. Nothing else is asked of you.':
    'Wähle E-Mail-Adresse und Passwort. Mehr wird nicht verlangt.',
  'We send a link to your e-mail. Open it to pick a new password.':
    'Wir schicken dir einen Link. Öffne ihn, um ein neues Passwort zu wählen.',
  'Pick a new password. You stay signed in afterwards.':
    'Wähle ein neues Passwort. Du bleibst danach angemeldet.',
  'E-mail': 'E-Mail-Adresse',
  Password: 'Passwort',
  'At least 6 characters': 'Mindestens 6 Zeichen',
  'Your password': 'Dein Passwort',
  'No account yet? Create one': 'Noch kein Konto? Jetzt anlegen',
  'Already have an account? Sign in': 'Schon ein Konto? Anmelden',
  'Forgot your password?': 'Passwort vergessen?',
  'Back to sign in': 'Zurück zum Anmelden',
  Cancel: 'Abbrechen',
  'Send reset link': 'Link schicken',
  'Save password': 'Passwort speichern',
  'Signed in as': 'Angemeldet als',
  'Your progress is saved to this account. Sign in on another device with the same e-mail to pick it up there.':
    'Dein Fortschritt liegt in diesem Konto. Melde dich auf einem anderen Gerät mit derselben Adresse an, um ihn dort weiterzuführen.',
  'Sign out': 'Abmelden',

  // Meldungen des Kontobildschirms
  'One moment…': 'Einen Moment…',
  'Signed in.': 'Angemeldet.',
  'Account created. Your progress is saved.':
    'Konto angelegt. Dein Fortschritt ist gesichert.',
  'Almost there - open the link we just e-mailed you, then sign in.':
    'Fast geschafft — öffne den Link, den wir dir geschickt haben, und melde dich dann an.',
  'If that address has an account, a reset link is on its way.':
    'Falls es zu dieser Adresse ein Konto gibt, ist ein Link unterwegs.',
  'Password changed. You are signed in.': 'Passwort geändert. Du bist angemeldet.',
  'Signed out. Your progress stays on this device.':
    'Abgemeldet. Dein Fortschritt bleibt auf diesem Gerät.',
  'Wrong e-mail or password.': 'Falsche Adresse oder falsches Passwort.',
  'Please confirm your e-mail address first.':
    'Bitte bestätige zuerst deine E-Mail-Adresse.',
  'This e-mail already has an account. Try signing in.':
    'Zu dieser Adresse gibt es schon ein Konto. Versuch es mit Anmelden.',
  'Password too short - use at least 6 characters.':
    'Passwort zu kurz — mindestens 6 Zeichen.',
  'That does not look like an e-mail address.':
    'Das sieht nicht nach einer E-Mail-Adresse aus.',
  'That is your current password - pick a new one.':
    'Das ist dein jetziges Passwort — wähle ein neues.',
  'Too many attempts. Please wait a minute.':
    'Zu viele Versuche. Bitte eine Minute warten.',
  'We cannot send e-mail right now. Please try again later.':
    'Wir können gerade keine E-Mail verschicken. Bitte später nochmal.',
  'No connection. Please try again.': 'Keine Verbindung. Bitte nochmal versuchen.',
  'Sign-in failed. Please try again.': 'Anmelden gescheitert. Bitte nochmal versuchen.',
  'Your reset link has expired. Please request a new one.':
    'Dein Link ist abgelaufen. Bitte einen neuen anfordern.',
  'Something went wrong. Please try again.':
    'Da ist etwas schiefgegangen. Bitte nochmal versuchen.',

  // ----------------------------------------------------------- Affenlager
  'Jungle Camp': 'Dschungellager',
  'Pick a monkey, pick a colour, go.': 'Affe wählen, Farbe wählen, los.',
  Coins: 'Münzen',
  'Fur colour': 'Fellfarbe',
  'Go!': 'Los!',
  Back: 'Zurück',
  'Move your progress to another device': 'Fortschritt auf ein anderes Gerät holen',
  Pick: 'Wähle',
  'four digits': 'vier Ziffern',
  'that are still free. Use them to bring your coins and monkeys to any other device.':
    'die noch frei sind. Damit holst du Münzen und Affen auf jedes andere Gerät.',
  Save: 'Speichern',
  'Get a free one': 'Freien holen',
  'Your code:': 'Dein Code:',
  Copy: 'Kopieren',
  'Choose a four-digit code': 'Vierstelligen Code wählen',
  'Enter a four-digit code': 'Vierstelligen Code eingeben',
  'Enter a code from another device:': 'Code von einem anderen Gerät eingeben:',
  Load: 'Laden',
  'Code copied.': 'Code kopiert.',
  'Copying is blocked — select the code by hand.':
    'Kopieren ist gesperrt — markiere den Code von Hand.',
  'Please enter exactly four digits.': 'Bitte genau vier Ziffern eingeben.',
  'Nothing is stored for that code.': 'Zu diesem Code ist nichts gespeichert.',
  'Nothing to transfer without a server.': 'Ohne Server gibt es nichts zu übertragen.',
  'No profile yet — play one round first.':
    'Noch kein Profil — spiel zuerst eine Runde.',

  // ------------------------------------------------------------ Im Spiel
  'Extra life': 'Extraleben',
  Paused: 'Pause',
  Resume: 'Weiter',
  'Main menu': 'Hauptmenü',
  'Keep climbing?': 'Weiterklettern?',
  'One ad, and you carry on from the same spot — with a few seconds of grace.':
    'Eine Werbung, und du machst an derselben Stelle weiter — mit ein paar Sekunden Schonfrist.',
  'Watch ad': 'Werbung ansehen',
  'No thanks': 'Nein danke',
  Advertisement: 'Werbung',
  'Placeholder — the ad will play here.': 'Platzhalter — hier läuft die Werbung.',
  'No ad available': 'Keine Werbung verfügbar',
  'Game Over': 'Vorbei',
  'New best! Your name:': 'Neuer Rekord! Dein Name:',
  Submit: 'Eintragen',
  Again: 'Nochmal',
  Worldwide: 'Weltweit',
  'Loading worldwide list…': 'Weltweite Liste lädt…',
  'Worldwide list unreachable': 'Weltweite Liste nicht erreichbar',
  'No entries yet — be the first.': 'Noch keine Einträge — sei der Erste.',
  'New record!': 'Neuer Rekord!',
  'Golden zone!': 'Goldene Zone!',
  'Golden zone over': 'Goldene Zone vorbei',
  'Fire in the hole!': 'Es brennt!',
  'Off you go!': 'Und los!',
  'Run was continued after dying': 'Lauf wurde nach dem Sterben fortgesetzt',
  'Run was not signed in — counted locally only':
    'Lauf war nicht angemeldet — nur lokal gewertet',

  // ------------------------------------------------------- Einstellungen
  Settings: 'Einstellungen',
  Language: 'Sprache',
  Sound: 'Ton',
  Account: 'Konto',
  On: 'An',
  Off: 'Aus',
  'Sound on': 'Ton an',
  'Sound off': 'Ton aus',
  Mute: 'Ton aus',
  Unmute: 'Ton an',
  Pause: 'Pause',
};

/** Alle Sprachen. Eine weitere kostet genau einen Eintrag hier. */
export const SPRACHEN = [
  // `null` heisst: keine Übersetzung nötig, das Spiel IST auf Englisch
  // geschrieben. Kein leeres Wörterbuch pflegen müssen.
  { code: 'en', name: 'English', woerter: null },
  { code: 'de', name: 'Deutsch', woerter: DE },
];

/* ------------------------------------------------------------- Maschine */

const SPEICHER = 'jc_sprache';

/** Leerraum vereinheitlichen, damit mehrzeiliges HTML trotzdem trifft. */
const glatt = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Attribute, die sichtbaren oder vorgelesenen Text tragen.
 *
 * `title` fehlt bewusst: im Spiel steht dort nirgends etwas, und ein
 * Attribut mitzuübersetzen, das es nicht gibt, kostet bei jedem Durchlauf
 * Zeit über tausende Knoten.
 */
const ATTRIBUTE = ['placeholder', 'aria-label'];

export class Sprache {
  /**
   * @param {HTMLElement} wurzel Bereich, der übersetzt wird (das Overlay)
   */
  constructor(wurzel) {
    this.wurzel = wurzel;
    /** Merkt sich zu jedem Textknoten das englische Original. */
    this._urtext = new WeakMap();
    /** Dasselbe für Attribute: Element -> {attribut: Original}. */
    this._urattr = new WeakMap();
    /** (code) => void */
    this.onAendern = null;

    this.code = this._startsprache();
  }

  get woerter() {
    return SPRACHEN.find((s) => s.code === this.code)?.woerter ?? null;
  }

  /**
   * Welche Sprache beim allerersten Start?
   *
   * Reihenfolge: gemerkte Wahl, sonst die Sprache des Browsers, sonst
   * Englisch. Die Browsersprache MUSS abgeschnitten werden — sie kommt als
   * `de-CH` oder `de-DE`, unser Code ist `de`.
   */
  _startsprache() {
    try {
      const gemerkt = localStorage.getItem(SPEICHER);
      if (gemerkt && SPRACHEN.some((s) => s.code === gemerkt)) return gemerkt;
    } catch {
      /* Privater Modus — dann eben die Browsersprache. */
    }
    const vom = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return SPRACHEN.some((s) => s.code === vom) ? vom : 'en';
  }

  /**
   * Übersetzt einen einzelnen Text. Für Texte, die im JavaScript entstehen.
   *
   * @param {string} text englisches Original
   * @param {Record<string, string|number>} [werte] füllt {name}-Platzhalter
   */
  t(text, werte = null) {
    let s = this.woerter?.[glatt(text)] ?? text;
    if (werte) {
      for (const [k, v] of Object.entries(werte)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
  }

  /** Umschalten und sofort anwenden. */
  setzen(code) {
    if (!SPRACHEN.some((s) => s.code === code) || code === this.code) return;
    this.code = code;
    try {
      localStorage.setItem(SPEICHER, code);
    } catch {
      /* dann gilt die Wahl nur bis zum Schliessen */
    }
    /* Das `lang`-Attribut ist nicht Zierde: Vorlesehilfen wählen danach ihre
     * Aussprache, und der Browser seine Silbentrennung. */
    document.documentElement.lang = code;
    this.anwenden();
    this.onAendern?.(code);
  }

  /**
   * Übersetzt alles unterhalb der Wurzel.
   *
   * Es wird IMMER vom englischen Original aus übersetzt, nie vom aktuell
   * sichtbaren Text. Sonst liefe ein Wechsel Deutsch -> Französisch ins
   * Leere, weil das Wörterbuch englische Schlüssel hat.
   *
   * @param {Node} [ab] nur diesen Teilbaum (der Beobachter nutzt das)
   */
  anwenden(ab = null) {
    let ziel = ab ?? this.wurzel;
    if (!ziel) return;

    /* Ist das Ziel selbst ein TEXTKNOTEN, muss sein Elternteil her.
     *
     * Ein TreeWalker besucht seine eigene Wurzel NIE, nur Nachfahren — und
     * ein Textknoten hat keine. Der Durchlauf täte also gar nichts.
     * Genau so ist es aufgefallen: `textContent = 'Sign in'` erzeugt einen
     * neuen Textknoten, der Beobachter reichte ihn hier herein, und die
     * Kontozeile blieb als einzige Stelle im deutschen Menü englisch. */
    if (ziel.nodeType === 3) ziel = ziel.parentElement ?? this.wurzel;

    /* DEN BEOBACHTER ABHÄNGEN, SOLANGE WIR SELBST SCHREIBEN.
     *
     * Hier stand ein Merker (`_laeuft = true` … `= false`), und der war
     * wirkungslos: der Rückruf eines MutationObserver läuft ASYNCHRON, als
     * Mikroaufgabe nach dem aktuellen Durchlauf. Wenn er endlich dran kommt,
     * steht der Merker längst wieder auf `false`. Der Beobachter sah damit
     * seine eigenen Änderungen, übersetzte erneut, löste sich wieder aus —
     * Endlosschleife. Die Seite fror beim Start ein; gemessen daran, dass
     * der Browser auf keine Abfrage mehr antwortete.
     *
     * `disconnect()` leert zugleich die bereits aufgelaufene Warteschlange.
     * Genau das ist gewollt: was wir selbst geschrieben haben, ist nichts,
     * worauf wir reagieren müssten. */
    const wachte = !!this._wacht;
    if (wachte) this._wacht.disconnect();
    try {
      this._textknoten(ziel);
      this._attribute(ziel);
    } finally {
      if (wachte) this._wachtStarten();
    }
  }

  _textknoten(ziel) {
    const gehen = document.createTreeWalker(ziel, NodeFilter.SHOW_TEXT, {
      acceptNode: (k) =>
        /* Skript- und Stilinhalte sind kein Text für Menschen. Ohne diese
         * Prüfung würde ein zufällig passender Codeschnipsel übersetzt. */
        k.parentElement && !/^(SCRIPT|STYLE)$/.test(k.parentElement.tagName)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    const knoten = [];
    // Erst sammeln, dann ändern: wer beim Laufen schreibt, bringt den
    // TreeWalker durcheinander.
    for (let k = gehen.nextNode(); k; k = gehen.nextNode()) knoten.push(k);

    for (const k of knoten) {
      let ur = this._urtext.get(k);
      if (ur === undefined) {
        ur = k.nodeValue;
        // Reiner Leerraum und Zahlen bleiben unangetastet — das ist der
        // grosse Rest bei eingerücktem HTML.
        if (!/[A-Za-z]{2}/.test(ur)) continue;
        this._urtext.set(k, ur);
      }
      const neu = this.woerter?.[glatt(ur)];
      /* Den umgebenden Leerraum des Originals erhalten. Ohne ihn klebte
       * "Sign in" im Fliesstext am nächsten Wort. */
      if (neu !== undefined) {
        const [, vorn = '', , hinten = ''] = ur.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? [];
        k.nodeValue = vorn + neu + hinten;
      } else if (k.nodeValue !== ur) {
        k.nodeValue = ur; // zurück auf Englisch
      }
    }
  }

  _attribute(ziel) {
    const alle = ziel.nodeType === 1 ? [ziel, ...ziel.querySelectorAll('*')] : [];
    for (const el of alle) {
      for (const a of ATTRIBUTE) {
        if (!el.hasAttribute(a)) continue;
        let merk = this._urattr.get(el);
        if (!merk) this._urattr.set(el, (merk = {}));
        if (merk[a] === undefined) merk[a] = el.getAttribute(a);
        const neu = this.woerter?.[glatt(merk[a])];
        el.setAttribute(a, neu ?? merk[a]);
      }
    }
  }

  /**
   * Beobachtet Nachschub und übersetzt ihn mit.
   *
   * NÖTIG, NICHT BEQUEM: Kacheln, Bestenlisten, Meldungen und Einblendungen
   * entstehen erst zur Laufzeit. Ohne Beobachter müsste jede einzelne
   * Zeichenstelle daran denken, hinterher zu übersetzen — und genau eine
   * davon vergisst man. Der Beobachter kennt keine Ausnahmen.
   */
  beobachten() {
    if (!this.wurzel || this._wacht) return;
    this._wacht = new MutationObserver((eintraege) => {
      /* Erst sammeln, dann EINMAL übersetzen. Jedes `anwenden` hängt den
       * Beobachter ab und wieder an; das je Eintrag zu tun, wäre bei einer
       * neu gezeichneten Kachelliste dutzendfacher Leerlauf. */
      const ziele = new Set();
      for (const e of eintraege) {
        for (const k of e.addedNodes) ziele.add(k);
        if (e.type === 'characterData') {
          /* Von aussen neu gesetzter Text: der gemerkte Urtext ist überholt.
           * Ohne dieses Vergessen stellte der nächste Sprachwechsel den
           * ALTEN Text wieder her. */
          this._urtext.delete(e.target);
          ziele.add(e.target.parentElement ?? e.target);
        }
      }
      for (const z of ziele) this.anwenden(z);
    });
    this._wachtStarten();
  }

  _wachtStarten() {
    this._wacht.observe(this.wurzel, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}
