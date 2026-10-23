import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

// Приложение публикуется на GitHub Pages по адресу /project-manager-app/
const BASE = process.env.VITE_BASE || '/project-manager-app/';
const NAME = 'Менеджер проектов';
const MANIFEST = {
  name: NAME,
  short_name: 'Проекты',
  description: `${NAME}: точки, работы и ежедневные отчёты монтажника слаботочных систем`,
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
};
// Тот же манифест на английском и иврите: название значка на главном экране — на языке приложения (src/i18n/index.js меняет ссылку)
const LANG_MANIFESTS = {
  en: { name: 'Project Manager', short_name: 'Projects', description: 'Project Manager: points, works and daily reports for low-voltage installers', lang: 'en' },
  he: { name: 'מנהל פרויקטים', short_name: 'פרויקטים', description: 'מנהל פרויקטים: נקודות, עבודות ודוחות יומיים למתקיני מערכות מתח נמוך', lang: 'he', dir: 'rtl' },
};
const langManifests = () => ({
  name: 'lang-manifests',
  generateBundle() {
    for (const [l, over] of Object.entries(LANG_MANIFESTS)) {
      this.emitFile({ type: 'asset', fileName: `manifest-${l}.webmanifest`, source: JSON.stringify({ ...MANIFEST, ...over }) });
    }
  },
});

export default defineConfig({
  base: BASE,
  define: { __VERSION__: JSON.stringify(VERSION), __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  build: { target: 'es2022', sourcemap: false },
  worker: { format: 'es' },  // разбор чертежа (mupdf) — в фоновом потоке
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: BASE + 'index.html',
        // запросы к Firebase/Google никогда не кэшируем service worker-ом
        navigateFallbackDenylist: [/^\/__\//, new RegExp(`^${BASE}__/`)],
        cleanupOutdatedCaches: true,
        globIgnores: ['**/mupdf*'],  // модуль чтения PDF (≈10 МБ) — не при установке, а при первом разборе чертежа
        runtimeCaching: [{ urlPattern: /mupdf.*\.(?:wasm|js)$/, handler: 'CacheFirst', options: { cacheName: 'mupdf', expiration: { maxEntries: 6 } } }],
      },
      manifest: MANIFEST,
    }),
    langManifests(),
  ],
});
