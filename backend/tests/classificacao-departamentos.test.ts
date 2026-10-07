// Classificacao dos achados (CWE, CVE, vetor CVSS 3.1 -> nota), remediacao e departamentos.
// Banco SQLite isolado (prisma/test-classificacao-departamentos.db) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN,
  ANALISTA,
  SENHA_PROVISORIA,
  chamar,
  criarUsuario,
  encerrarServidor,
  esperaErro,
  iniciarServidor,
  login,
  prepararBanco,
} from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/db.js');
const { notaCvss, vetorCvssValido, cweValido, cveValido } = await import('../src/cvss.js');
const { CATALOGO_ACHADOS, dadosAchado, lerRemediacao } = await import('../src/catalogo.js');
const { faixaCvss } = await import('../src/util.js');

let admin: string;
let analista: string;
let colaborador: string;

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

describe('CVSS 3.1: nota calculada do vetor', () => {
  it('confere com notas conhecidas da especificação/NVD', () => {
    const casos: Array<[string, number]> = [
      ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
      ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10.0],
      ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', 7.5],
      ['CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 8.8],
      ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],
      ['CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N', 5.4],
      ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H', 9.1],
      ['CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N', 1.6],
      ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N', 0],
    ];
    for (const [vetor, nota] of casos) assert.equal(notaCvss(vetor), nota, vetor);
  });

  it('a ordem das métricas não importa', () => {
    assert.equal(notaCvss('CVSS:3.1/C:H/I:H/A:H/AV:N/AC:L/PR:N/UI:N/S:U'), 9.8);
  });

  it('recusa vetor incompleto, repetido, de outra versão ou com valor inválido', () => {
    for (const ruim of [
      'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H',
      'CVSS:3.1/AV:N/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H',
      'CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
      'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:P',
      '',
    ]) {
      assert.equal(notaCvss(ruim), null, ruim);
      assert.equal(vetorCvssValido(ruim), false, ruim);
    }
    assert.equal(vetorCvssValido(42), false);
  });

  it('valida o formato de CWE e CVE', () => {
    assert.ok(cweValido('CWE-89') && cweValido('CWE-1321'));
    assert.ok(!cweValido('CWE89') && !cweValido('cwe-89') && !cweValido('CWE-') && !cweValido(89));
    assert.ok(cveValido('CVE-2021-44228') && cveValido('CVE-2019-10744'));
    assert.ok(!cveValido('CVE-21-44228') && !cveValido('CVE-2021-123') && !cveValido('2021-44228'));
  });
});

describe('catálogo do scanner', () => {
  it('todo tipo tem classificação válida, nota coerente com o vetor e remediação', () => {
    for (const chave of Object.keys(CATALOGO_ACHADOS) as Array<keyof typeof CATALOGO_ACHADOS>) {
      const d = dadosAchado(chave);
      assert.equal(d.cvss, notaCvss(d.cvssVetor), chave);
      assert.equal(d.severidade, faixaCvss(d.cvss), chave);
      assert.ok(cweValido(d.cwe), chave);
      if (d.cve !== null) assert.ok(cveValido(d.cve), chave);
      const passos = lerRemediacao(d.remediacao);
      assert.ok(passos.length > 0, `${chave} sem remediação`);
      for (const p of passos) {
        assert.ok(p.titulo && p.descricao, chave);
        assert.ok(['baixo', 'medio', 'alto'].includes(p.esforco), chave);
      }
    }
  });

  it('remediação gravada corrompida vira lista vazia, sem quebrar a leitura', () => {
    assert.deepEqual(lerRemediacao(null), []);
    assert.deepEqual(lerRemediacao('{nao e json'), []);
    assert.deepEqual(lerRemediacao('{"titulo":"x"}'), []);
  });
});

describe('achados da varredura com classificação e remediação', () => {
  it('POST /scans grava CWE, vetor, nota derivada e remediação; a API devolve os passos numerados', async () => {
    const r = await chamar('POST', '/scans', { token: analista, body: { ativoId: 'ativo-001' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.dados.statusVarredura, 'EM_FILA', 'contrato N2 AT1');

    const achados = await prisma.finding.findMany({ where: { scanId: r.body.dados.scanId } });
    assert.ok(achados.length >= 2 && achados.length <= 4);
    for (const f of achados) {
      assert.ok(cweValido(f.cwe));
      assert.equal(f.cvss, notaCvss(f.cvssVetor!));
      assert.equal(f.severidade, faixaCvss(f.cvss));
      assert.ok(lerRemediacao(f.remediacao).length > 0);
    }
    assert.equal(new Set(achados.map((f) => f.cwe)).size, achados.length, 'tipos sorteados não se repetem');

    const detalhe = await chamar('GET', `/vulnerabilidades/${achados[0].id}`, { token: analista });
    assert.equal(detalhe.status, 200);
    assert.equal(detalhe.body.dados.cwe, achados[0].cwe);
    assert.equal(detalhe.body.dados.cvssVetor, achados[0].cvssVetor);
    assert.ok('cve' in detalhe.body.dados);
    const passos = detalhe.body.dados.remediacao;
    assert.ok(Array.isArray(passos) && passos.length > 0);
    assert.deepEqual(passos.map((p: { ordem: number }) => p.ordem), passos.map((_: unknown, i: number) => i + 1));
    assert.ok(passos.every((p: Record<string, unknown>) => typeof p.titulo === 'string' && typeof p.descricao === 'string'));
  });

  it('achado de componente traz o CVE', async () => {
    const scan = await prisma.scan.create({ data: { assetId: 'ativo-001', status: 'CONCLUIDA' } });
    const f = await prisma.finding.create({ data: { ...dadosAchado('componente-vulneravel'), scanId: scan.id } });
    const r = await chamar('GET', `/vulnerabilidades/${f.id}`, { token: analista });
    assert.equal(r.body.dados.cve, 'CVE-2019-10744');
    assert.equal(r.body.dados.cvss, 9.1);
    assert.equal(r.body.dados.severidade, 'Crítico');
  });
});

describe('departamentos', () => {
  it('GET /departamentos lista os do seed para Administrador e Analista; Colaborador não', async () => {
    const r = await chamar('GET', '/departamentos', { token: analista });
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.dados.map((d: { nome: string }) => d.nome),
      ['Comercial', 'Diretoria', 'Financeiro', 'Operações', 'RH', 'TI'],
    );
    esperaErro(await chamar('GET', '/departamentos', { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/departamentos'), 401, 'TOKEN_AUSENTE');
  });

  it('POST /departamentos: só Administrador, nome obrigatório e único (ignorando maiúsculas)', async () => {
    esperaErro(await chamar('POST', '/departamentos', { token: analista, body: { nome: 'Jurídico' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', '/departamentos', { token: admin, body: { nome: '   ' } }), 400, 'NOME_OBRIGATORIO');
    esperaErro(await chamar('POST', '/departamentos', { token: admin, body: { nome: 42 } }), 400, 'NOME_OBRIGATORIO');
    esperaErro(await chamar('POST', '/departamentos', { token: admin, body: { nome: 'x'.repeat(61) } }), 400, 'NOME_INVALIDO');
    esperaErro(await chamar('POST', '/departamentos', { token: admin, body: { nome: 'ti' } }), 409, 'DEPARTAMENTO_DUPLICADO');
    const r = await chamar('POST', '/departamentos', { token: admin, body: { nome: '  Jurídico ' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.dados.nome, 'Jurídico');
  });

  it('usuário é criado e editado com departamento pelo nome; nome desconhecido dá 400', async () => {
    const criado = await chamar('POST', '/users', { token: admin, body: { nome: 'Dep', email: 'dep.usuario@empresa.com', perfil: 'Colaborador', departamento: 'financeiro' } });
    assert.equal(criado.status, 201);
    assert.equal(criado.body.dados.departamento, 'Financeiro');
    const id = criado.body.dados.idUsuario as string;

    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'X', email: 'x.dep@empresa.com', perfil: 'Colaborador', departamento: 'Marketing' } }), 400, 'DEPARTAMENTO_INVALIDO');
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'X', email: 'x.dep@empresa.com', perfil: 'Colaborador', departamento: 7 } }), 400, 'DEPARTAMENTO_INVALIDO');
    esperaErro(await chamar('PATCH', `/users/${id}`, { token: admin, body: { departamento: 'Marketing' } }), 400, 'DEPARTAMENTO_INVALIDO');

    const movido = await chamar('PATCH', `/users/${id}`, { token: admin, body: { departamento: 'TI' } });
    assert.equal(movido.status, 200);
    assert.equal(movido.body.dados.departamento, 'TI');
    assert.equal(movido.body.dados.department, undefined, 'a API não expõe o nome interno da relação');

    const lista = await chamar('GET', '/usuarios', { token: admin });
    assert.equal(lista.body.dados.find((u: { id: string }) => u.id === id).departamento, 'TI');

    const limpo = await chamar('PATCH', `/users/${id}`, { token: admin, body: { departamento: null } });
    assert.equal(limpo.body.dados.departamento, null);
    // Sem o campo, o departamento não muda (e o contrato continua aceitando cadastro sem ele).
    const semCampo = await chamar('POST', '/users', { token: admin, body: { nome: 'Sem', email: 'sem.dep@empresa.com', perfil: 'Colaborador' } });
    assert.equal(semCampo.body.dados.departamento, null);
  });

  it('GET /me traz o departamento do usuário logado', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'me.dep');
    assert.equal((await chamar('PATCH', `/users/${conta.id}`, { token: admin, body: { departamento: 'RH' } })).status, 200);
    const token = await login(conta.email, SENHA_PROVISORIA);
    const me = await chamar('GET', '/me', { token });
    assert.equal(me.body.dados.departamento, 'RH');
  });

  it('DELETE /departamentos/:id: bloqueado com usuários (409), livre sem eles; só Administrador', async () => {
    const deps = (await chamar('GET', '/departamentos', { token: admin })).body.dados as Array<{ id: string; nome: string; usuarios: number }>;
    const rh = deps.find((d) => d.nome === 'RH')!;
    const juridico = deps.find((d) => d.nome === 'Jurídico')!;
    assert.ok(rh.usuarios > 0);
    esperaErro(await chamar('DELETE', `/departamentos/${rh.id}`, { token: admin }), 409, 'DEPARTAMENTO_EM_USO');
    esperaErro(await chamar('DELETE', `/departamentos/${juridico.id}`, { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('DELETE', '/departamentos/nao-existe', { token: admin }), 404, 'DEPARTAMENTO_NAO_ENCONTRADO');
    assert.equal((await chamar('DELETE', `/departamentos/${juridico.id}`, { token: admin })).status, 200);
  });

  it('relatório da campanha agrupa por departamento (sem departamento aparece como tal)', async () => {
    const a = await chamar('POST', '/users', { token: admin, body: { nome: 'A', email: 'grupo.a@empresa.com', perfil: 'Colaborador', departamento: 'Comercial' } });
    const b = await chamar('POST', '/users', { token: admin, body: { nome: 'B', email: 'grupo.b@empresa.com', perfil: 'Colaborador', departamento: 'Comercial' } });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const c = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Por departamento', destinatarios: ['grupo.a@empresa.com', 'grupo.b@empresa.com', 'colaborador@empresa.com'], template: 'urgencia' },
    });
    assert.equal(c.status, 201);
    const id = c.body.dados.idCampanha as string;
    // Simula envio para todos e clique de um do Comercial.
    await prisma.campaignEvent.updateMany({ where: { campaignId: id }, data: { enviadoEm: new Date() } });
    await prisma.campaignEvent.updateMany({ where: { campaignId: id, userId: a.body.dados.idUsuario }, data: { clicadoEm: new Date() } });

    const r = await chamar('GET', `/campanhas/${id}`, { token: analista });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados.porDepartamento, [
      { departamento: 'Comercial', destinatarios: 2, clicados: 1, taxaClique: 50 },
      { departamento: 'Sem departamento', destinatarios: 1, clicados: 0, taxaClique: 0 },
    ]);
    assert.equal(r.body.dados.treinamentos[0].departamento, 'Comercial');
  });
});
