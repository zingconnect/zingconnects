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
      // If Vite accidentally sees these imports, tell it to ignore them
      "crypto": "crypto-browserify",
    },
  },
  build: {
    rollupOptions: {
      // This tells Rollup (Vercel's bundler) that these are external 
      // and shouldn't be bundled into the frontend javascript
      external: ['crypto', 'fs', 'path', 'os', 'dotenv', 'mongoose'],
    },
  },
  define: {
    global: 'window',
    'process.env': {},
  },
})