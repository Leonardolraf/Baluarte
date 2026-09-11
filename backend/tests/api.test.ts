// Testes de integracao da API (node:test + fetch) contra um SQLite ISOLADO
// (prisma/test.db, recriado e semeado a cada execucao). Cobre as rotas adicionais
// ao contrato da N2 AT1 e um smoke do proprio contrato. Rode com `npm test`.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_SECRET = 'segredo-somente-para-testes';
process.env.NODE_ENV = 'test';

function npx(args: string): void {
  const r = spawnSync(`npx ${args}`, { shell: true, encoding: 'utf8', env: process.env });
  if (r.status !== 0) throw new Error(`falha em "npx ${args}":\n${r.stdout}\n${r.stderr}`);
}
npx('prisma db push --force-reset --accept-data-loss --skip-generate');
npx('tsx prisma/seed.ts');

// Importados so depois de apontar DATABASE_URL para o banco de teste.
const { app } = await import('../src/app.js');
const { prisma } = await import('../src/db.js');
const { limparLimiteReset } = await import('../src/routes/manage.js');

let server: Server;
let base = '';

type Resposta = { status: number; body: any };

async function chamar(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<Resposta> {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function login(email: string, senha: string): Promise<string> {
  const r = await chamar('POST', '/login', { body: { email, senha } });
  assert.equal(r.status, 200, `login de ${email} falhou: ${JSON.stringify(r.body)}`);
  return r.body.dados.token as string;
}

function esperaErro(r: Resposta, status: number, codigo: string): void {
  assert.equal(r.status, status, `esperava ${status} ${codigo}, veio ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body.status, 'erro');
  assert.equal(r.body.codigoErro, codigo);
}

let seq = 0;
function emailUnico(prefixo: string): string {
  seq += 1;
  return `${prefixo}.${Date.now()}.${seq}@empresa.com`;
}

/** Cria um usuario pelo contrato (senha provisoria Mudar@123, status Pendente). */
async function criarUsuario(token: string, perfil: string, prefixo = 'teste'): Promise<{ id: string; email: string }> {
  const email = emailUnico(prefixo);
  const r = await chamar('POST', '/users', { token, body: { nome: `Usuário ${prefixo}`, email, perfil } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.dados.idUsuario as string, email };
}

const SENHA_PROVISORIA = 'Mudar@123';

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------

describe('contrato N2 AT1 (smoke)', () => {
  it('login com credenciais do seed devolve token e perfil', async () => {
    const r = await chamar('POST', '/login', { body: { email: 'analista@empresa.com', senha: 'Senha@123' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.perfil, 'Analista');
    assert.match(r.body.dados.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('login com senha errada -> 401 CREDENCIAIS_INVALIDAS', async () => {
    esperaErro(await chamar('POST', '/login', { body: { email: 'analista@empresa.com', senha: 'x' } }), 401, 'CREDENCIAIS_INVALIDAS');
  });

  it('rota protegida sem token -> 401 TOKEN_AUSENTE; token inválido -> 401 TOKEN_INVALIDO', async () => {
    esperaErro(await chamar('POST', '/assets', { body: {} }), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', '/me', { token: 'abc' }), 401, 'TOKEN_INVALIDO');
  });

  it('classificação CVSS pública e rota inexistente', async () => {
    const r = await chamar('GET', '/findings/classificacao?cvss=9.8');
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.faixa, 'Crítico');
    esperaErro(await chamar('GET', '/nao-existe'), 404, 'ROTA_NAO_ENCONTRADA');
  });
});

describe('POST /auth/change-password', () => {
  let admin: string;
  let conta: { id: string; email: string };
  let token: string;

  before(async () => {
    admin = await login('admin@empresa.com', 'Admin@123');
    conta = await criarUsuario(admin, 'Colaborador', 'senha');
    token = await login(conta.email, SENHA_PROVISORIA);
  });

  it('exige token', async () => {
    esperaErro(await chamar('POST', '/auth/change-password', { body: {} }), 401, 'TOKEN_AUSENTE');
  });

  it('valida campos obrigatórios e política de senha', async () => {
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { novaSenha: 'Nova@1234' } }), 400, 'SENHA_ATUAL_OBRIGATORIA');
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_PROVISORIA } }), 400, 'NOVA_SENHA_OBRIGATORIA');
    const fracas = ['Ab@1', 'semmaiuscula1!', 'SEMMINUSCULA1!', 'SemNumeroSimbolo', `${'Aa1@bcde'.repeat(8)}x`];
    for (const senha of fracas) {
      esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_PROVISORIA, novaSenha: senha } }), 400, 'SENHA_FRACA');
    }
  });

  it('rejeita senha atual incorreta e senha repetida (sem derrubar a sessão: 400, não 401)', async () => {
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: 'Errada@123', novaSenha: 'Nova@1234' } }), 400, 'SENHA_ATUAL_INCORRETA');
    esperaErro(await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_PROVISORIA, novaSenha: SENHA_PROVISORIA } }), 400, 'SENHA_REPETIDA');
  });

  it('altera a senha, ativa a conta pendente e o login passa a usar a nova senha', async () => {
    const r = await chamar('POST', '/auth/change-password', { token, body: { senhaAtual: SENHA_PROVISORIA, novaSenha: 'Nova@1234' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mensagem, 'Senha alterada com sucesso');
    esperaErro(await chamar('POST', '/login', { body: { email: conta.email, senha: SENHA_PROVISORIA } }), 401, 'CREDENCIAIS_INVALIDAS');
    const novo = await login(conta.email, 'Nova@1234');
    const me = await chamar('GET', '/me', { token: novo });
    assert.equal(me.body.dados.status, 'Ativo');
    const auditoria = await prisma.auditLog.findFirst({ where: { usuarioId: conta.id, acao: 'ALTERAR_SENHA' } });
    assert.ok(auditoria, 'esperava registro de auditoria ALTERAR_SENHA');
  });
});

describe('POST /auth/reset-password (+ /confirm)', () => {
  let admin: string;
  let conta: { id: string; email: string };

  before(async () => {
    admin = await login('admin@empresa.com', 'Admin@123');
    conta = await criarUsuario(admin, 'Analista', 'reset');
    limparLimiteReset();
  });

  /** Captura o token que a rota imprime no console (não há e-mail neste projeto). */
  async function solicitarReset(email: string): Promise<{ resposta: Resposta; token: string | null }> {
    const original = console.log;
    let token: string | null = null;
    console.log = (...args: unknown[]) => {
      const linha = args.map(String).join(' ');
      const m = linha.match(/\[reset-senha\] token para .*: ([0-9a-f]{64})$/);
      if (m) token = m[1];
    };
    try {
      const resposta = await chamar('POST', '/auth/reset-password', { body: { email } });
      return { resposta, token };
    } finally {
      console.log = original;
    }
  }

  it('valida o formato do e-mail', async () => {
    esperaErro(await chamar('POST', '/auth/reset-password', { body: { email: 'sem-arroba' } }), 400, 'EMAIL_INVALIDO');
  });

  it('responde a mesma mensagem para e-mail desconhecido (sem enumerar usuários) e não gera token', async () => {
    const { resposta, token } = await solicitarReset('ninguem@empresa.com');
    assert.equal(resposta.status, 200);
    assert.match(resposta.body.mensagem, /Se o e-mail estiver cadastrado/);
    assert.equal(token, null);
  });

  it('gera token de uso único, valida a nova senha e troca a senha', async () => {
    const { resposta, token } = await solicitarReset(conta.email);
    assert.equal(resposta.status, 200);
    assert.ok(token, 'esperava token impresso no console');
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: conta.id, usadoEm: null } }), 1);

    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'curta' } }), 400, 'SENHA_FRACA');
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token: 'nao-e-um-token', novaSenha: 'Redefinida@1' } }), 400, 'TOKEN_RESET_INVALIDO');
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { novaSenha: 'Redefinida@1' } }), 400, 'TOKEN_OBRIGATORIO');

    const ok = await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'Redefinida@1' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.mensagem, 'Senha redefinida com sucesso');
    await login(conta.email, 'Redefinida@1');

    // Reuso do mesmo token -> inválido.
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'Outra@1234' } }), 400, 'TOKEN_RESET_INVALIDO');
  });

  it('token expirado é rejeitado', async () => {
    const { token } = await solicitarReset(conta.email);
    assert.ok(token);
    await prisma.passwordResetToken.updateMany({ where: { userId: conta.id, usadoEm: null }, data: { expiraEm: new Date(Date.now() - 1000) } });
    esperaErro(await chamar('POST', '/auth/reset-password/confirm', { body: { token, novaSenha: 'Expirada@1' } }), 400, 'TOKEN_RESET_INVALIDO');
  });

  it('limita solicitações por e-mail (429 na quarta em 15 min)', async () => {
    limparLimiteReset();
    for (let i = 0; i < 3; i++) {
      assert.equal((await chamar('POST', '/auth/reset-password', { body: { email: 'limite@empresa.com' } })).status, 200);
    }
    esperaErro(await chamar('POST', '/auth/reset-password', { body: { email: 'limite@empresa.com' } }), 429, 'MUITAS_TENTATIVAS');
    limparLimiteReset();
  });
});

describe('GET/PUT /configuracoes/notificacoes', () => {
  let admin: string;
  let token: string;

  before(async () => {
    admin = await login('admin@empresa.com', 'Admin@123');
    const conta = await criarUsuario(admin, 'Colaborador', 'prefs');
    token = await login(conta.email, SENHA_PROVISORIA);
  });

  it('exige token', async () => {
    esperaErro(await chamar('GET', '/configuracoes/notificacoes'), 401, 'TOKEN_AUSENTE');
  });

  it('devolve os padrões na primeira leitura', async () => {
    const r = await chamar('GET', '/configuracoes/notificacoes', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(
      { a: r.body.dados.alertasEmail, s: r.body.dados.somenteCriticas, r: r.body.dados.resumoSemanal, c: r.body.dados.relatoriosCampanha },
      { a: true, s: false, r: true, c: true },
    );
  });

  it('valida o corpo (booleanos) e faz merge parcial', async () => {
    esperaErro(await chamar('PUT', '/configuracoes/notificacoes', { token, body: { alertasEmail: 'sim' } }), 400, 'PREFERENCIA_INVALIDA');
    esperaErro(await chamar('PUT', '/configuracoes/notificacoes', { token, body: { outraCoisa: true } }), 400, 'PREFERENCIA_INVALIDA');
    const r = await chamar('PUT', '/configuracoes/notificacoes', { token, body: { somenteCriticas: true, resumoSemanal: false } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mensagem, 'Preferências salvas');
    const lido = await chamar('GET', '/configuracoes/notificacoes', { token });
    assert.equal(lido.body.dados.somenteCriticas, true);
    assert.equal(lido.body.dados.resumoSemanal, false);
    assert.equal(lido.body.dados.alertasEmail, true, 'campo não enviado mantém o valor');
  });

  it('preferências são por usuário', async () => {
    const outro = await chamar('GET', '/configuracoes/notificacoes', { token: admin });
    assert.equal(outro.body.dados.somenteCriticas, false);
  });
});

describe('treinamento pós-clique', () => {
  let admin: string;
  let analista: string;
  let evento: { id: string };
  let colaborador: { id: string; email: string };
  let tokenColaborador: string;
  let intruso: string;

  before(async () => {
    admin = await login('admin@empresa.com', 'Admin@123');
    analista = await login('analista@empresa.com', 'Senha@123');
    colaborador = await criarUsuario(admin, 'Colaborador', 'treino');
    tokenColaborador = await login(colaborador.email, SENHA_PROVISORIA);
    const outroColab = await criarUsuario(admin, 'Colaborador', 'intruso');
    intruso = await login(outroColab.email, SENHA_PROVISORIA);
    const campanha = await prisma.campaign.create({
      data: {
        nome: 'Campanha de teste (autoridade)',
        template: 'autoridade',
        status: 'ATIVA',
        eventos: { create: [{ destinatario: colaborador.email, enviadoEm: new Date(), abertoEm: new Date(), clicadoEm: new Date() }] },
      },
      include: { eventos: true },
    });
    evento = campanha.eventos[0];
  });

  it('GET /treinamentos/:token -> 404 para token desconhecido e conteúdo por template para conhecido', async () => {
    esperaErro(await chamar('GET', '/treinamentos/nao-existe'), 404, 'TREINAMENTO_NAO_ENCONTRADO');
    const r = await chamar('GET', `/treinamentos/${evento.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.tipoAtaque, 'Phishing por Autoridade');
    assert.equal(r.body.dados.template, 'autoridade');
    assert.equal(r.body.dados.progresso, 0);
    assert.equal(r.body.dados.campanha, 'Campanha de teste (autoridade)');
  });

  it('POST /concluir exige token, bloqueia colaborador de outro e-mail e aceita o próprio', async () => {
    esperaErro(await chamar('POST', `/treinamentos/${evento.id}/concluir`), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('POST', '/treinamentos/nao-existe/concluir', { token: tokenColaborador }), 404, 'TREINAMENTO_NAO_ENCONTRADO');
    esperaErro(await chamar('POST', `/treinamentos/${evento.id}/concluir`, { token: intruso }), 403, 'TREINAMENTO_DE_OUTRO_USUARIO');

    const ok = await chamar('POST', `/treinamentos/${evento.id}/concluir`, { token: tokenColaborador });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.dados.concluido, true);
    assert.ok(ok.body.dados.concluidoEm);

    const lido = await chamar('GET', `/treinamentos/${evento.id}`);
    assert.equal(lido.body.dados.progresso, 100);

    // Idempotente e visível no relatório da campanha.
    const denovo = await chamar('POST', `/treinamentos/${evento.id}/concluir`, { token: analista });
    assert.equal(denovo.status, 200);
    const eventoDb = await prisma.campaignEvent.findUnique({ where: { id: evento.id }, include: { campaign: true } });
    const relatorio = await chamar('GET', `/campanhas/${eventoDb!.campaignId}`, { token: analista });
    assert.equal(relatorio.body.dados.treinamentos[0].concluido, true);
    assert.equal(relatorio.body.dados.treinamentos[0].token, evento.id);
  });
});

describe('PATCH/DELETE /users/:id (Administrador)', () => {
  let admin: string;
  let analista: string;
  let alvo: { id: string; email: string };

  before(async () => {
    admin = await login('admin@empresa.com', 'Admin@123');
    analista = await login('analista@empresa.com', 'Senha@123');
    alvo = await criarUsuario(admin, 'Colaborador', 'alvo');
  });

  it('analista não pode editar nem excluir (403 PERFIL_SEM_PERMISSAO)', async () => {
    esperaErro(await chamar('PATCH', `/users/${alvo.id}`, { token: analista, body: { nome: 'X' } }), 403, 'PERFIL_SEM_PERMISSAO');
    esperaErro(await chamar('DELETE', `/users/${alvo.id}`, { token: analista }), 403, 'PERFIL_SEM_PERMISSAO');
  });

  it('valida campos do PATCH', async () => {
    esperaErro(await chamar('PATCH', '/users/nao-existe', { token: admin, body: { nome: 'X' } }), 404, 'USUARIO_NAO_ENCONTRADO');
    esperaErro(await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { nome: '  ' } }), 400, 'NOME_OBRIGATORIO');
    esperaErro(await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { email: 'invalido' } }), 400, 'EMAIL_INVALIDO');
    esperaErro(await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { email: 'analista@empresa.com' } }), 409, 'EMAIL_DUPLICADO');
    esperaErro(await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { perfil: 'Root' } }), 400, 'PERFIL_INVALIDO');
    esperaErro(await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { status: 'Banido' } }), 400, 'STATUS_INVALIDO');
    esperaErro(await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: {} }), 400, 'NADA_A_ATUALIZAR');
  });

  it('atualiza nome, e-mail, perfil e status', async () => {
    const novoEmail = emailUnico('renomeado');
    const r = await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { nome: 'Renomeado', email: novoEmail, perfil: 'Analista', status: 'Ativo' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mensagem, 'Usuário atualizado');
    assert.equal(r.body.dados.nome, 'Renomeado');
    assert.equal(r.body.dados.email, novoEmail);
    assert.equal(r.body.dados.perfil, 'Analista');
    assert.equal(r.body.dados.status, 'Ativo');
    alvo.email = novoEmail;
  });

  it('protege o próprio administrador e o último administrador ativo', async () => {
    esperaErro(await chamar('PATCH', '/users/u-000', { token: admin, body: { status: 'Inativo' } }), 422, 'AUTO_INATIVACAO');
    esperaErro(await chamar('PATCH', '/users/u-000', { token: admin, body: { perfil: 'Analista' } }), 409, 'ULTIMO_ADMIN');
    esperaErro(await chamar('DELETE', '/users/u-000', { token: admin }), 422, 'AUTO_EXCLUSAO');

    // Com um segundo administrador ativo, o rebaixamento passa a ser permitido.
    const segundo = await criarUsuario(admin, 'Administrador', 'admin2');
    const rebaixa = await chamar('PATCH', '/users/u-000', { token: admin, body: { perfil: 'Analista' } });
    assert.equal(rebaixa.status, 200);
    // O token antigo ainda diz "Administrador", mas o banco manda: 403.
    esperaErro(await chamar('PATCH', `/users/${alvo.id}`, { token: admin, body: { nome: 'Z' } }), 403, 'PERFIL_SEM_PERMISSAO');
    // O segundo administrador restaura u-000; depois u-000 remove o segundo.
    const tokenSegundo = await login(segundo.email, SENHA_PROVISORIA);
    assert.equal((await chamar('PATCH', '/users/u-000', { token: tokenSegundo, body: { perfil: 'Administrador' } })).status, 200);
    admin = await login('admin@empresa.com', 'Admin@123');
    assert.equal((await chamar('DELETE', `/users/${segundo.id}`, { token: admin })).status, 200);
  });

  it('exclui usuário (com preferências em cascata) e some da listagem', async () => {
    const tokenAlvo = await login(alvo.email, SENHA_PROVISORIA);
    assert.equal((await chamar('GET', '/configuracoes/notificacoes', { token: tokenAlvo })).status, 200);
    const r = await chamar('DELETE', `/users/${alvo.id}`, { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.mensagem, 'Usuário excluído');
    const lista = await chamar('GET', '/usuarios', { token: admin });
    assert.ok(!lista.body.dados.some((u: { id: string }) => u.id === alvo.id));
    esperaErro(await chamar('DELETE', `/users/${alvo.id}`, { token: admin }), 404, 'USUARIO_NAO_ENCONTRADO');
    // Token de um usuário excluído deixa de valer.
    esperaErro(await chamar('GET', '/me', { token: tokenAlvo }), 401, 'USUARIO_REMOVIDO');
    esperaErro(await chamar('GET', '/configuracoes/notificacoes', { token: tokenAlvo }), 401, 'USUARIO_REMOVIDO');
  });
});

describe('vulnerabilidades: status "Risco aceito"', () => {
  let analista: string;
  let findingId: string;

  before(async () => {
    analista = await login('analista@empresa.com', 'Senha@123');
    const scan = await prisma.scan.create({ data: { assetId: 'ativo-001', status: 'CONCLUIDA', concluidoEm: new Date() } });
    const finding = await prisma.finding.create({
      data: { scanId: scan.id, categoriaOwasp: 'A03:2021 - Injection', cvss: 9.8, severidade: 'Crítico', descricao: 'Teste', evidencia: 'Teste', status: 'Aberta' },
    });
    findingId = finding.id;
  });

  it('aceita "Risco aceito", rejeita valores fora da lista e tira o achado dos KPIs de abertos', async () => {
    const antes = await chamar('GET', '/dashboard', { token: analista });
    esperaErro(await chamar('PATCH', `/vulnerabilidades/${findingId}`, { token: analista, body: { status: 'Ignorada' } }), 400, 'STATUS_INVALIDO');
    const r = await chamar('PATCH', `/vulnerabilidades/${findingId}`, { token: analista, body: { status: 'Risco aceito' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.dados.status, 'Risco aceito');
    const depois = await chamar('GET', '/dashboard', { token: analista });
    assert.equal(depois.body.dados.kpis.vulnerabilidadesAbertas, antes.body.dados.kpis.vulnerabilidadesAbertas - 1);
    assert.equal(depois.body.dados.kpis.criticas, antes.body.dados.kpis.criticas - 1);
    assert.equal(depois.body.dados.distribuicaoSeveridade['Crítico'], antes.body.dados.distribuicaoSeveridade['Crítico'] - 1);
  });
});

describe('POST /campaigns com destinatarios[]', () => {
  let analista: string;

  before(async () => {
    analista = await login('analista@empresa.com', 'Senha@123');
  });

  it('contrato original (um destinatário) continua igual', async () => {
    const r = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Phishing Q2', destinatario: 'colaborador@empresa.com', template: 'urgencia' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.mensagem, 'Campanha criada com sucesso');
    assert.equal(r.body.dados.destinatario, 'colaborador@empresa.com');
    assert.deepEqual(r.body.dados.destinatarios, ['colaborador@empresa.com']);
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: 'fora@gmail.com', template: 'urgencia' } }), 422, 'DESTINATARIO_EXTERNO');
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: 'invalido', template: 'urgencia' } }), 400, 'EMAIL_INVALIDO');
  });

  it('aceita vários destinatários, remove duplicados e valida cada um', async () => {
    const r = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Simulação Q3 – Financeiro', destinatarios: ['ana@empresa.com', 'bruno@empresa.com', 'ANA@empresa.com'], template: 'curiosidade' },
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.dados.destinatarios, ['ana@empresa.com', 'bruno@empresa.com']);
    assert.equal(r.body.dados.destinatario, 'ana@empresa.com');
    const relatorio = await chamar('GET', `/campanhas/${r.body.dados.idCampanha}`, { token: analista });
    assert.equal(relatorio.body.dados.destinatarios, 2);

    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatarios: ['ok@empresa.com', 'quebrado'], template: 'urgencia' } }), 400, 'EMAIL_INVALIDO');
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatarios: ['ok@empresa.com', 'fora@gmail.com'], template: 'urgencia' } }), 422, 'DESTINATARIO_EXTERNO');
    // Lista vazia cai no campo `destinatario`.
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatarios: [], template: 'urgencia' } }), 400, 'EMAIL_INVALIDO');
  });
});
