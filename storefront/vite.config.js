import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// La tienda vive en /tienda/ detrás de Nginx; la API va al mismo origen
export default defineConfig({
  base: '/tienda/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api':     'http://localhost:8000',
      '/storage': 'http://localhost:8000',
    },
  },
})
