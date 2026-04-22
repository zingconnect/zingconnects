import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    chunkSizeWarningLimit: 2000, // Stops the 500kb warning
    rollupOptions: {
      external: [
        'crypto',
        'fs',
        'path',
        'os',
        'dotenv',
        'bcryptjs',
        'mongoose',
        'jsonwebtoken',
        'nodemailer',
        'express',
        'multer'
        // Add 'framer-motion' here ONLY if you don't want to run 'npm install framer-motion'
      ],
    },
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      // If you still have crypto-browserify installed, add this too:
      crypto: 'crypto-browserify', 
    },
  },
  define: {
    global: 'window',
    'process.env': {},
  },
})