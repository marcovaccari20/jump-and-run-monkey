/**
 * Vergleicht JEDE in der Konfiguration angemeldete Bilddatei mit dem, was
 * wirklich in public/ liegt.
 *
 * WARUM DAS EIN EIGENES SKRIPT IST
 *
 * Diese Klasse von Fehlern ist dreimal bis ins fertige Spiel durchgekommen,
 * und jedes Mal war sie im Browser praktisch unsichtbar:
 *
 *   Der Entwicklungsserver beantwortet eine fehlende Datei NICHT mit 404. Er
 *   liefert index.html mit Status 200. Der TextureLoader bekommt also eine
 *   gültige Antwort, versucht HTML als Bild zu lesen und scheitert mit einem
 *   Event OHNE Text — im Protokoll steht dann eine leere Fehlermeldung, und
 *   an einer Stelle landete sie sogar nur in einem console.warn.
 *
 * Sichtbar war jeweils nur die Folge: eine goldene Banane, die nie fiel; ein
 * Affe, der beim Chili weiterkletterte statt zu fliegen. Vom eigentlichen
 * Grund — Satz hat 8 Bilder, Konfiguration sagt 12 — stand nirgends etwas.
 *
 * Hier wird deshalb vor dem Start nachgezählt, gegen die Platte.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG } from '../src/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = resolve(ROOT, 'public');

const fehler = [];
const zeilen = [];

/** Prüft eine Liste öffentlicher Pfade und meldet, was fehlt. */
function pruefe(titel, pfade) {
  /* Einmalig zählen: die Abspielreihenfolge darf Bilder WIEDERHOLEN (so
   * stehen die Standzeiten aus dem Video darin). 19 Takte auf 14 Dateien ist
   * kein Fehler, und "19 Bilder" wäre die falsche Auskunft. */
  const einmalig = [...new Set(pfade)];
  const fehlend = einmalig.filter((p) => !existsSync(resolve(PUBLIC, p.replace(/^\//, ''))));
  if (fehlend.length) {
    fehler.push(`${titel}: ${fehlend.length} von ${einmalig.length} fehlen — ${fehlend.slice(0, 4).join(', ')}${fehlend.length > 4 ? ' …' : ''}`);
  } else {
    zeilen.push(`  ok  ${titel.padEnd(30)} ${String(einmalig.length).padStart(2)} Bilder` +
      (pfade.length !== einmalig.length ? `, ${pfade.length} Takte` : ''));
  }
}

/** Baut die Pfadliste eines {n}-Musters. */
const folge = (muster, n) =>
  Array.from({ length: n }, (_, i) => muster.replace('{n}', String(i).padStart(2, '0')));

/* --- Kletterbilder: Standardsatz und je Charakter ------------------------ */

pruefe('sprite (Standard)', CONFIG.sprite.frames.map((i) =>
  CONFIG.sprite.framePath.replace('{n}', String(i).padStart(2, '0'))));

for (const ch of Object.values(CONFIG.characters.list)) {
  pruefe(`Charakter ${ch.id}`, ch.frames.map((i) =>
    ch.framePath.replace('{n}', String(i).padStart(2, '0'))));
}

/* --- Chili-Flug: Bildzahl JE CHARAKTER ---------------------------------- */

for (const [id, muster] of Object.entries(CONFIG.chili.frames)) {
  const n = CONFIG.chili.frameAnzahl[id];
  if (typeof n !== 'number') {
    fehler.push(`Chili ${id}: keine Bildzahl in CONFIG.chili.frameAnzahl`);
    continue;
  }
  pruefe(`Chili ${id}`, folge(muster, n));
}

/* --- Goldfell ----------------------------------------------------------- */

if (CONFIG.goldbanane?.framePath) {
  pruefe('Goldfell', folge(CONFIG.goldbanane.framePath, CONFIG.goldbanane.frameAnzahl));
}

/* --- Zu VIELE Bilder sind auch ein Fehler ------------------------------- */

/* Nicht nur fehlende Bilder zählen. Liegt in einem Ordner mehr, als
 * angemeldet ist, fehlt am Ende der Schleife ein Stück Bewegung — die
 * Animation springt an der Nahtstelle zurück, und niemand sucht den Grund in
 * der Konfiguration. Genau so ist der Goldsatz mit 19 Bildern zwölfmal
 * abgespielt worden. */
const ueberzaehlig = [
  ['sprite (Standard)', CONFIG.sprite.framePath, Math.max(...CONFIG.sprite.frames) + 1],
  ...Object.values(CONFIG.characters.list).map((ch) => [`Charakter ${ch.id}`, ch.framePath, Math.max(...ch.frames) + 1]),
  ...Object.entries(CONFIG.chili.frames).map(([id, m]) => [`Chili ${id}`, m, CONFIG.chili.frameAnzahl[id]]),
  ...(CONFIG.goldbanane?.framePath
    ? [['Goldfell', CONFIG.goldbanane.framePath, CONFIG.goldbanane.frameAnzahl]]
    : []),
];
for (const [titel, muster, n] of ueberzaehlig) {
  const einsMehr = muster.replace('{n}', String(n).padStart(2, '0'));
  if (existsSync(resolve(PUBLIC, einsMehr.replace(/^\//, '')))) {
    fehler.push(`${titel}: es liegen MEHR Bilder als angemeldet (${n}) — ${einsMehr} existiert`);
  }
}

/* --- Einzelbilder, die schon einmal gefehlt haben ------------------------ */

const einzeln = [
  CONFIG.goldbanane?.bild,
  CONFIG.chili?.bild,
  CONFIG.sturzflug?.warnung?.bild,
].filter((p) => typeof p === 'string');
if (einzeln.length) pruefe('Power-up-Bilder', einzeln);

/* --- Ausgabe ------------------------------------------------------------ */

console.log('\nBildbestand gegen die Konfiguration:');
for (const z of zeilen) console.log(z);

if (fehler.length) {
  console.error('\nFEHLER:');
  for (const f of fehler) console.error(`  ${f}`);
  console.error('\nErst "npm run prep:art", "npm run prep:boss" und "npm run prep:weiss" laufen lassen.\n');
  process.exit(1);
}

console.log('\nAlles vorhanden.\n');
