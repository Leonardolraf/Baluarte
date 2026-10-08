// Testes de UNIDADE do cliente do VirusTotal (B20). Um servidor HTTP local faz o papel da API v3:
// nada sai para o VirusTotal de verdade. Confere que so o hash vai na requisicao (GET, sem
// corpo), o tratamento de cada resposta e que a chave nunca aparece no log.
import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { consultarHash, lerEstatisticas, virusTotalConfigurado } from '../../src/config/virustotal.js';
import { inteiroDoAmbiente, linkRelatorio, mensagemSegundaOpiniao, segundaOpiniaoDto, vereditoDe } from '../../src/models/segundaOpiniao.model.js';

const CHAVE = 'vt-chave-de-teste-0123456789abcdef';
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const H_MALICIOSO = hash('malicioso');
const H_LIMPO = hash('limpo');
const H_SUSPEITO = hash('suspeito');
const H_DESCONHECIDO = hash('desconhecido');
const H_SEM_ANALISE = hash('sem-analise');
const H_401 = hash('401');
const H_429 = hash('429');
const H_500 = hash('500');
const H_LENTO = hash('lento');
const H_TORTO = hash('torto');
const H_REDIRECIONA = hash('redireciona');

type Recebida = { metodo?: string; url?: string; headers: IncomingMessage['headers']; corpo: string };
let recebidas: Recebida[] = [];
let servidor: Server;
const salvo = { ...process.env };

const relatorio = (stats: Record<string, number>) =>
  JSON.stringify({ data: { id: 'x', type: 'file', attributes: { last_analysis_stats: { 'type-unsupported': 3, timeout: 1, failure: 0, ...stats } } } });
const erroVt = (code: string) => JSON.stringify({ error: { code, message: 'x' } });

before(async () => {
  servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      recebidas.push({ metodo: req.method, url: req.url, headers: req.headers, corpo });
      const sha = (req.url ?? '').split('/').pop();
      const json = (status: number, texto: string) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(texto); };
      switch (sha) {
        case H_MALICIOSO: return json(200, relatorio({ malicious: 50, suspicious: 2, undetected: 10, harmless: 0 }));
        case H_LIMPO: return json(200, relatorio({ malicious: 0, suspicious: 0, undetected: 60, harmless: 5 }));
        case H_SUSPEITO: return json(200, relatorio({ malicious: 0, suspicious: 3, undetected: 60, harmless: 0 }));
        case H_SEM_ANALISE: return json(200, relatorio({ malicious: 0, suspicious: 0, undetected: 0, harmless: 0 }));
        case H_DESCONHECIDO: return json(404, erroVt('NotFoundError'));
        case H_401: return json(401, erroVt('WrongCredentialsError'));
        case H_429: return json(429, erroVt('QuotaExceededError'));
        case H_500: return json(500, 'nao e json');
        case H_TORTO: return json(200, JSON.stringify({ data: { attributes: { last_analysis_stats: { malicious: 'muitos' } } } }));
        case H_REDIRECIONA: res.writeHead(302, { location: 'http://127.0.0.1:9/roubar' }); return res.end();
        case H_LENTO: return; // nunca responde: forca o tempo limite
        default: return json(404, erroVt('NotFoundError'));
      }
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  process.env.VIRUSTOTAL_API_KEY = CHAVE;
  process.env.VIRUSTOTAL_API_URL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v3/`;
  process.env.VIRUSTOTAL_TIMEOUT_MS = '300';
});

afterEach(() => { recebidas = []; });

after(async () => {
  servidor.closeAllConnections();
  await new Promise<void>((ok) => servidor.close(() => ok()));
  for (const k of ['VIRUSTOTAL_API_KEY', 'VIRUSTOTAL_API_URL', 'VIRUSTOTAL_TIMEOUT_MS']) {
    if (salvo[k] === undefined) delete process.env[k];
    else process.env[k] = salvo[k];
  }
});

/** Roda `fn` capturando o que sairia em console.error/log/warn. */
async function comLog<T>(fn: () => Promise<T>): Promise<{ valor: T; log: string }> {
  const originais = { error: console.error, log: console.log, warn: console.warn };
  const linhas: string[] = [];
  const captura = (...a: unknown[]) => { linhas.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' ')); };
  console.error = captura; console.log = captura; console.warn = captura;
  try {
    return { valor: await fn(), log: linhas.join('\n') };
  } finally {
    Object.assign(console, originais);
  }
}

describe('cliente do VirusTotal (config/virustotal)', () => {
  it('consulta só pelo hash: GET /files/<sha256>, chave no cabeçalho x-apikey e nenhum corpo', async () => {
    const r = await consultarHash(H_MALICIOSO);
    assert.deepEqual(r, { tipo: 'RELATORIO', estatisticas: { malicious: 50, suspicious: 2, undetected: 10, harmless: 0 } });
    assert.equal(recebidas.length, 1);
    const [req] = recebidas;
    assert.equal(req.metodo, 'GET');
    assert.equal(req.url, `/api/v3/files/${H_MALICIOSO}`);
    assert.equal(req.headers['x-apikey'], CHAVE);
    assert.equal(req.corpo, '', 'nada além do hash sai da API');
    assert.equal(req.headers['content-type'], undefined);
  });

  it('arquivo sem detecção: relatório com zero malicioso e zero suspeito', async () => {
    const r = await consultarHash(H_LIMPO);
    assert.deepEqual(r, { tipo: 'RELATORIO', estatisticas: { malicious: 0, suspicious: 0, undetected: 60, harmless: 5 } });
  });

  it('404: hash desconhecido pelo VirusTotal (e nada é enviado)', async () => {
    assert.deepEqual(await consultarHash(H_DESCONHECIDO), { tipo: 'DESCONHECIDO' });
    assert.equal(recebidas.length, 1);
    assert.equal(recebidas[0].metodo, 'GET');
  });

  it('401 (chave inválida), 429 (limite do VirusTotal), 500 e resposta torta viram INDISPONIVEL', async () => {
    assert.deepEqual(await consultarHash(H_401), { tipo: 'INDISPONIVEL', motivo: 'CHAVE_INVALIDA' });
    assert.deepEqual(await consultarHash(H_429), { tipo: 'INDISPONIVEL', motivo: 'LIMITE_VIRUSTOTAL' });
    assert.deepEqual(await consultarHash(H_500), { tipo: 'INDISPONIVEL', motivo: 'FALHA' });
    assert.deepEqual(await consultarHash(H_TORTO), { tipo: 'INDISPONIVEL', motivo: 'FALHA' });
  });

  it('tempo esgotado: INDISPONIVEL rápido, sem lançar', async () => {
    const inicio = Date.now();
    const { valor } = await comLog(() => consultarHash(H_LENTO));
    assert.deepEqual(valor, { tipo: 'INDISPONIVEL', motivo: 'TEMPO_ESGOTADO' });
    assert.ok(Date.now() - inicio < 3000);
  });

  it('não segue redirecionamento (a chave não vai para outro endereço)', async () => {
    const { valor } = await comLog(() => consultarHash(H_REDIRECIONA));
    assert.deepEqual(valor, { tipo: 'INDISPONIVEL', motivo: 'FALHA' });
    assert.equal(recebidas.length, 1);
  });

  it('VirusTotal fora do ar (porta fechada): INDISPONIVEL', async () => {
    const url = process.env.VIRUSTOTAL_API_URL;
    process.env.VIRUSTOTAL_API_URL = 'http://127.0.0.1:1/api/v3';
    try {
      const { valor } = await comLog(() => consultarHash(H_LIMPO));
      assert.deepEqual(valor, { tipo: 'INDISPONIVEL', motivo: 'FALHA' });
    } finally {
      process.env.VIRUSTOTAL_API_URL = url;
    }
  });

  it('a chave nunca aparece no log, em nenhum caso de falha', async () => {
    const { log } = await comLog(async () => {
      for (const h of [H_401, H_429, H_500, H_TORTO, H_LENTO, H_REDIRECIONA]) await consultarHash(h);
    });
    assert.match(log, /401 WrongCredentialsError/);
    assert.match(log, /429 QuotaExceededError/);
    assert.match(log, /tempo esgotado/);
    assert.doesNotMatch(log, new RegExp(CHAVE));
    assert.doesNotMatch(log, /vt-chave/);
  });

  it('hash inválido ou sem chave: não faz requisição', async () => {
    assert.deepEqual(await consultarHash('../upload'), { tipo: 'INDISPONIVEL', motivo: 'FALHA' });
    assert.deepEqual(await consultarHash(H_LIMPO.toUpperCase()), { tipo: 'INDISPONIVEL', motivo: 'FALHA' });
    delete process.env.VIRUSTOTAL_API_KEY;
    try {
      assert.equal(virusTotalConfigurado(), false);
      assert.deepEqual(await consultarHash(H_LIMPO), { tipo: 'INDISPONIVEL', motivo: 'FALHA' });
    } finally {
      process.env.VIRUSTOTAL_API_KEY = CHAVE;
    }
    assert.equal(virusTotalConfigurado(), true);
    assert.equal(recebidas.length, 0);
  });

  it('lerEstatisticas recusa formato inesperado', () => {
    assert.equal(lerEstatisticas(null), null);
    assert.equal(lerEstatisticas({ data: {} }), null);
    assert.equal(lerEstatisticas({ data: { attributes: { last_analysis_stats: { malicious: -1, suspicious: 0, undetected: 0, harmless: 0 } } } }), null);
    assert.deepEqual(lerEstatisticas(JSON.parse(relatorio({ malicious: 1, suspicious: 0, undetected: 2, harmless: 3 }))),
      { malicious: 1, suspicious: 0, undetected: 2, harmless: 3 });
  });

  it('link do relatório público usa só o hash', () => {
    assert.equal(linkRelatorio(H_LIMPO), `https://www.virustotal.com/gui/file/${H_LIMPO}`);
  });
});

describe('veredito e mensagem da segunda opinião (models/segundaOpiniao)', () => {
  it('malicioso, suspeito, sem detecção e sem análise', () => {
    assert.deepEqual(vereditoDe({ malicious: 50, suspicious: 2, undetected: 10, harmless: 0 }), { vtSituacao: 'MALICIOSO', vtDeteccoes: 52, vtTotal: 62 });
    assert.deepEqual(vereditoDe({ malicious: 0, suspicious: 3, undetected: 60, harmless: 0 }), { vtSituacao: 'SUSPEITO', vtDeteccoes: 3, vtTotal: 63 });
    assert.deepEqual(vereditoDe({ malicious: 0, suspicious: 0, undetected: 60, harmless: 5 }), { vtSituacao: 'SEM_DETECCAO', vtDeteccoes: 0, vtTotal: 65 });
    assert.deepEqual(vereditoDe({ malicious: 0, suspicious: 0, undetected: 0, harmless: 0 }), { vtSituacao: 'DESCONHECIDO', vtDeteccoes: null, vtTotal: null });
  });

  it('mensagens: nunca dizem "seguro"; cota diz "indisponível agora (cota)"', () => {
    const base = { vtMotivo: null, vtDeteccoes: null, vtTotal: null, vtConsultadoEm: null };
    const msgs = [
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'MALICIOSO', vtDeteccoes: 52, vtTotal: 62 }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'SUSPEITO', vtDeteccoes: 3, vtTotal: 63 }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'SEM_DETECCAO', vtDeteccoes: 0, vtTotal: 65 }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'DESCONHECIDO' }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'INDISPONIVEL', vtMotivo: 'COTA' }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'INDISPONIVEL', vtMotivo: 'CHAVE_INVALIDA' }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'INDISPONIVEL', vtMotivo: 'LIMITE_VIRUSTOTAL' }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'INDISPONIVEL', vtMotivo: 'TEMPO_ESGOTADO' }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'INDISPONIVEL', vtMotivo: 'FALHA' }),
      mensagemSegundaOpiniao({ ...base, vtSituacao: 'DESLIGADO' }),
    ];
    assert.match(msgs[0], /52 de 62/);
    assert.match(msgs[2], /Nenhum dos 65/);
    assert.match(msgs[3], /não foi enviado/);
    assert.equal(msgs[4], 'Segunda opinião indisponível agora (cota)');
    for (const m of msgs) assert.doesNotMatch(m, /segur/i);
  });

  it('DTO: null para análise anterior ao B20; com link e mensagem quando há consulta', () => {
    const r = { sha256: H_LIMPO, vtSituacao: null, vtMotivo: null, vtDeteccoes: null, vtTotal: null, vtConsultadoEm: null };
    assert.equal(segundaOpiniaoDto(r), null);
    const em = new Date('2026-10-08T12:00:00Z');
    assert.deepEqual(segundaOpiniaoDto({ ...r, vtSituacao: 'SEM_DETECCAO', vtDeteccoes: 0, vtTotal: 65, vtConsultadoEm: em }), {
      fonte: 'VirusTotal', situacao: 'SEM_DETECCAO', motivo: null, deteccoes: 0, total: 65, consultadoEm: em,
      link: `https://www.virustotal.com/gui/file/${H_LIMPO}`,
      mensagem: 'Nenhum dos 65 mecanismos do VirusTotal detectou ameaça conhecida neste arquivo',
    });
  });

  it('inteiroDoAmbiente: valor válido ou padrão', () => {
    process.env.TESTE_INTEIRO = '7';
    assert.equal(inteiroDoAmbiente('TESTE_INTEIRO', 4), 7);
    process.env.TESTE_INTEIRO = 'abc';
    assert.equal(inteiroDoAmbiente('TESTE_INTEIRO', 4), 4);
    process.env.TESTE_INTEIRO = '0';
    assert.equal(inteiroDoAmbiente('TESTE_INTEIRO', 4), 4);
    delete process.env.TESTE_INTEIRO;
  });
});
