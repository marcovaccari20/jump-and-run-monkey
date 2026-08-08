import * as THREE from 'three';
function halfWidthAt(camera, planeZ, worldY) {
  const p = new THREE.Vector3(0, worldY, planeZ).project(camera);
  const q = new THREE.Vector3(1, worldY, planeZ).project(camera);
  const perUnit = q.x - p.x;
  return Math.abs((1 - p.x) / perUnit);
}
const formate = [
  ['9:19.5  390x844', 390, 844],
  ['9:16    405x720', 405, 720],
  ['16:9   1280x720', 1280, 720],
];
for (const [name, w, h] of formate) {
  const cam = new THREE.PerspectiveCamera(46, w / h, 0.1, 120);
  cam.position.set(0, 1.9, 11.5);
  cam.lookAt(0, 0.35, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const half = halfWidthAt(cam, 0, -0.1);
  const zeilen = [['braun', 1.40], ['weiss', 0.70]].map(([a, sw]) => {
    const limit = Math.max(0.9, half - sw / 2);
    return `${a}: limit=${limit.toFixed(4)}`;
  });
  console.log(name, 'half=', half.toFixed(4), zeilen.join('  '));
}
