import { PerspectiveCamera, Vector3 } from 'three';
import { CONFIG } from './src/config.js';
import { halfWidthAt } from './src/core/viewport.js';

function cam(w,h){
  const c = CONFIG.render.camera;
  const k = new PerspectiveCamera(c.fov, w/h, c.near, c.far);
  k.position.set(...c.position);
  k.lookAt(new Vector3(...c.lookAt));
  k.updateMatrixWorld(true);
  k.updateProjectionMatrix();
  return k;
}

// spriteWidth aus echter Bilddatei ermitteln
import { readFileSync } from 'fs';
function webpSize(path){
  const b = readFileSync(path);
  // VP8X / VP8L / VP8
  const fmt = b.toString('ascii',12,16);
  if (fmt==='VP8X'){ const w = (b[24]|b[25]<<8|b[26]<<16)+1, h=(b[27]|b[28]<<8|b[29]<<16)+1; return {w,h,fmt}; }
  if (fmt==='VP8L'){ const bits = b.readUInt32LE(21); const w=(bits&0x3FFF)+1, h=((bits>>14)&0x3FFF)+1; return {w,h,fmt}; }
  if (fmt==='VP8 '){ const w = b.readUInt16LE(26)&0x3FFF, h=b.readUInt16LE(28)&0x3FFF; return {w,h,fmt}; }
  return null;
}
const sz = webpSize('./public/textures/move_00.webp');
console.log('move_00.webp', sz);
const aspect = sz.w/sz.h;

const chars = CONFIG.characters.list;
function spriteW(charId){
  const p = { ...CONFIG.player, ...chars[charId].player };
  let a = aspect;
  if (charId==='weiss') a = webpSize('./public/textures/weiss/move_00.webp').w/webpSize('./public/textures/weiss/move_00.webp').h;
  if (charId==='orange') a = webpSize('./public/textures/orange/move_00.webp').w/webpSize('./public/textures/orange/move_00.webp').h;
  return { w: p.spriteHeight * a, p, a };
}

function feld(wpx,hpx,charId){
  const c = cam(wpx,hpx);
  const { w: sw, p } = spriteW(charId);
  const half = halfWidthAt(c, 0, CONFIG.player.startPosition[1]);
  const limit = Math.max(0.9, half - sw/2);
  const maxX = Math.min(CONFIG.world.bounds.maxX, limit);
  const bahnX = CONFIG.world.bahnen.map(a=>a*maxX);
  return { half, sw, limit, maxX, bahnX, p };
}

// Simulation eines Bahnwechsels um EINE Bahn
function sim(von, nach, moveSpeed, bahnWechselZeit, dt=1/60, maxX=9, minX=-9){
  let x = von;
  const ziel = nach;
  const rate = 3/Math.max(0.02, bahnWechselZeit ?? 0.16);
  let t=0;
  for (let i=0;i<100000;i++){
    const rest = ziel - x;
    let schritt = rest*(1-Math.exp(-rate*dt));
    const maxSchritt = moveSpeed*dt;
    if (schritt>maxSchritt) schritt=maxSchritt; else if (schritt<-maxSchritt) schritt=-maxSchritt;
    x += schritt;
    t += dt;
    if (Math.abs(ziel-x)<0.002){ x=ziel; break; }
    if (x<minX) x=minX; else if (x>maxX) x=maxX;
  }
  return t;
}

const formate = [['Hochformat 390x844',390,844],['Desktop 1600x900',1600,900],['Handy quer 844x390',844,390],['Desktop 1920x1080',1920,1080]];
for (const [name,w,h] of formate){
  for (const cid of ['braun','weiss','orange']){
    const f = feld(w,h,cid);
    const b = f.bahnX;
    const dInnen = Math.abs(b[2]-b[1]);
    const dAussen = Math.abs(b[1]-b[0]);
    const t1 = sim(b[1], b[0], f.p.moveSpeed, f.p.bahnWechselZeit, 1/60, f.maxX, -f.maxX);
    const t2 = sim(b[1], b[2], f.p.moveSpeed, f.p.bahnWechselZeit, 1/60, f.maxX, -f.maxX);
    console.log(`${name.padEnd(20)} ${cid.padEnd(7)} half=${f.half.toFixed(3)} spriteW=${f.sw.toFixed(3)} limit=${f.limit.toFixed(3)} maxX=${f.maxX.toFixed(3)} bahnX=[${b.map(v=>v.toFixed(3)).join(', ')}] abst=${dAussen.toFixed(3)} t(1->0)=${t1.toFixed(3)}s t(1->2)=${t2.toFixed(3)}s`);
  }
}
