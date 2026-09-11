import { describe, expect, it } from 'vitest';
import {
  formatCvss,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelative,
  initials,
  toDateTimeLocalValue,
  truncate,
} from '@/lib/format';
import { SEVERITIES, type Severity } from '@/types';
import {
  SEVERITY_BADGE_CLASS,
  SEVERITY_DOT_CLASS,
  SEVERITY_HEX,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  SEVERITY_TEXT_CLASS,
  severityFromCvss,
  severityFromRisk,
} from '@/lib/severity';
import { hasAnyRole, ROLE_LABEL, ROLE_SEVERITY, ROUTE_ROLES, roleFromLabel, roleToLabel } from '@/lib/roles';
import { buildMockToken, decodeToken, isTokenExpired, userFromToken } from '@/lib/jwt';
import { clearSession, tokenStorage, userStorage } from '@/lib/storage';
import { errorMessage, HttpError, isHttpError, toApiError } from '@/lib/errors';
import { cn } from '@/lib/cn';

describe('lib/format', () => {
  const iso = '2026-09-10T15:30:00.000Z';

  it('formata data e hora em pt-BR e devolve o fallback para valores inválidos', () => {
    expect(formatDateTime(iso)).toMatch(/\d{2}\/\d{2}\/2026,? \d{2}:\d{2}/);
    expect(formatDate(iso)).toMatch(/2026/);
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('não é data', 'n/d')).toBe('n/d');
    expect(formatDate(undefined)).toBe('—');
  });

  it('formata tempo relativo no passado, no futuro e em "agora"', () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    expect(formatRelative('2026-09-10T11:59:50.000Z', now)).toBe('agora');
    expect(formatRelative('2026-09-10T11:15:00.000Z', now)).toBe('há 45 min');
    expect(formatRelative('2026-09-10T09:00:00.000Z', now)).toBe('há 3 h');
    expect(formatRelative('2026-09-09T12:00:00.000Z', now)).toBe('há 1 dia');
    expect(formatRelative('2026-09-05T12:00:00.000Z', now)).toBe('há 5 dias');
    expect(formatRelative('2026-09-15T12:00:00.000Z', now)).toBe('em 5 dias');
    // Mais de 30 dias cai para a data absoluta.
    expect(formatRelative('2026-07-01T12:00:00.000Z', now)).toMatch(/2026/);
    expect(formatRelative(null, now)).toBe('—');
  });

  it('formata números, percentuais e CVSS', () => {
    expect(formatNumber(1234)).toBe('1.234');
    expect(formatPercent(23)).toBe('23%');
    expect(formatPercent(23.456, 1)).toBe('23,5%');
    expect(formatCvss(9.8)).toBe('9.8');
    expect(formatCvss(10)).toBe('10.0');
  });

  it('converte para o formato de <input type="datetime-local"> no fuso local', () => {
    const local = new Date(2026, 8, 10, 14, 5);
    expect(toDateTimeLocalValue(local)).toBe('2026-09-10T14:05');
    expect(toDateTimeLocalValue(null)).toBe('');
    expect(toDateTimeLocalValue('inválido')).toBe('');
  });

  it('gera iniciais e trunca textos', () => {
    expect(initials('Leonardo Rodrigues')).toBe('LR');
    expect(initials('Ana')).toBe('A');
    expect(initials('  ')).toBe('?');
    expect(initials(null)).toBe('?');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 10)).toBe('abc');
  });
});

describe('lib/severity', () => {
  it('classifica CVSS v3.1 nas faixas oficiais (FIRST)', () => {
    expect(severityFromCvss(10)).toBe('critical');
    expect(severityFromCvss(9.0)).toBe('critical');
    expect(severityFromCvss(8.9)).toBe('high');
    expect(severityFromCvss(7.0)).toBe('high');
    expect(severityFromCvss(6.9)).toBe('medium');
    expect(severityFromCvss(4.0)).toBe('medium');
    expect(severityFromCvss(3.9)).toBe('low');
    expect(severityFromCvss(0.1)).toBe('low');
    expect(severityFromCvss(0)).toBe('info');
  });

  it('classifica índice de risco 0–100 dos gauges', () => {
    expect(severityFromRisk(0)).toBe('low');
    expect(severityFromRisk(24)).toBe('low');
    expect(severityFromRisk(25)).toBe('medium');
    expect(severityFromRisk(50)).toBe('high');
    expect(severityFromRisk(75)).toBe('critical');
    expect(severityFromRisk(100)).toBe('critical');
  });

  it('tem rótulo, classes, cor e ordenação para TODAS as severidades', () => {
    for (const severity of SEVERITIES) {
      expect(SEVERITY_LABEL[severity]).toBeTruthy();
      expect(SEVERITY_BADGE_CLASS[severity]).toMatch(/dark:/);
      expect(SEVERITY_DOT_CLASS[severity]).toMatch(/^bg-severity-/);
      // Par claro/escuro com contraste ≥ 4,5:1 (tons 700 / 300), não o hex cru `text-severity-*`.
      expect(SEVERITY_TEXT_CLASS[severity]).toMatch(/^text-[a-z]+-[78]00 dark:text-[a-z]+-300$/);
      expect(SEVERITY_HEX[severity]).toMatch(/^#[0-9a-f]{6}$/);
      expect(typeof SEVERITY_RANK[severity]).toBe('number');
    }
    const ordered = [...SEVERITIES].sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b]);
    expect(ordered).toEqual<Severity[]>(['critical', 'high', 'medium', 'low', 'info']);
  });
});

describe('lib/roles', () => {
  it('converte rótulos do backend em perfis internos (tolerante a acento/caixa)', () => {
    expect(roleFromLabel('Administrador')).toBe('admin');
    expect(roleFromLabel('ADMIN')).toBe('admin');
    expect(roleFromLabel('Analista')).toBe('analyst');
    expect(roleFromLabel('Colaborador')).toBe('collaborator');
    expect(roleFromLabel('qualquer coisa')).toBe('collaborator');
    expect(roleFromLabel(null)).toBe('collaborator');
  });

  it('expõe rótulos pt-BR, tons de badge e a tabela de rotas', () => {
    expect(roleToLabel('admin')).toBe(ROLE_LABEL.admin);
    expect(ROLE_SEVERITY.admin).toBe('high');
    expect(ROUTE_ROLES.users).toEqual(['admin']);
    expect(ROUTE_ROLES.vulnerabilities).toEqual(['admin', 'analyst']);
    expect(ROUTE_ROLES.dashboard).toContain('collaborator');
    expect(hasAnyRole('analyst', ROUTE_ROLES.campaigns)).toBe(true);
    expect(hasAnyRole('collaborator', ROUTE_ROLES.campaigns)).toBe(false);
    expect(hasAnyRole(null, ROUTE_ROLES.dashboard)).toBe(false);
  });
});

describe('lib/jwt', () => {
  const now = new Date('2026-09-10T12:00:00.000Z');

  it('constrói um token estruturalmente válido e o decodifica com os claims canônicos', () => {
    const token = buildMockToken(
      { sub: 'u-001', email: 'analista@empresa.com', name: 'Analista', role: 'analyst' },
      30,
      now,
    );
    expect(token.split('.')).toHaveLength(3);
    const payload = decodeToken(token);
    expect(payload).toMatchObject({
      sub: 'u-001',
      email: 'analista@empresa.com',
      name: 'Analista',
      role: 'analyst',
    });
    expect(payload?.exp).toBe(payload!.iat + 30 * 60);
    expect(userFromToken(token)).toEqual({
      id: 'u-001',
      email: 'analista@empresa.com',
      name: 'Analista',
      role: 'analyst',
    });
  });

  it('aceita o payload legado do backend Express (idUsuario/perfil)', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(
      JSON.stringify({
        idUsuario: 'u-000',
        email: 'admin@empresa.com',
        perfil: 'Administrador',
        iat: 1,
        exp: 9_999_999_999,
      }),
    );
    const token = `${header}.${body}.assinatura`;
    expect(decodeToken(token)).toMatchObject({ sub: 'u-000', role: 'admin', email: 'admin@empresa.com' });
    expect(userFromToken(token)?.name).toBe('admin');
  });

  it('detecta expiração com folga e rejeita tokens malformados', () => {
    const valid = buildMockToken({ sub: 'u', email: 'u@empresa.com', role: 'admin' }, 30, now);
    expect(isTokenExpired(valid, 30, now)).toBe(false);
    expect(isTokenExpired(valid, 30, new Date(now.getTime() + 31 * 60_000))).toBe(true);
    // Dentro da folga de 30 s conta como expirado.
    expect(isTokenExpired(valid, 30, new Date(now.getTime() + 30 * 60_000 - 10_000))).toBe(true);
    expect(isTokenExpired('abc.def', 30, now)).toBe(true);
    expect(isTokenExpired(null)).toBe(true);
    expect(decodeToken('lixo')).toBeNull();
    expect(decodeToken(`${btoa('{}')}.${btoa('{}')}.x`)).toBeNull();
  });
});

describe('lib/storage', () => {
  it('persiste e limpa token e usuário; ignora JSON inválido', () => {
    tokenStorage.set('t');
    userStorage.set({ id: '1', email: 'a@empresa.com', name: 'A', role: 'admin' });
    expect(tokenStorage.get()).toBe('t');
    expect(userStorage.get()?.role).toBe('admin');
    window.localStorage.setItem('baluarte.user', '{não é json');
    expect(userStorage.get()).toBeNull();
    window.localStorage.setItem('baluarte.user', JSON.stringify({ id: 1 }));
    expect(userStorage.get()).toBeNull();
    clearSession();
    expect(tokenStorage.get()).toBeNull();
    expect(userStorage.get()).toBeNull();
  });
});

describe('lib/errors e lib/cn', () => {
  it('normaliza qualquer exceção em ApiError', () => {
    const http = new HttpError(409, 'ATIVO_DUPLICADO', 'Ativo já cadastrado');
    expect(isHttpError(http)).toBe(true);
    expect(toApiError(http)).toEqual({
      status: 409,
      code: 'ATIVO_DUPLICADO',
      message: 'Ativo já cadastrado',
    });
    expect(toApiError(new Error('boom'))).toMatchObject({ status: 0, message: 'boom' });
    expect(toApiError('string')).toMatchObject({ status: 0, code: 'ERRO_DESCONHECIDO' });
    expect(errorMessage(new Error(''))).toBe('Erro inesperado');
    expect(errorMessage(new HttpError(500, 'ERRO_INTERNO', ''), 'fallback')).toBe('fallback');
    expect(errorMessage(http)).toBe('Ativo já cadastrado');
  });

  it('combina classes condicionalmente', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });
});
