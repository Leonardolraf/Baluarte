import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureMocks, mockApi, resetMockState } from '@/mocks/api';
import { MOCK_CREDENTIALS, MOCK_USERS } from '@/mocks/data';
import {
  SCAN_DURATION_MS,
  SCAN_QUEUE_MS,
  SCAN_STAGES_RUNNING,
  scanProgressByTime,
} from '@/mocks/scanProgress';
import { toScan } from '@/services/adapters';
import { formatTimeLeft } from '@/lib/format';
import { HttpError } from '@/lib/errors';
import { tokenStorage, userStorage } from '@/lib/storage';
import type { RBACRole } from '@/types';

// B26: progresso da varredura (percentual, etapa e conclusão prevista) — a lógica da camada
// mock (espelho do backend), o adapter da resposta real, o formato do tempo restante e o
// GET de uma varredura só.

const START = '2026-10-07T12:00:00.000Z';
const at = (ms: number) => Date.parse(START) + ms;
const RUNNING_MS = SCAN_DURATION_MS - SCAN_QUEUE_MS;

describe('scanProgressByTime (mock, espelha cicloVarredura.service.ts)', () => {
  it('0 s: na fila com 0% e conclusão prevista para início + 20 s', () => {
    expect(scanProgressByTime(START, at(0))).toEqual({
      status: 'queued',
      progress: 0,
      stage: 'Na fila',
      estimatedCompletionAt: '2026-10-07T12:00:20.000Z',
    });
    expect(scanProgressByTime(START, at(SCAN_QUEUE_MS - 1)).progress).toBe(0);
  });

  it('5 s: começa o andamento com 1% e a primeira etapa', () => {
    expect(scanProgressByTime(START, at(SCAN_QUEUE_MS))).toMatchObject({
      status: 'running',
      progress: 1,
      stage: SCAN_STAGES_RUNNING[0],
    });
  });

  it('meio do andamento: 50% e "Testando autenticação"; antes de 20 s, no máximo 99%', () => {
    expect(scanProgressByTime(START, at(SCAN_QUEUE_MS + RUNNING_MS / 2))).toMatchObject({
      status: 'running',
      progress: 50,
      stage: 'Testando autenticação',
    });
    expect(scanProgressByTime(START, at(SCAN_DURATION_MS - 1))).toMatchObject({
      progress: 99,
      stage: 'Gerando relatório',
    });
  });

  it('20 s e depois: concluída com 100%', () => {
    for (const ms of [SCAN_DURATION_MS, SCAN_DURATION_MS + 60_000]) {
      expect(scanProgressByTime(START, at(ms))).toMatchObject({
        status: 'completed',
        progress: 100,
        stage: 'Concluída',
      });
    }
  });

  it('o progresso nunca diminui ao longo do ciclo', () => {
    let previous = -1;
    for (let ms = 0; ms <= SCAN_DURATION_MS + 1_000; ms += 500) {
      const { progress } = scanProgressByTime(START, at(ms));
      expect(progress).toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
  });
});

describe('toScan: campos de progresso da API', () => {
  it('converte progresso, etapa e estimativa', () => {
    const scan = toScan({
      id: 's-1',
      assetId: 'a-1',
      status: 'EM_ANDAMENTO',
      criadoEm: START,
      progresso: 42,
      etapa: 'Testando injeção',
      estimativaConclusao: '2026-10-07T12:00:20.000Z',
    });
    expect(scan).toMatchObject({
      status: 'running',
      progress: 42,
      stage: 'Testando injeção',
      estimatedCompletionAt: '2026-10-07T12:00:20.000Z',
    });
  });

  it('sem os campos (resposta do POST /scans): deriva do status, sem estimativa', () => {
    expect(toScan({ id: 's-1', assetId: 'a-1', status: 'EM_FILA', criadoEm: START })).toMatchObject({
      progress: 0,
      stage: 'Na fila',
      estimatedCompletionAt: null,
    });
    expect(
      toScan({
        id: 's-2',
        assetId: 'a-1',
        status: 'CONCLUIDA',
        criadoEm: START,
        concluidoEm: '2026-10-07T12:00:20.000Z',
      }),
    ).toMatchObject({ progress: 100, stage: 'Concluída', estimatedCompletionAt: '2026-10-07T12:00:20.000Z' });
  });

  it('limita o percentual a 0–100 e ignora valor que não é número', () => {
    const base = { id: 's', assetId: 'a', status: 'EM_ANDAMENTO', criadoEm: START };
    expect(toScan({ ...base, progresso: 140 }).progress).toBe(100);
    expect(toScan({ ...base, progresso: -3 }).progress).toBe(0);
    expect(toScan({ ...base, progresso: Number.NaN }).progress).toBe(0);
  });
});

describe('formatTimeLeft', () => {
  const now = new Date(START);
  it('segundos, minutos e passado', () => {
    expect(formatTimeLeft('2026-10-07T12:00:20.000Z', now)).toBe('≈ 20 s');
    expect(formatTimeLeft('2026-10-07T12:00:07.500Z', now)).toBe('≈ 8 s');
    expect(formatTimeLeft('2026-10-07T12:02:05.000Z', now)).toBe('≈ 2 min 5 s');
    expect(formatTimeLeft('2026-10-07T12:03:00.000Z', now)).toBe('≈ 3 min');
    expect(formatTimeLeft(START, now)).toBe('instantes');
    expect(formatTimeLeft('2026-10-07T11:59:00.000Z', now)).toBe('instantes');
  });

  it('sem data ou com data inválida não mostra nada', () => {
    expect(formatTimeLeft(null, now)).toBeNull();
    expect(formatTimeLeft('não é data', now)).toBeNull();
  });
});

describe('mockApi.getScan (GET /scans/:id)', () => {
  async function loginAs(role: RBACRole) {
    const user = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
    const cred = MOCK_CREDENTIALS.find((c) => c.userId === user.id)!;
    const response = await mockApi.login({ email: cred.email, password: cred.password });
    tokenStorage.set(response.token);
    userStorage.set(response.user);
  }

  beforeEach(() => {
    resetMockState();
    configureMocks({ latencyMs: [0, 0], failureRate: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('acompanha uma varredura pelo ciclo, com o progresso calculado na leitura', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(START));
    await loginAs('analyst');
    const asset = (await mockApi.listAssets()).find((a) => a.status === 'active' && a.id !== 'asset-005')!;
    const started = await mockApi.startScan(asset.id);
    expect(started).toMatchObject({ status: 'queued', progress: 0, stage: 'Na fila' });

    vi.setSystemTime(new Date(at(SCAN_QUEUE_MS + RUNNING_MS / 2)));
    expect(await mockApi.getScan(started.id)).toMatchObject({
      status: 'running',
      progress: 50,
      stage: 'Testando autenticação',
      estimatedCompletionAt: '2026-10-07T12:00:20.000Z',
    });

    vi.setSystemTime(new Date(at(SCAN_DURATION_MS + 1_000)));
    const done = await mockApi.getScan(started.id);
    expect(done).toMatchObject({ status: 'completed', progress: 100, stage: 'Concluída' });
    expect(done.findingsCount).toBeGreaterThanOrEqual(2);
    // A lista vê o mesmo estado (a consulta de uma varredura também avança).
    expect((await mockApi.listScans()).find((s) => s.id === started.id)).toMatchObject({
      status: 'completed',
      findingsCount: done.findingsCount,
    });
  });

  it('404 para varredura inexistente e 403 para Colaborador', async () => {
    await loginAs('analyst');
    await expect(mockApi.getScan('nao-existe')).rejects.toMatchObject({
      status: 404,
      code: 'VARREDURA_NAO_ENCONTRADA',
    });
    await loginAs('collaborator');
    const err = await mockApi.getScan('scan-001').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
  });

  it('varredura longa do seed mantém o progresso fixo, sem estimativa', async () => {
    await loginAs('admin');
    expect(await mockApi.getScan('scan-005')).toMatchObject({
      status: 'running',
      progress: 62,
      stage: 'Testando autenticação',
      estimatedCompletionAt: null,
    });
  });
});
