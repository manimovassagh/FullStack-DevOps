import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  // `npm run dev` for UI work: the API is the Python server (make -C control-panel run).
  server: { port: 5174, proxy: { '/api': 'http://localhost:3500' } },
  build: { chunkSizeWarningLimit: 1200 },
})
