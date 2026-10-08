// B29 (RNF-002), trava no banco — migration 20261008176000_auditoria_imutavel. Com ela, o
// AuditLog e imutavel no banco: UPDATE, DELETE e TRUNCATE recusados pelos triggers, com
// excecao so para a retencao de 12 meses (auditoria_aplicar_retencao). A cadeia de hash e a
// verificacao estao em auditoria-integridade.test.ts. Banco isolado (ver helpers.ts).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, chamar, encerrarServidor, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');

let admin: string;
let colaborador: string;

/** Instante de `meses` meses atras, em UTC. */
function atras(meses: number): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d;
}

const recusa = (e: { message?: string }) => /somente insercao/.test(e.message ?? '');

let antigos: string[] = [];
let recente: string;

before(async () => {
  assert.equal(await prisma.auditLog.count(), 0, 'esperava a trilha vazia depois do seed');
  for (const quando of [atras(14), atras(13)]) {
    antigos.push((await prisma.auditLog.create({ data: { acao: 'ANTIGO_TRAVA', timestamp: quando } })).id);
  }
  recente = (await prisma.auditLog.create({ data: { acao: 'RECENTE_TRAVA', timestamp: atras(11) } })).id;
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

async function integridade() {
  const r = await chamar('GET', '/auditoria/integridade', { token: admin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.dados as { integra: boolean; registrosVerificados: number; travaNoBanco: boolean };
}

describe('B29 trava: só inserção no banco', () => {
  it('UPDATE pelo Prisma falha', async () => {
    await assert.rejects(prisma.auditLog.update({ where: { id: recente }, data: { detalhe: 'x' } }), recusa);
    await assert.rejects(prisma.auditLog.updateMany({ data: { acao: 'X' } }), recusa);
    assert.equal((await prisma.auditLog.findUnique({ where: { id: recente } }))!.detalhe, null);
  });

  it('DELETE pelo Prisma falha, inclusive de registro com mais de 12 meses', async () => {
    await assert.rejects(prisma.auditLog.delete({ where: { id: recente } }), recusa);
    await assert.rejects(prisma.auditLog.delete({ where: { id: antigos[0] } }), recusa);
    await assert.rejects(prisma.auditLog.deleteMany(), recusa);
    assert.equal(await prisma.auditLog.count({ where: { id: { in: [...antigos, recente] } } }), 3);
  });

  it('TRUNCATE falha', async () => {
    await assert.rejects(prisma.$executeRawUnsafe('TRUNCATE "AuditLog"'), recusa);
  });

  it('a variável da retenção não libera registro com 12 meses ou menos', async () => {
    await assert.rejects(
      prisma.$transaction([
        prisma.$queryRaw`SELECT set_config('baluarte.retencao', 'on', true)`,
        prisma.$executeRaw`DELETE FROM "AuditLog" WHERE "id" = ${recente}`,
      ]),
      recusa,
    );
    assert.ok(await prisma.auditLog.findUnique({ where: { id: recente } }));
  });

  it('a política publica a trava só enquanto ela está ligada', async () => {
    const politica = async () => (await chamar('GET', '/configuracoes/seguranca', { token: colaborador })).body.dados.auditoria;
    assert.deepEqual(await politica(), { registraAcoes: true, logImutavel: true, retencaoMeses: 12 });
    assert.equal((await integridade()).travaNoBanco, true);
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_somente_insercao"');
    try {
      assert.equal((await politica()).logImutavel, false);
      assert.equal((await integridade()).travaNoBanco, false);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_somente_insercao"');
    }
    assert.equal((await politica()).logImutavel, true);
  });
});

describe('B29 trava: a retenção continua funcionando com a trava ligada', () => {
  it('POST /auditoria/retencao apaga os registros com mais de 12 meses e a cadeia segue íntegra', async () => {
    const r = await chamar('POST', '/auditoria/retencao', { token: admin });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dados.apagados, 2);
    assert.equal(await prisma.auditLog.count({ where: { id: { in: antigos } } }), 0);
    assert.ok(await prisma.auditLog.findUnique({ where: { id: recente } }));
    const v = await integridade();
    assert.equal(v.integra, true);
    assert.equal(v.travaNoBanco, true);
  });

  it('fora da função de retenção a exclusão continua recusada', async () => {
    await assert.rejects(prisma.auditLog.deleteMany({ where: { acao: 'APLICAR_RETENCAO_AUDITORIA' } }), recusa);
  });
});
