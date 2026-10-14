import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RBACRole } from '@/types';
import { httpClient, realApi } from '@/services/api';
import { toFileScan, toSecondOpinion, type BackendFileScan } from '@/services/adapters';
import { HttpError } from '@/lib/errors';
import {
  fileScanErrorMessage,
  fileScanVerdict,
  formatBytes,
  isLimitExceeded,
  isTooLarge,
  LIMIT_EXCEEDED_LABEL,
  MAX_FILE_SIZE_BYTES,
  SCAN_RESPONSE_TIMEOUT_MS,
  secondOpinionText,
  isUnanalyzable,
  unanalyzableLabel,
  UPLOAD_IDLE_TIMEOUT_MS,
  watchUpload,
} from '@/lib/files';
import { buildMockToken } from '@/lib/jwt';
import { tokenStorage } from '@/lib/storage';
import {
  EICAR_SIGNATURE,
  MOCK_EICAR_DETECTIONS,
  MOCK_FILE_SCANS_PER_HOUR,
  mockApi,
  mockSha256,
  setMockAntivirusAvailable,
  setMockSecondOpinion,
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
      secondOpinion: null,
      ownRule: false,
      campaign: null,
    });
  });

  it('converte a segunda opinião do VirusTotal (B20); o link sai do hash, nunca do servidor', () => {
    const scan = toFileScan(
      backendScan({
        segundaOpiniao: {
          fonte: 'VirusTotal',
          situacao: 'MALICIOSO',
          motivo: null,
          deteccoes: 61,
          total: 68,
          consultadoEm: '2026-10-08T12:00:01.000Z',
          link: 'javascript:alert(1)',
          mensagem: '61 de 68…',
        },
      }),
    );
    expect(scan.secondOpinion).toEqual({
      source: 'VirusTotal',
      status: 'malicious',
      reason: null,
      detections: 61,
      total: 68,
      checkedAt: '2026-10-08T12:00:01.000Z',
      link: 'https://www.virustotal.com/gui/file/275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f',
    });
  });

  it('segunda opinião: indisponível com motivo, desconhecido sem contagens, situação estranha vira indisponível', () => {
    const sha = 'a'.repeat(64);
    const raw = {
      fonte: 'VirusTotal',
      motivo: null,
      deteccoes: null,
      total: null,
      consultadoEm: null,
      link: '',
    };
    expect(toSecondOpinion({ ...raw, situacao: 'INDISPONIVEL', motivo: 'COTA' }, sha)).toMatchObject({
      status: 'unavailable',
      reason: 'quota',
    });
    expect(toSecondOpinion({ ...raw, situacao: 'INDISPONIVEL', motivo: 'TEMPO_ESGOTADO' }, sha)?.reason).toBe(
      'timeout',
    );
    expect(toSecondOpinion({ ...raw, situacao: 'INDISPONIVEL', motivo: 'XYZ' }, sha)?.reason).toBe('failure');
    expect(
      toSecondOpinion(
        { ...raw, situacao: 'DESCONHECIDO', deteccoes: 3, total: 9, consultadoEm: '2026-10-08T00:00:00Z' },
        sha,
      ),
    ).toMatchObject({ status: 'unknown', detections: null, total: null, checkedAt: '2026-10-08T00:00:00Z' });
    expect(toSecondOpinion({ ...raw, situacao: 'SEM_DETECCAO', deteccoes: 0, total: 66 }, sha)).toMatchObject(
      {
        status: 'no_detection',
        detections: 0,
        total: 66,
      },
    );
    expect(
      toSecondOpinion({ ...raw, situacao: 'SUSPEITO', deteccoes: -1, total: 66 }, sha)?.detections,
    ).toBeNull();
    expect(toSecondOpinion({ ...raw, situacao: 'DESLIGADO' }, sha)?.status).toBe('disabled');
    expect(toSecondOpinion({ ...raw, situacao: 'OUTRA' }, sha)).toMatchObject({
      status: 'unavailable',
      reason: 'failure',
    });
    expect(toSecondOpinion(null, sha)).toBeNull();
    expect(toSecondOpinion(undefined, sha)).toBeNull();
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

  it('GET /arquivos/analises desembrulha o envelope, adapta cada item e lê o total do resumo', async () => {
    const seen = respondWith((config) =>
      ok(config, {
        status: 'sucesso',
        dados: [
          backendScan({ id: 'a2', usuario: { nome: 'Ana', email: 'ana@empresa.com' } }),
          backendScan({ id: 'a1', resultado: 'LIMPO', ameaca: null }),
        ],
        resumo: { total: 42, pagina: 1, tamanho: 20 },
      }),
    );
    const page = await realApi.listFileScans();
    expect(seen[0]!.url).toBe('/arquivos/analises');
    // Sem filtro: só a paginação padrão vai na query.
    expect(seen[0]!.params).toEqual({ pagina: '1', tamanho: '20' });
    expect(page.items.map((s) => [s.id, s.result, s.uploadedBy?.name])).toEqual([
      ['a2', 'threat', 'Ana'],
      ['a1', 'clean', undefined],
    ]);
    expect(page).toMatchObject({ total: 42, page: 1, pageSize: 20 });
  });

  it('filtro e página viram resultado/pagina/tamanho; sem resumo, o total é o que veio', async () => {
    const seen = respondWith((config) =>
      ok(config, { status: 'sucesso', dados: [backendScan({ id: 'a9' })] }),
    );
    const threats = await realApi.listFileScans({ result: 'threat', page: 3, pageSize: 50 });
    expect(seen[0]!.params).toEqual({ resultado: 'AMEACA', pagina: '3', tamanho: '50' });
    expect(threats).toMatchObject({ total: 1, page: 3, pageSize: 50 });
    await realApi.listFileScans({ result: 'clean' });
    expect(seen[1]!.params).toEqual({ resultado: 'LIMPO', pagina: '1', tamanho: '20' });
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

  it('acima de 250 MB responde 413 ARQUIVO_MUITO_GRANDE (exatamente 250 MB passa)', async () => {
    loginAs('analyst');
    const big = new File(['x'], 'grande.bin');
    Object.defineProperty(big, 'size', { value: MAX_FILE_SIZE_BYTES + 1 });
    await expectHttp(mockApi.analyzeFile(big), 413, 'ARQUIVO_MUITO_GRANDE');

    // O tamanho declarado é o que o limite confere; o conteúdo fica pequeno para o teste não
    // alocar 250 MB.
    const limit = new File(['x'], 'limite.bin');
    Object.defineProperty(limit, 'size', { value: MAX_FILE_SIZE_BYTES });
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
    const own = (await mockApi.listFileScans()).items;
    expect(own[0]!.name).toBe('minha.txt');
    expect(own.every((s) => s.uploadedBy === undefined)).toBe(true);
    expect(own.map((s) => s.name)).not.toContain('eicar.com');

    loginAs('analyst');
    const all = (await mockApi.listFileScans()).items;
    expect(all.length).toBeGreaterThan(own.length);
    expect(all[0]).toMatchObject({ name: 'minha.txt', uploadedBy: { email: collaborator.email } });
    const dates = all.map((s) => new Date(s.scannedAt).getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it('histórico filtra por resultado e pagina, com o total do filtro (B17)', async () => {
    loginAs('analyst');
    for (let i = 0; i < 3; i += 1) await mockApi.analyzeFile(new File([`limpo-${i}`], `l${i}.txt`));
    const all = await mockApi.listFileScans({ pageSize: 100 });
    const threats = await mockApi.listFileScans({ result: 'threat', pageSize: 100 });
    expect(threats.items.length).toBeGreaterThan(0);
    expect(threats.items.every((s) => s.result === 'threat')).toBe(true);
    const clean = await mockApi.listFileScans({ result: 'clean', pageSize: 100 });
    expect(clean.items.every((s) => s.result === 'clean')).toBe(true);
    expect(threats.total + clean.total).toBe(all.total);

    const first = await mockApi.listFileScans({ page: 1, pageSize: 2 });
    const second = await mockApi.listFileScans({ page: 2, pageSize: 2 });
    expect(first).toMatchObject({ total: all.total, page: 1, pageSize: 2 });
    expect(first.items).toHaveLength(2);
    expect([...first.items, ...second.items].map((s) => s.id)).toEqual(
      all.items.slice(0, 4).map((s) => s.id),
    );
  });

  it('histórico com página, tamanho ou resultado inválido responde 400 com o código do backend', async () => {
    loginAs('admin');
    await expectHttp(mockApi.listFileScans({ page: 0 }), 400, 'PAGINA_INVALIDA');
    await expectHttp(mockApi.listFileScans({ pageSize: 101 }), 400, 'TAMANHO_INVALIDO');
    await expectHttp(mockApi.listFileScans({ result: 'x' as unknown as 'clean' }), 400, 'RESULTADO_INVALIDO');
  });

  it('dashboard conta arquivo malicioso como crítico, uma vez por SHA-256 (B17)', async () => {
    loginAs('analyst');
    const before = await mockApi.getDashboard();
    // O seed tem dois vereditos de ameaça de ontem: o EICAR e o Zip64 não analisável (DT27).
    // Os dois contam, porque a regra do B17 conta SHA-256 distintos com AMEACA — e o Zip64 é
    // AMEACA por precaução. Vale lembrar que isso soma ao KPI de "arquivos maliciosos" algo
    // que ninguém conseguiu analisar; a regra é do servidor e o mock a espelha.
    expect(before.kpis.maliciousFiles).toBe(2);
    // O mesmo EICAR de novo (mesmo conteúdo = mesmo hash) não soma; um arquivo malicioso novo soma.
    const eicar = new File(['X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE'], 'eicar.txt');
    await mockApi.analyzeFile(eicar);
    await mockApi.analyzeFile(eicar);
    const after = await mockApi.getDashboard();
    expect(after.kpis.maliciousFiles).toBe(3);
    expect(after.kpis.criticalVulnerabilities).toBe(before.kpis.criticalVulnerabilities! + 1);
    expect(after.severityDistribution!.critical).toBe(before.severityDistribution!.critical + 1);
    expect(after.kpis.openVulnerabilities).toBe(before.kpis.openVulnerabilities);
    expect(after.technicalRisk).toBeGreaterThanOrEqual(before.technicalRisk!);
  });

  it('segunda opinião simulada: EICAR malicioso, arquivo novo desconhecido, cache pelo hash', async () => {
    loginAs('collaborator');
    const eicar = await mockApi.analyzeFile(new File(['qualquer'], 'eicar.com'));
    expect(eicar.scan.secondOpinion).toMatchObject({ status: 'malicious', ...MOCK_EICAR_DETECTIONS });
    expect(eicar.scan.secondOpinion?.link).toBe(`https://www.virustotal.com/gui/file/${eicar.scan.sha256}`);

    const novo = await mockApi.analyzeFile(new File(['abc'], 'notas.txt'));
    expect(novo.scan.result).toBe('clean');
    expect(novo.scan.secondOpinion).toMatchObject({ status: 'unknown', detections: null });
    expect(novo.scan.secondOpinion?.checkedAt).not.toBeNull();

    // Sem cota, o mesmo hash ainda sai do cache; um hash novo fica indisponível.
    setMockSecondOpinion('quota');
    const repetido = await mockApi.analyzeFile(new File(['abc'], 'copia.txt'));
    expect(repetido.scan.secondOpinion).toEqual(novo.scan.secondOpinion);
    const semCota = await mockApi.analyzeFile(new File(['outro'], 'outro.txt'));
    expect(semCota.scan.secondOpinion).toMatchObject({
      status: 'unavailable',
      reason: 'quota',
      checkedAt: null,
    });

    setMockSecondOpinion('disabled');
    const desligada = await mockApi.analyzeFile(new File(['abc'], 'c.txt'));
    expect(desligada.scan.secondOpinion).toMatchObject({ status: 'disabled', checkedAt: null });
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
  it('formatBytes em pt-BR e o limite de 250 MB', () => {
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(68)).toBe('68 bytes');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(245_812)).toBe('240 KB');
    expect(MAX_FILE_SIZE_BYTES).toBe(250 * 1024 * 1024);
    expect(formatBytes(MAX_FILE_SIZE_BYTES)).toBe('250 MB');
    expect(formatBytes(-1)).toBe('—');
    expect(isTooLarge(MAX_FILE_SIZE_BYTES)).toBe(false);
    expect(isTooLarge(MAX_FILE_SIZE_BYTES + 1)).toBe(true);
  });

  it('mensagem clara para cada erro do contrato', () => {
    expect(fileScanErrorMessage(new HttpError(400, 'ARQUIVO_OBRIGATORIO', 'x'))).toMatch(/Nenhum arquivo/);
    expect(fileScanErrorMessage(new HttpError(413, 'ARQUIVO_MUITO_GRANDE', 'x'))).toMatch(/limite de 250 MB/);
    // 413 sem o código da API (hospedagem, ex.: Vercel): não promete os 250 MB.
    const hospedagem = fileScanErrorMessage(new HttpError(413, 'HTTP_413', 'Erro 413'));
    expect(hospedagem).toMatch(/recusou o envio pelo tamanho/);
    expect(hospedagem).not.toMatch(/250 MB/);
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

  describe('vigia do envio: ociosidade, não prazo total (decisão do Leo)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('padrões: 90 s sem progresso no envio, 6 min pela resposta depois do último byte', () => {
      expect(UPLOAD_IDLE_TIMEOUT_MS).toBe(90_000);
      expect(SCAN_RESPONSE_TIMEOUT_MS).toBe(360_000);
    });

    it('envio lento porém estável nunca expira, por mais que dure', () => {
      vi.useFakeTimers();
      const expirou = vi.fn();
      const vigia = watchUpload(expirou, { idleMs: 1000, responseMs: 5000 });
      // 1 hora de envio, com progresso a cada 900 ms.
      for (let t = 0; t < 4000; t++) {
        vi.advanceTimersByTime(900);
        vigia.progress(t + 1, 10_000);
      }
      expect(expirou).not.toHaveBeenCalled();
      vigia.stop();
    });

    it('progresso parado além da ociosidade: expira por "idle"', () => {
      vi.useFakeTimers();
      const expirou = vi.fn();
      const vigia = watchUpload(expirou, { idleMs: 1000, responseMs: 5000 });
      vigia.progress(10, 100);
      vi.advanceTimersByTime(999);
      expect(expirou).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(expirou).toHaveBeenCalledWith('idle');
    });

    it('depois do último byte, espera a análise até o prazo da resposta e expira por "response"', () => {
      vi.useFakeTimers();
      const expirou = vi.fn();
      const vigia = watchUpload(expirou, { idleMs: 1000, responseMs: 5000 });
      vigia.progress(100, 100);
      vi.advanceTimersByTime(4999);
      expect(expirou).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(expirou).toHaveBeenCalledWith('response');
    });

    it('stop: a resposta chegou, nada expira depois', () => {
      vi.useFakeTimers();
      const expirou = vi.fn();
      const vigia = watchUpload(expirou, { idleMs: 1000, responseMs: 5000 });
      vigia.stop();
      vi.advanceTimersByTime(60_000);
      expect(expirou).not.toHaveBeenCalled();
    });

    it('mensagens claras para envio parado (API ou navegador) e análise sem resposta', () => {
      for (const codigo of ['ENVIO_PARADO', 'ENVIO_SEM_PROGRESSO'])
        expect(fileScanErrorMessage(new HttpError(codigo === 'ENVIO_PARADO' ? 408 : 0, codigo, 'x'))).toMatch(
          /parou de avançar/,
        );
      expect(fileScanErrorMessage(new HttpError(0, 'ANALISE_SEM_RESPOSTA', 'x'))).toMatch(
        /não respondeu a tempo/,
      );
    });
  });

  it('limite do antivírus excedido (AlertExceedsMax): o nome técnico ganha a explicação', () => {
    expect(isLimitExceeded('Heuristics.Limits.Exceeded.MaxFileSize')).toBe(true);
    expect(isLimitExceeded('Heuristics.Limits.Exceeded')).toBe(true);
    for (const outro of [
      'Heuristics.Encrypted.Zip',
      'xHeuristics.Limits.Exceeded.MaxFiles',
      'Eicar-Signature',
      null,
    ])
      expect(isLimitExceeded(outro)).toBe(false);
    expect(fileScanVerdict({ result: 'threat', threat: 'Heuristics.Limits.Exceeded.MaxScanSize' })).toBe(
      `Ameaça encontrada: Heuristics.Limits.Exceeded.MaxScanSize (${LIMIT_EXCEEDED_LABEL})`,
    );
    expect(LIMIT_EXCEEDED_LABEL).toBe(
      'passa dos limites de análise do antivírus; tratado como ameaça por precaução',
    );
  });

  it('textos da segunda opinião: claros para desconhecido e indisponível, nunca "seguro"', () => {
    const base = {
      source: 'VirusTotal' as const,
      reason: null,
      detections: null,
      total: null,
      checkedAt: null,
      link: '',
    };
    const all = [
      secondOpinionText({ ...base, status: 'malicious', detections: 61, total: 68 }),
      secondOpinionText({ ...base, status: 'suspicious', detections: 2, total: 66 }),
      secondOpinionText({ ...base, status: 'no_detection', detections: 0, total: 66 }),
      secondOpinionText({ ...base, status: 'unknown' }),
      secondOpinionText({ ...base, status: 'unavailable', reason: 'quota' }),
      secondOpinionText({ ...base, status: 'unavailable', reason: 'invalid_key' }),
      secondOpinionText({ ...base, status: 'unavailable', reason: 'provider_limit' }),
      secondOpinionText({ ...base, status: 'unavailable', reason: 'timeout' }),
      secondOpinionText({ ...base, status: 'unavailable', reason: null }),
      secondOpinionText({ ...base, status: 'disabled' }),
    ];
    expect(all[0]!.title).toBe('61 de 68 antivírus do VirusTotal detectaram este arquivo');
    expect(all[0]!.short).toBe('61/68 detecções');
    expect(all[1]!.short).toBe('2/66 suspeito');
    expect(all[2]!.title).toBe('Nenhum dos 66 antivírus do VirusTotal detectou ameaça conhecida');
    expect(all[3]!.detail).toMatch(/não foi enviado ao VirusTotal/);
    expect(all[4]!.title).toBe('Segunda opinião indisponível agora (cota)');
    expect(all[5]!.title).toMatch(/chave do VirusTotal recusada/);
    expect(all[6]!.title).toMatch(/limite do VirusTotal/);
    expect(all[7]!.title).toMatch(/não respondeu a tempo/);
    expect(all[8]!.title).toMatch(/falha ao consultar/);
    expect(all[9]!.short).toBe('Desligada');
    for (const t of all) expect(`${t.title} ${t.detail}`).not.toMatch(/é seguro|arquivo seguro/i);
  });
});
// DT27: arquivo que o antivírus não consegue analisar vira veredito de ameaça por precaução.
// A tela não pode chamar isso de ameaça encontrada: nada foi identificado.
describe('arquivo não analisável (DT27)', () => {
  it('Zip64 não é apresentado como ameaça identificada', () => {
    const verdito = fileScanVerdict({ result: 'threat', threat: 'Baluarte.Zip64.NaoAnalisavel' });
    expect(verdito).toMatch(/não analisável/i);
    expect(verdito).toMatch(/precaução/);
    expect(verdito).not.toMatch(/Ameaça encontrada/);
  });

  it('verificação incompleta tem o próprio motivo', () => {
    expect(fileScanVerdict({ result: 'threat', threat: 'Baluarte.Zip64.VerificacaoIncompleta' })).toMatch(
      /limite de descompressão|aninhamento/,
    );
  });

  it('detecção de verdade continua dizendo ameaça encontrada', () => {
    expect(fileScanVerdict({ result: 'threat', threat: 'Eicar-Signature' })).toMatch(
      /Ameaça encontrada: Eicar-Signature/,
    );
    expect(unanalyzableLabel('Eicar-Signature')).toBeNull();
    expect(isUnanalyzable('Eicar-Signature')).toBe(false);
  });
});

// #18: dois erros 429 diferentes. Antes desta correção, 'duas análises ao mesmo tempo' caía
// na mensagem de 'limite por hora' — quem esperasse uma hora esperaria em vão.
describe('mensagens dos limites do upload (#18)', () => {
  it('análises simultâneas não usa a mensagem de limite por hora', () => {
    const texto = fileScanErrorMessage(new HttpError(429, 'ANALISES_SIMULTANEAS', 'x'));
    expect(texto).toMatch(/2 análises em andamento/);
    expect(texto).not.toMatch(/por hora/);
  });

  it('limite por hora continua com a própria mensagem', () => {
    expect(fileScanErrorMessage(new HttpError(429, 'MUITAS_ANALISES', 'x'))).toMatch(/por hora/);
  });

  it('tempo máximo de envio tem mensagem própria', () => {
    expect(fileScanErrorMessage(new HttpError(408, 'ENVIO_TEMPO_MAXIMO', 'x'))).toMatch(/tempo máximo/);
  });
});
