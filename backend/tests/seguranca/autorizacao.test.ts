// Pentest automatizado — AUTORIZAÇÃO E AUTENTICAÇÃO (OWASP A01/A07).
// Prova o RBAC do servidor contra a API REST real do Baluarte, num SQLite ISOLADO
// (ver helpers.ts). Cada it() é independente e determinístico.
//
// Vetores cobertos:
//  - Tokens forjados/adulterados: sem token, "Bearer " vazio, esquema não-Bearer,
//    assinatura de outro segredo, alg=none, payload editado, exp no passado,
//    idUsuario apontando para conta inexistente.
//  - Escalada vertical/horizontal: Colaborador nas rotas de operador/admin,
//    Analista nas rotas de admin, Colaborador forjando perfil "Administrador" no JWT
//    (o servidor relê o perfil do banco), criação de Administrador por não-admin.
//  - IDOR: Colaborador concluindo o treinamento de OUTRO destinatário.
//  - Perfil defasado no token após rebaixamento.
//  - Sessão: conta inativada/excluída perde acesso na hora; senha redefinida
//    encerra sessões antigas.
//  - Proteções: não inativar/excluir a própria conta; não rebaixar o último admin.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  prepararBanco,
  iniciarServidor,
  encerrarServidor,
  chamar,
  login,
  esperaErro,
  criarUsuario,
  emailUnico,
  ADMIN,
  ANALISTA,
  SENHA_PROVISORIA,
} from '../helpers.js';

prepararBanco(import.meta.url);
const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/db.js');

// prepararBanco já apontou JWT_SECRET para o segredo de teste — é o mesmo que o
// servidor usa, então conseguimos forjar tokens "bem assinados" e provar que a
// assinatura válida NÃO basta (o servidor ainda relê perfil/status do banco).
const SEGREDO = process.env.JWT_SECRET as string;

function forjar(payload: Record<string, unknown>, opts: jwt.SignOptions = { expiresIn: '30m' }): string {
  return jwt.sign(payload, SEGREDO, opts);
}

let admin: string;
let analista: string;
let colaborador: string;
let contaColab: { id: string; email: string };

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  contaColab = await criarUsuario(admin, 'Colaborador', 'authz-colab');
  colaborador = await login(contaColab.email, SENHA_PROVISORIA);
});

after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------
describe('tokens forjados e adulterados → 401', () => {
  it('sem cabeçalho Authorization → TOKEN_AUSENTE', async () => {
    esperaErro(await chamar('GET', '/me'), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('POST', '/assets', { body: { nome: 'X', tipo: 'Rede', host: '10.0.0.1' } }), 401, 'TOKEN_AUSENTE');
  });

  it('esquema Bearer sem credencial válida é rejeitado (401)', async () => {
    // O transporte HTTP remove o espaço em branco à direita do valor do cabeçalho,
    // então "Bearer " chega como "Bearer" (sem credencial): a app rejeita como
    // TOKEN_INVALIDO — ainda 401, uma negação segura. O caminho TOKEN_AUSENTE fica
    // provado pelo cabeçalho ausente (teste anterior).
    esperaErro(await chamar('GET', '/me', { headers: { Authorization: 'Bearer' } }), 401, 'TOKEN_INVALIDO');
    esperaErro(await chamar('GET', '/me', { headers: { Authorization: 'Bearer nao-e-um-jwt' } }), 401, 'TOKEN_INVALIDO');
  });

  it('esquema não-Bearer com credencial arbitrária → TOKEN_INVALIDO', async () => {
    esperaErro(await chamar('GET', '/me', { headers: { Authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l' } }), 401, 'TOKEN_INVALIDO');
    esperaErro(await chamar('GET', '/me', { headers: { Authorization: 'Token abc.def.ghi' } }), 401, 'TOKEN_INVALIDO');
  });

  it('token assinado com OUTRO segredo → TOKEN_INVALIDO', async () => {
    const forasteiro = jwt.sign({ idUsuario: 'u-000', email: ADMIN.email, perfil: 'Administrador' }, 'segredo-do-atacante', { expiresIn: '30m' });
    esperaErro(await chamar('GET', '/me', { token: forasteiro }), 401, 'TOKEN_INVALIDO');
    esperaErro(await chamar('GET', '/usuarios', { token: forasteiro }), 401, 'TOKEN_INVALIDO');
  });

  it('token com alg=none → TOKEN_INVALIDO (não aceita algoritmo sem assinatura)', async () => {
    const semAssinatura = jwt.sign(
      { idUsuario: 'u-000', email: ADMIN.email, perfil: 'Administrador' },
      null as unknown as string,
      { algorithm: 'none' },
    );
    esperaErro(await chamar('GET', '/me', { token: semAssinatura }), 401, 'TOKEN_INVALIDO');
    esperaErro(await chamar('GET', '/usuarios', { token: semAssinatura }), 401, 'TOKEN_INVALIDO');
  });

  it('payload editado sem re-assinar (perfil elevado) → TOKEN_INVALIDO', async () => {
    const valido = forjar({ idUsuario: contaColab.id, email: contaColab.email, perfil: 'Colaborador' });
    const [h, p, s] = valido.split('.');
    const corpo = JSON.parse(Buffer.from(p, 'base64url').toString());
    corpo.perfil = 'Administrador';
    corpo.idUsuario = 'u-000';
    const pAdulterado = Buffer.from(JSON.stringify(corpo)).toString('base64url');
    const adulterado = `${h}.${pAdulterado}.${s}`;
    esperaErro(await chamar('GET', '/me', { token: adulterado }), 401, 'TOKEN_INVALIDO');
    esperaErro(await chamar('GET', '/usuarios', { token: adulterado }), 401, 'TOKEN_INVALIDO');
  });

  it('token expirado (exp no passado) → TOKEN_INVALIDO', async () => {
    const expirado = forjar({ idUsuario: 'u-000', email: ADMIN.email, perfil: 'Administrador' }, { expiresIn: '-10s' });
    esperaErro(await chamar('GET', '/me', { token: expirado }), 401, 'TOKEN_INVALIDO');
  });

  it('token bem assinado para idUsuario inexistente → USUARIO_REMOVIDO', async () => {
    const fantasma = forjar({ idUsuario: 'usuario-que-nao-existe', email: 'fantasma@empresa.com', perfil: 'Administrador' });
    esperaErro(await chamar('GET', '/me', { token: fantasma }), 401, 'USUARIO_REMOVIDO');
    // Nem mesmo com perfil "Administrador" no token o fantasma alcança rota de admin.
    esperaErro(await chamar('GET', '/usuarios', { token: fantasma }), 401, 'USUARIO_REMOVIDO');
  });
});

// -----------------------------------------------------------------------------
describe('escalada vertical e horizontal → 403', () => {
  it('Colaborador não opera a plataforma (scans, assets, campaigns, listas técnicas)', async () => {
    esperaErro(await chamar('POST', '/scans', { token: colaborador, body: { ativoId: 'ativo-001' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', '/assets', { token: colaborador, body: { nome: 'X', tipo: 'Rede', host: '10.9.9.9' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', '/campaigns', { token: colaborador, body: { nome: 'X', destinatario: 'a@empresa.com', template: 'urgencia' } }), 403, 'PERFIL_SEM_PERMISSAO');
    for (const rota of ['/vulnerabilidades', '/campanhas', '/assets']) {
      esperaErro(await chamar('GET', rota, { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
    }
    esperaErro(await chamar('PATCH', '/vulnerabilidades/qualquer', { token: colaborador, body: { status: 'Risco aceito' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('DELETE', '/campanhas/qualquer', { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('Colaborador não acessa a gestão de usuários (GET/POST/PATCH/DELETE)', async () => {
    esperaErro(await chamar('GET', '/usuarios', { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', '/users', { token: colaborador, body: { nome: 'X', email: emailUnico('nope'), perfil: 'Colaborador' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', '/users', { token: colaborador, body: { nome: 'X', email: emailUnico('nope'), perfil: 'Administrador' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('PATCH', `/users/${contaColab.id}`, { token: colaborador, body: { nome: 'Z' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('DELETE', `/users/${contaColab.id}`, { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('Analista lê listas técnicas mas não gerencia usuários (GET/PATCH/DELETE /users)', async () => {
    assert.equal((await chamar('GET', '/vulnerabilidades', { token: analista })).status, 200);
    esperaErro(await chamar('GET', '/usuarios', { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('PATCH', `/users/${contaColab.id}`, { token: analista, body: { nome: 'X' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('DELETE', `/users/${contaColab.id}`, { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('Analista não cria Administrador (escalada vertical), mas cria Analista/Colaborador', async () => {
    esperaErro(
      await chamar('POST', '/users', { token: analista, body: { nome: 'Escalada', email: emailUnico('escalada'), perfil: 'Administrador' } }),
      403,
      'PERFIL_SEM_PERMISSAO',
    );
    assert.equal((await chamar('POST', '/users', { token: analista, body: { nome: 'Ok', email: emailUnico('analista.novo'), perfil: 'Analista' } })).status, 201);
    assert.equal((await chamar('POST', '/users', { token: analista, body: { nome: 'Ok', email: emailUnico('colab.novo'), perfil: 'Colaborador' } })).status, 201);
  });

  it('JWT com perfil "Administrador" NÃO vence: o servidor decide pelo perfil do banco → 403', async () => {
    // Token bem assinado, mas o idUsuario é de um Colaborador real. exigePerfil usa o
    // perfil ATUAL do banco (Colaborador), não o que está no JWT.
    const forjado = forjar({ idUsuario: contaColab.id, email: contaColab.email, perfil: 'Administrador' });
    // Sanidade: o token é aceito para uma rota que só exige autenticação.
    const me = await chamar('GET', '/me', { token: forjado });
    assert.equal(me.status, 200);
    assert.equal(me.body.dados.perfil, 'Colaborador', 'o /me reflete o perfil do banco, não o do token');
    // Mas é barrado em toda rota privilegiada.
    esperaErro(await chamar('GET', '/usuarios', { token: forjado }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', '/users', { token: forjado, body: { nome: 'X', email: emailUnico('forjado'), perfil: 'Administrador' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', '/scans', { token: forjado, body: { ativoId: 'ativo-001' } }), 403, 'PERFIL_SEM_PERMISSAO');
  });
});

// -----------------------------------------------------------------------------
describe('IDOR — treinamento pós-clique pertence ao destinatário', () => {
  it('Colaborador não conclui o treinamento de OUTRO destinatário (403), mas o dono conclui (200)', async () => {
    const dono = await criarUsuario(admin, 'Colaborador', 'idor-dono');
    const tokenDono = await login(dono.email, SENHA_PROVISORIA);
    const contaIntruso = await criarUsuario(admin, 'Colaborador', 'idor-intruso');
    const tokenIntruso = await login(contaIntruso.email, SENHA_PROVISORIA);

    const campanha = await prisma.campaign.create({
      data: {
        nome: 'IDOR treino',
        template: 'autoridade',
        status: 'ATIVA',
        eventos: { create: [{ destinatario: dono.email, enviadoEm: new Date(), clicadoEm: new Date() }] },
      },
      include: { eventos: true },
    });
    const tokenTreino = campanha.eventos[0].id;

    // Sem token → 401; intruso (outro colaborador) → 403; token desconhecido → 404.
    esperaErro(await chamar('POST', `/treinamentos/${tokenTreino}/concluir`), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('POST', `/treinamentos/${tokenTreino}/concluir`, { token: tokenIntruso }), 403, 'TREINAMENTO_DE_OUTRO_USUARIO');
    esperaErro(await chamar('POST', '/treinamentos/inexistente/concluir', { token: tokenDono }), 404, 'TREINAMENTO_NAO_ENCONTRADO');

    // O treinamento continua não concluído (a tentativa do intruso não teve efeito).
    const antes = await prisma.campaignEvent.findUnique({ where: { id: tokenTreino } });
    assert.equal(antes!.treinou, false, 'a tentativa do intruso não pode ter marcado o treinamento');

    // O dono conclui o próprio.
    const ok = await chamar('POST', `/treinamentos/${tokenTreino}/concluir`, { token: tokenDono });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.dados.concluido, true);
  });
});

// -----------------------------------------------------------------------------
describe('perfil defasado no token e ciclo de sessão', () => {
  it('rebaixar um admin invalida o poder do token antigo (ainda "Administrador") → 403', async () => {
    const conta2 = await criarUsuario(admin, 'Administrador', 'authz-admin2');
    const token2 = await login(conta2.email, SENHA_PROVISORIA);
    // Com dois admins ativos, o token2 opera a gestão de usuários.
    assert.equal((await chamar('GET', '/usuarios', { token: token2 })).status, 200);

    // u-000 rebaixa o segundo admin para Analista (há 2 admins → permitido).
    const rebaixa = await chamar('PATCH', `/users/${conta2.id}`, { token: admin, body: { perfil: 'Analista' } });
    assert.equal(rebaixa.status, 200);

    // O token2 ainda carrega "Administrador", mas o banco manda: 403.
    esperaErro(await chamar('GET', '/usuarios', { token: token2 }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('DELETE', `/users/${contaColab.id}`, { token: token2 }), 403, 'PERFIL_SEM_PERMISSAO');

    // Limpa: remove o segundo (já Analista) para manter u-000 como único admin.
    assert.equal((await chamar('DELETE', `/users/${conta2.id}`, { token: admin })).status, 200);
  });

  it('conta inativada perde acesso na hora (401 USUARIO_INATIVO) e o login é recusado (403)', async () => {
    const conta = await criarUsuario(admin, 'Analista', 'authz-inativo');
    const token = await login(conta.email, SENHA_PROVISORIA);
    assert.equal((await chamar('GET', '/me', { token })).status, 200);

    assert.equal((await chamar('PATCH', `/users/${conta.id}`, { token: admin, body: { status: 'Inativo' } })).status, 200);

    esperaErro(await chamar('GET', '/me', { token }), 401, 'USUARIO_INATIVO');
    esperaErro(await chamar('GET', '/vulnerabilidades', { token }), 401, 'USUARIO_INATIVO');
    esperaErro(await chamar('POST', '/login', { body: { email: conta.email, senha: SENHA_PROVISORIA } }), 403, 'USUARIO_INATIVO');
  });

  it('conta excluída invalida o token na hora → 401 USUARIO_REMOVIDO', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'authz-removido');
    const token = await login(conta.email, SENHA_PROVISORIA);
    assert.equal((await chamar('GET', '/me', { token })).status, 200);

    assert.equal((await chamar('DELETE', `/users/${conta.id}`, { token: admin })).status, 200);

    esperaErro(await chamar('GET', '/me', { token }), 401, 'USUARIO_REMOVIDO');
    esperaErro(await chamar('GET', '/configuracoes/notificacoes', { token }), 401, 'USUARIO_REMOVIDO');
  });

  it('redefinição de senha encerra as sessões abertas antes → 401 SENHA_REDEFINIDA', async () => {
    const conta = await criarUsuario(admin, 'Analista', 'authz-senha');
    const token = await login(conta.email, SENHA_PROVISORIA);
    assert.equal((await chamar('GET', '/me', { token })).status, 200);

    // Marca a senha como redefinida DEPOIS da emissão do token (o servidor compara iat).
    await prisma.user.update({ where: { id: conta.id }, data: { senhaAlteradaEm: new Date(Date.now() + 60_000) } });

    esperaErro(await chamar('GET', '/me', { token }), 401, 'SENHA_REDEFINIDA');
    esperaErro(await chamar('GET', '/vulnerabilidades', { token }), 401, 'SENHA_REDEFINIDA');
  });
});

// -----------------------------------------------------------------------------
describe('proteções da gestão de administradores', () => {
  it('o admin não inativa nem exclui a própria conta (422)', async () => {
    esperaErro(await chamar('PATCH', '/users/u-000', { token: admin, body: { status: 'Inativo' } }), 422, 'AUTO_INATIVACAO');
    esperaErro(await chamar('DELETE', '/users/u-000', { token: admin }), 422, 'AUTO_EXCLUSAO');
  });

  it('não é possível rebaixar nem excluir o último administrador ativo (409 ULTIMO_ADMIN)', async () => {
    // Neste ponto u-000 é o único Administrador do banco.
    const outrosAdmins = await prisma.user.count({ where: { perfil: 'Administrador', status: { not: 'Inativo' }, id: { not: 'u-000' } } });
    assert.equal(outrosAdmins, 0, 'pré-condição: u-000 deve ser o único admin ativo');

    esperaErro(await chamar('PATCH', '/users/u-000', { token: admin, body: { perfil: 'Analista' } }), 409, 'ULTIMO_ADMIN');
    // u-000 continua Administrador e operando normalmente.
    assert.equal((await chamar('GET', '/usuarios', { token: admin })).status, 200);
  });
});
