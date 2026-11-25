// #9: o fluxo do vinculo de inscricao pela API. O Administrador emite um codigo (POST
// /estacoes/vinculos); o agente se inscreve mandando o codigo como enroll_secret (POST
// /agentes/osquery/enroll); o ativo-estacao nasce vinculado e nomeado pela emissao; o codigo e
// uso unico (TTL 24h). Banco isolado por arquivo (helpers.ts). O caminho do segredo da org segue
// em tests/agente*.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN, ANALISTA, chamar, criarUsuario, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco, SENHA_CONTA } from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');

let admin = '';
let analista = '';
let responsavel: { id: string; email: string };

const HOST_DETAILS = {
  os_version: { name: 'Windows 11', version: '10.0.22631', platform: 'windows' },
  system_info: { hostname: 'maquina-teste', computer_name: 'MAQUINA-TESTE' },
};

/** Emite um codigo de vinculo pelo painel (Administrador). */
async function emitir(body: Record<string, unknown>) {
  const r = await chamar('POST', '/estacoes/vinculos', { token: admin, body });
  return r;
}

/** Inscricao do agente mandando o codigo como enroll_secret. */
function enroll(codigo: string, hostIdentifier: string) {
  return chamar('POST', '/agentes/osquery/enroll', {
    body: { enroll_secret: codigo, host_identifier: hostIdentifier, host_details: HOST_DETAILS },
  });
}

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  responsavel = await criarUsuario(admin, 'Colaborador', 'resp');
});

after(async () => {
  delete process.env.VINCULO_TTL_MS;
  await encerrarServidor();
  await prisma.$disconnect();
});

describe('vinculo de inscricao da estacao (#9)', () => {
  it('emite com codigo BLT, 201, e o banco guarda so o hash (nunca o codigo em claro)', async () => {
    const r = await emitir({ nome: 'Notebook do RH', usuarioId: responsavel.id, ip: '10.0.0.9', descricao: 'maquina do RH' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.dados.codigo, /^BLT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.ok(r.body.dados.idVinculo);
    assert.ok(r.body.dados.expiraEm);
    const v = await prisma.stationEnrollmentBinding.findUniqueOrThrow({ where: { id: r.body.dados.idVinculo } });
    assert.notEqual(v.codigoHash, r.body.dados.codigo, 'o banco guarda o hash, nao o codigo');
    assert.equal(v.consumidoEm, null);
  });

  it('o agente se inscreve com o codigo e o ativo-estacao nasce vinculado e nomeado pela emissao', async () => {
    const e = await emitir({ nome: 'Estação Financeiro', usuarioId: responsavel.id });
    const codigo = e.body.dados.codigo as string;

    const r = await enroll(codigo, 'host-fin-001');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.node_key, /^[0-9a-f]{64}$/);
    assert.equal(r.body.node_invalid, false);

    // Ativo nasceu com o NOME da emissao (nao o hostname), tipo "Estação de trabalho", e responsavel.
    const est = await prisma.workstation.findUniqueOrThrow({
      where: { hostIdentifier: 'host-fin-001' },
      include: { asset: true },
    });
    assert.equal(est.asset.nome, 'Estação Financeiro');
    assert.equal(est.asset.tipo, 'Estação de trabalho');
    assert.equal(est.responsavelId, responsavel.id);

    // O vinculo ficou consumido e apontando para o ativo criado.
    const v = await prisma.stationEnrollmentBinding.findUniqueOrThrow({ where: { id: e.body.dados.idVinculo } });
    assert.ok(v.consumidoEm);
    assert.equal(v.assetId, est.assetId);
  });

  it('uso unico: o mesmo codigo numa segunda inscricao (outra maquina) e recusado (401)', async () => {
    const e = await emitir({ nome: 'Uso unico' });
    const codigo = e.body.dados.codigo as string;
    const primeira = await enroll(codigo, 'host-uso-unico-a');
    assert.equal(primeira.status, 200);
    const segunda = await enroll(codigo, 'host-uso-unico-b'); // maquina diferente, mesmo codigo
    esperaErro(segunda, 401, 'SEGREDO_INVALIDO');
    // a segunda maquina NAO foi criada
    assert.equal(await prisma.workstation.count({ where: { hostIdentifier: 'host-uso-unico-b' } }), 0);
  });

  it('codigo expirado e recusado (401), sem criar estacao', async () => {
    const e = await emitir({ nome: 'Expirada' });
    await prisma.stationEnrollmentBinding.update({
      where: { id: e.body.dados.idVinculo },
      data: { expiraEm: new Date(Date.now() - 1000) }, // ja venceu
    });
    const r = await enroll(e.body.dados.codigo as string, 'host-expirada');
    esperaErro(r, 401, 'SEGREDO_INVALIDO');
    assert.equal(await prisma.workstation.count({ where: { hostIdentifier: 'host-expirada' } }), 0);
  });

  it('codigo bem-formado porem desconhecido e recusado (401)', async () => {
    const r = await enroll('BLT-ZZZZ-ZZZZ-ZZZZ', 'host-desconhecida');
    esperaErro(r, 401, 'SEGREDO_INVALIDO');
    assert.equal(await prisma.workstation.count({ where: { hostIdentifier: 'host-desconhecida' } }), 0);
  });

  it('GET /estacoes/vinculos: estado consumido apos o enroll; nunca expoe codigo nem hash', async () => {
    const e = await emitir({ nome: 'Para listar' });
    await enroll(e.body.dados.codigo as string, 'host-listar');
    const r = await chamar('GET', '/estacoes/vinculos', { token: admin });
    assert.equal(r.status, 200);
    const item = r.body.dados.find((v: { idVinculo: string }) => v.idVinculo === e.body.dados.idVinculo);
    assert.ok(item, 'o vinculo deveria aparecer na lista');
    assert.equal(item.estado, 'consumido');
    assert.equal(item.codigo, undefined, 'o codigo nunca sai pela API');
    assert.equal(item.codigoHash, undefined, 'o hash nunca sai pela API');
    assert.ok(item.assetId);
    assert.ok(typeof r.body.resumo.total === 'number');
  });

  it('revogar queima o codigo: DELETE 200, depois o enroll e recusado (401)', async () => {
    const e = await emitir({ nome: 'Revogada' });
    const del = await chamar('DELETE', `/estacoes/vinculos/${e.body.dados.idVinculo}`, { token: admin });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    const r = await enroll(e.body.dados.codigo as string, 'host-revogada');
    esperaErro(r, 401, 'SEGREDO_INVALIDO');
    // revogar de novo -> 409
    const del2 = await chamar('DELETE', `/estacoes/vinculos/${e.body.dados.idVinculo}`, { token: admin });
    esperaErro(del2, 409, 'VINCULO_JA_CONSUMIDO');
  });

  it('RBAC e validacao da emissao: Analista 403; nome vazio 400; usuario inexistente 404', async () => {
    const analistaEmite = await chamar('POST', '/estacoes/vinculos', { token: analista, body: { nome: 'x' } });
    assert.equal(analistaEmite.status, 403, 'so Administrador emite');
    esperaErro(await emitir({}), 400, 'NOME_INVALIDO');
    esperaErro(await emitir({ nome: 'Fantasma', usuarioId: 'nao-existe-123' }), 404, 'USUARIO_NAO_ENCONTRADO');
  });

  it('RBAC da listagem e da revogacao: so Administrador (Analista e Colaborador 403, sem revogar)', async () => {
    const emitido = await emitir({ nome: 'Alvo do RBAC' });
    assert.equal(emitido.status, 201);
    const id = emitido.body.dados.idVinculo;
    const colaborador = await login(responsavel.email, SENHA_CONTA);
    for (const token of [analista, colaborador]) {
      esperaErro(await chamar('GET', '/estacoes/vinculos', { token }), 403, 'PERFIL_SEM_PERMISSAO');
      esperaErro(await chamar('DELETE', `/estacoes/vinculos/${id}`, { token }), 403, 'PERFIL_SEM_PERMISSAO');
    }
    // A revogacao recusada nao mexeu no codigo: o Administrador ainda o revoga.
    assert.equal((await chamar('DELETE', `/estacoes/vinculos/${id}`, { token: admin })).status, 200);
  });
});
