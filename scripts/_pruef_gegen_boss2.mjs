/**
 * GEGENPRÜFUNG Teil 2: Feldbreite je Format/Charakter und Ausweichbudget
 * je CHARAKTER (der Bericht hat nur EINEN Affen simuliert).
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { halfWidthAt, topEdgeAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';

const R = CONFIG.render.camera;
const B = CONFIG.boss;

function kamera(w, h) {
  const c = new PerspectiveCamera(R.fov, w / h, R.near, R.far);
  c.position.set(...R.position);
  c.lookAt(...R.lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

const obenY = topEdgeAt(kamera(390, 845), 0);
const hazardBreite = groessteSpriteBreite(CONFIG.rock);
console.log(`groessteSpriteBreite(rock) = ${hazardBreite.toFixed(3)}  -> halb ${(hazardBreite / 2).toFixed(3)}`);

/* spriteWidth des Affen: spriteHeight * aspect der Kletterbilder. Ohne
 * geladene Textur nimmt SpritePlayer 1.4 als Rueckfall (siehe Game.js:2547). */
console.log('\n=== FELDBREITE (bounds.maxX) und BAHNEN ===');
const chars = Object.values(CONFIG.characters.list);
for (const [name, w, h] of [
  ['Hochformat 390x845', 390, 845],
  ['Handy quer 845x390', 845, 390],
  ['16:9 1600x900', 1600, 900],
]) {
  const cam = kamera(w, h);
  const half = halfWidthAt(cam, 0, CONFIG.player.startPosition[1]);
  for (const ch of chars) {
    const sh = ch.player?.spriteHeight ?? CONFIG.sprite?.spriteHeight ?? 2.5;
    // Rueckfall 1.4 wie im Code, skaliert mit der Spritehoehe
    const spriteBreite = 1.4 * (sh / 2.5);
    const halbeBreite = Math.max(spriteBreite / 2, hazardBreite / 2);
    const limit = Math.max(0.9, half - halbeBreite);
    const maxX = Math.min(CONFIG.world.bounds.maxX, limit);
    const halbFeld = Math.min(maxX, CONFIG.world.bahnDeckel);
    console.log(
      `${name.padEnd(20)} ${String(ch.id).padEnd(8)} half=${half.toFixed(3)} ` +
        `maxX=${maxX.toFixed(3)} Bahnen=±${halbFeld.toFixed(3)} ` +
        `moveSpeed=${ch.player?.moveSpeed ?? CONFIG.player.moveSpeed} ` +
        `verzug=${ch.wischVerzoegerung ?? 0}`,
    );
  }
}

console.log('\n=== AUSWEICHBUDGET JE CHARAKTER (Hochformat) ===');
const cam = kamera(390, 845);
const half = halfWidthAt(cam, 0, CONFIG.player.startPosition[1]);
for (const art of B.arten) {
  const kampfY = obenY + (B.ueberstand - 0.5) * art.hoehe;
  const wurfY = kampfY - art.hoehe * 0.25;
  const gHit = art.wurf.radius * art.wurf.hitRadiusFactor;
  console.log(`\n[${art.id}] wurfY ${wurfY.toFixed(3)} tempo ${art.wurf.tempo} geschossHitRadius ${gHit.toFixed(3)}`);
  for (const ch of chars) {
    const sh = ch.player?.spriteHeight ?? 2.5;
    const hit = ch.player?.hitRadius ?? CONFIG.player.hitRadius;
    const speed = ch.player?.moveSpeed ?? CONFIG.player.moveSpeed;
    const verzug = ch.wischVerzoegerung ?? 0;
    const spriteBreite = 1.4 * (sh / 2.5);
    const halbeBreite = Math.max(spriteBreite / 2, hazardBreite / 2);
    const maxX = Math.min(CONFIG.world.bounds.maxX, Math.max(0.9, half - halbeBreite));
    const bahn = Math.min(maxX, CONFIG.world.bahnDeckel);
    // Kontakt, wenn Abstand <= gHit + hit
    const kontaktY = B.affeY + gHit + hit;
    const budget = (wurfY - kontaktY) / art.wurf.tempo;
    const wegNachbar = bahn; // Mitte -> aussen bzw. aussen -> Mitte
    const fahrt = wegNachbar / speed;
    const rest = budget - verzug - fahrt;
    console.log(
      `   ${String(ch.id).padEnd(8)} Budget ${budget.toFixed(3)} s ` +
        `- Verzug ${verzug.toFixed(2)} - Fahrt ${fahrt.toFixed(3)} (${wegNachbar.toFixed(2)} E / ${speed}) ` +
        `= ${rest >= 0 ? '+' : ''}${rest.toFixed(3)} s fuer die MENSCHLICHE Reaktion`,
    );
  }
}

console.log('\n=== Was der Bericht als Fallzeit angibt (bis zur AFFEN-MITTE, ohne Radien) ===');
for (const art of B.arten) {
  const kampfY = obenY + (B.ueberstand - 0.5) * art.hoehe;
  const wurfY = kampfY - art.hoehe * 0.25;
  console.log(
    `[${art.id}] bis y=${B.affeY}: ${((wurfY - B.affeY) / art.wurf.tempo).toFixed(3)} s ` +
      `| bis KONTAKT (Standardaffe): ${((wurfY - (B.affeY + art.wurf.radius * art.wurf.hitRadiusFactor + 0.42)) / art.wurf.tempo).toFixed(3)} s`,
  );
}
