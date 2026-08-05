import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Basis: der Build läuft damit auch in einem Unterordner
  // (z. B. https://example.com/jungle-climber/) ohne Anpassung.
  base: './',

  server: {
    port: 5173,
    open: false,
  },

  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0, // GLB/PNG immer als eigene Datei ausliefern
    chunkSizeWarningLimit: 900, // three.js ist nun mal gross
  },

  // .glb liegt in public/ und wird 1:1 kopiert — hier nur der Vollständigkeit
  // halber, falls jemand ein Modell direkt aus src/ importiert.
  assetsInclude: ['**/*.glb'],
});
