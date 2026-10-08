// B29 (RNF-002) — trilha de auditoria encadeada por hash, com verificacao de integridade
// (detecta adulteracao) e retencao de 12 meses. Cobre o encadeamento no banco (migration
// auditoria_cadeia_hash), a verificacao GET /auditoria/integridade e a retencao
// POST /auditoria/retencao. Banco isolado (ver helpers.ts).
//
// A adulteracao e simulada direto no banco. Se a trava (migration auditoria_imutavel, branch
// feat/b29-trava) existir, `semTrava` a desliga so dentro da transacao, como o dono da tabela
// pode fazer: a cadeia de hash e que denuncia a mudanca.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ADMIN, ANALISTA, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { registrarAuditoria } = await import('../src/services/auditoria.service.js');

let admin: string;
let analista: string;
let colaborador: string;

/** Instante de `meses` meses (e `dias` dias) atras, em UTC. */
function atras(meses: number, dias = 0): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - meses);
  d.setUTCDate(d.getUTCDate() - dias);
  return d;
}

/** Serializacao canonica documentada (migration auditoria_cadeia_hash e README), refeita no teste. */
function hashDocumentado(r: { hashAnterior: string | null; id: string; usuarioId: string | null; acao: string; detalhe: string | null; timestamp: Date }) {
  const campo = (v: string | null) => (v === null ? '-' : `${Buffer.byteLength(v, 'utf8')}:${v}`);
  const msg = ['baluarte-auditoria-v1', ...[r.hashAnterior, r.id, r.usuarioId, r.acao, r.detalhe, r.timestamp.toISOString()].map(campo)].join('|');
  return createHash('sha256').update(msg, 'utf8').digest('hex');
}

const cadeia = () => prisma.auditLog.findMany({ orderBy: { sequencia: 'asc' } });

async function integridade() {
  const r = await chamar('GET', '/auditoria/integridade', { token: admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados as {
    integra: boolean;
    registrosVerificados: number;
    travaNoBanco: boolean;
    primeiraQuebra?: { id: string; timestamp: string; motivo: string };
  };
}

/**
 * Executa SQL com a trava (se existir) e, se pedido, o encadeamento desligados, so nesta
 * transacao. Funciona com e sem a migration auditoria_imutavel.
 */
async function semTrava(sql: ReturnType<typeof prisma.$executeRaw>[], tambemEncadear = false) {
  const desejados = ['AuditLog_somente_insercao', ...(tambemEncadear ? ['AuditLog_encadear'] : [])];
  const existentes = await prisma.$queryRaw<{ tgname: string }[]>`
    SELECT tgname FROM pg_trigger WHERE tgrelid = '"AuditLog"'::regclass AND tgname = ANY(${desejados})`;
  const gatilhos = existentes.map((t) => `"${t.tgname}"`);
  return prisma.$transaction([
    ...gatilhos.map((g) => prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER ${g}`)),
    ...sql,
    ...gatilhos.map((g) => prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER ${g}`)),
  ]);
}

let antigos: string[] = [];
let recente: string;
let antigoForaDeOrdem: string;

before(async () => {
  // O seed nao grava auditoria: os primeiros elos da cadeia sao os antigos abaixo, para a
  // retencao ter um prefixo com mais de 12 meses.
  assert.equal(await prisma.auditLog.count(), 0, 'esperava a trilha vazia depois do seed');
  for (const quando of [atras(14), atras(13), atras(12, 2)]) {
    antigos.push((await prisma.auditLog.create({ data: { acao: 'ANTIGO_B29', detalhe: quando.toISOString(), timestamp: quando } })).id);
  }
  recente = (await prisma.auditLog.create({ data: { acao: 'RECENTE_B29', timestamp: atras(11) } })).id;
  // Antigo, mas gravado depois de um recente: nao faz parte do prefixo e espera.
  antigoForaDeOrdem = (await prisma.auditLog.create({ data: { acao: 'ANTIGO_FORA_DE_ORDEM_B29', timestamp: atras(20) } })).id;

  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

describe('B29: encadeamento por hash (trigger de INSERT)', () => {
  it('o hash gravado segue a serialização canônica documentada e o primeiro elo não tem anterior', async () => {
    const linhas = await cadeia();
    assert.equal(linhas[0].hashAnterior, null, 'início da cadeia');
    for (let i = 0; i < linhas.length; i++) {
      assert.equal(linhas[i].hash, hashDocumentado(linhas[i]), `hash do registro ${linhas[i].id}`);
      if (i > 0) assert.equal(linhas[i].hashAnterior, linhas[i - 1].hash, `elo do registro ${linhas[i].id}`);
    }
  });

  it('acentos, separador e campos nulos entram na conta sem ambiguidade', async () => {
    const r = await prisma.auditLog.create({ data: { usuarioId: null, acao: 'AÇÃO_B29', detalhe: 'ação ✓ | 3:x' } });
    assert.equal(r.hash, hashDocumentado(r));
  });

  it('sequencia, hash e hashAnterior mandados pela aplicação são ignorados', async () => {
    const ultimo = (await cadeia()).at(-1)!;
    const r = await prisma.auditLog.create({ data: { acao: 'FORJA_B29', hash: 'forjado', hashAnterior: 'forjado', sequencia: 1n } });
    assert.notEqual(r.hash, 'forjado');
    assert.equal(r.hashAnterior, ultimo.hash);
    assert.ok(r.sequencia > ultimo.sequencia);
  });

  it('gravações concorrentes não bifurcam a cadeia', async () => {
    const antes = await prisma.auditLog.count();
    await Promise.all([
      ...Array.from({ length: 40 }, (_, i) => registrarAuditoria(null, 'CONCORRENTE_B29', String(i))),
      ...Array.from({ length: 10 }, (_, i) => prisma.auditLog.create({ data: { acao: 'CONCORRENTE_B29', detalhe: `direto ${i}` } })),
    ]);
    assert.equal(await prisma.auditLog.count(), antes + 50, 'nenhuma gravação perdida');
    const linhas = await cadeia();
    for (let i = 1; i < linhas.length; i++) assert.equal(linhas[i].hashAnterior, linhas[i - 1].hash, `elo ${i}`);
    assert.equal(new Set(linhas.map((l) => l.hashAnterior)).size, linhas.length, 'nenhum anterior repetido');
    const v = await integridade();
    assert.equal(v.integra, true, JSON.stringify(v));
    assert.equal(v.registrosVerificados, linhas.length);
  });

  it('a verificação percorre mais de um lote (1000) sem quebra', async () => {
    await prisma.auditLog.createMany({ data: Array.from({ length: 1100 }, (_, i) => ({ acao: 'LOTE_B29', detalhe: String(i) })) });
    const v = await integridade();
    assert.equal(v.integra, true);
    assert.equal(v.registrosVerificados, await prisma.auditLog.count());
    assert.ok(v.registrosVerificados > 1000);
  });
});

describe('B29: verificação acusa adulteração', () => {
  it('registro alterado: quebra no próprio registro (CONTEUDO_ALTERADO)', async () => {
    const alvo = (await prisma.auditLog.findMany({ where: { acao: 'CONCORRENTE_B29' }, orderBy: { sequencia: 'asc' }, take: 3 }))[2];
    await semTrava([prisma.$executeRaw`UPDATE "AuditLog" SET "detalhe" = 'adulterado' WHERE "id" = ${alvo.id}`]);
    let v = await integridade();
    assert.equal(v.integra, false);
    assert.deepEqual(v.primeiraQuebra, { id: alvo.id, timestamp: alvo.timestamp.toISOString(), motivo: 'CONTEUDO_ALTERADO' });
    assert.ok(v.registrosVerificados < (await prisma.auditLog.count()), 'para na primeira quebra');

    await semTrava([prisma.$executeRaw`UPDATE "AuditLog" SET "detalhe" = ${alvo.detalhe} WHERE "id" = ${alvo.id}`]);
    v = await integridade();
    assert.equal(v.integra, true, 'conteúdo restaurado volta a conferir');
  });

  it('registro alterado com o hash refeito: quebra no seguinte (ELO_QUEBRADO)', async () => {
    const [alvo, seguinte] = await prisma.auditLog.findMany({ where: { acao: 'CONCORRENTE_B29' }, orderBy: { sequencia: 'asc' }, take: 2, skip: 5 });
    const linhas = await cadeia();
    assert.equal(linhas[linhas.findIndex((l) => l.id === alvo.id) + 1].id, seguinte.id, 'registros consecutivos');
    await semTrava([
      prisma.$executeRaw`UPDATE "AuditLog" SET "detalhe" = 'adulterado',
        "hash" = auditoria_calcular_hash("hashAnterior", "id", "usuarioId", "acao", 'adulterado', "timestamp")
        WHERE "id" = ${alvo.id}`,
    ]);
    let v = await integridade();
    assert.equal(v.integra, false);
    assert.equal(v.primeiraQuebra?.id, seguinte.id);
    assert.equal(v.primeiraQuebra?.motivo, 'ELO_QUEBRADO');

    await semTrava([prisma.$executeRaw`UPDATE "AuditLog" SET "detalhe" = ${alvo.detalhe}, "hash" = ${alvo.hash} WHERE "id" = ${alvo.id}`]);
    v = await integridade();
    assert.equal(v.integra, true);
  });

  it('registro apagado do meio: quebra no seguinte (ELO_QUEBRADO)', async () => {
    const [alvo, seguinte] = await prisma.auditLog.findMany({ where: { acao: 'LOTE_B29' }, orderBy: { sequencia: 'asc' }, take: 2, skip: 500 });
    await semTrava([prisma.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${alvo.id}`]);
    let v = await integridade();
    assert.equal(v.integra, false);
    assert.equal(v.primeiraQuebra?.id, seguinte.id);
    assert.equal(v.primeiraQuebra?.motivo, 'ELO_QUEBRADO');

    // Devolve a linha exatamente como era (com o encadeamento desligado, senao o trigger a regravaria no fim).
    await semTrava(
      [
        prisma.$executeRaw`INSERT INTO "AuditLog" ("id", "usuarioId", "acao", "detalhe", "timestamp", "sequencia", "hashAnterior", "hash")
          VALUES (${alvo.id}, ${alvo.usuarioId}, ${alvo.acao}, ${alvo.detalhe}, ${alvo.timestamp}, ${alvo.sequencia}, ${alvo.hashAnterior}, ${alvo.hash})`,
      ],
      true,
    );
    v = await integridade();
    assert.equal(v.integra, true);
  });

  it('registro sem hash (gravado sem o trigger): SEM_HASH', async () => {
    const ultimo = (await cadeia()).at(-1)!;
    await semTrava(
      [prisma.$executeRaw`INSERT INTO "AuditLog" ("id", "acao", "sequencia") VALUES ('sem-hash-b29', 'SEM_HASH_B29', ${ultimo.sequencia + 1n})`],
      true,
    );
    const v = await integridade();
    assert.equal(v.integra, false);
    assert.deepEqual([v.primeiraQuebra?.id, v.primeiraQuebra?.motivo], ['sem-hash-b29', 'SEM_HASH']);
    await semTrava([prisma.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = 'sem-hash-b29'`]);
    assert.equal((await integridade()).integra, true);
  });
});

describe('B29: retenção de 12 meses', () => {
  it('apaga só o prefixo com mais de 12 meses e a cadeia restante continua íntegra (âncora)', async () => {
    const r = await chamar('POST', '/auditoria/retencao', { token: admin });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dados.apagados, 3);
    assert.equal(r.body.dados.retencaoMeses, 12);
    const corte = Date.parse(r.body.dados.corte);
    assert.ok(Math.abs(corte - atras(12).getTime()) < 60_000, 'corte = agora - 12 meses');

    assert.equal(await prisma.auditLog.count({ where: { id: { in: antigos } } }), 0, 'os antigos do prefixo saíram');
    assert.ok(await prisma.auditLog.findUnique({ where: { id: recente } }), 'o de 11 meses ficou');
    assert.ok(await prisma.auditLog.findUnique({ where: { id: antigoForaDeOrdem } }), 'antigo depois de um recente espera');

    const primeiro = (await cadeia())[0];
    assert.equal(primeiro.id, recente);
    assert.notEqual(primeiro.hashAnterior, null, 'a âncora aponta para um registro que não existe mais');

    const registro = await prisma.auditLog.findFirst({ where: { acao: 'APLICAR_RETENCAO_AUDITORIA' }, orderBy: { sequencia: 'desc' } });
    assert.ok(registro, 'a retenção entra na trilha');
    assert.equal(registro.usuarioId, 'u-000');
    assert.match(registro.detalhe ?? '', /^3 registro\(s\) anteriores a .+ apagados \(retenção de 12 meses\); âncora [0-9a-f]{64}$/);
    assert.ok(registro.detalhe!.endsWith(primeiro.hashAnterior!));

    const v = await integridade();
    assert.equal(v.integra, true, 'sem falso positivo no primeiro elo depois da retenção');
    assert.equal(v.registrosVerificados, await prisma.auditLog.count());
  });

  it('a função de retenção recusa menos de 12 meses', async () => {
    await assert.rejects(prisma.$queryRaw`SELECT * FROM auditoria_aplicar_retencao(11)`, /12 meses/);
  });

  it('aplicar de novo não apaga nada', async () => {
    const r = await chamar('POST', '/auditoria/retencao', { token: admin });
    assert.equal(r.body.dados.apagados, 0);
    assert.equal((await integridade()).integra, true);
  });
});

describe('B29: RBAC das rotas novas', () => {
  for (const [metodo, rota] of [
    ['GET', '/auditoria/integridade'],
    ['POST', '/auditoria/retencao'],
  ] as const) {
    it(`${metodo} ${rota}: 401 sem token e com token inválido`, async () => {
      esperaErro(await chamar(metodo, rota), 401, 'TOKEN_AUSENTE');
      esperaErro(await chamar(metodo, rota, { token: 'x.y.z' }), 401, 'TOKEN_INVALIDO');
    });
    it(`${metodo} ${rota}: 403 para Analista e Colaborador`, async () => {
      const antes = await prisma.auditLog.count({ where: { acao: 'APLICAR_RETENCAO_AUDITORIA' } });
      esperaErro(await chamar(metodo, rota, { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
      esperaErro(await chamar(metodo, rota, { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
      assert.equal(await prisma.auditLog.count({ where: { acao: 'APLICAR_RETENCAO_AUDITORIA' } }), antes);
    });
  }
});

// Sem a trava no banco (estado da main): a aplicacao nunca altera nem apaga, mas quem tem a
// connection string consegue. O banco aceita; a verificacao acusa. Na branch feat/b29-trava
// este bloco da lugar a tests/auditoria-trava.test.ts.
describe('B29: sem a trava, o banco aceita a alteração e a verificação acusa', () => {
  it('a política não afirma log imutável e a verificação informa a trava desligada', async () => {
    const r = await chamar('GET', '/configuracoes/seguranca', { token: colaborador });
    assert.deepEqual(r.body.dados.auditoria, { registraAcoes: true, logImutavel: false, retencaoMeses: 12 });
    assert.equal((await integridade()).travaNoBanco, false);
  });

  it('UPDATE direto pelo Prisma é aceito e a verificação aponta o registro certo', async () => {
    const alvo = (await prisma.auditLog.findMany({ where: { acao: 'LOTE_B29' }, orderBy: { sequencia: 'asc' }, take: 1, skip: 700 }))[0];
    await prisma.auditLog.update({ where: { id: alvo.id }, data: { detalhe: 'alterado sem trava' } });
    const v = await integridade();
    assert.equal(v.integra, false);
    assert.deepEqual(v.primeiraQuebra, { id: alvo.id, timestamp: alvo.timestamp.toISOString(), motivo: 'CONTEUDO_ALTERADO' });
    await prisma.auditLog.update({ where: { id: alvo.id }, data: { detalhe: alvo.detalhe } });
    assert.equal((await integridade()).integra, true);
  });
});
