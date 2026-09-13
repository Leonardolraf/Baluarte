import { useEffect } from 'react';
import { useRoutes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { routes } from '@/routes';
import { applyTheme, useUiStore } from '@/store/uiStore';

/**
 * Raiz da aplicação: resolve as rotas e monta o sistema de toasts.
 * Deve ser renderizada dentro de um Router e do AuthProvider (ver main.tsx).
 */
export default function App() {
  const element = useRoutes(routes);
  const theme = useUiStore((s) => s.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Pular para o conteúdo
      </a>
      {element}
      <Toaster
        position="top-right"
        gutter={8}
        toastOptions={{
          duration: 4000,
          className: 'text-sm',
          style: {
            background: theme === 'dark' ? '#0f172a' : '#ffffff',
            color: theme === 'dark' ? '#f1f5f9' : '#0f172a',
            border: theme === 'dark' ? '1px solid #1e293b' : '1px solid #e2e8f0',
          },
        }}
      />
    </>
  );
}
