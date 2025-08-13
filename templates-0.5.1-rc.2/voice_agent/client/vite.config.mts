import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import viteTsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  build: {
    outDir: 'build',
  },
  plugins: [
    react(),
    viteTsconfigPaths(),
  ],
  server: {
    open: true,
    port: 3000,
    host: true,
  },
});
