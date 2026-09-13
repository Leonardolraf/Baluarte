import type {
  AssetStatus,
  AssetType,
  CampaignStatus,
  CampaignTemplate,
  RecipientStage,
  ScanStatus,
  Severity,
  UserStatus,
  VulnerabilityStatus,
} from '@/types';

// -----------------------------------------------------------------------------
// Mapas de rótulos (pt-BR), ordenação e classes Tailwind por severidade/status.
// Cores de severidade são o ÚNICO lugar onde a paleta acentuada aparece.
// -----------------------------------------------------------------------------

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Crítico',
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
  info: 'Informativo',
};

/** Menor número = mais grave (para ordenação). */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export const SEVERITY_BADGE_CLASS: Record<Severity, string> = {
  critical:
    'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-500/30',
  high: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/60 dark:text-orange-300 dark:ring-orange-500/30',
  medium:
    'bg-yellow-50 text-yellow-800 ring-yellow-600/20 dark:bg-yellow-950/60 dark:text-yellow-300 dark:ring-yellow-500/30',
  low: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-500/30',
  info: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-500/30',
};

export const SEVERITY_DOT_CLASS: Record<Severity, string> = {
  critical: 'bg-severity-critical',
  high: 'bg-severity-high',
  medium: 'bg-severity-medium',
  low: 'bg-severity-low',
  info: 'bg-severity-info',
};

/** Texto colorido por severidade com contraste ≥ 4,5:1 nos dois temas (tons 700 / 300). */
export const SEVERITY_TEXT_CLASS: Record<Severity, string> = {
  critical: 'text-red-700 dark:text-red-300',
  high: 'text-orange-700 dark:text-orange-300',
  medium: 'text-yellow-800 dark:text-yellow-300',
  low: 'text-green-700 dark:text-green-300',
  info: 'text-blue-700 dark:text-blue-300',
};

/** Texto por severidade sobre a placa escura (`.plate`), independente do tema: tons 300. */
export const SEVERITY_PLATE_TEXT_CLASS: Record<Severity, string> = {
  critical: 'text-red-300',
  high: 'text-orange-300',
  medium: 'text-yellow-300',
  low: 'text-green-300',
  info: 'text-blue-300',
};

export const SEVERITY_HEX: Record<Severity, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#16a34a',
  info: '#2563eb',
};

/** Classificação CVSS v3.1 (FIRST): 0.0 None, 0.1–3.9 Low, 4.0–6.9 Medium, 7.0–8.9 High, 9.0–10.0 Critical. */
export function severityFromCvss(score: number): Severity {
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0) return 'low';
  return 'info';
}

/** Severidade a partir de um índice de risco 0–100 (gauges do dashboard). */
export function severityFromRisk(risk: number): Severity {
  if (risk >= 75) return 'critical';
  if (risk >= 50) return 'high';
  if (risk >= 25) return 'medium';
  return 'low';
}

/** Tom de uma taxa de clique em phishing (0–100): ≥ 30 crítico, ≥ 15 alto, senão baixo. Única escala da plataforma. */
export function clickRateSeverity(clickRate: number): Severity {
  if (clickRate >= 30) return 'critical';
  if (clickRate >= 15) return 'high';
  return 'low';
}

/** Tom da resiliência a phishing (100 − taxa de clique): inverso de `clickRateSeverity`; `null` = não medida. */
export function resilienceSeverity(resilience: number | null): Severity {
  if (resilience === null) return 'info';
  return clickRateSeverity(100 - resilience);
}

// ---- Status de vulnerabilidade ---------------------------------------------

export const VULN_STATUS_LABEL: Record<VulnerabilityStatus, string> = {
  open: 'Aberta',
  in_review: 'Em revisão',
  remediating: 'Em remediação',
  resolved: 'Resolvida',
  accepted: 'Risco aceito',
};

export const VULN_STATUS_CLASS: Record<VulnerabilityStatus, string> = {
  open: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30',
  in_review:
    'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-500/30',
  remediating:
    'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-500/30',
  resolved:
    'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-500/30',
  accepted:
    'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-500/30',
};

// ---- Varreduras -------------------------------------------------------------

export const SCAN_STATUS_LABEL: Record<ScanStatus, string> = {
  queued: 'Em fila',
  running: 'Em andamento',
  completed: 'Concluída',
  failed: 'Falhou',
};

// ---- Campanhas --------------------------------------------------------------

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Rascunho',
  scheduled: 'Agendada',
  active: 'Ativa',
  completed: 'Encerrada',
  cancelled: 'Cancelada',
};

export const CAMPAIGN_STATUS_CLASS: Record<CampaignStatus, string> = {
  draft:
    'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30',
  scheduled:
    'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-500/30',
  active:
    'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-500/30',
  completed:
    'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-500/30',
  cancelled:
    'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-500/30',
};

export const CAMPAIGN_STATUS_DOT_CLASS: Record<CampaignStatus, string> = {
  draft: 'bg-slate-400',
  scheduled: 'bg-sky-500',
  active: 'bg-green-500',
  completed: 'bg-slate-500',
  cancelled: 'bg-red-500',
};

export const CAMPAIGN_TEMPLATE_LABEL: Record<CampaignTemplate, string> = {
  urgency: 'Urgência',
  authority: 'Autoridade',
  curiosity: 'Curiosidade',
};

export const CAMPAIGN_TEMPLATE_DESCRIPTION: Record<CampaignTemplate, string> = {
  urgency: 'Pressão por ação imediata: "sua conta será bloqueada em 24h".',
  authority: 'Solicitação vinda de um "diretor" ou de "TI": "atualize sua senha agora".',
  curiosity: 'Isca de interesse: "veja o novo plano de cargos e salários".',
};

/** Etapa mais avançada de UM destinatário (forma pessoal: "o colaborador…"). */
export const RECIPIENT_STAGE_LABEL: Record<RecipientStage, string> = {
  sent: 'Recebeu',
  opened: 'Abriu',
  clicked: 'Clicou',
  submitted: 'Submeteu credenciais',
  reported: 'Reportou',
};

export const RECIPIENT_STAGE_CLASS: Record<RecipientStage, string> = {
  sent: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-500/30',
  opened: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-500/30',
  clicked:
    'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-950/60 dark:text-orange-300 dark:ring-orange-500/30',
  submitted:
    'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-500/30',
  reported:
    'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-500/30',
};

/** Rótulos agregados do funil (contagens: "N enviados, N abertos…"). */
export const FUNNEL_STAGE_LABEL: Record<RecipientStage, string> = {
  sent: 'Enviados',
  opened: 'Abertos',
  clicked: 'Clicados',
  submitted: 'Credenciais submetidas',
  reported: 'Reportados',
};

/** Cor das barras do funil, derivada dos mapas existentes (nada de cores avulsas). */
export const RECIPIENT_STAGE_DOT_CLASS: Record<RecipientStage, string> = {
  sent: 'bg-slate-400 dark:bg-slate-500',
  opened: 'bg-sky-500',
  clicked: SEVERITY_DOT_CLASS.high,
  submitted: SEVERITY_DOT_CLASS.critical,
  reported: SEVERITY_DOT_CLASS.low,
};

// ---- Ativos e usuários ------------------------------------------------------

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  server: 'Servidor',
  application: 'Aplicação',
  network: 'Rede',
  database: 'Banco de Dados',
};

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  pending: 'Pendente',
};

export const USER_STATUS_CLASS: Record<UserStatus, string> = {
  active:
    'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-500/30',
  inactive:
    'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-500/30',
  pending:
    'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-500/30',
};
