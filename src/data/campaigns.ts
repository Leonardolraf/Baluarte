import { emailFromName } from '../lib/format';
import type { Campaign, CampaignMetrics, CampaignStatus, RecipientStage, TemplateId } from '../types';

/**
 * Campanhas do produto web (`MOCK_CAMPAIGNS`). As datas são relativas a
 * "hoje" às 09:00, então a lista parece sempre atual. `metrics` traz os
 * números reais; `sample` é a amostra de destinatários mostrada nos Detalhes.
 */
interface CampaignSeed {
  id: string;
  name: string;
  template: TemplateId;
  targetGroup: string;
  status: CampaignStatus;
  /** Dias a partir de hoje (negativo = passado). */
  daysFromToday: number;
  metrics: CampaignMetrics;
  sample: ReadonlyArray<readonly [name: string, stage: RecipientStage]>;
}

const SEEDS: readonly CampaignSeed[] = [
  {
    id: 'camp-005',
    name: 'Diretoria – Autoridade Q4',
    template: 'authority',
    targetGroup: 'Diretoria',
    status: 'scheduled',
    daysFromToday: 25,
    metrics: { recipients: 24, sent: 0, opened: 0, clicked: 0, submitted: 0, reported: 0 },
    sample: [
      ['Marcelo Martins', 'notReceived'],
      ['Patrícia Pereira', 'notReceived'],
      ['Otávio Oliveira', 'notReceived'],
    ],
  },
  {
    id: 'camp-001',
    name: 'Simulação Q3 – Financeiro',
    template: 'urgency',
    targetGroup: 'Financeiro',
    status: 'active',
    daysFromToday: -5,
    metrics: { recipients: 156, sent: 156, opened: 97, clicked: 37, submitted: 17, reported: 30 },
    sample: [
      ['Ana Almeida', 'reported'],
      ['Bruno Barbosa', 'clicked'],
      ['Carla Cardoso', 'submitted'],
    ],
  },
  {
    id: 'camp-004',
    name: 'Fake Invoice Julho',
    template: 'curiosity',
    targetGroup: 'Comercial',
    status: 'completed',
    daysFromToday: -62,
    metrics: { recipients: 120, sent: 120, opened: 70, clicked: 34, submitted: 16, reported: 11 },
    sample: [
      ['Gabriela Gonçalves', 'submitted'],
      ['Henrique Lima', 'received'],
      ['Isabela Martins', 'clicked'],
    ],
  },
  {
    id: 'camp-002',
    name: 'Campanha Junho 2026 – Urgência',
    template: 'urgency',
    targetGroup: 'Toda a empresa',
    status: 'completed',
    daysFromToday: -92,
    metrics: { recipients: 203, sent: 203, opened: 144, clicked: 63, submitted: 30, reported: 24 },
    sample: [
      ['Daniel Dias', 'opened'],
      ['Eduarda Esteves', 'reported'],
      ['Felipe Ferreira', 'clicked'],
    ],
  },
  {
    id: 'camp-003',
    name: 'Simulação Credencial Maio',
    template: 'authority',
    targetGroup: 'TI e Operações',
    status: 'completed',
    daysFromToday: -118,
    metrics: { recipients: 180, sent: 180, opened: 119, clicked: 31, submitted: 14, reported: 40 },
    sample: [
      ['João Nunes', 'reported'],
      ['Larissa Oliveira', 'reported'],
      ['Natália Queiroz', 'opened'],
    ],
  },
];

/** Hoje + `days`, às 09:00 no fuso local. */
export function daysFromTodayAtNine(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 9, 0, 0, 0);
}

export function buildInitialCampaigns(now: Date = new Date()): Campaign[] {
  return SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    template: seed.template,
    targetGroup: seed.targetGroup,
    status: seed.status,
    scheduledAt: daysFromTodayAtNine(now, seed.daysFromToday).toISOString(),
    metrics: { ...seed.metrics },
    recipients: seed.sample.map(([name, stage], index) => ({
      id: `${seed.id}-r-${index + 1}`,
      name,
      email: emailFromName(name),
      stage,
    })),
  }));
}
