import { useEffect, useId, useMemo, useRef, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CAMPAIGN_STATUSES, type Campaign, type CampaignFilters, type CampaignStatus } from '@/types';
import { useSort, type SortAccessor } from '@/hooks/useSort';
import { usePagination } from '@/hooks/usePagination';
import {
  CAMPAIGN_STATUS_CLASS,
  CAMPAIGN_STATUS_DOT_CLASS,
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_TEMPLATE_LABEL,
  clickRateSeverity,
  SEVERITY_DOT_CLASS,
  SEVERITY_TEXT_CLASS,
} from '@/lib/severity';
import { formatDateTime, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
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
import {
  CalendarIcon,
  CheckCircleIcon,
  CloseIcon,
  EditIcon,
  PlayIcon,
  SearchIcon,
  XCircleIcon,
  type IconProps,
} from '@/components/icons';

// Tabela de campanhas de phishing: densa e neutra; a única cor de acento é a taxa de clique
// (régua de severidade) — verde/laranja/vermelho vêm exclusivamente de `@/lib/severity`.
// Prioridade de colunas: "Treinados" só a partir de xl e "Abertos" só a partir de 2xl — a 1280 px
// as sete colunas não cabem no cartão e a "Agendada para" ficava cortada.

export interface CampaignTableProps {
  items: Campaign[];
  /** Sem itens: linhas de esqueleto. Com itens: tabela marcada como ocupada (recarregando). */
  loading?: boolean;
  /** Controlado pela página: status, from, to (yyyy-mm-dd), query. */
  filters: CampaignFilters;
  onFiltersChange: (filters: CampaignFilters) => void;
  /** Padrão: navega para `/campaigns/:id`. */
  onRowClick?: (campaign: Campaign) => void;
  /** Padrão 10. */
  pageSize?: number;
  hideFilters?: boolean;
  emptyMessage?: string;
}

type SortKey = 'name' | 'status' | 'sent' | 'openRate' | 'clickRate' | 'trainedRate' | 'scheduledAt';

const COLUMN_COUNT = 7;
const SKELETON_ROWS = 5;
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50];
const EMPTY_FILTERS: CampaignFilters = { status: 'all', from: '', to: '', query: '' };

const STATUS_ICON: Record<CampaignStatus, (props: IconProps) => ReactElement> = {
  draft: EditIcon,
  scheduled: CalendarIcon,
  active: PlayIcon,
  completed: CheckCircleIcon,
  cancelled: XCircleIcon,
};

function toTime(value: string): number | null {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** Taxas só fazem sentido depois do disparo; treinamento só para quem clicou. */
function hasSends(campaign: Campaign): boolean {
  return campaign.metrics.sent > 0;
}

function hasClicks(campaign: Campaign): boolean {
  return hasSends(campaign) && campaign.metrics.clicked > 0;
}

const SORT_ACCESSORS: Record<SortKey, SortAccessor<Campaign>> = {
  name: (campaign) => campaign.name,
  status: (campaign) => CAMPAIGN_STATUS_LABEL[campaign.status],
  sent: (campaign) => campaign.metrics.sent,
  openRate: (campaign) => (hasSends(campaign) ? campaign.metrics.openRate : null),
  clickRate: (campaign) => (hasSends(campaign) ? campaign.metrics.clickRate : null),
  trainedRate: (campaign) => (hasClicks(campaign) ? campaign.metrics.trainedRate : null),
  scheduledAt: (campaign) => toTime(campaign.scheduledAt),
};

function hasActiveFilters(filters: CampaignFilters): boolean {
  return (
    (filters.status ?? 'all') !== 'all' ||
    (filters.from ?? '') !== '' ||
    (filters.to ?? '') !== '' ||
    (filters.query ?? '').trim() !== ''
  );
}

interface FilterBarProps {
  filters: CampaignFilters;
  onFiltersChange: (filters: CampaignFilters) => void;
}

function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  const baseId = useId();
  const queryId = `${baseId}-query`;
  const statusId = `${baseId}-status`;
  const fromId = `${baseId}-from`;
  const toId = `${baseId}-to`;
  const active = hasActiveFilters(filters);

  return (
    <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(0,1fr)_10rem_10rem_10rem_auto]">
        <FormField label="Buscar" htmlFor={queryId} className="sm:col-span-2 xl:col-span-1">
          <div className="relative">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            />
            <Input
              id={queryId}
              type="search"
              autoComplete="off"
              className="pl-9"
              placeholder="Nome ou grupo-alvo"
              value={filters.query ?? ''}
              onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
            />
          </div>
        </FormField>

        <FormField label="Status" htmlFor={statusId}>
          <Select
            id={statusId}
            value={filters.status ?? 'all'}
            onChange={(event) => {
              const value = event.target.value;
              onFiltersChange({ ...filters, status: CAMPAIGN_STATUSES.find((s) => s === value) ?? 'all' });
            }}
          >
            <option value="all">Todos</option>
            {CAMPAIGN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CAMPAIGN_STATUS_LABEL[status]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="De" htmlFor={fromId}>
          <Input
            id={fromId}
            type="date"
            value={filters.from ?? ''}
            max={filters.to || undefined}
            onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })}
          />
        </FormField>

        <FormField label="Até" htmlFor={toId}>
          <Input
            id={toId}
            type="date"
            value={filters.to ?? ''}
            min={filters.from || undefined}
            onChange={(event) => onFiltersChange({ ...filters, to: event.target.value })}
          />
        </FormField>

        <Button
          variant="outline"
          className="justify-self-start"
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

interface RateCellProps {
  /** Percentual 0–100. */
  value: number;
  /** `false` exibe "—" (campanha ainda sem envios/cliques). */
  available: boolean;
  /** Classe de cor do número (padrão neutro). */
  textClass?: string;
  /** Classe de cor do preenchimento da barra (padrão neutro). */
  barClass?: string;
  /** Classes extras da célula (ex.: visibilidade por breakpoint, igual ao `Th`). */
  className?: string;
}

/** Percentual com mini barra de progresso horizontal. */
function RateCell({
  value,
  available,
  textClass = 'text-slate-700 dark:text-slate-200',
  barClass = 'bg-slate-500 dark:bg-slate-400',
  className,
}: RateCellProps) {
  if (!available) {
    return (
      <Td align="right" className={cn('text-slate-500 dark:text-slate-400', className)}>
        —
      </Td>
    );
  }
  const width = Math.max(0, Math.min(100, value));
  return (
    <Td align="right" className={className}>
      <div className="flex items-center justify-end gap-2">
        <div
          className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
          aria-hidden="true"
        >
          <div className={cn('h-full rounded-full', barClass)} style={{ width: `${width}%` }} />
        </div>
        <span className={cn('w-10 text-right font-medium tabular-nums', textClass)}>
          {formatPercent(value)}
        </span>
      </div>
    </Td>
  );
}

function SkeletonRow() {
  return (
    <Tr>
      <Td>
        <Skeleton className="h-4 w-52" />
        <Skeleton className="mt-1.5 h-3 w-36" />
      </Td>
      <Td>
        <Skeleton className="h-5 w-24 rounded-full" />
      </Td>
      <Td align="right">
        <Skeleton className="ml-auto h-4 w-10" />
      </Td>
      <Td align="right" className="hidden 2xl:table-cell">
        <Skeleton className="ml-auto h-4 w-28" />
      </Td>
      <Td align="right">
        <Skeleton className="ml-auto h-4 w-28" />
      </Td>
      <Td align="right" className="hidden xl:table-cell">
        <Skeleton className="ml-auto h-4 w-28" />
      </Td>
      <Td>
        <Skeleton className="h-4 w-28" />
      </Td>
    </Tr>
  );
}

interface CampaignRowProps {
  campaign: Campaign;
  onClick: () => void;
}

function CampaignRow({ campaign, onClick }: CampaignRowProps) {
  const { metrics, status } = campaign;
  const StatusIcon = STATUS_ICON[status];
  const sent = hasSends(campaign);
  const clickTone = clickRateSeverity(metrics.clickRate);

  return (
    <Tr interactive onClick={onClick} data-testid="campaign-row" data-id={campaign.id}>
      <Td className="min-w-[12rem]">
        <div>
          {/* O link dá nome, papel e destino ao teclado/leitor de tela; o clique na linha fica para o mouse. */}
          <Link
            to={`/campaigns/${campaign.id}`}
            className="font-medium text-ink hover:underline dark:text-white"
            onClick={(event) => event.stopPropagation()}
          >
            {campaign.name}
          </Link>
        </div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {campaign.targetGroup} · {CAMPAIGN_TEMPLATE_LABEL[campaign.template]}
        </div>
      </Td>
      <Td>
        <StatusPill
          label={CAMPAIGN_STATUS_LABEL[status]}
          colorClass={CAMPAIGN_STATUS_CLASS[status]}
          dotClass={CAMPAIGN_STATUS_DOT_CLASS[status]}
          icon={<StatusIcon size={12} />}
        />
      </Td>
      <Td align="right" className="whitespace-nowrap tabular-nums">
        <div className="font-medium text-ink dark:text-white">{formatNumber(metrics.sent)}</div>
        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          de {formatNumber(metrics.recipients)}
        </div>
      </Td>
      <RateCell value={metrics.openRate} available={sent} className="hidden 2xl:table-cell" />
      <RateCell
        value={metrics.clickRate}
        available={sent}
        textClass={SEVERITY_TEXT_CLASS[clickTone]}
        barClass={SEVERITY_DOT_CLASS[clickTone]}
      />
      <RateCell
        value={metrics.trainedRate}
        available={hasClicks(campaign)}
        className="hidden xl:table-cell"
      />
      <Td className="whitespace-nowrap">
        <time dateTime={campaign.scheduledAt} title={formatRelative(campaign.scheduledAt)}>
          {formatDateTime(campaign.scheduledAt)}
        </time>
      </Td>
    </Tr>
  );
}

export function CampaignTable({
  items,
  loading = false,
  filters,
  onFiltersChange,
  onRowClick,
  pageSize = 10,
  hideFilters = false,
  emptyMessage = 'Nenhuma campanha encontrada.',
}: CampaignTableProps) {
  const navigate = useNavigate();
  const { sorted, toggle, directionOf } = useSort(items, SORT_ACCESSORS, {
    key: 'scheduledAt',
    direction: 'desc',
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
    filters.status ?? 'all',
    filters.from ?? '',
    filters.to ?? '',
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

  const handleRowClick = (campaign: Campaign) => {
    if (onRowClick) onRowClick(campaign);
    else navigate(`/campaigns/${campaign.id}`);
  };

  const showSkeleton = loading && items.length === 0;
  const showEmpty = !showSkeleton && total === 0;
  const filtersActive = !hideFilters && hasActiveFilters(filters);

  return (
    <div className="surface overflow-hidden" aria-busy={loading || undefined} data-testid="campaign-table">
      {!hideFilters && <FilterBar filters={filters} onFiltersChange={onFiltersChange} />}

      <TableContainer bare>
        <Table>
          <THead>
            <tr>
              <Th sortable sorted={directionOf('name')} onSort={() => toggle('name')}>
                Nome
              </Th>
              <Th sortable sorted={directionOf('status')} onSort={() => toggle('status')}>
                Status
              </Th>
              <Th align="right" sortable sorted={directionOf('sent')} onSort={() => toggle('sent')}>
                Enviados
              </Th>
              <Th
                align="right"
                sortable
                sorted={directionOf('openRate')}
                onSort={() => toggle('openRate')}
                className="hidden 2xl:table-cell"
              >
                Abertos
              </Th>
              <Th align="right" sortable sorted={directionOf('clickRate')} onSort={() => toggle('clickRate')}>
                Clicados
              </Th>
              <Th
                align="right"
                sortable
                sorted={directionOf('trainedRate')}
                onSort={() => toggle('trainedRate')}
                className="hidden xl:table-cell"
              >
                Treinados
              </Th>
              <Th sortable sorted={directionOf('scheduledAt')} onSort={() => toggle('scheduledAt')}>
                Agendada para
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
              pageItems.map((campaign) => (
                <CampaignRow key={campaign.id} campaign={campaign} onClick={() => handleRowClick(campaign)} />
              ))
            )}
          </TBody>
        </Table>
      </TableContainer>

      {loading && (
        <p role="status" className="sr-only">
          Carregando campanhas…
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
