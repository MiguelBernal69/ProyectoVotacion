import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 3000,
    // Proxy hacia el backend local en desarrollo — evita problemas de CORS y permite acceso en red local
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err: any) => {
            // Silenciar advertencias inofensivas de cierres bruscos de socket (ECONNRESET/ECONNREFUSED)
            if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return;
            console.error('[Vite Proxy Error]', err);
          });
        },
      },
    },
  },
  preview: {
    host: true,
    port: 3000,
  },
})
