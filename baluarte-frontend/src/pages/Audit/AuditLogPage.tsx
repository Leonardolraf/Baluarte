import { useId, useMemo, useState } from 'react';
import type { AuditChainBreakReason, AuditEntry, AuditFilters, AuditIntegrity } from '@/types';
import { api, AUDIT_PAGE_SIZE } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { auditActionLabel } from '@/lib/audit';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { SEVERITY_BADGE_CLASS } from '@/lib/severity';
import {
  Button,
  ErrorState,
  FormField,
  Input,
  LoadingSpinner,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Table,
  TableContainer,
  TableEmptyRow,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import { AlertTriangleIcon, CheckCircleIcon, CloseIcon, RefreshIcon } from '@/components/icons';

// Trilha de auditoria (RN-008), só Administrador. Filtro, período e paginação vão para o
// servidor (GET /auditoria): a tela nunca carrega a trilha inteira. As opções de ação vêm
// de `resumo.acoes`, então uma ação nova no backend aparece aqui sem mudança de código.
// Tabela neutra: auditoria não é risco, então nada aqui leva cor (DESIGN.md). A exceção é a
// cadeia violada (B29): adulteração da trilha é risco e sai em vermelho; íntegra fica neutra.

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const COLUMN_COUNT = 4;

interface FilterState {
  action: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: FilterState = { action: '', from: '', to: '' };

function hasActiveFilters(filters: FilterState): boolean {
  return filters.action !== '' || filters.from !== '' || filters.to !== '';
}

interface FilterBarProps {
  filters: FilterState;
  actions: string[];
  onChange: (filters: FilterState) => void;
}

function FilterBar({ filters, actions, onChange }: FilterBarProps) {
  const baseId = useId();
  const actionId = `${baseId}-action`;
  const fromId = `${baseId}-from`;
  const toId = `${baseId}-to`;
  // A ação escolhida continua na lista mesmo que ainda não tenha chegado no `resumo`.
  const options =
    filters.action && !actions.includes(filters.action) ? [filters.action, ...actions] : actions;

  return (
    <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]">
        <FormField label="Ação" htmlFor={actionId} className="sm:col-span-2 xl:col-span-1">
          <Select
            id={actionId}
            value={filters.action}
            onChange={(event) => onChange({ ...filters, action: event.target.value })}
          >
            <option value="">Todas as ações</option>
            {options.map((action) => (
              <option key={action} value={action}>
                {auditActionLabel(action)}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="De" htmlFor={fromId}>
          <Input
            id={fromId}
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => onChange({ ...filters, from: event.target.value })}
          />
        </FormField>

        <FormField label="Até" htmlFor={toId}>
          <Input
            id={toId}
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => onChange({ ...filters, to: event.target.value })}
          />
        </FormField>

        <Button
          variant="outline"
          className="justify-self-start"
          leftIcon={<CloseIcon size={14} />}
          disabled={!hasActiveFilters(filters)}
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          Limpar
        </Button>
      </div>
    </div>
  );
}

const BREAK_REASON_TEXT: Record<AuditChainBreakReason, string> = {
  content_altered: 'o conteúdo do registro não confere com o hash gravado (registro alterado).',
  broken_link:
    'o registro não aponta para o anterior (um registro foi apagado, inserido ou reescrito antes dele).',
  missing_hash: 'o registro não tem hash (foi gravado fora do encadeamento).',
  unknown: 'o registro não confere com a cadeia.',
};

function lockText(integrity: AuditIntegrity): string {
  return integrity.databaseLock
    ? 'Trava do banco ativa: alteração e exclusão são recusadas, exceto a retenção de 12 meses.'
    : 'Trava do banco desligada: a cadeia detecta adulteração, mas o banco ainda aceita alterações.';
}

/**
 * Selo da cadeia de hash (B29): "Cadeia íntegra" ou "Cadeia violada" com o primeiro registro
 * que não confere. A verificação é separada da lista: falhar aqui não esconde a trilha.
 */
function IntegrityPanel() {
  const { data, error, loading, reload } = useAsync(() => api.verifyAuditIntegrity(), []);

  if (loading && !data) {
    return (
      <div className="surface px-5 py-4" data-testid="audit-integrity" data-state="loading">
        <p role="status" className="text-sm text-slate-600 dark:text-slate-300">
          Verificando a cadeia de hash da auditoria…
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="surface flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        data-testid="audit-integrity"
        data-state="error"
      >
        <p className="text-sm text-slate-700 dark:text-slate-200">
          Não foi possível verificar a integridade da trilha{error ? `: ${error.message}` : '.'}
        </p>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshIcon size={14} />}
          onClick={() => void reload()}
        >
          Verificar de novo
        </Button>
      </div>
    );
  }

  const count = `${formatNumber(data.verifiedCount)} ${data.verifiedCount === 1 ? 'registro verificado' : 'registros verificados'}`;

  if (data.intact) {
    return (
      <div
        className="surface flex items-start gap-3 px-5 py-4"
        data-testid="audit-integrity"
        data-state="intact"
      >
        <CheckCircleIcon size={22} className="mt-0.5 shrink-0 text-ink dark:text-white" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-ink dark:text-white">Cadeia íntegra</p>
          <p className="mt-1 text-slate-600 dark:text-slate-300">
            {count}: cada registro confere com o próprio hash e com o anterior. {lockText(data)}
          </p>
        </div>
      </div>
    );
  }

  const brk = data.firstBreak;
  return (
    <div
      role="alert"
      data-testid="audit-integrity"
      data-state="violated"
      className={cn(
        'flex items-start gap-3 rounded-lg px-5 py-4 ring-1 ring-inset',
        SEVERITY_BADGE_CLASS.critical,
      )}
    >
      <AlertTriangleIcon size={22} className="mt-0.5 shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="text-base font-semibold">Cadeia violada</p>
        {brk ? (
          <p className="mt-1">
            Primeira quebra no registro <span className="break-all font-mono font-semibold">{brk.id}</span>,
            de <time dateTime={brk.at}>{formatDateTime(brk.at)}</time>: {BREAK_REASON_TEXT[brk.reason]}
          </p>
        ) : (
          <p className="mt-1">A verificação encontrou um registro que não confere com a cadeia.</p>
        )}
        <p className="mt-1">
          {count} até a quebra. {lockText(data)} Trate como incidente: preserve o banco e avise a equipe de
          segurança.
        </p>
      </div>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <Tr data-testid="audit-row" data-id={entry.id}>
      <Td className="whitespace-nowrap">
        <time dateTime={entry.at} title={formatRelative(entry.at)}>
          {formatDateTime(entry.at)}
        </time>
      </Td>
      <Td className="min-w-[12rem]">
        {entry.user ? (
          <>
            <div className="font-medium text-ink dark:text-white">{entry.user.name}</div>
            <div className="mt-0.5 font-mono text-xs text-slate-600 dark:text-slate-400">
              {entry.user.email}
            </div>
          </>
        ) : (
          <span className="text-slate-600 dark:text-slate-400">Sem usuário</span>
        )}
      </Td>
      <Td className="min-w-[12rem]">
        <div className="font-medium text-ink dark:text-white">{auditActionLabel(entry.action)}</div>
        <div className="mt-0.5 font-mono text-xs text-slate-600 dark:text-slate-400">{entry.action}</div>
      </Td>
      <Td className="min-w-[16rem] break-words font-mono text-xs text-slate-700 dark:text-slate-300">
        {entry.detail ?? '—'}
      </Td>
    </Tr>
  );
}

export default function AuditLogPage() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(AUDIT_PAGE_SIZE);

  const query = useMemo<AuditFilters>(
    () => ({ action: filters.action || undefined, from: filters.from, to: filters.to, page, pageSize }),
    [filters, page, pageSize],
  );
  const queryKey = JSON.stringify(query);
  const { data, error, loading, reload } = useAsync(() => api.listAuditLog(query), [queryKey], {
    keepPreviousData: true,
  });

  // Filtro novo ou tamanho novo: volta para a primeira página.
  const changeFilters = (next: FilterState) => {
    setFilters(next);
    setPage(1);
  };
  const changePageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trilha de auditoria"
        description="Ações registradas na plataforma: quem fez, o quê e quando."
        meta={
          data ? (
            <span className="text-sm text-slate-600 dark:text-slate-300">
              {formatNumber(total)} {total === 1 ? 'registro' : 'registros'}
              {filtersActive ? ' com os filtros aplicados' : ''}
            </span>
          ) : loading ? (
            <Skeleton className="h-5 w-40" />
          ) : null
        }
      />

      <IntegrityPanel />

      {error && !data ? (
        <ErrorState
          title="Não foi possível carregar a trilha de auditoria"
          message={error.message}
          status={error.status}
          onRetry={() => void reload()}
          retrying={loading}
        />
      ) : loading && !data ? (
        <LoadingSpinner label="Carregando auditoria…" />
      ) : (
        <div className="surface overflow-hidden" aria-busy={loading || undefined} data-testid="audit-table">
          <FilterBar filters={filters} actions={data?.actions ?? []} onChange={changeFilters} />

          {error && (
            <p
              role="alert"
              className="border-b border-slate-200 px-5 py-3 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
            >
              {error.message}
            </p>
          )}

          <TableContainer bare>
            <Table>
              <THead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Usuário</Th>
                  <Th>Ação</Th>
                  <Th>Detalhe</Th>
                </tr>
              </THead>
              <TBody className={cn(loading && 'opacity-60 transition-opacity')}>
                {items.length === 0 ? (
                  <TableEmptyRow colSpan={COLUMN_COUNT}>
                    <p>Nenhum registro de auditoria encontrado.</p>
                    {filtersActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => changeFilters(EMPTY_FILTERS)}
                      >
                        Limpar filtros
                      </Button>
                    )}
                  </TableEmptyRow>
                ) : (
                  items.map((entry) => <AuditRow key={entry.id} entry={entry} />)
                )}
              </TBody>
            </Table>
          </TableContainer>

          {loading && (
            <p role="status" className="sr-only">
              Carregando auditoria…
            </p>
          )}

          {total > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={changePageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          )}
        </div>
      )}
    </div>
  );
}
