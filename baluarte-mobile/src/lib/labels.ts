import type { CampaignStatus, RecipientStage, Role } from '../types';

/** Rótulos pt-BR (os mesmos de `lib/roles.ts` e `lib/severity.ts` do produto web). */

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  analyst: 'Analista',
  collaborator: 'Colaborador',
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  scheduled: 'Agendada',
  active: 'Ativa',
  completed: 'Encerrada',
};

export const RECIPIENT_STAGE_LABEL: Record<RecipientStage, string> = {
  notReceived: 'Não recebeu',
  received: 'Recebeu',
  opened: 'Abriu',
  clicked: 'Clicou',
  submitted: 'Submeteu credenciais',
  reported: 'Reportou',
};
