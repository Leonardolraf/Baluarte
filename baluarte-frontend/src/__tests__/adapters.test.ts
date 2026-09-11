import { describe, expect, it } from 'vitest';
import {
  fromCampaignInput,
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
