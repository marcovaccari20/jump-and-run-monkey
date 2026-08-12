/**
 * GEGENPRÜFUNG des Bosskampf-Berichts. Nur messen, nichts ändern.
 *
 * Teil 1: Geometrie (Oberkante, Kampfhöhe, Überstand, Trefferkreis)
 * Teil 2: Wurftakt aus dem echten Boss-Objekt
 * Teil 3: Zeitlimit — echter BossKampf, Spieler weicht aus
 * Teil 4: Erreichbarkeit des Bosses (Hochformat vs. 16:9)
 */
import { PerspectiveCamera, Scene } from 'three';
import { CONFIG } from '../src/config.js';
import { topEdgeAt, halfWidthAt } from '../src/core/viewport.js';
import { Boss } from '../src/entities/Boss.js';
import { BossKampf, BossPhase } from '../src/systems/BossKampf.js';

const B = CONFIG.boss;
const R = CONFIG.render.camera;

function kamera(w, h) {
  const c = new PerspectiveCamera(R.fov, w / h, R.near, R.far);
  c.position.set(...R.position);
  c.lookAt(...R.lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

/* Ein Fake-Frame, damit Boss/Bossbanane ein aspect ausrechnen können. */
const fakeTex = (w = 300, h = 400) => ({ image: { width: w, height: h } });
const frames = (n, w, h) => Array.from({ length: n }, () => fakeTex(w, h));

console.log('=========== TEIL 1: GEOMETRIE ===========');
const formate = [
  ['Hochformat 390x845', 390, 845],
  ['16:9  1600x900', 1600, 900],
  ['4:3   1024x768', 1024, 768],
  ['Quadrat 800x800', 800, 800],
];
for (const [name, w, h] of formate) {
  const c = kamera(w, h);
  const obenZ0 = topEdgeAt(c, 0);
  const obenZ035 = topEdgeAt(c, 0.35);
  const halb = halfWidthAt(c, 0, CONFIG.player.startPosition[1]);
  console.log(
    `${name.padEnd(20)} topEdge(z=0)=${obenZ0.toFixed(4)}  topEdge(z=0.35)=${obenZ035.toFixed(4)}  halfWidth(affenY)=${halb.toFixed(3)}`,
  );
}

const cam = kamera(390, 845);
const obenY = topEdgeAt(cam, 0);
const obenY035 = topEdgeAt(cam, 0.35);
console.log(`\nsichtbarObenY (so wie Game es setzt, z=0) = ${obenY.toFixed(4)}`);
console.log(`echte Oberkante in der Boss-Ebene z=0.35  = ${obenY035.toFixed(4)}`);
console.log(`Differenz = ${(obenY - obenY035).toFixed(4)}`);

for (const art of B.arten) {
  const kampfY = obenY + (B.ueberstand - 0.5) * art.hoehe;
  const oberkante = kampfY + art.hoehe / 2;
  const unterkante = kampfY - art.hoehe / 2;
  const ueberSoll = oberkante - obenY;
  const ueberIst = oberkante - obenY035;
  const mitte = kampfY - art.hoehe * B.ueberstand * 0.5;
  const rad = art.hoehe * B.trefferAnteil;
  console.log(
    `\n[${art.id}] hoehe ${art.hoehe}  kampfY ${kampfY.toFixed(3)}  ` +
      `Oberkante ${oberkante.toFixed(3)}  Unterkante ${unterkante.toFixed(3)}`,
  );
  console.log(
    `   Ueberstand gegen z=0:   ${ueberSoll.toFixed(4)} = ${((ueberSoll / art.hoehe) * 100).toFixed(2)} %`,
  );
  console.log(
    `   Ueberstand gegen z=0.35:${ueberIst.toFixed(4)} = ${((ueberIst / art.hoehe) * 100).toFixed(2)} %`,
  );
  console.log(
    `   Trefferkreis ${(mitte - rad).toFixed(3)} … ${(mitte + rad).toFixed(3)} (Mitte ${mitte.toFixed(3)}, r ${rad.toFixed(3)})`,
  );
  // Rueckfallwert 6.8 gegenpruefen
  const kampfY68 = 6.8 + (B.ueberstand - 0.5) * art.hoehe;
  console.log(
    `   MIT Rueckfallwert 6.8:  kampfY ${kampfY68.toFixed(3)}, Unterkante ${(kampfY68 - art.hoehe / 2).toFixed(3)} (Bildkante ${obenY.toFixed(3)})`,
  );
}

console.log('\n=========== TEIL 2: WURFTAKT (echtes Boss-Objekt) ===========');
for (const art of B.arten) {
  const boss = new Boss(B, art, frames(art.frameAnzahl));
  boss.starten(0, 0);
  const dt = 1 / 60;
  let t = 0;
  const wuerfe = [];
  while (t < 90) {
    if (boss.update(dt, -1.97, 1.97)) wuerfe.push(t);
    t += dt;
  }
  const abst = wuerfe.slice(1).map((v, i) => v - wuerfe[i]);
  console.log(
    `[${art.id}] ${wuerfe.length} Wuerfe in 90 s. Erste Abstaende: ${abst.slice(0, 4).map((v) => v.toFixed(3)).join(' ')}`,
  );
  console.log(
    `        letzte Abstaende: ${abst.slice(-4).map((v) => v.toFixed(3)).join(' ')}  ` +
      `| rechnerisch ${(art.frameAnzahl / B.frameTakt.start).toFixed(3)} -> ${(art.frameAnzahl / B.frameTakt.ende).toFixed(3)}`,
  );
  console.log(`        Wuerfe in den ersten 20 s: ${wuerfe.filter((v) => v < 20).length}`);
}

console.log('\n=========== TEIL 3: ZEITLIMIT / AUSWEICHEN ===========');

function baueKampf() {
  const scene = new Scene();
  const arten = new Map();
  for (const a of B.arten) arten.set(a.id, { frames: frames(a.frameAnzahl), wurf: fakeTex(100, 100) });
  return new BossKampf(
    scene,
    B,
    { arten, spielerWurf: fakeTex(100, 100) },
    { klang: null, ui: null, onTreffer: () => {}, onEnde: () => {}, onSieg: () => {} },
  );
}

function welt(halbFeld, halbBahn) {
  return {
    bounds: { minX: -halbFeld, maxX: halbFeld, minY: -2.9, maxY: 2.7 },
    bahnX: [-halbBahn, 0, halbBahn],
    sichtbarObenY: obenY,
  };
}

/* Ein Spieler, der NUR ausweicht und nie wirft. Bahnwechsel sofort (Sprung),
 * wie es _wischen im Spiel praktisch tut (0.12 s Gleiten, hier ignoriert). */
function macheSpieler(w, reaktion = 0) {
  return {
    x: 0,
    y: B.affeY,
    alive: true,
    hitRadius: CONFIG.player.hitRadius ?? 0.42,
    spriteHeight: 2.4,
    treffer: 0,
    hoeheAnsteuern() {},
    werfen: () => false,
    _wartet: null,
    denke(kampf, dt) {
      // Welche Bahn ist bedroht? Naechstes Geschoss ueber mir.
      const g = kampf._aktiveGeschosse?.active ?? [];
      let gefahr = false;
      for (const p of g) {
        if (!p.active) continue;
        if (Math.abs(p.x - this.x) < p.hitRadius + this.hitRadius) gefahr = true;
      }
      if (gefahr) {
        if (this._wartet === null) this._wartet = reaktion;
        this._wartet -= dt;
        if (this._wartet <= 0) {
          // auf die sicherste Bahn springen
          let best = this.x;
          let bestAbst = -Infinity;
          for (const b of w.bahnX) {
            let d = Infinity;
            for (const p of g) {
              if (!p.active) continue;
              d = Math.min(d, Math.abs(p.x - b));
            }
            if (d > bestAbst) {
              bestAbst = d;
              best = b;
            }
          }
          this.x = best;
          this._wartet = null;
        }
      } else this._wartet = null;
    },
  };
}

for (const [nameF, halbFeld, halbBahn] of [
  ['Hochformat', 1.97, 1.97],
  ['16:9', 8.16, 2.2],
]) {
  for (const artId of ['gorilla', 'affe']) {
    const k = baueKampf();
    const w = welt(halbFeld, halbBahn);
    const p = macheSpieler(w, 0.25);
    let treffer = 0;
    k.onTreffer = () => {
      treffer++;
    };
    k.starten(p, w, artId);
    const dt = 1 / 60;
    let t = 0;
    while (t < 600 && k.aktiv) {
      p.denke(k, dt);
      k.update(dt, p, w);
      t += dt;
    }
    console.log(
      `[${nameF}/${artId}] nach ${t.toFixed(1)} s: phase="${k.phase}" aktiv=${k.aktiv} ` +
        `boss.leben=${k.boss?.leben} Treffer kassiert=${treffer}`,
    );
  }
}

console.log('\n--- Reaktionszeit-Tabelle (120 s, nie werfen) ---');
for (const reaktion of [0, 0.25, 0.5, 0.8, 1.2]) {
  const zeile = [];
  for (const [nameF, halbFeld, halbBahn] of [
    ['Hoch', 1.97, 1.97],
    ['16:9', 8.16, 2.2],
  ]) {
    for (const artId of ['gorilla', 'affe']) {
      const k = baueKampf();
      const w = welt(halbFeld, halbBahn);
      const p = macheSpieler(w, reaktion);
      let treffer = 0;
      k.onTreffer = () => {
        treffer++;
      };
      k.starten(p, w, artId);
      const dt = 1 / 60;
      for (let t = 0; t < 120; t += dt) {
        p.denke(k, dt);
        k.update(dt, p, w);
      }
      zeile.push(`${nameF}/${artId}=${treffer}`);
    }
  }
  console.log(`  Reaktion ${reaktion.toFixed(2)} s: ${zeile.join('  ')}`);
}

console.log('\n--- Nichtstuer (nie bewegen, nie werfen), 176 s ---');
for (const [nameF, halbFeld, halbBahn] of [
  ['Hoch', 1.97, 1.97],
  ['16:9', 8.16, 2.2],
]) {
  for (const artId of ['gorilla', 'affe']) {
    const k = baueKampf();
    const w = welt(halbFeld, halbBahn);
    const p = macheSpieler(w, 0);
    p.denke = () => {};
    let treffer = 0;
    k.onTreffer = () => {
      treffer++;
    };
    k.starten(p, w, artId);
    const dt = 1 / 60;
    for (let t = 0; t < 176; t += dt) k.update(dt, p, w);
    console.log(`  ${nameF}/${artId}: ${treffer} Treffer in 176 s`);
  }
}

console.log('\n=========== TEIL 4: ERREICHBARKEIT ===========');
const fenster = (art) => art.hoehe * B.trefferAnteil + B.wurf.hitRadius;
for (const [nameF, halbFeld, halbBahn] of [
  ['Hochformat', 1.97, 1.97],
  ['16:9', 8.16, 2.2],
]) {
  for (const art of B.arten) {
    const f = fenster(art);
    const erreichbar = Math.min(halbFeld, halbBahn + f);
    const anteil = erreichbar / halbFeld;
    const tot = Math.max(0, halbFeld - (halbBahn + f));
    console.log(
      `[${nameF}/${art.id}] Feld ±${halbFeld} Bahnen ±${halbBahn} Fenster ±${f.toFixed(3)} ` +
        `-> erreichbar ${(anteil * 100).toFixed(1)} %  tote Zone je Seite ${tot.toFixed(2)} E`,
    );
  }
}
