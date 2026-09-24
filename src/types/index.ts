/** Modelos de domínio do app (identificadores em inglês, textos em português). */

export type Role = 'admin' | 'analyst' | 'collaborator';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: string;
}

export type TemplateId = 'urgency' | 'authority' | 'curiosity';

export type TrainingId = 'trn-urgency' | 'trn-authority' | 'trn-curiosity';

/** Modelo de e-mail da simulação (gatilho de engenharia social). */
export interface EmailTemplate {
  id: TemplateId;
  label: string;
  description: string;
  trainingId: TrainingId;
}

export type CampaignStatus = 'scheduled' | 'active' | 'completed';

/** Etapa mais avançada alcançada por um destinatário. */
export type RecipientStage =
  | 'notReceived'
  | 'received'
  | 'opened'
  | 'clicked'
  | 'submitted'
  | 'reported';

export interface Recipient {
  id: string;
  name: string;
  email: string;
  stage: RecipientStage;
}

export interface CampaignMetrics {
  recipients: number;
  sent: number;
  opened: number;
  clicked: number;
  submitted: number;
  reported: number;
}

export interface Campaign {
  id: string;
  name: string;
  template: TemplateId;
  targetGroup: string;
  status: CampaignStatus;
  /** Data/hora do disparo em ISO 8601. */
  scheduledAt: string;
  metrics: CampaignMetrics;
  /** Amostra de destinatários exibida nos Detalhes. */
  recipients: Recipient[];
}

/** Dados já validados para agendar uma campanha nova. */
export interface NewCampaignInput {
  name: string;
  template: TemplateId;
  targetGroup: string;
  scheduledAt: Date;
  recipients: string[];
}

export interface TrainingSection {
  heading: string;
  body: string;
}

export interface Training {
  id: TrainingId;
  moduleCode: string;
  title: string;
  attackType: string;
  summary: string;
  sections: TrainingSection[];
  warningSigns: string[];
  bestPractices: string[];
}
