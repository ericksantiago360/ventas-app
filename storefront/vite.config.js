import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// La tienda vive en /tienda/ detrás de Nginx; la API va al mismo origen
export default defineConfig({
  base: '/tienda/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Tienda en línea',
        lang: 'es-MX',
        short_name: 'Tienda',
        start_url: '/tienda/',
        scope: '/tienda/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1F6FEB',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Solo la cáscara de la app se guarda en caché; API, archivos y sitemap siempre van a la red
        navigateFallbackDenylist: [/^\/api\//, /^\/storage\//, /sitemap\.xml$/],
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: {
      '/api':     'http://localhost:8000',
      '/storage': 'http://localhost:8000',
    },
  },
})
