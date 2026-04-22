import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    // Increase limit for your large AgentDashboard
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // THIS TELLS VERCEL: "If you see these names, ignore them. They are for the backend."
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
        'multer',
        'flutterwave-node-v3',
        '@aws-sdk/client-s3',
        '@aws-sdk/s3-request-presigner'
      ],
    },
  },
  resolve: {
    alias: {
      // Redirects any 'crypto' calls in frontend libs to the browser version
      crypto: 'crypto-browserify',
      buffer: 'buffer',
      stream: 'stream-browserify',
    },
  },
  define: {
    global: 'window',
    'process.env': {},
  },
})