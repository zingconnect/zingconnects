import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Direct mapping to the browser-safe versions you installed
      stream: 'stream-browserify',
      buffer: 'buffer',
    },
  },
  define: {
    // This is the "magic" that stops the 'reading call' error
    global: 'window',
    'process.env': {},
    'process.nextTick': '(function(fn) { setTimeout(fn, 0); })',
  },
  build: {
    chunkSizeWarningLimit: 2000,
    // Removed the 'external' list. In a standard React SPA, 
    // Vite handles tree-shaking automatically.
  },
})