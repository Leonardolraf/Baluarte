// Testes do ciclo de conta: cadastro por convite (sem senha provisoria), reenvio do
// convite, verificacao do link, logout no servidor, renovacao da sessao, bloqueio de
// login guardado no banco e auditoria do login. Banco isolado (ver helpers.ts).
import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import {
  ADMIN,
  ANALISTA,
  SENHA_CONTA,
  chamar,
  criarUsuario,
  criarUsuarioPendente,
  emailUnico,
  encerrarServidor,
  esperaErro,
  iniciarServidor,
  login,
  prepararBanco,
  tokenDoEmail,
} from './helpers.js';

prepararBanco(import.meta.url);

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/db.js');
const { caixaDeSaida } = await import('../src/config/email.js');
const { limparLimiteReset } = await import('../src/services/auth.service.js');
const { limparLimiteLogin } = await import('../src/services/auth.service.js');

let admin = '';
let analista = '';

before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
});

after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------

describe('cadastro por convite', () => {
  it('POST /users cria a conta Pendente, envia o convite por e-mail e não guarda o token em claro', async () => {
    const email = emailUnico('convite');
    const r = await chamar('POST', '/users', { token: admin, body: { nome: 'Pessoa Convidada', email, perfil: 'Colaborador' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.dados.conviteEnviado, true);

    const enviado = [...caixaDeSaida].reverse().find((e) => e.para === email.toLowerCase());
    assert.ok(enviado, 'esperava o e-mail de convite');
    assert.match(enviado.assunto, /crie sua senha/i);
    assert.match(enviado.texto, /Olá, Pessoa Convidada/);
    assert.match(enviado.texto, /válido por 24 horas/);
    assert.doesNotMatch(enviado.texto, /Mudar@123/);

    const token = await tokenDoEmail(email, 'definir-senha');
    assert.ok(token);
    const registro = await prisma.passwordResetToken.findFirst({ where: { userId: r.body.dados.idUsuario } });
    assert.equal(registro?.tipo, 'CONVITE');
    assert.notEqual(registro?.tokenHash, token, 'no banco fica só o hash');
    const validade = registro!.expiraEm.getTime() - registro!.criadoEm.getTime();
    assert.ok(Math.abs(validade - 24 * 3600 * 1000) < 5000, `validade de 24 h, veio ${validade} ms`);

    const auditoria = await prisma.auditLog.findMany({ where: { acao: { in: ['CRIAR_USUARIO', 'ENVIAR_CONVITE'] }, detalhe: { contains: email.toLowerCase() } } });
    assert.equal(auditoria.length, 2);
  });

  it('conta Pendente não entra por login; o convite cadastra a senha e ativa a conta', async () => {
    const conta = await criarUsuarioPendente(admin, 'Analista', 'aceite');
    esperaErro(await chamar('POST', '/login', { body: { email: conta.email, senha: SENHA_CONTA } }), 401, 'CREDENCIAIS_INVALIDAS');

    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: 'fraca' } }), 400, 'SENHA_FRACA');
    const r = await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: 'Primeira@1' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mensagem, 'Senha cadastrada com sucesso');

    const token = await login(conta.email, 'Primeira@1');
    // Conta nova ainda precisa dar ciência do aviso de monitoramento antes de usar o resto.
    esperaErro(await chamar('GET', '/me', { token }), 403, 'CIENCIA_AVISO_PENDENTE');
    const { versao } = (await chamar('GET', '/monitoramento/aviso', { token })).body.dados;
    assert.equal((await chamar('POST', '/monitoramento/ciencia', { token, body: { versao } })).status, 201);
    assert.equal((await chamar('GET', '/me', { token })).body.dados.status, 'Ativo');
    // Uso único.
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: 'Segunda@1' } }), 400, 'TOKEN_RESET_INVALIDO');
    assert.ok(await prisma.auditLog.findFirst({ where: { usuarioId: conta.id, acao: 'ACEITAR_CONVITE' } }));
  });

  it('conta Pendente antiga, com senha conhecida, recebe 403 CONTA_PENDENTE', async () => {
    // Simula uma conta criada antes do convite (senha provisória fixa).
    const conta = await criarUsuarioPendente(admin, 'Colaborador', 'legado');
    const bcrypt = (await import('bcryptjs')).default;
    await prisma.user.update({ where: { id: conta.id }, data: { senhaHash: await bcrypt.hash('Mudar@123', 10) } });
    esperaErro(await chamar('POST', '/login', { body: { email: conta.email, senha: 'Mudar@123' } }), 403, 'CONTA_PENDENTE');
  });

  it('convite expirado é recusado', async () => {
    const conta = await criarUsuarioPendente(admin, 'Colaborador', 'expirado');
    await prisma.passwordResetToken.updateMany({ where: { userId: conta.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: 'Tarde@1234' } }), 400, 'TOKEN_RESET_INVALIDO');
  });

  it('"esqueci a senha" de uma conta Pendente manda um convite novo, não um link de redefinição', async () => {
    await limparLimiteReset();
    const conta = await criarUsuarioPendente(admin, 'Colaborador', 'esqueci');
    assert.equal((await chamar('POST', '/auth/reset-password', { body: { email: conta.email } })).status, 200);
    const novo = await tokenDoEmail(conta.email, 'definir-senha');
    assert.ok(novo);
    assert.notEqual(novo, conta.convite);
    assert.equal(await tokenDoEmail(conta.email, 'reset-password'), null);
    // O convite anterior deixou de valer.
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: 'Velho@1234' } }), 400, 'TOKEN_RESET_INVALIDO');
    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token: novo, novaSenha: 'Novo@12345' } })).status, 200);
  });
});

describe('POST /users/:id/convite (reenvio)', () => {
  it('reenvia para conta Pendente e invalida o convite anterior', async () => {
    const conta = await criarUsuarioPendente(admin, 'Colaborador', 'reenvio');
    const r = await chamar('POST', `/users/${conta.id}/convite`, { token: analista });
    assert.equal(r.status, 200);
    assert.match(r.body.mensagem, /Convite reenviado/);
    const novo = await tokenDoEmail(conta.email, 'definir-senha');
    assert.notEqual(novo, conta.convite);
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: 'Antigo@123' } }), 400, 'TOKEN_RESET_INVALIDO');
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: conta.id, tipo: 'CONVITE', usadoEm: null } }), 1);
  });

  it('recusa conta que já está ativa (409) e usuário inexistente (404)', async () => {
    const ativa = await criarUsuario(admin, 'Colaborador', 'ja-ativa');
    esperaErro(await chamar('POST', `/users/${ativa.id}/convite`, { token: admin }), 409, 'USUARIO_NAO_PENDENTE');
    esperaErro(await chamar('POST', '/users/nao-existe/convite', { token: admin }), 404, 'USUARIO_NAO_ENCONTRADO');
  });

  it('RBAC: Colaborador não reenvia; Analista não reenvia convite de Administrador', async () => {
    const colab = await criarUsuario(admin, 'Colaborador', 'rbac-conv');
    const tokenColab = await login(colab.email, SENHA_CONTA);
    const pendente = await criarUsuarioPendente(admin, 'Colaborador', 'rbac-alvo');
    esperaErro(await chamar('POST', `/users/${pendente.id}/convite`, { token: tokenColab }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', `/users/${pendente.id}/convite`), 401, 'TOKEN_AUSENTE');

    const novoAdmin = await criarUsuarioPendente(admin, 'Administrador', 'rbac-admin');
    esperaErro(await chamar('POST', `/users/${novoAdmin.id}/convite`, { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
    assert.equal((await chamar('POST', `/users/${novoAdmin.id}/convite`, { token: admin })).status, 200);
  });
});

describe('POST /auth/link/verificar', () => {
  it('devolve tipo, nome e e-mail de um link válido, sem consumi-lo', async () => {
    const conta = await criarUsuarioPendente(admin, 'Colaborador', 'verifica');
    const r = await chamar('POST', '/auth/link/verificar', { body: { token: conta.convite } });
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.tipo, 'CONVITE');
    assert.equal(r.body.dados.nome, 'Usuário verifica');
    assert.equal(r.body.dados.email, conta.email.toLowerCase());
    assert.equal(r.body.dados.tokenHash, undefined);
    // Continua valendo depois da verificação.
    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: 'Valida@123' } })).status, 200);
    esperaErro(await chamar('POST', '/auth/link/verificar', { body: { token: conta.convite } }), 400, 'TOKEN_RESET_INVALIDO');
  });

  it('token ausente, inventado ou de tipo errado -> 400', async () => {
    esperaErro(await chamar('POST', '/auth/link/verificar', { body: {} }), 400, 'TOKEN_OBRIGATORIO');
    esperaErro(await chamar('POST', '/auth/link/verificar', { body: { token: 'f'.repeat(64) } }), 400, 'TOKEN_RESET_INVALIDO');
    esperaErro(await chamar('POST', '/auth/link/verificar', { body: { token: { $ne: null } } }), 400, 'TOKEN_RESET_INVALIDO');
  });
});

describe('sessão: logout, renovação e troca de senha', () => {
  it('logout invalida o token no servidor e é auditado; um login novo funciona', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'logout');
    // Logout logo depois do login (sem espera): a emissao em milissegundos separa os dois.
    const token = await login(conta.email, SENHA_CONTA);
    assert.equal((await chamar('POST', '/auth/logout', { token })).status, 200);
    esperaErro(await chamar('GET', '/me', { token }), 401, 'SESSAO_ENCERRADA');
    esperaErro(await chamar('POST', '/auth/logout'), 401, 'TOKEN_AUSENTE');
    assert.ok(await prisma.auditLog.findFirst({ where: { usuarioId: conta.id, acao: 'LOGOUT' } }));

    const novo = await login(conta.email, SENHA_CONTA);
    assert.equal((await chamar('GET', '/me', { token: novo })).status, 200);
  });

  it('renovar devolve um token novo com o perfil atual do banco e o mesmo início de sessão', async () => {
    const conta = await criarUsuario(admin, 'Analista', 'renova');
    const token = await login(conta.email, SENHA_CONTA);
    const inicio = (jwt.decode(token) as { inicioSessao: number }).inicioSessao;
    assert.equal((await chamar('PATCH', `/users/${conta.id}`, { token: admin, body: { perfil: 'Colaborador' } })).status, 200);
    await sleep(1100);

    const r = await chamar('POST', '/auth/renovar', { token });
    assert.equal(r.status, 200);
    const novo = jwt.decode(r.body.dados.token) as { perfil: string; inicioSessao: number; iat: number };
    assert.equal(novo.perfil, 'Colaborador');
    assert.equal(novo.inicioSessao, inicio);
    assert.ok(novo.iat > inicio);
  });

  it('renovar recusa sessão iniciada há mais de 8 h', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'renova-max');
    const antigo = Math.floor(Date.now() / 1000) - 8 * 3600 - 60;
    const forjado = jwt.sign(
      { idUsuario: conta.id, email: conta.email, perfil: 'Colaborador', inicioSessao: antigo },
      'segredo-somente-para-testes',
      { expiresIn: '30m' },
    );
    esperaErro(await chamar('POST', '/auth/renovar', { token: forjado }), 401, 'SESSAO_EXPIRADA');
  });

  it('trocar a senha encerra as outras sessões e devolve um token novo para a atual', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'troca');
    const outraSessao = await login(conta.email, SENHA_CONTA);
    const atual = await login(conta.email, SENHA_CONTA);
    await sleep(1200);
    const r = await chamar('POST', '/auth/change-password', { token: atual, body: { senhaAtual: SENHA_CONTA, novaSenha: 'Trocada@12' } });
    assert.equal(r.status, 200);
    esperaErro(await chamar('GET', '/me', { token: outraSessao }), 401, 'SENHA_REDEFINIDA');
    esperaErro(await chamar('GET', '/me', { token: atual }), 401, 'SENHA_REDEFINIDA');
    assert.equal((await chamar('GET', '/me', { token: r.body.dados.token })).status, 200);
  });
});

describe('login: bloqueio guardado no banco e auditoria', () => {
  before(() => limparLimiteLogin());
  after(() => limparLimiteLogin());

  it('as falhas ficam na tabela LoginFailure (sobrevivem a reiniciar a API) e o bloqueio é auditado', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'bloqueio');
    for (let i = 0; i < 5; i++) {
      esperaErro(await chamar('POST', '/login', { body: { email: conta.email, senha: 'Errada@123' } }), 401, 'CREDENCIAIS_INVALIDAS');
    }
    assert.equal(await prisma.loginFailure.count({ where: { email: conta.email.toLowerCase() } }), 5);
    // Nada em memória: o estado do banco sozinho mantém o bloqueio.
    esperaErro(await chamar('POST', '/login', { body: { email: conta.email, senha: SENHA_CONTA } }), 429, 'MUITAS_TENTATIVAS');
    assert.equal(await prisma.auditLog.count({ where: { usuarioId: conta.id, acao: 'LOGIN_BLOQUEADO' } }), 1);
  });

  it('falhas fora da janela de 15 min não contam e são podadas', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'janela');
    const velho = new Date(Date.now() - 16 * 60 * 1000);
    await prisma.loginFailure.createMany({ data: Array.from({ length: 5 }, () => ({ email: conta.email.toLowerCase(), criadoEm: velho })) });
    assert.equal((await chamar('POST', '/login', { body: { email: conta.email, senha: SENHA_CONTA } })).status, 200);
    await chamar('POST', '/login', { body: { email: emailUnico('poda'), senha: 'Errada@123' } });
    assert.equal(await prisma.loginFailure.count({ where: { criadoEm: { lt: new Date(Date.now() - 15 * 60 * 1000) } } }), 0);
  });

  it('redefinir a senha pelo link tira a conta do bloqueio', async () => {
    await limparLimiteReset();
    const conta = await criarUsuario(admin, 'Colaborador', 'desbloqueio');
    for (let i = 0; i < 5; i++) await chamar('POST', '/login', { body: { email: conta.email, senha: 'Errada@123' } });
    esperaErro(await chamar('POST', '/login', { body: { email: conta.email, senha: SENHA_CONTA } }), 429, 'MUITAS_TENTATIVAS');

    await chamar('POST', '/auth/reset-password', { body: { email: conta.email } });
    const token = await tokenDoEmail(conta.email, 'reset-password');
    assert.ok(token);
    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'Desbloq@12' } })).status, 200);
    await login(conta.email, 'Desbloq@12');
  });

  it('login com sucesso é auditado', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'audit-login');
    await login(conta.email, SENHA_CONTA);
    assert.ok(await prisma.auditLog.findFirst({ where: { usuarioId: conta.id, acao: 'LOGIN' } }));
  });
});

describe('redefinição pelo link não aceita a senha atual', () => {
  it('reset com a mesma senha -> 400 SENHA_REPETIDA, sem consumir o link; outra senha passa', async () => {
    await limparLimiteReset();
    const conta = await criarUsuario(admin, 'Colaborador', 'reset-igual');
    await chamar('POST', '/auth/reset-password', { body: { email: conta.email } });
    const token = await tokenDoEmail(conta.email, 'reset-password');
    assert.ok(token);

    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: SENHA_CONTA } }), 400, 'SENHA_REPETIDA');
    // O link continua valendo e a senha atual também.
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: conta.id, tipo: 'RESET', usadoEm: null } }), 1);
    await login(conta.email, SENHA_CONTA);

    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'Diferente@12' } })).status, 200);
    await login(conta.email, 'Diferente@12');
  });

  it('convite aceita a primeira senha (o hash da conta pendente é descartável e nunca casa)', async () => {
    const conta = await criarUsuarioPendente(admin, 'Colaborador', 'convite-primeira');
    const r = await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: SENHA_CONTA } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mensagem, 'Senha cadastrada com sucesso');
  });
});

describe('POST /users/:id/redefinir-senha (administrador dispara o link)', () => {
  it('envia o link de redefinição para conta ativa, audita quem pediu e o link troca a senha', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'admin-reset');
    const r = await chamar('POST', `/users/${conta.id}/redefinir-senha`, { token: admin });
    assert.equal(r.status, 200);
    assert.match(r.body.mensagem, /Link de redefinição enviado/);
    const token = await tokenDoEmail(conta.email, 'reset-password');
    assert.ok(token, 'esperava o e-mail com o link de redefinição');

    const adminId = (await prisma.user.findUnique({ where: { email: ADMIN.email } }))!.id;
    assert.ok(await prisma.auditLog.findFirst({ where: { usuarioId: adminId, acao: 'ENVIAR_RESET_SENHA', detalhe: conta.email.toLowerCase() } }));

    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'PeloAdmin@1' } })).status, 200);
    await login(conta.email, 'PeloAdmin@1');
  });

  it('não gasta o limite de pedidos do dono da conta', async () => {
    await limparLimiteReset();
    const conta = await criarUsuario(admin, 'Colaborador', 'admin-reset-limite');
    for (let i = 0; i < 4; i++) assert.equal((await chamar('POST', `/users/${conta.id}/redefinir-senha`, { token: admin })).status, 200);
    assert.equal((await chamar('POST', '/auth/reset-password', { body: { email: conta.email } })).status, 200);
  });

  it('conta Pendente ou Inativa -> 409; inexistente -> 404', async () => {
    const pendente = await criarUsuarioPendente(admin, 'Colaborador', 'admin-reset-pend');
    esperaErro(await chamar('POST', `/users/${pendente.id}/redefinir-senha`, { token: admin }), 409, 'USUARIO_NAO_ATIVO');
    const inativa = await criarUsuario(admin, 'Colaborador', 'admin-reset-inat');
    assert.equal((await chamar('PATCH', `/users/${inativa.id}`, { token: admin, body: { status: 'Inativo' } })).status, 200);
    esperaErro(await chamar('POST', `/users/${inativa.id}/redefinir-senha`, { token: admin }), 409, 'USUARIO_NAO_ATIVO');
    esperaErro(await chamar('POST', '/users/nao-existe/redefinir-senha', { token: admin }), 404, 'USUARIO_NAO_ENCONTRADO');
  });

  it('RBAC: só Administrador (Analista e Colaborador -> 403; sem token -> 401)', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'admin-reset-rbac');
    const tokenColab = await login(conta.email, SENHA_CONTA);
    esperaErro(await chamar('POST', `/users/${conta.id}/redefinir-senha`, { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', `/users/${conta.id}/redefinir-senha`, { token: tokenColab }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('POST', `/users/${conta.id}/redefinir-senha`), 401, 'TOKEN_AUSENTE');
  });
});

// -----------------------------------------------------------------------------
// #4: aviso "sua senha foi alterada" ao dono da conta, sem link nem credencial.

describe('aviso de senha alterada (#4)', () => {
  const ASSUNTO = 'Baluarte: sua senha foi alterada';
  const avisosPara = (email: string, desde: number) =>
    caixaDeSaida.slice(desde).filter((e) => e.para === email.toLowerCase() && e.assunto === ASSUNTO);

  function semCredencial(texto: string) {
    assert.doesNotMatch(texto, /https?:\/\//, 'o aviso não leva link');
    assert.doesNotMatch(texto, /token/i);
    assert.doesNotMatch(texto, /[0-9a-f]{32,}/, 'nenhum token no texto');
  }

  it('troca logada: o dono recebe o aviso com data e hora, a orientação e nenhum link ou senha', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'aviso-troca');
    const token = await login(conta.email, SENHA_CONTA);
    const desde = caixaDeSaida.length;
    const r = await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_CONTA, novaSenha: 'Avisada@12' } });
    assert.equal(r.status, 200);
    const avisos = avisosPara(conta.email, desde);
    assert.equal(avisos.length, 1, 'um aviso, só para o dono da conta');
    assert.equal(caixaDeSaida.slice(desde).length, 1, 'nenhum outro e-mail sai');
    const texto = avisos[0].texto;
    assert.match(texto, /Olá, Usuário aviso-troca\./);
    assert.match(texto, /foi alterada em \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} \(horário de Brasília\)/);
    assert.match(texto, /procure o administrador/);
    assert.ok(!texto.includes('Avisada@12') && !texto.includes(SENHA_CONTA), 'nenhuma senha no texto');
    semCredencial(texto);
  });

  it('redefinição pelo link: o dono recebe o aviso', async () => {
    await limparLimiteReset();
    const conta = await criarUsuario(admin, 'Colaborador', 'aviso-reset');
    await chamar('POST', '/auth/reset-password', { body: { email: conta.email } });
    const link = await tokenDoEmail(conta.email, 'reset-password');
    assert.ok(link);
    const desde = caixaDeSaida.length;
    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token: link, novaSenha: 'PeloLink@12' } })).status, 200);
    const avisos = avisosPara(conta.email, desde);
    assert.equal(avisos.length, 1);
    semCredencial(avisos[0].texto);
    // O tokenDoEmail continua achando só links de verdade: o aviso não tem um.
    assert.equal(await tokenDoEmail(conta.email, 'reset-password'), link);
  });

  it('aceitar o convite não manda aviso (é a primeira senha, nada foi alterado)', async () => {
    const conta = await criarUsuarioPendente(admin, 'Colaborador', 'aviso-convite');
    const desde = caixaDeSaida.length;
    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token: conta.convite, novaSenha: 'Primeira@12' } })).status, 200);
    assert.equal(avisosPara(conta.email, desde).length, 0);
  });

  it('troca recusada (senha atual errada) não manda aviso', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'aviso-recusa');
    const token = await login(conta.email, SENHA_CONTA);
    const desde = caixaDeSaida.length;
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: 'Errada@123', novaSenha: 'Nova@12345' } }), 400, 'SENHA_ATUAL_INCORRETA');
    assert.equal(avisosPara(conta.email, desde).length, 0);
  });

  it('falha no envio do aviso não derruba a troca nem a redefinição', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'aviso-falha');
    const token = await login(conta.email, SENHA_CONTA);
    // O transporte em memória passa a falhar só para o aviso (os links seguem saindo).
    // (mock.method nao aceita array: troca o push da instancia e devolve no finally.)
    const original = caixaDeSaida.push;
    let avisosTentados = 0;
    caixaDeSaida.push = function (this: typeof caixaDeSaida, ...itens: typeof caixaDeSaida) {
      if (itens.some((e) => e.assunto === ASSUNTO)) {
        avisosTentados += 1;
        throw new Error('SMTP fora do ar (simulado)');
      }
      return original.apply(this, itens);
    };
    const erros = mock.method(console, 'error', () => {});
    try {
      const r = await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_CONTA, novaSenha: 'SemAviso@12' } });
      assert.equal(r.status, 200);
      assert.ok(r.body.dados.token, 'a troca devolve o token novo mesmo sem o aviso');
      await login(conta.email, 'SemAviso@12');

      await limparLimiteReset();
      await chamar('POST', '/auth/reset-password', { body: { email: conta.email } });
      const link = await tokenDoEmail(conta.email, 'reset-password');
      assert.ok(link);
      const conf = await chamar('POST', '/auth/reset-password/confirm', { body: { token: link, novaSenha: 'SemAviso@34' } });
      assert.equal(conf.status, 200);
      assert.equal(conf.body.mensagem, 'Senha redefinida com sucesso');
      await login(conta.email, 'SemAviso@34');
      assert.equal(avisosTentados, 2, 'o aviso foi tentado nas duas trocas');
      assert.ok(erros.mock.calls.length >= 2, 'a falha vai para o log');
    } finally {
      caixaDeSaida.push = original;
      erros.mock.restore();
    }
  });
});
