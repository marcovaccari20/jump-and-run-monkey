import { PerspectiveCamera, Vector3 } from 'three';
const _p=new Vector3(), _q=new Vector3();
function halfWidthAt(cam, planeZ, worldY){
  _p.set(0,worldY,planeZ).project(cam);
  _q.set(1,worldY,planeZ).project(cam);
  const perUnit=_q.x-_p.x;
  return Math.abs((1-_p.x)/perUnit);
}
function run(W,H,label){
  const cam=new PerspectiveCamera(46, W/H, 0.1, 120);
  cam.position.set(0,1.9,11.5);
  cam.lookAt(0,0.35,0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const half=halfWidthAt(cam,0,-0.1);
  const pxPerUnit = W/(2*half);
  const limitHEAD = Math.max(0.9, half - 0.42*1.6);   // HEAD: hitRadius*1.6
  const maxXHEAD  = Math.min(4.6, limitHEAD);          // HEAD bounds.maxX = 4.6
  const spriteHalf = 1.40/2;
  const spriteSafe = half - spriteHalf;
  const limitNEW = Math.max(0.9, spriteSafe);
  const maxXNEW  = Math.min(9, limitNEW);              // worktree bounds.maxX = 9
  console.log(`--- ${label} ${W}x${H} ---`);
  console.log(`half (sichtbare Halbbreite auf y=-0.1) = ${half.toFixed(4)}  (${pxPerUnit.toFixed(2)} px/Unit)`);
  console.log(`HEAD: limit=half-0.672        = ${limitHEAD.toFixed(4)}  -> maxX = ${maxXHEAD.toFixed(4)}`);
  console.log(`      Bahn 0.66*maxX          = ${(0.66*maxXHEAD).toFixed(4)}  = ${(0.66*maxXHEAD*pxPerUnit).toFixed(1)} px von Mitte`);
  console.log(`      Rest Bahnmitte->Rand    = ${(half-0.66*maxXHEAD).toFixed(4)} Units = ${((half-0.66*maxXHEAD)*pxPerUnit).toFixed(1)} px`);
  console.log(`      davon halbe Spritebreite= ${spriteHalf} Units = ${(spriteHalf*pxPerUnit).toFixed(1)} px`);
  console.log(`      -> LEER je Seite        = ${(half-0.66*maxXHEAD-spriteHalf).toFixed(4)} Units = ${((half-0.66*maxXHEAD-spriteHalf)*pxPerUnit).toFixed(1)} px`);
  console.log(`      spriteSafe half-0.70    = ${spriteSafe.toFixed(4)}`);
  console.log(`WORKTREE: maxX = ${maxXNEW.toFixed(4)}  Bahn 1.0*maxX = ${maxXNEW.toFixed(4)} -> leer je Seite = ${(half-maxXNEW-spriteHalf).toFixed(4)} Units`);
}
run(390,844,'Hochformat');
run(844,390,'Querformat');
