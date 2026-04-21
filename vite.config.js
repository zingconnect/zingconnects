import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      // THIS IS THE FIX: It tells the bundler that these modules are 
      // "External" and should not be bundled into your React app.
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
      ],
    },
  },
  resolve: {
    alias: {
      // Keeps simple-peer happy in your AgentDashboard
      buffer: 'buffer',
    },
  },
  define: {
    global: 'window',
    'process.env': {},
  },
})