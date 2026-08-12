/**
 * MESSSKRIPT (nur Messung, aendert nichts am Spiel).
 *
 * 1. Wie eng wird das Ausweichen wirklich? (Reaktionsreserve, bedrohte Bahnen)
 * 2. Haelt ein TRAEGER Spieler mit Reaktionszeit mit?
 * 3. Was bringt ein Kampf, den man nie beendet? (kein Zeitlimit)
 * 4. Geometrie-Feinheiten: Ebene z=0.35, Rueckfallwert 6.8.
 */
import { PerspectiveCamera, Scene } from 'three';
import { CONFIG } from '../src/config.js';
import { halfWidthAt, topEdgeAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';
import { BossKampf, BossPhase } from '../src/systems/BossKampf.js';

const B = CONFIG.boss;
const DT = 1 / 60;
let _seed = 1;
Math.random = () => ((_seed = (_seed * 1664525 + 1013904223) >>> 0), _seed / 4294967296);

function kamera(w, h) {
  const cam = CONFIG.render.camera;
  const c = new PerspectiveCamera(cam.fov, w / h, cam.near, cam.far);
  c.position.set(...cam.position);
  c.lookAt(...cam.lookAt);
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  return c;
}
function weltFuer(w, h) {
  const c = kamera(w, h);
  const half = halfWidthAt(c, 0, CONFIG.player.startPosition[1]);
  const limit = Math.max(0.9, half - Math.max(1.403 / 2, groessteSpriteBreite(CONFIG.rock) / 2));
  const bounds = {
    minX: Math.max(CONFIG.world.bounds.minX, -limit),
    maxX: Math.min(CONFIG.world.bounds.maxX, limit),
    minY: CONFIG.world.bounds.minY,
    maxY: CONFIG.world.bounds.maxY,
  };
  return {
    bounds,
    bahnX: CONFIG.world.bahnen.map((a) => a * Math.min(bounds.maxX, CONFIG.world.bahnDeckel)),
    sichtbarObenY: topEdgeAt(c, 0),
    kam: c,
  };
}

/* ---------------------------------------------------- 4. Geometrie-Details */
console.log('======== GEOMETRIE-DETAILS ========');
const k = kamera(390, 845);
const obenZ0 = topEdgeAt(k, 0);
const obenZ035 = topEdgeAt(k, 0.35);
console.log(`  topEdgeAt(z=0)    = ${obenZ0.toFixed(3)}   <- damit rechnet BossKampf.starten`);
console.log(`  topEdgeAt(z=0.35) = ${obenZ035.toFixed(3)}   <- Ebene, in der der Boss WIRKLICH haengt (Boss.js:82)`);
console.log(`  Differenz ${(obenZ0 - obenZ035).toFixed(3)} Einheiten -> Boss haengt um so viel zu HOCH.`);
for (const art of B.arten) {
  const kampfY = obenZ0 + (B.ueberstand - 0.5) * art.hoehe;
  const echterUeberstand = kampfY + art.hoehe / 2 - obenZ035;
  console.log(
    `    ${art.id.padEnd(8)} Soll-Ueberstand ${(B.ueberstand * art.hoehe).toFixed(3)} (${(B.ueberstand * 100).toFixed(0)} %), ` +
      `Ist ${echterUeberstand.toFixed(3)} (${((echterUeberstand / art.hoehe) * 100).toFixed(1)} %)`,
  );
}
console.log(
  `  Rueckfallwert in BossKampf.js:169 ist 6.8, gemessen sind es ${obenZ0.toFixed(2)} ` +
    `-> Abweichung ${(6.8 - obenZ0).toFixed(2)} Einheiten (nur ohne Game relevant).`,
);
const kampfYFalsch = 6.8 + (B.ueberstand - 0.5) * 4.2;
console.log(
  `  Mit 6.8 saesse der Gorilla auf ${kampfYFalsch.toFixed(2)} statt ${(obenZ0 + (B.ueberstand - 0.5) * 4.2).toFixed(2)}: ` +
    `Unterkante ${(kampfYFalsch - 2.1).toFixed(2)} — komplett ueber dem Bildrand (${obenZ0.toFixed(2)}), also unsichtbar.`,
);

/* ------------------------------------------------------------ Simulation */
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
    this.wurfFrames = [1];
  }
  hoeheAnsteuern(y) {
    this.zielY = y === null ? this.cfg.startPosition[1] : y;
  }
  werfen() {
    if (!this.alive || !this.wurfFrames.length || this._wurf !== null) return false;
    this._wurf = 0;
    this._hatGeworfen = false;
    return true;
  }
  update(dt) {
    const ziel = this.welt.bahnX[this.zielBahn];
    const rest = ziel - this.x;
    let s = rest * (1 - Math.exp(-(3 / this.cfg.bahnWechselZeit) * dt));
    const m = this.cfg.moveSpeed * dt;
    s = Math.max(-m, Math.min(m, s));
    this.x += s;
    if (Math.abs(ziel - this.x) < 0.002) this.x = ziel;
    if (Math.abs(this.zielY - this.y) > 0.001) {
      this.y += (this.zielY - this.y) * (1 - Math.exp(-4.5 * dt));
      if (Math.abs(this.zielY - this.y) <= 0.001) this.y = this.zielY;
    }
    let e = null;
    if (this._wurf !== null) {
      this._wurf += dt / B.wurf.dauer;
      if (!this._hatGeworfen && this._wurf >= B.wurf.loslassenBei) {
        this._hatGeworfen = true;
        e = 'wurf';
      }
      if (this._wurf >= 1) {
        this._wurf = null;
        this._hatGeworfen = false;
      }
    }
    return e;
  }
}

function neuerKampf(welt, artId, onTreffer) {
  const scene = new Scene();
  const arten = new Map();
  for (const a of B.arten) {
    arten.set(a.id, {
      frames: Array.from({ length: a.frameAnzahl }, () => ({ image: { width: 512, height: 512 } })),
      wurf: { image: { width: 128, height: 128 } },
    });
  }
  const kampf = new BossKampf(
    scene,
    B,
    { arten, munition: { image: {} }, spielerWurf: { image: {} } },
    { klang: null, ui: null, onTreffer, onEnde: () => {}, onSieg: () => {} },
  );
  return kampf;
}

/* -------------------- 1./2. Ausweichen mit Reaktionszeit ------------------ */
console.log('\n======== AUSWEICHEN: WIE ENG IST ES? ========');
console.log('reaktion = Sekunden, die der Spieler braucht, bis er auf ein neues Geschoss reagiert.\n');

for (const [name, welt] of [
  ['Hochformat', weltFuer(390, 845)],
  ['16:9      ', weltFuer(1920, 1080)],
]) {
  for (const art of B.arten) {
    for (const reaktion of [0, 0.25, 0.5, 0.8]) {
      _seed = 4242;
      let treffer = 0;
      const kampf = neuerKampf(welt, art.id, () => treffer++);
      const affe = new Affe(welt);
      kampf.starten(affe, welt, art.id);
      let t = 0;
      let letzteEntscheidung = -99;
      let minReserve = Infinity;
      let maxBedroht = 0;
      const SEK = 120;
      while (kampf.aktiv && t < SEK) {
        if (kampf.kaempft && t - letzteEntscheidung >= reaktion) {
          letzteEntscheidung = t;
          let beste = affe.zielBahn;
          let bestZeit = -Infinity;
          let bedroht = 0;
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
            if (minZeit < Infinity) bedroht++;
            if (minZeit > bestZeit) {
              bestZeit = minZeit;
              beste = i;
            }
          }
          maxBedroht = Math.max(maxBedroht, bedroht);
          affe.zielBahn = beste;
          if (bestZeit < Infinity) minReserve = Math.min(minReserve, bestZeit);
        }
        affe.update(DT);
        kampf.update(DT, affe, welt);
        kampf.munitionEinsammeln(affe, welt);
        t += DT;
      }
      console.log(
        `  ${name} ${art.id.padEnd(8)} reaktion ${reaktion.toFixed(2)} s -> ` +
          `${treffer} Treffer in ${SEK} s  |  gleichzeitig bedrohte Bahnen max ${maxBedroht}/${welt.bahnX.length}` +
          (reaktion === 0
            ? `  |  knappste Restzeit auf der besten Bahn ${minReserve === Infinity ? '—' : minReserve.toFixed(2) + ' s'}`
            : ''),
      );
    }
  }
}

/* ----------------------- 3. Kampf ohne Ende ----------------------------- */
console.log('\n======== KAMPF OHNE ZEITLIMIT ========');
const welt = weltFuer(390, 845);
_seed = 7;
const kampf = neuerKampf(welt, 'gorilla', () => {});
const affe = new Affe(welt);
kampf.starten(affe, welt, 'gorilla');
let t = 0;
while (kampf.aktiv && t < 600) {
  kampf.update(DT, affe, welt);
  kampf.munitionEinsammeln(affe, welt);
  t += DT;
}
console.log(`  Der Affe wirft NIE. Nach ${t.toFixed(0)} s ist phase = "${kampf.phase}", aktiv = ${kampf.aktiv}.`);
console.log('  -> Es gibt keinen Ausstieg ausser: Boss dreimal treffen, sterben, Chili, Menue, neuer Lauf.');
const scroll = 'difficulty.scrollSpeed';
console.log(
  `  Solange laeuft score.addHeight weiter (Game.js:2174) und spawner.nachschubAus bleibt an ` +
    `(Game.js:2299) -> Hoehenmeter ohne jede Gefahr, sobald man das Ausweichen beherrscht. (${scroll})`,
);
