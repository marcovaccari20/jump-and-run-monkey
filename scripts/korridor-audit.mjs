/**
 * TEMPORAER — Angriff auf das Zeitfenster in Spawner._freieStelle.
 *
 * Misst je Objekt:
 *   - das beim Abwurf benutzte Fenster [tEin, tAus] und die Korridor-Spanne
 *   - die TATSAECHLICHE Zeit, in der es das Bewegungsband durchquert
 *   - ob der Korridor waehrend dieser Zeit wirklich in der Spanne lag
 *   - ob das Objekt der Bahn je naeher kam als versprochen
 *   - ob tAus ueber den bekannten Korridor-Horizont hinausreicht
 */
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { Rock } from '../src/entities/Rock.js';
import { halfWidthAt } from '../src/core/viewport.js';

function arg(name, fb) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fb;
  const v = process.argv[i + 1];
  return Number.isNaN(Number(v)) ? v : Number(v);
}
const LAEUFE = arg('laeufe', 12);
const SEKUNDEN = arg('sekunden', 480);
const DT = arg('dt', 1 / 60);
const MODUS = String(arg('modus', 'flip')); // w | s | keine | flip
const AFFE = String(arg('affe', 'alle'));
const FORMAT = String(arg('format', 'beide'));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spielfeld(aspect, hitRadius) {
  const cam = CONFIG.render.camera;
  const camera = new PerspectiveCamera(cam.fov, aspect, cam.near, cam.far);
  camera.position.set(...cam.position);
  camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const base = CONFIG.world;
  const half = halfWidthAt(camera, 0, base.bounds.maxY);
  const limit = Math.max(0.9, half - hitRadius * 1.6);
  return {
    ...base,
    bounds: {
      minX: Math.max(base.bounds.minX, -limit),
      maxX: Math.min(base.bounds.maxX, limit),
      minY: base.bounds.minY,
      maxY: base.bounds.maxY,
    },
    spawnHalfWidth: Math.min(base.spawnHalfWidth, limit + 0.4),
  };
}

function stufeBei(s) {
  const stages = CONFIG.wall.stages;
  let idx = 0;
  for (let i = 0; i < stages.length; i++) if (s >= stages[i].afterSeconds) idx = i;
  const letzte = stages[stages.length - 1];
  if (s >= letzte.afterSeconds) {
    const extra = Math.floor((s - letzte.afterSeconds) / CONFIG.wall.stageLoopSeconds);
    idx = (stages.length - 1 + extra) % stages.length;
  }
  return stages[idx];
}

/* --------------------------------------------------------- Mengenrechnung */
function ordnen(m) {
  if (!m.length) return m;
  m.sort((p, q) => p[0] - q[0]);
  const out = [m[0]];
  for (let i = 1; i < m.length; i++) {
    const l = out[out.length - 1];
    if (m[i][0] <= l[1] + 1e-9) {
      if (m[i][1] > l[1]) l[1] = m[i][1];
    } else out.push(m[i]);
  }
  return out;
}
function aufweiten(m, d, lo, hi) {
  const out = [];
  for (const [a, b] of m) {
    const na = Math.max(lo, a - d);
    const nb = Math.min(hi, b + d);
    if (nb > na - 1e-9) out.push([na, nb]);
  }
  return ordnen(out);
}
function abziehen(m, verboten) {
  let akt = m;
  for (const [va, vb] of verboten) {
    const nx = [];
    for (const [a, b] of akt) {
      if (vb <= a || va >= b) {
        nx.push([a, b]);
        continue;
      }
      if (va > a) nx.push([a, Math.min(va, b)]);
      if (vb < b) nx.push([Math.max(vb, a), b]);
    }
    akt = nx;
  }
  return akt.filter(([a, b]) => b - a > 1e-9);
}
const breiteste = (m) => m.reduce((x, [a, b]) => Math.max(x, b - a), 0);

/* ------------------------------------------------------------------ Lauf */
const befunde = {
  fensterZuFrueh: 0, // Objekt war GEFAEHRLICH vor jetzt+tEin
  fensterZuSpaet: 0, // ... noch gefaehrlich nach jetzt+tAus
  maxFrueh: 0,
  maxSpaet: 0,
  spanneVerfehlt: 0, // Korridor lag waehrend der Gefahr AUSSERHALB der Spanne
  maxSpanneVerfehlt: 0,
  korridorVerletzt: 0, // Objekt naeher an der Bahn als versprochen
  maxEindringen: 0,
  ueberHorizont: 0, // tAus reicht ueber den bekannten Streckenzug hinaus
  maxUeberHorizont: 0,
  minLuft: Infinity, // kleinster Abstand (Objektrand zu Korridorband)
  treffer: 0, // Korridor-Folger wurde getroffen
  minBandFrei: Infinity, // schmalste freie Stelle INNERHALB der zugesicherten Bahn
  minBandInfo: null,
  bandZu: 0, // Frames, in denen die zugesicherte Bahn komplett zu war
  echterTreffer: 0, // Spieler AUF der zugesicherten Bahn steckt im Objekt
  maxTiefe: 0,
  treffInfo: null,
  bsp: [],
};

function lauf({ seed, affe, aspect }) {
  const echt = Math.random;
  const rand = rng(seed);
  Math.random = rand;
  try {
    const charCfg = CONFIG.characters.list[affe];
    const pCfg = { ...CONFIG.player, ...charCfg.player };
    const hitRadius = pCfg.hitRadius;
    const ignoreR = charCfg.ignoreRockRadius ?? 0;
    const world = spielfeld(aspect, hitRadius);
    const difficulty = new DifficultyCurve(CONFIG.difficulty);
    difficulty.setRockMix(CONFIG.rock.mix);
    const spawner = new Spawner({ add() {} }, CONFIG, difficulty, world, null);
    spawner.bananasEnabled = false;
    spawner.setSpieler(pCfg);
    spawner.reset();

    const k = CONFIG.rock.korridor;

    /* --- Fenster mitschreiben ---------------------------------------- */
    let pending = null;
    const orig = spawner._freieStelle.bind(spawner);
    spawner._freieStelle = (type, hr) => {
      const look = CONFIG.rock.looks[spawner.hazardLook] ?? CONFIG.rock.looks.stein;
      const slot = CONFIG.rock.types.indexOf(type);
      const i = slot < 0 ? 0 : slot;
      const fall = (type.fallFactor ?? 1) * (look.fallMulSlots?.[i] ?? look.fallMul ?? 1);
      const basis = difficulty.scrollSpeed;
      const eigen = difficulty.rockFallSpeed;
      const sp = spawner.spieler;
      const vSchnell = (eigen + basis + sp.climbAssist) * fall;
      const vLangsam = (eigen + basis * sp.minScrollFactor) * fall;
      const randR = sp.hitRadius + hr;
      const tEin = Math.max(0, (world.spawnY - (world.bounds.maxY + randR)) / vSchnell - k.zeitReserve);
      const tAus = (world.spawnY - (world.bounds.minY - randR)) / vLangsam + k.zeitReserve;
      const jetzt = spawner.korridor.jetzt;
      const s = spawner.korridor.spanne(jetzt + tEin, jetzt + tAus, { min: 0, max: 0 });
      pending = {
        t0: jetzt,
        tEin,
        tAus,
        sMin: s.min,
        sMax: s.max,
        randR,
        abstand: k.halbbreite + randR + k.reserve,
        horizont: spawner.korridor.letzteZeit - jetzt,
      };
      const x = orig(type, hr);
      if (x === null) pending = null;
      return x;
    };

    const origSpawn = Rock.prototype.spawn;
    const JITTER = arg('jitter', 1);
    Rock.prototype.spawn = function (...a) {
      origSpawn.apply(this, a);
      // Gegenprobe: Hoehenstreuung aushebeln — dann startet das Objekt genau
      // dort, wo _freieStelle es annimmt (world.spawnY).
      // JITTER skaliert die Hoehenstreuung (1 = wie ausgeliefert, 0 = aus).
      if (JITTER !== 1) {
        this.y = world.spawnY + (this.y - world.spawnY) * JITTER;
        this.mesh.position.y = this.y;
      }
      this._rec = pending;
      pending = null;
    };

    let S = [[0, 0]];
    let engste = Infinity;
    let engsteZeit = 0;
    let leer = null;
    const py = pCfg.startPosition[1];
    const schritt = pCfg.moveSpeed * 0.75 * DT;
    // Korridor-Folger: sitzt exakt auf der Bahn (das ist, was garantiert wird)
    let folgerTot = 0;
    let achse = 1;
    const frames = Math.round(SEKUNDEN / DT);

    for (let f = 0; f < frames; f++) {
      difficulty.update(DT);
      const t = difficulty.elapsed;
      if (MODUS === 'flip') {
        if (rand() < 0.06) achse = rand() < 0.5 ? 1 : -1;
      } else achse = MODUS === 'w' ? 1 : MODUS === 's' ? -1 : 0;
      const base = difficulty.scrollSpeed;
      const scroll = Math.max(base + achse * pCfg.climbAssist, base * pCfg.minScrollFactor);
      spawner.hazardLook = stufeBei(t).hazard;

      S = aufweiten(S, schritt, world.bounds.minX, world.bounds.maxX);
      spawner.update(DT, false, scroll);

      const jetzt = spawner.korridor.jetzt;
      const kx = spawner.korridor.bei(jetzt);
      const verboten = [];

      for (const r of spawner.rocks.active) {
        if (!r.active) continue;
        const randR = hitRadius + r.hitRadius;
        const obenY = world.bounds.maxY + randR;
        const untenY = world.bounds.minY - randR;
        const rec = r._rec;
        if (rec && r.y <= obenY && r.y >= untenY) {
          const rel = jetzt - rec.t0;
          if (rel < rec.tEin - 1e-9) {
            befunde.fensterZuFrueh++;
            befunde.maxFrueh = Math.max(befunde.maxFrueh, rec.tEin - rel);
          }
          if (rel > rec.tAus + 1e-9) {
            befunde.fensterZuSpaet++;
            befunde.maxSpaet = Math.max(befunde.maxSpaet, rel - rec.tAus);
          }
          const ausserhalb = Math.max(rec.sMin - kx, kx - rec.sMax);
          if (ausserhalb > 1e-9) {
            befunde.spanneVerfehlt++;
            if (ausserhalb > befunde.maxSpanneVerfehlt) {
              befunde.maxSpanneVerfehlt = ausserhalb;
              if (befunde.bsp.length < 5)
                befunde.bsp.push({ t: +t.toFixed(2), affe, seed, um: +ausserhalb.toFixed(3), rel: +rel.toFixed(2), rec });
            }
          }
          // Versprechen: |x - Bahn| >= halbbreite + beide Radien + reserve
          const luft = Math.abs(r.x - kx) - rec.abstand;
          if (luft < befunde.minLuft) {
            befunde.minLuft = luft;
            befunde.luftInfo = {
              t: +t.toFixed(2), affe, seed, format: aspect > 1 ? 'quer' : 'hoch',
              art: r.type.id, objX: +r.x.toFixed(3), objY: +r.y.toFixed(3),
              bahnX: +kx.toFixed(3), abstandSoll: +rec.abstand.toFixed(3),
              abstandIst: +Math.abs(r.x - kx).toFixed(3),
              randR: +randR.toFixed(3), halbbreite: k.halbbreite,
              tAus: +rec.tAus.toFixed(3), rel: +rel.toFixed(3),
              ueberfaellig: +(rel - rec.tAus).toFixed(3),
              spanne: [+rec.sMin.toFixed(3), +rec.sMax.toFixed(3)],
              minY: world.bounds.minY,
            };
          }
          if (luft < -1e-9) {
            befunde.korridorVerletzt++;
            befunde.maxEindringen = Math.max(befunde.maxEindringen, -luft);
          }
          /* EXAKTER 2D-TEST: Ein Spieler, der auf der zugesicherten Bahn
           * steht (irgendwo in [kx-halbbreite, kx+halbbreite]) und auf einer
           * ERLAUBTEN Hoehe [minY, maxY] — steckt er im Objekt? */
          const pxNah = Math.min(kx + k.halbbreite, Math.max(kx - k.halbbreite, r.x));
          const pyNah = Math.min(world.bounds.maxY, Math.max(world.bounds.minY, r.y));
          const ddx = r.x - pxNah;
          const ddy = r.y - pyNah;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist < randR) {
            befunde.echterTreffer++;
            const tief = randR - dist;
            if (tief > befunde.maxTiefe) {
              befunde.maxTiefe = tief;
              befunde.treffInfo = {
                t: +t.toFixed(2), affe, seed, format: aspect > 1 ? 'quer' : 'hoch',
                objX: +r.x.toFixed(3), objY: +r.y.toFixed(3), art: r.type.id,
                bahnX: +kx.toFixed(3), spielerX: +pxNah.toFixed(3), spielerY: +pyNah.toFixed(3),
                abstandSoll: +rec.abstand.toFixed(3), abstandIst: +Math.abs(r.x - kx).toFixed(3),
                relZeit: +rel.toFixed(3), tAus: +rec.tAus.toFixed(3),
                ueberfaellig: +(rel - rec.tAus).toFixed(3),
              };
            }
          }
          if (rec.tAus > rec.horizont) {
            befunde.ueberHorizont++;
            befunde.maxUeberHorizont = Math.max(befunde.maxUeberHorizont, rec.tAus - rec.horizont);
          }
        }
        if (r.radius <= ignoreR) continue;
        const R = hitRadius + r.hitRadius;
        const dy = py - r.y;
        const rest = R * R - dy * dy;
        if (rest <= 0) continue;
        const halb = Math.sqrt(rest);
        verboten.push([r.x - halb, r.x + halb]);
        // Korridor-Folger auf Spielerhoehe
        const fx = Math.min(world.bounds.maxX, Math.max(world.bounds.minX, kx));
        if (Math.abs(fx - r.x) < halb) folgerTot++;
      }

      // Ist die ZUGESICHERTE Bahn selbst noch frei? [kx-halbbreite, kx+halbbreite]
      if (t > 2) {
        const band = abziehen([[kx - k.halbbreite, kx + k.halbbreite]], verboten);
        const frei = band.reduce((s2, [a, b2]) => s2 + (b2 - a), 0);
        if (frei < befunde.minBandFrei) {
          befunde.minBandFrei = frei;
          befunde.minBandInfo = { t: +t.toFixed(2), affe, seed, kx: +kx.toFixed(2) };
        }
        if (frei <= 1e-9) befunde.bandZu++;
      }

      S = abziehen(S, verboten);
      const b = breiteste(S);
      if (t > 4 && b < engste) {
        engste = b;
        engsteZeit = t;
      }
      if (S.length === 0 && !leer) leer = { t, stufe: stufeBei(t).name };
    }

    Rock.prototype.spawn = origSpawn;
    befunde.treffer += folgerTot;
    return { engste, engsteZeit, leer, folgerTot };
  } finally {
    Math.random = echt;
  }
}

const AFFEN = AFFE === 'alle' ? Object.keys(CONFIG.characters.list) : [AFFE];
const FORMATE = { quer: 16 / 9, hoch: 9 / 19.5 };
const formate = FORMAT === 'beide' ? Object.entries(FORMATE) : [[FORMAT, FORMATE[FORMAT]]];

console.log(`Audit — Modus "${MODUS}", dt ${DT}, ${LAEUFE} Laeufe a ${SEKUNDEN}s\n`);
let leerCount = 0;
let globalEngste = Infinity;
for (const affe of AFFEN) {
  for (const [fn, aspect] of formate) {
    let e = Infinity;
    let ez = 0;
    for (let i = 0; i < LAEUFE; i++) {
      const r = lauf({ seed: 1000 + i * 7919, affe, aspect });
      if (r.leer) leerCount++;
      if (r.engste < e) {
        e = r.engste;
        ez = r.engsteZeit;
      }
    }
    if (e < globalEngste) globalEngste = e;
    console.log(`  ${affe.padEnd(7)} ${fn.padEnd(5)} engster Spielraum ${e.toFixed(3)} bei ${ez.toFixed(0)}s`);
  }
}

console.log('\n--- Zeitfenster-Befunde ---');
console.log(JSON.stringify(befunde, null, 2));
console.log(`\nRestmenge leer in ${leerCount} Laeufen. Global engster Spielraum ${globalEngste.toFixed(3)}.`);
