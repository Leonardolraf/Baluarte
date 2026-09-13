import { useMemo, useState, type ComponentType } from 'react';
import { useParams } from 'react-router-dom';
import type {
  Campaign,
  CampaignMetrics,
  CampaignRecipient,
  CampaignReport,
  CampaignTimelineEvent,
  FunnelStage,
  RecipientStage,
} from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { usePagination } from '@/hooks/usePagination';
import { cn } from '@/lib/cn';
import { formatDateTime, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import {
  CAMPAIGN_STATUS_CLASS,
  CAMPAIGN_STATUS_DOT_CLASS,
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_TEMPLATE_LABEL,
  RECIPIENT_STAGE_CLASS,
  RECIPIENT_STAGE_DOT_CLASS,
  RECIPIENT_STAGE_LABEL,
  SEVERITY_DOT_CLASS,
  SEVERITY_TEXT_CLASS,
  USER_STATUS_CLASS,
  VULN_STATUS_CLASS,
  clickRateSeverity,
} from '@/lib/severity';
import {
  Card,
  CircularGauge,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  KeyValueList,
  LinkButton,
  LoadingSpinner,
  PageHeader,
  Pagination,
  StatCard,
  StatusPill,
  Table,
  TableEmptyRow,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import {
  CalendarIcon,
  CheckCircleIcon,
  EyeIcon,
  FlagIcon,
  GraduationIcon,
  LockIcon,
  MouseClickIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  type IconProps,
} from '@/components/icons';

const EMPTY = '—';
const RECIPIENTS_PAGE_SIZE = 10;

const TIMELINE_ICON: Record<CampaignTimelineEvent['kind'], ComponentType<IconProps>> = {
  scheduled: CalendarIcon,
  started: PlayIcon,
  opened: EyeIcon,
  clicked: MouseClickIcon,
  submitted: LockIcon,
  reported: FlagIcon,
  trained: GraduationIcon,
  ended: CheckCircleIcon,
};

/** Da etapa mais avançada para a menos avançada (reportar prevalece sobre as demais). */
const STAGE_PRIORITY: ReadonlyArray<{ stage: RecipientStage; at: keyof CampaignRecipient }> = [
  { stage: 'reported', at: 'reportedAt' },
  { stage: 'submitted', at: 'submittedAt' },
  { stage: 'clicked', at: 'clickedAt' },
  { stage: 'opened', at: 'openedAt' },
  { stage: 'sent', at: 'sentAt' },
];

const TRAINING_DONE_CLASS = VULN_STATUS_CLASS.resolved;
const TRAINING_PENDING_CLASS = USER_STATUS_CLASS.pending;
const NOT_RECEIVED_CLASS = RECIPIENT_STAGE_CLASS.sent;

/** Etapa mais avançada alcançada pelo destinatário; `null` enquanto o e-mail não foi enviado. */
function recipientStage(recipient: CampaignRecipient): RecipientStage | null {
  for (const { stage, at } of STAGE_PRIORITY) {
    if (recipient[at]) return stage;
  }
  return null;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

// ---- Indicadores ------------------------------------------------------------

function KpiRow({ metrics }: { metrics: CampaignMetrics }) {
  // Sem envios não há taxa medida: mantém o tom neutro em vez de pintar o zero de verde.
  const clickTone = metrics.sent > 0 ? clickRateSeverity(metrics.clickRate) : ('neutral' as const);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Enviados"
        value={formatNumber(metrics.sent)}
        hint={`de ${formatNumber(metrics.recipients)} destinatários`}
        icon={<SendIcon size={18} />}
      />
      <StatCard
        label="Clicaram"
        value={formatNumber(metrics.clicked)}
        hint={formatPercent(metrics.clickRate)}
        tone={clickTone}
        icon={<MouseClickIcon size={18} />}
      />
      <StatCard
        label="Submeteram credenciais"
        value={formatNumber(metrics.submitted)}
        tone={metrics.submitted > 0 ? 'critical' : 'neutral'}
        icon={<LockIcon size={18} />}
      />
      <StatCard
        label="Reportaram"
        value={formatNumber(metrics.reported)}
        tone={metrics.reported > 0 ? 'low' : 'neutral'}
        icon={<FlagIcon size={18} />}
      />
    </div>
  );
}

// ---- Resumo -----------------------------------------------------------------

function SummaryCard({ campaign }: { campaign: Campaign }) {
  const items = [
    { label: 'Criada por', value: campaign.createdBy },
    { label: 'Criada em', value: formatDateTime(campaign.createdAt) },
    { label: 'Agendada para', value: formatDateTime(campaign.scheduledAt) },
    { label: 'Iniciada em', value: formatDateTime(campaign.startedAt, EMPTY) },
    { label: 'Encerrada em', value: formatDateTime(campaign.endedAt, EMPTY) },
    { label: 'Grupo-alvo', value: campaign.targetGroup },
    { label: 'Modelo', value: CAMPAIGN_TEMPLATE_LABEL[campaign.template] },
  ];
  return (
    <Card title="Resumo">
      <KeyValueList items={items} columns={2} />
    </Card>
  );
}

// ---- Taxa de clique ---------------------------------------------------------

function ClickRateCard({ metrics }: { metrics: CampaignMetrics }) {
  return (
    <Card title="Taxa de clique" subtitle="Risco humano medido pela simulação">
      <div className="flex h-full items-center justify-center">
        {metrics.sent === 0 ? (
          <EmptyState
            compact
            title="Campanha ainda não disparada"
            description="Os resultados aparecem assim que os e-mails da simulação forem enviados."
            icon={<CalendarIcon size={28} />}
          />
        ) : (
          <CircularGauge
            value={metrics.clickRate}
            label="Taxa de clique"
            colorScheme="human"
            sublabel={`${formatNumber(metrics.clicked)} de ${formatNumber(metrics.sent)} destinatários clicaram`}
          />
        )}
      </div>
    </Card>
  );
}

// ---- Funil ------------------------------------------------------------------

function FunnelCard({ funnel }: { funnel: FunnelStage[] }) {
  return (
    <Card title="Funil da campanha" subtitle="Percentuais calculados sobre os e-mails enviados">
      {funnel.length === 0 ? (
        <EmptyState
          compact
          title="Sem dados de funil"
          description="O funil é montado após o primeiro envio."
        />
      ) : (
        <ol className="space-y-4">
          {funnel.map((stage) => {
            const pct = clampPct(stage.pct);
            return (
              <li key={stage.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium text-ink dark:text-white">{stage.label}</span>
                  <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-300">
                    {formatNumber(stage.value)}
                    <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">
                      ({formatPercent(pct)})
                    </span>
                  </span>
                </div>
                <div
                  className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                  aria-hidden="true"
                >
                  <div
                    className={cn('h-full rounded-full', RECIPIENT_STAGE_DOT_CLASS[stage.key])}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ---- Por departamento -------------------------------------------------------

// Cartão de meia largura: a taxa de clique é a coluna que importa; os contadores entram
// conforme a largura ("Destinatários" a partir de xl, "Clicaram" a partir de 2xl).
function DepartmentCard({ rows }: { rows: CampaignReport['byDepartment'] }) {
  return (
    <Card title="Por departamento" subtitle="Amostra dos destinatários listados" flush>
      {rows.length === 0 ? (
        <EmptyState
          compact
          title="Sem dados por departamento"
          description="Nenhum destinatário foi registrado."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table dense>
            <THead>
              <tr>
                <Th>Departamento</Th>
                <Th align="right" className="hidden xl:table-cell">
                  Destinatários
                </Th>
                <Th align="right" className="hidden 2xl:table-cell">
                  Clicaram
                </Th>
                <Th>Taxa de clique</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                const pct = clampPct(row.clickRate);
                const tone = clickRateSeverity(pct);
                return (
                  <Tr key={row.department}>
                    <Td className="font-medium text-ink dark:text-white">{row.department}</Td>
                    <Td align="right" className="hidden tabular-nums xl:table-cell">
                      {formatNumber(row.recipients)}
                    </Td>
                    <Td align="right" className="hidden tabular-nums 2xl:table-cell">
                      {formatNumber(row.clicked)}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                          aria-hidden="true"
                        >
                          <div
                            className={cn('h-full rounded-full', SEVERITY_DOT_CLASS[tone])}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={cn('text-xs font-semibold tabular-nums', SEVERITY_TEXT_CLASS[tone])}>
                          {formatPercent(pct)}
                        </span>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ---- Linha do tempo ---------------------------------------------------------

function TimelineCard({ events }: { events: CampaignTimelineEvent[] }) {
  const ordered = useMemo(
    () => [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    [events],
  );
  return (
    <Card title="Linha do tempo" subtitle="Eventos da campanha, do mais recente ao mais antigo">
      {ordered.length === 0 ? (
        <EmptyState
          compact
          title="Nenhum evento registrado"
          description="Aberturas, cliques e treinamentos aparecerão aqui conforme a campanha avança."
        />
      ) : (
        <ol className="ml-3 space-y-5 border-l border-slate-200 dark:border-slate-800">
          {ordered.map((event) => {
            const Icon = TIMELINE_ICON[event.kind];
            return (
              <li key={event.id} className="relative pl-6">
                <span
                  aria-hidden="true"
                  className="absolute -left-3 top-0 flex h-6 w-6 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700"
                >
                  <Icon size={13} />
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-sm text-slate-700 dark:text-slate-200">{event.description}</p>
                  <time
                    dateTime={event.at}
                    title={formatDateTime(event.at)}
                    className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400"
                  >
                    {formatRelative(event.at)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ---- Status dos destinatários ----------------------------------------------

function StagePill({ recipient }: { recipient: CampaignRecipient }) {
  const stage = recipientStage(recipient);
  if (!stage) return <StatusPill label="Não recebeu" colorClass={NOT_RECEIVED_CLASS} />;
  return <StatusPill label={RECIPIENT_STAGE_LABEL[stage]} colorClass={RECIPIENT_STAGE_CLASS[stage]} />;
}

function TrainingCell({ recipient }: { recipient: CampaignRecipient }) {
  if (!recipient.clickedAt) return <span className="text-slate-500 dark:text-slate-400">{EMPTY}</span>;
  return recipient.trainingCompleted ? (
    <StatusPill label="Concluído" colorClass={TRAINING_DONE_CLASS} />
  ) : (
    <StatusPill label="Pendente" colorClass={TRAINING_PENDING_CLASS} />
  );
}

function RecipientsCard({
  recipients,
  trainingId,
}: {
  recipients: CampaignRecipient[];
  trainingId: string | null;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const term = normalize(query.trim());
    if (!term) return recipients;
    return recipients.filter((r) => normalize(r.name).includes(term) || normalize(r.email).includes(term));
  }, [recipients, query]);
  const { page, pageSize, total, pageItems, setPage, setPageSize } = usePagination(
    filtered,
    RECIPIENTS_PAGE_SIZE,
  );

  const emptyMessage =
    recipients.length === 0
      ? 'Nenhum destinatário registrado para esta campanha.'
      : 'Nenhum destinatário corresponde à busca.';

  return (
    <Card
      title="Status dos destinatários"
      subtitle={`${formatNumber(filtered.length)} de ${formatNumber(recipients.length)} destinatários listados`}
      flush
    >
      <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <FormField label="Buscar destinatário" htmlFor="recipient-search" className="max-w-sm">
          <div className="relative">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <Input
              id="recipient-search"
              type="search"
              autoComplete="off"
              placeholder="Nome ou e-mail"
              className="pl-9"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </FormField>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <THead>
            <tr>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th className="hidden xl:table-cell">Departamento</Th>
              <Th>Etapa</Th>
              <Th>Treinamento</Th>
              <Th align="right">Ações</Th>
            </tr>
          </THead>
          <TBody>
            {pageItems.length === 0 ? (
              <TableEmptyRow colSpan={6}>{emptyMessage}</TableEmptyRow>
            ) : (
              pageItems.map((recipient) => {
                // O treinamento do destinatário prevalece; sem ele, cai no módulo da campanha (se houver).
                const rowTrainingId = recipient.trainingId ?? trainingId;
                return (
                  <Tr key={recipient.id}>
                    <Td className="font-medium text-ink dark:text-white">{recipient.name}</Td>
                    <Td mono>{recipient.email}</Td>
                    <Td className="hidden xl:table-cell">{recipient.department}</Td>
                    <Td>
                      <StagePill recipient={recipient} />
                    </Td>
                    <Td>
                      <TrainingCell recipient={recipient} />
                    </Td>
                    <Td align="right">
                      {recipient.clickedAt && rowTrainingId ? (
                        <LinkButton
                          to={`/training/${rowTrainingId}`}
                          variant="ghost"
                          size="sm"
                          leftIcon={<GraduationIcon size={14} />}
                          aria-label={`Abrir treinamento de ${recipient.name}`}
                        >
                          Treinamento
                        </LinkButton>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">{EMPTY}</span>
                      )}
                    </Td>
                  </Tr>
                );
              })
            )}
          </TBody>
        </Table>
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </Card>
  );
}

// ---- Página -----------------------------------------------------------------

export default function CampaignDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data: report, error, loading, reload } = useAsync(() => api.getCampaignReport(id), [id]);

  if (!report) {
    if (error) {
      if (error.status === 404) {
        return (
          <EmptyState
            tone="error"
            title="Campanha não encontrada"
            description="A campanha solicitada não existe ou foi removida."
            action={{ label: 'Voltar para campanhas', to: '/campaigns' }}
            className="min-h-[50vh]"
          />
        );
      }
      // 403 fica a cargo do ErrorState (título "Acesso negado" + volta ao dashboard).
      const forbidden = error.status === 403;
      return (
        <ErrorState
          status={error.status}
          title={forbidden ? undefined : 'Não foi possível carregar a campanha'}
          message={forbidden ? undefined : error.message || 'Tente novamente em instantes.'}
          onRetry={() => void reload()}
          retrying={loading}
          className="min-h-[50vh]"
        />
      );
    }
    return <LoadingSpinner label="Carregando relatório da campanha…" />;
  }

  const { campaign } = report;
  const trainingId = campaign.trainingId ?? null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Campanhas', to: '/campaigns' }, { label: campaign.name }]}
        title={campaign.name}
        description={`Grupo-alvo: ${campaign.targetGroup} · Modelo: ${CAMPAIGN_TEMPLATE_LABEL[campaign.template]}`}
        meta={
          <>
            <StatusPill
              label={CAMPAIGN_STATUS_LABEL[campaign.status]}
              colorClass={CAMPAIGN_STATUS_CLASS[campaign.status]}
              dotClass={CAMPAIGN_STATUS_DOT_CLASS[campaign.status]}
              size="md"
            />
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              <CalendarIcon size={14} className="text-slate-400" aria-hidden="true" />
              Agendada para {formatDateTime(campaign.scheduledAt)}
            </span>
          </>
        }
        actions={
          trainingId ? (
            <LinkButton
              to={`/training/${trainingId}`}
              variant="outline"
              leftIcon={<GraduationIcon size={16} />}
            >
              Ver material de treinamento
            </LinkButton>
          ) : undefined
        }
      />

      <div className="space-y-6">
        <KpiRow metrics={campaign.metrics} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <SummaryCard campaign={campaign} />
          <ClickRateCard metrics={campaign.metrics} />
          <FunnelCard funnel={report.funnel} />
        </div>

        {/* Meio a meio: a tabela por departamento não cabe em 1/3 nem escondendo colunas. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <DepartmentCard rows={report.byDepartment} />
          <TimelineCard events={report.timeline} />
        </div>

        <RecipientsCard recipients={report.recipients} trainingId={trainingId} />
      </div>
    </>
  );
}
