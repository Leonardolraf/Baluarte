// Pentest automatizado — DIMENSAO conta/forca-bruta.
// Ataca a API REST real do Baluarte (SQLite isolado deste arquivo) exercitando:
//  - limite de tentativas de login (5/15min -> 429), bloqueio persistente na janela,
//    isolamento por conta e reset apos login valido;
//  - nao-enumeracao de usuarios no login (mesmo status/mensagem/codigo);
//  - redefinicao de senha: token de uso unico, expiracao 30min, limite 3/15min,
//    resposta generica, token so para conta existente e ativa, isolamento entre contas;
//  - politica de senha em change-password e reset/confirm;
//  - senha provisoria: Pendente -> Ativo ao trocar; hash nunca vaza.
//
// Cada it() e independente e usa e-mails proprios (a chave dos limitadores em memoria
// e o e-mail normalizado), entao nao ha contaminacao de estado entre casos — sem
// precisar de nenhum "limpar limite" (que nao faz parte do helpers.ts).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
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

// -----------------------------------------------------------------------------
// Utilitarios locais (nada alem do helpers.ts + prisma/app).

let admin = '';
before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

/** Cria uma conta pelo contrato e devolve {id, email} (status Pendente, senha provisoria). */
async function conta(prefixo: string) {
  return criarUsuario(admin, 'Colaborador', prefixo);
}

/**
 * Solicita redefinicao e captura o token do link que a rota imprime no console
 * (RESET_TOKEN_CONSOLE=1 no ambiente de teste; nao ha e-mail neste projeto).
 */
async function solicitarReset(email: string): Promise<{ status: number; mensagem: string; token: string | null }> {
  const original = console.log;
  let token: string | null = null;
  console.log = (...args: unknown[]) => {
    const linha = args.map(String).join(' ');
    const m = linha.match(/\[reset-senha\] link para .*\/reset-password\?token=([0-9a-f]{64})$/);
    if (m) token = m[1];
  };
  try {
    const r = await chamar('POST', '/auth/reset-password', { body: { email } });
    return { status: r.status, mensagem: r.body?.mensagem, token };
  } finally {
    console.log = original;
  }
}

/** True se o corpo (serializado) vaza um hash de senha em qualquer forma. */
function vazaHash(body: unknown): boolean {
  const s = JSON.stringify(body ?? {});
  return s.includes('senhaHash') || /\$2[aby]\$/.test(s);
}

// =============================================================================
describe('login: limite de tentativas / forca bruta', () => {
  it('bloqueia com 429 MUITAS_TENTATIVAS apos 5 falhas e a conta segue bloqueada mesmo com a senha correta', async () => {
    const alvo = await conta('bf.trava');
    for (let i = 0; i < 5; i++) {
      esperaErro(await chamar('POST', '/login', { body: { email: alvo.email, senha: 'ErradaX@1' } }), 401, 'CREDENCIAIS_INVALIDAS');
    }
    esperaErro(await chamar('POST', '/login', { body: { email: alvo.email, senha: 'ErradaX@1' } }), 429, 'MUITAS_TENTATIVAS');
    // A senha CORRETA dentro da janela nao destrava: o gate do rate-limit vem antes do bcrypt.
    esperaErro(await chamar('POST', '/login', { body: { email: alvo.email, senha: SENHA_PROVISORIA } }), 429, 'MUITAS_TENTATIVAS');
  });

  it('o bloqueio e por conta: uma conta travada nao afeta outra conta nem o seed', async () => {
    const travada = await conta('bf.iso');
    for (let i = 0; i < 5; i++) {
      await chamar('POST', '/login', { body: { email: travada.email, senha: 'Nope@123' } });
    }
    esperaErro(await chamar('POST', '/login', { body: { email: travada.email, senha: 'Nope@123' } }), 429, 'MUITAS_TENTATIVAS');
    // Outra conta recem-criada entra normalmente...
    const outra = await conta('bf.livre');
    assert.equal((await chamar('POST', '/login', { body: { email: outra.email, senha: SENHA_PROVISORIA } })).status, 200);
    // ...e o usuario do seed tambem (limite keyed por e-mail, nao global).
    assert.equal((await chamar('POST', '/login', { body: { email: ANALISTA.email, senha: ANALISTA.senha } })).status, 200);
  });

  it('um login valido zera o contador de falhas da conta', async () => {
    const alvo = await conta('bf.reset');
    // 4 falhas (abaixo do teto)...
    for (let i = 0; i < 4; i++) {
      esperaErro(await chamar('POST', '/login', { body: { email: alvo.email, senha: 'Errada@9' } }), 401, 'CREDENCIAIS_INVALIDAS');
    }
    // ...login valido reseta o contador.
    assert.equal((await chamar('POST', '/login', { body: { email: alvo.email, senha: SENHA_PROVISORIA } })).status, 200);
    // Se NAO tivesse zerado, a 2a falha abaixo ja seria 429 (contador estaria em 4).
    for (let i = 0; i < 3; i++) {
      esperaErro(await chamar('POST', '/login', { body: { email: alvo.email, senha: 'Errada@9' } }), 401, 'CREDENCIAIS_INVALIDAS');
    }
  });

  it('o limitador tambem cobre e-mails inexistentes (nao ha canal privilegiado para adivinhar contas)', async () => {
    const fantasma = emailUnico('bf.fantasma');
    for (let i = 0; i < 5; i++) {
      esperaErro(await chamar('POST', '/login', { body: { email: fantasma, senha: 'Chute@123' } }), 401, 'CREDENCIAIS_INVALIDAS');
    }
    esperaErro(await chamar('POST', '/login', { body: { email: fantasma, senha: 'Chute@123' } }), 429, 'MUITAS_TENTATIVAS');
  });
});

// =============================================================================
describe('login: nao-enumeracao de usuarios', () => {
  it('e-mail inexistente e senha errada de conta real respondem com status/mensagem/codigo identicos', async () => {
    const inexistente = await chamar('POST', '/login', { body: { email: emailUnico('nao.existe'), senha: 'Qualquer@1' } });
    const senhaErrada = await chamar('POST', '/login', { body: { email: ADMIN.email, senha: 'Errada@1' } });
    assert.equal(inexistente.status, senhaErrada.status);
    assert.equal(inexistente.body.status, 'erro');
    assert.equal(inexistente.body.mensagem, senhaErrada.body.mensagem);
    assert.equal(inexistente.body.codigoErro, senhaErrada.body.codigoErro);
    assert.equal(inexistente.body.codigoErro, 'CREDENCIAIS_INVALIDAS');
  });

  it('varias amostras: inexistente x senha-errada permanecem indistinguiveis (sem oraculo de enumeracao)', async () => {
    const alvo = await conta('enum.real');
    for (let i = 0; i < 3; i++) {
      const inexistente = await chamar('POST', '/login', { body: { email: emailUnico('enum.fantasma'), senha: 'Zzz@1234' } });
      const senhaErrada = await chamar('POST', '/login', { body: { email: alvo.email, senha: 'Zzz@1234' } });
      assert.equal(inexistente.status, senhaErrada.status, `iteracao ${i}: status divergente`);
      assert.equal(inexistente.body.mensagem, senhaErrada.body.mensagem, `iteracao ${i}: mensagem divergente`);
      assert.equal(inexistente.body.codigoErro, senhaErrada.body.codigoErro, `iteracao ${i}: codigo divergente`);
    }
  });

  it('senha errada nao revela existencia via status: nunca devolve 404 para conta desconhecida', async () => {
    const r = await chamar('POST', '/login', { body: { email: emailUnico('sem.cadastro'), senha: 'Outra@123' } });
    assert.notEqual(r.status, 404);
    assert.equal(r.status, 401);
    assert.equal(r.body.codigoErro, 'CREDENCIAIS_INVALIDAS');
  });
});

// =============================================================================
describe('redefinicao de senha: token, expiracao, limite e enumeracao', () => {
  it('responde a MESMA mensagem generica para e-mail conhecido e desconhecido', async () => {
    const alvo = await conta('reset.gen');
    const conhecido = await solicitarReset(alvo.email);
    const desconhecido = await solicitarReset(emailUnico('reset.ninguem'));
    assert.equal(conhecido.status, 200);
    assert.equal(desconhecido.status, 200);
    assert.equal(conhecido.mensagem, desconhecido.mensagem);
    assert.match(conhecido.mensagem, /Se o e-mail estiver cadastrado/);
    // Conta real gera token; e-mail desconhecido nao gera nada.
    assert.ok(conhecido.token, 'conta existente deveria gerar token');
    assert.equal(desconhecido.token, null);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: alvo.id, usadoEm: null } }), 1);
  });

  it('conta Inativa nao recebe token de redefinicao (resposta segue generica)', async () => {
    const alvo = await conta('reset.inativo');
    assert.equal((await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { status: 'Inativo' } })).status, 200);
    const r = await solicitarReset(alvo.email);
    assert.equal(r.status, 200);
    assert.match(r.mensagem, /Se o e-mail estiver cadastrado/);
    assert.equal(r.token, null, 'conta inativa nao deve receber link');
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: alvo.id } }), 0);
  });

  it('token de redefinicao e de uso unico: reuso apos consumir -> TOKEN_RESET_INVALIDO', async () => {
    const alvo = await conta('reset.unico');
    const { token } = await solicitarReset(alvo.email);
    assert.ok(token);
    const ok = await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'NovaForte@1' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.mensagem, 'Senha redefinida com sucesso');
    await login(alvo.email, 'NovaForte@1');
    // Reuso do mesmo token nao pode funcionar.
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'Terceira@1' } }), 400, 'TOKEN_RESET_INVALIDO');
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: alvo.id, usadoEm: null } }), 0);
  });

  it('token expira em ~30 min: token vencido -> TOKEN_RESET_INVALIDO', async () => {
    const alvo = await conta('reset.exp');
    const { token } = await solicitarReset(alvo.email);
    assert.ok(token);
    const registro = await prisma.passwordResetToken.findFirst({ where: { userId: alvo.id, usadoEm: null } });
    assert.ok(registro, 'esperava um token pendente');
    const janelaMin = (registro!.expiraEm.getTime() - Date.now()) / 60000;
    assert.ok(janelaMin > 28 && janelaMin <= 31, `validade fora de ~30min: ${janelaMin.toFixed(2)}min`);
    // Vence o token e confirma a rejeicao.
    await prisma.passwordResetToken.updateMany({ where: { userId: alvo.id, usadoEm: null }, data: { expiraEm: new Date(Date.now() - 1000) } });
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'Expirou@123' } }), 400, 'TOKEN_RESET_INVALIDO');
    // A senha nao mudou: a provisoria ainda vale.
    await login(alvo.email, SENHA_PROVISORIA);
  });

  it('limita a 3 solicitacoes por e-mail em 15 min (4a -> 429)', async () => {
    const email = emailUnico('reset.limite');
    for (let i = 0; i < 3; i++) {
      assert.equal((await chamar('POST', '/auth/reset-password', { body: { email } })).status, 200);
    }
    esperaErro(await chamar('POST', '/auth/reset-password', { body: { email } }), 429, 'MUITAS_TENTATIVAS');
  });

  it('valida formato/tamanho do e-mail antes de qualquer processamento', async () => {
    esperaErro(await chamar('POST', '/auth/reset-password', { body: { email: 'sem-arroba' } }), 400, 'EMAIL_INVALIDO');
    const gigante = `${'a'.repeat(250)}@empresa.com`;
    esperaErro(await chamar('POST', '/auth/reset-password', { body: { email: gigante } }), 400, 'EMAIL_INVALIDO');
  });

  it('a redefinicao de uma conta nao altera a senha de outra (isolamento por usuario)', async () => {
    const a = await conta('reset.userA');
    const b = await conta('reset.userB');
    const { token } = await solicitarReset(a.email);
    assert.ok(token);
    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'SenhaDoA@1' } })).status, 200);
    // A passa a usar a nova senha; a provisoria antiga nao vale mais.
    await login(a.email, 'SenhaDoA@1');
    esperaErro(await chamar('POST', '/login', { body: { email: a.email, senha: SENHA_PROVISORIA } }), 401, 'CREDENCIAIS_INVALIDAS');
    // B nao foi tocado: continua com a provisoria e sem token algum.
    await login(b.email, SENHA_PROVISORIA);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: b.id } }), 0);
  });

  it('redefinir a senha encerra sessoes abertas antes (cenario de credencial comprometida)', async () => {
    const alvo = await conta('reset.sessao');
    const sessaoAntiga = await login(alvo.email, SENHA_PROVISORIA);
    assert.equal((await chamar('GET', '/me', { token: sessaoAntiga })).status, 200);
    // `iat` do JWT tem granularidade de segundos: espera para a comparacao ser deterministica.
    await sleep(1200);
    const { token } = await solicitarReset(alvo.email);
    assert.ok(token);
    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'PosVazamento@1' } })).status, 200);
    esperaErro(await chamar('GET', '/me', { token: sessaoAntiga }), 401, 'SENHA_REDEFINIDA');
    const nova = await login(alvo.email, 'PosVazamento@1');
    assert.equal((await chamar('GET', '/me', { token: nova })).status, 200);
  });
});

// =============================================================================
describe('politica de senha e senha provisoria', () => {
  it('reset/confirm aplica a politica de senha e exige token valido', async () => {
    const alvo = await conta('pol.reset');
    const { token } = await solicitarReset(alvo.email);
    assert.ok(token);
    // Token/nova senha obrigatorios.
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { novaSenha: 'Boa@Senha1' } }), 400, 'TOKEN_OBRIGATORIO');
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token } }), 400, 'NOVA_SENHA_OBRIGATORIA');
    // Token inexistente -> invalido (nao 500, nao aceita).
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token: 'nao-e-token', novaSenha: 'Boa@Senha1' } }), 400, 'TOKEN_RESET_INVALIDO');
    // Politica: curta, sem maiuscula, sem minuscula, sem numero/simbolo.
    const fracas = ['Ab@1', 'semmaiuscula1!', 'SEMMINUSCULA1!', 'SemNumeroSimbolo'];
    for (const senha of fracas) {
      esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: senha } }), 400, 'SENHA_FRACA');
    }
    // O token continua valido para uma senha forte (as rejeicoes nao o consumiram).
    assert.equal((await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'FinalmenteForte@1' } })).status, 200);
    await login(alvo.email, 'FinalmenteForte@1');
  });

  it('change-password exige token, campos e a senha atual correta', async () => {
    const alvo = await conta('pol.change');
    const token = await login(alvo.email, SENHA_PROVISORIA);
    esperaErro(await chamar('POST', '/auth/change-password', { body: {} }), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { novaSenha: 'NovaBoa@1' } }), 400, 'SENHA_ATUAL_OBRIGATORIA');
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_PROVISORIA } }), 400, 'NOVA_SENHA_OBRIGATORIA');
    // Senha atual errada (com nova senha forte, para nao cair antes em SENHA_FRACA).
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: 'ChuteErrado@1', novaSenha: 'NovaBoa@1' } }), 400, 'SENHA_ATUAL_INCORRETA');
  });

  it('change-password rejeita senhas fracas e a repetida', async () => {
    const alvo = await conta('pol.fracas');
    const token = await login(alvo.email, SENHA_PROVISORIA);
    const fracas = ['Ab@1', 'semmaiuscula1!', 'SEMMINUSCULA1!', 'SemNumeroSimbolo', `${'Aa1@bcde'.repeat(8)}x`];
    for (const senha of fracas) {
      esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_PROVISORIA, novaSenha: senha } }), 400, 'SENHA_FRACA');
    }
    // Repetir a senha atual (que passa na politica) e rejeitado.
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_PROVISORIA, novaSenha: SENHA_PROVISORIA } }), 400, 'SENHA_REPETIDA');
  });

  it('senha provisoria: conta Pendente vira Ativa ao trocar a senha', async () => {
    const alvo = await conta('prov.ativa');
    const token = await login(alvo.email, SENHA_PROVISORIA);
    assert.equal((await chamar('GET', '/me', { token })).body.dados.status, 'Pendente');
    const r = await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_PROVISORIA, novaSenha: 'MinhaNova@1' } });
    assert.equal(r.status, 200);
    assert.equal((await chamar('GET', '/me', { token })).body.dados.status, 'Ativo');
    // Provisoria antiga nao vale mais; a nova vale.
    esperaErro(await chamar('POST', '/login', { body: { email: alvo.email, senha: SENHA_PROVISORIA } }), 401, 'CREDENCIAIS_INVALIDAS');
    await login(alvo.email, 'MinhaNova@1');
  });

  it('o hash de senha nunca volta em nenhuma resposta (login, /me, /usuarios, PATCH)', async () => {
    const alvo = await conta('leak.hash');
    const loginResp = await chamar('POST', '/login', { body: { email: alvo.email, senha: SENHA_PROVISORIA } });
    assert.equal(loginResp.status, 200);
    assert.ok(!vazaHash(loginResp.body), 'login vazou hash');
    const token = loginResp.body.dados.token as string;
    assert.ok(!vazaHash((await chamar('GET', '/me', { token })).body), '/me vazou hash');
    const lista = await chamar('GET', '/usuarios', { token: admin });
    assert.equal(lista.status, 200);
    assert.ok(!vazaHash(lista.body), '/usuarios vazou hash');
    const patch = await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { nome: 'Sem Hash' } });
    assert.equal(patch.status, 200);
    assert.ok(!vazaHash(patch.body), 'PATCH /users vazou hash');
  });
});
