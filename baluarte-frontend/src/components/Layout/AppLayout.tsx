import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { Topbar } from '@/components/Layout/Topbar';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ACK_REQUIRED_EVENT } from '@/lib/events';
import { useGlobalLoading } from '@/store/uiStore';

export const MONITORING_NOTICE_PATH = '/monitoring';

/**
 * Shell autenticado: sidebar + topbar + área de conteúdo.
 *
 * Enquanto falta a ciência do aviso de monitoramento na versão em vigor, o servidor responde
 * 403 CIENCIA_AVISO_PENDENTE em toda rota autenticada (gate da "opção C", 19/10/2026). Aqui a
 * tela reage levando a pessoa ao aviso e guardando de onde ela veio, para voltar depois de
 * registrar. O banner que antes só avisava saiu: com o gate, não há navegação para avisar —
 * ou a pessoa dá ciência, ou nada carrega.
 */
export function AppLayout() {
  const globalLoading = useGlobalLoading();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const aoExigirCiencia = () => {
      if (location.pathname === MONITORING_NOTICE_PATH) return;
      navigate(MONITORING_NOTICE_PATH, { replace: true, state: { from: location } });
    };
    window.addEventListener(ACK_REQUIRED_EVENT, aoExigirCiencia);
    return () => window.removeEventListener(ACK_REQUIRED_EVENT, aoExigirCiencia);
  }, [location, navigate]);

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
