import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'TUBy – guides pas à pas',
        short_name: 'TUBy',
        description: 'Tes guides pas à pas : une seule étape à la fois.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7fb',
        theme_color: '#3730a3',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Seule la coquille élève est mise en cache ; l'API et l'admin passent toujours par le réseau.
        globPatterns: ['index.html', 'assets/index-*.{js,css}', 'assets/*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8788' } },
})
