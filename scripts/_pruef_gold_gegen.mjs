/**
 * _pruef_gold_gegen.mjs — GEGENPRÜFUNG zum Prüfbericht "Gold-Gebiet".
 *
 * Nichts am Spielcode geändert; alles hier ist Messung.
 *
 * TEIL 1 (node): Arithmetik aus der Config.
 * TEIL 2 (Browser-Harness, String HARNESS): in die Konsole der laufenden
 *   Seite werfen. Die Vorschau-Pane führt kein rAF aus — deshalb wird
 *   _updatePlaying(1/60) selbst getaktet.
 *
 *   GEZÄHLT WIRD DIE SPAWN-METHODE, nie das Objekt: Münzen, Steine,
 *   Bananen und Powerups sind gepoolt.
 */
import { CONFIG } from '../src/config.js';

const g = CONFIG.goldbanane;
const normal = CONFIG.difficulty.sekundenProWand / Math.max(1, CONFIG.coin.proGebiet);
console.log('normalTakt        %s s', normal.toFixed(4));
console.log('goldTakt          %s s', g.muenzTakt);
console.log('Verhaeltnis       %s', (normal / g.muenzTakt).toFixed(4));
console.log('coinTimer-Start   0.35 s (Spawner.goldrauschSetzen)');
const erste = 0.35;
let n = 0;
for (let t = erste; t <= g.sekunden + 1e-9; t += g.muenzTakt) n++;
console.log('Muenzen in %s s   %d  (exakt, erste bei %s)', g.sekunden, n, erste);
console.log('Gutschrift        %d x %d = %d', n, g.muenzFaktor, n * g.muenzFaktor);
console.log('Normal 30 s       %s Muenzen -> %s Gutschrift',
  (g.sekunden / normal).toFixed(2), (g.sekunden / normal).toFixed(2));
console.log('Bahnen            %s', JSON.stringify(CONFIG.world.bahnen));
console.log('Sturzflug/Gebiet  %s', JSON.stringify(CONFIG.sturzflug.proGebiet));
console.log('Wandstufen        %s', CONFIG.wall.stages.map((s) => `${s.name}@${s.afterSeconds}`).join(' '));

export const HARNESS = String.raw`
(() => {
const g = window.__game, sp = g.spawner;
if (window.__P) { window.__P.deinstall(); }
const P = window.__P = { t:0, log:{coin:[],rock:[],ban:[],pw:[],sturz:[],treffer:[],bosswurf:[]} };
const T = () => +P.t.toFixed(4);

// --- Spawn-METHODEN mitschreiben (Pooling!) -------------------------------
const o = {};
o.spawnCoin = sp._spawnCoin;
sp._spawnCoin = function(){ const vor = sp.coins.activeCount; o.spawnCoin.call(sp);
  const c = sp.coins.active[sp.coins.active.length-1];
  P.log.coin.push({t:T(), mx: sp.coins.activeCount>vor ? +c._mitteX.toFixed(3) : null,
                   gold: sp.nurMuenzen, gr: sp.goldrausch, nA: sp.nachschubAus, leer: sp.coins.activeCount<=vor}); };
o.spawnRock = sp._spawnRock;
if (o.spawnRock) sp._spawnRock = function(...a){ P.log.rock.push({t:T(), gold:sp.nurMuenzen}); return o.spawnRock.apply(sp,a); };
o.rockAcq = sp.rocks.acquire.bind(sp.rocks);
sp.rocks.acquire = function(){ const r = o.rockAcq(); if (r) P.log.rock.push({t:T(), gold:sp.nurMuenzen}); return r; };
o.spawnBanana = sp._spawnBanana;
sp._spawnBanana = function(...a){ P.log.ban.push({t:T(), gold:sp.nurMuenzen}); return o.spawnBanana.apply(sp,a); };
o.pw = sp.powerupWerfen;
sp.powerupWerfen = function(art){ const r = o.pw.call(sp,art); P.log.pw.push({t:T(), art, ok:r, gebiet:g._gebietWechsel+1}); return r; };
o.sturzStart = g.sturzflugStarten;
g.sturzflugStarten = function(...a){ P.log.sturz.push({t:T(), goldRest:+g._goldRest.toFixed(2), sonder:g.wall.inSonderStufe}); return o.sturzStart.apply(g,a); };
o.rockHit = g._onRockHit;
g._onRockHit = function(...a){ P.log.treffer.push({t:T(), goldRest:+g._goldRest.toFixed(2), sonder:g.wall.inSonderStufe,
   sturz:!!g.sturzflug?.aktiv, boss:!!g.bossKampf?.aktiv}); return o.rockHit.apply(g,a); };

P.deinstall = () => { sp._spawnCoin=o.spawnCoin; if(o.spawnRock) sp._spawnRock=o.spawnRock;
  sp.rocks.acquire=o.rockAcq; sp._spawnBanana=o.spawnBanana; sp.powerupWerfen=o.pw;
  g.sturzflugStarten=o.sturzStart; g._onRockHit=o.rockHit; delete window.__P; };

P.reset = () => { for (const k in P.log) P.log[k].length = 0; };
P.step = (frames, opt) => { const dt = 1/60; opt = opt||{};
  for (let i=0;i<frames;i++){
    if (opt.sammeln) {  // "perfekter Sammler": auf die Bahn der untersten Muenze
      let best=null; for (const c of sp.coins.active) if (c.active && (!best || c.y<best.y)) best=c;
      if (best) { const bx=g.worldView.bahnX; let bi=0;
        for (let j=1;j<bx.length;j++) if (Math.abs(bx[j]-best._mitteX)<Math.abs(bx[bi]-best._mitteX)) bi=j;
        g.player.zielBahn = bi; g.player.x = bx[bi]; }
    }
    g._updatePlaying(dt); P.t += dt;
  } return T(); };
P.gold = () => { g._goldmodusStarten(); };
P.z = () => ({ t:T(), goldRest:+g._goldRest.toFixed(2), stage:g.wall.stageName, idx:g.wall.stageIndex,
  sonder:g.wall.inSonderStufe, wechsel:g._gebietWechsel, letztes:g._letztesGebiet,
  elapsed:+g.difficulty.elapsed.toFixed(2), muenzen:g._muenzenImLauf,
  nurM:sp.nurMuenzen, gr:sp.goldrausch, nA:sp.nachschubAus, takt:sp.muenzTakt,
  sturzUhr:+(g._sturzUhr??0).toFixed(2), sturzAktiv:!!g.sturzflug?.aktiv, sturzImGebiet:g._sturzImGebiet,
  bossAktiv:!!g.bossKampf?.aktiv, hudBild:g.ui._naechstesBild ?? null });
P.neu = () => { g._startRun(); P.t = 0; P.reset(); };
return 'installiert';
})()
`;
