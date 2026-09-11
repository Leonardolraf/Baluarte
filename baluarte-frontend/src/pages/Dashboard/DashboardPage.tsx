import { Link, useNavigate } from 'react-router-dom';
import type {
  Campaign,
  DashboardMetrics,
  PendingTraining,
  RBACRole,
  Severity,
  TimelineEvent,
  Vulnerability,
} from '@/types';
import { SEVERITIES } from '@/types';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/cn';
import { ROUTE_ROLES } from '@/lib/roles';
import {
  formatCvss,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
} from '@/lib/format';
import {
  CAMPAIGN_STATUS_CLASS,
  CAMPAIGN_STATUS_DOT_CLASS,
  CAMPAIGN_STATUS_LABEL,
  SEVERITY_DOT_CLASS,
  SEVERITY_LABEL,
  clickRateSeverity,
  resilienceSeverity,
} from '@/lib/severity';
import {
  Button,
  Card,
  CircularGauge,
  EmptyState,
  ErrorState,
  FormErrorBanner,
  LinkButton,
  LoadingSpinner,
  PageHeader,
  SeverityBadge,
  StatCard,
  StatusPill,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components';
import {
  BugIcon,
  GraduationIcon,
  MailIcon,
  RefreshIcon,
  ServerIcon,
  ShieldIcon,
  XCircleIcon,
} from '@/components/icons';

type HasRole = (...roles: RBACRole[]) => boolean;

/** Verifica, pela tabela de rotas, se o perfil atual pode abrir o `href` de um evento da timeline. */
function canOpenHref(href: string, hasRole: HasRole): boolean {
  const segment = href.split('/').filter(Boolean)[0];
  if (!segment || !Object.prototype.hasOwnProperty.call(ROUTE_ROLES, segment)) return true;
  return hasRole(...ROUTE_ROLES[segment as keyof typeof ROUTE_ROLES]);
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

// ---- Vulnerabilidades recentes ---------------------------------------------

function RecentFindingsTable({ items, canManage }: { items: Vulnerability[]; canManage: boolean }) {
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="Nenhuma vulnerabilidade aberta"
        description="As varreduras não encontraram vulnerabilidades pendentes."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <tr>
            <Th>Severidade</Th>
            <Th>Título</Th>
            <Th>Ativo</Th>
            <Th align="right">CVSS</Th>
            <Th>Detectado</Th>
          </tr>
        </THead>
        <TBody>
          {items.map((vuln) => (
            <Tr
              key={vuln.id}
              interactive={canManage}
              onClick={canManage ? () => navigate(`/vulnerabilities/${vuln.id}`) : undefined}
            >
              <Td>
                <SeverityBadge severity={vuln.severity} dot />
              </Td>
              <Td>
                <div className="font-medium text-ink dark:text-white">
                  {canManage ? (
                    <Link to={`/vulnerabilities/${vuln.id}`} className="hover:underline">
                      {vuln.title}
                    </Link>
                  ) : (
                    vuln.title
                  )}
                </div>
                {vuln.cve && (
                  <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{vuln.cve}</div>
                )}
              </Td>
              <Td>
                <div>{vuln.assetName}</div>
                <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{vuln.assetHost}</div>
              </Td>
              <Td mono align="right">
                {formatCvss(vuln.cvss.base)}
              </Td>
              <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">
                <time dateTime={vuln.detectedAt} title={formatDateTime(vuln.detectedAt)}>
                  {formatRelative(vuln.detectedAt)}
                </time>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

// ---- Distribuição por severidade -------------------------------------------

function SeverityDistribution({ distribution }: { distribution: Record<Severity, number> }) {
  const max = Math.max(1, ...SEVERITIES.map((severity) => distribution[severity]));

  return (
    <ul className="space-y-4">
      {SEVERITIES.map((severity) => {
        const count = distribution[severity];
        const width = `${Math.round((count / max) * 100)}%`;
        return (
          <li key={severity}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT_CLASS[severity])}
                  aria-hidden="true"
                />
                {SEVERITY_LABEL[severity]}
              </span>
              <span className="font-semibold tabular-nums text-ink dark:text-white">
                {formatNumber(count)}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
              aria-hidden="true"
            >
              <div className={cn('h-full rounded-full', SEVERITY_DOT_CLASS[severity])} style={{ width }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Campanhas recentes -----------------------------------------------------

function RecentCampaigns({ items, canManage }: { items: Campaign[]; canManage: boolean }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="Nenhuma campanha recente"
        description="Crie uma simulação de phishing para medir o risco humano."
      />
    );
  }

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((campaign) => {
        const measured = campaign.metrics.sent > 0;
        const rate = clampPct(campaign.metrics.clickRate);
        const barClass = measured
          ? SEVERITY_DOT_CLASS[clickRateSeverity(rate)]
          : 'bg-slate-300 dark:bg-slate-700';
        return (
          <li key={campaign.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink dark:text-white">
                  {canManage ? (
                    <Link to={`/campaigns/${campaign.id}`} className="hover:underline">
                      {campaign.name}
                    </Link>
                  ) : (
                    campaign.name
                  )}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {campaign.targetGroup}
                </div>
              </div>
              <StatusPill
                label={CAMPAIGN_STATUS_LABEL[campaign.status]}
                colorClass={CAMPAIGN_STATUS_CLASS[campaign.status]}
                dotClass={CAMPAIGN_STATUS_DOT_CLASS[campaign.status]}
              />
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                aria-hidden="true"
              >
                <div
                  className={cn('h-full rounded-full', barClass)}
                  style={{ width: measured ? `${rate}%` : '0%' }}
                />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {measured
                  ? `${formatPercent(rate)} de cliques`
                  : `Agendada para ${formatDate(campaign.scheduledAt)}`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Ameaças recentes (timeline) -------------------------------------------

function ThreatTimeline({ events, hasRole }: { events: TimelineEvent[]; hasRole: HasRole }) {
  if (events.length === 0) {
    return (
      <EmptyState
        compact
        title="Nenhum evento recente"
        description="Novas detecções e campanhas aparecerão aqui."
      />
    );
  }

  return (
    <ol className="ml-1.5 space-y-5 border-l border-slate-200 dark:border-slate-800">
      {events.map((event) => {
        const dotClass = event.severity
          ? SEVERITY_DOT_CLASS[event.severity]
          : 'bg-slate-400 dark:bg-slate-500';
        const linkable = !!event.href && canOpenHref(event.href, hasRole);
        return (
          <li key={event.id} className="relative pl-5">
            <span
              className={cn(
                'absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white dark:ring-slate-900',
                dotClass,
              )}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <div className="text-sm font-medium text-ink dark:text-white">
                {linkable && event.href ? (
                  <Link to={event.href} className="hover:underline">
                    {event.title}
                  </Link>
                ) : (
                  event.title
                )}
              </div>
              <time
                dateTime={event.at}
                title={formatDateTime(event.at)}
                className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400"
              >
                {formatRelative(event.at)}
              </time>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{event.description}</p>
          </li>
        );
      })}
    </ol>
  );
}

// ---- Treinamento pendente ---------------------------------------------------

function PendingTrainingCard({ training }: { training: PendingTraining }) {
  return (
    <Card title="Seu treinamento" subtitle="Conscientização em segurança">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink dark:text-white">{training.title}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono">{training.moduleCode}</span> · {training.durationMin} min
          </p>
          {training.campaignName && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Campanha: {training.campaignName}
            </p>
          )}
        </div>
        <LinkButton
          to={`/training/${training.id}`}
          leftIcon={<GraduationIcon size={16} />}
          className="shrink-0"
        >
          Iniciar treinamento
        </LinkButton>
      </div>
    </Card>
  );
}

// ---- Página -----------------------------------------------------------------

export default function DashboardPage() {
  const { hasRole } = useAuth();
  const { data, error, loading, reload } = useAsync<DashboardMetrics>(() => api.getDashboard(), []);

  const canManage = hasRole('admin', 'analyst');
  const isCollaborator = hasRole('collaborator');

  if (!data) {
    if (error) return <ErrorState message={error.message} status={error.status} onRetry={() => reload()} />;
    return <LoadingSpinner label="Carregando dashboard…" />;
  }

  const { kpis } = data;
  const resilienceMeasured = kpis.phishingResilience !== null;
  const openTotal = SEVERITIES.reduce((sum, severity) => sum + data.severityDistribution[severity], 0);
  const manageHref = (path: string) => (canManage ? path : undefined);
  // Colaboradores só recebem as listas técnicas vazias (fronteira RBAC do payload): não exibir cards vazios.
  const showFindings = canManage || data.recentFindings.length > 0;
  const showCampaigns = canManage || data.recentCampaigns.length > 0;
  const trainingCard = data.pendingTraining ? <PendingTrainingCard training={data.pendingTraining} /> : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral de risco"
        description="Consolidação do risco técnico e do risco humano da organização."
        meta={
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Atualizado{' '}
            <time dateTime={data.generatedAt} title={formatDateTime(data.generatedAt)}>
              {formatRelative(data.generatedAt)}
            </time>
          </span>
        }
        actions={
          <Button
            variant="outline"
            leftIcon={<RefreshIcon size={16} />}
            loading={loading}
            onClick={() => reload()}
          >
            Atualizar
          </Button>
        }
      />

      {error && <FormErrorBanner message={`Não foi possível atualizar os dados: ${error.message}`} />}

      {/* Colaborador: o treinamento pendente é a ação principal — vem antes dos índices */}
      {isCollaborator && trainingCard}

      {/* Linha 1 — gauges de risco */}
      <div data-testid="risk-gauges" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <CircularGauge
              value={data.technicalRisk}
              label="Risco técnico"
              colorScheme="tech"
              size={200}
              sublabel={`${formatNumber(kpis.openVulnerabilities)} vulnerabilidades abertas · ${formatNumber(kpis.criticalVulnerabilities)} críticas`}
            />
            <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
              Índice calculado pela severidade ponderada das vulnerabilidades abertas por ativo monitorado.
            </p>
          </div>
        </Card>
        <Card>
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <CircularGauge
              value={data.humanRisk}
              label="Risco humano"
              colorScheme="human"
              size={200}
              sublabel={
                kpis.phishingResilience === null
                  ? 'Resiliência a phishing: não medida'
                  : `Resiliência a phishing: ${formatPercent(kpis.phishingResilience)}`
              }
            />
            <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
              Índice calculado pelas taxas de clique e de submissão de credenciais nas simulações de phishing.
            </p>
          </div>
        </Card>
      </div>

      {/* Linha 2 — indicadores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Vulnerabilidades abertas"
          value={formatNumber(kpis.openVulnerabilities)}
          tone={kpis.openVulnerabilities > 0 ? 'critical' : 'neutral'}
          icon={<BugIcon size={18} />}
          href={manageHref('/vulnerabilities')}
        />
        <StatCard
          label="Críticas"
          value={formatNumber(kpis.criticalVulnerabilities)}
          tone="critical"
          icon={<XCircleIcon size={18} />}
          href={manageHref('/vulnerabilities')}
        />
        <StatCard
          label="Ativos monitorados"
          value={formatNumber(kpis.monitoredAssets)}
          icon={<ServerIcon size={18} />}
        />
        <StatCard
          label="Campanhas ativas"
          value={formatNumber(kpis.activeCampaigns)}
          icon={<MailIcon size={18} />}
          href={manageHref('/campaigns')}
        />
        <StatCard
          label="Colaboradores treinados"
          value={formatNumber(kpis.trainedCollaborators)}
          icon={<GraduationIcon size={18} />}
        />
        <StatCard
          label="Resiliência a phishing"
          value={kpis.phishingResilience === null ? '—' : formatPercent(kpis.phishingResilience)}
          tone={resilienceMeasured ? resilienceSeverity(kpis.phishingResilience) : 'neutral'}
          hint={resilienceMeasured ? undefined : 'Sem campanhas disparadas'}
          icon={<ShieldIcon size={18} />}
          href={manageHref('/campaigns')}
        />
      </div>

      {/* Gestores: o treinamento pendente (se houver) vem depois dos indicadores */}
      {!isCollaborator && trainingCard}

      {/* Linha 3 — vulnerabilidades recentes + distribuição */}
      <div className={cn('grid grid-cols-1 gap-6', showFindings && 'lg:grid-cols-3')}>
        {showFindings && (
          <Card
            title="Vulnerabilidades recentes"
            subtitle="Vulnerabilidades abertas detectadas mais recentemente"
            flush
            href={manageHref('/vulnerabilities')}
            hrefLabel="Ver todas"
            className="lg:col-span-2"
          >
            <RecentFindingsTable items={data.recentFindings} canManage={canManage} />
          </Card>
        )}
        <Card
          title="Distribuição por severidade"
          subtitle="Vulnerabilidades abertas"
          footer={
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Total:{' '}
              <span className="font-semibold tabular-nums text-ink dark:text-white">
                {formatNumber(openTotal)}
              </span>{' '}
              {openTotal === 1 ? 'vulnerabilidade aberta' : 'vulnerabilidades abertas'}
            </p>
          }
        >
          <SeverityDistribution distribution={data.severityDistribution} />
        </Card>
      </div>

      {/* Linha 4 — campanhas + timeline */}
      <div className={cn('grid grid-cols-1 gap-6', showCampaigns && 'lg:grid-cols-2')}>
        {showCampaigns && (
          <Card
            title="Campanhas recentes"
            subtitle="Simulações de phishing"
            href={manageHref('/campaigns')}
            hrefLabel="Ver todas"
          >
            <RecentCampaigns items={data.recentCampaigns} canManage={canManage} />
          </Card>
        )}
        <Card title="Ameaças recentes" subtitle="Linha do tempo de eventos de segurança">
          <ThreatTimeline events={data.timeline} hasRole={hasRole} />
        </Card>
      </div>
    </div>
  );
}
