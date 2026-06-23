import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/stream': 'http://localhost:3000',
      '/subtitle': 'http://localhost:3000',
      '/peerjs': { target: 'http://localhost:9000', ws: true },
      '/api': 'http://localhost:3000',
    },
  },
});
