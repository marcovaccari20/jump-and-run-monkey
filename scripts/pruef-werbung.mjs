/**
 * Spielt die GameMonetize-Anbindung gegen ein NACHGEBAUTES SDK durch.
 *
 * WARUM DAS SEIN MUSS
 *
 * Die Werbung ist der einzige Teil des Spiels, den man lokal nie sieht: das
 * SDK kommt vom Portal, lädt nur dort und antwortet nur dort. Der Fehler
 * "Werbung ansehen bewirkt nichts" ist deshalb bis auf die Live-Seite
 * durchgekommen und wäre es wieder — er sah im Code völlig plausibel aus.
 *
 * Hier laufen stattdessen alle Ereignisfolgen durch, die das echte SDK
 * schicken kann. Die Namen und Zahlen stammen aus dem entschlüsselten
 * Skript selbst (siehe Kopf von src/systems/Portal.js), nicht aus einer Doku.
 *
 * Run mit:  npm run pruef:werbung
 */
import { GameMonetize } from '../src/systems/Portal.js';

/* Das Portal-Modul greift auf document/window zu. Ein Minimalersatz genügt —
 * geprüft wird die Zustandslogik, nicht das Laden eines Skripts. */
globalThis.document = {
  createElement: () => ({ style: {}, remove() {} }),
  head: { appendChild() {} },
  documentElement: { style: { setProperty() {} } },
};
globalThis.window = globalThis;

const CFG = { gameMonetizeId: 'test', sdkTimeout: 4000, werbungTimeout: 45000 };

let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`  ${ok ? 'ok  ' : 'FEHL'} ${name.padEnd(52)} ${ist}${ok ? '' : '  (erwartet ' + soll + ')'}`);
};

/** Ein Portal, das bereit ist und dessen Sperre abgelaufen ist. */
function portalBereit() {
  const p = new GameMonetize(CFG);
  p.bereit = true;
  p._letzterSpot = 0; // Sperre lange vorbei
  globalThis.window.sdk = { showBanner() {}, pauseGame() {}, resumeGame() {} };
  return p;
}

const schlafe = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\nGameMonetize-Anbindung gegen nachgebautes SDK:\n');

/* --- 1. Echter Spot: PAUSE, warten, START -> belohnt -------------------- */
{
  const p = portalBereit();
  const lauf = p.werbung();
  p._ereignis({ name: 'SDK_GAME_PAUSE' });
  await schlafe(2100); // länger als MIN_SPOTDAUER
  p._ereignis({ name: 'SDK_GAME_START' });
  pruefe('echter Spot (PAUSE, 2.1 s, START)', await lauf, 'belohnt');
}

/* --- 2. Kein Spot: START kommt sofort -> KEINE Belohnung ---------------- *
 * Genau das schickt das SDK, wenn die Dreiminutensperre greift. Ohne die
 * Zeitschwelle gäbe es hier ein geschenktes Weiterleben. */
{
  const p = portalBereit();
  const lauf = p.werbung();
  p._ereignis({ name: 'SDK_GAME_PAUSE' });
  p._ereignis({ name: 'SDK_GAME_START' });
  pruefe('kein Spot (PAUSE und START unmittelbar)', await lauf, 'fehler');
}

/* --- 3. Gar kein PAUSE, nur START -> KEINE Belohnung -------------------- */
{
  const p = portalBereit();
  const lauf = p.werbung();
  p._ereignis({ name: 'SDK_GAME_START' });
  pruefe('nur START, nie PAUSE', await lauf, 'fehler');
}

/* --- 4. Werbeblocker ---------------------------------------------------- */
{
  const p = portalBereit();
  const lauf = p.werbung();
  p._ereignis({ name: 'SDK_BLOCKED' });
  pruefe('Werbeblocker (SDK_BLOCKED)', await lauf, 'fehler');
}

/* --- 5. SDK meldet einen Fehler ---------------------------------------- */
{
  const p = portalBereit();
  const lauf = p.werbung();
  p._ereignis({ name: 'SDK_ERROR' });
  pruefe('SDK_ERROR', await lauf, 'fehler');
}

/* --- 6. Das Ereignis, das es NICHT gibt, darf nichts bewirken ----------- *
 * Wäre es je wieder da, müsste dieser Test rot werden — nicht das Spiel. */
{
  const p = portalBereit();
  const lauf = p.werbung();
  p._ereignis({ name: 'SDK_REWARDED_WATCH_COMPLETE' });
  p._ereignis({ name: 'SDK_GAME_PAUSE' });
  await schlafe(2100);
  p._ereignis({ name: 'SDK_GAME_START' });
  pruefe('SDK_REWARDED_WATCH_COMPLETE wird ignoriert', await lauf, 'belohnt');
}

/* --- 7. Die Sperre des Portals ----------------------------------------- */
{
  const p = portalBereit();
  pruefe('vor dem ersten Spot: Werbung verfügbar', p.hatWerbung(), true);
  const lauf = p.werbung();
  p._ereignis({ name: 'SDK_GAME_PAUSE' });
  await schlafe(2100);
  p._ereignis({ name: 'SDK_GAME_START' });
  await lauf;
  pruefe('direkt danach: gesperrt', p.hatWerbung(), false);
  pruefe('zweite Anfrage in der Sperre', await p.werbung(), 'fehler');
}

/* --- 8. Beim Laden läuft schon ein Spot (preroll) ----------------------- */
{
  const p = new GameMonetize(CFG);
  p.bereit = true;
  pruefe('frisch gebaut: Sperre läuft (preroll)', p.hatWerbung(), false);
}

/* --- 9. DIE FALLE: unsere EIGENE Spielpause darf nicht zählen ----------- *
 *
 * `spielStop()` ruft sdk.onPauseGame() — und das feuert SDK_GAME_PAUSE.
 * Stirbt der Spieler, liest zehn Sekunden den Game-Over-Schirm und drückt
 * dann "Werbung ansehen", ohne dass ein Spot kommt, dürfte das keinesfalls
 * als "zehn Sekunden Werbung gesehen" durchgehen. */
{
  const p = portalBereit();
  p.spielStop();                       // fällt in die Attrappe, aber Ereignis simulieren:
  p._ereignis({ name: 'SDK_GAME_PAUSE' });
  await schlafe(2100);                 // Spieler liest den Schirm
  const lauf = p.werbung();
  p._ereignis({ name: 'SDK_GAME_START' }); // kein Spot, SDK meldet sofort weiter
  pruefe('eigene Pause vorher zaehlt NICHT als Spot', await lauf, 'fehler');
}

/* --- 10. Spielmeldungen schweigen waehrend eines Spots ------------------ */
{
  const p = portalBereit();
  let gerufen = 0;
  globalThis.window.sdk = {
    showBanner() {},
    onPauseGame() { gerufen++; },
    onResumeGame() { gerufen++; },
  };
  const lauf = p.werbung();
  p.spielStart();
  p.spielStop();
  pruefe('spielStart/spielStop im Spot: keine SDK-Meldung', gerufen, 0);
  p.abbrechen();
  await lauf;
  p.spielStart();
  pruefe('nach dem Spot wieder gemeldet', gerufen, 1);
}

/* --- 11. Abbrechen ------------------------------------------------------ */
{
  const p = portalBereit();
  const lauf = p.werbung();
  p.abbrechen();
  pruefe('von aussen abgebrochen', await lauf, 'abgebrochen');
}

console.log(fehler === 0 ? '\nAlle Fälle bestanden.\n' : `\n${fehler} FEHLER.\n`);
process.exit(fehler === 0 ? 0 : 1);
