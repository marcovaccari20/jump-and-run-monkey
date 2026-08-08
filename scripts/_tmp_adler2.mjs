import { CONFIG } from '../src/config.js';
import { Adler } from '../src/entities/Adler.js';

const fakeTex = () => ({ image: { width: 1200, height: 900 } });
const flug = Array.from({ length: 10 }, fakeTex);
const kacken = Array.from({ length: 14 }, fakeTex);

function lauf(bahnen, sekunden) {
  const cfg = CONFIG.boss;
  const adler = new Adler(flug, kacken, cfg);
  adler.reset();
  const minX = bahnen[0], maxX = bahnen[bahnen.length - 1];
  const dt = 1 / 60;
  let zielwechsel = 0, perFrist = 0, angekommen = 0;
  const angepeilt = new Map(bahnen.map((b) => [b, 0]));
  const erreicht = new Map(bahnen.map((b) => [b, 0]));
  let letztesZiel = adler._zielX;
  let dieseAngekommen = false;
  for (let f = 0; f < sekunden / dt; f++) {
    const vorherZiel = adler._zielX;
    const fristVorher = adler._zielFrist;
    const daVorher = Math.abs(adler._zielX - adler.x) <= 0.12;
    adler.update(dt, minX, maxX, bahnen);
    if (adler._zielX !== vorherZiel) {
      zielwechsel++;
      // per Frist gewechselt, wenn er beim Wechsel NICHT angekommen war
      if (!daVorher) perFrist++;
      else { angekommen++; erreicht.set(vorherZiel, (erreicht.get(vorherZiel) ?? 0) + 1); }
      angepeilt.set(adler._zielX, (angepeilt.get(adler._zielX) ?? 0) + 1);
    }
  }
  return { zielwechsel, perFrist, angekommen, angepeilt, erreicht };
}

for (const [name, bahnen] of Object.entries({
  hoch: [-1.583, -0.528, 0.528, 1.583],
  quer: [-8.100, -2.700, 2.700, 8.100],
})) {
  const r = lauf(bahnen, 4000);
  const p = (m) => bahnen.map((b) => m.get(b) ?? 0).join(' / ');
  console.log(`${name}: ${r.zielwechsel} Zielwechsel — davon ${r.perFrist} (${((r.perFrist / r.zielwechsel) * 100).toFixed(1)} %) durch die 3.5s-Notbremse ABGEBROCHEN, ${r.angekommen} nach echtem Ankommen`);
  console.log(`   angepeilt je Bahn: ${p(r.angepeilt)}`);
  console.log(`   wirklich erreicht: ${p(r.erreicht)}`);
  // Wie lange braucht er ueber die ganze Breite?
  const weg = bahnen[3] - bahnen[0];
  console.log(`   volle Breite ${weg.toFixed(2)} Einheiten / tempo ${CONFIG.boss.adler.tempo} = ${(weg / CONFIG.boss.adler.tempo).toFixed(2)} s (Frist ${3.5} s, plus Anbremsen)`);
}
