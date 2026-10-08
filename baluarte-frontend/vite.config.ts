import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Configuração do Vite para o frontend do Baluarte.
// - Alias `@/` -> `src/` (espelhado em tsconfig.json e vitest.config.ts).
// - Proxy de `/api` para o backend Express (porta 8080) quando os mocks estão desligados.
// - HTTPS opcional no dev server (B06): `DEV_HTTPS=1 npm run dev` usa o certificado gerado
//   por `scripts/gerar-certificados.sh` (o mesmo do Nginx do Docker). Sem a variável, HTTP
//   como sempre — o Playwright e o README usam http://localhost:5173.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:8080';
  const https = env.DEV_HTTPS === '1' ? certificadoDev(env) : undefined;

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
      open: false,
      https,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: 4173,
    },
    build: {
      // Produção não emite source maps: o DevTools do navegador só vê o bundle
      // minificado, sem o TypeScript/JSX original nem a árvore de pastas de `src/`.
      // (No `npm run dev` o Vite serve os fontes com map — isso é o servidor de
      // desenvolvimento local, não o app publicado.)
      sourcemap: mode !== 'production',
      target: 'es2020',
      minify: 'esbuild',
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            vendor: ['axios', 'zustand', 'react-hook-form', 'react-hot-toast', 'jwt-decode', 'clsx'],
          },
        },
      },
    },
    // Remove console.* e debugger do bundle de produção (menos ruído e menos
    // pistas no DevTools); em dev continuam disponíveis.
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : [],
    },
  };
});

// Lê o par certificado/chave do servidor para o dev server. Caminhos padrão: os que o
// script de certificados gera na raiz do repositório; DEV_HTTPS_CERT/DEV_HTTPS_KEY trocam.
function certificadoDev(env: Record<string, string>): { cert: Buffer; key: Buffer } {
  const pasta = fileURLToPath(new URL('../certs/servidor/', import.meta.url));
  const cert = env.DEV_HTTPS_CERT || `${pasta}servidor.crt`;
  const key = env.DEV_HTTPS_KEY || `${pasta}servidor.key`;
  if (!existsSync(cert) || !existsSync(key)) {
    throw new Error(
      `DEV_HTTPS=1, mas o certificado não existe (${cert}). Rode \`sh scripts/gerar-certificados.sh\` na raiz do repositório.`,
    );
  }
  return { cert: readFileSync(cert), key: readFileSync(key) };
}
