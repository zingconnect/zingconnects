import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // If your app is not at the root of your domain, 
  // you would set base: '/your-path/' here.
  // For Vercel root, keeping it default is fine.
})