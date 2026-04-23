import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills' // <--- 1. Import this

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({ // <--- 2. Add this configuration
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      stream: 'stream-browserify',
      buffer: 'buffer',
    },
  },
  // We keep this as a secondary safety net
  define: {
    'process.env': {},
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
})