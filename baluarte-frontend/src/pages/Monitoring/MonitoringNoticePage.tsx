import { useId, useMemo, useState } from 'react';
import type { MonitoringAcknowledgement, MonitoringAcknowledgementFilters, MonitoringNotice } from '@/types';
import { api, MONITORING_ACK_PAGE_SIZE } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/AuthContext';
import { notify } from '@/store/uiStore';
import { errorMessage, isHttpError } from '@/lib/errors';
import { dispatchMonitoringAcknowledged } from '@/lib/events';
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format';
import { MONITORING_ACK_LIST_ROLES, roleToLabel } from '@/lib/roles';
import { cn } from '@/lib/cn';
import {
  Button,
  Card,
  ErrorState,
  FormField,
  LoadingSpinner,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  StatusPill,
  Table,
  TableContainer,
  TableEmptyRow,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import { CheckCircleIcon } from '@/components/icons';

// Aviso de monitoramento da estação (B18, RNF-006, LGPD). O texto vem inteiro da API
// (GET /monitoramento/aviso, lugar único e versionado); esta tela só o exibe e registra a
// ciência da versão lida. O Administrador vê também quem já deu ciência e de qual versão.
// Tudo neutro: o aviso não é risco, então nada aqui leva a cor de severidade (DESIGN.md).

/** Pílula neutra (o rascunho é uma informação, não uma severidade). */
const NEUTRAL_PILL_CLASS =
  'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const COLUMN_COUNT = 4;

function NoticeText({ notice }: { notice: MonitoringNotice }) {
  return (
    <article
      aria-labelledby="aviso-titulo"
      className="space-y-6 text-sm leading-relaxed text-slate-700 dark:text-slate-200"
    >
      <header className="space-y-2">
        <h2 id="aviso-titulo" className="font-display text-lg font-semibold text-ink dark:text-white">
          {notice.title}
        </h2>
        <p>{notice.intro}</p>
      </header>
      {notice.sections.map((section) => (
        <section key={section.id} aria-labelledby={`aviso-${section.id}`} className="space-y-2">
          <h3 id={`aviso-${section.id}`} className="font-semibold text-ink dark:text-white">
            {section.title}
          </h3>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.items.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {section.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </section>
      ))}
    </article>
  );
}

function AcknowledgementFooter({
  notice,
  submitting,
  onAcknowledge,
}: {
  notice: MonitoringNotice;
  submitting: boolean;
  onAcknowledge: () => void;
}) {
  if (notice.acknowledged) {
    return (
      <p
        className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
        data-testid="monitoring-ack-done"
      >
        <CheckCircleIcon size={16} className="shrink-0 text-slate-500 dark:text-slate-400" />
        <span>
          Você registrou ciência desta versão em{' '}
          <time dateTime={notice.acknowledgedAt ?? undefined}>{formatDateTime(notice.acknowledgedAt)}</time>.
        </span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Ao confirmar, ficam registrados o seu usuário, a data e a hora e a versão {notice.version} do texto.
      </p>
      <Button onClick={onAcknowledge} loading={submitting} disabled={submitting} className="shrink-0">
        Li e estou ciente
      </Button>
    </div>
  );
}

function AcknowledgementRow({ ack }: { ack: MonitoringAcknowledgement }) {
  return (
    <Tr data-testid="monitoring-ack-row" data-id={ack.id}>
      <Td className="min-w-[12rem]">
        <div className="font-medium text-ink dark:text-white">{ack.user.name}</div>
        <div className="mt-0.5 font-mono text-xs text-slate-600 dark:text-slate-400">{ack.user.email}</div>
      </Td>
      <Td className="whitespace-nowrap">{roleToLabel(ack.user.role)}</Td>
      <Td className="whitespace-nowrap font-mono text-xs">{ack.version}</Td>
      <Td className="whitespace-nowrap">
        <time dateTime={ack.acknowledgedAt} title={formatRelative(ack.acknowledgedAt)}>
          {formatDateTime(ack.acknowledgedAt)}
        </time>
      </Td>
    </Tr>
  );
}

/** Lista de ciências (só Administrador): filtro por versão e paginação no servidor. */
function AcknowledgementList({ currentVersion }: { currentVersion: string }) {
  const versionId = useId();
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MONITORING_ACK_PAGE_SIZE);

  const query = useMemo<MonitoringAcknowledgementFilters>(
    () => ({ version: onlyCurrent ? currentVersion : undefined, page, pageSize }),
    [onlyCurrent, currentVersion, page, pageSize],
  );
  const { data, error, loading, reload } = useAsync(
    () => api.listMonitoringAcknowledgements(query),
    [JSON.stringify(query)],
    { keepPreviousData: true },
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pending = data?.pendingCurrentVersion ?? 0;

  return (
    <Card
      title="Ciências registradas"
      subtitle="Quem leu o aviso e de qual versão. Visível só para o Administrador."
      flush
      data-testid="monitoring-ack-list"
    >
      {error && !data ? (
        <div className="p-5">
          <ErrorState
            compact
            title="Não foi possível carregar as ciências"
            message={error.message}
            status={error.status}
            onRetry={() => void reload()}
            retrying={loading}
          />
        </div>
      ) : loading && !data ? (
        <div className="p-5">
          <LoadingSpinner label="Carregando ciências…" />
        </div>
      ) : (
        <div aria-busy={loading || undefined}>
          <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
            <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="monitoring-pending">
              {pending === 0
                ? `Todas as contas ativas deram ciência da versão ${currentVersion}.`
                : `${formatNumber(pending)} ${pending === 1 ? 'conta ativa ainda não deu' : 'contas ativas ainda não deram'} ciência da versão ${currentVersion}.`}
            </p>
            <FormField label="Versão" htmlFor={versionId} className="sm:w-56">
              <Select
                id={versionId}
                value={onlyCurrent ? 'current' : 'all'}
                onChange={(event) => {
                  setOnlyCurrent(event.target.value === 'current');
                  setPage(1);
                }}
              >
                <option value="all">Todas as versões</option>
                <option value="current">Só a versão atual ({currentVersion})</option>
              </Select>
            </FormField>
          </div>

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
                  <Th>Usuário</Th>
                  <Th>Perfil</Th>
                  <Th>Versão</Th>
                  <Th>Registrada em</Th>
                </tr>
              </THead>
              <TBody className={cn(loading && 'opacity-60 transition-opacity')}>
                {items.length === 0 ? (
                  <TableEmptyRow colSpan={COLUMN_COUNT}>
                    <p>Nenhuma ciência registrada{onlyCurrent ? ' nesta versão' : ''}.</p>
                  </TableEmptyRow>
                ) : (
                  items.map((ack) => <AcknowledgementRow key={ack.id} ack={ack} />)
                )}
              </TBody>
            </Table>
          </TableContainer>

          {loading && (
            <p role="status" className="sr-only">
              Carregando ciências…
            </p>
          )}

          {total > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          )}
        </div>
      )}
    </Card>
  );
}

export default function MonitoringNoticePage() {
  const { hasRole } = useAuth();
  const { data: notice, error, loading, reload, setData } = useAsync(() => api.getMonitoringNotice(), []);
  const [submitting, setSubmitting] = useState(false);

  const acknowledge = async () => {
    if (!notice) return;
    setSubmitting(true);
    try {
      const result = await api.acknowledgeMonitoringNotice(notice.version);
      setData((previous) =>
        previous ? { ...previous, acknowledged: true, acknowledgedAt: result.acknowledgedAt } : previous,
      );
      dispatchMonitoringAcknowledged({ version: result.version, acknowledgedAt: result.acknowledgedAt });
      notify.success('Ciência registrada.');
    } catch (err) {
      notify.error(errorMessage(err, 'Não foi possível registrar a ciência.'));
      // O texto mudou desde a leitura: carrega a versão nova para a pessoa ler antes.
      if (isHttpError(err) && err.status === 409) void reload();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoramento da estação"
        description="O que o agente de segurança coleta do seu computador de trabalho, para que serve e quem vê."
        meta={
          notice ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <span>
                Versão <span className="font-mono">{notice.version}</span>
              </span>
              {notice.draft && <StatusPill label="Rascunho em aprovação" colorClass={NEUTRAL_PILL_CLASS} />}
            </div>
          ) : loading ? (
            <Skeleton className="h-5 w-40" />
          ) : null
        }
      />

      {error && !notice ? (
        <ErrorState
          title="Não foi possível carregar o aviso"
          message={error.message}
          status={error.status}
          onRetry={() => void reload()}
          retrying={loading}
        />
      ) : !notice ? (
        <LoadingSpinner label="Carregando aviso…" />
      ) : (
        <Card
          footer={
            <AcknowledgementFooter
              notice={notice}
              submitting={submitting}
              onAcknowledge={() => void acknowledge()}
            />
          }
          aria-busy={loading || undefined}
        >
          <NoticeText notice={notice} />
        </Card>
      )}

      {notice && hasRole(...MONITORING_ACK_LIST_ROLES) && (
        <AcknowledgementList currentVersion={notice.version} />
      )}
    </div>
  );
}
