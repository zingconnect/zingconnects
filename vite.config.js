import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path' // You might need to install @types/node

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // This redirects 'crypto' imports to the browser-safe version
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
    },
  },
  define: {
    global: 'window',
    'process.env': {},
  },
})