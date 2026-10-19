import { describe, expect, it } from 'vitest';
import {
  fromCampaignInput,
  toCampaign,
  type BackendCampaign,
  fromNotificationPreferences,
  toNotificationPreferences,
  toTraining,
  type BackendTraining,
} from '@/services/adapters';

// Adapters das rotas adicionais do backend (preferências, campanha com vários
// destinatários e treinamento com vínculo de campanha).

function backendTraining(overrides: Partial<BackendTraining> = {}): BackendTraining {
  return {
    tipoAtaque: 'Phishing por Autoridade',
    titulo: 'Quando o "chefe" pede algo fora do processo',
    codigoModulo: 'US-006',
    duracaoMin: 7,
    progresso: 0,
    campanha: 'Simulação Q3 – Financeiro',
    sinaisAlerta: ['Pedido sigiloso vindo de uma chefia'],
    boasPraticas: ['Confirme o pedido por outro canal'],
    ...overrides,
  };
}

describe('services/adapters — preferências de notificação', () => {
  it('converte os campos em português do backend e faz a volta sem perder nada', () => {
    const prefs = toNotificationPreferences({
      alertasEmail: false,
      somenteCriticas: true,
      resumoSemanal: false,
      relatoriosCampanha: true,
      atualizadoEm: '2026-09-11T12:00:00.000Z',
    });
    expect(prefs).toEqual({
      emailAlerts: false,
      criticalOnly: true,
      weeklyDigest: false,
      campaignReports: true,
    });
    expect(fromNotificationPreferences(prefs)).toEqual({
      alertasEmail: false,
      somenteCriticas: true,
      resumoSemanal: false,
      relatoriosCampanha: true,
    });
  });
});

describe('services/adapters — campanha com vários destinatários', () => {
  it('envia `destinatario` (contrato original) e `destinatarios[]` normalizados e sem duplicatas', () => {
    const payload = fromCampaignInput({
      name: '  Simulação Q3 – Financeiro ',
      template: 'authority',
      targetGroup: 'Financeiro',
      scheduledAt: '2026-10-01T09:00:00.000Z',
      recipients: [' Ana.Souza@empresa.com', 'bruno.lima@empresa.com', 'ana.souza@empresa.com', ''],
    });
    expect(payload).toEqual({
      nome: 'Simulação Q3 – Financeiro',
      destinatario: 'ana.souza@empresa.com',
      destinatarios: ['ana.souza@empresa.com', 'bruno.lima@empresa.com'],
      template: 'autoridade',
    });
  });
});

describe('services/adapters — treinamento', () => {
  it('liga o treinamento à campanha e lê a conclusão informada pelo backend', () => {
    const pending = toTraining('evt-1', backendTraining({ idCampanha: 'camp-9' }));
    expect(pending).toMatchObject({
      id: 'evt-1',
      campaignId: 'camp-9',
      completed: false,
      completedAt: null,
      attackType: 'Phishing por Autoridade',
      moduleCode: 'US-006',
    });

    const done = toTraining(
      'evt-1',
      backendTraining({ progresso: 100, concluidoEm: '2026-09-11T10:30:00.000Z', idCampanha: null }),
    );
    expect(done).toMatchObject({
      campaignId: null,
      completed: true,
      progress: 100,
      completedAt: '2026-09-11T10:30:00.000Z',
    });
  });
});

// Lista de campanhas: o alcance e um dado do servidor, nao uma deducao do status.
//
// Contexto medido em 19/10/2026: nenhum caminho da API tira a campanha de AGENDADA
// (campanha.repository.ts escreve so esse status), entao derivar o envio do status zerava o
// alcance de toda campanha criada pela plataforma — inclusive a `Fake Invoice Julho` do
// seed-demo, com `enviadoEm` gravado nos 180 eventos. O backend passou a mandar `enviados`
// (fix/campanha-enviados); aqui fica a prova de que a tela usa o dado e nao a deducao.

function backendCampaign(overrides: Partial<BackendCampaign> = {}): BackendCampaign {
  return {
    id: 'camp-900',
    nome: 'Fake Invoice Julho',
    template: 'curiosidade',
    status: 'AGENDADA',
    destinatarios: 180,
    taxaClique: 10,
    criadoEm: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('services/adapters — alcance da lista de campanhas', () => {
  it('usa `enviados` do servidor mesmo com a campanha em AGENDADA', () => {
    const c = toCampaign(backendCampaign({ enviados: 180 }));
    expect(c.status).toBe('scheduled');
    expect(c.metrics.sent).toBe(180);
    // Com envio, a data de inicio deixa de ser nula e o clique sai da taxa real.
    expect(c.startedAt).not.toBeNull();
    expect(c.metrics.clicked).toBe(18);
  });

  it('campanha sem nenhum envio continua com alcance zero', () => {
    const c = toCampaign(backendCampaign({ enviados: 0, taxaClique: 0 }));
    expect(c.metrics.sent).toBe(0);
    expect(c.startedAt).toBeNull();
  });

  it('sem o campo (API antiga) mantem a conta de antes, sem piorar', () => {
    const agendada = toCampaign(backendCampaign());
    expect(agendada.metrics.sent).toBe(0);
    const ativa = toCampaign(backendCampaign({ status: 'ATIVA' }));
    expect(ativa.metrics.sent).toBe(180);
  });

  it('abertura da lista e desconhecida, nunca zero', () => {
    const c = toCampaign(backendCampaign({ enviados: 180 }));
    // A lista nao traz abertura: afirmar 0 diria "ninguem abriu" sobre uma campanha que
    // pode ter sido aberta por todos. Quem tem o funil e o relatorio da campanha.
    expect(c.metrics.opened).toBeNull();
    expect(c.metrics.openRate).toBeNull();
  });
});
