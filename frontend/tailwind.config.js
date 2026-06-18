import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Resolve os globs de content relativos a ESTE arquivo (e nao ao cwd do processo),
// para o Tailwind achar as classes mesmo quando o vite e iniciado de outro diretorio.
const aqui = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(aqui, 'index.html'), join(aqui, 'src/**/*.{ts,tsx}')],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        brand: { DEFAULT: '#2563eb', dark: '#1d4ed8' },
        sev: {
          critico: '#dc2626',
          alto: '#f97316',
          medio: '#a16207',
          baixo: '#16a34a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
