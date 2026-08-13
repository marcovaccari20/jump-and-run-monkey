/**
 * Nimmt die im Browser aufgezeichnete Spielaufnahme entgegen und legt sie ab.
 *
 * Run mit:  node scripts/video-empfang.mjs [ordner] [port]
 *
 * WARUM ES DIESEN UMWEG BRAUCHT
 *
 * Das Spiel zeichnet sich selbst auf: `canvas.captureStream()` plus
 * `MediaRecorder` liefern im Browser einen fertigen Videostrom, ohne
 * Bildschirmaufnahme, ohne Mauszeiger, ohne fremde Fenster im Bild. Nur
 * kommt das Ergebnis als Blob im Speicher der Seite an — dort nützt es
 * nichts.
 *
 * Der Blob liesse sich als Download anbieten, aber ein Downloaddialog ist
 * nichts, was sich von aussen zuverlässig bedienen lässt. Also nimmt ihn
 * dieser winzige Server per POST entgegen und schreibt ihn auf die Platte.
 * Danach macht ffmpeg daraus die Fassungen, die die Portale verlangen.
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ORDNER = resolve(process.argv[2] ?? 'pakete/video');
const PORT = Number(process.argv[3] ?? 4190);

mkdirSync(ORDNER, { recursive: true });

const server = createServer((req, res) => {
  /* Die Seite läuft auf einem anderen Port als dieser Empfänger — ohne diese
   * Kopfzeilen lehnt der Browser die Anfrage als fremde Herkunft ab. */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dateiname');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(200).end('Video-Empfang bereit');
    return;
  }

  const teile = [];
  req.on('data', (d) => teile.push(d));
  req.on('end', () => {
    const roh = Buffer.concat(teile);
    const name = (req.headers['x-dateiname'] ?? 'aufnahme.webm').toString().replace(/[^\w.-]/g, '');
    const ziel = resolve(ORDNER, name);
    writeFileSync(ziel, roh);
    console.log(`${name}  ${(roh.length / 1048576).toFixed(2)} MB  -> ${ziel}`);
    res.writeHead(200).end('ok ' + roh.length);
  });
});

server.listen(PORT, () => {
  console.log(`Video-Empfang auf http://localhost:${PORT}  ->  ${ORDNER}`);
});
