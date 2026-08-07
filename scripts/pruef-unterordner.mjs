/**
 * Findet Assets, die im UNTERORDNER nicht laden — der Fehler, den kein
 * Textsucher findet.
 *
 *   npm run pruef:unterordner
 *
 * WARUM ES DIESES SKRIPT GIBT
 * Die Portale liefern das Spiel nicht unter `https://portal.tld/` aus,
 * sondern unter `https://portal.tld/games/jungle-climber/`. Ein Pfad mit
 * führendem Schrägstrich zeigt dort auf die Wurzel der PORTALSEITE und geht
 * ins Leere. Genau das ist der Gebietsmusik passiert: `/musik/gruen.ogg`
 * hätte auf CrazyGames nichts geladen — und `<audio>` meldet einen 404 nicht
 * einmal, es bleibt einfach still.
 *
 * Statisch ist das nicht zu finden: die Konfiguration schreibt Pfade
 * absichtlich absolut und löst sie zur Laufzeit über `assetUrl()` auf. Ob
 * das an jeder Stelle passiert, zeigt nur ein echter Aufruf.
 *
 * Deshalb: dist unter einem Unterpfad ausliefern, die Seite laden, jede
 * Anfrage mitschreiben, und alles melden, was 404 liefert.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');
const UNTERPFAD = '/games/jungle-climber/';
const PORT = 8749;

if (!existsSync(DIST)) {
  console.error('dist fehlt — erst `npm run build`.');
  process.exit(1);
}

const TYPEN = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

const angefragt = [];

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let pfad = decodeURIComponent(url.pathname);

  const imUnterordner = pfad.startsWith(UNTERPFAD);
  const rest = imUnterordner ? pfad.slice(UNTERPFAD.length) : pfad.replace(/^\//, '');
  const datei = join(DIST, rest === '' ? 'index.html' : rest);

  const gefunden = existsSync(datei) && statSync(datei).isFile();
  angefragt.push({ pfad, imUnterordner, gefunden });

  if (!gefunden) {
    res.writeHead(404).end('nicht da');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPEN[extname(datei)] ?? 'application/octet-stream' });
  res.end(readFileSync(datei));
});

server.listen(PORT, async () => {
  console.log(`Build liegt unter http://localhost:${PORT}${UNTERPFAD}`);
  console.log('Seite dort aufrufen und ein paar Sekunden laufen lassen.\n');
  console.log('Danach Strg+C — der Bericht kommt beim Beenden.\n');
});

const bericht = () => {
  const fehler = angefragt.filter((a) => !a.gefunden);
  const ausserhalb = angefragt.filter((a) => !a.imUnterordner && a.pfad !== '/favicon.ico');

  console.log(`\n${angefragt.length} Anfragen, ${fehler.length} davon ohne Datei.\n`);

  if (ausserhalb.length) {
    console.log('AUSSERHALB DES UNTERORDNERS ANGEFRAGT — das sind die Fehler:');
    for (const a of ausserhalb) console.log(`  ${a.gefunden ? ' ' : '✗'} ${a.pfad}`);
    console.log('\n  Diese Pfade laufen nicht über assetUrl(). Auf einem Portal gehen sie ins Leere.');
  } else {
    console.log('Keine Anfrage hat den Unterordner verlassen — alle Pfade sind relativ. ✓');
  }

  if (fehler.length) {
    console.log('\nNICHT GEFUNDEN:');
    for (const a of fehler) console.log(`  ${a.pfad}`);
  }
  process.exit(ausserhalb.length || fehler.length ? 1 : 0);
};

process.on('SIGINT', bericht);
// Ohne Eingriff nach 25 s selbst beenden, damit es auch automatisiert läuft.
setTimeout(bericht, 25000);
