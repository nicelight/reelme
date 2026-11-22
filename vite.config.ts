import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

function serveCameraTest(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((request, response, next) => {
    const path = request.url?.split('?')[0];
    if (path && ['/cam-test-web', '/booth', '/cam-test-web.html', '/booth.html'].includes(path)) {
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      if (!path.endsWith('.html')) request.url = request.url?.replace(path, path + '.html');
    } else if (path?.startsWith('/cam-test-web-assets/')) {
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    next();
  });
}

export default defineConfig({
  plugins: [svelte(), { name: 'camera-test-page', configureServer: serveCameraTest, configurePreviewServer: serveCameraTest }],
  // Relative chunk URLs keep capture imports on the cloud asset origin.
  base: './',
  build: {
    outDir: 'dist/client', manifest: true,
    rollupOptions: { input: { cloud: 'index.html', capture: 'src/client/capture/main.ts', cameraTest: 'cam-test-web.html', booth: 'booth.html' } },
  },
});
