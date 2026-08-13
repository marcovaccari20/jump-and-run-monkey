/**
 * Schnürt das fertige Spiel für ein Spieleportal und PRÜFT es dabei.
 *
 * Run mit:  npm run paket
 *           npm run paket -- --portal crazygames
 *
 * Beide Portale (CrazyGames, GameMonetize) nehmen ein ZIP mit `index.html` in
 * der Wurzel. Was sie ablehnen, merkt man dort erst nach Tagen Wartezeit —
 * deshalb läuft die Prüfung hier, vor dem Hochladen:
 *
 *   1. Liegt index.html in der Wurzel?
 *   2. Sind ALLE Pfade relativ? Ein einziges `/assets/…` bricht im
 *      Unterordner, in dem die Portale das Spiel ausliefern.
 *   3. Ruft der Build fremde Server auf ausser den erlaubten SDKs? Beide
 *      Portale verlangen, dass ein Spiel offline lauffähig bleibt.
 *   4. Passt die Grösse in die Obergrenzen?
 *
 * Das Ergebnis ist ein ZIP je Portal plus eine Merkliste, was beim Einreichen
 * von Hand einzutragen ist.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const OUT = resolve(ROOT, 'pakete');

/* Erlaubte fremde Adressen. Alles andere ist ein Befund — die Portale
 * verlangen, dass das Spiel ohne Fremdserver spielbar bleibt. */
const ERLAUBT = [
  'https://sdk.crazygames.com/', // CrazyGames-SDK, nur mit ?portal=crazygames
  'https://api.gamemonetize.com/', // GameMonetize-SDK, dito
  'http://www.w3.org/', // XML-Namensraum in SVG, kein Netzwerkaufruf
  'https://jcgt.org/', // Quellenangabe in einem three.js-Kommentar
  /* Die eigene Supabase-Instanz: Bestenliste und Fortschritt.
   *
   * Das ist ein echter Fremdserver, und er MUSS in der Liste stehen — sonst
   * lässt sich gar nicht mehr paketieren, seit die Weltliste konfiguriert
   * ist. Die Portale verlangen, dass ein Spiel ohne Fremdserver SPIELBAR
   * bleibt, nicht dass es keine kennt: fällt Supabase aus, laufen Spiel und
   * lokale Bestenliste unverändert weiter (siehe Bestenliste.js). */
  'https://tbhaxppbpzywpypmeopo.supabase.co',
];

const PORTALE = {
  crazygames: {
    label: 'CrazyGames',
    maxMB: 250,
    hinweise: [
      'Im Entwicklerportal als "HTML5 (zip)" hochladen — mehr ist nicht nötig.',
      'Das Spiel erkennt CrazyGames SELBST (SDK getEnvironment). Kein Parameter,',
      '  keine Sonderfassung: dasselbe ZIP läuft auch auf der eigenen Website.',
      'Querformat UND Hochformat angeben — beides ist unterstützt und geprüft.',
      'Belohnte Werbung im Formular als "Rewarded video" ankreuzen.',
    ],
  },
  gamemonetize: {
    label: 'GameMonetize',
    maxMB: 100,
    hinweise: [
      'ZUERST das Spiel im Portal anlegen — es vergibt dabei eine Game-ID.',
      'Diese ID in CONFIG.ad.gameMonetizeId eintragen, dann `npm run paket` erneut.',
      '  OHNE die ID wird das SDK gar nicht geladen und es kommt nie ein Spot.',
      'Danach das neue ZIP hochladen. Ein Parameter in der Adresse ist nicht nötig.',
    ],
  },

  /* Play Store.
   *
   * Das ZIP hier ist NICHT die App — es ist die Weboberfläche, die später in
   * eine Android-Hülle (Capacitor) gelegt wird. Es getrennt zu schnüren hat
   * einen Zweck: die Prüfungen unten (relative Pfade, keine Fremdserver)
   * gelten für eine App noch strenger als fürs Web. In einer Android-App wird
   * die Seite über `file://` bzw. `https://localhost` geladen; ein einziger
   * absoluter Pfad oder ein Fremd-SDK, das der Play Store nicht kennt, fällt
   * dort sofort auf.
   *
   * Die eigentliche App-Hülle steht in scripts/app-huelle.md — sie braucht
   * Android Studio und ein Entwicklerkonto, beides ausserhalb dieses
   * Skripts. */
  playstore: {
    label: 'Play Store (Web-Teil der App)',
    maxMB: 150,
    // Kein Web-Werbe-SDK: in einer echten App nimmt man AdMob, und die
    // Portal-SDKs würden dort nicht einmal laden.
    ohneFremdSdk: true,
    hinweise: [
      'Dieses ZIP ist NICHT die fertige App — es ist ihr Inhalt.',
      'Es wurde mit VITE_ZIEL=playstore gebaut: provider steht fest auf "none",',
      '  die Web-SDKs von CrazyGames/GameMonetize werden nie geladen. Von Hand',
      '  ist dafür nichts umzustellen.',
      'Werbung gibt es in dieser Fassung noch keine — dafür kommt AdMob in die',
      '  Hülle, nicht ins Web-Bündel.',
      'Weiter geht es mit Capacitor: siehe scripts/app-huelle.md.',
      'Play Store verlangt zusätzlich: Datenschutzerklärung, Alterseinstufung,',
      '  Symbol 512x512, Funktionsgrafik 1024x500, mindestens 2 Screenshots.',
    ],
  },
};

/* ------------------------------------------------------------- Argumente */
const i = process.argv.indexOf('--portal');
const nur = i >= 0 ? process.argv[i + 1] : null;
if (nur && !PORTALE[nur]) {
  console.error(`Unbekanntes Portal "${nur}". Bekannt: ${Object.keys(PORTALE).join(', ')}`);
  process.exit(1);
}

/* ------------------------------------------------------------ Bauen */
if (!existsSync(DIST) || process.argv.includes('--bauen')) {
  console.log('Baue …');
  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
}

/* Ungenutztes 3D-Modell aus dem Paket werfen.
 *
 * Der Spieler läuft im Sprite-Modus (CONFIG.sprite.mode === 'sprite'), dann
 * setzt Game.js modelUrl auf null und monkey.glb wird zur Laufzeit NIE geladen
 * — im Netz-Mitschnitt taucht es nicht auf. Vite kopiert public/ aber komplett,
 * also läge die 1,5-MB-Datei sonst tot im ZIP und zählte auf die 20-MB-Grenze
 * der Portale mit. Solange der Sprite-Modus gilt, fliegt sie hier raus. Wer auf
 * 'model' zurückstellt, entfernt einfach diese Zeilen. */
const totesModell = join(DIST, 'models', 'monkey.glb');
if (existsSync(totesModell)) {
  rmSync(totesModell);
  console.log('monkey.glb entfernt (Sprite-Modus lädt es nicht).');
}

/* ------------------------------------------------------------ Prüfen */

/**
 * Liest die Dateinamen aus einem ZIP — ohne Abhängigkeit, direkt aus dem
 * zentralen Verzeichnis am Ende der Datei.
 *
 * Gebraucht, um das FERTIGE Archiv zu prüfen statt dem Packer zu vertrauen.
 * Aufbau laut ZIP-Spezifikation (APPNOTE):
 *   - am Dateiende steht das "End of Central Directory" (Signatur 06054b50),
 *     darin Zahl und Startadresse der Einträge
 *   - jeder Eintrag beginnt mit 02014b50, die Namenslänge steht bei +28,
 *     der Name selbst bei +46
 *
 * @returns {string[]} leer, wenn sich das Archiv nicht lesen lässt
 */
function zipEintraege(datei) {
  try {
    const b = readFileSync(datei);
    // EOCD von hinten suchen (das Kommentarfeld ist höchstens 65535 lang).
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
      if (b.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return [];
    const anzahl = b.readUInt16LE(eocd + 10);
    let pos = b.readUInt32LE(eocd + 16);

    const namen = [];
    for (let i = 0; i < anzahl && pos + 46 <= b.length; i++) {
      if (b.readUInt32LE(pos) !== 0x02014b50) break;
      const nameLen = b.readUInt16LE(pos + 28);
      const extraLen = b.readUInt16LE(pos + 30);
      const kommLen = b.readUInt16LE(pos + 32);
      namen.push(b.toString('utf8', pos + 46, pos + 46 + nameLen));
      pos += 46 + nameLen + extraLen + kommLen;
    }
    return namen;
  } catch {
    return [];
  }
}

function alleDateien(dir, treffer = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) alleDateien(p, treffer);
    else treffer.push(p);
  }
  return treffer;
}

const dateien = alleDateien(DIST);
const befunde = [];

// 1) index.html in der Wurzel
if (!existsSync(join(DIST, 'index.html'))) {
  befunde.push('index.html fehlt in der Wurzel des Builds.');
}

/* 2) absolute Pfade — in index.html UND in den JavaScript-Bündeln.
 *
 * Die Prüfung sah nur index.html an, und genau daran ist ein echter Fehler
 * vorbeigerutscht: die Gebietsmusik wurde als `/musik/gruen.ogg` geladen.
 * Auf einem Portal, das im Unterordner ausliefert, zeigt der führende
 * Schrägstrich auf die Wurzel der PORTALSEITE — es hätte dort schlicht keine
 * Musik gegeben, und `<audio>` meldet einen 404 nicht einmal.
 *
 * Gesucht wird nach Zeichenketten, die wie ein Asset-Pfad aussehen: ein
 * führender Schrägstrich plus eine bekannte Dateiendung. Nach Pfaden allein
 * zu suchen wäre unbrauchbar — im gebündelten three.js stehen dutzende
 * Zeichenketten mit Schrägstrich, die keine Adressen sind.
 */
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)) {
  befunde.push(`Absoluter Pfad in index.html: ${m[1]} — bricht im Unterordner des Portals.`);
}

/* KEIN statischer Test auf absolute Pfade IM BÜNDEL — der Versuch ist
 * gescheitert, und zwar aus einem lehrreichen Grund.
 *
 * Die Konfiguration schreibt Pfade absichtlich absolut ("/textures/x.webp")
 * und löst sie zur Laufzeit über `assetUrl()` gegen die Vite-Base auf. Ein
 * Textsucher im gebauten JavaScript sieht davon nichts: er kann nicht
 * unterscheiden, ob ein Pfad später durch `assetUrl()` läuft oder roh
 * verwendet wird. Ein solcher Test meldete alle 40 Texturen als Fehler und
 * hätte jedes Paket blockiert.
 *
 * Der Fehler, der ihn ausgelöst hat (Musik über `/musik/…` statt `assetUrl`),
 * ist trotzdem real gewesen. Er lässt sich nur zur LAUFZEIT finden:
 * `npm run pruef:unterordner` legt den Build in einen Unterordner, ruft ihn
 * dort auf und meldet jede Datei, die 404 liefert. */

// 3) fremde Server
const fremd = new Map();
for (const datei of dateien) {
  if (!/\.(js|html|css|json)$/i.test(datei)) continue;
  const text = readFileSync(datei, 'utf8');
  for (const m of text.matchAll(/https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9./?=_-]*/g)) {
    const url = m[0];
    if (ERLAUBT.some((e) => url.startsWith(e))) continue;
    if (!fremd.has(url)) fremd.set(url, relative(DIST, datei));
  }
}
for (const [url, datei] of fremd) {
  befunde.push(`Fremder Server: ${url}  (in ${datei})`);
}

// 4) Grösse
const bytes = dateien.reduce((s, f) => s + statSync(f).size, 0);
const mb = bytes / 1024 / 1024;

console.log(`\nBuild: ${dateien.length} Dateien, ${mb.toFixed(1)} MB`);
console.log(`Erlaubte Fremdaufrufe: nur die Portal-SDKs, und die nur auf Anforderung.`);

if (befunde.length) {
  console.log('\nBEFUNDE:');
  for (const b of befunde) console.log('  ✗ ' + b);
  console.log('\nNicht paketiert — erst beheben.');
  process.exit(1);
}
console.log('Prüfung bestanden: index.html in der Wurzel, alle Pfade relativ, keine Fremdserver.');

/* ------------------------------------------------------------ Packen */

mkdirSync(OUT, { recursive: true });
const ziele = nur ? [nur] : Object.keys(PORTALE);

/* Der Play Store bekommt einen EIGENEN Build.
 *
 * Die anderen beiden Ziele teilen sich einen: dasselbe ZIP läuft auf
 * CrazyGames, GameMonetize und der eigenen Seite, weil das Spiel das Portal
 * selbst erkennt. Die App-Fassung kann das nicht — dort muss `provider` fest
 * auf 'none' stehen, sonst versucht sie im WebView ein Web-SDK zu laden.
 * Deshalb wird für sie mit VITE_ZIEL=playstore neu gebaut.
 *
 * Reihenfolge: erst die Web-Ziele mit dem vorhandenen Build, danach der
 * App-Build. Sonst läge am Ende die App-Fassung in dist/, und der nächste
 * `npm run dev` liefe ohne Portalerkennung. */
const appZiele = ziele.filter((k) => PORTALE[k].ohneFremdSdk);
const webZiele = ziele.filter((k) => !PORTALE[k].ohneFremdSdk);
let dateienJetzt = dateien;

for (const key of [...webZiele, ...appZiele]) {
  const p = PORTALE[key];

  // Vergleich gegen die URSPRÜNGLICHE Liste: nur beim ersten App-Ziel neu bauen.
  if (p.ohneFremdSdk && dateienJetzt === dateien) {
    console.log('\nBaue die App-Fassung (VITE_ZIEL=playstore) …');
    execFileSync('npx', ['vite', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, VITE_ZIEL: 'playstore' },
    });
    dateienJetzt = alleDateien(DIST);
  }
  const dateien_ = dateienJetzt;

  /* Für die App-Fassung gilt eine SCHÄRFERE Regel als fürs Web.
   *
   * Im Browser sind die Portal-SDKs erlaubt — dort gehören sie hin. In einer
   * Android-App lädt die Seite über `file://` bzw. `https://localhost`; ein
   * Web-Werbe-SDK von CrazyGames oder GameMonetize läuft dort gar nicht erst
   * an, und der Play Store beanstandet Fremdaufrufe, die in der
   * Datenschutzerklärung nicht auftauchen. Deshalb hier nochmal prüfen — mit
   * einer leeren Erlaubnisliste. */
  if (p.ohneFremdSdk) {
    /* GEPRÜFT WIRD, WAS GELADEN WIRD — nicht, welche Zeichenketten im Bündel
     * stehen.
     *
     * Die erste Fassung suchte einfach jede http-Adresse im Build und lehnte
     * ab, sobald eine auftauchte. Das war in beide Richtungen falsch:
     *
     *   ZU STRENG bei Supabase. Bestenliste und Fortschritt sind auch in
     *   einer App völlig in Ordnung — Apps dürfen ins Netz. Es gehört in die
     *   Datenschutzerklärung, nicht auf eine Verbotsliste. Solange Supabase
     *   als Fremdaufruf galt, liess sich das Play-Store-Paket überhaupt nie
     *   schnüren.
     *
     *   ZU LASCH wäre es umgekehrt gewesen, sich auf die Abwesenheit der
     *   SDK-Adressen zu verlassen: sie stehen als Zeichenketten in Portal.js
     *   und verschwinden auch dann nicht aus dem Bündel, wenn sie nie
     *   gerufen werden.
     *
     * Entscheidend ist deshalb der SCHALTER: wird mit VITE_ZIEL=playstore
     * gebaut, steht `provider` auf 'none', `erzeugePortal` liefert
     * `KeinPortal`, und keines der beiden SDKs wird je angefordert. Genau das
     * wird hier nachgewiesen. */
    let schalterOk = false;
    for (const datei of dateien_) {
      if (!/\.js$/i.test(datei)) continue;
      const text = readFileSync(datei, 'utf8');
      /* Der Bundler ersetzt den Ausdruck durch den festen Wert — aber in
       * welcher Anführung, entscheidet er selbst. Gemessen kam
       * `provider:\`none\`` heraus, mit Backticks; eine Prüfung nur auf
       * ' und " ging deshalb ins Leere und meldete die fertige App-Fassung
       * als „keine App-Fassung". Alle drei zulassen. */
      if (/provider\s*:\s*["'`]none["'`]/.test(text)) schalterOk = true;
    }
    if (!schalterOk) {
      console.log(`\n${p.label}: ÜBERSPRUNGEN — der Build ist keine App-Fassung.`);
      console.log('  Erwartet: provider = "none" im Bündel.');
      console.log('  So bauen:  VITE_ZIEL=playstore npm run build');
      continue;
    }

    // Fremdadressen NENNEN, nicht ablehnen — sie gehören in die
    // Datenschutzerklärung des Play-Store-Eintrags.
    const fremde = new Set();
    for (const datei of dateien_) {
      if (!/\.(js|html|css|json)$/i.test(datei)) continue;
      for (const m of readFileSync(datei, 'utf8').matchAll(/https?:\/\/[a-zA-Z0-9.-]+/g)) {
        const url = m[0];
        if (url.startsWith('http://www.w3.org') || url.startsWith('https://jcgt.org')) continue;
        fremde.add(url);
      }
    }
    if (fremde.size) {
      console.log(`\n${p.label}: Adressen im Bündel — für die Datenschutzerklärung:`);
      for (const u of fremde) {
        const tot = /sdk\.crazygames|api\.gamemonetize/.test(u);
        console.log(`  ${tot ? '·' : '→'} ${u}${tot ? '   (nur Zeichenkette, wird nie geladen)' : ''}`);
      }
    }
  }

  const zip = join(OUT, `jungle-climber-${key}.zip`);
  rmSync(zip, { force: true });

  /* GEPACKT WIRD MIT BORDMITTELN — aber je nach System mit anderen.
   *
   * Hier stand nur `Compress-Archive`. Das liegt auf jedem Windows bei und
   * spart eine npm-Abhängigkeit, ist aber NUR unter Windows da. Sobald der
   * Bau auf GitHubs Linux-Rechnern läuft (siehe .github/workflows/
   * pakete.yml), gäbe es an dieser Stelle einen Abbruch — und zwar erst nach
   * dem kompletten Build, also spät und ohne erkennbaren Zusammenhang.
   *
   * Unter Linux und macOS tut es `zip`, das dort ebenso zum Bestand gehört.
   * Beide packen den INHALT von dist/, nicht den Ordner selbst: index.html
   * muss in der Wurzel des Archivs liegen, sonst lehnen die Portale ab. */
  if (process.platform === 'win32') {
    /* `tar` STATT `Compress-Archive` — und das ist kein Geschmacksurteil,
     * sondern die Behebung eines Fehlers, der jedes Portal-Paket unbrauchbar
     * gemacht hätte.
     *
     * Compress-Archive der Windows-PowerShell schreibt die Pfade im Archiv
     * mit BACKSLASH: `musik\gruen.ogg`. Der ZIP-Standard (APPNOTE 4.4.17)
     * schreibt den Schrägstrich vor. Windows entpackt beides klaglos —
     * deshalb fällt es hier nie auf. Ein Linux- oder Java-Entpacker, und
     * genau darauf laufen die Portale, sieht dagegen KEINEN Ordner: er legt
     * 231 Dateien mit Namen wie "musik\gruen.ogg" flach in die Wurzel.
     * index.html lädt dann und findet nichts mehr.
     *
     * Gemessen am fertigen Paket: 231 von 232 Einträgen mit Backslash, kein
     * einziger mit Schrägstrich.
     *
     * `tar.exe` liegt seit Windows 10 (1803) im System, benutzt libarchive
     * und schreibt normgerechte Schrägstriche. `-a` wählt das Format anhand
     * der Endung, `-C` wechselt ins dist-Verzeichnis.
     *
     * Die oberste Ebene wird EINZELN benannt statt als `.` — sonst stellt
     * tar jedem Eintrag `./` voran, und `index.html` hiesse `./index.html`.
     * Die meisten Entpacker sehen das als dasselbe an, aber ein Portal, das
     * stur auf `index.html` prüft, nicht. */
    /* MIT VOLLEM PFAD, nicht über den Suchpfad.
     *
     * `tar` allein erwischt in einer Git-Bash das mitgelieferte GNU-tar, und
     * das kann gar keine ZIP-Dateien: der Lauf brach mit Status 128 ab, ohne
     * eine Zeile Erklärung. Gemeint ist immer das bsdtar aus System32. */
    const winTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    const oben = readdirSync(DIST);
    execFileSync(winTar, ['-a', '-c', '-f', zip, '-C', DIST, ...oben], { stdio: 'inherit' });
  } else {
    // -r rekursiv, -q leise, . = alles im aktuellen Ordner (cwd ist dist/).
    // `zip` schreibt von Haus aus Schrägstriche.
    execFileSync('zip', ['-rq', zip, '.'], { cwd: DIST, stdio: 'inherit' });
  }

  /* DAS FERTIGE ARCHIV NACHSEHEN, nicht dem Packer glauben.
   *
   * Der Backslash-Fehler oben war im Spiel und im Build unsichtbar und wäre
   * erst auf dem Portal aufgefallen — nach Tagen Wartezeit, mit einem Spiel,
   * das dort einen weissen Bildschirm zeigt. Deshalb wird jetzt die
   * Dateiliste IM ZIP gelesen und beides geprüft: normgerechte Trenner und
   * index.html wirklich in der Wurzel. */
  const eintraege = zipEintraege(zip);
  const mitBackslash = eintraege.filter((n) => n.includes('\\'));
  if (mitBackslash.length) {
    befunde.push(
      `${p.label}: ${mitBackslash.length} von ${eintraege.length} Einträgen im ZIP benutzen ` +
        `Backslash statt Schrägstrich (z. B. "${mitBackslash[0]}"). Linux-Entpacker legen daraus ` +
        `flache Dateien in der Wurzel — das Spiel wäre auf dem Portal kaputt.`,
    );
  }
  if (eintraege.length && !eintraege.includes('index.html')) {
    befunde.push(
      `${p.label}: index.html liegt nicht als "index.html" in der Wurzel des ZIP ` +
        `(gefunden: ${eintraege.slice(0, 3).join(', ')}…).`,
    );
  }

  const zipMB = statSync(zip).size / 1024 / 1024;
  const passt = zipMB <= p.maxMB;
  console.log(
    `\n${p.label}: ${relative(ROOT, zip)}  ${zipMB.toFixed(1)} MB ` +
      `${passt ? `(Grenze ${p.maxMB} MB — passt)` : `(ZU GROSS, Grenze ${p.maxMB} MB)`}`,
  );
  for (const h of p.hinweise) console.log('   • ' + h);
}

console.log('\nFertig. Die ZIPs liegen in pakete/.');
