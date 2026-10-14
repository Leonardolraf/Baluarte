// GET /campanhas/destinatarios: destinatarios elegiveis de um ou mais departamentos (ou de
// todos) para o formulario de campanha. Mesma regra da criacao (POST /campaigns): conta
// cadastrada, Ativa (Pendente e Inativo ficam de fora) e do dominio interno. Banco Postgres isolado
// (baluarte_test_campanha_destinatarios) — ver helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN,
  ANALISTA,
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
const { prisma } = await import('../src/config/db.js');

let admin: string;
let analista: string;
let colaborador: string;
const dep: Record<string, string> = {};

/** Cadastra pelo contrato (POST /users), ja no departamento; a conta nasce Pendente. */
async function cadastrar(nome: string, email: string, departamento: string | null) {
  const r = await chamar('POST', '/users', { token: admin, body: { nome, email, perfil: 'Colaborador', departamento } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.dados.idUsuario as string;
}

/** Cadastra e ativa (status Ativo pelo PATCH do Administrador, sem passar pelo convite). */
async function cadastrarAtivo(nome: string, email: string, departamento: string | null) {
  const id = await cadastrar(nome, email, departamento);
  assert.equal((await chamar('PATCH', `/users/${id}`, { token: admin, body: { status: 'Ativo' } })).status, 200);
  return id;
}

const emails = (r: { body: { dados: Array<{ email: string }> } }) => r.body.dados.map((d) => d.email);

before(async () => {
  delete process.env.DOMINIO_INTERNO;
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
  colaborador = await login('colaborador@empresa.com', 'Colab@123');
  for (const d of (await chamar('GET', '/departamentos', { token: admin })).body.dados as Array<{ id: string; nome: string }>)
    dep[d.nome] = d.id;

  // TI: duas contas Ativas (uma pelo convite aceito), uma Pendente, uma Inativa e uma fora do dominio interno.
  const ativa = await criarUsuario(admin, 'Colaborador', 'mdep.ti.ativa');
  assert.equal((await chamar('PATCH', `/users/${ativa.id}`, { token: admin, body: { nome: 'Bruna TI', departamento: 'TI' } })).status, 200);
  await cadastrarAtivo('Ana TI', 'ana.ti@empresa.com', 'TI');
  await cadastrar('Gabriel TI', 'gabriel.ti@empresa.com', 'TI');
  const inativa = await cadastrar('Carlos TI', 'carlos.ti@empresa.com', 'TI');
  assert.equal((await chamar('PATCH', `/users/${inativa}`, { token: admin, body: { status: 'Inativo' } })).status, 200);
  await cadastrarAtivo('Diego TI', 'diego.ti@externo.com', 'TI');
  // RH: uma conta. Financeiro: ninguem elegivel (so uma inativa).
  await cadastrarAtivo('Elisa RH', 'elisa.rh@empresa.com', 'RH');
  const fin = await cadastrar('Fabio Financeiro', 'fabio.fin@empresa.com', 'Financeiro');
  assert.equal((await chamar('PATCH', `/users/${fin}`, { token: admin, body: { status: 'Inativo' } })).status, 200);
});
after(async () => {
  delete process.env.DOMINIO_INTERNO;
  await encerrarServidor();
  await prisma.$disconnect();
});

describe('GET /campanhas/destinatarios', () => {
  it('um departamento: só os elegíveis (Ativos do domínio interno), em ordem de nome, com o mínimo', async () => {
    const r = await chamar('GET', `/campanhas/destinatarios?departamento=${dep.TI}`, { token: analista });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'sucesso');
    assert.deepEqual(
      r.body.dados.map((d: { nome: string; departamento: string }) => [d.nome, d.departamento]),
      [['Ana TI', 'TI'], ['Bruna TI', 'TI']],
    );
    for (const d of r.body.dados) assert.deepEqual(Object.keys(d).sort(), ['departamento', 'email', 'id', 'nome'], 'sem perfil, status, datas ou hash');
    assert.deepEqual(r.body.resumo, { total: 2, inativos: 1, pendentes: 1, foraDoDominio: 1 });
    assert.ok(!emails(r).includes('gabriel.ti@empresa.com'), 'convite não aceito fica de fora');
  });

  it('vários departamentos (repetidos contam uma vez) e departamento sem elegíveis', async () => {
    const r = await chamar('GET', `/campanhas/destinatarios?departamento=${dep.TI}&departamento=${dep.RH}&departamento=${dep.TI}`, { token: admin });
    assert.equal(r.status, 200);
    assert.deepEqual(emails(r).sort(), ['ana.ti@empresa.com', 'elisa.rh@empresa.com', r.body.dados.find((d: { nome: string }) => d.nome === 'Bruna TI').email].sort());
    assert.equal(r.body.resumo.total, 3);

    const colchetes = await chamar('GET', `/campanhas/destinatarios?departamento[]=${dep.RH}`, { token: admin });
    assert.deepEqual(emails(colchetes), ['elisa.rh@empresa.com'], 'a forma departamento[]= também vale');

    const vazio = await chamar('GET', `/campanhas/destinatarios?departamento=${dep.Financeiro}`, { token: admin });
    assert.equal(vazio.status, 200);
    assert.deepEqual(vazio.body.dados, []);
    assert.deepEqual(vazio.body.resumo, { total: 0, inativos: 1, pendentes: 0, foraDoDominio: 0 });
  });

  it('todos=1: todas as contas elegíveis, inclusive sem departamento; inativos, pendentes e externos fora', async () => {
    const r = await chamar('GET', '/campanhas/destinatarios?todos=1', { token: analista });
    assert.equal(r.status, 200);
    const lista = emails(r);
    for (const e of ['admin@empresa.com', 'analista@empresa.com', 'colaborador@empresa.com', 'ana.ti@empresa.com', 'elisa.rh@empresa.com'])
      assert.ok(lista.includes(e), e);
    for (const e of ['carlos.ti@empresa.com', 'fabio.fin@empresa.com', 'gabriel.ti@empresa.com', 'diego.ti@externo.com'])
      assert.ok(!lista.includes(e), e);
    assert.equal(r.body.dados.find((d: { email: string }) => d.email === 'colaborador@empresa.com').departamento, null);
    const total = await prisma.user.count();
    const pendentes = await prisma.user.count({ where: { status: 'Pendente' } });
    assert.ok(pendentes >= 1);
    assert.deepEqual(r.body.resumo, { total: lista.length, inativos: 2, pendentes, foraDoDominio: 1 });
    assert.equal(lista.length + 2 + pendentes + 1, total, 'todo usuário cadastrado entra numa das quatro contagens');
  });

  it('DOMINIO_INTERNO com endereço liberado um a um (DT19) entra na lista, como na criação', async () => {
    process.env.DOMINIO_INTERNO = '@empresa.com,diego.ti@externo.com';
    try {
      const r = await chamar('GET', `/campanhas/destinatarios?departamento=${dep.TI}`, { token: admin });
      assert.ok(emails(r).includes('diego.ti@externo.com'));
      assert.equal(r.body.resumo.foraDoDominio, 0);
    } finally {
      delete process.env.DOMINIO_INTERNO;
    }
  });

  it('a lista devolvida é aceita pelo POST /campaigns; inativo e pendente do mesmo departamento são recusados lá', async () => {
    const r = await chamar('GET', `/campanhas/destinatarios?departamento=${dep.TI}`, { token: analista });
    const c = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'TI por departamento', destinatarios: emails(r), template: 'urgencia' } });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.deepEqual([...c.body.dados.destinatarios].sort(), emails(r).sort());
    esperaErro(
      await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Com inativo', destinatarios: [...emails(r), 'carlos.ti@empresa.com'], template: 'urgencia' } }),
      422,
      'DESTINATARIO_NAO_CADASTRADO',
    );
    const pendente = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Com pendente', destinatarios: [...emails(r), 'gabriel.ti@empresa.com'], template: 'urgencia' },
    });
    esperaErro(pendente, 422, 'DESTINATARIO_PENDENTE');
    assert.equal(pendente.body.mensagem, 'Destinatário com convite pendente: gabriel.ti@empresa.com');
    // Pela forma do contrato (um `destinatario`) vale o mesmo; o inativo mantém a mensagem de sempre.
    esperaErro(
      await chamar('POST', '/campaigns', { token: analista, body: { nome: 'P', destinatario: 'gabriel.ti@empresa.com', template: 'urgencia' } }),
      422,
      'DESTINATARIO_PENDENTE',
    );
    const inativo = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'I', destinatario: 'carlos.ti@empresa.com', template: 'urgencia' } });
    esperaErro(inativo, 422, 'DESTINATARIO_NAO_CADASTRADO');
    assert.equal(inativo.body.mensagem, 'Destinatário não cadastrado ou inativo: carlos.ti@empresa.com');
  });

  it('RBAC: sem token 401; Colaborador 403; Administrador e Analista 200', async () => {
    const url = `/campanhas/destinatarios?departamento=${dep.TI}`;
    esperaErro(await chamar('GET', url), 401, 'TOKEN_AUSENTE');
    esperaErro(await chamar('GET', url, { token: 'nao.e.um.jwt' }), 401, 'TOKEN_INVALIDO');
    esperaErro(await chamar('GET', url, { token: colaborador }), 403, 'PERFIL_SEM_PERMISSAO');
    assert.equal((await chamar('GET', url, { token: admin })).status, 200);
    assert.equal((await chamar('GET', url, { token: analista })).status, 200);
  });

  it('entrada inválida: sem filtro, filtro duplo, todos fora de 1, id fora do formato e departamento inexistente', async () => {
    const get = (q: string) => chamar('GET', `/campanhas/destinatarios${q}`, { token: analista });
    esperaErro(await get(''), 400, 'FILTRO_OBRIGATORIO');
    esperaErro(await get('?departamento='), 400, 'FILTRO_OBRIGATORIO');
    esperaErro(await get(`?todos=1&departamento=${dep.TI}`), 400, 'FILTRO_CONFLITANTE');
    esperaErro(await get('?todos=true'), 400, 'TODOS_INVALIDO');
    esperaErro(await get('?todos=1&todos=1'), 400, 'TODOS_INVALIDO');
    esperaErro(await get(`?departamento=${encodeURIComponent("x' OR 1=1--")}`), 400, 'DEPARTAMENTO_ID_INVALIDO');
    esperaErro(await get('?departamento[$ne]=x'), 400, 'DEPARTAMENTO_ID_INVALIDO');
    esperaErro(await get(`?departamento=${'a'.repeat(65)}`), 400, 'DEPARTAMENTO_ID_INVALIDO');
    esperaErro(await get(`?${Array.from({ length: 51 }, (_, i) => `departamento=d${i}`).join('&')}`), 400, 'DEPARTAMENTO_ID_INVALIDO');
    esperaErro(await get('?departamento=nao-existe'), 404, 'DEPARTAMENTO_NAO_ENCONTRADO');
    esperaErro(await get(`?departamento=${dep.TI}&departamento=nao-existe`), 404, 'DEPARTAMENTO_NAO_ENCONTRADO');
  });

  it('não sombreia GET /campanhas/:id', async () => {
    esperaErro(await chamar('GET', '/campanhas/nao-existe', { token: analista }), 404, 'CAMPANHA_NAO_ENCONTRADA');
  });
});

describe('POST /campaigns: trava de envio em massa (confirmarEnvioTotal)', () => {
  const massa = Array.from({ length: 55 }, (_, i) => `massa.${String(i).padStart(2, '0')}@empresa.com`);
  const post = (body: Record<string, unknown>) => chamar('POST', '/campaigns', { token: analista, body: { nome: 'Massa', template: 'urgencia', ...body } });

  before(async () => {
    delete process.env.CAMPANHA_LIMITE_SEM_CONFIRMACAO;
    await prisma.user.createMany({
      data: massa.map((email, i) => ({ nome: `Massa ${i}`, email, senhaHash: 'x', perfil: 'Colaborador', status: 'Ativo' })),
    });
  });
  after(() => {
    delete process.env.CAMPANHA_LIMITE_SEM_CONFIRMACAO;
  });

  it('51 destinatários (acima do limite padrão de 50) sem confirmação: 422, nada criado; com confirmação: 201', async () => {
    const antes = await prisma.campaign.count();
    const r = await post({ destinatarios: massa.slice(0, 51) });
    esperaErro(r, 422, 'CONFIRMACAO_ENVIO_EM_MASSA');
    assert.match(r.body.mensagem, /atingiria 51 destinatário/);
    assert.equal(await prisma.campaign.count(), antes, 'a recusa não cria campanha nem envia e-mail');

    const ok = await post({ destinatarios: massa.slice(0, 51), confirmarEnvioTotal: true });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.dados.destinatarios.length, 51);
    // 50 não passa do limite.
    assert.equal((await post({ destinatarios: massa.slice(0, 50) })).status, 201);
  });

  it('todos os elegíveis da empresa sem confirmação: 422 mesmo abaixo do limite; com confirmação: 201', async () => {
    process.env.CAMPANHA_LIMITE_SEM_CONFIRMACAO = '100000';
    try {
      const todos = emails(await chamar('GET', '/campanhas/destinatarios?todos=1', { token: analista }));
      const r = await post({ destinatarios: todos });
      esperaErro(r, 422, 'CONFIRMACAO_ENVIO_EM_MASSA');
      assert.ok(r.body.mensagem.includes(`atingiria ${todos.length} destinatário(s), todos os elegíveis da empresa`), r.body.mensagem);
      // Um a menos que todos, abaixo do limite configurado: passa.
      assert.equal((await post({ destinatarios: todos.slice(1) })).status, 201);
      assert.equal((await post({ destinatarios: todos, confirmarEnvioTotal: true })).status, 201);
    } finally {
      delete process.env.CAMPANHA_LIMITE_SEM_CONFIRMACAO;
    }
  });

  it('a regra "todos os elegíveis" só vale com pelo menos 10 elegíveis: 9 → 201, 10 → 422', async () => {
    // O DOMINIO_INTERNO isola uma "empresa" pequena dentro do banco do teste.
    const original = process.env.DOMINIO_INTERNO;
    process.env.DOMINIO_INTERNO = '@pequena.exemplo';
    try {
      const pequena = Array.from({ length: 10 }, (_, i) => `p${i}@pequena.exemplo`);
      await prisma.user.createMany({
        data: pequena.slice(0, 9).map((email, i) => ({ nome: `Pequena ${i}`, email, senhaHash: 'x', perfil: 'Colaborador', status: 'Ativo' })),
      });
      const nove = emails(await chamar('GET', '/campanhas/destinatarios?todos=1', { token: analista }));
      assert.equal(nove.length, 9);
      assert.equal((await post({ destinatarios: nove })).status, 201, 'menos de 10 elegíveis: cobrir todos não exige confirmação');

      await prisma.user.create({ data: { nome: 'Pequena 9', email: pequena[9], senhaHash: 'x', perfil: 'Colaborador', status: 'Ativo' } });
      const dez = emails(await chamar('GET', '/campanhas/destinatarios?todos=1', { token: analista }));
      assert.equal(dez.length, 10);
      const r = await post({ destinatarios: dez });
      esperaErro(r, 422, 'CONFIRMACAO_ENVIO_EM_MASSA');
      assert.ok(r.body.mensagem.includes('atingiria 10 destinatário(s), todos os elegíveis da empresa'), r.body.mensagem);
      assert.equal((await post({ destinatarios: dez.slice(1) })).status, 201, 'nove de dez não cobre todos');
      assert.equal((await post({ destinatarios: dez, confirmarEnvioTotal: true })).status, 201);
    } finally {
      if (original === undefined) delete process.env.DOMINIO_INTERNO;
      else process.env.DOMINIO_INTERNO = original;
    }
  });

  it('o limite vem de CAMPANHA_LIMITE_SEM_CONFIRMACAO', async () => {
    process.env.CAMPANHA_LIMITE_SEM_CONFIRMACAO = '3';
    try {
      esperaErro(await post({ destinatarios: massa.slice(0, 4) }), 422, 'CONFIRMACAO_ENVIO_EM_MASSA');
      assert.equal((await post({ destinatarios: massa.slice(0, 3) })).status, 201);
    } finally {
      delete process.env.CAMPANHA_LIMITE_SEM_CONFIRMACAO;
    }
  });

  it('2 destinatários sem o campo: 201 (o contrato N2 AT1 não muda)', async () => {
    assert.equal((await post({ destinatarios: massa.slice(0, 2) })).status, 201);
    assert.equal((await post({ destinatario: 'colaborador@empresa.com' })).status, 201);
  });

  it('confirmarEnvioTotal que não seja o booleano true: 400, depois das regras do contrato', async () => {
    for (const ruim of ['true', 1, false, null, 'sim', {}])
      esperaErro(await post({ destinatarios: massa.slice(0, 2), confirmarEnvioTotal: ruim }), 400, 'CONFIRMACAO_INVALIDA');
    // Template ausente continua dando o erro do contrato primeiro.
    esperaErro(await post({ destinatarios: massa.slice(0, 2), template: '', confirmarEnvioTotal: 'x' }), 400, 'TEMPLATE_OBRIGATORIO');
  });
});
