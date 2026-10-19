// Pentest automatizado — DIMENSAO vaga da analise de arquivos sem prazo total (Melhorias #18).
// Sem prazo total no envio (so ociosidade), a vaga reservada (FileScanReserva) precisa de um
// heartbeat: o `criadoEm` e renovado a cada intervalo enquanto o envio ou a varredura estao em
// curso, e a validade e de poucos intervalos. Aqui: reserva antiga com o envio aberto continua
// contando (limite e exclusao da campanha), orfa libera a vaga sozinha, o teto absoluto corta o
// envio e, em todo desfecho, nenhum UPDATE na reserva depois da resposta. Tempos do ambiente em
// fracoes de segundo: renovacao a cada 200 ms (validade = 5 x 200 ms = 1 s).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import {
  ADMIN, ANALISTA, SENHA_CONTA, chamar, criarUsuario, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco, urlBase,
} from '../helpers.js';
import { enviarArquivoEmFluxo, lerInstream } from '../envioEmFluxo.js';

prepararBanco(import.meta.url);

const RENOVACAO_MS = 200;
process.env.RESERVA_RENOVACAO_MS = String(RENOVACAO_MS);
process.env.ENVIO_OCIOSIDADE_MS = '4000';
process.env.ENVIO_TETO_MS = '3000';

const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/db.js');
const { validadeReservaAnaliseMs, LIMITE_ANALISES_SIMULTANEAS, LIMITE_ARQUIVO_BYTES } = await import('../../src/models/analiseArquivo.model.js');

let clamd: Server;
let portaClamd = '';
let admin = '';
let analista = '';

before(async () => {
  clamd = createServer((socket: Socket) => lerInstream(socket, () => socket.end('stream: OK\0')));
  await new Promise<void>((ok) => clamd.listen(0, '127.0.0.1', ok));
  portaClamd = String((clamd.address() as AddressInfo).port);
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_PORT = portaClamd;
  // Registro de TODO UPDATE em FileScanReserva (por instrucao: conta ate o que nao acha linha),
  // so neste banco de teste descartavel; nao e migration.
  await prisma.$executeRawUnsafe('CREATE TABLE teste_renovacao (em timestamptz NOT NULL)');
  await prisma.$executeRawUnsafe(`CREATE FUNCTION teste_registrar_renovacao() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO teste_renovacao VALUES (clock_timestamp()); RETURN NULL; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER teste_renovacao AFTER UPDATE ON "FileScanReserva"
    FOR EACH STATEMENT EXECUTE FUNCTION teste_registrar_renovacao()`);
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
});

after(async () => {
  for (const k of ['RESERVA_RENOVACAO_MS', 'ENVIO_OCIOSIDADE_MS', 'ENVIO_TETO_MS']) delete process.env[k];
  await encerrarServidor();
  await new Promise<void>((ok) => clamd.close(() => ok()));
  await prisma.$disconnect();
});

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
type Resposta = { status?: number; body?: any; fechadaSemResposta?: boolean };

/**
 * Envio multipart controlado pelo teste: `mandar` escreve bytes do arquivo, `terminar` fecha o
 * corpo, `abortar` derruba a conexao. `resposta` resolve quando a API responde (ou a conexao cai).
 */
function abrirEnvio(token: string, tamanho: number, query = '') {
  const fronteira = `----hb${randomBytes(8).toString('hex')}`;
  const cabeca = Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="arquivo"; filename="hb.txt"\r\nContent-Type: text/plain\r\n\r\n`);
  const fim = Buffer.from(`\r\n--${fronteira}--\r\n`);
  const url = new URL(`${urlBase()}/arquivos/analise${query}`);
  let respondeu = false;
  let req!: ReturnType<typeof request>;
  const resposta = new Promise<Resposta>((ok) => {
    req = request(
      {
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${fronteira}`,
          'Content-Length': cabeca.length + tamanho + fim.length,
        },
      },
      (res) => {
        respondeu = true;
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => { texto += c; });
        const terminar = () => ok({ status: res.statusCode, body: texto ? JSON.parse(texto) : null });
        res.on('end', terminar);
        res.on('error', terminar);
      },
    );
    const sem = () => { if (!respondeu) ok({ fechadaSemResposta: true }); };
    req.on('error', sem);
    req.on('close', sem);
    req.write(cabeca);
  });
  let enviados = 0;
  return {
    resposta,
    mandar(n: number) {
      req.write(Buffer.alloc(n, 0x62));
      enviados += n;
    },
    terminar() {
      if (enviados < tamanho) req.write(Buffer.alloc(tamanho - enviados, 0x62));
      req.end(fim);
    },
    abortar() {
      req.destroy();
    },
  };
}

async function novoColaborador(prefixo: string) {
  const c = await criarUsuario(admin, 'Colaborador', prefixo);
  return { ...c, token: await login(c.email, SENHA_CONTA) };
}

async function reservasDe(userId: string) {
  return prisma.fileScanReserva.findMany({ where: { userId } });
}

/** Espera ate `cond` valer (no maximo `ms`). */
async function ate(cond: () => Promise<boolean>, ms = 3000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (await cond()) return true;
    await esperar(50);
  }
  return cond();
}

/** Instante do banco agora (a mesma origem do registro de UPDATE). */
async function agoraNoBanco(): Promise<Date> {
  const [{ t }] = await prisma.$queryRaw<Array<{ t: Date }>>`SELECT clock_timestamp() AS t`;
  return t;
}

async function renovacoesDepoisDe(t: Date): Promise<number> {
  const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM teste_renovacao WHERE em > ${t}`;
  return n;
}

describe('heartbeat da reserva da análise de arquivos', () => {
  it('validade derivada do intervalo: 5 renovações (aqui 5 × 200 ms)', () => {
    assert.equal(validadeReservaAnaliseMs(), RENOVACAO_MS * 5);
  });

  it('reserva de 16 min atrás com o envio aberto é renovada: continua contando no limite e segurando a exclusão da campanha', async () => {
    const c = await novoColaborador('hb.aberto');
    const camp = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Heartbeat', destinatarios: [c.email], template: 'urgencia' } });
    assert.equal(camp.status, 201, JSON.stringify(camp.body));
    const idCampanha = camp.body.dados.idCampanha;
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: idCampanha } });

    const a = abrirEnvio(c.token, 3000, `?eventoCampanha=${evento.id}`);
    a.mandar(1000);
    assert.ok(await ate(async () => (await reservasDe(c.id)).length === 1), 'a reserva existe');
    const [reserva] = await reservasDe(c.id);
    // Como se o envio estivesse aberto há 16 min (bem além da validade): o heartbeat traz de volta.
    const antiga = new Date(Date.now() - 16 * 60_000);
    await prisma.$executeRaw`UPDATE "FileScanReserva" SET "criadoEm" = ${antiga.toISOString()}::timestamp(3) WHERE "id" = ${reserva.id}`;
    assert.ok(
      await ate(async () => (await prisma.fileScanReserva.findUniqueOrThrow({ where: { id: reserva.id } })).criadoEm > new Date(Date.now() - validadeReservaAnaliseMs())),
      'o heartbeat renovou o criadoEm',
    );
    await esperar(RENOVACAO_MS * 3);
    // Continua contando: com a segunda aberta, a terceira é recusada (no máximo 2 simultâneas).
    const b = abrirEnvio(c.token, 3000);
    b.mandar(1000);
    assert.ok(await ate(async () => (await reservasDe(c.id)).length === LIMITE_ANALISES_SIMULTANEAS));
    const terceira = await chamar('POST', '/arquivos/analise', { token: c.token, body: {} });
    esperaErro(terceira, 429, 'ANALISES_SIMULTANEAS');
    // E segura a exclusão da campanha (sem o heartbeat, a reserva de 16 min já não contaria).
    esperaErro(await chamar('DELETE', `/campanhas/${idCampanha}`, { token: analista }), 409, 'CAMPANHA_COM_ANALISES');
    // A reserva nunca é contada duas vezes: terminados os dois, os dois viram FileScan e nada sobra.
    a.terminar();
    b.terminar();
    const [ra, rb] = await Promise.all([a.resposta, b.resposta]);
    assert.equal(ra.status, 201, JSON.stringify(ra));
    assert.equal(rb.status, 201, JSON.stringify(rb));
    assert.equal(await prisma.fileScan.count({ where: { userId: c.id } }), 2);
    assert.equal((await reservasDe(c.id)).length, 0);
  });

  it('duas órfãs sem heartbeat (API reiniciada no meio): seguram a vaga só até a validade, depois o próximo envio passa', async () => {
    const c = await novoColaborador('hb.orfas');
    const agora = new Date();
    await prisma.fileScanReserva.createMany({
      data: [0, 1].map(() => ({ id: randomUUID(), userId: c.id, campaignEventId: null, criadoEm: agora })),
    });
    const r1 = abrirEnvio(c.token, 10);
    r1.terminar();
    const recusa = await r1.resposta;
    assert.equal(recusa.status, 429, JSON.stringify(recusa));
    assert.equal(recusa.body.codigoErro, 'ANALISES_SIMULTANEAS');
    await esperar(validadeReservaAnaliseMs() + 300);
    const r2 = abrirEnvio(c.token, 10);
    r2.terminar();
    const passou = await r2.resposta;
    assert.equal(passou.status, 201, JSON.stringify(passou));
    assert.equal((await reservasDe(c.id)).length, 0, 'as órfãs vencidas foram podadas');
  });

  it('teto absoluto do envio: lento porém sem parar, é cortado no teto com 408 ENVIO_TEMPO_MAXIMO e a vaga volta', async () => {
    const c = await novoColaborador('hb.teto');
    const e = abrirEnvio(c.token, 100_000);
    const inicio = Date.now();
    // Um bloco a cada 300 ms: nunca fica ocioso (4 s), mas passa do teto (3 s).
    const ritmo = setInterval(() => e.mandar(100), 300);
    const r = await e.resposta;
    clearInterval(ritmo);
    const ms = Date.now() - inicio;
    assert.equal(r.status, 408, JSON.stringify(r));
    assert.equal(r.body.codigoErro, 'ENVIO_TEMPO_MAXIMO');
    assert.match(r.body.mensagem, /tempo máximo/);
    assert.ok(ms >= 3000 && ms < 4500, `cortado em ${ms} ms (teto 3000 ms)`);
    assert.equal((await reservasDe(c.id)).length, 0);
    assert.equal(await prisma.fileScan.count({ where: { userId: c.id } }), 0);
  });

  it('o heartbeat para em todo desfecho: nenhum UPDATE na reserva depois da resposta', async () => {
    // Controle positivo: um envio de ~1 s renova algumas vezes enquanto está aberto.
    const c = await novoColaborador('hb.desfechos');
    const t0 = await agoraNoBanco();
    const lento = abrirEnvio(c.token, 1000);
    for (let i = 0; i < 5; i++) {
      lento.mandar(100);
      await esperar(RENOVACAO_MS);
    }
    lento.terminar();
    const ok = await lento.resposta;
    assert.equal(ok.status, 201, JSON.stringify(ok));
    assert.ok((await renovacoesDepoisDe(t0)) >= 2, 'renovou durante o envio');

    const desfechos: Array<[string, () => Promise<Resposta | 'sem resposta'>]> = [
      ['sucesso', async () => { const e = abrirEnvio(c.token, 100); e.mandar(50); await esperar(RENOVACAO_MS * 2); e.terminar(); return e.resposta; }],
      ['408 envio parado', async () => {
        process.env.ENVIO_OCIOSIDADE_MS = '500';
        try { const e = abrirEnvio(c.token, 1000); e.mandar(100); return await e.resposta; } finally { process.env.ENVIO_OCIOSIDADE_MS = '4000'; }
      }],
      ['413 arquivo grande', () => enviarArquivoEmFluxo({ token: c.token, tamanho: LIMITE_ARQUIVO_BYTES + 1 })],
      ['503 antivírus fora', async () => {
        process.env.CLAMAV_PORT = '1';
        try { const e = abrirEnvio(c.token, 100); e.mandar(50); await esperar(RENOVACAO_MS * 2); e.terminar(); return await e.resposta; } finally { process.env.CLAMAV_PORT = portaClamd; }
      }],
      ['503 veredito antes do fim (DT26)', async () => {
        const precoce = createServer({ allowHalfOpen: true }, (s) => {
          s.once('data', () => s.write('stream: OK\0'));
          s.on('data', () => undefined);
          s.on('end', () => s.end());
        });
        await new Promise<void>((ok2) => precoce.listen(0, '127.0.0.1', ok2));
        process.env.CLAMAV_PORT = String((precoce.address() as AddressInfo).port);
        try {
          const e = abrirEnvio(c.token, 100);
          e.mandar(50);
          await esperar(RENOVACAO_MS * 2);
          e.terminar();
          return await e.resposta;
        } finally {
          process.env.CLAMAV_PORT = portaClamd;
          await new Promise<void>((ok2) => precoce.close(() => ok2()));
        }
      }],
      ['conexão caída', async () => {
        const e = abrirEnvio(c.token, 1000);
        e.mandar(100);
        await esperar(RENOVACAO_MS * 2);
        e.abortar();
        await e.resposta;
        // Sem resposta para medir: o desfecho é a vaga sumir.
        assert.ok(await ate(async () => (await reservasDe(c.id)).length === 0), 'vaga devolvida');
        return 'sem resposta';
      }],
    ];
    const esperado: Record<string, number | null> = {
      sucesso: 201, '408 envio parado': 408, '413 arquivo grande': 413, '503 antivírus fora': 503,
      '503 veredito antes do fim (DT26)': 503, 'conexão caída': null,
    };
    for (const [nome, executar] of desfechos) {
      const r = await executar();
      if (r !== 'sem resposta') assert.equal(r.status, esperado[nome], `${nome}: ${JSON.stringify(r)}`);
      const fim = await agoraNoBanco();
      await esperar(RENOVACAO_MS * 5);
      assert.equal(await renovacoesDepoisDe(fim), 0, `${nome}: UPDATE na reserva depois do desfecho`);
      assert.equal((await reservasDe(c.id)).length, 0, `${nome}: nenhuma reserva sobrou`);
    }
  });
});
