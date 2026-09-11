import type {
  Asset,
  AssetInput,
  AssetType,
  AuthUser,
  Campaign,
  CampaignInput,
  CampaignMetrics,
  CampaignRecipient,
  CampaignReport,
  CampaignStatus,
  CampaignTemplate,
  DashboardMetrics,
  FunnelStage,
  NotificationPreferences,
  RBACRole,
  ScanReport,
  ScanStatus,
  SecurityPolicy,
  Severity,
  TimelineEvent,
  Training,
  User,
  UserInput,
  UserStatus,
  Vulnerability,
  VulnerabilityStatus,
} from '@/types';
import { roleFromLabel } from '@/lib/roles';
import { RECIPIENT_STAGE_LABEL, severityFromCvss } from '@/lib/severity';

// -----------------------------------------------------------------------------
// Adapters: contrato do backend Express (campos em português, envelope
// `{ status, dados, resumo }`) <-> modelos de domínio do frontend.
// Só este arquivo conhece o formato do servidor.
// -----------------------------------------------------------------------------

// ---- Formatos brutos do backend ---------------------------------------------

export interface BackendLogin {
  token: string;
  idUsuario: string;
  email: string;
  perfil: string;
}

export interface BackendUser {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  status?: string;
  criadoEm?: string;
}

export interface BackendAsset {
  id: string;
  nome: string;
  host: string;
  tipo: string;
  status: string;
  criadoEm: string;
  _count?: { scans?: number };
}

export interface BackendScan {
  id: string;
  assetId: string;
  status: string;
  criadoEm: string;
  concluidoEm?: string | null;
  asset?: { nome: string; host: string };
  _count?: { findings?: number };
}

export interface BackendFinding {
  id: string;
  ativo: string;
  ativoNome: string;
  categoria: string;
  cvss: number;
  severidade: string;
  status: string;
  descricao: string;
  evidencia: string;
  detectadoEm: string;
}

export interface BackendCampaign {
  id: string;
  nome: string;
  template: string;
  status: string;
  destinatarios: number;
  taxaClique: number;
  criadoEm: string;
}

export interface BackendFunnel {
  enviados: { valor: number; pct: number };
  abertos: { valor: number; pct: number };
  clicados: { valor: number; pct: number };
  submeteram: { valor: number; pct: number };
  reportaram: { valor: number; pct: number };
}

export interface BackendCampaignReport {
  id: string;
  nome: string;
  template: string;
  status: string;
  criadoEm: string;
  destinatarios: number;
  funil: BackendFunnel;
  treinamentos: Array<{ destinatario: string; concluido: boolean }>;
}

export interface BackendDashboard {
  kpis: {
    vulnerabilidadesAbertas: number;
    criticas: number;
    resilienciaPhishing: number;
    ativosMonitorados: number;
  };
  distribuicaoSeveridade: Record<string, number>;
  vulnerabilidadesRecentes: BackendFinding[];
  alertas: Array<{ id: string; severidade: string; texto: string; cvss: number; quando: string }>;
  campanhas: BackendCampaign[];
  funil: BackendFunnel | null;
  campanhaAtiva: string | null;
}

export interface BackendTraining {
  tipoAtaque: string;
  titulo: string;
  codigoModulo: string;
  duracaoMin: number;
  progresso: number;
  campanha: string | null;
  sinaisAlerta: string[];
  boasPraticas: string[];
  template?: string;
  idCampanha?: string | null;
  concluidoEm?: string | null;
}

export interface BackendNotificationPreferences {
  alertasEmail: boolean;
  somenteCriticas: boolean;
  resumoSemanal: boolean;
  relatoriosCampanha: boolean;
  atualizadoEm?: string;
}

export interface BackendSecurityPolicy {
  politicaSenha: {
    comprimentoMinimo: number;
    exigirMaiusculaMinuscula: boolean;
    exigirNumeroEspecial: boolean;
  };
  sessao: {
    algoritmoToken: string;
    expiracaoMinutos: number;
    limiteTentativasLogin: number;
    doisFatores: boolean;
  };
  auditoria: { logImutavel: boolean; retencaoMeses: number };
}

// ---- Mapas de valores -------------------------------------------------------

const SEVERITY_FROM_LABEL: Record<string, Severity> = {
  crítico: 'critical',
  critico: 'critical',
  alto: 'high',
  médio: 'medium',
  medio: 'medium',
  baixo: 'low',
  informativo: 'info',
};

const VULN_STATUS_FROM_LABEL: Record<string, VulnerabilityStatus> = {
  aberta: 'open',
  'em revisão': 'in_review',
  'em revisao': 'in_review',
  'em remediação': 'remediating',
  'em remediacao': 'remediating',
  resolvida: 'resolved',
  'risco aceito': 'accepted',
};

export const VULN_STATUS_TO_LABEL: Record<VulnerabilityStatus, string> = {
  open: 'Aberta',
  in_review: 'Em revisão',
  remediating: 'Em remediação',
  resolved: 'Resolvida',
  accepted: 'Risco aceito',
};

const CAMPAIGN_STATUS_FROM_LABEL: Record<string, CampaignStatus> = {
  agendada: 'scheduled',
  ativa: 'active',
  encerrada: 'completed',
  cancelada: 'cancelled',
  rascunho: 'draft',
};

const TEMPLATE_FROM_LABEL: Record<string, CampaignTemplate> = {
  urgencia: 'urgency',
  autoridade: 'authority',
  curiosidade: 'curiosity',
};

export const TEMPLATE_TO_LABEL: Record<CampaignTemplate, string> = {
  urgency: 'urgencia',
  authority: 'autoridade',
  curiosity: 'curiosidade',
};

const ASSET_TYPE_FROM_LABEL: Record<string, AssetType> = {
  servidor: 'server',
  aplicacao: 'application',
  aplicação: 'application',
  rede: 'network',
  'banco de dados': 'database',
};

export const ASSET_TYPE_TO_LABEL: Record<AssetType, string> = {
  server: 'Servidor',
  application: 'Aplicacao',
  network: 'Rede',
  database: 'Banco de Dados',
};

export const ROLE_TO_LABEL: Record<RBACRole, string> = {
  admin: 'Administrador',
  analyst: 'Analista',
  collaborator: 'Colaborador',
};

const USER_STATUS_FROM_LABEL: Record<string, UserStatus> = {
  ativo: 'active',
  inativo: 'inactive',
  pendente: 'pending',
};

const SCAN_STATUS_FROM_LABEL: Record<string, ScanStatus> = {
  em_fila: 'queued',
  em_andamento: 'running',
  concluida: 'completed',
  falhou: 'failed',
};

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function severityFromLabel(label: string | null | undefined, cvss?: number): Severity {
  return SEVERITY_FROM_LABEL[norm(label)] ?? (typeof cvss === 'number' ? severityFromCvss(cvss) : 'info');
}

function owaspParts(categoria: string): { owaspId: string; owaspCategory: string } {
  const match = categoria.match(/^(A\d{2}:\d{4})\s*[-–]\s*(.+)$/);
  if (match) return { owaspId: match[1]!, owaspCategory: match[2]!.trim() };
  return { owaspId: 'OWASP', owaspCategory: categoria };
}

function cveFrom(text: string): string | null {
  const m = text.match(/CVE-\d{4}-\d{4,7}/i);
  return m ? m[0].toUpperCase() : null;
}

function emptySeverityMap(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

// ---- Backend -> domínio -----------------------------------------------------

export function toAuthUser(raw: BackendUser): AuthUser {
  return { id: raw.id, name: raw.nome, email: raw.email, role: roleFromLabel(raw.perfil) };
}

export function toAuthUserFromLogin(raw: BackendLogin): AuthUser {
  return {
    id: raw.idUsuario,
    email: raw.email,
    name: raw.email.split('@')[0] ?? raw.email,
    role: roleFromLabel(raw.perfil),
  };
}

export function toUser(raw: BackendUser): User {
  return {
    id: raw.id,
    name: raw.nome,
    email: raw.email,
    role: roleFromLabel(raw.perfil),
    status: USER_STATUS_FROM_LABEL[norm(raw.status)] ?? 'active',
    createdAt: raw.criadoEm ?? new Date(0).toISOString(),
    lastLoginAt: null,
  };
}

export function toAsset(raw: BackendAsset): Asset {
  return {
    id: raw.id,
    name: raw.nome,
    type: ASSET_TYPE_FROM_LABEL[norm(raw.tipo)] ?? 'server',
    host: raw.host,
    ip: /^\d{1,3}(\.\d{1,3}){3}$/.test(raw.host) ? raw.host : null,
    description: null,
    status: norm(raw.status) === 'inativo' ? 'inactive' : 'active',
    createdAt: raw.criadoEm,
    lastScanAt: null,
    openFindings: 0,
  };
}

export function toScan(raw: BackendScan): ScanReport {
  const started = new Date(raw.criadoEm).getTime();
  const finished = raw.concluidoEm ? new Date(raw.concluidoEm).getTime() : null;
  return {
    id: raw.id,
    assetId: raw.assetId,
    assetName: raw.asset?.nome ?? raw.assetId,
    assetHost: raw.asset?.host ?? '',
    status: SCAN_STATUS_FROM_LABEL[norm(raw.status)] ?? 'queued',
    scanner: 'Baluarte OWASP Engine',
    startedAt: raw.criadoEm,
    finishedAt: raw.concluidoEm ?? null,
    durationSec: finished ? Math.max(0, Math.round((finished - started) / 1000)) : null,
    findingsCount: raw._count?.findings ?? 0,
    findingsBySeverity: emptySeverityMap(),
  };
}

export function toVulnerability(raw: BackendFinding): Vulnerability {
  const { owaspId, owaspCategory } = owaspParts(raw.categoria);
  const severity = severityFromLabel(raw.severidade, raw.cvss);
  const status = VULN_STATUS_FROM_LABEL[norm(raw.status)] ?? 'open';
  return {
    id: raw.id,
    title: raw.descricao,
    cve: cveFrom(`${raw.descricao} ${raw.evidencia}`),
    owaspId,
    owaspCategory,
    cvss: { version: '3.1', vector: '', base: raw.cvss },
    severity,
    status,
    assetId: raw.ativo,
    assetName: raw.ativoNome,
    assetHost: raw.ativo,
    affectedComponent: owaspCategory,
    affectedVersion: null,
    fixedVersion: null,
    artifactHash: null,
    description: raw.descricao,
    evidence: [
      {
        id: `${raw.id}-ev`,
        kind: 'log',
        label: 'Evidência coletada pelo scanner',
        content: raw.evidencia,
        capturedAt: raw.detectadoEm,
      },
    ],
    remediation: [],
    references: [],
    detectedAt: raw.detectadoEm,
    updatedAt: raw.detectadoEm,
    history: [{ id: `${raw.id}-h0`, at: raw.detectadoEm, actor: 'Scanner', action: 'detected', to: 'open' }],
  };
}

function metricsFromFunnel(recipients: number, funnel: BackendFunnel | null, trained = 0): CampaignMetrics {
  const sent = funnel?.enviados.valor ?? 0;
  const clicked = funnel?.clicados.valor ?? 0;
  const pct = (n: number) => (sent > 0 ? Math.round((n / sent) * 100) : 0);
  const opened = funnel?.abertos.valor ?? 0;
  const submitted = funnel?.submeteram.valor ?? 0;
  const reported = funnel?.reportaram.valor ?? 0;
  return {
    recipients,
    sent,
    opened,
    clicked,
    submitted,
    reported,
    trained,
    openRate: pct(opened),
    clickRate: pct(clicked),
    submitRate: pct(submitted),
    reportRate: pct(reported),
    trainedRate: clicked > 0 ? Math.round((trained / clicked) * 100) : 0,
  };
}

export function toCampaign(raw: BackendCampaign): Campaign {
  const status = CAMPAIGN_STATUS_FROM_LABEL[norm(raw.status)] ?? 'scheduled';
  const sent = status === 'scheduled' || status === 'draft' ? 0 : raw.destinatarios;
  const clicked = Math.round((raw.taxaClique / 100) * sent);
  return {
    id: raw.id,
    name: raw.nome,
    template: TEMPLATE_FROM_LABEL[norm(raw.template)] ?? 'urgency',
    targetGroup: 'Colaboradores internos',
    status,
    scheduledAt: raw.criadoEm,
    startedAt: sent > 0 ? raw.criadoEm : null,
    endedAt: status === 'completed' ? raw.criadoEm : null,
    createdBy: '—',
    createdAt: raw.criadoEm,
    trainingId: null,
    metrics: {
      recipients: raw.destinatarios,
      sent,
      opened: 0,
      clicked,
      submitted: 0,
      reported: 0,
      trained: 0,
      openRate: 0,
      clickRate: raw.taxaClique,
      submitRate: 0,
      reportRate: 0,
      trainedRate: 0,
    },
  };
}

export function toCampaignReport(raw: BackendCampaignReport): CampaignReport {
  const status = CAMPAIGN_STATUS_FROM_LABEL[norm(raw.status)] ?? 'scheduled';
  const trained = raw.treinamentos.filter((t) => t.concluido).length;
  const metrics = metricsFromFunnel(raw.destinatarios, raw.funil, trained);
  const campaign: Campaign = {
    id: raw.id,
    name: raw.nome,
    template: TEMPLATE_FROM_LABEL[norm(raw.template)] ?? 'urgency',
    targetGroup: 'Colaboradores internos',
    status,
    scheduledAt: raw.criadoEm,
    startedAt: metrics.sent > 0 ? raw.criadoEm : null,
    endedAt: status === 'completed' ? raw.criadoEm : null,
    createdBy: '—',
    createdAt: raw.criadoEm,
    trainingId: null,
    metrics,
  };
  const recipients: CampaignRecipient[] = raw.treinamentos.map((t, i) => ({
    id: `${raw.id}-r${i}`,
    campaignId: raw.id,
    name: t.destinatario.split('@')[0] ?? t.destinatario,
    email: t.destinatario,
    department: 'Colaboradores internos',
    sentAt: raw.criadoEm,
    openedAt: raw.criadoEm,
    clickedAt: raw.criadoEm,
    submittedAt: null,
    reportedAt: null,
    trainingCompleted: t.concluido,
    trainingId: null,
  }));
  const funnel: FunnelStage[] = [
    { key: 'sent', label: RECIPIENT_STAGE_LABEL.sent, value: metrics.sent, pct: metrics.sent > 0 ? 100 : 0 },
    { key: 'opened', label: RECIPIENT_STAGE_LABEL.opened, value: metrics.opened, pct: metrics.openRate },
    { key: 'clicked', label: RECIPIENT_STAGE_LABEL.clicked, value: metrics.clicked, pct: metrics.clickRate },
    {
      key: 'submitted',
      label: RECIPIENT_STAGE_LABEL.submitted,
      value: metrics.submitted,
      pct: metrics.submitRate,
    },
    {
      key: 'reported',
      label: RECIPIENT_STAGE_LABEL.reported,
      value: metrics.reported,
      pct: metrics.reportRate,
    },
  ];
  return {
    campaign,
    recipients,
    funnel,
    timeline: [
      {
        id: `${raw.id}-scheduled`,
        at: raw.criadoEm,
        kind: 'scheduled',
        description: `Campanha "${raw.nome}" criada.`,
      },
    ],
    byDepartment: [
      {
        department: 'Colaboradores internos',
        recipients: metrics.recipients,
        clicked: metrics.clicked,
        clickRate: metrics.clickRate,
      },
    ],
  };
}

export function toDashboard(raw: BackendDashboard, scans: ScanReport[] = []): DashboardMetrics {
  const severityDistribution = emptySeverityMap();
  for (const [label, count] of Object.entries(raw.distribuicaoSeveridade)) {
    severityDistribution[severityFromLabel(label)] += count;
  }
  const open = raw.kpis.vulnerabilidadesAbertas;
  const weighted =
    severityDistribution.critical * 10 +
    severityDistribution.high * 6 +
    severityDistribution.medium * 3 +
    severityDistribution.low * 1;
  const capacity = Math.max(1, raw.kpis.ativosMonitorados) * 20;
  const technicalRisk = Math.max(0, Math.min(100, Math.round((weighted / capacity) * 100)));
  const campaigns = raw.campanhas.map(toCampaign);
  // O backend devolve resiliência 0 tanto para "ninguém clicou" quanto para "nada foi enviado";
  // sem envios o índice é NÃO MEDIDO (null), nunca 0 % / risco humano 100 %.
  const totalSent = campaigns.reduce((sum, c) => sum + c.metrics.sent, 0);
  const phishingResilience = totalSent > 0 ? raw.kpis.resilienciaPhishing : null;
  const clickRate = phishingResilience === null ? 0 : Math.max(0, Math.min(100, 100 - phishingResilience));
  const humanRisk = Math.max(0, Math.min(100, Math.round(clickRate * 2.5)));
  const timeline: TimelineEvent[] = raw.alertas.map((a) => ({
    id: a.id,
    at: a.quando,
    kind: 'finding',
    severity: severityFromLabel(a.severidade, a.cvss),
    title: a.texto,
    description: `CVSS ${a.cvss.toFixed(1)}`,
    href: `/vulnerabilities/${a.id}`,
  }));
  return {
    technicalRisk,
    humanRisk,
    kpis: {
      openVulnerabilities: open,
      criticalVulnerabilities: raw.kpis.criticas,
      phishingResilience,
      monitoredAssets: raw.kpis.ativosMonitorados,
      activeCampaigns: campaigns.filter((c) => c.status === 'active').length,
      trainedCollaborators: campaigns.reduce((sum, c) => sum + c.metrics.trained, 0),
    },
    severityDistribution,
    recentFindings: raw.vulnerabilidadesRecentes.map(toVulnerability),
    recentCampaigns: campaigns.slice(0, 4),
    recentScans: scans.slice(0, 3),
    timeline,
    // O backend atual só expõe treinamento por token de evento de campanha.
    pendingTraining: null,
    generatedAt: new Date().toISOString(),
  };
}

export function toTraining(id: string, raw: BackendTraining): Training {
  return {
    id,
    campaignId: raw.idCampanha ?? null,
    moduleCode: raw.codigoModulo,
    title: raw.titulo,
    attackType: raw.tipoAtaque,
    durationMin: raw.duracaoMin,
    progress: raw.progresso,
    completed: raw.progresso >= 100,
    completedAt: raw.concluidoEm ?? null,
    summary: raw.campanha
      ? `Treinamento contextual da campanha "${raw.campanha}".`
      : 'Treinamento de conscientização.',
    sections: [
      {
        heading: 'O que aconteceu',
        body: 'Você interagiu com uma simulação de phishing controlada. Nenhum dado real foi comprometido — este módulo mostra como reconhecer a próxima tentativa.',
      },
    ],
    warningSigns: raw.sinaisAlerta,
    bestPractices: raw.boasPraticas,
  };
}

export function toSecurityPolicy(raw: BackendSecurityPolicy): SecurityPolicy {
  return {
    passwordMinLength: raw.politicaSenha.comprimentoMinimo,
    requireMixedCase: raw.politicaSenha.exigirMaiusculaMinuscula,
    requireNumberAndSymbol: raw.politicaSenha.exigirNumeroEspecial,
    tokenAlgorithm: raw.sessao.algoritmoToken,
    sessionExpirationMinutes: raw.sessao.expiracaoMinutos,
    loginAttemptLimit: raw.sessao.limiteTentativasLogin,
    twoFactorEnabled: raw.sessao.doisFatores,
    auditLogImmutable: raw.auditoria.logImutavel,
    auditRetentionMonths: raw.auditoria.retencaoMeses,
  };
}

export function toNotificationPreferences(raw: BackendNotificationPreferences): NotificationPreferences {
  return {
    emailAlerts: raw.alertasEmail,
    criticalOnly: raw.somenteCriticas,
    weeklyDigest: raw.resumoSemanal,
    campaignReports: raw.relatoriosCampanha,
  };
}

export function fromNotificationPreferences(
  prefs: NotificationPreferences,
): Omit<BackendNotificationPreferences, 'atualizadoEm'> {
  return {
    alertasEmail: prefs.emailAlerts,
    somenteCriticas: prefs.criticalOnly,
    resumoSemanal: prefs.weeklyDigest,
    relatoriosCampanha: prefs.campaignReports,
  };
}

// ---- Domínio -> backend (escritas) ------------------------------------------

export function fromAssetInput(input: AssetInput): { nome: string; tipo: string; host: string } {
  return { nome: input.name.trim(), tipo: ASSET_TYPE_TO_LABEL[input.type], host: input.host.trim() };
}

export function fromUserInput(input: UserInput): { nome: string; email: string; perfil: string } {
  return {
    nome: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    perfil: ROLE_TO_LABEL[input.role],
  };
}

/**
 * `destinatario` (singular) mantém o contrato original da API testado pelo Postman;
 * `destinatarios[]` é a extensão que o backend usa quando presente.
 */
export function fromCampaignInput(input: CampaignInput): {
  nome: string;
  destinatario: string;
  destinatarios: string[];
  template: string;
} {
  const destinatarios = Array.from(
    new Set(input.recipients.map((email) => email.trim().toLowerCase()).filter(Boolean)),
  );
  return {
    nome: input.name.trim(),
    destinatario: destinatarios[0] ?? '',
    destinatarios,
    template: TEMPLATE_TO_LABEL[input.template],
  };
}
