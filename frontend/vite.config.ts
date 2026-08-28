import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/markword/' : '/',
  plugins: [react()],
  publicDir: 'public',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:27860',
    },
  },
  build: {
    outDir: mode === 'pages' ? 'dist-pages' : 'dist',
  },
}))
