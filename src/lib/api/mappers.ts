/**
 * Conversão dos formatos da API do produto para os modelos de domínio do app.
 * Espelha a lógica de `baluarte-frontend/src/services/adapters.ts` (fonte de
 * verdade), adaptada ao modelo mais enxuto do mobile (`src/types`).
 */
import { emailFromName } from '../format';
import type {
  Campaign,
  CampaignMetrics,
  CampaignStatus,
  Recipient,
  RecipientStage,
  Role,
  TemplateId,
  User,
} from '../../types';

/** Normaliza rótulos do backend: minúsculas, sem acento, sem espaços nas pontas. */
export function norm(value: string | undefined | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

// ----- Perfil / papel -----

const ROLE_FROM_LABEL: Record<string, Role> = {
  administrador: 'admin',
  analista: 'analyst',
  colaborador: 'collaborator',
};

export function roleFromPerfil(perfil: string): Role {
  return ROLE_FROM_LABEL[norm(perfil)] ?? 'collaborator';
}

// ----- Template (modelo de e-mail) -----

const TEMPLATE_FROM_LABEL: Record<string, TemplateId> = {
  urgencia: 'urgency',
  autoridade: 'authority',
  curiosidade: 'curiosity',
};

/** App → API (para criar campanha). */
export const TEMPLATE_TO_LABEL: Record<TemplateId, string> = {
  urgency: 'urgencia',
  authority: 'autoridade',
  curiosity: 'curiosidade',
};

export function templateFromLabel(template: string): TemplateId {
  return TEMPLATE_FROM_LABEL[norm(template)] ?? 'urgency';
}

// ----- Status da campanha -----

// O app só conhece scheduled/active/completed; cancelada/rascunho caem em scheduled.
const STATUS_FROM_LABEL: Record<string, CampaignStatus> = {
  agendada: 'scheduled',
  ativa: 'active',
  encerrada: 'completed',
};

export function statusFromLabel(status: string): CampaignStatus {
  return STATUS_FROM_LABEL[norm(status)] ?? 'scheduled';
}

// ----- Login / usuário -----

export interface BackendLoginData {
  token: string;
  idUsuario: string;
  email: string;
  perfil: string;
}

export interface BackendMeData {
  id: string;
  nome?: string;
  email: string;
  perfil: string;
  departamento?: string | null;
  /** `true` enquanto a conta não registrou a ciência do aviso de monitoramento. */
  cienciaAvisoPendente?: boolean;
}

/**
 * Monta o `User` do app a partir do `/me` (completo) ou, em fallback, do próprio
 * login (sem nome/departamento, como o frontend web também faz).
 */
export function userFromMe(me: BackendMeData): User {
  return {
    id: me.id,
    name: me.nome?.trim() || me.email,
    email: me.email,
    role: roleFromPerfil(me.perfil),
    department: me.departamento?.trim() || '—',
    noticePending: me.cienciaAvisoPendente === true,
  };
}

export function userFromLogin(login: BackendLoginData): User {
  return {
    id: login.idUsuario,
    name: login.email,
    email: login.email,
    role: roleFromPerfil(login.perfil),
    department: '—',
  };
}

// ----- Campanha (lista) -----

export interface BackendCampaignList {
  id: string;
  nome: string;
  template: string;
  status: string;
  destinatarios: number;
  taxaClique: number;
  criadoEm: string;
}

/**
 * Lista: não há destinatários nem funil completo. Reproduz `toCampaign` do web —
 * `clicked` reconstruído da taxa de clique; demais métricas zeradas.
 */
export function campaignFromList(raw: BackendCampaignList): Campaign {
  const status = statusFromLabel(raw.status);
  const sent = status === 'scheduled' ? 0 : raw.destinatarios;
  const clicked = Math.round((raw.taxaClique / 100) * sent);
  return {
    id: raw.id,
    name: raw.nome,
    template: templateFromLabel(raw.template),
    targetGroup: 'Colaboradores internos',
    status,
    scheduledAt: raw.criadoEm,
    metrics: {
      recipients: raw.destinatarios,
      sent,
      opened: 0,
      clicked,
      submitted: 0,
      reported: 0,
    },
    recipients: [],
  };
}

// ----- Campanha (detalhe) -----

interface FunnelCell {
  valor: number;
  pct: number;
}

export interface BackendCampaignReport {
  id: string;
  nome: string;
  template: string;
  status: string;
  criadoEm: string;
  destinatarios: number;
  funil?: {
    enviados: FunnelCell;
    abertos: FunnelCell;
    clicados: FunnelCell;
    submeteram: FunnelCell;
    reportaram: FunnelCell;
  };
  treinamentos?: Array<{
    destinatario: string;
    departamento?: string;
    concluido: boolean;
    concluidoEm?: string | null;
    reportouEm?: string | null;
  }>;
  reportes?: Array<{
    destinatario: string;
    departamento?: string;
    reportouEm: string;
    clicou: boolean;
  }>;
}

function metricsFromReport(raw: BackendCampaignReport): CampaignMetrics {
  const f = raw.funil;
  return {
    recipients: raw.destinatarios,
    sent: f?.enviados.valor ?? 0,
    opened: f?.abertos.valor ?? 0,
    clicked: f?.clicados.valor ?? 0,
    submitted: f?.submeteram.valor ?? 0,
    reported: f?.reportaram.valor ?? 0,
  };
}

/**
 * Amostra de destinatários para os Detalhes. A API só expõe quem clicou
 * (`treinamentos`) e quem reportou (`reportes`), então a amostra é o melhor
 * possível: quem reportou aparece como "Reportou", os demais cliques como
 * "Clicou". Não dá para listar quem só recebeu/abriu (limite do backend).
 */
function recipientsFromReport(raw: BackendCampaignReport): Recipient[] {
  const byEmail = new Map<string, Recipient>();

  const add = (name: string, stage: RecipientStage) => {
    const email = emailFromName(name);
    const existing = byEmail.get(email);
    // Mantém a etapa mais avançada se o mesmo destinatário aparecer duas vezes.
    if (!existing || STAGE_ORDER[stage] > STAGE_ORDER[existing.stage]) {
      byEmail.set(email, { id: `${raw.id}-r-${byEmail.size + 1}`, name, email, stage });
    }
  };

  for (const r of raw.reportes ?? []) add(r.destinatario, 'reported');
  for (const t of raw.treinamentos ?? []) {
    add(t.destinatario, t.reportouEm ? 'reported' : 'clicked');
  }

  return [...byEmail.values()];
}

const STAGE_ORDER: Record<RecipientStage, number> = {
  notReceived: 0,
  received: 1,
  opened: 2,
  clicked: 3,
  submitted: 4,
  reported: 5,
};

export function campaignFromReport(raw: BackendCampaignReport): Campaign {
  return {
    id: raw.id,
    name: raw.nome,
    template: templateFromLabel(raw.template),
    targetGroup: 'Colaboradores internos',
    status: statusFromLabel(raw.status),
    scheduledAt: raw.criadoEm,
    metrics: metricsFromReport(raw),
    recipients: recipientsFromReport(raw),
  };
}

// ----- Criar campanha -----

export interface CreateCampaignBody {
  nome: string;
  destinatarios: string[];
  template: string;
}

export interface BackendCreateCampaignData {
  idCampanha: string;
  nome: string;
  destinatarios?: string[];
  destinatario?: string;
  template: string;
  status: string;
}

export function createBodyFromInput(input: {
  name: string;
  template: TemplateId;
  recipients: string[];
}): CreateCampaignBody {
  return {
    nome: input.name,
    destinatarios: input.recipients,
    template: TEMPLATE_TO_LABEL[input.template],
  };
}
