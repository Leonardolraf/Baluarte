import { useEffect, useId, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SEVERITIES, VULNERABILITY_STATUSES, type Vulnerability, type VulnerabilityFilters } from '@/types';
import { useSort, type SortAccessor } from '@/hooks/useSort';
import { usePagination } from '@/hooks/usePagination';
import { SEVERITY_LABEL, SEVERITY_RANK, VULN_STATUS_CLASS, VULN_STATUS_LABEL } from '@/lib/severity';
import { formatCvss, formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { SeverityBadge } from '@/components/Badge/SeverityBadge';
import { Skeleton } from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/Button';
import { FormField, Input, Select } from '@/components/ui/Field';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  Pagination,
  Table,
  TableContainer,
  TableEmptyRow,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/Table';
import { CloseIcon, SearchIcon } from '@/components/icons';

// Tabela de vulnerabilidades (estilo VirusTotal): densa, neutra, monoespaçado para CVE/host/CVSS.
// Os filtros são controlados pela página (que consulta a API); aqui só ordenamos e paginamos.

export interface VulnTableProps {
  items: Vulnerability[];
  /** Sem itens: linhas de esqueleto. Com itens: tabela marcada como ocupada (recarregando). */
  loading?: boolean;
  /** Controlado pela página. */
  filters: VulnerabilityFilters;
  onFiltersChange: (filters: VulnerabilityFilters) => void;
  /** Padrão: navega para `/vulnerabilities/:id`. */
  onRowClick?: (vuln: Vulnerability) => void;
  /** Padrão 10. */
  pageSize?: number;
  /** Dashboard usa sem barra de filtros. */
  hideFilters?: boolean;
  emptyMessage?: string;
}

type SortKey = 'severity' | 'title' | 'cvss' | 'detectedAt';

const COLUMN_COUNT = 7;
const SKELETON_ROWS = 5;
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50];
const EMPTY_FILTERS: VulnerabilityFilters = { severity: 'all', status: 'all', query: '' };

function toTime(value: string): number | null {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

const SORT_ACCESSORS: Record<SortKey, SortAccessor<Vulnerability>> = {
  // Rank da severidade primeiro (crítico = 0); pontuação CVSS como desempate (maior primeiro).
  severity: (vuln) => SEVERITY_RANK[vuln.severity] * 100 + (10 - vuln.cvss.base),
  title: (vuln) => vuln.title,
  cvss: (vuln) => vuln.cvss.base,
  detectedAt: (vuln) => toTime(vuln.detectedAt),
};

function hasActiveFilters(filters: VulnerabilityFilters): boolean {
  return (
    (filters.severity ?? 'all') !== 'all' ||
    (filters.status ?? 'all') !== 'all' ||
    (filters.query ?? '').trim() !== ''
  );
}

interface FilterBarProps {
  filters: VulnerabilityFilters;
  onFiltersChange: (filters: VulnerabilityFilters) => void;
}

function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  const baseId = useId();
  const queryId = `${baseId}-query`;
  const severityId = `${baseId}-severity`;
  const statusId = `${baseId}-status`;
  const active = hasActiveFilters(filters);

  return (
    // Ritmo (DESIGN.md): inset de 20 px como o cabeçalho do cartão e a primeira célula; campos a 20 px.
    <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_11rem_11rem_auto] lg:items-end">
        <FormField label="Buscar" htmlFor={queryId} className="sm:col-span-2 lg:col-span-1">
          <div className="relative">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            />
            <Input
              id={queryId}
              type="search"
              mono
              autoComplete="off"
              className="pl-9"
              placeholder="Título, CVE, ativo ou componente"
              value={filters.query ?? ''}
              onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
            />
          </div>
        </FormField>

        <FormField label="Severidade" htmlFor={severityId}>
          <Select
            id={severityId}
            value={filters.severity ?? 'all'}
            onChange={(event) => {
              const value = event.target.value;
              onFiltersChange({ ...filters, severity: SEVERITIES.find((s) => s === value) ?? 'all' });
            }}
          >
            <option value="all">Todas</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {SEVERITY_LABEL[severity]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Status" htmlFor={statusId}>
          <Select
            id={statusId}
            value={filters.status ?? 'all'}
            onChange={(event) => {
              const value = event.target.value;
              onFiltersChange({
                ...filters,
                status: VULNERABILITY_STATUSES.find((s) => s === value) ?? 'all',
              });
            }}
          >
            <option value="all">Todos</option>
            {VULNERABILITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {VULN_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
        </FormField>

        {/* 38 px = altura do `.input-base` (py-2 + 20 de linha + bordas); o botão md (40 px) sairia 2 px do alinhamento. */}
        <Button
          variant="outline"

          leftIcon={<CloseIcon size={14} />}
          disabled={!active}
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
        >
          Limpar
        </Button>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <Tr>
      <Td>
        <Skeleton className="h-5 w-16 rounded-full" />
      </Td>
      <Td>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-1.5 h-3 w-28" />
      </Td>
      <Td>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-1.5 h-3 w-36" />
      </Td>
      <Td className="hidden 2xl:table-cell">
        <Skeleton className="h-4 w-40" />
      </Td>
      <Td align="right">
        <Skeleton className="ml-auto h-4 w-8" />
      </Td>
      <Td>
        <Skeleton className="h-5 w-20 rounded-full" />
      </Td>
      <Td>
        <Skeleton className="h-4 w-16" />
      </Td>
    </Tr>
  );
}

interface VulnRowProps {
  vuln: Vulnerability;
  onClick: () => void;
}

function VulnRow({ vuln, onClick }: VulnRowProps) {
  return (
    <Tr interactive onClick={onClick} data-testid="vuln-row" data-id={vuln.id}>
      <Td>
        <SeverityBadge severity={vuln.severity} />
      </Td>
      <Td className="min-w-[16rem]">
        <div>
          {/* O link dá nome, papel e destino ao teclado/leitor de tela; o clique na linha fica para o mouse. */}
          <Link
            to={`/vulnerabilities/${vuln.id}`}
            className="font-medium text-ink hover:underline dark:text-white"
            onClick={(event) => event.stopPropagation()}
          >
            {vuln.title}
          </Link>
        </div>
        <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
          {vuln.cve ?? vuln.affectedComponent}
        </div>
      </Td>
      <Td>
        <div className="text-slate-700 dark:text-slate-200">{vuln.assetName}</div>
        <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">{vuln.assetHost}</div>
      </Td>
      <Td className="hidden min-w-[12rem] 2xl:table-cell">
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{vuln.owaspId}</span>
        <span className="ml-1.5 text-slate-700 dark:text-slate-200">{vuln.owaspCategory}</span>
      </Td>
      <Td
        align="right"
        className="font-mono text-sm font-semibold tabular-nums text-ink dark:text-white"
        title={vuln.cvss.vector}
      >
        {formatCvss(vuln.cvss.base)}
      </Td>
      <Td>
        <StatusPill label={VULN_STATUS_LABEL[vuln.status]} colorClass={VULN_STATUS_CLASS[vuln.status]} />
      </Td>
      <Td className="whitespace-nowrap">
        <time dateTime={vuln.detectedAt} title={formatDateTime(vuln.detectedAt)}>
          {formatRelative(vuln.detectedAt)}
        </time>
      </Td>
    </Tr>
  );
}

export function VulnTable({
  items,
  loading = false,
  filters,
  onFiltersChange,
  onRowClick,
  pageSize = 10,
  hideFilters = false,
  emptyMessage = 'Nenhuma vulnerabilidade encontrada.',
}: VulnTableProps) {
  const navigate = useNavigate();
  const { sorted, toggle, directionOf } = useSort(items, SORT_ACCESSORS, {
    key: 'severity',
    direction: 'asc',
  });
  const {
    page,
    pageSize: currentPageSize,
    total,
    pageItems,
    setPage,
    setPageSize,
  } = usePagination(sorted, pageSize);

  // Mudou o filtro → volta para a primeira página (a ordenação é preservada).
  const filtersKey = JSON.stringify([
    filters.severity ?? 'all',
    filters.status ?? 'all',
    filters.query ?? '',
  ]);
  const setPageRef = useRef(setPage);
  setPageRef.current = setPage;
  useEffect(() => {
    setPageRef.current(1);
  }, [filtersKey]);

  const pageSizeOptions = useMemo(
    () => Array.from(new Set([pageSize, ...DEFAULT_PAGE_SIZE_OPTIONS])).sort((a, b) => a - b),
    [pageSize],
  );

  const handleRowClick = (vuln: Vulnerability) => {
    if (onRowClick) onRowClick(vuln);
    else navigate(`/vulnerabilities/${vuln.id}`);
  };

  const showSkeleton = loading && items.length === 0;
  const showEmpty = !showSkeleton && total === 0;
  const filtersActive = !hideFilters && hasActiveFilters(filters);

  return (
    <div className="surface overflow-hidden" aria-busy={loading || undefined} data-testid="vuln-table">
      {!hideFilters && <FilterBar filters={filters} onFiltersChange={onFiltersChange} />}

      <TableContainer bare>
        <Table>
          <THead>
            <tr>
              <Th sortable sorted={directionOf('severity')} onSort={() => toggle('severity')}>
                Severidade
              </Th>
              <Th sortable sorted={directionOf('title')} onSort={() => toggle('title')}>
                Título
              </Th>
              <Th>Ativo</Th>
              {/* Prioridade de colunas: com a barra lateral aberta, as 7 colunas só cabem a partir de 2xl
                  (o `main` é limitado a max-w-7xl; em 1280 px sobram 976 px para ~1084 px de conteúdo mínimo).
                  A categoria OWASP é a menos usada na varredura visual e já aparece no detalhe. */}
              <Th className="hidden 2xl:table-cell">Categoria OWASP</Th>
              <Th align="right" sortable sorted={directionOf('cvss')} onSort={() => toggle('cvss')}>
                CVSS
              </Th>
              <Th>Status</Th>
              <Th sortable sorted={directionOf('detectedAt')} onSort={() => toggle('detectedAt')}>
                Detectado em
              </Th>
            </tr>
          </THead>
          <TBody className={cn(loading && !showSkeleton && 'opacity-60 transition-opacity')}>
            {showSkeleton ? (
              Array.from({ length: Math.min(SKELETON_ROWS, pageSize) }, (_, index) => (
                <SkeletonRow key={index} />
              ))
            ) : showEmpty ? (
              <TableEmptyRow colSpan={COLUMN_COUNT}>
                <p>{emptyMessage}</p>
                {filtersActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => onFiltersChange(EMPTY_FILTERS)}
                  >
                    Limpar filtros
                  </Button>
                )}
              </TableEmptyRow>
            ) : (
              pageItems.map((vuln) => (
                <VulnRow key={vuln.id} vuln={vuln} onClick={() => handleRowClick(vuln)} />
              ))
            )}
          </TBody>
        </Table>
      </TableContainer>

      {loading && (
        <p role="status" className="sr-only">
          Carregando vulnerabilidades…
        </p>
      )}

      {total > pageSize && (
        <Pagination
          page={page}
          pageSize={currentPageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={pageSizeOptions}
        />
      )}
    </div>
  );
}
