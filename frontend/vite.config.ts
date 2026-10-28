import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/markword/' : '/',
  plugins: [react()],
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: {
      '/api': loadEnv(mode, '.', 'MARKWORD_').MARKWORD_API_TARGET || 'http://localhost:27860',
    },
  },
  build: {
    outDir: mode === 'pages' ? 'dist-pages' : 'dist',
  },
}))
