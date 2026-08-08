import { CONFIG } from '../src/config.js';
import { Adler } from '../src/entities/Adler.js';

const fakeTex = () => ({ image: { width: 1200, height: 900 } });
const flug = Array.from({ length: 10 }, fakeTex);
const kacken = Array.from({ length: 14 }, fakeTex);
const naechste = (x, b) => b.reduce((a, c) => (Math.abs(c - x) < Math.abs(a - x) ? c : a), b[0]);

function lauf(bahnen, sekunden) {
  const cfg = CONFIG.boss;
  const adler = new Adler(flug, kacken, cfg);
  adler.reset();
  const minX = bahnen[0], maxX = bahnen[bahnen.length - 1];
  const tol = Math.abs(bahnen[1] - bahnen[0]) / 3;
  let uhr = cfg.kacke.abstand.min;
  const dt = 1 / 60;
  let zielBeiStart = null;
  const istLanden = new Map(bahnen.map((b) => [b, 0]));
  const sollLanden = new Map(bahnen.map((b) => [b, 0]));
  let n = 0;
  for (let f = 0; f < sekunden / dt; f++) {
    const e = adler.update(dt, minX, maxX, bahnen);
    if (e === 'kacke') {
      n++;
      const l = naechste(adler.x, bahnen);
      istLanden.set(l, istLanden.get(l) + 1);
      if (zielBeiStart !== null) {
        const s = naechste(zielBeiStart, bahnen);
        sollLanden.set(s, sollLanden.get(s) + 1);
      }
    }
    uhr -= dt;
    if (uhr <= 0 && adler.beiZiel(tol)) {
      const a = cfg.kacke.abstand;
      uhr = a.min + Math.random() * (a.max - a.min);
      zielBeiStart = adler._zielX;
      adler.angreifen();
    }
  }
  const pct = (m) => bahnen.map((b) => ((m.get(b) / n) * 100).toFixed(1) + '%').join(' / ');
  return { n, ist: pct(istLanden), soll: pct(sollLanden) };
}

for (const [name, bahnen] of Object.entries({
  hoch: [-1.583, -0.528, 0.528, 1.583],
  quer: [-8.1, -2.7, 2.7, 8.1],
})) {
  const r = lauf(bahnen, 12000);
  console.log(`${name} (${r.n} Abwuerfe)`);
  console.log(`   wo die Kacke WIRKLICH landet: ${r.ist}`);
  console.log(`   wo er beim Angriffsstart hinwollte: ${r.soll}`);
}
