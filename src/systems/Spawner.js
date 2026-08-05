/**
 * Erzeugt und bewegt Steine und Bananen.
 *
 * Beide Entity-Typen liegen in Object Pools; im Frame-Loop wird nichts
 * allokiert. Spawn-Takt, Fallgeschwindigkeit und Burst-Grösse kommen
 * ausschliesslich aus der DifficultyCurve.
 */
import { Pool } from '../entities/Pool.js';
import { Rock } from '../entities/Rock.js';
import { Banana } from '../entities/Banana.js';

export class Spawner {
  /**
   * @param {import('three').Object3D} scene
   * @param {typeof import('../config.js').CONFIG} cfg
   * @param {import('./DifficultyCurve.js').DifficultyCurve} difficulty
   * @param {object} world  wirksame Spielfeldmasse (Referenz!). Game passt
   *   darin die Breite bei jedem Resize an — der Spawner sieht das dadurch
   *   automatisch und wirft im Hochformat nichts neben dem Bild ab.
   */
  constructor(scene, cfg, difficulty, world) {
    this.cfg = cfg;
    this.difficulty = difficulty;
    this.world = world ?? cfg.world;

    this.rocks = new Pool(cfg.rock.poolSize, (i) => new Rock(i, cfg.rock));
    this.bananas = new Pool(cfg.banana.poolSize, (i) => new Banana(i, cfg.banana));

    for (const rock of this.rocks.all) scene.add(rock.mesh);
    for (const banana of this.bananas.all) scene.add(banana.mesh);

    this.timer = 0;
    this._poolExhaustedWarned = false;
  }

  reset() {
    this.rocks.releaseAll((r) => r.despawn());
    this.bananas.releaseAll((b) => b.despawn());
    // Kurze Schonfrist zu Spielbeginn, damit man nicht sofort getroffen wird.
    this.timer = this.difficulty.spawnDelay * 1.4;
  }

  /**
   * @param {number} dt
   * @param {boolean} playerHasRevive unterdrückt Bananen, wenn schon eine gebunkert ist
   * @param {number} scroll  tatsächliche Scrollgeschwindigkeit dieses Frames
   *   (inkl. Kletter-Bonus durch W/S — nicht difficulty.scrollSpeed, sonst
   *   passen Bildschirmgeschwindigkeit und Weltbewegung nicht zusammen)
   */
  update(dt, playerHasRevive, scroll) {
    const world = this.world;
    const bananaCfg = this.cfg.banana;
    const rockSpeed = this.difficulty.rockFallSpeed + scroll;
    const bananaSpeed = this.difficulty.rockFallSpeed * bananaCfg.fallSpeedFactor + scroll;

    /* ------------------------------------------------------------- Spawn */
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer += this.difficulty.spawnDelay;
      // Bei sehr kurzen Intervallen und Frame-Spikes kann der Timer mehrfach
      // negativ bleiben — dann auf den nächsten Takt aufsetzen statt zu stauen.
      if (this.timer < 0) this.timer = this.difficulty.spawnDelay;

      const count = this.difficulty.burstCount;
      const bananaAllowed =
        !(bananaCfg.suppressWhenStocked && playerHasRevive) &&
        Math.random() < bananaCfg.spawnChance;

      // Höchstens eine Banane pro Welle, an zufälliger Position der Welle.
      const bananaSlot = bananaAllowed ? Math.floor(Math.random() * count) : -1;

      for (let i = 0; i < count; i++) {
        const x = (Math.random() * 2 - 1) * world.spawnHalfWidth;
        // Leichte Höhenstreuung, damit ein Burst keine gerade Linie bildet.
        const y = world.spawnY + Math.random() * 1.6;

        if (i === bananaSlot) this._spawnBanana(x, y);
        else this._spawnRock(x, y);
      }
    }

    /* ------------------------------------------------------------ Update */
    // Rückwärts iterieren: release() macht swap-remove auf `active`.
    for (let i = this.rocks.active.length - 1; i >= 0; i--) {
      const rock = this.rocks.active[i];
      rock.update(dt, rockSpeed, -world.spawnHalfWidth, world.spawnHalfWidth);
      if (rock.y < world.despawnY) {
        rock.despawn();
        this.rocks.release(rock);
      }
    }

    for (let i = this.bananas.active.length - 1; i >= 0; i--) {
      const banana = this.bananas.active[i];
      banana.update(dt, bananaSpeed);
      if (banana.y < world.despawnY) {
        banana.despawn();
        this.bananas.release(banana);
      }
    }
  }

  _spawnRock(x, y) {
    const rock = this.rocks.acquire();
    if (!rock) {
      if (!this._poolExhaustedWarned) {
        console.warn('[Spawner] Stein-Pool erschöpft — CONFIG.rock.poolSize erhöhen.');
        this._poolExhaustedWarned = true;
      }
      return;
    }
    rock.spawn(x, y, Math.random(), Math.random(), Math.random());
  }

  _spawnBanana(x, y) {
    const banana = this.bananas.acquire();
    if (!banana) return; // kein Drama: dann eben keine Banane
    banana.spawn(x, y, Math.random());
  }

  /** Banane einsammeln -> zurück in den Pool. */
  collect(banana) {
    banana.despawn();
    this.bananas.release(banana);
  }

  get activeCount() {
    return this.rocks.activeCount + this.bananas.activeCount;
  }
}
