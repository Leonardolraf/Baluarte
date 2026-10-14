import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  SEVERITIES,
  VULN_PAGE_SIZE,
  type SortState,
  type VulnerabilityFilters,
  type VulnerabilitySortKey,
  type VulnerabilitySummary,
} from '@/types';
import { USE_MOCKS, api } from '@/services/api';
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
/** Tamanhos de página oferecidos (o servidor aceita até 100). */
const PAGE_SIZE_OPTIONS = [10, VULN_PAGE_SIZE, 50, 100];
/** Começa pelas mais graves, como antes da paginação no servidor. */
const INITIAL_SORT: SortState<VulnerabilitySortKey> = { key: 'severity', direction: 'asc' };

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
/** Formatos oferecidos pelo menu Exportar (melhoria 17). */
type ReportFormat = 'pdf' | 'xlsx';

function useReportExport(filters: VulnerabilityFilters) {
  // Guarda QUAL formato está sendo gerado: o botão mostra o estado certo.
  const [exporting, setExporting] = useState<ReportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportReport(format: ReportFormat = 'pdf') {
    setExporting(format);
    setExportError(null);
    try {
      const { blob, filename } =
        format === 'xlsx'
          ? await api.exportVulnerabilityReportExcel(filters)
          : await api.exportVulnerabilityReport(filters);
      saveBlob(blob, filename);
      notify.success(`Relatório gerado: ${filename}`);
    } catch (error) {
      const rotulo = format === 'xlsx' ? 'Excel' : 'PDF';
      setExportError(errorMessage(error, `Não foi possível gerar o relatório em ${rotulo}.`));
    } finally {
      setExporting(null);
    }
  }

  return { exporting, exportError, exportReport };
}

/**
 * Menu "Exportar" (melhoria 17): PDF e Excel com os filtros da tela. Teclado completo
 * (setas e Esc devolvendo o foco ao botão) porque é um menu, não um dropdown decorativo.
 */
function ExportMenu({
  exporting,
  disabled,
  disabledReason,
  onExport,
}: {
  exporting: ReportFormat | null;
  disabled: boolean;
  disabledReason?: string;
  onExport: (format: ReportFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [open]);

  useEffect(() => {
    if (open) itemsRef.current.find((el) => el && !el.disabled)?.focus();
  }, [open]);

  function fechar(devolverFoco = true) {
    setOpen(false);
    if (devolverFoco) buttonRef.current?.focus();
  }

  const opcoes: { format: ReportFormat; label: string; indisponivel?: string }[] = [
    { format: 'pdf', label: 'PDF' },
    {
      format: 'xlsx',
      label: 'Excel (.xlsx)',
      // O .xlsx é gerado no servidor (exceljs); no modo de demonstração não há servidor.
      indisponivel: USE_MOCKS ? 'Só com a API real' : undefined,
    },
  ];

  function mover(passo: number) {
    const itens = itemsRef.current.filter((el): el is HTMLButtonElement => Boolean(el) && !el!.disabled);
    if (itens.length === 0) return;
    const atual = itens.findIndex((el) => el === document.activeElement);
    itens[(atual + passo + itens.length) % itens.length]?.focus();
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        ref={buttonRef}
        variant="outline"
        leftIcon={<DownloadIcon size={16} />}
        loading={exporting !== null}
        disabled={disabled}
        title={disabledReason}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="export-menu-button"
        onClick={() => setOpen((v) => !v)}
      >
        {exporting ? `Gerando ${exporting === 'xlsx' ? 'Excel' : 'PDF'}…` : 'Exportar'}
      </Button>

      {open && (
        <div
          role="menu"
          tabIndex={-1}
          aria-label="Formato do relatório"
          data-testid="export-menu"
          className="absolute right-0 z-20 mt-1 min-w-[14rem] overflow-hidden rounded-plate border border-slate-200 bg-white py-1 shadow-card dark:border-slate-800 dark:bg-slate-900"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              fechar();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              mover(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              mover(-1);
            } else if (event.key === 'Tab') {
              setOpen(false);
            }
          }}
        >
          {opcoes.map((opcao, indice) => (
            <button
              key={opcao.format}
              ref={(el) => {
                itemsRef.current[indice] = el;
              }}
              type="button"
              role="menuitem"
              disabled={Boolean(opcao.indisponivel)}
              title={opcao.indisponivel}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-ink hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-slate-400 dark:text-white dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800 dark:disabled:text-slate-500"
              onClick={() => {
                fechar(false);
                onExport(opcao.format);
              }}
            >
              <span>{opcao.label}</span>
              {opcao.indisponivel && (
                <span className="text-xs text-slate-500 dark:text-slate-400">{opcao.indisponivel}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
      // Melhoria 16: o ativo escolhido vai para a lista e, abaixo, para o PDF e o Excel.
      assetId: filters.assetId,
    }),
    [filters.severity, filters.status, debouncedQuery, filters.assetId],
  );
  const filtersKey = JSON.stringify(effectiveFilters);

  // Paginação e ordenação no servidor (B25): a API devolve uma página e o resumo do filtro inteiro.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(VULN_PAGE_SIZE);
  const [sort, setSort] = useState<SortState<VulnerabilitySortKey> | null>(INITIAL_SORT);

  // Filtro novo → primeira página (a ordenação é preservada).
  const lastFiltersKey = useRef(filtersKey);
  if (lastFiltersKey.current !== filtersKey) {
    lastFiltersKey.current = filtersKey;
    if (page !== 1) setPage(1);
  }

  // keepPreviousData: a tabela (e o campo de busca focado) continua montada durante os refetches por filtro;
  // o spinner de página aparece só no primeiro carregamento.
  const { data, error, loading, reload } = useAsync(
    () => api.listVulnerabilities(effectiveFilters, { page, pageSize, sort }),
    [filtersKey, page, pageSize, JSON.stringify(sort)],
    { keepPreviousData: true },
  );

  // A lista encolheu (ex.: achados resolvidos) e a página ficou além da última: volta para a última.
  const lastPage = data ? Math.max(1, Math.ceil(data.summary.total / data.pageSize)) : 1;
  useEffect(() => {
    if (data && data.items.length === 0 && page > lastPage) setPage(lastPage);
  }, [data, page, lastPage]);

  // O relatório usa os filtros que estão na tela agora (a busca sem esperar o debounce).
  const { exporting, exportError, exportReport } = useReportExport({
    severity: filters.severity ?? 'all',
    status: filters.status ?? 'all',
    query: query.trim(),
    assetId: filters.assetId,
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
            <ExportMenu
              exporting={exporting}
              disabled={nothingToExport}
              disabledReason={nothingToExport ? 'Nenhuma vulnerabilidade com os filtros atuais' : undefined}
              onExport={(format) => void exportReport(format)}
            />
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
          server={{
            page,
            pageSize,
            total: data?.summary.total ?? 0,
            sort,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            onPageChange: (next) => setPage(Math.max(1, Math.min(next, lastPage))),
            onPageSizeChange: (size) => {
              setPageSize(size);
              setPage(1);
            },
            onSortChange: (next) => {
              setSort(next);
              setPage(1);
            },
          }}
        />
      )}
    </div>
  );
}
