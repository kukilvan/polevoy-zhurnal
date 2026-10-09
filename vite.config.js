import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Приложение публикуется на GitHub Pages по адресу /polevoy-zhurnal/
const BASE = '/polevoy-zhurnal/';

export default defineConfig({
  base: BASE,
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  build: { target: 'es2020', sourcemap: false },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: BASE + 'index.html',
        // запросы к Firebase/Google никогда не кэшируем service worker-ом
        navigateFallbackDenylist: [/^\/__\//, /^\/polevoy-zhurnal\/__\//],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Полевой журнал',
        short_name: 'Журнал',
        description: 'Полевой журнал монтажника слаботочных систем',
        lang: 'ru',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
