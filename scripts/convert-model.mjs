/**
 * Monkey_B1.Fbx  ->  public/models/monkey.glb
 *
 * Two stages:
 *   1. FBX2glTF  : FBX (94 MB, mesh + skeleton + 17 animation stacks) -> uncompressed GLB
 *   2. glTF-Transform : keyframe resampling, texture downscale + WebP, Meshopt compression
 *
 * Run with:  npm run convert:model        (add -- --force to redo stage 1)
 *
 * Meshopt (EXT_meshopt_compression) is used instead of Draco because Draco only
 * compresses mesh geometry. This asset's bulk is animation data (17 clips x ~101
 * bones), which Meshopt compresses as well.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  resample,
  textureCompress,
  weld,
  meshopt,
} from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const FBX_IN = resolve(ROOT, 'assets-src/FbxUnity/Monkey_B1.Fbx');
const RAW_OUT = resolve(ROOT, 'assets-src/.cache/monkey_raw'); // FBX2glTF appends .glb
const GLB_OUT = resolve(ROOT, 'public/models/monkey.glb');

const FORCE = process.argv.includes('--force');
const MAX_TEXTURE_SIZE = 1024;

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

/* ------------------------------------------------------------------ stage 1 */

function convertFbx() {
  if (existsSync(`${RAW_OUT}.glb`) && !FORCE) {
    console.log(`[1/2] reusing cached ${RAW_OUT}.glb (pass --force to redo)`);
    return;
  }
  if (!existsSync(FBX_IN)) {
    throw new Error(
      `Source FBX not found: ${FBX_IN}\n` +
        `Extract FbxUnity/Monkey_B1.Fbx from source.zip into assets-src/ first.`,
    );
  }
  mkdirSync(dirname(RAW_OUT), { recursive: true });

  // fbx2gltf ships prebuilt binaries per platform under bin/<os>/
  const platform = process.platform === 'win32' ? 'Windows_NT' : process.platform === 'darwin' ? 'Darwin' : 'Linux';
  const bin = resolve(
    ROOT,
    'node_modules/fbx2gltf/bin',
    platform,
    process.platform === 'win32' ? 'FBX2glTF.exe' : 'FBX2glTF',
  );

  console.log('[1/2] FBX -> GLB (this takes ~1 min)…');
  execFileSync(bin, ['--input', FBX_IN, '--output', RAW_OUT, '--binary'], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

/* ------------------------------------------------------------------ stage 2 */

async function compressGlb() {
  await MeshoptEncoder.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  const doc = await io.read(`${RAW_OUT}.glb`);
  const root = doc.getRoot();

  console.log('[2/2] optimising…');

  await doc.transform(
    // Merge duplicate accessors/materials/textures produced by the FBX exporter.
    dedup(),

    // Drop redundant keyframes. The FBX bakes every bone on every frame; most
    // channels are constant. This is the single biggest win on this asset.
    resample({ tolerance: 1e-4 }),

    // Merge vertices that the FBX split for smoothing groups.
    weld(),

    // 4096px PNG -> 1024px WebP. The normal map alone is 35 MB as source PNG.
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE],
      quality: 85,
    }),

    // Remove anything now unreferenced. Animated nodes are never pruned, so the
    // 17 clips keep every bone they drive.
    prune({ keepAttributes: false, keepLeaves: false }),

    // EXT_meshopt_compression over geometry *and* animation samplers.
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  mkdirSync(dirname(GLB_OUT), { recursive: true });
  await io.write(GLB_OUT, doc);

  /* ---------------------------------------------------------------- report */

  const anims = root.listAnimations();
  console.log(`\nAnimation clips (${anims.length}):`);
  for (const a of anims) {
    let dur = 0;
    for (const s of a.listSamplers()) {
      const input = s.getInput();
      if (input) dur = Math.max(dur, input.getMax([])[0]);
    }
    console.log(`  ${a.getName().padEnd(12)} ${dur.toFixed(2)}s`);
  }

  console.log('\nTextures:');
  for (const t of root.listTextures()) {
    const size = t.getSize();
    console.log(
      `  ${(t.getName() || '(unnamed)').padEnd(22)} ${t.getMimeType()} ${size ? size.join('x') : '?'} ${mb(t.getImage()?.byteLength ?? 0)}`,
    );
  }

  const before = statSync(`${RAW_OUT}.glb`).size;
  const after = statSync(GLB_OUT).size;
  console.log(
    `\n${mb(before)} -> ${mb(after)}  (${((1 - after / before) * 100).toFixed(1)}% smaller)`,
  );
  console.log(`written: ${GLB_OUT}`);

  if (after > 6 * 1048576) {
    console.warn('\nWARNING: output exceeds the 6 MB budget.');
    process.exitCode = 1;
  }
}

convertFbx();
await compressGlb();
