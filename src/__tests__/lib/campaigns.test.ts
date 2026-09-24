import { buildInitialCampaigns, daysFromTodayAtNine } from '../../data/campaigns';
import {
  campaignKpis,
  createScheduledCampaign,
  filterByTemplate,
  sortByScheduleDesc,
} from '../../lib/campaigns';
import { formatShortDateTime } from '../../lib/format';

const NOW = new Date(2026, 8, 23, 10, 0); // 23/09/2026

describe('dados e regras das campanhas', () => {
  const campaigns = sortByScheduleDesc(buildInitialCampaigns(NOW));

  it('gera as 5 campanhas do produto com datas relativas a hoje às 09:00', () => {
    expect(campaigns.map((campaign) => campaign.name)).toEqual([
      'Diretoria – Autoridade Q4',
      'Simulação Q3 – Financeiro',
      'Fake Invoice Julho',
      'Campanha Junho 2026 – Urgência',
      'Simulação Credencial Maio',
    ]);
    expect(campaigns.map((campaign) => formatShortDateTime(campaign.scheduledAt))).toEqual([
      '18/10 às 09:00h',
      '18/09 às 09:00h',
      '23/07 às 09:00h',
      '23/06 às 09:00h',
      '28/05 às 09:00h',
    ]);
  });

  it('hoje + N dias às 09:00', () => {
    expect(daysFromTodayAtNine(NOW, 7)).toEqual(new Date(2026, 8, 30, 9, 0));
  });

  it('filtra por modelo (null = todas)', () => {
    expect(filterByTemplate(campaigns, null)).toHaveLength(5);
    expect(filterByTemplate(campaigns, 'urgency').map((c) => c.name)).toEqual([
      'Simulação Q3 – Financeiro',
      'Campanha Junho 2026 – Urgência',
    ]);
    expect(filterByTemplate(campaigns, 'curiosity')).toHaveLength(1);
  });

  it('KPIs: agendada mostra destinatários, enviados e "—"', () => {
    const scheduled = campaigns[0];
    expect(campaignKpis(scheduled).map(({ value, label }) => [value, label])).toEqual([
      ['24', 'DESTINATÁRIOS'],
      ['0', 'ENVIADOS'],
      ['—', 'TAXA DE CLIQUE'],
    ]);
  });

  it('KPIs: demais mostram enviados, taxa de clique e reportaram', () => {
    const active = campaigns[1];
    expect(campaignKpis(active).map(({ value, label }) => [value, label])).toEqual([
      ['156', 'ENVIADOS'],
      ['24%', 'TAXA DE CLIQUE'],
      ['30', 'REPORTARAM'],
    ]);
    expect(campaignKpis(campaigns[2])[1].value).toBe('28%');
    expect(campaignKpis(campaigns[3])[1].value).toBe('31%');
    expect(campaignKpis(campaigns[4])[1].value).toBe('17%');
  });

  it('cria a campanha agendada com métricas zeradas e destinatários "Não recebeu"', () => {
    const campaign = createScheduledCampaign(
      {
        name: 'Simulação Q4 – Financeiro',
        template: 'urgency',
        targetGroup: 'Financeiro',
        scheduledAt: new Date(2026, 8, 30, 9, 0),
        recipients: ['ana.almeida@empresa.com', 'bruno.barbosa@empresa.com'],
      },
      'camp-006',
    );

    expect(campaign.status).toBe('scheduled');
    expect(campaign.metrics).toEqual({
      recipients: 2,
      sent: 0,
      opened: 0,
      clicked: 0,
      submitted: 0,
      reported: 0,
    });
    expect(campaign.recipients).toEqual([
      { id: 'camp-006-r-1', name: 'Ana Almeida', email: 'ana.almeida@empresa.com', stage: 'notReceived' },
      { id: 'camp-006-r-2', name: 'Bruno Barbosa', email: 'bruno.barbosa@empresa.com', stage: 'notReceived' },
    ]);

    // A nova (hoje + 7) entra entre a Diretoria (+25) e a Simulação Q3 (−5).
    const sorted = sortByScheduleDesc([campaign, ...campaigns]);
    expect(sorted[1].id).toBe('camp-006');
  });
});
