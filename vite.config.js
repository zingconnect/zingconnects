import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // These MUST be externalized so the browser build ignores them
      external: [
        'crypto', 'fs', 'path', 'os', 'dotenv', 
        'bcryptjs', 'mongoose', 'jsonwebtoken', 
        'nodemailer', 'express', 'multer', 
        'flutterwave-node-v3', 'web-push',
        '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'
      ],
    },
  },
  resolve: {
    alias: {
      // This maps Node modules to browser-safe versions
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      buffer: 'buffer',
    },
  },
  define: {
    // This supports the manual polyfills you added to AgentDashboard
    global: 'window',
    'process.env': {},
  },
})