/* TEMPORAER — Bahnwechsel-Modell (wie SpritePlayer.update). */
import { CONFIG } from './src/config.js';

function wechselZeit(bahnX, vonIdx, zuIdx, cfg, dt = 1 / 60) {
  let x = bahnX[vonIdx];
  const ziel = bahnX[zuIdx];
  const rate = 3 / Math.max(0.02, cfg.bahnWechselZeit ?? 0.16);
  let t = 0;
  for (let i = 0; i < 100000; i++) {
    const rest = ziel - x;
    let schritt = rest * (1 - Math.exp(-rate * dt));
    const max = cfg.moveSpeed * dt;
    if (schritt > max) schritt = max;
    else if (schritt < -max) schritt = -max;
    x += schritt;
    t += dt;
    if (Math.abs(ziel - x) < 0.002) return t;
  }
  return Infinity;
}

/** Zwei EINZELWISCHE: der zweite kommt erst nach `pause` Sekunden. */
function zweiEinzeln(bahnX, cfg, pause, dt = 1 / 60) {
  let x = bahnX[0];
  let ziel = bahnX[1];
  const rate = 3 / Math.max(0.02, cfg.bahnWechselZeit ?? 0.16);
  let t = 0;
  let zweiter = false;
  for (let i = 0; i < 100000; i++) {
    if (!zweiter && t >= pause) { ziel = bahnX[2]; zweiter = true; }
    const rest = ziel - x;
    let schritt = rest * (1 - Math.exp(-rate * dt));
    const max = cfg.moveSpeed * dt;
    if (schritt > max) schritt = max; else if (schritt < -max) schritt = -max;
    x += schritt;
    t += dt;
    if (zweiter && Math.abs(ziel - x) < 0.002) return t;
  }
  return Infinity;
}

for (const [name, halbFeld] of [['hoch 390x844', 0.996], ['quer 16:9', 7.696]]) {
  const bahnX = CONFIG.world.bahnen.map((a) => a * halbFeld);
  for (const id of ['braun', 'weiss', 'orange']) {
    const c = CONFIG.characters.list[id];
    const cfg = { ...CONFIG.player, ...c.player };
    const eine = wechselZeit(bahnX, 1, 2, cfg);
    const zwei = wechselZeit(bahnX, 0, 2, cfg);
    const doppel = (c.doppelwischFenster ? zwei : null);
    const zweiWische = zweiEinzeln(bahnX, cfg, 0.30);
    console.log(
      `${name.padEnd(13)} ${id.padEnd(7)} moveSpeed ${String(cfg.moveSpeed).padStart(5)}  1 Bahn ${eine.toFixed(3)}s  2 Bahnen am Stueck ${zwei.toFixed(3)}s  2 Einzelwische (2. nach 0.30s) ${zweiWische.toFixed(3)}s` +
      (doppel !== null ? `  -> Doppelwisch spart ${(zweiWische - doppel).toFixed(3)}s` : ''),
    );
  }
}

console.log('\nSchwelle, ab der moveSpeed statt bahnWechselZeit bremst:');
for (const id of ['braun', 'weiss', 'orange']) {
  const cfg = { ...CONFIG.player, ...CONFIG.characters.list[id].player };
  const rate = 3 / (cfg.bahnWechselZeit ?? 0.16);
  console.log(`  ${id}: rest > moveSpeed/rate = ${(cfg.moveSpeed / rate).toFixed(3)} Einheiten`);
}
