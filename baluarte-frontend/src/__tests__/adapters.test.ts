import { describe, expect, it } from 'vitest';
import {
  fromCampaignInput,
  toVulnerability,
  type BackendFinding,
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

// DT33 — "Componente afetado" nao pode ser a categoria OWASP.
//
// O adaptador preenchia `affectedComponent` com a categoria OWASP, entao o campo rotulado
// "Componente afetado" mostrava "Vulnerable and Outdated Components" em producao. No mock
// aparecia "log4j-core" e por isso parecia certo na demonstracao. O unico componente que o
// servidor conhece de verdade e o `programa` dos achados de estacao (B14).

function backendFinding(overrides: Partial<BackendFinding> = {}): BackendFinding {
  return {
    id: 'f-900',
    ativo: 'api.empresa.com',
    ativoNome: 'API de Pagamentos',
    categoria: 'A06:2021 - Vulnerable and Outdated Components',
    cvss: 9.8,
    severidade: 'Crítico',
    status: 'Aberta',
    descricao: 'Biblioteca desatualizada com execução remota de código.',
    evidencia: 'trecho do log',
    detectadoEm: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('services/adapters — componente afetado (DT33)', () => {
  it('achado de estação: usa o programa e a versão que o servidor mandou', () => {
    const v = toVulnerability(backendFinding({ programa: 'Mozilla Firefox', programaVersao: '128.1.0' }));
    expect(v.affectedComponent).toBe('Mozilla Firefox');
    expect(v.affectedVersion).toBe('128.1.0');
  });

  it('achado do scanner: componente desconhecido vira null, nunca a categoria OWASP', () => {
    const v = toVulnerability(backendFinding());
    expect(v.affectedComponent).toBeNull();
    expect(v.affectedVersion).toBeNull();
    // A categoria continua existindo, no campo dela.
    expect(v.owaspCategory).toBe('Vulnerable and Outdated Components');
    expect(v.affectedComponent).not.toBe(v.owaspCategory);
  });
});
