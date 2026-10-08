import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/AuthContext';
import { MONITORING_ACK_EVENT, type MonitoringAckDetail } from '@/lib/events';
import { InfoIcon } from '@/components/icons';

export const MONITORING_NOTICE_PATH = '/monitoring';

/**
 * Faixa discreta no topo do conteúdo enquanto o usuário não registrou a ciência da versão
 * atual do aviso de monitoramento da estação (B18). Some na própria página do aviso e assim
 * que a ciência é registrada (evento `MONITORING_ACK_EVENT`). Neutra de propósito: não é
 * risco, então não leva cor (DESIGN.md). Falha ao consultar a API não mostra nada: o aviso
 * continua acessível pelo menu.
 */
export function MonitoringNoticeBanner() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { data, setData } = useAsync(() => api.getMonitoringNotice(), [user?.id]);

  useEffect(() => {
    const onAcknowledged = (event: Event) => {
      const detail = (event as CustomEvent<MonitoringAckDetail>).detail;
      setData((previous) =>
        previous && previous.version === detail.version
          ? { ...previous, acknowledged: true, acknowledgedAt: detail.acknowledgedAt }
          : previous,
      );
    };
    window.addEventListener(MONITORING_ACK_EVENT, onAcknowledged);
    return () => window.removeEventListener(MONITORING_ACK_EVENT, onAcknowledged);
  }, [setData]);

  if (!data || data.acknowledged || pathname === MONITORING_NOTICE_PATH) return null;

  return (
    <div
      data-testid="monitoring-banner"
      className="mb-6 flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2">
        <InfoIcon
          size={16}
          className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400"
          aria-hidden="true"
        />
        <span>
          As estações de trabalho da empresa são monitoradas pelo agente de segurança. Leia o que é coletado e
          registre a sua ciência.
        </span>
      </p>
      <Link
        to={MONITORING_NOTICE_PATH}
        className="shrink-0 font-medium text-ink underline underline-offset-4 hover:no-underline dark:text-white"
      >
        Ler o aviso de monitoramento
      </Link>
    </div>
  );
}
