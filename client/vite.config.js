import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://server:3042',
      '/socket.io': {
        target: 'http://server:3042',
        ws: true
      },
      '/uploads': 'http://server:3042'
    }
  }
});
