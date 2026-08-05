/**
 * Lädt alle Assets EINMAL vor dem Spielstart.
 *
 * Das Affen-GLB ist Meshopt-komprimiert (EXT_meshopt_compression), deshalb
 * braucht der GLTFLoader den MeshoptDecoder. Im Sprite-Modus wird das Modell
 * gar nicht erst angefordert — das spart 1.5 MB Download.
 */
import { ClampToEdgeWrapping, SRGBColorSpace, TextureLoader } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Löst einen absoluten Asset-Pfad ("/models/monkey.glb") gegen die Vite-Base
 * auf. Nötig, weil vite.config.js `base: './'` benutzt — der Build läuft
 * dadurch auch in einem Unterordner.
 */
function assetUrl(path) {
  const base = import.meta.env?.BASE_URL || '/';
  return new URL(path.replace(/^\//, ''), new URL(base, window.location.href)).href;
}

export class AssetLoader {
  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new TextureLoader();
    this.onProgress = null; // (fraction: number, label: string) => void
  }

  _report(done, total, label) {
    this.onProgress?.(total === 0 ? 1 : done / total, label);
  }

  /**
   * @param {{modelUrl?: string|null, textureUrls?: string[]}} opts
   * @returns {Promise<{gltf: object|null, textures: Map<string, import('three').Texture>}>}
   *   Die Map ist nach dem ORIGINALPFAD verschlüsselt (nicht der aufgelösten
   *   URL), damit die Aufrufer mit den Pfaden aus config.js arbeiten können.
   */
  async loadAll({ modelUrl = null, textureUrls = [] }) {
    const unique = [...new Set(textureUrls)];
    const total = unique.length + (modelUrl ? 1 : 0);
    let done = 0;

    let gltf = null;
    if (modelUrl) {
      this._report(done, total, 'Affe wird geladen…');
      gltf = await this.gltfLoader.loadAsync(assetUrl(modelUrl));
      this._report(++done, total, 'Dschungel wird geladen…');
    }

    const textures = new Map();
    for (const path of unique) {
      this._report(done, total, 'Dschungel wird geladen…');
      const tex = await this.textureLoader.loadAsync(assetUrl(path));
      tex.colorSpace = SRGBColorSpace;
      // Standard ist Klemmen; die Wand setzt für ihre Kopien selbst auf
      // Wiederholen um (Sprites dürfen NICHT wiederholen).
      tex.wrapS = ClampToEdgeWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.anisotropy = 4;
      textures.set(path, tex);
      this._report(++done, total, 'Dschungel wird geladen…');
    }

    return { gltf, textures };
  }
}
