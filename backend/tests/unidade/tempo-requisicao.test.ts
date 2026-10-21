// Testes de UNIDADE do prazo para receber o corpo (Melhorias #18, decisao do Leo): toda rota tem
// o total de 5 min (o `requestTimeout` do Node, desligado no servidor e reaplicado pelo
// middleware); so a analise de arquivos troca o total por OCIOSIDADE (sem nenhum byte por 60 s).
// Sem banco: um app Express minimo com o mesmo middleware e o servidor criado com as mesmas
// opcoes de producao (config/servidorHttp.ts). Os tempos vem do ambiente em fracoes de segundo.
// A rota real (controller, vaga devolvida, 408 em JSON) e testada em
// tests/seguranca/envio-lento.test.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { OPCOES_SERVIDOR_HTTP, escutar } from '../../src/config/servidorHttp.js';
import {
  OCIOSIDADE_ENVIO_PADRAO_MS, TEMPO_TOTAL_PADRAO_MS, ociosidadeEnvioMs, tempoTotalDaRequisicao, tempoTotalMs, trocarPorOciosidade,
} from '../../src/middlewares/tempoRequisicao.middleware.js';

const TOTAL_MS = 800;
const OCIOSIDADE_MS = 400;
const salvo = { total: process.env.REQUISICAO_TEMPO_TOTAL_MS, ocio: process.env.ENVIO_OCIOSIDADE_MS };

let servidor: Server;
let porta = 0;

/** Rota comum (le o corpo inteiro, como o parser de JSON) e rota de envio (com ociosidade). */
function montarApp() {
  const app = express();
  app.use(tempoTotalDaRequisicao);
  app.post('/comum', express.raw({ type: () => true, limit: '10mb' }), (req, res) => {
    res.json({ bytes: (req.body as Buffer).length });
  });
  app.get('/leitura', (_req, res) => res.json({ ok: true }));
  app.post('/envio', (req, res) => {
    let bytes = 0;
    let parado = false;
    trocarPorOciosidade(req, () => {
      parado = true;
      res.setHeader('Connection', 'close');
      res.status(408).json({ codigoErro: 'ENVIO_PARADO' });
      res.once('finish', () => setImmediate(() => req.socket.destroy()));
    });
    req.on('data', (c: Buffer) => { bytes += c.length; });
    req.on('end', () => {
      if (!parado) res.json({ bytes });
    });
  });
  // Corpo abortado pelo prazo: o parser reclama numa conexao que ja caiu; nada a responder.
  app.use((_e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (!res.headersSent) res.status(400).end();
  });
  return app;
}

type Resultado = { status?: number; body?: any; fechadaSemResposta?: boolean; ms: number };

/**
 * Manda `pedacos` blocos de `tamanho` bytes, um a cada `intervaloMs`, com Content-Length do
 * total declarado (`declarado`, padrao = tudo o que sera mandado). `pararDepoisDe` corta o envio.
 */
function enviarAosPoucos(caminho: string, o: { pedacos: number; tamanho: number; intervaloMs: number; pararDepoisDe?: number }): Promise<Resultado> {
  const inicio = Date.now();
  const total = o.pedacos * o.tamanho;
  return new Promise((ok) => {
    let respondeu = false;
    const req = request({ host: '127.0.0.1', port: porta, path: caminho, method: 'POST', headers: { 'Content-Length': total, 'Content-Type': 'application/octet-stream' } }, (res) => {
      respondeu = true;
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => { texto += c; });
      res.on('end', () => ok({ status: res.statusCode, body: texto ? JSON.parse(texto) : null, ms: Date.now() - inicio }));
    });
    req.on('error', () => { if (!respondeu) ok({ fechadaSemResposta: true, ms: Date.now() - inicio }); });
    req.on('close', () => { if (!respondeu) ok({ fechadaSemResposta: true, ms: Date.now() - inicio }); });
    let enviados = 0;
    const limite = o.pararDepoisDe ?? o.pedacos;
    const mandar = () => {
      if (req.destroyed || respondeu) return;
      if (enviados >= limite) return; // para de mandar e segura a conexao aberta
      req.write(Buffer.alloc(o.tamanho, 65));
      enviados += 1;
      if (enviados === o.pedacos) req.end();
      else setTimeout(mandar, o.intervaloMs);
    };
    mandar();
  });
}

before(async () => {
  process.env.REQUISICAO_TEMPO_TOTAL_MS = String(TOTAL_MS);
  process.env.ENVIO_OCIOSIDADE_MS = String(OCIOSIDADE_MS);
  servidor = await escutar(montarApp(), 0, '127.0.0.1');
  porta = (servidor.address() as AddressInfo).port;
});

after(async () => {
  servidor.closeAllConnections();
  await new Promise<void>((ok) => servidor.close(() => ok()));
  for (const [k, v] of [['REQUISICAO_TEMPO_TOTAL_MS', salvo.total], ['ENVIO_OCIOSIDADE_MS', salvo.ocio]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('prazo para receber o corpo', () => {
  it('padrões: 5 min no total, 60 s de ociosidade no envio; o servidor desliga o requestTimeout global e mantém o de cabeçalhos', () => {
    assert.equal(TEMPO_TOTAL_PADRAO_MS, 300_000);
    assert.equal(OCIOSIDADE_ENVIO_PADRAO_MS, 60_000);
    assert.equal(OPCOES_SERVIDOR_HTTP.requestTimeout, 0);
    assert.equal(servidor.requestTimeout, 0);
    assert.equal(servidor.headersTimeout, 60_000, 'cabeçalhos lentos continuam cortados pelo Node');
    const antes = { ...process.env };
    try {
      for (const v of ['', '0', '-1', 'abc']) {
        process.env.REQUISICAO_TEMPO_TOTAL_MS = v;
        process.env.ENVIO_OCIOSIDADE_MS = v;
        assert.equal(tempoTotalMs(), TEMPO_TOTAL_PADRAO_MS, `total com "${v}"`);
        assert.equal(ociosidadeEnvioMs(), OCIOSIDADE_ENVIO_PADRAO_MS, `ociosidade com "${v}"`);
      }
    } finally {
      process.env.REQUISICAO_TEMPO_TOTAL_MS = antes.REQUISICAO_TEMPO_TOTAL_MS;
      process.env.ENVIO_OCIOSIDADE_MS = antes.ENVIO_OCIOSIDADE_MS;
    }
  });

  it('rota comum: corpo que chega aos poucos além do total cai sem resposta (slow-loris)', async () => {
    // 10 blocos a cada 150 ms = 1,5 s, nenhuma pausa longa: só o total corta.
    const r = await enviarAosPoucos('/comum', { pedacos: 10, tamanho: 100, intervaloMs: 150 });
    assert.equal(r.fechadaSemResposta, true, JSON.stringify(r));
    assert.ok(r.ms >= TOTAL_MS - 50 && r.ms < TOTAL_MS + 600, `caiu em ${r.ms} ms (total ${TOTAL_MS})`);
  });

  it('rota comum: corpo dentro do total passa; GET sem corpo também', async () => {
    const r = await enviarAosPoucos('/comum', { pedacos: 3, tamanho: 100, intervaloMs: 100 });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.body.bytes, 300);
    const g = await fetch(`http://127.0.0.1:${porta}/leitura`);
    assert.equal(g.status, 200);
  });

  it('rota de envio: lenta porém estável passa do total sem ser cortada', async () => {
    // Mesmo ritmo do slow-loris acima, mas cada pausa (150 ms) fica abaixo da ociosidade.
    const r = await enviarAosPoucos('/envio', { pedacos: 10, tamanho: 100, intervaloMs: 150 });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.body.bytes, 1000);
    assert.ok(r.ms > TOTAL_MS, `levou ${r.ms} ms, mais que o total de ${TOTAL_MS} ms`);
  });

  it('rota de envio: parada por mais que a ociosidade é interrompida', async () => {
    const r = await enviarAosPoucos('/envio', { pedacos: 10, tamanho: 100, intervaloMs: 100, pararDepoisDe: 3 });
    assert.equal(r.status, 408, JSON.stringify(r));
    assert.equal(r.body.codigoErro, 'ENVIO_PARADO');
    // 3 blocos (~200 ms) + a ociosidade; bem antes de qualquer total.
    assert.ok(r.ms >= OCIOSIDADE_MS && r.ms < OCIOSIDADE_MS + 700, `parou em ${r.ms} ms`);
  });
});
