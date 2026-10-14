import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/errors';
import { tokenStorage } from '@/lib/storage';
import { httpClient } from '@/services/api';

// Resiliência do cliente HTTP a oscilação do transporte.
//
// Contexto: a API da demonstração responde por um Funnel do Tailscale, que custa ~1 s fixo
// por requisição. Em 13/10/2026 a tela /trainings morreu com "A API demorou demais para
// responder" e voltou sozinha ao recarregar — medimos depois que a consulta leva 0,5 ms no
// banco e a rota 1–2 ms no localhost da VM, ou seja, foi o caminho até lá. Daí a
// retentativa única e o tempo limite maior.

describe('cliente HTTP: tempo limite e retentativa', () => {
  const adapterOriginal = httpClient.defaults.adapter;
  let tentativas: InternalAxiosRequestConfig[];
  let responder: (config: InternalAxiosRequestConfig, n: number) => { status: number; data: unknown };

  function semResposta(config: InternalAxiosRequestConfig, code: 'ECONNABORTED' | 'ERR_NETWORK') {
    // Erro sem `response`: é assim que o axios representa tempo esgotado e falha de rede.
    return new AxiosError('sem resposta', code, config, null, undefined);
  }

  beforeEach(() => {
    tentativas = [];
    tokenStorage.set('token-de-teste');
    const adapter: AxiosAdapter = async (config) => {
      tentativas.push(config);
      const r = responder(config, tentativas.length);
      if (r.status === 0) throw semResposta(config, 'ECONNABORTED');
      if (r.status === -1) throw semResposta(config, 'ERR_NETWORK');
      const response = { data: r.data, status: r.status, statusText: '', headers: {}, config };
      if (r.status >= 400)
        throw new AxiosError(`HTTP ${r.status}`, 'ERR_BAD_RESPONSE', config, null, response);
      return response;
    };
    httpClient.defaults.adapter = adapter;
  });

  afterEach(() => {
    httpClient.defaults.adapter = adapterOriginal;
    tokenStorage.clear();
  });

  it('o tempo limite padrão é de 30 s', () => {
    expect(httpClient.defaults.timeout).toBe(30_000);
  });

  it('GET com tempo esgotado é repetido uma vez e sucede na segunda', async () => {
    responder = (_config, n) => (n === 1 ? { status: 0, data: null } : { status: 200, data: { ok: true } });
    const resposta = await httpClient.request({ method: 'GET', url: '/qualquer' });
    expect(resposta.data).toEqual({ ok: true });
    expect(tentativas).toHaveLength(2);
  });

  it('GET com falha de rede também é repetido uma vez', async () => {
    responder = (_config, n) => (n === 1 ? { status: -1, data: null } : { status: 200, data: [] });
    await httpClient.request({ method: 'GET', url: '/qualquer' });
    expect(tentativas).toHaveLength(2);
  });

  it('falhando duas vezes, desiste e devolve TIMEOUT (sem repetir em laço)', async () => {
    responder = () => ({ status: 0, data: null });
    const erro = await httpClient.request({ method: 'GET', url: '/qualquer' }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(HttpError);
    expect((erro as HttpError).code).toBe('TIMEOUT');
    expect(tentativas).toHaveLength(2);
  });

  it('POST NÃO é repetido: repetir escrita pode duplicar efeito', async () => {
    responder = () => ({ status: 0, data: null });
    const erro = await httpClient
      .request({ method: 'POST', url: '/campanhas', data: {} })
      .catch((e: unknown) => e);
    expect((erro as HttpError).code).toBe('TIMEOUT');
    expect(tentativas).toHaveLength(1);
  });

  it('erro com resposta do servidor não é repetido: o servidor já decidiu', async () => {
    responder = () => ({ status: 500, data: { mensagem: 'Falha interna', codigoErro: 'ERRO_INTERNO' } });
    const erro = await httpClient.request({ method: 'GET', url: '/qualquer' }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(HttpError);
    expect((erro as HttpError).status).toBe(500);
    expect(tentativas).toHaveLength(1);
  });
});
