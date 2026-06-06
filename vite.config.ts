import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  root: 'web',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'web/src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5180',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:5180',
        ws: true
      }
    }
  }
})
