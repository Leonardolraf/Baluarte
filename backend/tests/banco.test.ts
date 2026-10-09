// Garantias do PROPRIO banco (PostgreSQL), independentes da aplicacao: restricoes CHECK
// dos valores fixos, unicidade sem maiusculas (citext), cascata/restricao nas exclusoes
// e remediacao como lista JSON. Escreve direto pelo Prisma, sem passar pelas rotas.
// Banco isolado (baluarte_test_banco) — ver helpers.ts.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const { prisma } = await import('../src/config/db.js');
const { dadosAchado } = await import('../src/models/catalogoAchado.model.js');
const { PERFIS, STATUS_USUARIO, TIPOS_ATIVO, STATUS_FINDING, TEMPLATES } = await import('../src/models/dominio.model.js');

after(() => prisma.$disconnect());

/** Espera que a escrita seja recusada pelo banco (restricao violada). */
async function recusada(escrita: Promise<unknown>, motivo: string) {
  await assert.rejects(escrita, (e: { code?: string; message?: string }) => {
    // P2002 = unicidade; P2003 = chave estrangeira; CHECK chega como erro do banco (23514).
    assert.ok(e.code === 'P2002' || e.code === 'P2003' || /23514|check constraint/i.test(e.message ?? ''), `${motivo}: ${e.code} ${e.message}`);
    return true;
  }, motivo);
}

let seq = 0;
const email = () => `banco.${Date.now()}.${++seq}@empresa.com`;
const usuario = (extra: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { nome: 'U', email: email(), senhaHash: 'x', ...extra } });

describe('CHECK: valores fixos garantidos pelo banco', () => {
  it('aceita todos os valores das listas de src/models/dominio.model.ts', async () => {
    for (const perfil of PERFIS) for (const status of STATUS_USUARIO) await usuario({ perfil, status });
    for (const tipo of TIPOS_ATIVO) await prisma.asset.create({ data: { nome: 'A', host: `h${++seq}.empresa.com`, tipo } });
    for (const template of TEMPLATES) await prisma.campaign.create({ data: { nome: 'C', template } });
    const asset = await prisma.asset.create({ data: { nome: 'A', host: `h${++seq}.empresa.com`, tipo: 'Servidor' } });
    const scan = await prisma.scan.create({ data: { assetId: asset.id } });
    for (const status of STATUS_FINDING) await prisma.finding.create({ data: { ...dadosAchado('injecao-sql'), scanId: scan.id, status } });
    assert.equal(await prisma.finding.count({ where: { scanId: scan.id } }), STATUS_FINDING.length);
  });

  it('recusa valor fora da lista em cada coluna fixa', async () => {
    await recusada(usuario({ perfil: 'Root' }), 'perfil');
    await recusada(usuario({ status: 'Bloqueado' }), 'status do usuário');
    await recusada(prisma.asset.create({ data: { nome: 'A', host: `h${++seq}.x`, tipo: 'Impressora' } }), 'tipo de ativo');
    await recusada(prisma.asset.create({ data: { nome: 'A', host: `h${++seq}.x`, tipo: 'Rede', status: 'Talvez' } }), 'status do ativo');
    await recusada(prisma.campaign.create({ data: { nome: 'C', template: 'medo' } }), 'template');
    await recusada(prisma.campaign.create({ data: { nome: 'C', template: 'urgencia', status: 'PAUSADA' } }), 'status da campanha');

    const asset = await prisma.asset.create({ data: { nome: 'A', host: `h${++seq}.empresa.com`, tipo: 'Servidor' } });
    await recusada(prisma.scan.create({ data: { assetId: asset.id, status: 'FEITA' } }), 'status da varredura');
    const scan = await prisma.scan.create({ data: { assetId: asset.id } });
    const base = { ...dadosAchado('injecao-sql'), scanId: scan.id };
    await recusada(prisma.finding.create({ data: { ...base, status: 'Fechada' } }), 'status do achado');
    await recusada(prisma.finding.create({ data: { ...base, severidade: 'Medio' } }), 'severidade sem acento');
    await recusada(prisma.finding.create({ data: { ...base, cvss: 11 } }), 'cvss acima de 10');
    await recusada(prisma.finding.create({ data: { ...base, cwe: 'CWE89' } }), 'formato de CWE');
    await recusada(prisma.finding.create({ data: { ...base, cve: 'CVE-21-1' } }), 'formato de CVE');
    await recusada(prisma.finding.create({ data: { ...base, cvssVetor: 'CVSS:3.0/AV:N' } }), 'versão do vetor');
    await recusada(prisma.finding.create({ data: { ...base, remediacao: { titulo: 'x' } } }), 'remediação que não é lista');
    await recusada(prisma.department.create({ data: { name: '   ' } }), 'departamento em branco');
  });
});

describe('citext: unicidade sem diferenciar maiúsculas', () => {
  it('e-mail repetido com outra caixa é recusado, e a busca encontra qualquer caixa', async () => {
    const u = await usuario();
    await recusada(prisma.user.create({ data: { nome: 'U', email: u.email.toUpperCase(), senhaHash: 'x' } }), 'e-mail em maiúsculas');
    assert.equal((await prisma.user.findUnique({ where: { email: u.email.toUpperCase() } }))?.id, u.id);
    const lista = await prisma.user.findMany({ where: { email: { in: [u.email.toUpperCase()] } } });
    assert.equal(lista.length, 1);
  });

  it('nome de departamento repetido com outra caixa é recusado', async () => {
    await prisma.department.create({ data: { name: 'Jurídico Banco' } });
    await recusada(prisma.department.create({ data: { name: 'JURÍDICO BANCO' } }), 'departamento em maiúsculas');
  });
});

describe('exclusões: cascata onde o filho não existe sozinho, restrição onde há histórico', () => {
  it('excluir a varredura leva os achados; excluir o ativo com varredura é recusado', async () => {
    const asset = await prisma.asset.create({ data: { nome: 'A', host: `h${++seq}.empresa.com`, tipo: 'Servidor' } });
    const scan = await prisma.scan.create({ data: { assetId: asset.id } });
    await prisma.finding.create({ data: { ...dadosAchado('cors-curinga'), scanId: scan.id } });
    await recusada(prisma.asset.delete({ where: { id: asset.id } }), 'ativo com histórico');
    await prisma.scan.delete({ where: { id: scan.id } });
    assert.equal(await prisma.finding.count({ where: { scanId: scan.id } }), 0);
    await prisma.asset.delete({ where: { id: asset.id } });
  });

  it('excluir a campanha leva os eventos; excluir usuário com evento é recusado', async () => {
    const u = await usuario();
    const c = await prisma.campaign.create({ data: { nome: 'C', template: 'urgencia', eventos: { create: [{ userId: u.id, destinatario: u.email }] } } });
    await recusada(prisma.user.delete({ where: { id: u.id } }), 'usuário com histórico');
    await prisma.campaign.delete({ where: { id: c.id } });
    assert.equal(await prisma.campaignEvent.count({ where: { campaignId: c.id } }), 0);
    await prisma.user.delete({ where: { id: u.id } });
  });

  it('departamento com usuário não é excluído', async () => {
    const d = await prisma.department.create({ data: { name: `Dep ${++seq}` } });
    await usuario({ departmentId: d.id });
    await recusada(prisma.department.delete({ where: { id: d.id } }), 'departamento em uso');
  });
});
