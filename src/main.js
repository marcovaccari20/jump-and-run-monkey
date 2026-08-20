/**
 * Einstiegspunkt.
 *
 * DIE WICHTIGSTE AUFGABE DIESER DATEI IST NICHT DAS STARTEN, SONDERN DAS
 * NICHT-STARTEN.
 *
 * Vorher stand hier `const game = new Game(viewport)` ohne jede Absicherung.
 * Der Konstruktor baut den WebGL-Renderer, und der wirft auf Geräten ohne
 * WebGL2 hart — three.js kennt seit r163 keinen Rückfall auf WebGL1 mehr.
 * Weil schon das Anlegen scheiterte, kam `game.load()` nie zustande und der
 * `.catch()` daneben lief ins Leere. Ergebnis auf so einem Gerät: der
 * Ladebildschirm steht für immer bei 0 % und "Loading…". Keine Meldung, kein
 * Ausweg, kein Hinweis. Im Play Store ist das der Ein-Stern-Fall, und
 * niemand installiert eine App ein zweites Mal.
 *
 * Deshalb hier drei Netze, von aussen nach innen:
 *   1. `window.onerror` und `unhandledrejection` — fangen ALLES, auch was
 *      später und ausserhalb dieser Datei passiert.
 *   2. WebGL2-Prüfung VOR dem Konstruktor — sagt dem Spieler, was los ist,
 *      statt ihn raten zu lassen.
 *   3. try/catch um das Anlegen selbst.
 *
 * Die Meldungen sind ENGLISCH und bewusst nicht übersetzt: das Wörterbuch
 * wird asynchron nachgeladen (siehe Sprache.js), und ausgerechnet in einem
 * Absturzpfad ist darauf kein Verlass. Englisch ist die Grundsprache des
 * Spiels und steht ohnehin im HTML.
 */
import './style.css';
import { Game } from './core/Game.js';

/**
 * Zeigt eine Meldung im Ladebildschirm — ohne das Spiel zu brauchen.
 *
 * Greift absichtlich direkt auf den DOM zu: dieser Weg muss auch dann noch
 * gehen, wenn `new Game()` gescheitert ist und es also weder `game` noch
 * `game.ui` gibt. Nichts hier darf etwas voraussetzen ausser index.html.
 */
function meldung(titel, text) {
  const label = document.getElementById('loading-label');
  const balken = document.getElementById('loading-fill');
  // Der Balken bleibt sonst bei 0 % stehen und sieht aus, als lade es weiter.
  if (balken) balken.style.width = '100%';
  if (label) {
    label.textContent = `${titel} ${text}`;
    label.style.color = '#ff9a7a';
    label.style.maxWidth = '32ch';
    label.style.lineHeight = '1.5';
  }
}

/* -------------------------------------------------- Netz 1: alles fangen */

let schonGemeldet = false;

/**
 * @param {unknown} fehler
 * @param {{titel?: string, text?: string}} [eigen] genauere Meldung, wenn die
 *   Ursache bekannt ist — sonst die allgemeine.
 */
function katastrophe(fehler, eigen = null) {
  /* Nur die ERSTE Meldung zeigen. Ein kaputter Zustand erzeugt meist eine
   * Kaskade von Folgefehlern; die dritte Meldung überschriebe sonst die
   * einzige, die dem Spieler etwas sagt. */
  if (schonGemeldet) return;
  schonGemeldet = true;
  console.error('[JungleClimber] Abbruch:', fehler);
  meldung(
    eigen?.titel ?? 'Jungle Climber could not start.',
    eigen?.text ??
      'Please close the app and open it again. If it keeps happening, restarting your device usually helps.',
  );
}

window.addEventListener('error', (e) => katastrophe(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => katastrophe(e.reason));

/* ------------------------------------------- Netz 2: WebGL2 vorher prüfen */

/**
 * Hat dieses Gerät WebGL2?
 *
 * Ohne WebGL2 wirft der Renderer mit einer Meldung, die kein Spieler
 * versteht. Lieber vorher fragen und es ihm verständlich sagen. Das
 * Prüf-Canvas wird nicht in die Seite gehängt.
 */
function hatWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const viewport = document.getElementById('viewport');

if (!hatWebGL2()) {
  katastrophe(new Error('WebGL2 nicht verfügbar'), {
    titel: 'This device cannot run Jungle Climber.',
    text: 'The game needs WebGL 2, which this browser or device does not provide.',
  });
} else {
  /* ------------------------------------ Netz 3: das Anlegen selbst sichern */
  let game = null;
  try {
    game = new Game(viewport);
    // Für schnelles Balancing in der Konsole erreichbar: window.__game.cfg …
    window.__game = game;
  } catch (err) {
    katastrophe(err);
  }

  if (game) {
    game
      .load()
      .then((info) => {
        game.start();
        console.info(
          `[JungleClimber] bereit — Spielfigur: ${info.mode}\n` +
            `Hintergrundstufen: ${info.stages.join(' -> ')} (danach zyklisch)\n` +
            `Clips: ${info.clips.length ? info.clips.join(', ') : '(Sprite, prozedural animiert)'}`,
        );
      })
      .catch((err) => {
        console.error('[JungleClimber] Laden fehlgeschlagen:', err);
        /* HIER STAND EINE ENTWICKLERMELDUNG: "Fehlt public/models/monkey.glb?
         * Dann zuerst npm run convert:model ausführen." Die war doppelt
         * falsch — das GLB wird im Sprite-Modus (config.js: player.mode)
         * gar nicht geladen, und ein Spieler im Play Store kann mit einem
         * npm-Befehl nichts anfangen. */
        katastrophe(err, {
          titel: 'Jungle Climber could not load.',
          text: 'Check your internet connection and try again.',
        });
      });
  }
}
