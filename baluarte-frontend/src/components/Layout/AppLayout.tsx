import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TERMS_REQUIRED_EVENT } from '@/lib/events';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { Topbar } from '@/components/Layout/Topbar';
import { MonitoringNoticeBanner } from '@/components/Layout/MonitoringNoticeBanner';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useGlobalLoading } from '@/store/uiStore';

/** Shell autenticado: sidebar + topbar + área de conteúdo (com o aviso de monitoramento pendente, B18). */
/**
 * Melhorias #5: a API recusa as rotas autenticadas com 403 TERMOS_NAO_ACEITOS enquanto o
 * aceite falta. O cliente HTTP emite TERMS_REQUIRED_EVENT nesse caso (e não o de 403 comum),
 * e aqui a pessoa é levada à única tela que resolve — guardando de onde veio, para voltar
 * depois do aceite. Sem isto, a tela de origem ficaria em erro sem saída.
 */
function useRedirecionaParaTermos(): void {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      if (location.pathname === '/termos') return;
      navigate('/termos', { replace: true, state: { from: location } });
    };
    window.addEventListener(TERMS_REQUIRED_EVENT, handler);
    return () => window.removeEventListener(TERMS_REQUIRED_EVENT, handler);
  }, [navigate, location]);
}

export function AppLayout() {
  const globalLoading = useGlobalLoading();
  useRedirecionaParaTermos();
  return (
    <div className="flex min-h-screen bg-slate-100 dark:bg-slate-950">
      <Sidebar />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6 lg:p-8" tabIndex={-1}>
          <MonitoringNoticeBanner />
          <Outlet />
        </main>
        {globalLoading && <LoadingSpinner overlay label="Processando…" />}
      </div>
    </div>
  );
}
