/* Prüft die Behauptung zu Spawner._bahnWaehlen:
 * "frei.length === 1 ist im Hochformat der Normalfall, deshalb bleibt
 *  _bahnZaehler nahe [0,0,0,0] und die gewichtete Wahl ist faktisch
 *  gleichverteilt."
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from './src/config.js';
import { DifficultyCurve } from './src/systems/DifficultyCurve.js';
import { Spawner } from './src/systems/Spawner.js';
import { halfWidthAt } from './src/core/viewport.js';

const BILD = { braun: 407 / 725, weiss: 454 / 864, orange: 538 / 889 };

function spielfeld(aspect, pCfg, charId) {
  const cam = CONFIG.render.camera;
  const c = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  c.position.set(...cam.position);
  c.lookAt(...cam.lookAt);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  c.matrixWorldInverse.copy(c.matrixWorld).invert();
  const half = halfWidthAt(c, 0, pCfg.startPosition[1]);
  const limit = Math.max(0.9, half - (pCfg.spriteHeight * BILD[charId]) / 2);
  const b = CONFIG.world;
  const maxX = Math.min(b.bounds.maxX, limit);
  return {
    ...b,
    bounds: { minX: -maxX, maxX, minY: b.bounds.minY, maxY: b.bounds.maxY },
    bahnX: b.bahnen.map((a) => a * maxX),
    spawnHalfWidth: Math.min(b.spawnHalfWidth, limit + 0.8),
  };
}

function stufeBei(s) {
  const st = CONFIG.wall.stages;
  let i2 = 0;
  for (let i = 0; i < st.length; i++) if (s >= st[i].afterSeconds) i2 = i;
  const l = st[st.length - 1];
  if (s >= l.afterSeconds)
    i2 = (st.length - 1 + Math.floor((s - l.afterSeconds) / CONFIG.wall.stageLoopSeconds)) % st.length;
  return st[i2];
}

const DT = 1 / 60;

function lauf({ charId, aspect, sekunden, startWand = 0, name }) {
  const pCfg = { ...CONFIG.player, ...CONFIG.characters.list[charId].player };
  const world = spielfeld(aspect, pCfg, charId);
  const d = new DifficultyCurve(CONFIG.difficulty);
  d.setRockMix(CONFIG.rock.mix);
  const sp = new Spawner({ add() {} }, CONFIG, d, world, null);
  sp.bananasEnabled = false;
  sp.setSpieler(pCfg);
  sp.reset();

  // Auf die gewünschte Wand vorspulen (ohne Spawns).
  let vorlauf = 0;
  while (d.wand < startWand && vorlauf < 60 * 60 * 60) {
    d.update(DT);
    vorlauf++;
  }
  sp.reset();

  const stats = {
    aufrufe: 0, frei1: 0, frei2: 0, frei3: 0, frei4: 0,
    keinPlatz: 0, versuche: 0,
    proTyp: {},
    freiBeiGross: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
    zaehlerVerlauf: [],
  };
  const bahnGefallen = new Array(world.bahnX.length).fill(0);
  const bahnErzwungen = new Array(world.bahnX.length).fill(0);

  const echtFrei = sp._freieStelle.bind(sp);
  let letzterTyp = null;
  sp._freieStelle = (t, hr) => {
    stats.versuche++;
    letzterTyp = t;
    const x = echtFrei(t, hr);
    if (x === null) stats.keinPlatz++;
    else {
      const i = world.bahnX.findIndex((v) => Math.abs(v - x) < 1e-9);
      if (i >= 0) bahnGefallen[i]++;
      stats.proTyp[t.id] = (stats.proTyp[t.id] ?? 0) + 1;
    }
    return x;
  };

  const echtWaehlen = sp._bahnWaehlen.bind(sp);
  sp._bahnWaehlen = (frei, alle) => {
    stats.aufrufe++;
    stats['frei' + frei.length]++;
    if (letzterTyp?.id === 'gross') stats.freiBeiGross[frei.length]++;
    const x = echtWaehlen(frei, alle);
    if (frei.length === 1) {
      const i = alle.findIndex((v) => Math.abs(v - x) < 1e-9);
      if (i >= 0) bahnErzwungen[i]++;
    }
    return x;
  };

  const N = Math.round(sekunden / DT);
  for (let f = 0; f < N; f++) {
    d.update(DT);
    sp.hazardLook = stufeBei(d.elapsed).hazard;
    sp.update(DT, false, d.scrollSpeed);
    if (f % Math.round(N / 6) === 0) stats.zaehlerVerlauf.push([...(sp._bahnZaehler ?? [])]);
  }
  stats.zaehlerVerlauf.push([...(sp._bahnZaehler ?? [])]);

  const abst = world.bahnX[1] - world.bahnX[0];
  const rand = pCfg.hitRadius;
  const grossHr = CONFIG.rock.types[2].radius * CONFIG.rock.hitRadiusFactor;
  const mind = rand + grossHr + CONFIG.rock.korridor.reserve;
  const gefallen = bahnGefallen.reduce((a, b) => a + b, 0);

  console.log(`\n===== ${name} (${charId}, aspect ${aspect.toFixed(4)}, Wand-Start ${startWand}, ${sekunden}s) =====`);
  console.log(`  Halbfeld=${world.bounds.maxX.toFixed(4)}  bahnX=[${world.bahnX.map((v) => v.toFixed(3)).join(', ')}]`);
  console.log(`  Bahnabstand=${abst.toFixed(4)}   mindestAbstand(gross)=${mind.toFixed(4)}  -> Verhaeltnis m/d=${(mind / abst).toFixed(3)}`);
  console.log(`  Wand am Ende=${d.wand.toFixed(1)}   Typen=${JSON.stringify(stats.proTyp)}`);
  console.log(`  _freieStelle: ${stats.versuche} Versuche, ${stats.keinPlatz} ohne Platz (${(100 * stats.keinPlatz / stats.versuche).toFixed(1)}%)`);
  console.log(`  _bahnWaehlen: ${stats.aufrufe} Aufrufe -> frei=1: ${stats.frei1} (${(100 * stats.frei1 / stats.aufrufe).toFixed(1)}%), frei=2: ${stats.frei2} (${(100 * stats.frei2 / stats.aufrufe).toFixed(1)}%), frei=3: ${stats.frei3}, frei=4: ${stats.frei4}`);
  console.log(`  davon bei Typ 'gross': ${JSON.stringify(stats.freiBeiGross)}`);
  console.log(`  _bahnZaehler Verlauf: ${stats.zaehlerVerlauf.map((z) => '[' + z.join(',') + ']').join(' ')}`);
  console.log(`  Objekte je Bahn: ${bahnGefallen.map((v) => (100 * v / gefallen).toFixed(1) + '%').join(' / ')}   (n=${gefallen})`);
  console.log(`  davon erzwungen (frei=1): ${bahnErzwungen.join(' / ')}`);
  return { stats, bahnGefallen, world };
}

lauf({ name: 'Hochformat 390x844 SPAETSPIEL', charId: 'braun', aspect: 390 / 844, sekunden: 600, startWand: 9 });
lauf({ name: 'Hochformat 390x844 SPAETSPIEL orange', charId: 'orange', aspect: 390 / 844, sekunden: 600, startWand: 9 });
lauf({ name: 'Hochformat 390x844 ab Start', charId: 'braun', aspect: 390 / 844, sekunden: 600, startWand: 0 });
lauf({ name: 'Querformat 16:9 SPAETSPIEL', charId: 'braun', aspect: 16 / 9, sekunden: 600, startWand: 9 });
