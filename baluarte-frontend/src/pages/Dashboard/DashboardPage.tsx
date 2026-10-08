import { Fragment, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  AssetRisk,
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
  Plate,
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

/** Saudação pelo horário local de quem está usando o sistema. */
function saudacao(agora = new Date()): string {
  const hora = agora.getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
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

// ---- Ativos de maior risco (B25) -------------------------------------------

/** Rótulo curto para as contagens por severidade na linha do ativo. */
const SEVERITY_SHORT: Record<Severity, string> = {
  critical: 'crít.',
  high: 'altas',
  medium: 'médias',
  low: 'baixas',
  info: 'info.',
};

function TopRiskAssets({ items }: { items: AssetRisk[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="Nenhum ativo em risco"
        description="Nenhum ativo tem vulnerabilidade aberta."
      />
    );
  }
  return (
    <ol className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="top-risk-assets">
      {items.map((asset, index) => {
        // A barra leva a cor da severidade mais grave em aberto (dado, não faixa inventada).
        const worst = SEVERITIES.find((severity) => asset.openBySeverity[severity] > 0) ?? 'low';
        const score = clampPct(asset.riskScore);
        return (
          <li key={asset.id} className="py-3 first:pt-0 last:pb-0" data-testid="top-risk-asset">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-400"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <Link
                    to={`/vulnerabilities?q=${encodeURIComponent(asset.host)}`}
                    className="block truncate text-sm font-medium text-ink hover:underline dark:text-white"
                    title={`Ver vulnerabilidades de ${asset.host}`}
                  >
                    {asset.name}
                  </Link>
                  <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {asset.host}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {SEVERITIES.filter((severity) => asset.openBySeverity[severity] > 0).map((severity) => (
                      <span key={severity} className="inline-flex items-center gap-1">
                        <span
                          aria-hidden="true"
                          className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_DOT_CLASS[severity])}
                        />
                        <span className="tabular-nums">{formatNumber(asset.openBySeverity[severity])}</span>{' '}
                        {SEVERITY_SHORT[severity]}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="w-24 shrink-0 text-right">
                <span className="text-sm font-semibold tabular-nums text-ink dark:text-white">
                  {formatNumber(score)}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">/100</span>
                <div
                  className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                  aria-hidden="true"
                >
                  <div
                    className={cn('h-full rounded-full', SEVERITY_DOT_CLASS[worst])}
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
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
  const { hasRole, user } = useAuth();
  const { data, error, loading, reload } = useAsync<DashboardMetrics>(() => api.getDashboard(), []);

  const canManage = hasRole('admin', 'analyst');
  const isCollaborator = hasRole('collaborator');

  if (!data) {
    if (error) return <ErrorState message={error.message} status={error.status} onRetry={() => reload()} />;
    return <LoadingSpinner label="Carregando dashboard…" />;
  }

  const { kpis } = data;
  const resilienceMeasured = kpis.phishingResilience !== null;
  // Colaborador (RN-006, B10): a API não manda a parte técnica (null). Nada de cards vazios ou zerados.
  const severityDistribution = data.severityDistribution;
  const technicalRisk = data.technicalRisk;
  // B17: o crítico da distribuição (e o KPI de críticas) já inclui os arquivos com ameaça dos
  // últimos 30 dias; o total de vulnerabilidades abertas, não.
  const maliciousFiles = kpis.maliciousFiles ?? 0;
  const distributedTotal = severityDistribution
    ? SEVERITIES.reduce((sum, severity) => sum + severityDistribution[severity], 0)
    : 0;
  const openTotal = Math.max(0, distributedTotal - maliciousFiles);
  const maliciousFilesText = `${formatNumber(maliciousFiles)} ${
    maliciousFiles === 1 ? 'arquivo com ameaça' : 'arquivos com ameaça'
  }`;
  const manageHref = (path: string) => (canManage ? path : undefined);
  const showFindings = canManage || data.recentFindings.length > 0;
  const showCampaigns = canManage || data.recentCampaigns.length > 0;
  const showTimeline = canManage || data.timeline.length > 0;
  const trainingCard = data.pendingTraining ? <PendingTrainingCard training={data.pendingTraining} /> : null;

  // Só entram os indicadores que a API mandou para este perfil.
  const statCards: { key: string; node: ReactNode }[] = [];
  const addStat = (key: string, value: number | null, render: (value: number) => ReactNode) => {
    if (value !== null) statCards.push({ key, node: render(value) });
  };
  addStat('open', kpis.openVulnerabilities, (value) => (
    <StatCard
      variant="plate"
      label="Vulnerabilidades abertas"
      value={formatNumber(value)}
      tone={value > 0 ? 'critical' : 'neutral'}
      icon={<BugIcon size={16} />}
      href={manageHref('/vulnerabilities')}
    />
  ));
  addStat('critical', kpis.criticalVulnerabilities, (value) => (
    <StatCard
      variant="plate"
      label="Críticas"
      value={formatNumber(value)}
      tone="critical"
      hint={maliciousFiles > 0 ? `inclui ${maliciousFilesText}` : undefined}
      icon={<XCircleIcon size={16} />}
      href={manageHref('/vulnerabilities')}
    />
  ));
  addStat('assets', kpis.monitoredAssets, (value) => (
    <StatCard
      variant="plate"
      label="Ativos monitorados"
      value={formatNumber(value)}
      icon={<ServerIcon size={16} />}
      href={manageHref('/assets')}
    />
  ));
  addStat('campaigns', kpis.activeCampaigns, (value) => (
    <StatCard
      variant="plate"
      label="Campanhas ativas"
      value={formatNumber(value)}
      icon={<MailIcon size={16} />}
      href={manageHref('/campaigns')}
    />
  ));
  addStat('trained', kpis.trainedCollaborators, (value) => (
    <StatCard
      variant="plate"
      label="Colaboradores treinados"
      value={formatNumber(value)}
      icon={<GraduationIcon size={16} />}
      href={manageHref('/trainings')}
    />
  ));
  statCards.push({
    key: 'resilience',
    node: (
      <StatCard
        variant="plate"
        label="Resiliência a phishing"
        value={kpis.phishingResilience === null ? '—' : formatPercent(kpis.phishingResilience)}
        tone={resilienceMeasured ? resilienceSeverity(kpis.phishingResilience) : 'neutral'}
        hint={resilienceMeasured ? undefined : 'Sem campanhas disparadas'}
        icon={<ShieldIcon size={16} />}
        href={manageHref('/campaigns')}
      />
    ),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${saudacao()}, ${user?.name?.split(' ')[0] ?? ''}`.trim().replace(/,$/, '')}
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

      {/* Placa de comando — os índices de risco e os indicadores do perfil num só bloco */}
      <Plate data-testid="risk-gauges" aria-label="Índices de risco e indicadores">
        <div
          className={cn(
            'grid grid-cols-1 items-center gap-6 lg:gap-8',
            technicalRisk !== null
              ? 'lg:grid-cols-[auto_minmax(0,1fr)_auto]'
              : 'lg:grid-cols-[minmax(0,1fr)_auto]',
          )}
        >
          {technicalRisk !== null && (
            <CircularGauge
              value={technicalRisk}
              label="Risco técnico"
              colorScheme="tech"
              onDark
              size={188}
              sublabel={`${formatNumber(kpis.openVulnerabilities ?? 0)} vulnerabilidades abertas · ${formatNumber(kpis.criticalVulnerabilities ?? 0)} críticas`}
            />
          )}
          {/* Entre os dois medidores sobram ~490 px em 1280: duas colunas; três só em telas largas. */}
          <div
            className={cn(
              'grid gap-3',
              statCards.length > 1
                ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3'
                : 'grid-cols-1 sm:max-w-xs',
            )}
          >
            {statCards.map((card) => (
              <Fragment key={card.key}>{card.node}</Fragment>
            ))}
          </div>
          <CircularGauge
            value={data.humanRisk}
            label="Risco humano"
            colorScheme="human"
            onDark
            size={188}
            sublabel={
              kpis.phishingResilience === null
                ? 'Resiliência a phishing: não medida'
                : `Resiliência a phishing: ${formatPercent(kpis.phishingResilience)}`
            }
          />
        </div>
        <p className="mt-5 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500 dark:border-white/10 dark:text-slate-400">
          {technicalRisk !== null &&
            'Risco técnico: severidade ponderada das vulnerabilidades abertas por ativo monitorado; cada arquivo com ameaça nos últimos 30 dias pesa como uma vulnerabilidade crítica. '}
          Risco humano: taxas de clique e de submissão de credenciais nas simulações de phishing, medidas
          pessoa a pessoa.
        </p>
      </Plate>

      {/* Gestores: o treinamento pendente (se houver) vem depois dos indicadores */}
      {!isCollaborator && trainingCard}

      {/* Linha 3 — vulnerabilidades recentes + distribuição (só com a parte técnica) */}
      {severityDistribution && (
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
            subtitle={
              maliciousFiles > 0
                ? 'Vulnerabilidades abertas e arquivos com ameaça (30 dias)'
                : 'Vulnerabilidades abertas'
            }
            footer={
              <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <p>
                  Total:{' '}
                  <span className="font-semibold tabular-nums text-ink dark:text-white">
                    {formatNumber(openTotal)}
                  </span>{' '}
                  {openTotal === 1 ? 'vulnerabilidade aberta' : 'vulnerabilidades abertas'}
                </p>
                {maliciousFiles > 0 && (
                  <p data-testid="malicious-files-note">
                    Crítico inclui{' '}
                    <span className="font-semibold tabular-nums text-ink dark:text-white">
                      {maliciousFilesText}
                    </span>{' '}
                    nos últimos 30 dias (cada arquivo conta uma vez).
                  </p>
                )}
              </div>
            }
          >
            <SeverityDistribution distribution={severityDistribution} />
          </Card>
        </div>
      )}

      {/* Ativos de maior risco (B25): lista técnica, só para quem opera a plataforma */}
      {canManage && (
        <Card
          title="Ativos de maior risco"
          subtitle="Nota de 0 a 100 pelas vulnerabilidades abertas"
          href="/assets"
          hrefLabel="Ver ativos"
          footer={
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nota = 10 por crítica, 7 por alta, 4 por média e 1 por baixa em aberto (teto 100), recalculada a
              cada leitura.
            </p>
          }
        >
          <TopRiskAssets items={data.topRiskAssets} />
        </Card>
      )}

      {/* Linha 4 — campanhas + timeline */}
      {(showCampaigns || showTimeline) && (
        <div className={cn('grid grid-cols-1 gap-6', showCampaigns && showTimeline && 'lg:grid-cols-2')}>
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
          {showTimeline && (
            <Card title="Ameaças recentes" subtitle="Linha do tempo de eventos de segurança">
              <ThreatTimeline events={data.timeline} hasRole={hasRole} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
