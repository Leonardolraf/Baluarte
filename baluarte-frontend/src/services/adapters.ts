import type {
  AuditEntry,
  AuditListResponse,
  AccountLink,
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
  FileScan,
  FunnelStage,
  SecondOpinion,
  SecondOpinionReason,
  SecondOpinionStatus,
  NotificationPreferences,
  RBACRole,
  RemediationStep,
  ScanReport,
  ScanStatus,
  SecurityPolicy,
  Severity,
  SoftwareSource,
  Station,
  StationDetail,
  StationListResponse,
  StationPort,
  TimelineEvent,
  Training,
  TrainingOverview,
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
  /** Nome do departamento (ou null quando sem departamento). */
  departamento?: string | null;
}

export interface BackendAsset {
  id: string;
  nome: string;
  host: string;
  tipo: string;
  status: string;
  criadoEm: string;
  /** Extensão compatível do B10 (opcionais; null quando não informados). */
  ip?: string | null;
  descricao?: string | null;
  achadosAbertos?: number;
  ultimaVarredura?: { id: string; status: string; criadoEm: string; concluidoEm?: string | null } | null;
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
  /** B26: só nas leituras (GET /scans e /scans/:id); a resposta do POST /scans não traz. */
  progresso?: number;
  etapa?: string;
  estimativaConclusao?: string;
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
  cwe?: string | null;
  cve?: string | null;
  cvssVetor?: string | null;
  remediacao?: Array<{ ordem: number; titulo: string; descricao: string; esforco: string }>;
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
  treinamentos: Array<{
    destinatario: string;
    /** Departamento atual do destinatário ("Sem departamento" quando não há). */
    departamento?: string;
    concluido: boolean;
    /** Id do evento de campanha: é o `:token` de /treinamentos/:token. */
    token?: string;
    concluidoEm?: string | null;
    /** Quando reportou o e-mail simulado (também quem clicou pode reportar). */
    reportouEm?: string | null;
  }>;
  /** Quem reportou o e-mail simulado pelo rodapé, em ordem de reporte (clicando ou não). */
  reportes?: Array<{
    destinatario: string;
    departamento?: string;
    reportouEm: string;
    clicou: boolean;
  }>;
  porDepartamento?: Array<{
    departamento: string;
    destinatarios: number;
    clicados: number;
    taxaClique: number;
  }>;
}

/**
 * GET /dashboard. Para o Colaborador (RN-006, B10) os KPIs técnicos e a distribuição vêm
 * `null`; a resiliência vem `null` quando nada foi enviado (não medido).
 */
export interface BackendDashboard {
  kpis: {
    vulnerabilidadesAbertas: number | null;
    criticas: number | null;
    resilienciaPhishing: number | null;
    ativosMonitorados: number | null;
  };
  distribuicaoSeveridade: Record<string, number> | null;
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
    sessaoMaximaHoras: number;
    limiteTentativasLogin: number;
    doisFatores: boolean;
  };
  auditoria: { registraAcoes: boolean; logImutavel: boolean; retencaoMeses: number | null };
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

/**
 * Severidade no rótulo do backend (filtro do relatório em PDF). "Informativo" não existe no
 * servidor: a nota CVSS de todo achado cai numa das quatro faixas.
 */
export const SEVERITY_TO_LABEL: Partial<Record<Severity, string>> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
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
  // Criado só pela inscrição do agente osquery (B07).
  'estação de trabalho': 'workstation',
  'estacao de trabalho': 'workstation',
};

export const ASSET_TYPE_TO_LABEL: Record<AssetType, string> = {
  server: 'Servidor',
  application: 'Aplicacao',
  network: 'Rede',
  database: 'Banco de Dados',
  workstation: 'Estação de trabalho',
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

const EFFORT_FROM_LABEL: Record<string, RemediationStep['effort']> = {
  baixo: 'low',
  medio: 'medium',
  alto: 'high',
};

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
    department: raw.departamento ?? undefined,
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
    // O IP informado no cadastro; sem ele, o host quando o próprio host é um IPv4.
    ip: raw.ip ?? (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw.host) ? raw.host : null),
    description: raw.descricao ?? null,
    status: norm(raw.status) === 'inativo' ? 'inactive' : 'active',
    createdAt: raw.criadoEm,
    // A API passou a devolver os dois; a tela não precisa mais derivar de outras listas.
    lastScanAt: raw.ultimaVarredura?.concluidoEm ?? raw.ultimaVarredura?.criadoEm ?? null,
    openFindings: raw.achadosAbertos ?? 0,
  };
}

/** Etapa quando o servidor não informou (ex.: resposta do POST /scans): sai do status. */
const SCAN_STAGE_FALLBACK: Record<ScanStatus, string> = {
  queued: 'Na fila',
  running: 'Em andamento',
  completed: 'Concluída',
  failed: 'Falhou',
};

export function toScan(raw: BackendScan): ScanReport {
  const started = new Date(raw.criadoEm).getTime();
  const finished = raw.concluidoEm ? new Date(raw.concluidoEm).getTime() : null;
  const status = SCAN_STATUS_FROM_LABEL[norm(raw.status)] ?? 'queued';
  const progress =
    typeof raw.progresso === 'number' && Number.isFinite(raw.progresso)
      ? Math.max(0, Math.min(100, Math.round(raw.progresso)))
      : status === 'completed'
        ? 100
        : 0;
  return {
    id: raw.id,
    assetId: raw.assetId,
    assetName: raw.asset?.nome ?? raw.assetId,
    assetHost: raw.asset?.host ?? '',
    status,
    scanner: 'Baluarte OWASP Engine',
    startedAt: raw.criadoEm,
    finishedAt: raw.concluidoEm ?? null,
    durationSec: finished ? Math.max(0, Math.round((finished - started) / 1000)) : null,
    findingsCount: raw._count?.findings ?? 0,
    findingsBySeverity: emptySeverityMap(),
    progress,
    stage: raw.etapa || SCAN_STAGE_FALLBACK[status],
    estimatedCompletionAt: raw.estimativaConclusao ?? raw.concluidoEm ?? null,
  };
}

export function toVulnerability(raw: BackendFinding): Vulnerability {
  const { owaspId, owaspCategory } = owaspParts(raw.categoria);
  const severity = severityFromLabel(raw.severidade, raw.cvss);
  const status = VULN_STATUS_FROM_LABEL[norm(raw.status)] ?? 'open';
  return {
    id: raw.id,
    title: raw.descricao,
    cve: raw.cve ?? null,
    cwe: raw.cwe ?? null,
    owaspId,
    owaspCategory,
    cvss: { version: '3.1', vector: raw.cvssVetor ?? '', base: raw.cvss },
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
    remediation: (raw.remediacao ?? []).map((p) => ({
      order: p.ordem,
      title: p.titulo,
      description: p.descricao,
      effort: EFFORT_FROM_LABEL[norm(p.esforco)] ?? 'medium',
    })),
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
    id: t.token ?? `${raw.id}-r${i}`,
    campaignId: raw.id,
    name: t.destinatario.split('@')[0] ?? t.destinatario,
    email: t.destinatario,
    department: t.departamento ?? 'Sem departamento',
    sentAt: raw.criadoEm,
    openedAt: raw.criadoEm,
    clickedAt: raw.criadoEm,
    submittedAt: null,
    reportedAt: t.reportouEm ?? null,
    trainingCompleted: t.concluido,
    // O treinamento pós-clique é acessado pelo id do evento (token) de cada destinatário.
    trainingId: t.token ?? null,
  }));
  // Quem reportou sem clicar não está em `treinamentos`: entra como linha própria.
  const clicaram = new Set(raw.treinamentos.map((t) => t.destinatario.toLowerCase()));
  (raw.reportes ?? [])
    .filter((r) => !clicaram.has(r.destinatario.toLowerCase()))
    .forEach((r, i) =>
      recipients.push({
        id: `${raw.id}-rep${i}`,
        campaignId: raw.id,
        name: r.destinatario.split('@')[0] ?? r.destinatario,
        email: r.destinatario,
        department: r.departamento ?? 'Sem departamento',
        sentAt: raw.criadoEm,
        openedAt: r.reportouEm,
        clickedAt: null,
        submittedAt: null,
        reportedAt: r.reportouEm,
        trainingCompleted: false,
        trainingId: null,
      }),
    );
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
      ...(raw.reportes ?? []).map((r, i): CampaignReport['timeline'][number] => ({
        id: `${raw.id}-reported-${i}`,
        at: r.reportouEm,
        kind: 'reported',
        description: `${r.destinatario} reportou o e-mail suspeito.`,
      })),
      {
        id: `${raw.id}-scheduled`,
        at: raw.criadoEm,
        kind: 'scheduled' as const,
        description: `Campanha "${raw.nome}" criada.`,
      },
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    byDepartment: (raw.porDepartamento ?? []).map((d) => ({
      department: d.departamento,
      recipients: d.destinatarios,
      clicked: d.clicados,
      clickRate: d.taxaClique,
    })),
  };
}

export function toDashboard(raw: BackendDashboard, scans: ScanReport[] = []): DashboardMetrics {
  // Colaborador (RN-006, B10): a API não manda a parte técnica nem as campanhas; só a resiliência.
  const technical = raw.distribuicaoSeveridade !== null && raw.kpis.vulnerabilidadesAbertas !== null;
  let severityDistribution: Record<Severity, number> | null = null;
  let technicalRisk: number | null = null;
  if (raw.distribuicaoSeveridade !== null) {
    const distribution = emptySeverityMap();
    for (const [label, count] of Object.entries(raw.distribuicaoSeveridade)) {
      distribution[severityFromLabel(label)] += count;
    }
    const weighted =
      distribution.critical * 10 + distribution.high * 6 + distribution.medium * 3 + distribution.low * 1;
    const capacity = Math.max(1, raw.kpis.ativosMonitorados ?? 0) * 20;
    technicalRisk = Math.max(0, Math.min(100, Math.round((weighted / capacity) * 100)));
    severityDistribution = distribution;
  }
  const campaigns = raw.campanhas.map(toCampaign);
  // Sem envios o índice é NÃO MEDIDO (null), nunca 0 % / risco humano 100 %. A API manda null
  // nesse caso; para o operador, a soma dos envios das campanhas confirma (backend anterior mandava 0).
  const totalSent = campaigns.reduce((sum, c) => sum + c.metrics.sent, 0);
  const phishingResilience =
    raw.kpis.resilienciaPhishing === null || (technical && totalSent === 0)
      ? null
      : raw.kpis.resilienciaPhishing;
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
      openVulnerabilities: raw.kpis.vulnerabilidadesAbertas,
      criticalVulnerabilities: raw.kpis.criticas,
      phishingResilience,
      monitoredAssets: raw.kpis.ativosMonitorados,
      // Contagens de campanha só existem para quem recebe as campanhas (operadores).
      activeCampaigns: technical ? campaigns.filter((c) => c.status === 'active').length : null,
      trainedCollaborators: technical ? campaigns.reduce((sum, c) => sum + c.metrics.trained, 0) : null,
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
    sessionMaxHours: raw.sessao.sessaoMaximaHoras,
    loginAttemptLimit: raw.sessao.limiteTentativasLogin,
    twoFactorEnabled: raw.sessao.doisFatores,
    auditRegistersActions: raw.auditoria.registraAcoes,
    auditLogImmutable: raw.auditoria.logImutavel,
    auditRetentionMonths: raw.auditoria.retencaoMeses ?? null,
  };
}

export interface BackendAccountLink {
  tipo: string;
  nome: string;
  email: string;
  expiraEm: string;
}

export function toAccountLink(raw: BackendAccountLink): AccountLink {
  return {
    kind: String(raw.tipo).toUpperCase() === 'CONVITE' ? 'invite' : 'reset',
    name: raw.nome,
    email: raw.email,
    expiresAt: raw.expiraEm,
  };
}

export interface BackendTrainingOverview {
  campanhas: number;
  conclusoes: number;
  cliques: number;
  pendentesAposClique: number;
  conclusoesNominais: number;
  colaboradores: Array<{
    nome: string;
    email: string;
    departamento: string;
    campanhas: Array<{ id: string; nome: string }>;
  }>;
  porDepartamento: Array<{ departamento: string; conclusoes: number }>;
}

export function toTrainingOverview(raw: BackendTrainingOverview): TrainingOverview {
  return {
    campaigns: raw.campanhas,
    completions: raw.conclusoes,
    clicked: raw.cliques,
    pendingAfterClick: raw.pendentesAposClique,
    namedCompletions: raw.conclusoesNominais,
    people: raw.colaboradores.map((c) => ({
      name: c.nome,
      email: c.email,
      department: c.departamento,
      campaigns: c.campanhas.map((x) => ({ id: x.id, name: x.nome })),
    })),
    byDepartment: raw.porDepartamento.map((d) => ({
      department: d.departamento,
      completions: d.conclusoes,
    })),
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

export function fromAssetInput(input: AssetInput): {
  nome: string;
  tipo: string;
  host: string;
  ip?: string;
  descricao?: string;
} {
  const ip = input.ip?.trim();
  const descricao = input.description?.trim();
  return {
    nome: input.name.trim(),
    tipo: ASSET_TYPE_TO_LABEL[input.type],
    host: input.host.trim(),
    // Extensão compatível do B10: só vão quando preenchidos (o corpo do contrato fica igual).
    ...(ip ? { ip } : {}),
    ...(descricao ? { descricao } : {}),
  };
}

export function fromUserInput(input: UserInput): {
  nome: string;
  email: string;
  perfil: string;
  departamento?: string | null;
} {
  return {
    nome: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    perfil: ROLE_TO_LABEL[input.role],
    // '' no formulário = "Sem departamento".
    ...(input.department !== undefined ? { departamento: input.department.trim() || null } : {}),
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

// ---- Análise de arquivos (contrato do B04) ------------------------------------

export interface BackendFileScan {
  id: string;
  nome: string;
  /** Bytes. */
  tamanho: number;
  sha256: string;
  resultado: string;
  ameaca: string | null;
  analisadoEm: string;
  /** Segunda opinião do VirusTotal (B20); null nas análises anteriores a ela. */
  segundaOpiniao?: BackendSecondOpinion | null;
  /** Só para Administrador e Analista em GET /arquivos/analises. */
  usuario?: { nome: string; email: string } | null;
}

export interface BackendSecondOpinion {
  fonte: string;
  situacao: string;
  motivo: string | null;
  deteccoes: number | null;
  total: number | null;
  consultadoEm: string | null;
  link: string;
  mensagem?: string;
}

const SECOND_OPINION_STATUS: Record<string, SecondOpinionStatus> = {
  MALICIOSO: 'malicious',
  SUSPEITO: 'suspicious',
  SEM_DETECCAO: 'no_detection',
  DESCONHECIDO: 'unknown',
  INDISPONIVEL: 'unavailable',
  DESLIGADO: 'disabled',
};

const SECOND_OPINION_REASON: Record<string, SecondOpinionReason> = {
  COTA: 'quota',
  CHAVE_INVALIDA: 'invalid_key',
  LIMITE_VIRUSTOTAL: 'provider_limit',
  TEMPO_ESGOTADO: 'timeout',
  FALHA: 'failure',
};

const countOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Situação desconhecida pelo frontend vira "indisponível" (nunca vira "sem detecção"). */
export function toSecondOpinion(
  raw: BackendSecondOpinion | null | undefined,
  sha256: string,
): SecondOpinion | null {
  if (!raw) return null;
  const status = SECOND_OPINION_STATUS[String(raw.situacao).toUpperCase()] ?? 'unavailable';
  const withCounts = status === 'malicious' || status === 'suspicious' || status === 'no_detection';
  return {
    source: 'VirusTotal',
    status,
    reason:
      status === 'unavailable'
        ? (SECOND_OPINION_REASON[String(raw.motivo).toUpperCase()] ?? 'failure')
        : null,
    detections: withCounts ? countOrNull(raw.deteccoes) : null,
    total: withCounts ? countOrNull(raw.total) : null,
    checkedAt: raw.consultadoEm ?? null,
    link: `https://www.virustotal.com/gui/file/${sha256}`,
  };
}

export function toFileScan(raw: BackendFileScan): FileScan {
  const threat = String(raw.resultado).toUpperCase() === 'AMEACA';
  const scan: FileScan = {
    id: String(raw.id),
    name: raw.nome,
    size: Number(raw.tamanho) || 0,
    sha256: String(raw.sha256).toLowerCase(),
    result: threat ? 'threat' : 'clean',
    threat: threat ? (raw.ameaca ?? null) : null,
    scannedAt: raw.analisadoEm,
    secondOpinion: null,
  };
  scan.secondOpinion = toSecondOpinion(raw.segundaOpiniao, scan.sha256);
  if (raw.usuario) scan.uploadedBy = { name: raw.usuario.nome, email: raw.usuario.email };
  return scan;
}

// ---- Auditoria ----------------------------------------------------------------

export interface BackendAuditEntry {
  id: string;
  acao: string;
  detalhe: string | null;
  quando: string;
  usuario: { id: string; nome: string; email: string } | null;
}

export interface BackendAuditSummary {
  total?: number;
  pagina?: number;
  tamanho?: number;
  acoes?: string[];
}

export function toAuditEntry(raw: BackendAuditEntry): AuditEntry {
  return {
    id: raw.id,
    action: raw.acao,
    detail: raw.detalhe ?? null,
    at: raw.quando,
    user: raw.usuario ? { id: raw.usuario.id, name: raw.usuario.nome, email: raw.usuario.email } : null,
  };
}

/** Lista paginada de GET /auditoria (`dados` + `resumo`). */
export function toAuditList(
  dados: BackendAuditEntry[],
  resumo: BackendAuditSummary | undefined,
  fallback: { page: number; pageSize: number },
): AuditListResponse {
  const items = (dados ?? []).map(toAuditEntry);
  return {
    items,
    total: typeof resumo?.total === 'number' ? resumo.total : items.length,
    page: typeof resumo?.pagina === 'number' ? resumo.pagina : fallback.page,
    pageSize: typeof resumo?.tamanho === 'number' ? resumo.tamanho : fallback.pageSize,
    actions: Array.isArray(resumo?.acoes)
      ? resumo.acoes.filter((a): a is string => typeof a === 'string')
      : [],
  };
}

// ---- Estações monitoradas (B13) ---------------------------------------------

export interface BackendStation {
  id: string;
  ativoId: string;
  nome: string;
  host: string;
  identificador: string;
  sistema: string;
  soNome?: string | null;
  soVersao?: string | null;
  soBuild?: string | null;
  soPlataforma?: string | null;
  /** "Online" | "Offline", calculado pelo servidor a partir do último contato. */
  status: string;
  ultimoContato: string;
  inscritaEm: string;
  inventarioEm: string | null;
  totalProgramas: number;
  totalPortas: number;
}

export interface BackendStationDetail extends BackendStation {
  janelaOfflineS: number;
  programas: Array<{ nome: string; versao: string; fornecedor: string | null; fonte: string }>;
  portas: Array<{ porta: number; protocolo: string; endereco: string; processo: string | null }>;
}

export interface BackendStationSummary {
  total?: number;
  online?: number;
  offline?: number;
  janelaOfflineS?: number;
}

const SOFTWARE_SOURCES: readonly SoftwareSource[] = ['programs', 'deb_packages', 'rpm_packages', 'apps'];

export function toStation(raw: BackendStation): Station {
  return {
    id: raw.id,
    assetId: raw.ativoId,
    name: raw.nome,
    host: raw.host,
    identifier: raw.identificador,
    os: raw.sistema,
    osPlatform: raw.soPlataforma ?? null,
    osBuild: raw.soBuild ?? null,
    status: norm(raw.status) === 'online' ? 'online' : 'offline',
    lastSeenAt: raw.ultimoContato,
    enrolledAt: raw.inscritaEm,
    inventoryAt: raw.inventarioEm ?? null,
    softwareCount: Number(raw.totalProgramas) || 0,
    portCount: Number(raw.totalPortas) || 0,
  };
}

function toStationPort(raw: BackendStationDetail['portas'][number]): StationPort {
  return {
    port: Number(raw.porta),
    protocol: String(raw.protocolo).toUpperCase() === 'UDP' ? 'UDP' : 'TCP',
    address: raw.endereco,
    process: raw.processo ?? null,
  };
}

export function toStationDetail(raw: BackendStationDetail): StationDetail {
  return {
    ...toStation(raw),
    offlineAfterSec: Number(raw.janelaOfflineS) || 0,
    software: raw.programas.map((p) => ({
      name: p.nome,
      version: p.versao ?? '',
      vendor: p.fornecedor ?? null,
      source: (SOFTWARE_SOURCES as readonly string[]).includes(p.fonte)
        ? (p.fonte as SoftwareSource)
        : 'other',
    })),
    ports: raw.portas.map(toStationPort),
  };
}

export function toStationList(
  raw: BackendStation[],
  resumo: BackendStationSummary = {},
): StationListResponse {
  const items = raw.map(toStation);
  const online = items.filter((s) => s.status === 'online').length;
  return {
    items,
    summary: {
      total: resumo.total ?? items.length,
      online: resumo.online ?? online,
      offline: resumo.offline ?? items.length - online,
      offlineAfterSec: resumo.janelaOfflineS ?? 0,
    },
  };
}
