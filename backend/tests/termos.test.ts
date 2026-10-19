// Melhorias #5 — aceite dos termos de uso: sem aceite, toda rota autenticada responde
// 403 TERMOS_NAO_ACEITOS, exceto login, logout, renovacao da sessao, GET /conta/termos e o
// aceite; o aceite e idempotente e auditado; depois dele o acesso e o RBAC seguem como antes;
// as rotas publicas (link do e-mail de treinamento, agente osquery) nao passam pelo bloqueio.
// Banco Postgres isolado (baluarte_test_termos).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  ADMIN,
  chamar,
  criarUsuario,
  encerrarServidor,
  esperaErro,
  iniciarServidor,
  login,
  prepararBanco,
  SENHA_CONTA,
} from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { hashToken } = await import('../src/utils/tokens.js');
const { VERSAO_TERMOS, TEXTO_TERMOS, TERMOS_RASCUNHO } = await import('../src/models/termos.model.js');

const TERMOS = '/conta/termos';
const ACEITE = '/conta/termos/aceite';

let admin: string;

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

/** Conta Ativo sem aceite dos termos, ja logada. */
async function contaSemAceite(perfil: 'Administrador' | 'Analista' | 'Colaborador', prefixo: string) {
  const conta = await criarUsuario(admin, perfil, prefixo, { aceitarTermos: false });
  return { ...conta, token: await login(conta.email, SENHA_CONTA) };
}

describe('contas que já nascem com aceite', () => {
  it('seed de contrato e criarUsuario padrão: termosAceitosEm preenchido', async () => {
    const seed = await prisma.user.findMany({ where: { id: { in: ['u-000', 'u-001', 'u-002'] } } });
    assert.equal(seed.length, 3);
    for (const u of seed) assert.ok(u.termosAceitosEm, `${u.email} sem aceite`);
    const nova = await criarUsuario(admin, 'Colaborador', 'termos-padrao');
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: nova.id } })).termosAceitosEm);
  });

  it('conta criada pela API (convite) nasce sem aceite', async () => {
    const { id } = await criarUsuario(admin, 'Colaborador', 'termos-sem', { aceitarTermos: false });
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).termosAceitosEm, null);
  });
});

describe('bloqueio sem aceite', () => {
  it('rotas protegidas respondem 403 TERMOS_NAO_ACEITOS, para qualquer perfil', async () => {
    for (const perfil of ['Administrador', 'Analista', 'Colaborador'] as const) {
      const { token } = await contaSemAceite(perfil, `termos-bloq-${perfil.toLowerCase()}`);
      esperaErro(await chamar('GET', '/me', { token }), 403, 'TERMOS_NAO_ACEITOS');
      esperaErro(await chamar('GET', '/dashboard', { token }), 403, 'TERMOS_NAO_ACEITOS');
      esperaErro(await chamar('GET', '/configuracoes/seguranca', { token }), 403, 'TERMOS_NAO_ACEITOS');
      esperaErro(await chamar('GET', '/monitoramento/aviso', { token }), 403, 'TERMOS_NAO_ACEITOS');
      esperaErro(
        await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_CONTA, novaSenha: 'Outra@12345' } }),
        403,
        'TERMOS_NAO_ACEITOS',
      );
    }
  });

  it('rotas do contrato e rotas de outro perfil também: o bloqueio vem antes do RBAC', async () => {
    const adm = await contaSemAceite('Administrador', 'termos-bloq-contrato');
    esperaErro(await chamar('GET', '/usuarios', { token: adm.token }), 403, 'TERMOS_NAO_ACEITOS');
    esperaErro(await chamar('POST', '/users', { token: adm.token, body: { nome: 'X', email: 'x.termos@empresa.com', perfil: 'Analista' } }), 403, 'TERMOS_NAO_ACEITOS');
    esperaErro(await chamar('POST', '/assets', { token: adm.token, body: { nome: 'A', host: '10.9.9.9', tipo: 'Servidor' } }), 403, 'TERMOS_NAO_ACEITOS');
    const colab = await contaSemAceite('Colaborador', 'termos-bloq-rbac');
    esperaErro(await chamar('GET', '/usuarios', { token: colab.token }), 403, 'TERMOS_NAO_ACEITOS');
    // Nada foi gravado pelas tentativas.
    assert.equal(await prisma.user.count({ where: { email: 'x.termos@empresa.com' } }), 0);
    assert.equal(await prisma.asset.count({ where: { host: '10.9.9.9' } }), 0);
  });

  it('sem token continua 401 (o bloqueio dos termos vem depois da sessão)', async () => {
    esperaErro(await chamar('GET', '/me'), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', TERMOS), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('POST', ACEITE, { body: { versao: VERSAO_TERMOS } }), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', TERMOS, { token: 'x.y.z' }), 401, 'TOKEN_INVALIDO');
  });
});

describe('exceções liberadas sem aceite', () => {
  it('login devolve o token com a mesma resposta de sempre', async () => {
    const { email } = await criarUsuario(admin, 'Analista', 'termos-login', { aceitarTermos: false });
    const r = await chamar('POST', '/login', { body: { email, senha: SENHA_CONTA } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mensagem, 'Autenticado com sucesso');
    assert.deepEqual(Object.keys(r.body.dados).sort(), ['email', 'idUsuario', 'perfil', 'token']);
  });

  it('GET /conta/termos: texto, versão, rascunho e aceito=false', async () => {
    const { token } = await contaSemAceite('Colaborador', 'termos-ler');
    const r = await chamar('GET', TERMOS, { token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados, { versao: VERSAO_TERMOS, rascunho: TERMOS_RASCUNHO, texto: TEXTO_TERMOS, aceito: false, aceitoEm: null });
    assert.equal(TERMOS_RASCUNHO, true, 'o texto definitivo ainda não foi aprovado');
  });

  it('renovação da sessão funciona e o token novo continua bloqueado fora das exceções', async () => {
    const { token } = await contaSemAceite('Analista', 'termos-renovar');
    const r = await chamar('POST', '/auth/renovar', { token });
    assert.equal(r.status, 200);
    const novo = r.body.dados.token as string;
    assert.equal((await chamar('GET', TERMOS, { token: novo })).status, 200);
    esperaErro(await chamar('GET', '/me', { token: novo }), 403, 'TERMOS_NAO_ACEITOS');
  });

  it('logout funciona e encerra a sessão (depois dele, 401 até nas exceções)', async () => {
    const { token } = await contaSemAceite('Colaborador', 'termos-logout');
    const r = await chamar('POST', '/auth/logout', { token });
    assert.equal(r.status, 200);
    esperaErro(await chamar('GET', TERMOS, { token }), 401, 'SESSAO_ENCERRADA');
  });
});

describe('aceite', () => {
  it('valida a versão: ausente ou fora do formato 400, desatualizada 409, sem gravar', async () => {
    const { id, token } = await contaSemAceite('Colaborador', 'termos-versao');
    esperaErro(await chamar('POST', ACEITE, { token, body: {} }), 400, 'VERSAO_INVALIDA');
    esperaErro(await chamar('POST', ACEITE, { token, body: { versao: 'x y' } }), 400, 'VERSAO_INVALIDA');
    esperaErro(await chamar('POST', ACEITE, { token, body: { versao: { $ne: 1 } } }), 400, 'VERSAO_INVALIDA');
    esperaErro(await chamar('POST', ACEITE, { token, body: { versao: '1999-01-01' } }), 409, 'VERSAO_DESATUALIZADA');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).termosAceitosEm, null);
    assert.equal(await prisma.auditLog.count({ where: { acao: 'ACEITAR_TERMOS', usuarioId: id } }), 0);
  });

  it('grava, audita e é idempotente; depois dele o acesso é normal', async () => {
    const { id, token } = await contaSemAceite('Colaborador', 'termos-aceite');
    const r1 = await chamar('POST', ACEITE, { token, body: { versao: VERSAO_TERMOS } });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.mensagem, 'Termos de uso aceitos');
    assert.equal(r1.body.dados.versao, VERSAO_TERMOS);
    assert.equal(r1.body.dados.novo, true);
    const gravado = (await prisma.user.findUniqueOrThrow({ where: { id } })).termosAceitosEm;
    assert.equal(gravado?.toISOString(), r1.body.dados.aceitoEm);

    const r2 = await chamar('POST', ACEITE, { token, body: { versao: VERSAO_TERMOS } });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.mensagem, 'Termos de uso já aceitos');
    assert.equal(r2.body.dados.novo, false);
    assert.equal(r2.body.dados.aceitoEm, r1.body.dados.aceitoEm, 'o aceite repetido não muda o instante');

    const auditoria = await prisma.auditLog.findMany({ where: { acao: 'ACEITAR_TERMOS', usuarioId: id } });
    assert.equal(auditoria.length, 1);
    assert.equal(auditoria[0].detalhe, `versao=${VERSAO_TERMOS}`);

    // O mesmo token de antes do aceite passa a valer (o middleware le o banco a cada requisicao).
    assert.equal((await chamar('GET', '/me', { token })).status, 200);
    assert.equal((await chamar('GET', '/dashboard', { token })).status, 200);
    const ler = await chamar('GET', TERMOS, { token });
    assert.equal(ler.body.dados.aceito, true);
    assert.equal(ler.body.dados.aceitoEm, r1.body.dados.aceitoEm);
  });

  it('aceites simultâneos: um 201, um registro na auditoria e nenhum 500', async () => {
    const { id, token } = await contaSemAceite('Analista', 'termos-rajada');
    const rs = await Promise.all(Array.from({ length: 6 }, () => chamar('POST', ACEITE, { token, body: { versao: VERSAO_TERMOS } })));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 201]);
    assert.equal(new Set(rs.map((r) => r.body.dados.aceitoEm)).size, 1);
    assert.equal(await prisma.auditLog.count({ where: { acao: 'ACEITAR_TERMOS', usuarioId: id } }), 1);
  });
});

describe('RBAC depois do aceite não muda', () => {
  it('cada perfil segue com o mesmo acesso', async () => {
    const colab = await contaSemAceite('Colaborador', 'termos-rbac-colab');
    const analista = await contaSemAceite('Analista', 'termos-rbac-analista');
    for (const c of [colab, analista])
      assert.equal((await chamar('POST', ACEITE, { token: c.token, body: { versao: VERSAO_TERMOS } })).status, 201);
    esperaErro(await chamar('GET', '/usuarios', { token: colab.token }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/usuarios', { token: analista.token }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/assets', { token: colab.token }), 403, 'PERFIL_SEM_PERMISSAO');
    assert.equal((await chamar('GET', '/assets', { token: analista.token })).status, 200);
    assert.equal((await chamar('GET', '/usuarios', { token: admin })).status, 200);
  });
});

describe('rotas públicas não passam pelo bloqueio', () => {
  it('link do e-mail de treinamento de quem não aceitou abre e conclui sem login', async () => {
    const { id, email } = await criarUsuario(admin, 'Colaborador', 'termos-link', { aceitarTermos: false });
    const tokenLink = 'c'.repeat(64);
    await prisma.campaign.create({
      data: {
        nome: 'Campanha termos',
        template: 'curiosidade',
        status: 'ATIVA',
        eventos: { create: [{ userId: id, destinatario: email, enviadoEm: new Date(), tokenHash: hashToken(tokenLink) }] },
      },
    });
    assert.equal((await chamar('GET', `/treinamentos/link/${tokenLink}`)).status, 200);
    assert.equal((await chamar('POST', `/treinamentos/link/${tokenLink}/concluir`)).status, 200);
  });

  it('agente osquery, "esqueci a senha" e a classificação CVSS respondem como sempre (sem 401/403)', async () => {
    const enroll = await chamar('POST', '/agentes/osquery/enroll', { body: { enroll_secret: 'x', host_identifier: 'h' } });
    assert.ok(![401, 403].includes(enroll.status), `enroll respondeu ${enroll.status}`);
    const reset = await chamar('POST', '/auth/reset-password', { body: { email: 'ninguem.termos@empresa.com' } });
    assert.equal(reset.status, 200);
    // Rota publica do contrato: nem com o token de quem nao aceitou ela passa a bloquear.
    const { token } = await contaSemAceite('Analista', 'termos-publica');
    const cvss = await chamar('GET', '/findings/classificacao?cvss=7.5', { token });
    assert.equal(cvss.status, 200);
    assert.equal(cvss.body.dados.faixa, 'Alto');
  });
});

describe('cópia do texto no mock do frontend', () => {
  // O mock da tela /termos (baluarte-frontend/src/mocks/api.ts: MOCK_TERMS_VERSION, MOCK_TERMS_DRAFT,
  // MOCK_TERMS_TEXT) guarda uma cópia do que a API serve. A tela vem pela sessão Frontend: enquanto a
  // cópia não está nesta árvore o teste fica pulado (com o motivo); quando entra, a comparação é estrita.
  const arquivo = new URL('../../baluarte-frontend/src/mocks/api.ts', import.meta.url);
  const fonte = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : '';
  const pular = fonte.includes('MOCK_TERMS_VERSION')
    ? false
    : 'a cópia do texto no mock (tela /termos, sessão Frontend) ainda não está nesta árvore';

  it('tem a mesma versão, o mesmo rascunho e o mesmo texto da API', { skip: pular }, () => {
    const constante = (nome: string) => fonte.match(new RegExp(`const ${nome} = ([^;]+);`))?.[1]?.trim();
    assert.equal(constante('MOCK_TERMS_VERSION'), `'${VERSAO_TERMOS}'`, 'versão diferente');
    assert.equal(constante('MOCK_TERMS_DRAFT'), String(TERMOS_RASCUNHO), 'rascunho diferente');
    assert.equal(constante('MOCK_TERMS_TEXT'), `'${TEXTO_TERMOS}'`, 'texto diferente');
  });
});

