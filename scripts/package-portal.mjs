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

/* ------------------------------------------------------------ Prüfen */

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

// 2) absolute Pfade
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)) {
  befunde.push(`Absoluter Pfad in index.html: ${m[1]} — bricht im Unterordner des Portals.`);
}

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

for (const key of ziele) {
  const p = PORTALE[key];
  const zip = join(OUT, `jungle-climber-${key}.zip`);
  rmSync(zip, { force: true });

  // Compress-Archive statt einer npm-Abhängigkeit: liegt auf jedem Windows
  // bei, und das Paket soll ohne zusätzliche Installation entstehen.
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zip}' -Force`,
    ],
    { stdio: 'inherit' },
  );

  const zipMB = statSync(zip).size / 1024 / 1024;
  const passt = zipMB <= p.maxMB;
  console.log(
    `\n${p.label}: ${relative(ROOT, zip)}  ${zipMB.toFixed(1)} MB ` +
      `${passt ? `(Grenze ${p.maxMB} MB — passt)` : `(ZU GROSS, Grenze ${p.maxMB} MB)`}`,
  );
  for (const h of p.hinweise) console.log('   • ' + h);
}

console.log('\nFertig. Die ZIPs liegen in pakete/.');
