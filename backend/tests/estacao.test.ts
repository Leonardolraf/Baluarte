// B13 — painel de estacoes monitoradas: GET /estacoes (lista com online/offline) e
// GET /estacoes/:id (programas instalados e portas abertas), so para Administrador e
// Analista. As estacoes nascem pelo proprio fluxo do agente osquery (enroll + logger),
// e o ultimo contato e ajustado direto pelo Prisma para simular a estacao parada.
// Banco Postgres isolado (baluarte_test_estacao) — ver helpers.ts.
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ADMIN, ANALISTA, chamar, encerrarServidor, esperaErro, iniciarServidor, login, prepararBanco } from './helpers.js';

prepararBanco(import.meta.url);

const SEGREDO = randomBytes(24).toString('hex');
process.env.OSQUERY_ENROLL_SECRET = SEGREDO;
delete process.env.OSQUERY_INTERVALO_S;

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { statusConexao } = await import('../src/services/estacao.service.js');

let admin = '';
let analista = '';
let colaborador = '';
let seq = 0;

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
beforeEach(() => {
  delete process.env.OSQUERY_INTERVALO_S;
});

/** Inscreve uma estacao como o osquery faz e devolve a chave e o id do banco. */
async function inscrever(hostname: string, so: { name: string; version: string; platform: string; build?: string }) {
  seq += 1;
  const hostIdentifier = `0d6b1c2e-${String(seq).padStart(4, '0')}-4a1b-9c3d-${randomBytes(6).toString('hex')}`;
  const r = await chamar('POST', '/agentes/osquery/enroll', {
    body: {
      enroll_secret: SEGREDO,
      host_identifier: hostIdentifier,
      host_details: { os_version: { build: '', ...so }, system_info: { hostname, computer_name: hostname.split('.')[0] } },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const estacao = await prisma.workstation.findUniqueOrThrow({ where: { hostIdentifier } });
  return { nodeKey: r.body.node_key as string, hostIdentifier, id: estacao.id };
}

function snapshot(nome: string, hostIdentifier: string, linhas: Record<string, string>[]) {
  return { snapshot: linhas, action: 'snapshot', name: nome, hostIdentifier, unixTime: 1791460800, epoch: 0, counter: 0 };
}

async function enviarInventario(nodeKey: string, data: unknown[]) {
  const r = await chamar('POST', '/agentes/osquery/logger', { body: { node_key: nodeKey, log_type: 'result', data } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

/** Ultimo contato `segundos` atras (simula a estacao que parou de falar com o servidor). */
function contatoHa(id: string, segundos: number) {
  return prisma.workstation.update({ where: { id }, data: { vistaEm: new Date(Date.now() - segundos * 1000) } });
}

const ID_INEXISTENTE = `c${'0'.repeat(24)}`;

describe('RBAC', () => {
  it('sem token: 401 TOKEN_AUSENTE na lista e no detalhe', async () => {
    esperaErro(await chamar('GET', '/estacoes'), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', `/estacoes/${ID_INEXISTENTE}`), 401, 'TOKEN_AUSENTE');
  });

  it('token inválido: 401 TOKEN_INVALIDO', async () => {
    esperaErro(await chamar('GET', '/estacoes', { token: 'nao.e.um.jwt' }), 401, 'TOKEN_INVALIDO');
  });

  it('Colaborador: 403 PERFIL_SEM_PERMISSAO na lista e no detalhe (antes de validar o id)', async () => {
    esperaErro(await chamar('GET', '/estacoes', { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', `/estacoes/${ID_INEXISTENTE}`, { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/estacoes/abc', { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('Administrador e Analista: 200', async () => {
    for (const token of [admin, analista]) {
      const r = await chamar('GET', '/estacoes', { token });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.status, 'sucesso');
    }
  });
});

describe('lista (GET /estacoes)', () => {
  it('sem estações inscritas: lista vazia e resumo zerado', async () => {
    const r = await chamar('GET', '/estacoes', { token: analista });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados, []);
    assert.equal(r.body.resumo.total, 0);
    assert.equal(r.body.resumo.online, 0);
    assert.equal(r.body.resumo.offline, 0);
  });

  it('traz nome, SO, último contato, status e o tamanho do inventário, por nome', async () => {
    const win = await inscrever('fin-nb-07.empresa.local', { name: 'Microsoft Windows 11 Pro', version: '10.0.22631', platform: 'windows', build: '22631' });
    const lin = await inscrever('dev-ws-02.empresa.local', { name: 'Ubuntu', version: '22.04.4 LTS (Jammy Jellyfish)', platform: 'ubuntu' });
    await enviarInventario(win.nodeKey, [
      snapshot('baluarte_programas_windows', win.hostIdentifier, [
        { name: 'Google Chrome', version: '129.0.6668.90', fornecedor: 'Google LLC' },
        { name: '7-Zip 23.01 (x64)', version: '23.01', fornecedor: 'Igor Pavlov' },
      ]),
      snapshot('baluarte_portas', win.hostIdentifier, [{ port: '3389', protocol: '6', address: '0.0.0.0', processo: 'svchost.exe' }]),
    ]);

    const r = await chamar('GET', '/estacoes', { token: admin });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados.map((e: any) => e.nome), ['dev-ws-02', 'fin-nb-07']);
    const w = r.body.dados.find((e: any) => e.id === win.id);
    assert.equal(w.host, 'fin-nb-07.empresa.local');
    assert.equal(w.sistema, 'Microsoft Windows 11 Pro 10.0.22631');
    assert.equal(w.soPlataforma, 'windows');
    assert.equal(w.identificador, win.hostIdentifier);
    assert.equal(w.status, 'Online');
    assert.ok(!Number.isNaN(Date.parse(w.ultimoContato)));
    assert.ok(w.inventarioEm, 'inventário recebido');
    assert.equal(w.totalProgramas, 2);
    assert.equal(w.totalPortas, 1);
    const ativo = await prisma.asset.findUniqueOrThrow({ where: { id: w.ativoId } });
    assert.equal(ativo.tipo, 'Estação de trabalho');

    const l = r.body.dados.find((e: any) => e.id === lin.id);
    assert.equal(l.sistema, 'Ubuntu 22.04.4 LTS (Jammy Jellyfish)');
    assert.equal(l.totalProgramas, 0);
    assert.equal(l.inventarioEm, null);
    assert.deepEqual({ total: r.body.resumo.total, online: r.body.resumo.online, offline: r.body.resumo.offline }, { total: 2, online: 2, offline: 0 });
  });

  it('nunca expõe o hash da chave da estação', async () => {
    const r = await chamar('GET', '/estacoes', { token: admin });
    const texto = JSON.stringify(r.body);
    assert.ok(!texto.includes('nodeKeyHash'));
    for (const e of await prisma.workstation.findMany()) assert.ok(!texto.includes(e.nodeKeyHash));
  });
});

describe('online e offline', () => {
  it('janela padrão fora de produção: 3 × 5 min = 900 s', async () => {
    const r = await chamar('GET', '/estacoes', { token: analista });
    assert.equal(r.body.resumo.janelaOfflineS, 900);
  });

  it('acompanha OSQUERY_INTERVALO_S: offline depois de 3 intervalos sem contato', async () => {
    process.env.OSQUERY_INTERVALO_S = '60';
    const parada = await inscrever('rh-nb-03.empresa.local', { name: 'Ubuntu', version: '24.04 LTS', platform: 'ubuntu' });
    const ativa = await inscrever('rh-nb-04.empresa.local', { name: 'Ubuntu', version: '24.04 LTS', platform: 'ubuntu' });
    await contatoHa(parada.id, 181);
    await contatoHa(ativa.id, 170);

    const r = await chamar('GET', '/estacoes', { token: analista });
    assert.equal(r.body.resumo.janelaOfflineS, 180);
    const status = (id: string) => r.body.dados.find((e: any) => e.id === id).status;
    assert.equal(status(parada.id), 'Offline');
    assert.equal(status(ativa.id), 'Online');
    const offline = r.body.dados.filter((e: any) => e.status === 'Offline').length;
    assert.equal(r.body.resumo.offline, offline);
    assert.equal(r.body.resumo.online, r.body.dados.length - offline);
    assert.equal(r.body.resumo.total, r.body.dados.length);
  });

  it('a estação volta a Online quando o agente fala de novo', async () => {
    process.env.OSQUERY_INTERVALO_S = '60';
    const e = await inscrever('ti-ws-09.empresa.local', { name: 'Ubuntu', version: '24.04 LTS', platform: 'ubuntu' });
    await contatoHa(e.id, 3600);
    assert.equal((await chamar('GET', `/estacoes/${e.id}`, { token: admin })).body.dados.status, 'Offline');
    const r = await chamar('POST', '/agentes/osquery/config', { body: { node_key: e.nodeKey } });
    assert.equal(r.status, 200);
    assert.equal((await chamar('GET', `/estacoes/${e.id}`, { token: admin })).body.dados.status, 'Online');
  });

  it('statusConexao: o limite exato da janela ainda é Online', () => {
    const agora = Date.parse('2026-10-08T12:00:00Z');
    assert.equal(statusConexao(new Date(agora - 900_000), 900, agora), 'Online');
    assert.equal(statusConexao(new Date(agora - 900_001), 900, agora), 'Offline');
    assert.equal(statusConexao(new Date(agora + 5_000), 900, agora), 'Online');
  });
});

describe('detalhe (GET /estacoes/:id)', () => {
  it('programas instalados (nome, versão, fornecedor, fonte) e portas abertas, ordenados', async () => {
    const e = await inscrever('fin-ws-11.empresa.local', { name: 'Ubuntu', version: '22.04.4 LTS', platform: 'ubuntu' });
    await enviarInventario(e.nodeKey, [
      snapshot('baluarte_programas_deb', e.hostIdentifier, [
        { name: 'openssl', version: '3.0.2-0ubuntu1.18', fornecedor: 'Ubuntu Developers' },
        { name: 'curl', version: '7.81.0-1ubuntu1.18', fornecedor: 'Ubuntu Developers' },
      ]),
      snapshot('baluarte_programas_rpm', e.hostIdentifier, [{ name: 'bash', version: '5.1.8-9.el9', fornecedor: '' }]),
      snapshot('baluarte_portas', e.hostIdentifier, [
        { port: '5432', protocol: '6', address: '127.0.0.1', processo: 'postgres' },
        { port: '22', protocol: '6', address: '0.0.0.0', processo: 'sshd' },
        { port: '68', protocol: '17', address: '0.0.0.0', processo: '' },
      ]),
    ]);

    const r = await chamar('GET', `/estacoes/${e.id}`, { token: analista });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.dados;
    assert.equal(d.id, e.id);
    assert.equal(d.nome, 'fin-ws-11');
    assert.equal(d.status, 'Online');
    assert.equal(d.totalProgramas, 3);
    assert.equal(d.totalPortas, 3);
    assert.deepEqual(d.programas, [
      { nome: 'bash', versao: '5.1.8-9.el9', fornecedor: null, fonte: 'rpm_packages' },
      { nome: 'curl', versao: '7.81.0-1ubuntu1.18', fornecedor: 'Ubuntu Developers', fonte: 'deb_packages' },
      { nome: 'openssl', versao: '3.0.2-0ubuntu1.18', fornecedor: 'Ubuntu Developers', fonte: 'deb_packages' },
    ]);
    assert.deepEqual(d.portas, [
      { porta: 22, protocolo: 'TCP', endereco: '0.0.0.0', processo: 'sshd' },
      { porta: 68, protocolo: 'UDP', endereco: '0.0.0.0', processo: null },
      { porta: 5432, protocolo: 'TCP', endereco: '127.0.0.1', processo: 'postgres' },
    ]);
    assert.ok(!JSON.stringify(r.body).includes('nodeKeyHash'));
  });

  it('estação sem inventário: listas vazias', async () => {
    const e = await inscrever('com-nb-01.empresa.local', { name: 'Microsoft Windows 10 Pro', version: '10.0.19045', platform: 'windows' });
    const r = await chamar('GET', `/estacoes/${e.id}`, { token: admin });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados.programas, []);
    assert.deepEqual(r.body.dados.portas, []);
    assert.equal(r.body.dados.inventarioEm, null);
  });

  it('id no formato certo, mas inexistente: 404 ESTACAO_NAO_ENCONTRADA', async () => {
    esperaErro(await chamar('GET', `/estacoes/${ID_INEXISTENTE}`, { token: admin }), 404, 'ESTACAO_NAO_ENCONTRADA');
  });

  it('o id do ativo não é o id da estação: 404', async () => {
    const e = await inscrever('ops-ws-05.empresa.local', { name: 'Ubuntu', version: '22.04 LTS', platform: 'ubuntu' });
    const { assetId } = await prisma.workstation.findUniqueOrThrow({ where: { id: e.id } });
    esperaErro(await chamar('GET', `/estacoes/${assetId}`, { token: admin }), 404, 'ESTACAO_NAO_ENCONTRADA');
  });

  it('id fora do formato: 400 ID_INVALIDO, sem consultar o banco', async () => {
    for (const id of ['abc', '1', `${ID_INEXISTENTE}0`, 'C' + '0'.repeat(24), "c' OR '1'='1", '%24ne']) {
      esperaErro(await chamar('GET', `/estacoes/${encodeURIComponent(id)}`, { token: analista }), 400, 'ID_INVALIDO');
    }
  });
});
