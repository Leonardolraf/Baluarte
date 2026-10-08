import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';
import type { RBACRole } from '@/types';
import { httpClient, realApi } from '@/services/api';
import { toFileScan, type BackendFileScan } from '@/services/adapters';
import { HttpError } from '@/lib/errors';
import {
  fileScanErrorMessage,
  fileScanVerdict,
  formatBytes,
  isTooLarge,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/files';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage } from '@/lib/storage';
import {
  EICAR_SIGNATURE,
  MOCK_FILE_SCANS_PER_HOUR,
  mockApi,
  mockSha256,
  setMockAntivirusAvailable,
} from '@/mocks/api';
import { MOCK_USERS } from '@/mocks/data';

// Análise de arquivos (B05) contra o contrato do B04: adaptadores, cliente HTTP real
// (multipart), camada mock e utilitários da tela.

const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function loginAs(role: RBACRole) {
  const user = MOCK_USERS.find((u) => u.role === role && u.status !== 'inactive')!;
  tokenStorage.set(buildMockToken({ sub: user.id, email: user.email, name: user.name, role: user.role }));
  return user;
}

async function expectHttp(promise: Promise<unknown>, status: number, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  expect((err as HttpError).code).toBe(code);
}

function backendScan(overrides: Partial<BackendFileScan> = {}): BackendFileScan {
  return {
    id: 'a1',
    nome: 'eicar.com',
    tamanho: 68,
    sha256: '275A021BBFB6489E54D471899F7DB9D1663FC695EC2FE2A2C4538AABF651FD0F',
    resultado: 'AMEACA',
    ameaca: 'Eicar-Signature',
    analisadoEm: '2026-10-08T12:00:00.000Z',
    ...overrides,
  };
}

describe('services/adapters — análise de arquivos', () => {
  it('converte AMEACA com o nome da assinatura e o hash em minúsculas', () => {
    expect(toFileScan(backendScan())).toEqual({
      id: 'a1',
      name: 'eicar.com',
      size: 68,
      sha256: '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
      result: 'threat',
      threat: 'Eicar-Signature',
      scannedAt: '2026-10-08T12:00:00.000Z',
    });
  });

  it('LIMPO zera a ameaça; `usuario` (operadores) vira uploadedBy', () => {
    const scan = toFileScan(
      backendScan({
        resultado: 'LIMPO',
        ameaca: 'resto inesperado',
        usuario: { nome: 'Rafael Nunes', email: 'analista@empresa.com' },
      }),
    );
    expect(scan.result).toBe('clean');
    expect(scan.threat).toBeNull();
    expect(scan.uploadedBy).toEqual({ name: 'Rafael Nunes', email: 'analista@empresa.com' });
    expect(toFileScan(backendScan({ usuario: null }))).not.toHaveProperty('uploadedBy');
  });
});

describe('services/api — análise de arquivos no backend real', () => {
  const originalAdapter = httpClient.defaults.adapter;
  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
  });

  function respondWith(handler: (config: InternalAxiosRequestConfig) => AxiosResponse | Promise<never>) {
    const seen: InternalAxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
      seen.push(config);
      return handler(config);
    };
    httpClient.defaults.adapter = adapter;
    return seen;
  }

  function ok(config: InternalAxiosRequestConfig, body: unknown, status = 200): AxiosResponse {
    return { data: body, status, statusText: 'OK', headers: {}, config };
  }

  function fail(config: InternalAxiosRequestConfig, status: number, body: unknown): Promise<never> {
    const response = { data: body, status, statusText: 'erro', headers: {}, config } as AxiosResponse;
    return Promise.reject(new AxiosError('erro', 'ERR_BAD_RESPONSE', config, null, response));
  }

  it('POST /arquivos/analise envia multipart com o campo `arquivo` e o token', async () => {
    tokenStorage.set('token-de-teste');
    const seen = respondWith((config) =>
      ok(
        config,
        {
          status: 'sucesso',
          mensagem: 'Ameaça encontrada: Eicar-Signature',
          dados: backendScan(),
        },
        201,
      ),
    );

    const file = new File(['abc'], 'eicar.com');
    const outcome = await realApi.analyzeFile(file);

    const config = seen[0]!;
    expect(config.method).toBe('post');
    expect(config.url).toBe('/arquivos/analise');
    expect(config.data).toBeInstanceOf(FormData);
    const sent = (config.data as FormData).get('arquivo') as File;
    expect(sent.name).toBe('eicar.com');
    // Não pode sair como JSON (o padrão do cliente); o navegador põe o boundary.
    expect(String(config.headers['Content-Type'])).toContain('multipart/form-data');
    expect(config.headers.Authorization).toBe('Bearer token-de-teste');
    expect(outcome.message).toBe('Ameaça encontrada: Eicar-Signature');
    expect(outcome.scan.result).toBe('threat');
  });

  it('sem `mensagem` no envelope, usa o veredito do contrato', async () => {
    respondWith((config) =>
      ok(config, { status: 'sucesso', dados: backendScan({ resultado: 'LIMPO', ameaca: null }) }, 201),
    );
    const outcome = await realApi.analyzeFile(new File(['abc'], 'a.txt'));
    expect(outcome.message).toBe('Nenhuma ameaça conhecida encontrada');
  });

  it('erros do contrato chegam como HttpError com o código do servidor', async () => {
    respondWith((config) =>
      fail(config, 503, {
        status: 'erro',
        mensagem: 'Antivírus indisponível',
        codigoErro: 'ANTIVIRUS_INDISPONIVEL',
      }),
    );
    await expectHttp(realApi.analyzeFile(new File(['abc'], 'a.txt')), 503, 'ANTIVIRUS_INDISPONIVEL');

    respondWith((config) =>
      fail(config, 429, { status: 'erro', mensagem: 'Limite', codigoErro: 'MUITAS_ANALISES' }),
    );
    await expectHttp(realApi.analyzeFile(new File(['abc'], 'a.txt')), 429, 'MUITAS_ANALISES');
  });

  it('rota ainda inexistente no servidor (B04 pendente) vira 501 NAO_IMPLEMENTADO', async () => {
    respondWith((config) =>
      fail(config, 404, { status: 'erro', mensagem: 'Rota', codigoErro: 'ROTA_NAO_ENCONTRADA' }),
    );
    await expectHttp(realApi.analyzeFile(new File(['abc'], 'a.txt')), 501, 'NAO_IMPLEMENTADO');
    await expectHttp(realApi.listFileScans(), 501, 'NAO_IMPLEMENTADO');
  });

  it('GET /arquivos/analises desembrulha o envelope e adapta cada item', async () => {
    const seen = respondWith((config) =>
      ok(config, {
        status: 'sucesso',
        dados: [
          backendScan({ id: 'a2', usuario: { nome: 'Ana', email: 'ana@empresa.com' } }),
          backendScan({ id: 'a1', resultado: 'LIMPO', ameaca: null }),
        ],
      }),
    );
    const items = await realApi.listFileScans();
    expect(seen[0]!.url).toBe('/arquivos/analises');
    expect(items.map((s) => [s.id, s.result, s.uploadedBy?.name])).toEqual([
      ['a2', 'threat', 'Ana'],
      ['a1', 'clean', undefined],
    ]);
  });
});

describe('mockApi — análise de arquivos', () => {
  it('arquivo comum: LIMPO com SHA-256 real do conteúdo e a mensagem do contrato', async () => {
    loginAs('collaborator');
    const progress: number[] = [];
    const outcome = await mockApi.analyzeFile(new File(['abc'], 'notas.txt'), {
      onProgress: (p) => progress.push(p),
    });
    expect(outcome.message).toBe('Nenhuma ameaça conhecida encontrada');
    expect(outcome.scan).toMatchObject({
      name: 'notas.txt',
      size: 3,
      sha256: SHA256_ABC,
      result: 'clean',
      threat: null,
    });
    expect(outcome.scan).not.toHaveProperty('uploadedBy');
    expect(progress).toEqual([100]);
  });

  it('eicar.com ou conteúdo com "EICAR" respondem AMEACA (Eicar-Signature)', async () => {
    loginAs('collaborator');
    const byName = await mockApi.analyzeFile(new File(['qualquer'], 'EICAR.COM'));
    expect(byName.scan.result).toBe('threat');
    expect(byName.scan.threat).toBe(EICAR_SIGNATURE);
    expect(byName.message).toBe('Ameaça encontrada: Eicar-Signature');

    const byContent = await mockApi.analyzeFile(new File(['xx EICAR-STANDARD xx'], 'anexo.txt'));
    expect(byContent.scan.result).toBe('threat');
  });

  it('acima de 10 MB responde 413 ARQUIVO_MUITO_GRANDE (exatamente 10 MB passa)', async () => {
    loginAs('analyst');
    const big = new File(['x'], 'grande.bin');
    Object.defineProperty(big, 'size', { value: MAX_FILE_SIZE_BYTES + 1 });
    await expectHttp(mockApi.analyzeFile(big), 413, 'ARQUIVO_MUITO_GRANDE');

    const limit = new File([new Uint8Array(MAX_FILE_SIZE_BYTES)], 'limite.bin');
    expect((await mockApi.analyzeFile(limit)).scan.size).toBe(MAX_FILE_SIZE_BYTES);
  });

  it('sem arquivo responde 400 ARQUIVO_OBRIGATORIO; sem sessão, 401', async () => {
    loginAs('collaborator');
    await expectHttp(mockApi.analyzeFile(undefined as unknown as File), 400, 'ARQUIVO_OBRIGATORIO');
    tokenStorage.clear();
    await expectHttp(mockApi.analyzeFile(new File(['a'], 'a.txt')), 401, 'TOKEN_AUSENTE');
  });

  it('limite por usuário por hora responde 429 MUITAS_ANALISES, sem afetar outro usuário', async () => {
    loginAs('collaborator');
    for (let i = 0; i < MOCK_FILE_SCANS_PER_HOUR; i += 1) {
      await mockApi.analyzeFile(new File([`n${i}`], `f${i}.txt`));
    }
    await expectHttp(mockApi.analyzeFile(new File(['x'], 'x.txt')), 429, 'MUITAS_ANALISES');
    loginAs('analyst');
    expect((await mockApi.analyzeFile(new File(['x'], 'x.txt'))).scan.result).toBe('clean');
  });

  it('antivírus fora do ar responde 503 ANTIVIRUS_INDISPONIVEL', async () => {
    loginAs('admin');
    setMockAntivirusAvailable(false);
    await expectHttp(mockApi.analyzeFile(new File(['a'], 'a.txt')), 503, 'ANTIVIRUS_INDISPONIVEL');
  });

  it('colaborador lista só as próprias análises, sem `uploadedBy`; operador vê todas com o dono', async () => {
    const collaborator = loginAs('collaborator');
    await mockApi.analyzeFile(new File(['abc'], 'minha.txt'));
    const own = await mockApi.listFileScans();
    expect(own[0]!.name).toBe('minha.txt');
    expect(own.every((s) => s.uploadedBy === undefined)).toBe(true);
    expect(own.map((s) => s.name)).not.toContain('eicar.com');

    loginAs('analyst');
    const all = await mockApi.listFileScans();
    expect(all.length).toBeGreaterThan(own.length);
    expect(all[0]).toMatchObject({ name: 'minha.txt', uploadedBy: { email: collaborator.email } });
    const dates = all.map((s) => new Date(s.scannedAt).getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('mockSha256 tem 64 hex também sem Web Crypto (contexto não seguro)', async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    try {
      const a = await mockSha256(new TextEncoder().encode('abc'));
      const b = await mockSha256(new TextEncoder().encode('abd'));
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).not.toBe(b);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});

describe('lib/files', () => {
  it('formatBytes em pt-BR e o limite de 10 MB', () => {
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(68)).toBe('68 bytes');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(245_812)).toBe('240 KB');
    expect(formatBytes(MAX_FILE_SIZE_BYTES)).toBe('10 MB');
    expect(formatBytes(-1)).toBe('—');
    expect(isTooLarge(MAX_FILE_SIZE_BYTES)).toBe(false);
    expect(isTooLarge(MAX_FILE_SIZE_BYTES + 1)).toBe(true);
  });

  it('mensagem clara para cada erro do contrato', () => {
    expect(fileScanErrorMessage(new HttpError(400, 'ARQUIVO_OBRIGATORIO', 'x'))).toMatch(/Nenhum arquivo/);
    expect(fileScanErrorMessage(new HttpError(413, 'ARQUIVO_MUITO_GRANDE', 'x'))).toMatch(/10 MB/);
    expect(fileScanErrorMessage(new HttpError(429, 'MUITAS_ANALISES', 'x'))).toMatch(/limite de análises/);
    expect(fileScanErrorMessage(new HttpError(503, 'ANTIVIRUS_INDISPONIVEL', 'x'))).toMatch(
      /não está disponível neste ambiente/,
    );
    expect(fileScanErrorMessage(new HttpError(500, 'ERRO', 'Falha interna'))).toBe('Falha interna');
    expect(fileScanErrorMessage('???')).toBe('Erro inesperado');
  });

  it('veredito nunca diz "seguro"', () => {
    expect(fileScanVerdict({ result: 'clean', threat: null })).toBe('Nenhuma ameaça conhecida encontrada');
    expect(fileScanVerdict({ result: 'threat', threat: 'Eicar-Signature' })).toBe(
      'Ameaça encontrada: Eicar-Signature',
    );
    expect(fileScanVerdict({ result: 'threat', threat: null })).toBe('Ameaça encontrada: não identificada');
  });
});
