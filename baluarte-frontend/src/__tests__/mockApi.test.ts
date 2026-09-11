import { beforeEach, describe, expect, it } from 'vitest';
import { configureMocks, getMockConfig, mockApi, resetMockState } from '@/mocks/api';
import { MOCK_CAMPAIGNS, MOCK_CREDENTIALS, MOCK_USERS } from '@/mocks/data';
import { tokenStorage, userStorage } from '@/lib/storage';
import { HttpError } from '@/lib/errors';
import type { RBACRole } from '@/types';

async function loginAs(role: RBACRole) {
  const user = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  const cred = MOCK_CREDENTIALS.find((c) => c.userId === user.id)!;
  const response = await mockApi.login({ email: cred.email, password: cred.password });
  tokenStorage.set(response.token);
  userStorage.set(response.user);
  return response.user;
}

async function expectHttp(promise: Promise<unknown>, status: number, code?: string) {
  try {
    await promise;
    throw new Error(`esperava HttpError ${status}`);
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    if (code) expect((err as HttpError).code).toBe(code);
  }
}

beforeEach(() => {
  resetMockState();
  configureMocks({ latencyMs: [0, 0], failureRate: 0 });
});

describe('mockApi — autenticação', () => {
  it('autentica cada credencial de demonstração e devolve JWT + usuário', async () => {
    for (const cred of MOCK_CREDENTIALS) {
      const r = await mockApi.login({ email: cred.email, password: cred.password });
      expect(r.token.split('.')).toHaveLength(3);
      expect(r.user.id).toBe(cred.userId);
    }
  });

  it('valida entrada e rejeita credenciais erradas com as mensagens do contrato', async () => {
    await expectHttp(mockApi.login({ email: '', password: 'x' }), 400, 'EMAIL_OBRIGATORIO');
    await expectHttp(mockApi.login({ email: 'sem-arroba', password: 'x' }), 400, 'EMAIL_INVALIDO');
    await expectHttp(mockApi.login({ email: 'admin@empresa.com', password: '' }), 400, 'SENHA_OBRIGATORIA');
    await expectHttp(
      mockApi.login({ email: 'admin@empresa.com', password: 'errada' }),
      401,
      'CREDENCIAIS_INVALIDAS',
    );
    await expectHttp(
      mockApi.login({ email: 'ninguem@empresa.com', password: 'x' }),
      401,
      'CREDENCIAIS_INVALIDAS',
    );
  });

  it('bloqueia usuário inativo e exige sessão nas rotas protegidas', async () => {
    const inactive = MOCK_USERS.find((u) => u.status === 'inactive')!;
    await mockApi
      .login({ email: 'admin@empresa.com', password: 'Admin@123' })
      .then((r) => tokenStorage.set(r.token));
    // Define uma senha conhecida para o inativo via updateUser não é possível; garantimos o 403 pela regra de status.
    const cred = MOCK_CREDENTIALS.find((c) => c.userId === inactive.id);
    if (cred)
      await expectHttp(mockApi.login({ email: cred.email, password: cred.password }), 403, 'USUARIO_INATIVO');
    tokenStorage.clear();
    await expectHttp(mockApi.me(), 401, 'TOKEN_AUSENTE');
    await expectHttp(mockApi.getDashboard(), 401);
  });

  it('reset de senha responde igual para e-mails conhecidos e desconhecidos', async () => {
    const a = await mockApi.requestPasswordReset('admin@empresa.com');
    const b = await mockApi.requestPasswordReset('inexistente@empresa.com');
    expect(a.message).toBe(b.message);
    await expectHttp(mockApi.requestPasswordReset('inválido'), 400, 'EMAIL_INVALIDO');
  });

  it('reset de senha (demonstração): token só para contas existentes, de uso único', async () => {
    const known = await mockApi.requestPasswordReset('admin@empresa.com');
    const unknown = await mockApi.requestPasswordReset('inexistente@empresa.com');
    const token = known.demoToken ?? '';
    expect(token).not.toBe('');
    expect(unknown.demoToken).toBeUndefined();

    await expectHttp(mockApi.confirmPasswordReset(token, 'curta'), 400, 'SENHA_FRACA');
    await expectHttp(mockApi.confirmPasswordReset('nao-existe', 'Nova@1234'), 400, 'TOKEN_RESET_INVALIDO');
    await expectHttp(mockApi.confirmPasswordReset('', 'Nova@1234'), 400, 'TOKEN_OBRIGATORIO');
    await expect(mockApi.confirmPasswordReset(token, 'Nova@1234')).resolves.toMatchObject({
      message: expect.stringMatching(/redefinida/),
    });
    await expect(mockApi.login({ email: 'admin@empresa.com', password: 'Nova@1234' })).resolves.toBeTruthy();
    // O mesmo token não vale duas vezes.
    await expectHttp(mockApi.confirmPasswordReset(token, 'Outra@1234'), 400, 'TOKEN_RESET_INVALIDO');
  });

  it('troca de senha aplica a política e exige a senha atual', async () => {
    await loginAs('admin');
    await expectHttp(
      mockApi.changePassword({ currentPassword: 'errada', newPassword: 'Nova@1234' }),
      400,
      'SENHA_ATUAL_INCORRETA',
    );
    await expectHttp(
      mockApi.changePassword({ currentPassword: 'Admin@123', newPassword: 'curta' }),
      400,
      'SENHA_FRACA',
    );
    await expectHttp(
      mockApi.changePassword({ currentPassword: 'Admin@123', newPassword: 'semmaiuscula1!' }),
      400,
      'SENHA_FRACA',
    );
    await expectHttp(
      mockApi.changePassword({ currentPassword: 'Admin@123', newPassword: 'SemNumeroSimbolo' }),
      400,
      'SENHA_FRACA',
    );
    await expectHttp(
      mockApi.changePassword({ currentPassword: 'Admin@123', newPassword: 'Admin@123' }),
      400,
      'SENHA_REPETIDA',
    );
    await expect(
      mockApi.changePassword({ currentPassword: 'Admin@123', newPassword: 'Nova@1234' }),
    ).resolves.toMatchObject({
      message: expect.any(String),
    });
    await expect(mockApi.login({ email: 'admin@empresa.com', password: 'Nova@1234' })).resolves.toBeTruthy();
  });
});

describe('mockApi — RBAC por endpoint', () => {
  it('colaborador acessa dashboard/treinamento/configurações, mas não vulnerabilidades, campanhas ou usuários', async () => {
    await loginAs('collaborator');
    await expect(mockApi.getDashboard()).resolves.toBeTruthy();
    await expect(mockApi.getTraining('trn-urgency')).resolves.toMatchObject({ id: 'trn-urgency' });
    await expect(mockApi.getNotificationPreferences()).resolves.toBeTruthy();
    await expectHttp(mockApi.listVulnerabilities(), 403, 'PERFIL_SEM_PERMISSAO');
    await expectHttp(mockApi.getVulnerability('vuln-001'), 403);
    await expectHttp(mockApi.listCampaigns(), 403);
    await expectHttp(mockApi.createAsset({ name: 'x', type: 'server', host: 'x.empresa.com' }), 403);
    await expectHttp(mockApi.listUsers(), 403);
  });

  it('analista opera vulnerabilidades e campanhas, mas não gerencia usuários', async () => {
    await loginAs('analyst');
    await expect(mockApi.listVulnerabilities()).resolves.toBeTruthy();
    await expect(mockApi.listCampaigns()).resolves.toBeTruthy();
    await expectHttp(mockApi.listUsers(), 403, 'PERFIL_SEM_PERMISSAO');
    await expectHttp(mockApi.createUser({ name: 'X', email: 'x@empresa.com', role: 'analyst' }), 403);
  });
});

describe('mockApi — dashboard e vulnerabilidades', () => {
  it('dashboard traz índices 0–100 coerentes com os KPIs', async () => {
    await loginAs('admin');
    const d = await mockApi.getDashboard();
    expect(d.technicalRisk).toBeGreaterThanOrEqual(0);
    expect(d.technicalRisk).toBeLessThanOrEqual(100);
    expect(d.humanRisk).toBeGreaterThanOrEqual(0);
    expect(d.humanRisk).toBeLessThanOrEqual(100);
    const open = Object.values(d.severityDistribution).reduce((a, b) => a + b, 0);
    expect(open).toBe(d.kpis.openVulnerabilities);
    expect(d.recentFindings.length).toBeLessThanOrEqual(5);
    expect(d.recentFindings.every((v) => v.status !== 'resolved' && v.status !== 'accepted')).toBe(true);
    // Há campanhas com envios no seed: resiliência medida (0–100) e coerente com a taxa de clique.
    expect(d.kpis.phishingResilience).not.toBeNull();
    expect(d.kpis.phishingResilience!).toBeGreaterThanOrEqual(0);
    expect(d.kpis.phishingResilience!).toBeLessThanOrEqual(100);
    // KPI de treinados vem da mesma fonte que as telas de campanha (totais autorais).
    const campaigns = await mockApi.listCampaigns();
    expect(d.kpis.trainedCollaborators).toBe(campaigns.reduce((sum, c) => sum + c.metrics.trained, 0));
    // O dashboard não transporta evidências/remediação/histórico.
    expect(d.recentFindings.every((v) => v.evidence.length === 0 && v.history.length === 0)).toBe(true);
    expect(d.pendingTraining).toMatchObject({ id: expect.stringMatching(/^trn-/) });
  });

  it('dashboard do colaborador omite a lista técnica de achados e as campanhas', async () => {
    await loginAs('collaborator');
    const d = await mockApi.getDashboard();
    expect(d.recentFindings).toEqual([]);
    expect(d.recentCampaigns).toEqual([]);
    expect(d.kpis.openVulnerabilities).toBeGreaterThan(0);
    expect(d.pendingTraining).not.toBeNull();
  });

  it('filtra por severidade, status e texto e devolve resumo coerente', async () => {
    await loginAs('analyst');
    const all = await mockApi.listVulnerabilities();
    expect(all.summary.total).toBe(all.items.length);
    const critical = await mockApi.listVulnerabilities({ severity: 'critical' });
    expect(critical.items.every((v) => v.severity === 'critical')).toBe(true);
    expect(critical.summary.bySeverity.critical).toBe(critical.items.length);
    const resolved = await mockApi.listVulnerabilities({ status: 'resolved' });
    expect(resolved.items.every((v) => v.status === 'resolved')).toBe(true);
    const log4j = await mockApi.listVulnerabilities({ query: 'CVE-2021-44228' });
    expect(log4j.items.length).toBeGreaterThanOrEqual(1);
    expect(log4j.items[0]?.cve).toBe('CVE-2021-44228');
    const none = await mockApi.listVulnerabilities({ query: 'zzz-inexistente' });
    expect(none.items).toHaveLength(0);
    expect(none.summary.assets).toBe(0);
    // Ordenação: mais graves primeiro.
    const ranks = all.items.map((v) => ['critical', 'high', 'medium', 'low', 'info'].indexOf(v.severity));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('atualiza o status com histórico e rejeita status inválido/ids desconhecidos', async () => {
    const user = await loginAs('analyst');
    const before = await mockApi.getVulnerability('vuln-001');
    const target = before.status === 'in_review' ? 'remediating' : 'in_review';
    const after = await mockApi.updateVulnerabilityStatus('vuln-001', target, 'analisando');
    expect(after.status).toBe(target);
    expect(after.history[0]).toMatchObject({
      action: 'status_changed',
      from: before.status,
      to: target,
      actor: user.name,
      note: 'analisando',
    });
    expect(after.history).toHaveLength(before.history.length + 1);
    // Mesmo status não gera novo registro.
    const same = await mockApi.updateVulnerabilityStatus('vuln-001', target);
    expect(same.history).toHaveLength(after.history.length);
    await expectHttp(
      mockApi.updateVulnerabilityStatus('vuln-001', 'inexistente' as never),
      400,
      'STATUS_INVALIDO',
    );
    await expectHttp(mockApi.getVulnerability('nao-existe'), 404, 'FINDING_NAO_ENCONTRADO');
  });
});

describe('mockApi — ativos e varreduras', () => {
  it('cria ativo com validações do contrato e conta achados abertos', async () => {
    await loginAs('admin');
    await expectHttp(
      mockApi.createAsset({ name: '', type: 'server', host: 'a.empresa.com' }),
      400,
      'NOME_OBRIGATORIO',
    );
    await expectHttp(
      mockApi.createAsset({ name: 'A', type: 'x' as never, host: 'a.empresa.com' }),
      400,
      'TIPO_INVALIDO',
    );
    await expectHttp(
      mockApi.createAsset({ name: 'A', type: 'server', host: 'inválido host' }),
      400,
      'HOST_INVALIDO',
    );
    await expectHttp(
      mockApi.createAsset({ name: 'A', type: 'server', host: 'a.empresa.com', ip: '999.1.1.1' }),
      400,
      'IP_INVALIDO',
    );
    await expectHttp(
      mockApi.createAsset({ name: 'Dup', type: 'server', host: 'srv-web-01.empresa.com' }),
      409,
      'ATIVO_DUPLICADO',
    );
    const created = await mockApi.createAsset({
      name: 'Novo',
      type: 'database',
      host: '10.0.0.9',
      description: ' desc ',
    });
    expect(created).toMatchObject({
      name: 'Novo',
      type: 'database',
      host: '10.0.0.9',
      status: 'active',
      openFindings: 0,
      description: 'desc',
    });
    const assets = await mockApi.listAssets();
    expect(assets[0]?.id).toBe(created.id);
    const web = assets.find((a) => a.host === 'srv-web-01.empresa.com')!;
    const vulns = await mockApi.listVulnerabilities();
    const expectedOpen = vulns.items.filter(
      (v) => v.assetId === web.id && v.status !== 'resolved' && v.status !== 'accepted',
    ).length;
    expect(web.openFindings).toBe(expectedOpen);
  });

  it('enfileira varredura só para ativos ativos', async () => {
    await loginAs('analyst');
    const assets = await mockApi.listAssets();
    const inactive = assets.find((a) => a.status === 'inactive')!;
    const active = assets.find((a) => a.status === 'active')!;
    await expectHttp(mockApi.startScan(inactive.id), 422, 'ATIVO_INATIVO');
    await expectHttp(mockApi.startScan('nao-existe'), 404, 'ATIVO_NAO_ENCONTRADO');
    const scan = await mockApi.startScan(active.id);
    expect(scan).toMatchObject({ assetId: active.id, status: 'queued', findingsCount: 0 });
    const scans = await mockApi.listScans();
    expect(scans[0]?.id).toBe(scan.id);
  });
});

describe('mockApi — campanhas e treinamento', () => {
  it('mantém os totais autorais das campanhas semeadas (amostra de destinatários não encolhe "enviados")', async () => {
    await loginAs('admin');
    const seeded = MOCK_CAMPAIGNS.find((c) => c.metrics.sent > 100)!;
    const report = await mockApi.getCampaignReport(seeded.id);
    expect(report.campaign.metrics.sent).toBe(seeded.metrics.sent);
    expect(report.campaign.metrics.clickRate).toBe(seeded.metrics.clickRate);
    expect(report.recipients.length).toBeLessThan(seeded.metrics.sent);
    expect(report.funnel[0]).toMatchObject({ key: 'sent', value: seeded.metrics.sent, pct: 100 });
    expect(report.byDepartment.reduce((a, d) => a + d.recipients, 0)).toBe(report.recipients.length);
    const list = await mockApi.listCampaigns();
    expect(list.find((c) => c.id === seeded.id)?.metrics.sent).toBe(seeded.metrics.sent);
  });

  it('filtra campanhas por status, período e texto', async () => {
    await loginAs('analyst');
    const active = await mockApi.listCampaigns({ status: 'active' });
    expect(active.every((c) => c.status === 'active')).toBe(true);
    const q = await mockApi.listCampaigns({ query: 'Financeiro' });
    expect(q.length).toBeGreaterThanOrEqual(1);
    const all = await mockApi.listCampaigns();
    const oldest = [...all].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]!;
    const from = oldest.scheduledAt.slice(0, 10);
    const to = from;
    const window = await mockApi.listCampaigns({ from, to });
    expect(window.some((c) => c.id === oldest.id)).toBe(true);
    expect(window.every((c) => c.scheduledAt.slice(0, 10) === from)).toBe(true);
  });

  it('cria campanha agendada só com destinatários internos e deriva métricas dos próprios destinatários', async () => {
    await loginAs('analyst');
    const base = {
      name: 'Teste',
      template: 'urgency' as const,
      targetGroup: 'TI',
      scheduledAt: '2026-12-01T09:00:00.000Z',
    };
    await expectHttp(mockApi.createCampaign({ ...base, recipients: [] }), 400, 'DESTINATARIOS_OBRIGATORIOS');
    await expectHttp(
      mockApi.createCampaign({ ...base, recipients: ['fora@gmail.com'] }),
      422,
      'DESTINATARIO_EXTERNO',
    );
    await expectHttp(mockApi.createCampaign({ ...base, recipients: ['sem-arroba'] }), 400, 'EMAIL_INVALIDO');
    await expectHttp(
      mockApi.createCampaign({ ...base, name: '', recipients: ['a@empresa.com'] }),
      400,
      'NOME_OBRIGATORIO',
    );
    await expectHttp(
      mockApi.createCampaign({ ...base, scheduledAt: 'x', recipients: ['a@empresa.com'] }),
      400,
      'AGENDAMENTO_INVALIDO',
    );
    const created = await mockApi.createCampaign({
      ...base,
      recipients: ['A@empresa.com', 'a@empresa.com', 'b@empresa.com'],
    });
    expect(created.status).toBe('scheduled');
    expect(created.metrics).toMatchObject({ recipients: 3, sent: 0, clickRate: 0 });
    const report = await mockApi.getCampaignReport(created.id);
    expect(report.recipients).toHaveLength(2); // e-mails deduplicados sem distinguir caixa
    expect(report.campaign.metrics.sent).toBe(0);
    expect(report.recipients.every((r) => r.sentAt === null)).toBe(true);
  });

  it('conclui treinamento uma única vez e reflete no dashboard', async () => {
    await loginAs('collaborator');
    const before = await mockApi.getTraining('trn-urgency');
    expect(before.completed).toBe(false);
    const done = await mockApi.completeTraining('trn-urgency');
    expect(done).toMatchObject({ completed: true, progress: 100 });
    expect(done.completedAt).toBeTruthy();
    const again = await mockApi.completeTraining('trn-urgency');
    expect(again.completedAt).toBe(done.completedAt);
    await expectHttp(mockApi.getTraining('nao-existe'), 404, 'TREINAMENTO_NAO_ENCONTRADO');
    const dashboard = await mockApi.getDashboard();
    expect(dashboard.timeline.some((e) => e.kind === 'training')).toBe(true);
  });
});

describe('mockApi — usuários', () => {
  it('cria, edita e remove usuários com as regras de proteção do RBAC', async () => {
    const admin = await loginAs('admin');
    await expectHttp(
      mockApi.createUser({ name: '', email: 'n@empresa.com', role: 'analyst' }),
      400,
      'NOME_OBRIGATORIO',
    );
    await expectHttp(
      mockApi.createUser({ name: 'N', email: 'inválido', role: 'analyst' }),
      400,
      'EMAIL_INVALIDO',
    );
    await expectHttp(
      mockApi.createUser({ name: 'N', email: 'admin@empresa.com', role: 'analyst' }),
      409,
      'EMAIL_DUPLICADO',
    );
    const created = await mockApi.createUser({
      name: 'Novo',
      email: 'NOVO@empresa.com',
      role: 'collaborator',
      department: 'TI',
    });
    expect(created).toMatchObject({ email: 'novo@empresa.com', status: 'pending', department: 'TI' });
    // Senha temporária documentada funciona.
    await expect(mockApi.login({ email: 'novo@empresa.com', password: 'Mudar@123' })).resolves.toBeTruthy();

    const updated = await mockApi.updateUser(created.id, {
      name: 'Novo Nome',
      role: 'analyst',
      status: 'active',
    });
    expect(updated).toMatchObject({ name: 'Novo Nome', role: 'analyst', status: 'active' });
    await expectHttp(mockApi.updateUser(created.id, { email: 'admin@empresa.com' }), 409, 'EMAIL_DUPLICADO');
    await expectHttp(mockApi.updateUser(admin.id, { status: 'inactive' }), 422, 'AUTO_INATIVACAO');
    await expectHttp(mockApi.updateUser('nao-existe', { name: 'x' }), 404);

    await expectHttp(mockApi.deleteUser(admin.id), 422, 'AUTO_EXCLUSAO');
    await mockApi.deleteUser(created.id);
    await expectHttp(mockApi.getUser(created.id), 404, 'USUARIO_NAO_ENCONTRADO');
    const users = await mockApi.listUsers();
    expect(users.some((u) => u.id === created.id)).toBe(false);
  });

  it('protege o último administrador ativo contra rebaixamento e exclusão', async () => {
    const admin = await loginAs('admin');
    const otherAdmins = (await mockApi.listUsers()).filter((u) => u.role === 'admin' && u.id !== admin.id);
    for (const other of otherAdmins) await mockApi.deleteUser(other.id);
    await expectHttp(mockApi.updateUser(admin.id, { role: 'analyst' }), 409, 'ULTIMO_ADMIN');
    // Um segundo admin ativo libera o rebaixamento…
    await mockApi.createUser({
      name: 'Backup',
      email: 'backup@empresa.com',
      role: 'admin',
      status: 'active',
    });
    await expect(mockApi.updateUser(admin.id, { role: 'analyst' })).resolves.toMatchObject({
      role: 'analyst',
    });
    // …e o rebaixamento vale imediatamente para a sessão atual (perfil vem do estado, não do token).
    await expectHttp(mockApi.listUsers(), 403, 'PERFIL_SEM_PERMISSAO');
  });
});

describe('mockApi — infraestrutura', () => {
  it('injeta falhas aleatórias apenas em leituras quando configurado', async () => {
    await loginAs('admin');
    configureMocks({ failureRate: 1 });
    expect(getMockConfig().failureRate).toBe(1);
    await expectHttp(mockApi.listAssets(), 503, 'SERVICO_INDISPONIVEL');
    await expectHttp(mockApi.getDashboard(), 503);
    // Escritas e /me nunca falham aleatoriamente.
    await expect(mockApi.me()).resolves.toBeTruthy();
    await expect(
      mockApi.updateNotificationPreferences({
        emailAlerts: false,
        criticalOnly: true,
        weeklyDigest: false,
        campaignReports: false,
      }),
    ).resolves.toMatchObject({ criticalOnly: true });
    configureMocks({ failureRate: 0 });
    expect((await mockApi.getNotificationPreferences()).criticalOnly).toBe(true);
    resetMockState();
    expect((await mockApi.getNotificationPreferences()).criticalOnly).toBe(false);
  });

  it('devolve cópias (mutações do chamador não vazam para o estado)', async () => {
    await loginAs('admin');
    const a = await mockApi.getSecurityPolicy();
    a.passwordMinLength = 99;
    const b = await mockApi.getSecurityPolicy();
    expect(b.passwordMinLength).not.toBe(99);
  });
});
