import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths: the build runs from a domain root, a sub-folder or an embedded host alike.
  base: './',
  server: { port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
