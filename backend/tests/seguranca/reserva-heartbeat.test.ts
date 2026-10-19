// Pentest automatizado — DIMENSAO vaga da analise de arquivos sem prazo total (Melhorias #18).
// Sem prazo total no envio (so ociosidade), a vaga reservada (FileScanReserva) precisa de um
// heartbeat: o `criadoEm` e renovado a cada intervalo enquanto o envio ou a varredura estao em
// curso, e a validade e de poucos intervalos. Aqui: reserva antiga com o envio aberto continua
// contando (limite e exclusao da campanha), orfa libera a vaga sozinha, o teto absoluto corta o
// envio e, em todo desfecho, nenhum UPDATE na reserva depois da resposta. Tempos do ambiente em
// fracoes de segundo: renovacao a cada 200 ms (validade = 5 x 200 ms = 1 s).
//
// O teto (3 s) e a ociosidade (4 s) curtos valem SO dentro do teste do teto. Valendo para o
// arquivo inteiro, o envio aberto do teste "16 min atras" (3,3 s sem carga, 10 s com a maquina
// carregada) era cortado pelo proprio teto no meio: a vaga voltava e o teste falhava como 400 no
// lugar do 429, 408 no envio que devia dar 201 ou exclusao da campanha liberada (instavel, 4 em
// 30 rodadas sem carga). Fora dele valem os padroes de producao (60 s e 30 min).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import {
  ADMIN, ANALISTA, SENHA_CONTA, chamar, criarUsuario, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco, urlBase,
} from '../helpers.js';
import { enviarArquivoEmFluxo, lerInstream } from '../envioEmFluxo.js';
import { monitorEventLoopDelay } from 'node:perf_hooks';

prepararBanco(import.meta.url);

const RENOVACAO_MS = 200;
process.env.RESERVA_RENOVACAO_MS = String(RENOVACAO_MS);
/**
 * Intervalo dos testes que dependem de a renovacao chegar antes da validade ("16 min atras" e
 * "duas orfas"): validade de 5 s. Com 200 ms (validade de 1 s), uma unica consulta parada por
 * 2 s (conexao nova do pool via `localhost` no Windows, ver tests/helpers.ts) vencia uma reserva
 * viva. 5 s cobrem essa parada com folga e ainda sao fracoes do que o teste prova (16 min).
 */
const RENOVACAO_LONGA_MS = 1000;
const TETO_MS = 3000;
const OCIOSIDADE_NO_TETO_MS = 4000;

const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/db.js');
const { validadeReservaAnaliseMs, LIMITE_ANALISES_SIMULTANEAS, LIMITE_ARQUIVO_BYTES } = await import('../../src/models/analiseArquivo.model.js');

// Maior atraso do event loop do processo (API e teste rodam juntos): vai no diagnostico.
const laco = monitorEventLoopDelay({ resolution: 10 });
laco.enable();

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
  // Diagnostico das falhas: historia de cada linha (criada, renovada, apagada), com o criadoEm
  // gravado e o relogio do banco. Distingue a vaga devolvida (apagada nova) da podada (apagada
  // vencida) e mostra o intervalo real entre as renovacoes.
  await prisma.$executeRawUnsafe(`CREATE TABLE teste_linha (acao text NOT NULL, id text NOT NULL, "userId" text NOT NULL,
    "criadoEm" timestamp(3) NOT NULL, em timestamptz NOT NULL DEFAULT clock_timestamp(), pid int NOT NULL DEFAULT pg_backend_pid(),
    instrucao text NOT NULL DEFAULT left(current_query(), 60))`);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION teste_registrar_linha() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN INSERT INTO teste_linha VALUES (TG_OP, OLD."id", OLD."userId", OLD."criadoEm");
      ELSE INSERT INTO teste_linha VALUES (TG_OP, NEW."id", NEW."userId", NEW."criadoEm"); END IF;
      RETURN NULL;
    END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER teste_linha AFTER INSERT OR UPDATE OR DELETE ON "FileScanReserva"
    FOR EACH ROW EXECUTE FUNCTION teste_registrar_linha()`);
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

/**
 * Diagnostico para a mensagem de falha: idade de cada reserva do usuario pelo relogio do banco
 * (a mesma origem da reserva, do heartbeat e da comparacao), a validade, o ultimo UPDATE visto
 * pelo gatilho, a historia de cada linha e o maior atraso do event loop.
 */
async function diagnostico(userId: string): Promise<string> {
  const reservas = await prisma.$queryRaw<Array<{ id: string; idadeMs: number }>>`
    SELECT left("id", 8) AS id, (EXTRACT(EPOCH FROM (clock_timestamp() AT TIME ZONE 'UTC') - "criadoEm") * 1000)::int AS "idadeMs"
      FROM "FileScanReserva" WHERE "userId" = ${userId}`;
  const [{ ultimo }] = await prisma.$queryRaw<Array<{ ultimo: number | null }>>`
    SELECT (EXTRACT(EPOCH FROM clock_timestamp() - max(em)) * 1000)::int AS ultimo FROM teste_renovacao`;
  // Por linha: idade com que nasceu (perto de 0: o criadoEm e o instante em que passou a
  // existir), renovacoes, maior intervalo entre elas e, se apagada, a idade do criadoEm no
  // instante do DELETE (perto de 0 = vaga devolvida; acima da validade = podada por vencida).
  const linhas = await prisma.$queryRaw<Array<{ id: string; nasceuComIdadeMs: number | null; renovacoes: number; maiorIntervaloMs: number | null; apagadaComIdadeMs: number | null }>>`
    WITH h AS (
      SELECT id, acao, em, "criadoEm", em - lag(em) OVER (PARTITION BY id ORDER BY em) AS dt FROM teste_linha WHERE "userId" = ${userId}
    )
    SELECT left(id, 8) AS id,
           (SELECT (EXTRACT(EPOCH FROM (i.em AT TIME ZONE 'UTC') - i."criadoEm") * 1000)::int
              FROM teste_linha i WHERE i.id = h.id AND i.acao = 'INSERT') AS "nasceuComIdadeMs",
           (SELECT to_char(i.em AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') FROM teste_linha i WHERE i.id = h.id AND i.acao = 'INSERT') AS "inseridaAs",
           (count(*) FILTER (WHERE acao = 'UPDATE'))::int AS renovacoes,
           (EXTRACT(EPOCH FROM max(dt) FILTER (WHERE acao = 'UPDATE')) * 1000)::int AS "maiorIntervaloMs",
           (SELECT (EXTRACT(EPOCH FROM (d.em AT TIME ZONE 'UTC') - d."criadoEm") * 1000)::int
              FROM teste_linha d WHERE d.id = h.id AND d.acao = 'DELETE') AS "apagadaComIdadeMs"
      FROM h GROUP BY id ORDER BY min(em)`;
  const atrasoMaxLoopMs = Math.round(laco.max / 1e6);
  const apagadas = await prisma.$queryRaw<Array<{ id: string; pid: number; instrucao: string }>>`
    SELECT left(id, 8) AS id, pid, instrucao FROM teste_linha WHERE "userId" = ${userId} AND acao = 'DELETE'`;
  const sessoes = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT pid, state, wait_event_type AS "tipoEspera", wait_event AS espera,
           (EXTRACT(EPOCH FROM clock_timestamp() - xact_start) * 1000)::int AS "transacaoMs", left(query, 70) AS q
      FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'`;
  return JSON.stringify({ reservas, validadeMs: validadeReservaAnaliseMs(), msDesdeUltimoUpdate: ultimo, linhas, apagadas, sessoes, atrasoMaxLoopMs });
}

/** Resposta + diagnostico, para a falha dizer a causa (status, corpo, codigo, idades). */
async function explicar(r: { status?: number; body?: any }, userId: string, extra: Record<string, unknown> = {}) {
  return `status=${r.status} codigo=${r.body?.codigoErro} corpo=${JSON.stringify(r.body)} ${JSON.stringify(extra)} ${await diagnostico(userId)}`;
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
    process.env.RESERVA_RENOVACAO_MS = String(RENOVACAO_LONGA_MS);
    const c = await novoColaborador('hb.aberto');
    const camp = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Heartbeat', destinatarios: [c.email], template: 'urgencia' } });
    assert.equal(camp.status, 201, JSON.stringify(camp.body));
    const idCampanha = camp.body.dados.idCampanha;
    const evento = await prisma.campaignEvent.findFirstOrThrow({ where: { campaignId: idCampanha } });

    const a = abrirEnvio(c.token, 3000, `?eventoCampanha=${evento.id}`);
    let b: ReturnType<typeof abrirEnvio> | undefined;
    // Se o envio acabar antes da hora (408, 503...), a falha mostra com que resposta.
    const fim: Record<string, Resposta> = {};
    void a.resposta.then((r) => { fim.a = r; });
    try {
      a.mandar(1000);
      assert.ok(await ate(async () => (await reservasDe(c.id)).length === 1), 'a reserva existe');
      const [reserva] = await reservasDe(c.id);
      // Como se o envio estivesse aberto há 16 min (bem além da validade): o heartbeat traz de volta.
      const antiga = new Date(Date.now() - 16 * 60_000);
      await prisma.$executeRaw`UPDATE "FileScanReserva" SET "criadoEm" = ${antiga.toISOString()}::timestamp(3) WHERE "id" = ${reserva.id}`;
      assert.ok(
        await ate(
          async () => (await prisma.fileScanReserva.findUniqueOrThrow({ where: { id: reserva.id } })).criadoEm.getTime() > (await agoraNoBanco()).getTime() - validadeReservaAnaliseMs(),
          RENOVACAO_LONGA_MS * 3,
        ),
        'o heartbeat renovou o criadoEm',
      );
      await esperar(RENOVACAO_LONGA_MS * 3);
      // Continua contando: com a segunda aberta, a terceira é recusada (no máximo 2 simultâneas).
      b = abrirEnvio(c.token, 3000);
      void b.resposta.then((r) => { fim.b = r; });
      b.mandar(1000);
      assert.ok(await ate(async () => (await reservasDe(c.id)).length === LIMITE_ANALISES_SIMULTANEAS), `as duas contam: ${await diagnostico(c.id)} ${JSON.stringify(fim)}`);
      const duasVistasAs = (await agoraNoBanco()).toISOString().slice(11, 23);
      const terceira = await chamar('POST', '/arquivos/analise', { token: c.token, body: {} });
      assert.equal(terceira.status, 429, `${await explicar(terceira, c.id, { duasVistasAs })} ${JSON.stringify(fim)}`);
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
    } finally {
      // Falhou no meio: derruba os envios, senao os heartbeats deles seguem e contaminam o
      // teste "nenhum UPDATE depois da resposta".
      a.abortar();
      b?.abortar();
      await ate(async () => (await reservasDe(c.id)).length === 0);
      process.env.RESERVA_RENOVACAO_MS = String(RENOVACAO_MS);
    }
  });

  it('reserva que esperou a trava do usuário nasce com o instante em que passa a existir, não com o de antes da trava', async () => {
    // Atraso injetado de forma deterministica: o teste segura a trava de reserva do usuario
    // (a mesma de reservarVaga) por mais que a validade. O envio chega, espera a trava e so
    // entao grava a reserva. Com o instante lido antes da trava, ela nascia ja vencida (1,5 s
    // de idade com validade de 1 s): nao contava para a proxima e era podada antes do primeiro
    // heartbeat (o 400 no lugar do 429 visto na suite inteira, com o banco lento).
    const c = await novoColaborador('hb.trava');
    const TRAVA_MS = validadeReservaAnaliseMs() + 500;
    let travou!: () => void;
    const travada = new Promise<void>((ok) => { travou = ok; });
    let liberadaEm = 0;
    const segurando = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('baluarte.FileScanReserva'), hashtext(${c.id}))`;
      travou();
      await esperar(TRAVA_MS);
      liberadaEm = (await agoraNoBanco()).getTime();
    }, { timeout: TRAVA_MS + 10_000 });
    await travada;
    const e = abrirEnvio(c.token, 1000);
    e.mandar(100);
    try {
      await segurando;
      assert.ok(await ate(async () => (await reservasDe(c.id)).length === 1, 5000), `a reserva existe: ${await diagnostico(c.id)}`);
      // O criadoEm com que a linha foi gravada (o gatilho guarda, antes de qualquer renovacao).
      const [nasceu] = await prisma.$queryRaw<Array<{ criadoEm: Date }>>`
        SELECT "criadoEm" FROM teste_linha WHERE "userId" = ${c.id} AND acao = 'INSERT'`;
      const antesDaLiberacaoMs = liberadaEm - nasceu.criadoEm.getTime();
      assert.ok(
        antesDaLiberacaoMs < 100,
        `a reserva nasceu ${antesDaLiberacaoMs} ms antes de a trava sair (trava de ${TRAVA_MS} ms, validade ${validadeReservaAnaliseMs()} ms): ${await diagnostico(c.id)}`,
      );
      e.terminar();
      const r = await e.resposta;
      assert.equal(r.status, 201, JSON.stringify(r));
    } finally {
      e.abortar();
    }
  });

  it('duas órfãs sem heartbeat (API reiniciada no meio): seguram a vaga só até a validade, depois o próximo envio passa', async () => {
    const c = await novoColaborador('hb.orfas');
    process.env.RESERVA_RENOVACAO_MS = String(RENOVACAO_LONGA_MS);
    try {
      const agora = await agoraNoBanco();
      await prisma.fileScanReserva.createMany({
        data: [0, 1].map(() => ({ id: randomUUID(), userId: c.id, campaignEventId: null, criadoEm: agora })),
      });
      const r1 = abrirEnvio(c.token, 10);
      r1.terminar();
      const recusa = await r1.resposta;
      assert.equal(recusa.status, 429, await explicar(recusa, c.id));
      assert.equal(recusa.body.codigoErro, 'ANALISES_SIMULTANEAS');
      await esperar(validadeReservaAnaliseMs() + 300);
      const r2 = abrirEnvio(c.token, 10);
      r2.terminar();
      const passou = await r2.resposta;
      assert.equal(passou.status, 201, JSON.stringify(passou));
      assert.equal((await reservasDe(c.id)).length, 0, 'as órfãs vencidas foram podadas');
    } finally {
      process.env.RESERVA_RENOVACAO_MS = String(RENOVACAO_MS);
    }
  });

  it('teto absoluto do envio: lento porém sem parar, é cortado no teto com 408 ENVIO_TEMPO_MAXIMO e a vaga volta', async () => {
    const c = await novoColaborador('hb.teto');
    process.env.ENVIO_TETO_MS = String(TETO_MS);
    process.env.ENVIO_OCIOSIDADE_MS = String(OCIOSIDADE_NO_TETO_MS);
    let r: Resposta;
    let ms: number;
    let msDesdeAReserva: number;
    try {
      const inicio = Date.now();
      const e = abrirEnvio(c.token, 100_000);
      // Um bloco a cada 300 ms: nunca fica ocioso (4 s), mas passa do teto (3 s).
      const ritmo = setInterval(() => e.mandar(100), 300);
      // O teto e armado logo depois de autenticar e reservar a vaga (trocarPorOciosidade); a
      // reserva visivel no banco marca esse instante pelo lado de fora. Medir so do inicio do
      // pedido somava a autenticacao e a reserva, que sob carga passavam de 1 s.
      assert.ok(await ate(async () => (await reservasDe(c.id)).length === 1, 10_000), 'a reserva existe');
      const reservaVista = Date.now();
      r = await e.resposta;
      clearInterval(ritmo);
      ms = Date.now() - inicio;
      msDesdeAReserva = Date.now() - reservaVista;
    } finally {
      delete process.env.ENVIO_TETO_MS;
      delete process.env.ENVIO_OCIOSIDADE_MS;
    }
    const porque = await explicar(r, c.id, { ms, msDesdeAReserva });
    assert.equal(r.status, 408, porque);
    assert.equal(r.body.codigoErro, 'ENVIO_TEMPO_MAXIMO', porque);
    assert.match(r.body.mensagem, /tempo máximo/);
    // Nunca antes do teto (o teto nao comeca antes do pedido) e no maximo 1,5 s depois dele,
    // contado de quando a vaga ja estava reservada (o teto ja estava armado).
    assert.ok(ms >= TETO_MS, `cortado em ${ms} ms, antes do teto de ${TETO_MS} ms ${porque}`);
    assert.ok(msDesdeAReserva < TETO_MS + 1500, `cortado ${msDesdeAReserva} ms depois da reserva (teto ${TETO_MS} ms) ${porque}`);
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
        try { const e = abrirEnvio(c.token, 1000); e.mandar(100); return await e.resposta; } finally { delete process.env.ENVIO_OCIOSIDADE_MS; }
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
