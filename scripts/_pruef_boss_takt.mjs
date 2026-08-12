/**
 * MESSSKRIPT (nur Messung, aendert nichts am Spiel).
 *
 * Teil 1: Geometrie — Bildoberkante, Kampfhoehe, tatsaechlicher Ueberstand
 *         im Hochformat (9:19.5) und auf 16:9.
 * Teil 2: Boss-Takt — Wurfabstand am Anfang gegen Ende, seitliches Tempo,
 *         Bildtakt, Wanderdauer.
 * Teil 3: Reichweite — wie lange steht der Boss ueberhaupt ueber einer Bahn?
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { halfWidthAt, topEdgeAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';
import { Boss } from '../src/entities/Boss.js';

const B = CONFIG.boss;

/* ------------------------------------------------------------------ Welt */

function weltFuer(w, h, spriteWidth = 1.403) {
  const cam = CONFIG.render.camera;
  const c = new PerspectiveCamera(cam.fov, w / h, cam.near, cam.far);
  c.position.set(...cam.position);
  c.lookAt(...cam.lookAt);
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);

  const affenHoehe = CONFIG.player.startPosition[1];
  const half = halfWidthAt(c, 0, affenHoehe);
  const halbeBreite = Math.max(spriteWidth / 2, groessteSpriteBreite(CONFIG.rock) / 2);
  const limit = Math.max(0.9, half - halbeBreite);

  const bounds = {
    minX: Math.max(CONFIG.world.bounds.minX, -limit),
    maxX: Math.min(CONFIG.world.bounds.maxX, limit),
    minY: CONFIG.world.bounds.minY,
    maxY: CONFIG.world.bounds.maxY,
  };
  const halbFeld = Math.min(bounds.maxX, CONFIG.world.bahnDeckel ?? Infinity);
  return {
    w,
    h,
    bounds,
    bahnX: CONFIG.world.bahnen.map((a) => a * halbFeld),
    sichtbarObenY: topEdgeAt(c, 0),
    halbFeld,
    halbeSichtbareBreite: half,
  };
}

const formate = [
  ['Hochformat 9:19.5 (390x845)', weltFuer(390, 845)],
  ['16:9 (1920x1080)', weltFuer(1920, 1080)],
  ['Tablet 4:3 (1024x768)', weltFuer(1024, 768)],
];

console.log('=========================== TEIL 1: GEOMETRIE ===========================');
for (const [name, w] of formate) {
  console.log(`\n--- ${name} ---`);
  console.log(
    `  sichtbarObenY = ${w.sichtbarObenY.toFixed(3)}   Feld x = ${w.bounds.minX.toFixed(2)} .. ${w.bounds.maxX.toFixed(2)}   Bahnen = [${w.bahnX.map((v) => v.toFixed(2)).join(', ')}]`,
  );
  for (const art of B.arten) {
    const kampfY = w.sichtbarObenY + (B.ueberstand - 0.5) * art.hoehe;
    const oberkante = kampfY + art.hoehe / 2;
    const unterkante = kampfY - art.hoehe / 2;
    const ueberstandWelt = oberkante - w.sichtbarObenY;
    const trefferMitte = kampfY - art.hoehe * B.ueberstand * 0.5;
    const trefferR = art.hoehe * B.trefferAnteil;
    const wurfY = kampfY - art.hoehe * 0.25;
    // Anteil der Bildhoehe: wie viel Prozent des Bildschirms liegt darueber?
    const bildHoeheWelt = w.sichtbarObenY - (-2.9);
    console.log(
      `  ${art.id.padEnd(8)} hoehe=${art.hoehe}  kampfY=${kampfY.toFixed(3)}  ` +
        `Oberkante=${oberkante.toFixed(3)} (Ueberstand ${ueberstandWelt >= 0 ? '+' : ''}${ueberstandWelt.toFixed(3)} = ${((ueberstandWelt / art.hoehe) * 100).toFixed(1)}% der Figur)  ` +
        `Unterkante=${unterkante.toFixed(3)}`,
    );
    console.log(
      `           Trefferkreis Mitte=${trefferMitte.toFixed(3)} r=${trefferR.toFixed(3)} -> oben=${(trefferMitte + trefferR).toFixed(3)} unten=${(trefferMitte - trefferR).toFixed(3)}  ` +
        `(im Bild: ${trefferMitte + trefferR <= w.sichtbarObenY ? 'JA' : 'NEIN, ragt raus'})`,
    );
    console.log(
      `           Abwurfhoehe wurfY=${wurfY.toFixed(3)}  Fallweg bis Affe(${B.affeY}) = ${(wurfY - B.affeY).toFixed(2)}  ` +
        `Fallzeit = ${((wurfY - B.affeY) / art.wurf.tempo).toFixed(2)} s`,
    );
    console.log(
      `           Affe(${B.affeY}) -> Trefferkreis: ${(trefferMitte - B.affeY).toFixed(2)} Einheiten, Wurfbanane braucht ${((trefferMitte - B.affeY) / B.wurf.tempo).toFixed(2)} s  (Bildhoehe gesamt ${bildHoeheWelt.toFixed(2)})`,
    );
  }
}

/* ------------------------------------------------------------- Boss-Takt */

console.log('\n\n========================= TEIL 2: TAKT / TEMPO =========================');

function frames(n) {
  return Array.from({ length: n }, () => ({ image: { width: 512, height: 512 } }));
}

for (const art of B.arten) {
  const boss = new Boss(B, art, frames(art.frameAnzahl));
  const welt = formate[0][1];
  boss.starten(0, 0);
  boss.richtung = 1;

  const dt = 1 / 60;
  const wuerfe = [];
  const proben = [];
  let t = 0;
  let umkehr = 0;
  let letzteRichtung = boss.richtung;
  // 60 s laufen lassen: Druck erreicht 1 nach druckSekunden.
  while (t < 60) {
    const wirft = boss.update(dt, welt.bounds.minX, welt.bounds.maxX);
    t += dt;
    if (wirft) wuerfe.push(t);
    if (boss.richtung !== letzteRichtung) {
      umkehr++;
      letzteRichtung = boss.richtung;
    }
    if (proben.length < 3 && t >= [0.5, 13, 26][proben.length]) {
      proben.push({ t, druck: boss._druck, tempo: boss.tempo, takt: boss.frameTakt });
    }
  }

  const abstaende = wuerfe.slice(1).map((v, i) => v - wuerfe[i]);
  console.log(`\n--- ${art.id} (${art.frameAnzahl} Bilder, loslassenBei=${(art.loslassenBei * art.frameAnzahl).toFixed(0)}/${art.frameAnzahl}) ---`);
  console.log(
    `  Druck rein zeitlich (kein Treffer): ${proben.map((p) => `t=${p.t.toFixed(0)}s druck=${p.druck.toFixed(2)} tempo=${p.tempo.toFixed(2)} takt=${p.takt.toFixed(1)}fps`).join(' | ')}`,
  );
  console.log(`  Wuerfe in 60 s: ${wuerfe.length}`);
  console.log(
    `  Wurfabstand:  1.->2. = ${abstaende[0].toFixed(3)} s   ` +
      `Mitte (10.) = ${abstaende[9]?.toFixed(3)} s   ` +
      `Ende (letzter) = ${abstaende[abstaende.length - 1].toFixed(3)} s`,
  );
  console.log(
    `  Rechnerisch:  Anfang ${art.frameAnzahl}/${B.frameTakt.start} = ${(art.frameAnzahl / B.frameTakt.start).toFixed(3)} s   ` +
      `Ende ${art.frameAnzahl}/${B.frameTakt.ende} = ${(art.frameAnzahl / B.frameTakt.ende).toFixed(3)} s   ` +
      `-> Faktor ${(B.frameTakt.ende / B.frameTakt.start).toFixed(2)}x`,
  );
  const spanne = welt.bounds.maxX - welt.bounds.minX;
  console.log(
    `  Seitlich: ${B.tempo.start} -> ${B.tempo.ende} E/s (Faktor ${(B.tempo.ende / B.tempo.start).toFixed(2)}x).  ` +
      `Feldbreite Hochformat ${spanne.toFixed(2)}: eine Ueberquerung ${(spanne / B.tempo.start).toFixed(2)} s -> ${(spanne / B.tempo.ende).toFixed(2)} s.  ` +
      `Umkehrpunkte in 60 s: ${umkehr}`,
  );
  console.log(
    `  Druck mit 3 Treffern: 3 x ${B.druckProTreffer} = ${(3 * B.druckProTreffer).toFixed(2)} zusaetzlich; ` +
      `druckSekunden=${B.druckSekunden} -> Druck 1.0 nach ${(B.druckSekunden * (1 - 3 * B.druckProTreffer)).toFixed(1)} s, wenn alle 3 Treffer frueh sitzen`,
  );
}

/* --------------------------------------------------------- Reichweite */

console.log('\n\n===================== TEIL 3: IST ER ERREICHBAR? =====================');
console.log('Der Affe wirft SENKRECHT von seiner Bahn. Treffer nur, wenn |bossX - bahnX| <= trefferRadius + wurf.hitRadius.');
for (const [name, w] of formate) {
  console.log(`\n--- ${name} ---`);
  for (const art of B.arten) {
    const reich = art.hoehe * B.trefferAnteil + B.wurf.hitRadius;
    // Anteil der Patrouillenstrecke, der von mindestens einer Bahn aus erreichbar ist
    const N = 20000;
    let treffbar = 0;
    for (let i = 0; i < N; i++) {
      const x = w.bounds.minX + ((w.bounds.maxX - w.bounds.minX) * i) / (N - 1);
      if (w.bahnX.some((b) => Math.abs(x - b) <= reich)) treffbar++;
    }
    console.log(
      `  ${art.id.padEnd(8)} Trefferfenster +-${reich.toFixed(3)}  ` +
        `Bahnen decken ${((treffbar / N) * 100).toFixed(1)} % der Patrouillenbreite ab  ` +
        `(Feld ${(w.bounds.maxX - w.bounds.minX).toFixed(2)}, Bahnabstand ${(w.bahnX[1] - w.bahnX[0]).toFixed(2)})`,
    );
    // groesste Luecke zwischen den Trefferfenstern
    let luecke = 0;
    let lauf = 0;
    for (let i = 0; i < N; i++) {
      const x = w.bounds.minX + ((w.bounds.maxX - w.bounds.minX) * i) / (N - 1);
      if (w.bahnX.some((b) => Math.abs(x - b) <= reich)) {
        lauf = 0;
      } else {
        lauf += (w.bounds.maxX - w.bounds.minX) / (N - 1);
        if (lauf > luecke) luecke = lauf;
      }
    }
    console.log(
      `           groesste tote Zone: ${luecke.toFixed(2)} Einheiten -> bei Tempo ${B.tempo.start} = ${(luecke / B.tempo.start).toFixed(2)} s / bei ${B.tempo.ende} = ${(luecke / B.tempo.ende).toFixed(2)} s unerreichbar`,
    );
  }
}
