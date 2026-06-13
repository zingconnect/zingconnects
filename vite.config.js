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
    sourcemap: false, 
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // vite.config.js
manualChunks(id) {
  if (id.includes('node_modules')) {
    if (id.includes('libsignal') || id.includes('buffer')) {
      return 'crypto-vendor';
    }
    // Keep React and core tools in the main vendor chunk
    return 'vendor';
  }
},
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
      external: [
        'flutterwave-node-v3', 
        'mock-aws-s3',
        'aws-sdk',
        'nock'
      ],
    },
  },
  // Ensure libsignal is NOT excluded here
  optimizeDeps: {
    exclude: ['flutterwave-node-v3', 'aws-sdk'] 
  },
  // Force Vite to bundle libsignal for the browser
  ssr: {
    noExternal: ['libsignal']
  }
})