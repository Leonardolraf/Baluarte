import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SEVERITIES, type VulnerabilityFilters, type VulnerabilitySummary } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/useAuth';
import { saveBlob } from '@/lib/download';
import { errorMessage } from '@/lib/errors';
import { VULNERABILITY_REPORT_ROLES } from '@/lib/roles';
import { SEVERITY_LABEL } from '@/lib/severity';
import { formatNumber } from '@/lib/format';
import { notify } from '@/store/uiStore';
import {
  Button,
  ErrorState,
  FormErrorBanner,
  LoadingSpinner,
  PageHeader,
  SeverityBadge,
  Skeleton,
} from '@/components';
import { DownloadIcon } from '@/components/icons';
import { VulnTable } from '@/components/Table/VulnTable';

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

/**
 * Exportar o relatório em PDF (B24) com os filtros ativos na tela. O arquivo é gerado no
 * servidor (que também registra a exportação na auditoria) e baixado pelo cliente da API.
 */
function useReportExport(filters: VulnerabilityFilters) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportReport() {
    setExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await api.exportVulnerabilityReport(filters);
      saveBlob(blob, filename);
      notify.success(`Relatório gerado: ${filename}`);
    } catch (error) {
      setExportError(errorMessage(error, 'Não foi possível gerar o relatório em PDF.'));
    } finally {
      setExporting(false);
    }
  }

  return { exporting, exportError, exportReport };
}

export default function VulnListPage() {
  const { hasRole } = useAuth();
  const canExport = hasRole(...VULNERABILITY_REPORT_ROLES);
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

  // O relatório usa os filtros que estão na tela agora (a busca sem esperar o debounce).
  const { exporting, exportError, exportReport } = useReportExport({
    severity: filters.severity ?? 'all',
    status: filters.status ?? 'all',
    query: query.trim(),
  });
  const nothingToExport = !data || data.summary.total === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vulnerabilidades"
        description="Achados das varreduras OWASP Top 10 com pontuação CVSS v3.1."
        meta={
          data ? <SummaryMeta summary={data.summary} /> : loading ? <Skeleton className="h-5 w-56" /> : null
        }
        actions={
          canExport ? (
            <Button
              variant="outline"
              leftIcon={<DownloadIcon size={16} />}
              loading={exporting}
              disabled={nothingToExport}
              title={nothingToExport ? 'Nenhuma vulnerabilidade com os filtros atuais' : undefined}
              onClick={() => void exportReport()}
            >
              {exporting ? 'Gerando PDF…' : 'Exportar PDF'}
            </Button>
          ) : null
        }
      />

      <FormErrorBanner message={exportError} />

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
