import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Visible build stamp so it is obvious which version an iPad is running.
function buildVersion(): string {
  let hash = 'dev';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* not a git checkout */
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${hash} · ${stamp} UTC`;
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: "Misha's Number Rush",
        short_name: 'Number Rush',
        description: 'A colourful 3D maths racing game where living numbers merge, split and grow.',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'portrait',
        background_color: '#9fd6ff',
        theme_color: '#3a9cf5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
