// Pentest automatizado — DIMENSAO envio lento (slow-loris) e o tempo de envio da analise de
// arquivos (Melhorias #18, decisao do Leo). Toda rota tem 5 min para receber o corpo (o
// `requestTimeout` do Node, reaplicado pelo middleware porque o servidor o desliga); so
// POST /arquivos/analise, depois de autenticar e reservar a vaga, troca o total por OCIOSIDADE:
// sobe devagar pelo tempo que precisar, mas sem nenhum byte por 60 s para com 408. Aqui os
// tempos vem do ambiente em fracoes de segundo (total 1 s, ociosidade 500 ms). O mecanismo
// isolado esta em tests/unidade/tempo-requisicao.test.ts; este arquivo confere a rota real.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { ADMIN, SENHA_CONTA, criarUsuario, encerrarServidor, iniciarServidor, login, prepararBanco, urlBase } from '../helpers.js';
import { lerInstream } from '../envioEmFluxo.js';

prepararBanco(import.meta.url);

const TOTAL_MS = 1000;
const OCIOSIDADE_MS = 500;
process.env.REQUISICAO_TEMPO_TOTAL_MS = String(TOTAL_MS);
process.env.ENVIO_OCIOSIDADE_MS = String(OCIOSIDADE_MS);

const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/db.js');

let clamd: Server;
let admin = '';

function falsoClamd(socket: Socket) {
  lerInstream(socket, () => socket.end('stream: OK\0'));
}

before(async () => {
  clamd = createServer(falsoClamd);
  await new Promise<void>((ok) => clamd.listen(0, '127.0.0.1', ok));
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = String((clamd.address() as AddressInfo).port);
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
});

after(async () => {
  delete process.env.REQUISICAO_TEMPO_TOTAL_MS;
  delete process.env.ENVIO_OCIOSIDADE_MS;
  await encerrarServidor();
  await new Promise<void>((ok) => clamd.close(() => ok()));
  await prisma.$disconnect();
});

type Resultado = { status?: number; body?: any; fechadaSemResposta?: boolean; ms: number };

/**
 * Envia um multipart com `pedacos` blocos de `tamanho` bytes, um a cada `intervaloMs`.
 * `pararDepoisDe` segura a conexao aberta depois de N blocos (cliente parado); `abortarDepoisDe`
 * derruba a conexao depois de N blocos (cliente que caiu). `caminho` padrao: a analise.
 */
function enviarAosPoucos(o: {
  token?: string;
  pedacos: number;
  tamanho: number;
  intervaloMs: number;
  pararDepoisDe?: number;
  abortarDepoisDe?: number;
  caminho?: string;
  corpoBruto?: boolean;
}): Promise<Resultado> {
  const inicio = Date.now();
  const fronteira = `----lento${randomBytes(8).toString('hex')}`;
  const cabeca = o.corpoBruto
    ? Buffer.alloc(0)
    : Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="arquivo"; filename="lento.txt"\r\nContent-Type: text/plain\r\n\r\n`);
  const fim = o.corpoBruto ? Buffer.alloc(0) : Buffer.from(`\r\n--${fronteira}--\r\n`);
  const total = cabeca.length + o.pedacos * o.tamanho + fim.length;
  const url = new URL(`${urlBase()}${o.caminho ?? '/arquivos/analise'}`);
  return new Promise((ok) => {
    let respondeu = false;
    const req = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
          'Content-Type': o.corpoBruto ? 'application/json' : `multipart/form-data; boundary=${fronteira}`,
          'Content-Length': total,
        },
      },
      (res) => {
        respondeu = true;
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { texto += c; });
        res.on('end', () => ok({ status: res.statusCode, body: texto ? JSON.parse(texto) : null, ms: Date.now() - inicio }));
        res.on('error', () => ok({ status: res.statusCode, body: texto ? JSON.parse(texto) : null, ms: Date.now() - inicio }));
      },
    );
    const semResposta = () => { if (!respondeu) ok({ fechadaSemResposta: true, ms: Date.now() - inicio }); };
    req.on('error', semResposta);
    req.on('close', semResposta);
    if (cabeca.length) req.write(cabeca);
    let enviados = 0;
    const mandar = () => {
      if (req.destroyed) return;
      if (o.abortarDepoisDe !== undefined && enviados >= o.abortarDepoisDe) return void req.destroy();
      if (o.pararDepoisDe !== undefined && enviados >= o.pararDepoisDe) return; // segura aberta
      req.write(Buffer.alloc(o.tamanho, 0x61));
      enviados += 1;
      if (enviados === o.pedacos) req.end(fim);
      else setTimeout(mandar, o.intervaloMs);
    };
    mandar();
  });
}

async function novoColaborador(prefixo: string) {
  const c = await criarUsuario(admin, 'Colaborador', prefixo);
  return { ...c, token: await login(c.email, SENHA_CONTA) };
}

/** Reservas de vaga do usuario (DT09) que ainda existem. */
async function reservas(userId: string) {
  const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "FileScanReserva" WHERE "userId" = ${userId}`;
  return n;
}

describe('envio lento: total nas rotas comuns, ociosidade só na análise de arquivos', () => {
  it('análise com envio lento porém estável passa do total e termina com 201', async () => {
    const c = await novoColaborador('lento.estavel');
    // 12 blocos a cada 150 ms = ~1,8 s, acima do total (1 s), com pausas abaixo da ociosidade.
    const r = await enviarAosPoucos({ token: c.token, pedacos: 12, tamanho: 1000, intervaloMs: 150 });
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.equal(r.body.dados.tamanho, 12_000);
    assert.equal(r.body.dados.resultado, 'LIMPO');
    assert.ok(r.ms > TOTAL_MS, `levou ${r.ms} ms, mais que o total de ${TOTAL_MS} ms`);
  });

  it('análise parada por mais que a ociosidade: 408 ENVIO_PARADO, nada registrado e a vaga volta', async () => {
    const c = await novoColaborador('lento.parado');
    const r = await enviarAosPoucos({ token: c.token, pedacos: 12, tamanho: 1000, intervaloMs: 100, pararDepoisDe: 3 });
    assert.equal(r.status, 408, JSON.stringify(r));
    assert.equal(r.body.codigoErro, 'ENVIO_PARADO');
    assert.match(r.body.mensagem, /parado/);
    assert.ok(r.ms < TOTAL_MS + OCIOSIDADE_MS, `parou em ${r.ms} ms`);
    assert.equal(await prisma.fileScan.count({ where: { userId: c.id } }), 0);
    assert.equal(await reservas(c.id), 0, 'a vaga do limite por hora foi devolvida');
  });

  it('conexão que cai no meio do envio: a análise é abandonada e a vaga volta na hora', async () => {
    const c = await novoColaborador('lento.caiu');
    const r = await enviarAosPoucos({ token: c.token, pedacos: 12, tamanho: 1000, intervaloMs: 50, abortarDepoisDe: 3 });
    assert.equal(r.fechadaSemResposta, true);
    // Antes ficava pendurada esperando o resto (e a vaga, presa até a reserva vencer: 15 min).
    let n = 1;
    for (let i = 0; i < 40 && n > 0; i++) {
      await new Promise((ok) => setTimeout(ok, 50));
      n = await reservas(c.id);
    }
    assert.equal(n, 0, 'reserva devolvida');
    assert.equal(await prisma.fileScan.count({ where: { userId: c.id } }), 0);
  });

  it('sem login, a rota de análise não ganha a ociosidade: o corpo lento cai no total', async () => {
    const r = await enviarAosPoucos({ pedacos: 30, tamanho: 100, intervaloMs: 100 });
    // O 401 sai logo (antes de ler o corpo); o resto do corpo lento continua sujeito ao total.
    assert.equal(r.status, 401, JSON.stringify(r));
    assert.equal(r.body.codigoErro, 'TOKEN_AUSENTE');
  });

  it('rota comum (POST /login) com corpo lento além do total: a conexão cai sem resposta', async () => {
    const r = await enviarAosPoucos({ caminho: '/login', corpoBruto: true, pedacos: 20, tamanho: 10, intervaloMs: 100 });
    assert.equal(r.fechadaSemResposta, true, JSON.stringify(r));
    assert.ok(r.ms >= TOTAL_MS - 50 && r.ms < TOTAL_MS + 800, `caiu em ${r.ms} ms (total ${TOTAL_MS})`);
  });
});
