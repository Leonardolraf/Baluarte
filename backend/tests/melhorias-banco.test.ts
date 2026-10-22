// Migrations das Melhorias de 14/10/2026, conferidas no banco: #5 (User.termosAceitosEm, hoje parada) e
// #6 (CampaignLinkHit: CHECK de tamanho, cascata, RLS, fechamento DT13 e o expurgo LGPD que
// anula ip/userAgent sem apagar a abertura). Banco isolado — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { prisma } = await import('../src/config/db.js');

after(() => prisma.$disconnect());

const MIGRATION_ABERTURAS = readFileSync(
  new URL('../prisma/migrations/20261014120100_aberturas_link_campanha/migration.sql', import.meta.url),
  'utf8',
);
const ROLLBACK = new Error('rollback proposital');

/** Espera que a escrita seja recusada por uma restricao CHECK (23514). */
async function recusadaPorCheck(escrita: Promise<unknown>, motivo: string) {
  await assert.rejects(escrita, (e: { message?: string }) => {
    assert.match(e.message ?? '', /23514|check constraint/i, motivo);
    return true;
  }, motivo);
}

describe('#5 aposentado: coluna User.termosAceitosEm parada (sem uso no src)', () => {
  // O #5 (termos de uso) foi aposentado em 19/10/2026: o gate passou a ser a ciência do aviso de
  // monitoramento. A coluna da migration de 14/10 fica no schema, sem uso, até uma migration
  // posterior a 25/11 a remover (ver CHANGELOG). Aqui só se confere que ela ainda existe, que
  // nasce nula e que nem o seed de contrato a preenche mais.
  it('existe, nasce nula e nenhum seed a preenche', async () => {
    assert.equal(await prisma.user.count({ where: { termosAceitosEm: { not: null } } }), 0);
    const u = await prisma.user.create({ data: { nome: 'Termos', email: `termos.${Date.now()}@empresa.com`, senhaHash: 'x' } });
    assert.equal(u.termosAceitosEm, null);
  });
});

describe('#6 aberturas do link (CampaignLinkHit)', () => {
  let eventoId: string;

  before(async () => {
    const campanha = await prisma.campaign.create({
      data: { nome: 'Aberturas', template: 'urgencia', eventos: { create: [{ userId: 'u-002', destinatario: 'colaborador@empresa.com' }] } },
      include: { eventos: true },
    });
    eventoId = campanha.eventos[0].id;
  });

  it('grava aberturas com e sem ip/userAgent, várias por evento', async () => {
    await prisma.campaignLinkHit.create({ data: { campaignEventId: eventoId, ip: '2001:0db8:85a3:0000:0000:8a2e:0370:7334', userAgent: 'Mozilla/5.0' } });
    await prisma.campaignLinkHit.create({ data: { campaignEventId: eventoId, ip: '203.0.113.7' } });
    await prisma.campaignLinkHit.create({ data: { campaignEventId: eventoId } });
    assert.equal(await prisma.campaignLinkHit.count({ where: { campaignEventId: eventoId } }), 3);
  });

  it('CHECK: ip até 45 caracteres e userAgent até 512, sem texto vazio', async () => {
    await prisma.campaignLinkHit.create({ data: { campaignEventId: eventoId, ip: 'a'.repeat(45), userAgent: 'u'.repeat(512) } });
    await recusadaPorCheck(prisma.campaignLinkHit.create({ data: { campaignEventId: eventoId, ip: 'a'.repeat(46) } }), 'ip com 46');
    await recusadaPorCheck(prisma.campaignLinkHit.create({ data: { campaignEventId: eventoId, userAgent: 'u'.repeat(513) } }), 'userAgent com 513');
    await recusadaPorCheck(prisma.campaignLinkHit.create({ data: { campaignEventId: eventoId, ip: '' } }), 'ip vazio');
    await recusadaPorCheck(prisma.campaignLinkHit.create({ data: { campaignEventId: eventoId, userAgent: '' } }), 'userAgent vazio');
  });

  it('expurgo LGPD: anular ip/userAgent de aberturas com mais de 90 dias mantém a contagem', async () => {
    const velha = await prisma.campaignLinkHit.create({
      data: { campaignEventId: eventoId, ip: '198.51.100.9', userAgent: 'antigo', registradoEm: new Date(Date.now() - 91 * 86_400_000) },
    });
    const antes = await prisma.campaignLinkHit.count({ where: { campaignEventId: eventoId } });

    const anuladas = await prisma.$executeRaw`
      UPDATE "CampaignLinkHit" SET "ip" = NULL, "userAgent" = NULL
      WHERE "registradoEm" < now() - interval '90 days' AND ("ip" IS NOT NULL OR "userAgent" IS NOT NULL)`;
    assert.equal(anuladas, 1, 'só a abertura velha perde ip/userAgent');

    const depois = await prisma.campaignLinkHit.findUniqueOrThrow({ where: { id: velha.id } });
    assert.equal(depois.ip, null);
    assert.equal(depois.userAgent, null);
    assert.equal(await prisma.campaignLinkHit.count({ where: { campaignEventId: eventoId } }), antes, 'a contagem não diminui');
    assert.ok(await prisma.campaignLinkHit.count({ where: { campaignEventId: eventoId, ip: { not: null } } }) > 0, 'as recentes mantêm o ip');
  });

  it('excluir a campanha leva o evento e as aberturas (cascata)', async () => {
    const c = await prisma.campaign.create({
      data: { nome: 'Cascata', template: 'curiosidade', eventos: { create: [{ userId: 'u-001', destinatario: 'analista@empresa.com' }] } },
      include: { eventos: true },
    });
    const ev = c.eventos[0].id;
    await prisma.campaignLinkHit.create({ data: { campaignEventId: ev, ip: '192.0.2.1' } });
    await prisma.campaign.delete({ where: { id: c.id } });
    assert.equal(await prisma.campaignLinkHit.count({ where: { campaignEventId: ev } }), 0);
  });

  it('RLS ligado e, com os papéis do Supabase, o bloco DT13 da migration fecha a tabela', async () => {
    const [rls] = await prisma.$queryRaw<Array<{ ligado: boolean }>>`
      SELECT relrowsecurity AS ligado FROM pg_class WHERE oid = '"CampaignLinkHit"'::regclass`;
    assert.equal(rls.ligado, true);

    const bloco = MIGRATION_ABERTURAS.match(/DO \$\$[\s\S]*?END \$\$;/);
    assert.ok(bloco, 'a migration precisa do bloco DO de fechamento');

    let resultado: Array<{ papel: string; tem: boolean }> = [];
    await assert.rejects(prisma.$transaction(async (tx) => {
      for (const papel of ['anon', 'authenticated']) {
        await tx.$executeRawUnsafe(`DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${papel}') THEN CREATE ROLE ${papel} NOLOGIN; END IF;
        END $$`);
        // O que o Supabase concede por padrao a tabela nova (ALTER DEFAULT PRIVILEGES).
        await tx.$executeRawUnsafe(`GRANT ALL ON "CampaignLinkHit" TO ${papel}`);
      }
      const [antes] = await tx.$queryRaw<Array<{ ok: boolean }>>`
        SELECT has_table_privilege('anon', '"CampaignLinkHit"', 'TRUNCATE') AS ok`;
      assert.equal(antes.ok, true, 'pré-condição: o cenário do Supabase antes do bloco');

      await tx.$executeRawUnsafe(bloco[0]);

      resultado = await tx.$queryRaw`
        SELECT r.rolname AS papel,
               has_table_privilege(r.oid, '"CampaignLinkHit"', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS tem
        FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')`;
      throw ROLLBACK;
    }), (e) => e === ROLLBACK);

    assert.equal(resultado.length, 2);
    assert.deepEqual(resultado.filter((l) => l.tem), []);
  });
});
