/** Misst, wo die Kacke wirklich landet — gegenueber der Stelle, an der der Adler steht. */
import { CONFIG } from '../src/config.js';
import { Adler } from '../src/entities/Adler.js';

const fakeTex = () => ({ image: { width: 1200, height: 900 } });
const flug = Array.from({ length: 10 }, fakeTex);
const kacken = Array.from({ length: 14 }, fakeTex);

function naechste(x, bahnen) {
  let b = bahnen[0];
  for (const c of bahnen) if (Math.abs(c - x) < Math.abs(b - x)) b = c;
  return b;
}

function lauf(bahnen, sekunden) {
  const cfg = CONFIG.boss;
  const adler = new Adler(flug, kacken, cfg);
  adler.reset();
  const minX = bahnen[0], maxX = bahnen[bahnen.length - 1];
  const tol = Math.abs(bahnen[1] - bahnen[0]) / 3;
  let angriffUhr = cfg.kacke.abstand.min;
  const dt = 1 / 60;
  let zielBeiStart = null;
  const drops = [];
  for (let f = 0; f < sekunden / dt; f++) {
    const e = adler.update(dt, minX, maxX, bahnen);
    if (e === 'kacke') {
      const x = adler.x;
      const lane = naechste(x, bahnen);
      drops.push({ x, lane, abstandZumAdler: Math.abs(lane - x), zielBeiStart, zielJetzt: adler._zielX });
    }
    angriffUhr -= dt;
    if (angriffUhr <= 0 && adler.beiZiel(tol)) {
      const a = cfg.kacke.abstand;
      angriffUhr = a.min + Math.random() * (a.max - a.min);
      zielBeiStart = adler._zielX;
      adler.angreifen();
    }
  }
  return { drops, tol };
}

for (const [name, bahnen] of Object.entries({
  hoch: [-1.583, -0.528, 0.528, 1.583],
  quer: [-8.100, -2.700, 2.700, 8.100],
})) {
  const { drops, tol } = lauf(bahnen, 4000);
  const abgesetzt = drops.filter((d) => d.abstandZumAdler > tol);
  const andereBahn = drops.filter((d) => d.zielBeiStart !== null && Math.abs(d.lane - d.zielBeiStart) > 1e-6);
  const maxAb = Math.max(...drops.map((d) => d.abstandZumAdler));
  const verteilung = bahnen.map((b) => drops.filter((d) => Math.abs(d.lane - b) < 1e-6).length);
  console.log(
    `${name}: ${drops.length} Abwuerfe, Toleranz ${tol.toFixed(2)}\n` +
    `   Kacke weiter als die Toleranz vom Adler entfernt: ${abgesetzt.length} (${((abgesetzt.length / drops.length) * 100).toFixed(1)} %), groesster Versatz ${maxAb.toFixed(2)} Einheiten\n` +
    `   auf einer ANDEREN Bahn als der beim Angriffsstart angepeilten: ${andereBahn.length} (${((andereBahn.length / drops.length) * 100).toFixed(1)} %)\n` +
    `   Verteilung je Bahn: ${verteilung.join(' / ')}`,
  );
}
