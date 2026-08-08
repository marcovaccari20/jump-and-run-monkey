import {PerspectiveCamera,Vector3} from 'three';
const c=new PerspectiveCamera(46,390/844,0.1,120);
c.position.set(0,1.9,11.5); c.lookAt(0,0.35,0); c.updateMatrixWorld(true); c.updateProjectionMatrix();
function half(y){const p=new Vector3(0,y,0).project(c);const q=new Vector3(1,y,0).project(c);return Math.abs((1-p.x)/(q.x-p.x));}
const h=half(-2.6);
console.log('half at y=-2.6:',h);
for(const b of [1.403/2, 2.7155/2, 1.788/2]) console.log('halbeBreite',b,'-> limit',Math.max(0.9,h-b));
