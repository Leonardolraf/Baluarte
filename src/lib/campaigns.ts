import type { Campaign, NewCampaignInput, TemplateId } from '../types';
import { clickRate, formatNumber, formatPercent, nameFromEmail } from './format';

/** Regras de negócio das campanhas (puras, testáveis sem renderizar nada). */

/** Mais recente primeiro (data agendada decrescente). */
export function sortByScheduleDesc(campaigns: readonly Campaign[]): Campaign[] {
  return [...campaigns].sort(
    (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
  );
}

/** `null` = sem filtro. */
export function filterByTemplate(
  campaigns: readonly Campaign[],
  template: TemplateId | null,
): Campaign[] {
  return template ? campaigns.filter((campaign) => campaign.template === template) : [...campaigns];
}

export interface Kpi {
  value: string;
  /** Rótulo já em caixa alta, como no protótipo. */
  label: string;
  /** Leitura por extenso para leitores de tela. */
  accessibilityLabel: string;
}

/** Agendada: destinatários / enviados / taxa; demais: enviados / taxa / reportaram. */
export function campaignKpis(campaign: Campaign): Kpi[] {
  const { metrics } = campaign;
  const rate = clickRate(metrics.clicked, metrics.sent);
  const rateKpi: Kpi = {
    value: formatPercent(rate),
    label: 'TAXA DE CLIQUE',
    accessibilityLabel:
      rate === null ? 'Taxa de clique: sem envios' : `Taxa de clique: ${formatPercent(rate)}`,
  };
  const sentKpi: Kpi = {
    value: formatNumber(metrics.sent),
    label: 'ENVIADOS',
    accessibilityLabel: `${formatNumber(metrics.sent)} enviados`,
  };

  if (campaign.status === 'scheduled') {
    return [
      {
        value: formatNumber(metrics.recipients),
        label: 'DESTINATÁRIOS',
        accessibilityLabel: `${formatNumber(metrics.recipients)} destinatários`,
      },
      sentKpi,
      rateKpi,
    ];
  }

  return [
    sentKpi,
    rateKpi,
    {
      value: formatNumber(metrics.reported),
      label: 'REPORTARAM',
      accessibilityLabel: `${formatNumber(metrics.reported)} reportaram`,
    },
  ];
}

/** Cria a campanha agendada: métricas zeradas e todos os destinatários em "Não recebeu". */
export function createScheduledCampaign(input: NewCampaignInput, id: string): Campaign {
  return {
    id,
    name: input.name,
    template: input.template,
    targetGroup: input.targetGroup,
    status: 'scheduled',
    scheduledAt: input.scheduledAt.toISOString(),
    metrics: {
      recipients: input.recipients.length,
      sent: 0,
      opened: 0,
      clicked: 0,
      submitted: 0,
      reported: 0,
    },
    recipients: input.recipients.map((email, index) => ({
      id: `${id}-r-${index + 1}`,
      name: nameFromEmail(email),
      email,
      stage: 'notReceived',
    })),
  };
}

