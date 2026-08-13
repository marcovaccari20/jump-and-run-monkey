/* Echte Reproduktion: echter AnimationController + echter Player + echte CONFIG. */
import * as THREE from 'three';
import { CONFIG } from 'file:///C:/Users/Marco%20Vaccari/FApp/jungle-climber/src/config.js';
import { AnimationController } from 'file:///C:/Users/Marco%20Vaccari/FApp/jungle-climber/src/animation/AnimationController.js';
import { Player } from 'file:///C:/Users/Marco%20Vaccari/FApp/jungle-climber/src/entities/Player.js';

/* Modell-Attrappe: Skelett mit den Namen aus stripRootMotion + tail. */
function baueModell() {
  const root = new THREE.Group();
  root.name = 'SK_Mesh_Macaque';
  let parent = root;
  const namen = [
    'RL_BoneRoot', 'macaque_Pelvis_bone',
    ...CONFIG.animation.tail.bones,
  ];
  for (const n of namen) {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(0, 0.3, 0);
    parent.add(b);
    parent = b;
  }
  const kopf = new THREE.Bone();
  kopf.name = 'macaque_Head_bone';
  kopf.position.set(0, 1.2, 0);
  root.add(kopf);
  return root;
}

/* Clips mit den Namen, die die clipMap/oneShots/menuIdleCycle verlangen. */
function baueClips() {
  const namen = new Set();
  for (const e of Object.values(CONFIG.animation.clipMap)) namen.add(e.clip);
  for (const n of Object.values(CONFIG.animation.oneShots)) namen.add(n);
  for (const n of CONFIG.animation.menuIdleCycle) namen.add(n);
  return [...namen].map((n) => {
    const track = new THREE.QuaternionKeyframeTrack(
      'macaque_Head_bone.quaternion',
      [0, 1],
      [0, 0, 0, 1, 0, 0.2, 0, 0.98],
    );
    const pos = new THREE.VectorKeyframeTrack(
      'RL_BoneRoot.position', [0, 1], [0, 0, 0, 0, 0, 3],
    );
    return new THREE.AnimationClip(n, 1, [track, pos]);
  });
}

const modell = baueModell();
const anim = new AnimationController(modell, baueClips(), CONFIG.animation);
const player = new Player(modell, anim, CONFIG.player, CONFIG.revive);

anim.reset();
player.reset();

const bounds = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const ctx = { speed: 0, vx: 0, vy: 0 };
const dt = 1 / 60;
const axis = { x: 1, y: 0 };

let maxScale = -Infinity, minScale = Infinity, maxSpeed = 0;
let anschlaegeMax = 0, frames = 0;
const proben = [];

for (let i = 0; i < 600; i++) {           // 10 s Vollgas nach rechts
  player.update(dt, axis, bounds);
  player.animContext(ctx);
  anim.update(dt, ctx);
  const a = anim.locomotion.get(anim._locomotionKey);
  const scale = a.getEffectiveTimeScale();
  frames++;
  maxSpeed = Math.max(maxSpeed, ctx.speed);
  maxScale = Math.max(maxScale, scale);
  minScale = Math.min(minScale, scale);
  if (Math.abs(scale - CONFIG.animation.speedSyncClamp.max) < 1e-9) anschlaegeMax++;
  if (i < 6 || i === 20 || i === 60 || i === 599) {
    proben.push(`  frame ${String(i).padStart(3)}  key=${anim._locomotionKey}  speed=${ctx.speed.toFixed(3)}  timeScale=${scale.toFixed(4)}`);
  }
}

console.log('=== Vollgas seitwaerts, 10 s, echter Code ===');
console.log(proben.join('\n'));
console.log('  moveSpeed              =', CONFIG.player.moveSpeed);
console.log('  hoechste erreichte speed=', maxSpeed.toFixed(4));
console.log('  timeScale min/max      =', minScale.toFixed(4), '/', maxScale.toFixed(4));
console.log('  clamp.max              =', CONFIG.animation.speedSyncClamp.max);
console.log('  Frames AM oberen Anschlag:', anschlaegeMax, 'von', frames);

/* Wieviel Prozent des Fahrbereichs sind ueberhaupt geclampt? */
const ref = CONFIG.animation.speedSyncReference;
const { min, max } = CONFIG.animation.speedSyncClamp;
const vMin = min * ref, vMax = max * ref, mv = CONFIG.player.moveSpeed;
console.log('\n=== Fahrbereich ===');
console.log(`  unterer Anschlag bis speed = ${vMin.toFixed(3)}  (${(vMin/mv*100).toFixed(1)} % von moveSpeed)`);
console.log(`  oberer Anschlag ab   speed = ${vMax.toFixed(3)}  (${(vMax/mv*100).toFixed(1)} % von moveSpeed) -> ${vMax > mv ? 'UNERREICHBAR' : 'erreichbar'}`);
console.log(`  lineare Kopplung aktiv auf ${((Math.min(mv,vMax)-vMin)/mv*100).toFixed(1)} % des Geschwindigkeitsbands`);

/* Dodge: loest der Trigger ueberhaupt aus? */
let dodges = 0;
const origDodge = anim.triggerDodge.bind(anim);
anim.triggerDodge = () => { dodges++; return origDodge(); };
player.reset();
anim.reset();
for (let i = 0; i < 120; i++) {
  player.update(dt, i < 60 ? axis : { x: 0, y: 0 }, bounds);
  player.animContext(ctx);
  anim.update(dt, ctx);
}
console.log('\n=== Dodge ===');
console.log('  dodgeTriggerSpeed =', CONFIG.animation.dodgeTriggerSpeed,
  `= ${(CONFIG.animation.dodgeTriggerSpeed / mv * 100).toFixed(1)} % von moveSpeed`);
console.log('  Ausloesungen bei 1x Anfahren aus dem Stand:', dodges);

/* --- Analoge Eingabe (Touch liefert Bruchwerte) + Ausrollen ------------ */
console.log('\n=== Kopplung bei analoger Eingabe / beim Ausrollen ===');
const werte = new Set();
for (const ax of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0]) {
  player.reset(); anim.reset();
  for (let i = 0; i < 60; i++) { player.update(dt, { x: ax, y: 0 }, bounds); player.animContext(ctx); anim.update(dt, ctx); }
  const a = anim.locomotion.get(anim._locomotionKey);
  const s = a.getEffectiveTimeScale();
  werte.add(s.toFixed(4));
  console.log(`  axis.x=${ax.toFixed(2)}  speed=${ctx.speed.toFixed(3)}  timeScale=${s.toFixed(4)}${Math.abs(s-1.85)<1e-9?'  <-- MAX':''}`);
}
player.reset(); anim.reset();
for (let i = 0; i < 60; i++) { player.update(dt, { x: 1, y: 0 }, bounds); player.animContext(ctx); anim.update(dt, ctx); }
console.log('  -- Taste losgelassen, Ausrollen --');
for (let i = 0; i < 40; i++) {
  player.update(dt, { x: 0, y: 0 }, bounds); player.animContext(ctx); anim.update(dt, ctx);
  if (i % 8 === 0) {
    const a = anim.locomotion.get(anim._locomotionKey);
    console.log(`  t=+${(i*dt).toFixed(2)}s  key=${anim._locomotionKey}  speed=${ctx.speed.toFixed(3)}  timeScale=${a.getEffectiveTimeScale().toFixed(4)}`);
  }
}
console.log('  verschiedene timeScale-Werte im Test:', werte.size, '=> Kopplung', werte.size > 1 ? 'AKTIV' : 'tot');
