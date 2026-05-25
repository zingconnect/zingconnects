import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      external: [
        'flutterwave-node-v3', 
        'mock-aws-s3',
        'aws-sdk',
        'nock'
      ],
    },
  },
  optimizeDeps: {
    // This tells Vite to bypass these during the dependency pre-bundling step
    exclude: ['flutterwave-node-v3', 'aws-sdk'] 
  }
})