// O seed de contrato (prisma/seed.ts) contra um banco que já tem dados (DT28). Documenta as
// duas consequências de rodá-lo fora do ambiente local, que justificam o padrão 0 e a trava
// do docker-entrypoint.sh:
//  - conta de contrato que já existe: o upsert tem `update: {}`, a senha trocada NÃO volta a
//    ser a pública do README;
//  - os ids do create são fixos (u-000, u-001, u-002). Num banco onde esses ids já pertencem a
//    outro e-mail (a produção: contas @baluarte.test de 07/10), o upsert não acha o e-mail
//    @empresa.com, cai no create, viola a chave primária e o seed termina com erro (no Docker,
//    o set -e derruba o entrypoint e a API não sobe). Nenhuma conta com senha pública nasce.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);
const { prisma } = await import('../src/config/db.js');
after(() => prisma.$disconnect());

function rodarSeed() {
  return spawnSync('npx tsx prisma/seed.ts', { shell: true, encoding: 'utf8', env: process.env });
}

describe('seed de contrato sobre banco existente (DT28)', () => {
  it('não sobrescreve a senha de uma conta de contrato que já existe', async () => {
    const outra = await bcrypt.hash('Outra@12345', 10);
    await prisma.user.update({ where: { id: 'u-000' }, data: { senhaHash: outra } });

    const r = rodarSeed();
    assert.equal(r.status, 0, r.stderr);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@empresa.com' } });
    assert.ok(await bcrypt.compare('Outra@12345', admin.senhaHash));
    assert.equal(await bcrypt.compare('Admin@123', admin.senhaHash), false);
  });

  it('com o id fixo u-000 já usado por outro e-mail, o seed falha e não cria conta com senha pública', async () => {
    await prisma.user.update({ where: { id: 'u-000' }, data: { email: 'admin@baluarte.test' } });

    const r = rodarSeed();
    assert.notEqual(r.status, 0, 'o seed deveria falhar');
    assert.match(`${r.stdout}\n${r.stderr}`, /P2002|Unique constraint/i);
    assert.equal(await prisma.user.findUnique({ where: { email: 'admin@empresa.com' } }), null);
    const dono = await prisma.user.findUniqueOrThrow({ where: { id: 'u-000' } });
    assert.equal(dono.email, 'admin@baluarte.test');
  });
});
