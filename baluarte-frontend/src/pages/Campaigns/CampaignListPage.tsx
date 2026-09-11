import { useEffect, useMemo, useState } from 'react';
import type { Campaign, CampaignFilters } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { ErrorState, LinkButton, LoadingSpinner, PageHeader, StatCard, type StatTone } from '@/components';
import { CampaignTable } from '@/components/Table/CampaignTable';
import { MouseClickIcon, PlayIcon, PlusIcon, ShieldIcon, UsersIcon } from '@/components/icons';
import { formatNumber, formatPercent } from '@/lib/format';
import { clickRateSeverity, resilienceSeverity } from '@/lib/severity';

const INITIAL_FILTERS: CampaignFilters = { status: 'all', from: '', to: '', query: '' };
const DEBOUNCE_MS = 300;

/** Retorna `value` somente depois de `delayMs` sem novas alterações (evita uma requisição por tecla). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

interface CampaignSummary {
  total: number;
  active: number;
  /** Soma de `metrics.sent` (colaboradores alcançados). */
  sent: number;
  /** Taxa média de clique ponderada por envios; `null` quando nada foi enviado. */
  clickRate: number | null;
}

function summarize(items: Campaign[]): CampaignSummary {
  let active = 0;
  let sent = 0;
  let weightedClicks = 0;
  for (const campaign of items) {
    if (campaign.status === 'active') active += 1;
    sent += campaign.metrics.sent;
    weightedClicks += campaign.metrics.clickRate * campaign.metrics.sent;
  }
  return { total: items.length, active, sent, clickRate: sent > 0 ? weightedClicks / sent : null };
}

export default function CampaignListPage() {
  const [filters, setFilters] = useState<CampaignFilters>(INITIAL_FILTERS);
  const debouncedQuery = useDebouncedValue(filters.query ?? '', DEBOUNCE_MS);

  const effectiveFilters = useMemo<CampaignFilters>(
    () => ({
      status: filters.status ?? 'all',
      from: filters.from ?? '',
      to: filters.to ?? '',
      query: debouncedQuery.trim(),
    }),
    [filters.status, filters.from, filters.to, debouncedQuery],
  );
  const filtersKey = JSON.stringify(effectiveFilters);

  const { data, error, loading, reload } = useAsync(() => api.listCampaigns(effectiveFilters), [filtersKey], {
    keepPreviousData: true,
  });

  const summary = useMemo(() => summarize(data ?? []), [data]);

  const clickTone: StatTone = summary.clickRate === null ? 'neutral' : clickRateSeverity(summary.clickRate);
  const resilience = summary.clickRate === null ? null : 100 - summary.clickRate;
  const resilienceTone: StatTone = resilience === null ? 'neutral' : resilienceSeverity(resilience);

  return (
    <>
      <PageHeader
        title="Campanhas de phishing"
        description="Simulações controladas com rastreamento individual e treinamento contextual."
        actions={
          <LinkButton to="/campaigns/new" leftIcon={<PlusIcon size={16} />}>
            Nova campanha
          </LinkButton>
        }
      />

      {error && !data ? (
        <ErrorState
          title="Não foi possível carregar as campanhas"
          message={error.message}
          status={error.status}
          onRetry={() => void reload()}
          retrying={loading}
        />
      ) : loading && !data ? (
        <LoadingSpinner label="Carregando campanhas…" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Campanhas ativas"
              value={formatNumber(summary.active)}
              hint={`de ${formatNumber(summary.total)} ${summary.total === 1 ? 'campanha listada' : 'campanhas listadas'}`}
              icon={<PlayIcon size={18} />}
            />
            <StatCard
              label="Taxa média de clique"
              value={summary.clickRate === null ? '—' : formatPercent(summary.clickRate)}
              hint="Ponderada pelos e-mails enviados"
              tone={clickTone}
              icon={<MouseClickIcon size={18} />}
            />
            <StatCard
              label="Colaboradores alcançados"
              value={formatNumber(summary.sent)}
              hint="E-mails de simulação enviados"
              icon={<UsersIcon size={18} />}
            />
            <StatCard
              label="Resiliência média"
              value={resilience === null ? '—' : formatPercent(resilience)}
              hint="Destinatários que não clicaram"
              tone={resilienceTone}
              icon={<ShieldIcon size={18} />}
            />
          </div>

          <CampaignTable
            items={data ?? []}
            loading={loading}
            filters={filters}
            onFiltersChange={setFilters}
          />
        </div>
      )}
    </>
  );
}
