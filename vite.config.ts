import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Relative chunk URLs keep capture imports on the cloud asset origin.
  base: './',
  build: {
    outDir: 'dist/client', manifest: true,
    rollupOptions: { input: { cloud: 'index.html', capture: 'src/client/capture/main.ts' } },
  },
});
