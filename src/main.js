/**
 * Einstiegspunkt.
 *
 * Lädt die Assets, startet den Loop und meldet im Fehlerfall eine lesbare
 * Meldung auf dem Ladebildschirm statt einer weissen Seite.
 */
import './style.css';
import { Game } from './core/Game.js';

const viewport = document.getElementById('viewport');
const game = new Game(viewport);

// Für schnelles Balancing in der Konsole erreichbar: window.__game.cfg …
window.__game = game;

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
    game.ui.setError(
      'Assets konnten nicht geladen werden. ' +
        'Fehlt public/models/monkey.glb? Dann zuerst "npm run convert:model" ausführen. ' +
        'Details stehen in der Browser-Konsole.',
    );
  });
