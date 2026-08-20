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
import { AdMobPortal, CrazyGames, GameMonetize, umgebungLesen } from '../src/systems/Portal.js';

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

/* =====================================================================
 *  CRAZYGAMES: WELCHE UMGEBUNG WIRD ERKANNT?
 *
 *  Das hat einmal die ganze Portalanbindung gekostet, und zwar lautlos.
 *  Geladen wird das SDK v3, abgefragt wurde es mit der v2-Schreibweise
 *  `getEnvironment()`. Am ausgelieferten SDK nachgemessen:
 *
 *      typeof SDK.getEnvironment  ->  "undefined"
 *      SDK.getEnvironment()       ->  wirft "is not a function"
 *      typeof SDK.environment     ->  "string"
 *
 *  Der Aufruf warf jedes Mal, ein `catch` schluckte es, die Umgebung blieb
 *  "unbekannt" — und der CrazyGames-Adapter wurde nie aktiv. Beim Portal kam
 *  deshalb kein einziges `gameplayStart()` an: in deren Prüfliste stand
 *  "No detected SDK functionalities" und "First Gameplay Start: No".
 * ===================================================================== */

console.log('\nCrazyGames-Umgebung erkennen:\n');

pruefe('v3: environment als Eigenschaft', umgebungLesen({ environment: 'crazygames' }), 'crazygames');
pruefe('v3: local', umgebungLesen({ environment: 'local' }), 'local');
pruefe('v3: vor init() ("uninitialized")', umgebungLesen({ environment: 'uninitialized' }), 'unbekannt');
pruefe('v2: getEnvironment als Funktion', umgebungLesen({ getEnvironment: () => 'crazygames' }), 'crazygames');

/* DER FALL, DER ES KAPUTT GEMACHT HAT: das echte v3-SDK. `getEnvironment`
 * fehlt ganz, `environment` trägt den Wert. Wer hier die Funktion ruft,
 * bekommt einen Fehler statt einer Antwort. */
pruefe(
  'echtes v3 (getEnvironment fehlt ganz)',
  umgebungLesen({ environment: 'crazygames', sdk: {}, logger: {} }),
  'crazygames',
);

/* Und wenn wirklich beides fehlt, muss ehrlich "unbekannt" herauskommen —
 * NICHT "crazygames". Sonst würde auf jedem fremden Portal fälschlich der
 * CrazyGames-Adapter aktiv. */
pruefe('gar nichts vorhanden', umgebungLesen({}), 'unbekannt');
pruefe('kein SDK', umgebungLesen(null), 'unbekannt');

/* Eine werfende Funktion darf den Start nicht mitreissen. */
pruefe(
  'getEnvironment wirft',
  umgebungLesen({ getEnvironment: () => { throw new Error('kaputt'); } }),
  'unbekannt',
);

/* =====================================================================
 *  CRAZYGAMES: KOMMEN DIE MELDUNGEN WIRKLICH AM SDK AN?
 *
 *  Die Prüfliste des Portals hakt "First Gameplay Start" nur ab, wenn
 *  `sdk.game.gameplayStart()` tatsächlich gerufen wurde. Vorher stand dort
 *  "No" — nicht weil der Aufruf fehlte, sondern weil der Adapter wegen der
 *  falsch gelesenen Umgebung nie aktiv wurde.
 *
 *  Die Namen unten sind am ausgelieferten v3-SDK nachgesehen, nicht geraten:
 *  game.loadingStart, game.loadingStop, game.gameplayStart, game.gameplayStop,
 *  ad.requestAd, data.getItem, data.setItem — alle vorhanden und Funktionen.
 * ===================================================================== */

console.log('\nCrazyGames-Meldungen an das SDK:\n');

/** Ein SDK-Doppel, das mitschreibt, was gerufen wurde. */
function sdkDoppel() {
  const rufe = [];
  return {
    rufe,
    sdk: {
      game: {
        loadingStart: () => rufe.push('loadingStart'),
        loadingStop: () => rufe.push('loadingStop'),
        gameplayStart: () => rufe.push('gameplayStart'),
        gameplayStop: () => rufe.push('gameplayStop'),
      },
      ad: { requestAd: (art) => rufe.push('requestAd:' + art) },
      data: { getItem: () => null, setItem: () => {} },
    },
  };
}

{
  const { rufe, sdk } = sdkDoppel();
  const p = new CrazyGames(CFG);
  p.sdk = sdk;
  p.bereit = true;

  p.ladenStart();
  p.ladenFertig();
  p.spielStart();
  p.spielStop();

  pruefe('ladenStart meldet loadingStart', rufe[0], 'loadingStart');
  pruefe('ladenFertig meldet loadingStop', rufe[1], 'loadingStop');
  pruefe('spielStart meldet gameplayStart', rufe[2], 'gameplayStart');
  pruefe('spielStop meldet gameplayStop', rufe[3], 'gameplayStop');
}

/* DIE WERBEART MUSS BIS ZUM SDK DURCHKOMMEN.
 * Ein Zwischenspot als 'rewarded' zu melden wäre eine Falschangabe — das
 * Portal rechnet beide verschieden ab. */
{
  const { rufe, sdk } = sdkDoppel();
  const p = new CrazyGames(CFG);
  p.sdk = sdk;
  p.bereit = true;

  p.werbung('midgame');
  pruefe('werbung("midgame") reicht die Art durch', rufe.at(-1), 'requestAd:midgame');

  p.abbrechen();
  p.werbung('rewarded');
  pruefe('werbung("rewarded") ebenso', rufe.at(-1), 'requestAd:rewarded');
  p.abbrechen();
}

/* =====================================================================
 *  ADMOB — die Werbung der Android-App
 *
 *  Derselbe Grund wie oben, nur noch schärfer: eine App bekommt man nicht
 *  mal eben auf, um nachzusehen. Zwischen "Code geändert" und "im Play
 *  Store sichtbar" liegen ein Gradle-Bau, ein Upload und eine Prüfung durch
 *  Google. Ein Fehler, den man erst dort bemerkt, kostet Tage.
 *
 *  Die Aufrufnamen unten sind an der TypeScript-Schnittstelle des Plugins
 *  nachgesehen (@capacitor-community/admob 8.1.0), nicht geraten:
 *    prepareRewardVideoAd / showRewardVideoAd
 *    prepareInterstitial  / showInterstitial
 * ===================================================================== */

console.log('\nAdMob-Anbindung (Android-App):\n');

/** Ein AdMob-Doppel, das mitschreibt und sich steuern lässt. */
function admobDoppel({ belohntLaeuft = true, zwischenLaeuft = true, lohn = { type: 'coins', amount: 1 } } = {}) {
  const rufe = [];
  return {
    rufe,
    admob: {
      async initialize() { rufe.push('initialize'); },
      async prepareRewardVideoAd() { rufe.push('prepareRewardVideoAd'); },
      async prepareInterstitial() { rufe.push('prepareInterstitial'); },
      async showRewardVideoAd() {
        rufe.push('showRewardVideoAd');
        // Bricht der Spieler ab, wirft das Plugin — genau das bildet das hier ab.
        if (!belohntLaeuft) throw new Error('dismissed');
        return lohn;
      },
      async showInterstitial() {
        rufe.push('showInterstitial');
        if (!zwischenLaeuft) throw new Error('no fill');
      },
    },
  };
}

const ADCFG = {
  admob: { belohnt: 'ca-app-pub-test/1', zwischen: 'ca-app-pub-test/2', test: true },
};

/** Ein AdMob-Portal, das bereit ist und beide Sorten vorrätig hat. */
function admobBereit(optionen) {
  const { rufe, admob } = admobDoppel(optionen);
  const p = new AdMobPortal(ADCFG);
  p.admob = admob;
  p.bereit = true;
  p._belohntBereit = true;
  p._zwischenBereit = true;
  p._letzterSpot = 0; // Sperre lange vorbei
  return { p, rufe };
}

/* --- 1. Belohnter Spot zu Ende gesehen --------------------------------- *
 * DER ENTSCHEIDENDE UNTERSCHIED ZU GAMEMONETIZE: showRewardVideoAd() löst
 * nur auf, wenn die Belohnung wirklich verdient ist. Kein Erschliessen aus
 * Ereignissen, keine Mindestdauer. */
{
  const { p } = admobBereit();
  pruefe('belohnter Spot zu Ende gesehen', await p.werbung('rewarded'), 'belohnt');
}

/* --- 2. Spieler bricht ab -> KEINE Belohnung --------------------------- */
{
  const { p } = admobBereit({ belohntLaeuft: false });
  pruefe('belohnter Spot abgebrochen', await p.werbung('rewarded'), 'abgebrochen');
}

/* --- 3. Gar kein Spot vorraetig ---------------------------------------- */
{
  const { p } = admobBereit();
  p._belohntBereit = false;
  pruefe('kein belohnter Spot vorraetig', await p.werbung('rewarded'), 'fehler');
}

/* --- 4. Zwischenspot ---------------------------------------------------- */
{
  const { p, rufe } = admobBereit();
  pruefe('Zwischenspot gelaufen', await p.werbung('midgame'), 'belohnt');
  pruefe('  und zwar ueber showInterstitial', rufe.includes('showInterstitial'), true);
  pruefe('  NICHT ueber den belohnten Aufruf', rufe.includes('showRewardVideoAd'), false);
}

/* --- 5. Die Werbeart trennt die beiden Wege --------------------------- *
 * Ein Zwischenspot darf nicht den belohnten Block verbrauchen — der ist
 * wertvoller und wird anders abgerechnet. */
{
  const { p, rufe } = admobBereit();
  await p.werbung('rewarded');
  pruefe('belohnt nimmt showRewardVideoAd', rufe.includes('showRewardVideoAd'), true);
  pruefe('  und NICHT showInterstitial', rufe.includes('showInterstitial'), false);
}

/* --- 6. Nach jedem Spot wird nachgeladen ------------------------------- *
 * Ohne Vorladen steht der Spieler nach dem Klick sekundenlang vor einem
 * leeren Bildschirm. */
{
  const { p, rufe } = admobBereit();
  await p.werbung('rewarded');
  pruefe('belohnter Spot laedt nach', rufe.includes('prepareRewardVideoAd'), true);
}
{
  const { p, rufe } = admobBereit();
  await p.werbung('midgame');
  pruefe('Zwischenspot laedt nach', rufe.includes('prepareInterstitial'), true);
}

/* --- 7. Die Sperre ------------------------------------------------------ */
{
  const { p } = admobBereit();
  pruefe('vor dem ersten Spot verfuegbar', p.hatWerbung(), true);
  await p.werbung('rewarded');
  pruefe('direkt danach gesperrt', p.hatWerbung(), false);
}

/* --- 8. Ohne vorraetigen Spot kein Angebot ----------------------------- *
 * `hatWerbung()` steuert, ob der Knopf ueberhaupt erscheint. Ein Angebot,
 * das nicht eingeloest werden kann, ist schlimmer als keines. */
{
  const { p } = admobBereit();
  p._belohntBereit = false;
  pruefe('kein Vorrat -> kein Angebot', p.hatWerbung(), false);
}

/* --- 9. Nicht eingerichtet --------------------------------------------- */
{
  const p = new AdMobPortal({ admob: null });
  pruefe('ohne Einrichtung: keine Werbung', p.hatWerbung(), false);
  pruefe('ohne Einrichtung: Anfrage scheitert', await p.werbung('rewarded'), 'fehler');
  pruefe('init ohne IDs meldet false', await p.init(), false);
}

/* --- 10. AdMob legt keine eigenen Spots -------------------------------- *
 * Anders als die Portale will AdMob nicht wissen, wann gespielt wird. Diese
 * Methoden muessen still bleiben — und duerfen vor allem nicht werfen. */
{
  const { p, rufe } = admobBereit();
  p.ladenStart(); p.ladenFertig(); p.spielStart(); p.spielStop(); p.abbrechen();
  pruefe('Spielmeldungen bleiben still', rufe.length, 0);
  pruefe('kein Portalspeicher', p.datenSpeicher(), null);
}

/* --- 11. AdMob antwortet NIE ------------------------------------------- *
 *
 * DER FALL, DER BISHER DURCH ALLE TESTS GEFALLEN IST.
 *
 * Geprüft wurden bisher: belohnt, abgebrochen, kein Vorrat, Nachladen — nicht
 * aber der schlimmste Fall: das Overlay meldet sich überhaupt nicht mehr.
 * Genau dort fehlte in AdMobPortal die Notbremse, die CrazyGames und
 * GameMonetize längst hatten, und `abbrechen()` war ein leerer Rumpf. Folge
 * in der ausgelieferten App: Werbebildschirm steht still, "Cancel" tut
 * nichts, Rettung nur durch Neustart — Lauf und gesammelte Münzen weg.
 *
 * Die Frist wird auf wenige Millisekunden gesetzt, damit der Test nicht die
 * echten 45 Sekunden braucht. */
{
  /** Ein Spot, der niemals auflöst. */
  const nieAntwort = () => new Promise(() => {});
  const stummesAdmob = () => ({
    showRewardVideoAd: nieAntwort,
    showInterstitial: nieAntwort,
    prepareRewardVideoAd: async () => {},
    prepareInterstitial: async () => {},
  });
  const portalMit = (cfg, admob = stummesAdmob()) => {
    const p = new AdMobPortal(cfg);
    p.admob = admob;
    p.bereit = true;
    p._belohntBereit = true;
    p._zwischenBereit = true;
    p._letzterSpot = 0;
    return p;
  };

  {
    const p = portalMit({ ...ADCFG, werbungTimeout: 40 });
    const start = Date.now();
    pruefe('stummer belohnter Spot endet von selbst', await p.werbung('rewarded'), 'fehler');
    pruefe('und zwar innerhalb der Frist', Date.now() - start < 1000, true);
  }

  {
    const p = portalMit({ ...ADCFG, werbungTimeout: 40 });
    pruefe('stummer Zwischenspot endet von selbst', await p.werbung('midgame'), 'fehler');
  }

  /* Der Abbrechen-Knopf MUSS wirken, BEVOR die Frist abläuft — das ist der
   * Unterschied zwischen "der Spieler kommt raus" und "der Spieler wartet". */
  {
    const p = portalMit({ ...ADCFG, werbungTimeout: 5000 });
    const laeuft = p.werbung('rewarded');
    await new Promise((r) => setTimeout(r, 10)); // Notbremse einhängen lassen
    const start = Date.now();
    p.abbrechen();
    pruefe('Abbrechen-Knopf beendet den Spot', await laeuft, 'abgebrochen');
    pruefe('sofort, nicht erst nach der Frist', Date.now() - start < 500, true);
  }

  /* Fehlt `werbungTimeout` in der Konfiguration, darf NICHT sofort
   * abgebrochen werden: `setTimeout(fn, undefined)` läse sonst 0 und jeder
   * Spot schlüge lautlos fehl. */
  {
    let aufloesen;
    const p = portalMit(
      { admob: ADCFG.admob }, // kein werbungTimeout
      {
        showRewardVideoAd: () =>
          new Promise((r) => {
            aufloesen = () => r({ type: 'coins', amount: 1 });
          }),
        showInterstitial: nieAntwort,
        prepareRewardVideoAd: async () => {},
        prepareInterstitial: async () => {},
      },
    );
    const laeuft = p.werbung('rewarded');
    await new Promise((r) => setTimeout(r, 30));
    aufloesen();
    pruefe('ohne Fristangabe wird nicht vorschnell abgebrochen', await laeuft, 'belohnt');
  }
}

console.log(fehler === 0 ? '\nAlle Fälle bestanden.\n' : `\n${fehler} FEHLER.\n`);
process.exit(fehler === 0 ? 0 : 1);
