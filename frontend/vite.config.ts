import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: '../backend/static',
    emptyOutDir: false,
    // Suppress chunk size warnings for three.js / 3d-force-graph
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          '3d-graph': ['3d-force-graph'],
          'graph2d': ['force-graph'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3400',
        changeOrigin: true,
      },
    },
  },
})
