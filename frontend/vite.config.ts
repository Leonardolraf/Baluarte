import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import tailwindConfig from './tailwind.config.js';

// PostCSS/Tailwind sao injetados inline (em vez de depender da descoberta de
// postcss.config.js / tailwind.config.js pelo cwd) para funcionar mesmo quando
// o vite e iniciado de outro diretorio (caso do preview).
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss(tailwindConfig), autoprefixer()],
    },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    proxy: {
      // alvo do proxy configurável por env (localhost no dev, backend:8080 no docker)
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:8080', changeOrigin: true },
    },
  },
});
