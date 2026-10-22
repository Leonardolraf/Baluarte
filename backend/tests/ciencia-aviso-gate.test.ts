// Gate de ciência do aviso de monitoramento (opção C do Leo, 19/10/2026): o aviso (B18) é o
// documento ÚNICO que todo usuário precisa reconhecer para usar o Baluarte. É CIÊNCIA
// obrigatória (legítimo interesse), não consentimento. Sem ciência da VERSAO_AVISO em vigor,
// toda rota autenticada responde 403 CIENCIA_AVISO_PENDENTE (antes do RBAC), exceto as 5
// exceções (logout, renovação, GET /me, ler o aviso e registrar a ciência); as rotas públicas
// não passam pelo gate. Substitui o gate dos termos de uso (#5, aposentado).
// GET /me (desde 19/10/2026) responde a quem não deu ciência e traz `cienciaAvisoPendente`, que
// só orienta o cliente; quem decide acesso é o 403 das outras rotas.
// Banco Postgres isolado (baluarte_test_ciencia_aviso_gate).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
const { VERSAO_AVISO } = await import('../src/models/avisoMonitoramento.model.js');
const { apiRouter } = await import('../src/routes/index.js');
const { exigeToken } = await import('../src/middlewares/auth.middleware.js');

const AVISO = '/monitoramento/aviso';
const CIENCIA = '/monitoramento/ciencia';
const PENDENTE = 'CIENCIA_AVISO_PENDENTE';
/** Campos do GET /me: os de sempre + o aditivo cienciaAvisoPendente. Nenhum dado de recurso. */
const CAMPOS_ME = ['cienciaAvisoPendente', 'departamento', 'email', 'id', 'nome', 'perfil', 'status'];

let admin: string;

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

type Perfil = 'Administrador' | 'Analista' | 'Colaborador';

/** Conta Ativo SEM ciência, já logada. */
async function semCiencia(perfil: Perfil, prefixo: string) {
  const conta = await criarUsuario(admin, perfil, prefixo, { cienciaAviso: false });
  return { ...conta, token: await login(conta.email, SENHA_CONTA) };
}

describe('contas que já nascem com ciência', () => {
  it('seed de contrato (u-000/u-001/u-002) e criarUsuario padrão: ciência da versão em vigor', async () => {
    for (const userId of ['u-000', 'u-001', 'u-002'])
      assert.ok(await prisma.monitoringAcknowledgement.findUnique({ where: { userId_versao: { userId, versao: VERSAO_AVISO } } }), userId);
    const nova = await criarUsuario(admin, 'Colaborador', 'gate-padrao');
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: nova.id, versao: VERSAO_AVISO } }), 1);
  });

  it('{ cienciaAviso: false }: a conta (como a criada pela API) nasce sem ciência', async () => {
    const { id } = await criarUsuario(admin, 'Colaborador', 'gate-sem', { cienciaAviso: false });
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: id } }), 0);
  });
});

describe('bloqueio sem ciência', () => {
  it('GET /me responde 200 com cienciaAvisoPendente=true; as outras rotas protegidas, 403, para qualquer perfil', async () => {
    for (const perfil of ['Administrador', 'Analista', 'Colaborador'] as const) {
      const { id, email, token } = await semCiencia(perfil, `gate-bloq-${perfil.toLowerCase()}`);
      const me = await chamar('GET', '/me', { token });
      assert.equal(me.status, 200);
      assert.deepEqual(Object.keys(me.body.dados).sort(), CAMPOS_ME);
      assert.equal(me.body.dados.cienciaAvisoPendente, true);
      assert.equal(me.body.dados.id, id);
      assert.equal(me.body.dados.email, email.toLowerCase());
      assert.equal(me.body.dados.perfil, perfil);
      const r = await chamar('GET', '/dashboard', { token });
      esperaErro(r, 403, PENDENTE);
      assert.equal(r.body.mensagem, 'Confirme que leu o aviso de monitoramento para usar o Baluarte');
      esperaErro(await chamar('GET', '/configuracoes/seguranca', { token }), 403, PENDENTE);
      esperaErro(
        await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_CONTA, novaSenha: 'Outra@12345' } }),
        403,
        PENDENTE,
      );
    }
  });

  it('toda rota autenticada do router (exigeToken) bloqueia sem ciência, com os parâmetros que forem', async () => {
    const { token } = await semCiencia('Administrador', 'gate-todas');
    type Camada = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };
    const protegidas = (apiRouter.stack as Camada[])
      .filter((c) => c.route && c.route.stack[0]?.handle === exigeToken)
      .flatMap((c) => Object.keys(c.route!.methods).map((m) => ({ metodo: m.toUpperCase(), caminho: c.route!.path })));
    assert.ok(protegidas.length > 40, `poucas rotas: ${protegidas.length}`);
    for (const { metodo, caminho } of protegidas) {
      const r = await chamar(metodo, caminho.replace(/:[a-zA-Z]+/g, 'x'), { token, body: metodo === 'GET' ? undefined : {} });
      esperaErro(r, 403, PENDENTE);
    }
  });

  it('o gate vem antes do RBAC e antes da validação: nada é gravado', async () => {
    const adm = await semCiencia('Administrador', 'gate-contrato');
    esperaErro(await chamar('POST', '/users', { token: adm.token, body: { nome: 'X', email: 'x.gate@empresa.com', perfil: 'Analista' } }), 403, PENDENTE);
    esperaErro(await chamar('POST', '/assets', { token: adm.token, body: { nome: 'A', host: '10.9.9.8', tipo: 'Servidor' } }), 403, PENDENTE);
    const colab = await semCiencia('Colaborador', 'gate-rbac');
    // Colaborador sem ciência numa rota de Administrador: o gate responde primeiro (não PERFIL_SEM_PERMISSAO).
    esperaErro(await chamar('GET', '/usuarios', { token: colab.token }), 403, PENDENTE);
    esperaErro(await chamar('GET', '/monitoramento/ciencias', { token: colab.token }), 403, PENDENTE);
    assert.equal(await prisma.user.count({ where: { email: 'x.gate@empresa.com' } }), 0);
    assert.equal(await prisma.asset.count({ where: { host: '10.9.9.8' } }), 0);
  });

  it('sem token continua 401 (o gate vem depois da sessão), inclusive nas exceções', async () => {
    esperaErro(await chamar('GET', '/me'), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', AVISO), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('POST', CIENCIA, { body: { versao: VERSAO_AVISO } }), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', AVISO, { token: 'x.y.z' }), 401, 'TOKEN_INVALIDO');
  });

  it('ciência de versão ANTIGA não libera: /me diz pendente e as outras rotas seguem 403', async () => {
    const { id, token } = await semCiencia('Analista', 'gate-antiga');
    await prisma.monitoringAcknowledgement.createMany({ data: [{ userId: id, versao: '2026-10-08' }, { userId: id, versao: '2026-10-10' }] });
    assert.notEqual(VERSAO_AVISO, '2026-10-10');
    const me = await chamar('GET', '/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.dados.cienciaAvisoPendente, true);
    esperaErro(await chamar('GET', '/dashboard', { token }), 403, PENDENTE);
    const aviso = await chamar('GET', AVISO, { token });
    assert.deepEqual(aviso.body.dados.ciencia, { registrada: false, registradaEm: null });
    assert.equal((await chamar('POST', CIENCIA, { token, body: { versao: VERSAO_AVISO } })).status, 201);
    assert.equal((await chamar('GET', '/me', { token })).body.dados.cienciaAvisoPendente, false);
    assert.equal((await chamar('GET', '/dashboard', { token })).status, 200);
  });

  it('com ciência da versão atual, /me responde 200 com cienciaAvisoPendente=false e os mesmos campos', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'gate-com');
    const token = await login(conta.email, SENHA_CONTA);
    const me = await chamar('GET', '/me', { token });
    assert.equal(me.status, 200);
    assert.deepEqual(Object.keys(me.body.dados).sort(), CAMPOS_ME);
    assert.equal(me.body.dados.cienciaAvisoPendente, false);
    // Seed de contrato (u-000, com ciência): mesma resposta de antes + o campo novo.
    const adm = await chamar('GET', '/me', { token: admin });
    assert.deepEqual(Object.keys(adm.body.dados).sort(), CAMPOS_ME);
    assert.equal(adm.body.dados.cienciaAvisoPendente, false);
    assert.equal(adm.body.dados.id, 'u-000');
  });
});

describe('exceções liberadas sem ciência (só exigeSessao)', () => {
  it('login devolve o token com a mesma resposta de sempre', async () => {
    const { email } = await criarUsuario(admin, 'Analista', 'gate-login', { cienciaAviso: false });
    const r = await chamar('POST', '/login', { body: { email, senha: SENHA_CONTA } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mensagem, 'Autenticado com sucesso');
    assert.deepEqual(Object.keys(r.body.dados).sort(), ['email', 'idUsuario', 'perfil', 'token']);
  });

  it('GET /monitoramento/aviso: texto, versão e ciência não registrada', async () => {
    const { token } = await semCiencia('Colaborador', 'gate-ler');
    const r = await chamar('GET', AVISO, { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.versao, VERSAO_AVISO);
    assert.deepEqual(r.body.dados.ciencia, { registrada: false, registradaEm: null });
  });

  it('renovação da sessão funciona e o token novo continua bloqueado fora das exceções', async () => {
    const { token } = await semCiencia('Analista', 'gate-renovar');
    const r = await chamar('POST', '/auth/renovar', { token });
    assert.equal(r.status, 200);
    const novo = r.body.dados.token as string;
    assert.equal((await chamar('GET', AVISO, { token: novo })).status, 200);
    assert.equal((await chamar('GET', '/me', { token: novo })).body.dados.cienciaAvisoPendente, true);
    esperaErro(await chamar('GET', '/dashboard', { token: novo }), 403, PENDENTE);
  });

  it('logout funciona e encerra a sessão (depois dele, 401 até nas exceções)', async () => {
    const { token } = await semCiencia('Colaborador', 'gate-logout');
    assert.equal((await chamar('POST', '/auth/logout', { token })).status, 200);
    esperaErro(await chamar('GET', AVISO, { token }), 401, 'SESSAO_ENCERRADA');
  });

  it('POST /monitoramento/ciencia libera o acesso com o MESMO token (o gate lê o banco a cada requisição)', async () => {
    const { id, token } = await semCiencia('Colaborador', 'gate-liberar');
    esperaErro(await chamar('GET', '/dashboard', { token }), 403, PENDENTE);
    esperaErro(await chamar('POST', CIENCIA, { token, body: { versao: '1999-01-01' } }), 409, 'VERSAO_DESATUALIZADA');
    esperaErro(await chamar('GET', '/dashboard', { token }), 403, PENDENTE);
    assert.equal((await chamar('GET', '/me', { token })).body.dados.cienciaAvisoPendente, true);
    const r = await chamar('POST', CIENCIA, { token, body: { versao: VERSAO_AVISO } });
    assert.equal(r.status, 201);
    assert.equal((await chamar('GET', '/me', { token })).body.dados.cienciaAvisoPendente, false);
    assert.equal((await chamar('GET', '/dashboard', { token })).status, 200);
    assert.equal(await prisma.auditLog.count({ where: { acao: 'REGISTRAR_CIENCIA_MONITORAMENTO', usuarioId: id } }), 1);
  });
});

describe('RBAC depois da ciência não muda', () => {
  it('cada perfil segue com o mesmo acesso', async () => {
    const colab = await semCiencia('Colaborador', 'gate-rbac-colab');
    const analista = await semCiencia('Analista', 'gate-rbac-analista');
    for (const c of [colab, analista]) assert.equal((await chamar('POST', CIENCIA, { token: c.token, body: { versao: VERSAO_AVISO } })).status, 201);
    esperaErro(await chamar('GET', '/usuarios', { token: colab.token }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/usuarios', { token: analista.token }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/assets', { token: colab.token }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/estacoes', { token: colab.token }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('GET', '/monitoramento/ciencias', { token: analista.token }), 403, 'PERFIL_SEM_PERMISSAO');
    assert.equal((await chamar('GET', '/assets', { token: analista.token })).status, 200);
    assert.equal((await chamar('GET', '/estacoes', { token: analista.token })).status, 200);
    assert.equal((await chamar('GET', '/usuarios', { token: admin })).status, 200);
    assert.equal((await chamar('GET', '/monitoramento/ciencias', { token: admin })).status, 200);
  });
});

describe('rotas públicas não passam pelo gate', () => {
  it('link do e-mail de treinamento de quem não deu ciência abre, conclui e reporta sem login', async () => {
    const { id, email } = await criarUsuario(admin, 'Colaborador', 'gate-link', { cienciaAviso: false });
    const tokenLink = 'd'.repeat(64);
    await prisma.campaign.create({
      data: {
        nome: 'Campanha gate',
        template: 'curiosidade',
        status: 'ATIVA',
        eventos: { create: [{ userId: id, destinatario: email, enviadoEm: new Date(), tokenHash: hashToken(tokenLink) }] },
      },
    });
    assert.equal((await chamar('GET', `/treinamentos/link/${tokenLink}`)).status, 200);
    assert.equal((await chamar('POST', `/treinamentos/link/${tokenLink}/concluir`)).status, 200);
    assert.equal((await chamar('POST', `/treinamentos/link/${tokenLink}/reportar`)).status, 200);
  });

  it('agente osquery, convite/redefinição e a classificação CVSS respondem como sempre (sem 401/403)', async () => {
    const enroll = await chamar('POST', '/agentes/osquery/enroll', { body: { enroll_secret: 'x', host_identifier: 'h' } });
    assert.ok(![401, 403].includes(enroll.status), `enroll respondeu ${enroll.status}`);
    assert.equal((await chamar('POST', '/auth/reset-password', { body: { email: 'ninguem.gate@empresa.com' } })).status, 200);
    const link = await chamar('POST', '/auth/link/verificar', { body: { token: 'f'.repeat(64) } });
    assert.ok(![401, 403].includes(link.status), `link/verificar respondeu ${link.status}`);
    // Rota pública do contrato: nem com o token de quem não deu ciência ela passa a bloquear.
    const { token } = await semCiencia('Analista', 'gate-publica');
    const cvss = await chamar('GET', '/findings/classificacao?cvss=7.5', { token });
    assert.equal(cvss.status, 200);
    assert.equal(cvss.body.dados.faixa, 'Alto');
  });
});

describe('USUARIO_COM_CIENCIA continua valendo (decisão do Leo: conta usada não é excluível, só inativável)', () => {
  // Com o gate, toda conta que chegou a usar o Baluarte tem ciência; logo, pela API, só conta
  // que nunca passou do gate (convite não aceito, ou ativa sem ciência) é excluível.
  it('conta que deu ciência para usar: 409 USUARIO_COM_CIENCIA; inativar funciona e tira o acesso', async () => {
    const u = await semCiencia('Colaborador', 'gate-excluir');
    assert.equal((await chamar('POST', CIENCIA, { token: u.token, body: { versao: VERSAO_AVISO } })).status, 201);
    esperaErro(await chamar('DELETE', `/users/${u.id}`, { token: admin }), 409, 'USUARIO_COM_CIENCIA');
    assert.equal((await chamar('PATCH', `/users/${u.id}`, { token: admin, body: { status: 'Inativo' } })).status, 200);
    esperaErro(await chamar('GET', AVISO, { token: u.token }), 401, 'USUARIO_INATIVO');
    assert.equal(await prisma.monitoringAcknowledgement.count({ where: { userId: u.id } }), 1);
  });

  it('conta que nunca deu ciência continua excluível', async () => {
    const { id } = await criarUsuario(admin, 'Colaborador', 'gate-excluivel', { cienciaAviso: false });
    assert.equal((await chamar('DELETE', `/users/${id}`, { token: admin })).status, 200);
  });
});
