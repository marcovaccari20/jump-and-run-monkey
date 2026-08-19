/**
 * Prüft die Anmeldung — ohne Browser, ohne echten Server.
 *
 * WARUM DIESES SKRIPT
 * Die Anmeldung ist der einzige Teil des Spiels, bei dem ein Fehler DATEN
 * KOSTET statt nur zu ärgern: wer sich anmeldet und dabei seine Münzen
 * verliert, bekommt sie nicht zurück. Die drei Fallen dabei sind alle
 * unsichtbar, solange man nur klickt:
 *   1. Zwei gleichzeitige Erneuerungen entwerten einander (Supabase zieht
 *      das alte Erneuerungsmerkmal beim ersten Gebrauch ein) — der Spieler
 *      fliegt mitten im Spiel aus dem Konto.
 *   2. Reihenfolge beim Anmelden: erst zusammenführen, dann laden. Andersrum
 *      überschreibt ein leeres Konto die Anzeige.
 *   3. Eine tote Sitzung, die liegen bleibt, statt sauber abgemeldet zu
 *      werden — dann scheitert jedes Sichern still.
 *
 * `fetch` und `localStorage` werden ersetzt, damit jeder Fall gezielt
 * herbeigeführt werden kann. Gegen den echten Server liefe das nicht: ein
 * abgelaufenes Merkmal müsste man eine Stunde lang abwarten.
 */

let fehler = 0;
let geprueft = 0;

function pruef(name, ist, soll) {
  geprueft++;
  const gleich = JSON.stringify(ist) === JSON.stringify(soll);
  if (!gleich) {
    fehler++;
    console.error(`  FEHLER  ${name}\n          erwartet: ${JSON.stringify(soll)}\n          bekommen: ${JSON.stringify(ist)}`);
  } else {
    console.log(`  ok      ${name}`);
  }
}

// ------------------------------------------------------------- Umgebung

/** Ein localStorage, der im Speicher lebt. */
function speicherAttrappe() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

globalThis.localStorage = speicherAttrappe();
globalThis.location = { hash: '', pathname: '/', search: '' };
globalThis.history = { replaceState: () => {} };

/**
 * Ein fetch, das nach Vorgabe antwortet und jeden Aufruf mitschreibt.
 * @param {(pfad:string, koerper:any, kopf:any) => {status?:number, daten:any}} regel
 */
function netzAttrappe(regel) {
  const rufe = [];
  globalThis.fetch = async (url, opt) => {
    /* Aus der vollen Adresse den sprechenden Rest herausschneiden:
     *   …/auth/v1/token?grant_type=password  ->  token?grant_type=password
     *   …/rest/v1/rpc/stand_laden_konto      ->  stand_laden_konto
     * Das `rpc/` MUSS mit weg, sonst greift keine Regel und jede
     * Datenbankanfrage bekäme stillschweigend die Standardantwort — der
     * erste Anlauf dieses Skripts ist genau darüber gestolpert. */
    const roh = String(url);
    const pfad =
      roh.split('/auth/v1/')[1] ?? roh.split('/rest/v1/rpc/')[1] ?? roh.split('/rest/v1/')[1] ?? roh;
    const koerper = opt?.body ? JSON.parse(opt.body) : null;
    rufe.push({ pfad, koerper, kopf: opt?.headers, methode: opt?.method });
    const a = regel(pfad, koerper, opt?.headers) ?? { daten: {} };
    return {
      ok: (a.status ?? 200) < 400,
      status: a.status ?? 200,
      text: async () => JSON.stringify(a.daten),
    };
  };
  return rufe;
}

const CFG = {
  url: 'https://beispiel.supabase.co',
  schluessel: 'sb_publishable_probe',
  timeout: 1000,
  standLadenKontoFn: 'stand_laden_konto',
  standSichernKontoFn: 'stand_sichern_konto',
  kontoVerknuepfenFn: 'konto_verknuepfen',
};

const { Konto, KontoSpeicher } = await import('../src/systems/Konto.js');

// --------------------------------------------------------------- Prüfungen

console.log('\nAnmelden und abmelden');
{
  localStorage._map.clear();
  const rufe = netzAttrappe((pfad) => {
    if (pfad.startsWith('token?grant_type=password'))
      return {
        daten: {
          access_token: 'zugang-1',
          refresh_token: 'erneuern-1',
          expires_in: 3600,
          user: { email: 'a@b.ch', id: 'nutzer-1' },
        },
      };
    return { daten: {} };
  });
  const k = new Konto(CFG);
  pruef('vorher nicht angemeldet', k.angemeldet, false);

  await k.anmelden('  A@B.ch  ', 'geheim123');
  pruef('danach angemeldet', k.angemeldet, true);
  pruef('Adresse übernommen', k.email, 'a@b.ch');
  pruef('Leerzeichen abgeschnitten', rufe[0].koerper.email, 'A@B.ch');
  pruef('Sitzung liegt im Speicher', !!localStorage.getItem('jc_sitzung'), true);

  await k.abmelden();
  pruef('abgemeldet', k.angemeldet, false);
  pruef('Sitzung gelöscht', localStorage.getItem('jc_sitzung'), null);
}

console.log('\nSitzung übersteht einen Neustart');
{
  localStorage._map.clear();
  netzAttrappe(() => ({
    daten: {
      access_token: 'z',
      refresh_token: 'e',
      expires_in: 3600,
      user: { email: 'c@d.ch', id: 'n2' },
    },
  }));
  await new Konto(CFG).anmelden('c@d.ch', 'geheim123');
  // Zweites Konto-Objekt = neuer Spielstart im selben Browser.
  const wieder = new Konto(CFG);
  pruef('noch angemeldet', wieder.angemeldet, true);
  pruef('Adresse noch da', wieder.email, 'c@d.ch');
}

console.log('\nErneuerung: zwei gleichzeitige Aufrufe teilen sich eine Anfrage');
{
  localStorage._map.clear();
  let erneuerungen = 0;
  netzAttrappe((pfad) => {
    if (pfad.startsWith('token?grant_type=refresh_token')) {
      erneuerungen++;
      return {
        daten: { access_token: 'zugang-neu', refresh_token: 'erneuern-neu', expires_in: 3600 },
      };
    }
    return {
      daten: {
        access_token: 'zugang-alt',
        refresh_token: 'erneuern-alt',
        // Schon abgelaufen: der nächste Zugriff MUSS erneuern.
        expires_in: -10,
        user: { email: 'e@f.ch', id: 'n3' },
      },
    };
  });
  const k = new Konto(CFG);
  await k.anmelden('e@f.ch', 'geheim123');

  const [a, b, c] = await Promise.all([k.zugang(), k.zugang(), k.zugang()]);
  pruef('nur EINE Erneuerung für drei Aufrufe', erneuerungen, 1);
  pruef('alle bekommen dasselbe neue Merkmal', [a, b, c], ['zugang-neu', 'zugang-neu', 'zugang-neu']);
}

console.log('\nErneuerung scheitert: sauber abmelden statt tot weiterlaufen');
{
  localStorage._map.clear();
  netzAttrappe((pfad) => {
    if (pfad.startsWith('token?grant_type=refresh_token'))
      return { status: 400, daten: { msg: 'Invalid Refresh Token' } };
    return {
      daten: {
        access_token: 'z',
        refresh_token: 'e',
        expires_in: -10,
        user: { email: 'g@h.ch', id: 'n4' },
      },
    };
  });
  const k = new Konto(CFG);
  await k.anmelden('g@h.ch', 'geheim123');
  const z = await k.zugang();
  pruef('kein Merkmal mehr', z, null);
  pruef('abgemeldet', k.angemeldet, false);
  pruef('Sitzung aus dem Speicher entfernt', localStorage.getItem('jc_sitzung'), null);
}

console.log('\nMeldungen sind für Spieler lesbar');
{
  localStorage._map.clear();
  const faelle = [
    ['Invalid login credentials', 'Wrong e-mail or password.'],
    ['email rate limit exceeded', 'We cannot send e-mail right now. Please try again later.'],
    ['Password should be at least 6 characters', 'Password too short - use at least 6 characters.'],
    ['User already registered', 'This e-mail already has an account. Try signing in.'],
  ];
  for (const [roh, erwartet] of faelle) {
    netzAttrappe(() => ({ status: 400, daten: { msg: roh } }));
    const k = new Konto(CFG);
    let bekommen = '(keine Ausnahme)';
    try {
      await k.anmelden('x@y.ch', 'geheim123');
    } catch (e) {
      bekommen = e.message;
    }
    pruef(`"${roh.slice(0, 32)}…"`, bekommen, erwartet);
  }
}

console.log('\nRücksetz-Link aus der Adresszeile');
{
  localStorage._map.clear();
  netzAttrappe(() => ({ daten: {} }));
  globalThis.location = {
    hash: '#access_token=zug&refresh_token=ern&expires_in=3600&type=recovery',
    pathname: '/',
    search: '',
  };
  let ersetzt = false;
  globalThis.history = { replaceState: () => (ersetzt = true) };
  const k = new Konto(CFG);
  pruef('Link erkannt', k.ruecksetzungAusUrl(), true);
  pruef('Sitzung angelegt', k.angemeldet, true);
  pruef('Fragment aus der Adresszeile entfernt', ersetzt, true);

  // Ein gewöhnlicher Anker darf NICHT als Rücksetzung durchgehen.
  localStorage._map.clear();
  globalThis.location = { hash: '#bestenliste', pathname: '/', search: '' };
  pruef('gewöhnlicher Anker wird ignoriert', new Konto(CFG).ruecksetzungAusUrl(), false);
}

console.log('\nKontospeicher: Reihenfolge und Merkmal');
{
  localStorage._map.clear();
  const rufe = netzAttrappe((pfad) => {
    if (pfad === 'stand_laden_konto') return { daten: { muenzen: 500, frei: ['weiss'] } };
    if (pfad === 'konto_verknuepfen') return { daten: { muenzen: 500, frei: ['weiss'] } };
    return {
      daten: {
        access_token: 'zugang-echt',
        refresh_token: 'e',
        expires_in: 3600,
        user: { email: 'i@j.ch', id: 'n5' },
      },
    };
  });
  const k = new Konto(CFG);
  await k.anmelden('i@j.ch', 'geheim123');
  const s = new KontoSpeicher(CFG, k);

  await s.verknuepfen('anonyme-kennung');
  const stand = await s.laden();

  pruef('Stand kommt an', stand, { muenzen: 500, frei: ['weiss'] });
  const verknuepft = rufe.find((r) => r.pfad === 'konto_verknuepfen');
  const geladen = rufe.find((r) => r.pfad === 'stand_laden_konto');
  pruef('Verknüpfen läuft VOR dem Laden', rufe.indexOf(verknuepft) < rufe.indexOf(geladen), true);
  pruef('anonyme Kennung mitgegeben', verknuepft.koerper.p_spieler, 'anonyme-kennung');
  pruef(
    'persönliches Merkmal statt öffentlichem Schlüssel',
    geladen.kopf.Authorization,
    'Bearer zugang-echt',
  );
  pruef('Laden gibt KEINE Kennung mit (Server nimmt sie aus dem Merkmal)', geladen.koerper, {});
}

console.log('\nKontospeicher ohne Anmeldung: still scheitern, nicht werfen');
{
  localStorage._map.clear();
  netzAttrappe(() => ({ daten: {} }));
  const s = new KontoSpeicher(CFG, new Konto(CFG));
  pruef('laden liefert null', await s.laden(), null);
  pruef('sichern meldet false', await s.sichern({ muenzen: 10, frei: [] }), false);
  pruef('verknüpfen liefert null', await s.verknuepfen('x'), null);
}

console.log(`\n${geprueft - fehler}/${geprueft} bestanden.`);
process.exit(fehler ? 1 : 0);
