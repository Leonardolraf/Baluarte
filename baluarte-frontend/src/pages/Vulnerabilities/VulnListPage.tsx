import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SEVERITIES, type VulnerabilityFilters, type VulnerabilitySummary } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { SEVERITY_LABEL } from '@/lib/severity';
import { formatNumber } from '@/lib/format';
import { ErrorState, LinkButton, LoadingSpinner, PageHeader, SeverityBadge, Skeleton } from '@/components';
import { VulnTable } from '@/components/Table/VulnTable';
import { ServerIcon } from '@/components/icons';

const QUERY_PARAM = 'q';
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

function plural(count: number, singular: string, pluralForm: string): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

function SummaryMeta({ summary }: { summary: VulnerabilitySummary }) {
  return (
    <>
      <span className="text-sm text-slate-600 dark:text-slate-300">
        {plural(summary.total, 'vulnerabilidade', 'vulnerabilidades')} em{' '}
        {plural(summary.assets, 'ativo', 'ativos')}
      </span>
      {SEVERITIES.filter((severity) => summary.bySeverity[severity] > 0).map((severity) => (
        <SeverityBadge
          key={severity}
          severity={severity}
          dot
          label={`${SEVERITY_LABEL[severity]} · ${formatNumber(summary.bySeverity[severity])}`}
        />
      ))}
    </>
  );
}

export default function VulnListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get(QUERY_PARAM) ?? '';

  const [filters, setFilters] = useState<VulnerabilityFilters>(() => ({
    severity: 'all',
    status: 'all',
    query: urlQuery,
  }));

  // Última busca sincronizada entre estado e URL — evita que os dois efeitos abaixo se realimentem.
  const lastSyncedQuery = useRef(urlQuery);
  const query = filters.query ?? '';

  // Estado → URL: mantém `?q=` atualizado (replace, para não poluir o histórico).
  useEffect(() => {
    if (query === lastSyncedQuery.current) return;
    lastSyncedQuery.current = query;
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (query) next.set(QUERY_PARAM, query);
        else next.delete(QUERY_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [query, setSearchParams]);

  // URL → estado: a busca global do topo navega para `/vulnerabilities?q=` mesmo com a página já aberta.
  useEffect(() => {
    if (urlQuery === lastSyncedQuery.current) return;
    lastSyncedQuery.current = urlQuery;
    setFilters((previous) => ({ ...previous, query: urlQuery }));
  }, [urlQuery]);

  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  const effectiveFilters = useMemo<VulnerabilityFilters>(
    () => ({
      severity: filters.severity ?? 'all',
      status: filters.status ?? 'all',
      query: debouncedQuery.trim(),
    }),
    [filters.severity, filters.status, debouncedQuery],
  );
  const filtersKey = JSON.stringify(effectiveFilters);

  // keepPreviousData: a tabela (e o campo de busca focado) continua montada durante os refetches por filtro;
  // o spinner de página aparece só no primeiro carregamento.
  const { data, error, loading, reload } = useAsync(
    () => api.listVulnerabilities(effectiveFilters),
    [filtersKey],
    { keepPreviousData: true },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vulnerabilidades"
        description="Achados das varreduras OWASP Top 10 com pontuação CVSS v3.1."
        actions={
          <LinkButton to="/assets/new" variant="outline" leftIcon={<ServerIcon size={16} />}>
            Cadastrar ativo
          </LinkButton>
        }
        meta={
          data ? <SummaryMeta summary={data.summary} /> : loading ? <Skeleton className="h-5 w-56" /> : null
        }
      />

      {error ? (
        <ErrorState
          status={error.status}
          message={error.message}
          onRetry={() => void reload()}
          retrying={loading}
        />
      ) : loading && !data ? (
        <LoadingSpinner label="Carregando vulnerabilidades…" />
      ) : (
        <VulnTable
          items={data?.items ?? []}
          loading={loading}
          filters={filters}
          onFiltersChange={setFilters}
        />
      )}
    </div>
  );
}
