import {
  campaignFromList,
  campaignFromReport,
  createBodyFromInput,
  roleFromPerfil,
  statusFromLabel,
  templateFromLabel,
  TEMPLATE_TO_LABEL,
  userFromLogin,
  userFromMe,
  type BackendCampaignList,
  type BackendCampaignReport,
} from '../../lib/api/mappers';

describe('mappers: perfil → papel', () => {
  it('mapeia os três perfis, ignorando acento e caixa', () => {
    expect(roleFromPerfil('Administrador')).toBe('admin');
    expect(roleFromPerfil('ANALISTA')).toBe('analyst');
    expect(roleFromPerfil('colaborador')).toBe('collaborator');
  });

  it('cai em collaborator para perfil desconhecido (menor privilégio)', () => {
    expect(roleFromPerfil('qualquer')).toBe('collaborator');
  });
});

describe('mappers: template', () => {
  it('converte os rótulos em português para os ids do app', () => {
    expect(templateFromLabel('urgencia')).toBe('urgency');
    expect(templateFromLabel('Autoridade')).toBe('authority');
    expect(templateFromLabel('curiosidade')).toBe('curiosity');
  });

  it('cai em urgency para template desconhecido', () => {
    expect(templateFromLabel('promocao')).toBe('urgency');
  });

  it('TEMPLATE_TO_LABEL é o caminho inverso', () => {
    expect(TEMPLATE_TO_LABEL.urgency).toBe('urgencia');
    expect(TEMPLATE_TO_LABEL.authority).toBe('autoridade');
    expect(TEMPLATE_TO_LABEL.curiosity).toBe('curiosidade');
  });
});

describe('mappers: status', () => {
  it('mapeia agendada/ativa/encerrada', () => {
    expect(statusFromLabel('AGENDADA')).toBe('scheduled');
    expect(statusFromLabel('ativa')).toBe('active');
    expect(statusFromLabel('Encerrada')).toBe('completed');
  });

  it('status fora do conjunto do app vira scheduled', () => {
    expect(statusFromLabel('cancelada')).toBe('scheduled');
    expect(statusFromLabel('rascunho')).toBe('scheduled');
  });
});

describe('mappers: usuário', () => {
  it('userFromMe usa nome e departamento quando vêm', () => {
    const user = userFromMe({
      id: 'u-1',
      nome: 'Ana Souza',
      email: 'ana@baluarte.test',
      perfil: 'Analista',
      departamento: 'TI',
      cienciaAvisoPendente: false,
    });
    expect(user).toEqual({
      id: 'u-1',
      name: 'Ana Souza',
      email: 'ana@baluarte.test',
      role: 'analyst',
      department: 'TI',
      noticePending: false,
    });
  });

  it('userFromMe cai no e-mail e "—" quando faltam nome/departamento', () => {
    const user = userFromMe({ id: 'u-2', email: 'x@baluarte.test', perfil: 'Administrador' });
    expect(user.name).toBe('x@baluarte.test');
    expect(user.department).toBe('—');
    expect(user.role).toBe('admin');
  });

  it('userFromMe mapeia cienciaAvisoPendente → noticePending (ausente = desconhecido)', () => {
    expect(userFromMe({ id: 'u', email: 'a@b.test', perfil: 'Analista', cienciaAvisoPendente: true }).noticePending).toBe(true);
    expect(userFromMe({ id: 'u', email: 'a@b.test', perfil: 'Analista', cienciaAvisoPendente: false }).noticePending).toBe(false);
    // Ausente (backend antigo, como a VM hoje) → undefined (DESCONHECIDO), NUNCA
    // false: ausência de dado não é ausência de pendência. A autoridade é o 403.
    expect(userFromMe({ id: 'u', email: 'a@b.test', perfil: 'Analista' }).noticePending).toBeUndefined();
  });

  it('userFromLogin monta o mínimo a partir do login', () => {
    const user = userFromLogin({
      token: 't',
      idUsuario: 'u-3',
      email: 'z@baluarte.test',
      perfil: 'Administrador',
    });
    expect(user).toEqual({
      id: 'u-3',
      name: 'z@baluarte.test',
      email: 'z@baluarte.test',
      role: 'admin',
      department: '—',
    });
  });
});

describe('mappers: campanha da lista', () => {
  const base: BackendCampaignList = {
    id: 'camp-9',
    nome: 'Simulação X',
    template: 'urgencia',
    status: 'ativa',
    destinatarios: 100,
    taxaClique: 24,
    criadoEm: '2026-07-01T12:00:00.000Z',
  };

  it('reconstrói clicked da taxa de clique e fixa o grupo-alvo', () => {
    const campaign = campaignFromList(base);
    expect(campaign.id).toBe('camp-9');
    expect(campaign.template).toBe('urgency');
    expect(campaign.status).toBe('active');
    expect(campaign.targetGroup).toBe('Colaboradores internos');
    expect(campaign.scheduledAt).toBe('2026-07-01T12:00:00.000Z');
    expect(campaign.metrics.recipients).toBe(100);
    expect(campaign.metrics.sent).toBe(100);
    expect(campaign.metrics.clicked).toBe(24); // 24% de 100
    expect(campaign.recipients).toEqual([]);
  });

  it('agendada: enviados e clicados zerados mesmo com destinatários', () => {
    const campaign = campaignFromList({ ...base, status: 'agendada', taxaClique: 0 });
    expect(campaign.status).toBe('scheduled');
    expect(campaign.metrics.sent).toBe(0);
    expect(campaign.metrics.clicked).toBe(0);
    expect(campaign.metrics.recipients).toBe(100);
  });
});

describe('mappers: campanha do detalhe', () => {
  const report: BackendCampaignReport = {
    id: 'camp-1',
    nome: 'Simulação Q3',
    template: 'urgencia',
    status: 'ativa',
    criadoEm: '2026-06-01T09:00:00.000Z',
    destinatarios: 156,
    funil: {
      enviados: { valor: 156, pct: 100 },
      abertos: { valor: 97, pct: 62 },
      clicados: { valor: 37, pct: 24 },
      submeteram: { valor: 0, pct: 0 },
      reportaram: { valor: 30, pct: 19 },
    },
    treinamentos: [
      { destinatario: 'Bruno Barbosa', concluido: false },
      { destinatario: 'Carla Cardoso', concluido: true, reportouEm: '2026-06-02T10:00:00.000Z' },
    ],
    reportes: [{ destinatario: 'Ana Almeida', reportouEm: '2026-06-02T08:00:00.000Z', clicou: false }],
  };

  it('traz as métricas do funil', () => {
    const campaign = campaignFromReport(report);
    expect(campaign.metrics).toEqual({
      recipients: 156,
      sent: 156,
      opened: 97,
      clicked: 37,
      submitted: 0,
      reported: 30,
    });
  });

  it('sintetiza a amostra de destinatários: reportou vence clicou', () => {
    const campaign = campaignFromReport(report);
    const byName = Object.fromEntries(campaign.recipients.map((r) => [r.name, r.stage]));
    expect(byName['Ana Almeida']).toBe('reported');
    expect(byName['Bruno Barbosa']).toBe('clicked');
    // Carla reportou (reportouEm presente), então é "reported", não "clicked".
    expect(byName['Carla Cardoso']).toBe('reported');
  });

  it('funciona sem funil/listas (campos opcionais)', () => {
    const campaign = campaignFromReport({
      id: 'camp-2',
      nome: 'Vazia',
      template: 'autoridade',
      status: 'agendada',
      criadoEm: '2026-06-01T09:00:00.000Z',
      destinatarios: 10,
    });
    expect(campaign.metrics.sent).toBe(0);
    expect(campaign.recipients).toEqual([]);
  });
});

describe('mappers: criar campanha', () => {
  it('monta o corpo com destinatarios[] e template em português', () => {
    const body = createBodyFromInput({
      name: 'Nova',
      template: 'curiosity',
      recipients: ['a@baluarte.test', 'b@baluarte.test'],
    });
    expect(body).toEqual({
      nome: 'Nova',
      destinatarios: ['a@baluarte.test', 'b@baluarte.test'],
      template: 'curiosidade',
    });
  });
});
