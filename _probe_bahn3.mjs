/* Genau der behauptete Ausloeser: 390x844, brauner Affe, Spaetspiel-Mischung
 * ab Wand 9. 12 Laeufe je Variante, damit die Unterschiede aus dem Rauschen
 * herauskommen. Zusaetzlich: Wie oft ist bei welcher OBJEKTART wie viel frei?
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { DifficultyCurve } from './src/systems/DifficultyCurve.js';
import { Spawner } from './src/systems/Spawner.js';
import { halfWidthAt } from './src/core/viewport.js';

const BILD = 407 / 725;
function spielfeld(aspect, pCfg) {
  const cam = CONFIG.render.camera;
  const c = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  c.position.set(...cam.position); c.lookAt(...cam.lookAt);
  c.updateMatrixWorld(true); c.updateProjectionMatrix(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
  const limit = Math.max(0.9, halfWidthAt(c, 0, pCfg.startPosition[1]) - (pCfg.spriteHeight * BILD) / 2);
  const b = CONFIG.world; const maxX = Math.min(b.bounds.maxX, limit);
  return { ...b, bounds: { minX: -maxX, maxX, minY: b.bounds.minY, maxY: b.bounds.maxY },
    bahnX: b.bahnen.map((a) => a * maxX), spawnHalfWidth: Math.min(b.spawnHalfWidth, limit + 0.8) };
}
function stufeBei(s) {
  const st = CONFIG.wall.stages; let i2 = 0;
  for (let i = 0; i < st.length; i++) if (s >= st[i].afterSeconds) i2 = i;
  const l = st[st.length - 1];
  if (s >= l.afterSeconds) i2 = (st.length - 1 + Math.floor((s - l.afterSeconds) / CONFIG.wall.stageLoopSeconds)) % st.length;
  return st[i2];
}
const DT = 1 / 60, ASPECT = 390 / 844;

function lauf(variante, sekunden, startWand, sammle) {
  const pCfg = { ...CONFIG.player, ...CONFIG.characters.list.braun.player };
  const world = spielfeld(ASPECT, pCfg);
  const d = new DifficultyCurve(CONFIG.difficulty); d.setRockMix(CONFIG.rock.mix);
  const sp = new Spawner({ add() {} }, CONFIG, d, world, null);
  sp.bananasEnabled = false; sp.setSpieler(pCfg); sp.reset();
  while (d.wand < startWand) d.update(DT);
  sp.reset();

  const gefallen = new Array(4).fill(0);
  let typ = null;
  const zaehle = (frei, alle) => {
    if (!sp._bahnZaehler || sp._bahnZaehler.length !== alle.length) sp._bahnZaehler = new Array(alle.length).fill(0);
    let s = 0; const g = frei.map((x) => { const i = alle.indexOf(x); const w = 1 / ((i >= 0 ? sp._bahnZaehler[i] : 0) + 1); s += w; return w; });
    let r = Math.random() * s, t = frei.length - 1;
    for (let i = 0; i < g.length; i++) { r -= g[i]; if (r <= 0) { t = i; break; } }
    return frei[t];
  };
  sp._bahnWaehlen = (frei, alle) => {
    sammle.proArt[typ.id] ??= { 1: 0, 2: 0, 3: 0, 4: 0 };
    sammle.proArt[typ.id][frei.length]++;
    let x;
    if (variante === 'B') return frei[Math.floor(Math.random() * frei.length)];
    if (variante === 'A' && frei.length === 1) return frei[0];
    if (!sp._bahnZaehler || sp._bahnZaehler.length !== alle.length) sp._bahnZaehler = new Array(alle.length).fill(0);
    x = frei.length === 1 ? frei[0] : zaehle(frei, alle);
    const i = alle.indexOf(x); if (i >= 0) sp._bahnZaehler[i]++;
    return x;
  };
  const echt = sp._freieStelle.bind(sp);
  sp._freieStelle = (t, hr) => { typ = t; const x = echt(t, hr);
    if (x !== null) { const i = world.bahnX.findIndex((v) => Math.abs(v - x) < 1e-9); if (i >= 0) gefallen[i]++; } return x; };

  for (let f = 0; f < Math.round(sekunden / DT); f++) { d.update(DT); sp.hazardLook = stufeBei(d.elapsed).hazard; sp.update(DT, false, d.scrollSpeed); }
  return { gefallen, zaehler: sp._bahnZaehler ? [...sp._bahnZaehler] : [0, 0, 0, 0] };
}

const LAEUFE = 12;
console.log('### 390x844, brauner Affe, ab Wand 9, je 12 x 600 s ###\n');
for (const v of ['A', 'B', 'C']) {
  const sammle = { proArt: {} };
  const ges = [0, 0, 0, 0]; const zae = [0, 0, 0, 0];
  for (let k = 0; k < LAEUFE; k++) {
    const r = lauf(v, 600, 9, sammle);
    r.gefallen.forEach((x, i) => (ges[i] += x)); r.zaehler.forEach((x, i) => (zae[i] += x));
  }
  const n = ges.reduce((a, b) => a + b, 0);
  const p = ges.map((x) => 100 * x / n);
  const se = Math.sqrt(0.25 * 0.75 / n) * 100;
  console.log(`${v}: ${p.map((x) => x.toFixed(2) + '%').join(' / ')}  (n=${n}, 1 SE ~ ${se.toFixed(2)} Pkt)  innen gesamt ${(p[1] + p[2]).toFixed(2)}%  Zaehler-Endstand (Summe 12 Laeufe) [${zae.join(', ')}]`);
  if (v === 'A') {
    console.log('   frei.length je Objektart (12 Laeufe):');
    for (const [id, m] of Object.entries(sammle.proArt)) {
      const t = m[1] + m[2] + m[3] + m[4];
      console.log(`     ${id.padEnd(7)} n=${String(t).padStart(6)}  frei=1: ${(100 * m[1] / t).toFixed(1)}%  frei=2: ${(100 * m[2] / t).toFixed(1)}%  frei=3: ${(100 * m[3] / t).toFixed(1)}%`);
    }
  }
}
