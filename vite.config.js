import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      include: ['buffer', 'process'],
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
        // Use granular chunking to prevent "race conditions"
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Isolate core framework to ensure it loads before dynamic components
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'framework';
            }
            // Group heavy crypto/signal libs together
            if (id.includes('libsignal') || id.includes('buffer')) {
              return 'crypto-vendor';
            }
            // General vendor fallback
            return 'vendor';
          }
        },
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      },
      // IMPORTANT: Be careful with externalizing modules
      // Externalizing modules that have dependencies on your internal code 
      // is the #1 cause of ReferenceErrors in production builds.
      external: [
        'flutterwave-node-v3', 
        'mock-aws-s3',
        'aws-sdk',
        'nock'
      ],
    },
  },
  optimizeDeps: {
    // Ensure these are processed by Vite's pre-bundler
    include: ['libsignal', 'simple-peer'],
    exclude: ['flutterwave-node-v3', 'aws-sdk'] 
  },
  ssr: {
    // Explicitly tell Vite to bundle these for the browser
    noExternal: ['libsignal', 'simple-peer', '@livekit/components-react']
  }
});