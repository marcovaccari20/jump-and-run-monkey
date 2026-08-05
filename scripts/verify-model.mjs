/**
 * Inspects public/models/monkey.glb and prints clips, skins, meshes, textures
 * and the bone chains the game code depends on.
 *
 * Run with:  npm run verify:model
 *
 * Use this after retrofitting real climb animations (see README, section
 * "Kletteranimation nachrüsten") to confirm the new clip names actually landed
 * in the GLB and the tail chain is still intact.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

import { CONFIG } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLB = process.argv[2] ?? resolve(__dirname, '../public/models/monkey.glb');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });

const doc = await io.read(GLB);
const root = doc.getRoot();

const clips = root.listAnimations().map((a) => a.getName());
console.log(`=== CLIPS (${clips.length}) ===`);
console.log(`  ${clips.join(', ')}`);

console.log(`\n=== MESHES / SKINS ===`);
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const skin = node.getSkin();
  console.log(
    `  node "${node.getName()}" mesh "${mesh.getName()}" skin=${skin ? `${skin.listJoints().length} joints` : 'NONE'}`,
  );
}

console.log(`\n=== TEXTURES ===`);
for (const t of root.listTextures()) {
  const size = t.getSize();
  console.log(
    `  ${(t.getName() || '(unnamed)').padEnd(22)} ${t.getMimeType()} ${size ? size.join('x') : '?'}`,
  );
}

/* --- checks the game actually relies on -------------------------------- */

const nodeNames = new Set(root.listNodes().map((n) => n.getName()));
let ok = true;

console.log(`\n=== REQUIRED CLIPS (from config.js clipMap) ===`);
const required = new Set();
for (const entry of Object.values(CONFIG.animation.clipMap)) required.add(entry.clip);
for (const clip of Object.values(CONFIG.animation.oneShots)) required.add(clip);
for (const clip of CONFIG.animation.menuIdleCycle) required.add(clip);
for (const name of [...required].sort()) {
  const present = clips.includes(name);
  if (!present) ok = false;
  console.log(`  ${present ? 'OK  ' : 'MISS'} ${name}`);
}

console.log(`\n=== TAIL CHAIN (procedural secondary motion) ===`);
for (const bone of CONFIG.animation.tail.bones) {
  const present = nodeNames.has(bone);
  if (!present) ok = false;
  console.log(`  ${present ? 'OK  ' : 'MISS'} ${bone}`);
}

console.log(`\n${ok ? 'PASS — model satisfies config.js' : 'FAIL — see MISS lines above'}`);
process.exitCode = ok ? 0 : 1;
