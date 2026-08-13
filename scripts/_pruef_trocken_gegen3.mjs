/* Beweist, dass der ECHTE Zweig laeuft: wenn die Bedingung erfuellt ist,
 * MUSS _bahnWaehlen die duerrste freie Bahn liefern (ohne Wuerfeln). */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PerspectiveCamera } from 'three';
import { CONFIG } from '../src/config.js';
import { DifficultyCurve } from '../src/systems/DifficultyCurve.js';
import { Spawner } from '../src/systems/Spawner.js';
import { halfWidthAt } from '../src/core/viewport.js';
import { groessteSpriteBreite } from '../src/entities/Rock.js';

const ASPECT = Number(process.argv[2] ?? 9 / 19.5);
const DT = 1 / 60;
const GRENZEN = CONFIG.difficulty.gebietsGrenzen;
const ENDE = GRENZEN[GRENZEN.length - 1] + 40;
function rng(seed){let a=seed>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const BILD = new Map();
const wurzel = dirname(fileURLToPath(import.meta.url));
for (const [id, char] of Object.entries(CONFIG.characters.list)) {
  const pfad = (char.framePath ?? CONFIG.sprite.framePath).replace('{n}', '00');
  try { const m = await sharp(resolve(wurzel,'..','public',pfad.replace(/^\//,''))).metadata(); BILD.set(id, m.width/m.height); }
  catch { BILD.set(id, 0.56); }
}
function spielfeld(aspect, halbeBreite, pCfg){
  const cam=CONFIG.render.camera;
  const camera=new PerspectiveCamera(cam.fov,aspect,cam.near,cam.far);
  camera.position.set(...cam.position); camera.lookAt(...cam.lookAt);
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const base=CONFIG.world;
  const half=halfWidthAt(camera,0,(pCfg.startPosition??CONFIG.player.startPosition)[1]);
  const rand=Math.max(halbeBreite,groessteSpriteBreite(CONFIG.rock)/2);
  const limit=Math.max(0.9,half-rand);
  const maxX=Math.min(base.bounds.maxX,limit);
  return {...base,bounds:{minX:Math.max(base.bounds.minX,-limit),maxX,minY:base.bounds.minY,maxY:base.bounds.maxY},
    bahnX:base.bahnen.map(a=>a*maxX),spawnHalfWidth:Math.min(base.spawnHalfWidth,limit+0.8)};
}
function stufeBei(s){const st=CONFIG.wall.stages;let i=0;for(let k=0;k<st.length;k++)if(s>=st[k].afterSeconds)i=k;
  const l=st[st.length-1];if(s>=l.afterSeconds){const e=Math.floor((s-l.afterSeconds)/CONFIG.wall.stageLoopSeconds);i=(st.length-1+e)%st.length;}return st[i];}
function gebiet(t){let i=0;while(i<GRENZEN.length&&t>=GRENZEN[i])i++;return Math.max(1,i);}

const echt = Math.random;
let trefferJeGebiet = new Array(GRENZEN.length + 2).fill(0);
let fehlerJeGebiet = new Array(GRENZEN.length + 2).fill(0);
for (const seed of [11, 22, 33]) {
  Math.random = rng(seed);
  const warn=console.warn; console.warn=()=>{};
  const pCfg={...CONFIG.player,...CONFIG.characters.list.braun.player};
  const world=spielfeld(ASPECT,(pCfg.spriteHeight*(BILD.get('braun')??0.56))/2,pCfg);
  const difficulty=new DifficultyCurve(CONFIG.difficulty); difficulty.setRockMix(CONFIG.rock.mix);
  const spawner=new Spawner({add(){}},CONFIG,difficulty,world,null);
  spawner.bananasEnabled=false; spawner.setSpieler(pCfg); spawner.reset();
  let jetzt=0;
  const orig=spawner._bahnWaehlen.bind(spawner);
  spawner._bahnWaehlen=(frei,alle)=>{
    const grenze=CONFIG.rock.korridor.maxTrockenZeit;
    let duerrste=null,maxT=grenze;
    if(grenze>0&&frei.length>1&&spawner._bahnTrocken){
      for(const x of frei){const i=alle.indexOf(x);
        if(i>=0&&spawner._bahnTrocken[i]>maxT){maxT=spawner._bahnTrocken[i];duerrste=x;}}
    }
    const x=orig(frei,alle);
    if(duerrste!==null){
      const g=Math.min(gebiet(jetzt),GRENZEN.length+1);
      if(x===duerrste) trefferJeGebiet[g]++; else fehlerJeGebiet[g]++;
    }
    return x;
  };
  const frames=Math.round(ENDE/DT);
  for(let f=0;f<frames;f++){
    difficulty.update(DT); jetzt=difficulty.elapsed;
    const base=difficulty.scrollSpeed;
    spawner.hazardLook=stufeBei(jetzt).hazard;
    spawner.update(DT,false,Math.max(base,base*pCfg.minScrollFactor));
  }
  console.warn=warn;
}
Math.random=echt;
console.log('aspect', ASPECT.toFixed(3));
console.log('Gebiet : Zweig ausgeloest (duerrste Bahn geliefert) / Abweichung');
for(let g=1;g<=GRENZEN.length;g++) console.log(String(g).padStart(6), ':', String(trefferJeGebiet[g]).padStart(5), '/', fehlerJeGebiet[g]);
console.log('SUMME 1-9  ', trefferJeGebiet.slice(1,10).reduce((a,b)=>a+b,0));
console.log('SUMME 10-21', trefferJeGebiet.slice(10,22).reduce((a,b)=>a+b,0), ' Abweichungen', fehlerJeGebiet.reduce((a,b)=>a+b,0));
