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
  resolve: {
    alias: {
      // Direct aliases for browser-compatible versions of Node modules
      stream: 'stream-browserify',
      buffer: 'buffer',
      crypto: 'crypto-browserify',
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // Externalize backend-only libraries to prevent them from breaking the build
      external: [
        'flutterwave-node-v3', 
        'mock-aws-s3',
        'aws-sdk',
        'nock'
      ],
    },
  },
  optimizeDeps: {
    // 1. REMOVED flutterwave-react-v3 from include because we are using the script tag method
    // 2. Keep excluding the backend library
    exclude: ['flutterwave-node-v3']
  }
})