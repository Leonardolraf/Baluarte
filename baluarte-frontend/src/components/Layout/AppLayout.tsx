import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { Topbar } from '@/components/Layout/Topbar';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useGlobalLoading } from '@/store/uiStore';

/** Shell autenticado: sidebar + topbar + área de conteúdo. */
export function AppLayout() {
  const globalLoading = useGlobalLoading();
  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-slate-950">
      <Sidebar />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8" tabIndex={-1}>
          <Outlet />
        </main>
        {globalLoading && <LoadingSpinner overlay label="Processando…" />}
      </div>
    </div>
  );
}
