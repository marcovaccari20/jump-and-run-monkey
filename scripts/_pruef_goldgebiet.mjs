/**
 * _pruef_goldgebiet.mjs — Messskript zum GOLD-GEBIET (CONFIG.goldbanane).
 *
 * ZWEI TEILE:
 *
 *  1) `node scripts/_pruef_goldgebiet.mjs`
 *     Rechnet den Normaltakt der Münzen aus der Konfiguration nach und hält
 *     ihn gegen `goldbanane.muenzTakt`. Reine Arithmetik, kein Browser.
 *
 *  2) BROWSER-HARNESS (unten als String `HARNESS`).
 *     Die Vorschau-Pane meldet document.hidden = true und führt KEIN
 *     requestAnimationFrame aus — wer dort "das Spiel laufen lässt", misst
 *     nichts. Der Harness holt window.__game und ruft _updatePlaying(1/60)
 *     selbst in einer Schleife auf; ein Lauf wird mit _startRun() gestartet.
 *
 *     Münzen/Steine/Bananen sind GEPOOLT — gezählt wird deshalb die
 *     Spawn-METHODE (_spawnCoin, rocks.acquire, _spawnBanana), nicht das
 *     Objekt. Und: das x der Münze ist NICHT die Bahn (sie pendelt um ihre
 *     Abwurfstelle) — gemessen wird `coin._mitteX`.
 *
 *     Einspielen: den String in die Konsole der laufenden Seite werfen,
 *     danach z. B.
 *         __M.reset(); __M.step(100*60);
 *         __game.spawner.powerupWerfen('gold');
 *         __game._onPowerupHit(__game.spawner.powerups.active[0]);
 *         __M.reset(); __M.t = 0; __M.step(35*60);
 *         __M.log
 */
import { CONFIG } from '../src/config.js';

const g = CONFIG.goldbanane;
const normalTakt = CONFIG.difficulty.sekundenProWand / Math.max(1, CONFIG.coin.proGebiet);
const faktor = normalTakt / g.muenzTakt;
const proGold = g.sekunden / g.muenzTakt;

console.log('Normaltakt   %s s  (%s s je Wand / %s Münzen)', normalTakt.toFixed(3), CONFIG.difficulty.sekundenProWand, CONFIG.coin.proGebiet);
console.log('Goldtakt     %s s', g.muenzTakt);
console.log('Verhältnis   %sx  (gefordert: 5x)', faktor.toFixed(3));
console.log('Gold-Gebiet  %s s -> %s Münzen  x Wert %s = %s Gutschrift',
  g.sekunden, proGold.toFixed(1), g.muenzFaktor, (proGold * g.muenzFaktor).toFixed(0));
console.log('Normales Gebiet: %s Gutschrift', CONFIG.coin.proGebiet);
console.log('Bahnen: %s  (alleBahnen=%s)', JSON.stringify(CONFIG.world.bahnen), g.alleBahnen);
console.log(Math.abs(faktor - 5) < 0.01 ? 'OK  — genau fünffach' : 'ABWEICHUNG vom Fünffachen');

export const HARNESS = `
(() => {
const g = window.__game, sp = g.spawner;
if (window.__M && window.__M._on) return 'schon installiert';
const M = window.__M = { _on:true, t:0, log:{coins:[],rocks:[],bananas:[],powerups:[],sturz:[],boss:[],sonder:[],gebiete:[]}, _lc:null };
const L = M.log, T = () => +M.t.toFixed(3);
const oAcq = sp.coins.acquire.bind(sp.coins);
sp.coins.acquire = function(){ const c = oAcq(); M._lc = c; return c; };
const oc = sp._spawnCoin.bind(sp);
sp._spawnCoin = function(){ M._lc = null; oc();
  L.coins.push(M._lc ? {t:T(), mx:+M._lc._mitteX.toFixed(3), gold:sp.nurMuenzen}
                     : {t:T(), mx:null, gold:sp.nurMuenzen, poolLeer:true}); };
const oRAcq = sp.rocks.acquire.bind(sp.rocks);
sp.rocks.acquire = function(){ const r = oRAcq(); if (r) L.rocks.push({t:T(), gold:sp.nurMuenzen}); return r; };
const ob = sp._spawnBanana.bind(sp);
sp._spawnBanana = function(x,y){ L.bananas.push({t:T(), gold:sp.nurMuenzen}); return ob(x,y); };
const opw = sp.powerupWerfen.bind(sp);
sp.powerupWerfen = function(a){ const ok = opw(a); L.powerups.push({t:T(), art:a, ok, gold:sp.nurMuenzen}); return ok; };
const osf = g.sturzflugStarten.bind(g);
g.sturzflugStarten = function(){ L.sturz.push({t:T(), gold:g._goldRest>0}); return osf(); };
const obs = g.bossStarten.bind(g);
g.bossStarten = function(){ L.boss.push({t:T(), gold:g._goldRest>0}); return obs(); };
const oss = g.wall.sonderStufe.bind(g.wall);
g.wall.sonderStufe = function(s,e){ L.sonder.push({t:T(), an:!!s, name:s?s.name:null, elapsed:+(e||0).toFixed(2), gebietWechsel:g._gebietWechsel}); return oss(s,e); };
M.reset = function(){ for (const k in L) L[k].length=0; M.t=0; };
M.step = function(n, dt){ dt = dt||1/60; const gg=window.__game;
  for(let i=0;i<n;i++){ gg._updatePlaying(dt); M.t+=dt; const nm=gg.wall.stageName;
    const last=L.gebiete[L.gebiete.length-1];
    if(!last||last.name!==nm) L.gebiete.push({t:+M.t.toFixed(2), name:nm, gebietWechsel:gg._gebietWechsel, elapsed:+gg.difficulty.elapsed.toFixed(2), sonder:gg.wall.inSonderStufe}); } };
return 'installiert';
})()
`;
