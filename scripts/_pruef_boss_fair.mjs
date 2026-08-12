/**
 * MESSSKRIPT (nur Messung, aendert nichts am Spiel).
 *
 * Faehrt den ECHTEN BossKampf im Kopf-los-Modus: Boss.js, Bossbanane.js,
 * Wurfbanane.js und BossKampf.js sind die Originale. Nachgebaut ist nur der
 * Affe (dieselbe Bahn-/Wurfmechanik wie SpritePlayer) und die Aufrufreihen-
 * folge aus Game._updatePlaying.
 *
 * Gemessen wird:
 *   - Wie viele Treffer kassiert ein Spieler, der optimal ausweicht?
 *   - Wie viele, wenn er gar nichts tut? (Kann man verlieren?)
 *   - Wie lange dauert der Kampf, reicht die Munition fuer drei Treffer?
 *   - Wie voll werden die Pools?
 * Jeweils im Hochformat (9:19.5) und auf 16:9.
 */
import { PerspectiveCamera, Scene } from 'three';
import { CONFIG } from '../src/config.js';
import { halfWidthAt, topEdgeAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';
import { BossKampf, BossPhase } from '../src/systems/BossKampf.js';

const B = CONFIG.boss;
const DT = 1 / 60;

/* --------------------------------------------------------- Zufall mit Saat */
let _seed = 1;
function srand() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
}
Math.random = srand;

/* ------------------------------------------------------------------- Welt */
function weltFuer(w, h) {
  const cam = CONFIG.render.camera;
  const c = new PerspectiveCamera(cam.fov, w / h, cam.near, cam.far);
  c.position.set(...cam.position);
  c.lookAt(...cam.lookAt);
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  const half = halfWidthAt(c, 0, CONFIG.player.startPosition[1]);
  const halbeBreite = Math.max(1.403 / 2, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - halbeBreite);
  const bounds = {
    minX: Math.max(CONFIG.world.bounds.minX, -limit),
    maxX: Math.min(CONFIG.world.bounds.maxX, limit),
    minY: CONFIG.world.bounds.minY,
    maxY: CONFIG.world.bounds.maxY,
  };
  const halbFeld = Math.min(bounds.maxX, CONFIG.world.bahnDeckel);
  return {
    bounds,
    bahnX: CONFIG.world.bahnen.map((a) => a * halbFeld),
    sichtbarObenY: topEdgeAt(c, 0),
  };
}

/* ------------------------------------------------------------------ Affe */
/** Nachbau der Teile von SpritePlayer, die im Kampf zaehlen. */
class Affe {
  constructor(welt) {
    this.cfg = CONFIG.player;
    this.welt = welt;
    this.x = welt.bahnX[1];
    this.y = this.cfg.startPosition[1];
    this.zielY = this.y;
    this.zielBahn = 1;
    this.alive = true;
    this.hitRadius = this.cfg.hitRadius;
    this.spriteHeight = 2.4;
    this._wurf = null;
    this._hatGeworfen = false;
    this._wurfEreignis = false;
    this.treffer = 0;
    this.wurfFrames = [1]; // Platzhalter: setzeWurfFrames wurde aufgerufen
  }
  get hitX() {
    return this.x;
  }
  get hitY() {
    return this.y;
  }
  hoeheAnsteuern(y) {
    this.zielY = y === null ? this.cfg.startPosition[1] : y;
  }
  werfen() {
    if (!this.alive) return false;
    if (!this.wurfFrames.length) return false;
    if (this._wurf !== null) return false;
    this._wurf = 0;
    this._hatGeworfen = false;
    return true;
  }
  update(dt) {
    const ziel = this.welt.bahnX[this.zielBahn];
    const rest = ziel - this.x;
    const rate = 3 / Math.max(0.02, this.cfg.bahnWechselZeit);
    let schritt = rest * (1 - Math.exp(-rate * dt));
    const maxSchritt = this.cfg.moveSpeed * dt;
    if (schritt > maxSchritt) schritt = maxSchritt;
    else if (schritt < -maxSchritt) schritt = -maxSchritt;
    this.x += schritt;
    if (Math.abs(ziel - this.x) < 0.002) this.x = ziel;

    if (Math.abs(this.zielY - this.y) > 0.001) {
      this.y += (this.zielY - this.y) * (1 - Math.exp(-4.5 * dt));
      if (Math.abs(this.zielY - this.y) <= 0.001) this.y = this.zielY;
    }

    let ereignis = null;
    if (this._wurf !== null) {
      this._wurf += dt / B.wurf.dauer;
      if (!this._hatGeworfen && this._wurf >= B.wurf.loslassenBei) {
        this._hatGeworfen = true;
        ereignis = 'wurf';
      }
      if (this._wurf >= 1) {
        this._wurf = null;
        this._hatGeworfen = false;
      }
    }
    return ereignis;
  }
}

/* ------------------------------------------------------------------- Lauf */

/**
 * @param {object} welt
 * @param {string} artId
 * @param {'nichts'|'ausweichen'|'kaempfen'} stil
 */
function lauf(welt, artId, stil, maxSekunden = 180) {
  const scene = new Scene();
  const arten = new Map();
  for (const a of B.arten) {
    arten.set(a.id, {
      frames: Array.from({ length: a.frameAnzahl }, () => ({ image: { width: 512, height: 512 } })),
      wurf: { image: { width: 128, height: 128 } },
    });
  }
  const affe = new Affe(welt);
  let treffer = 0;
  const kampf = new BossKampf(
    scene,
    B,
    { arten, munition: { image: { width: 128, height: 128 } }, spielerWurf: { image: { width: 128, height: 128 } } },
    {
      klang: null,
      ui: null,
      onTreffer: () => {
        treffer++;
      },
      onEnde: () => {},
      onSieg: () => {},
    },
  );
  kampf.starten(affe, welt, artId);

  const reichweite = kampf.boss.trefferRadius + B.wurf.hitRadius;
  let t = 0;
  let kampfStart = null;
  let gesammelt = 0;
  let geworfen = 0;
  let maxGeschosse = 0;
  let maxMunition = 0;
  let maxWuerfe = 0;
  let geschosseGesamt = 0;
  let vorherAktiv = 0;
  let leerlauf = 0;

  while (kampf.aktiv && t < maxSekunden) {
    /* --- KI ---------------------------------------------------------- */
    if (stil !== 'nichts' && kampf.kaempft) {
      // Ausweichen: die Bahn mit der groessten Restzeit bis zum Einschlag.
      let besteBahn = affe.zielBahn;
      let bestesMass = -Infinity;
      for (let i = 0; i < welt.bahnX.length; i++) {
        const bx = welt.bahnX[i];
        let minZeit = Infinity;
        for (const g of kampf._aktiveGeschosse.active) {
          if (!g.active) continue;
          if (Math.abs(g.x - bx) > g.hitRadius + affe.hitRadius) continue;
          const dy = g.y - affe.y;
          if (dy < -0.5) continue;
          minZeit = Math.min(minZeit, dy / g.cfg.tempo);
        }
        // Munition mitnehmen, wenn gefahrlos moeglich
        let bonus = 0;
        if (stil === 'kaempfen' && kampf.vorrat < B.munition.maxVorrat) {
          for (const m of kampf.munition.active) {
            if (!m.active) continue;
            if (Math.abs(m.x - bx) <= m.hitRadius + affe.hitRadius) bonus = 0.35;
          }
        }
        // Naeher am Boss stehen ist ein Vorteil beim Werfen
        if (stil === 'kaempfen') {
          bonus += 0.25 * (1 - Math.min(1, Math.abs(kampf.boss.x - bx) / 6));
        }
        const mass = (minZeit === Infinity ? 9 : minZeit) + bonus;
        if (mass > bestesMass + 1e-6) {
          bestesMass = mass;
          besteBahn = i;
        }
      }
      affe.zielBahn = besteBahn;

      /* Werfen: vorhalten. Bis die Banane oben ist, vergehen
       * loslassenBei*dauer + Flugzeit. */
      if (stil === 'kaempfen') {
        const flug =
          (kampf.boss.trefferMitte - (affe.y + affe.spriteHeight * 0.25)) / B.wurf.tempo;
        const vorlauf = B.wurf.loslassenBei * B.wurf.dauer + flug;
        // Position des Bosses in `vorlauf` Sekunden, mit Reflexion am Rand
        const spanne = welt.bounds.maxX - welt.bounds.minX;
        let p = kampf.boss.x - welt.bounds.minX + kampf.boss.richtung * kampf.boss.tempo * vorlauf;
        p = ((p % (2 * spanne)) + 2 * spanne) % (2 * spanne);
        if (p > spanne) p = 2 * spanne - p;
        const zielX = p + welt.bounds.minX;
        if (Math.abs(zielX - affe.x) <= reichweite * 0.55) {
          if (kampf.wurfAnfordern(affe)) geworfen++;
        }
      }
    }

    /* --- Reihenfolge wie in Game._updatePlaying ----------------------- */
    const ereignis = affe.update(DT);
    if (ereignis === 'wurf') kampf.bananeLoslassen(affe);
    kampf.update(DT, affe, welt);
    gesammelt += kampf.munitionEinsammeln(affe, welt);

    if (kampf.phase === BossPhase.KAMPF && kampfStart === null) kampfStart = t;
    const aktiveG = kampf._aktiveGeschosse?.activeCount ?? 0;
    if (aktiveG > maxGeschosse) maxGeschosse = aktiveG;
    if (aktiveG > vorherAktiv) geschosseGesamt += aktiveG - vorherAktiv;
    vorherAktiv = aktiveG;
    maxMunition = Math.max(maxMunition, kampf.munition.activeCount);
    maxWuerfe = Math.max(maxWuerfe, kampf.wuerfe.activeCount);
    if (kampf.kaempft && kampf.vorrat === 0) leerlauf += DT;

    t += DT;
  }

  return {
    dauer: t,
    kampfDauer: kampfStart === null ? 0 : t - kampfStart,
    treffer,
    gesiegt: !kampf.aktiv,
    gesammelt,
    geworfen,
    maxGeschosse,
    maxMunition,
    maxWuerfe,
    geschosseGesamt,
    leerlauf,
    restVorrat: kampf.vorrat,
  };
}

/* ------------------------------------------------------------------ Bericht */

const formate = [
  ['Hochformat 9:19.5', weltFuer(390, 845)],
  ['16:9          ', weltFuer(1920, 1080)],
];

console.log('Legende: Treffer = wie oft der Affe getroffen wird (3 Treffer ohne Banane = tot)\n');

for (const [name, welt] of formate) {
  console.log(`================ ${name} ================`);
  console.log(`  Bahnen: [${welt.bahnX.map((v) => v.toFixed(2)).join(', ')}]  Feld ${welt.bounds.minX.toFixed(2)}..${welt.bounds.maxX.toFixed(2)}`);
  for (const art of B.arten) {
    for (const stil of ['nichts', 'ausweichen', 'kaempfen']) {
      const N = 40;
      const r = [];
      for (let i = 0; i < N; i++) {
        _seed = 1000 + i * 7919;
        r.push(lauf(welt, art.id, stil));
      }
      const mit = (f) => r.map(f).reduce((a, b) => a + b, 0) / r.length;
      const siege = r.filter((x) => x.gesiegt).length;
      console.log(
        `  ${art.id.padEnd(8)} ${stil.padEnd(11)}` +
          ` Kampf ${mit((x) => x.kampfDauer).toFixed(1).padStart(5)} s` +
          ` | Treffer ${mit((x) => x.treffer).toFixed(2).padStart(5)}` +
          ` (min ${Math.min(...r.map((x) => x.treffer))} max ${Math.max(...r.map((x) => x.treffer))})` +
          ` | Siege ${siege}/${N}` +
          ` | gesammelt ${mit((x) => x.gesammelt).toFixed(1)}` +
          ` geworfen ${mit((x) => x.geworfen).toFixed(1)}` +
          ` | ohne Banane ${mit((x) => x.leerlauf).toFixed(1)} s`,
      );
      if (stil === 'kaempfen') {
        console.log(
          `           Pools: Geschosse max ${Math.max(...r.map((x) => x.maxGeschosse))}/${art.wurf.poolSize}` +
            `, Munition max ${Math.max(...r.map((x) => x.maxMunition))}/${B.munition.poolSize}` +
            `, eigene Wuerfe max ${Math.max(...r.map((x) => x.maxWuerfe))}/${B.wurf.poolSize}` +
            `  | Geschosse gesamt ${mit((x) => x.geschosseGesamt).toFixed(1)}`,
        );
      }
    }
  }
  console.log('');
}
