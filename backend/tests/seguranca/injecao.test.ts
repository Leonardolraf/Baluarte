// Testes AUTOMATIZADOS de seguranca — dimensao INJECAO.
//
// A API usa Prisma (queries parametrizadas), entao a tese destes testes e provar
// que a entrada e SEMPRE tratada como DADO: payloads de SQLi/NoSQLi/prototype
// pollution nao vazam dados, nao burlam credencial, nao poluem objetos e nunca
// derrubam o servidor com 500. Onde o backend REAGE MAL (500 em vez de 400/404),
// o caso vira `it.skip` com TODO citando o achado — ver findings no relatorio.
//
// Banco SQLite ISOLADO por arquivo (helpers.prepararBanco). So usa helpers.ts.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

// Tokens compartilhados (contas do seed).
let admin: string;
let analista: string;
before(async () => {
  await iniciarServidor(app);
  admin = await login(ADMIN.email, ADMIN.senha);
  analista = await login(ANALISTA.email, ANALISTA.senha);
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

// Afirma que uma resposta NUNCA e um erro interno: injecao nao deve crashar o handler.
function nunca500(r: { status: number; body: any }, contexto = ''): void {
  assert.notEqual(r.status, 500, `500 (ERRO_INTERNO) sob injecao ${contexto}: ${JSON.stringify(r.body)}`);
  assert.notEqual(r.body?.codigoErro, 'ERRO_INTERNO', `ERRO_INTERNO sob injecao ${contexto}`);
}

// Nenhum objeto base foi contaminado por prototype pollution.
function protoLimpo(marca: string): void {
  assert.equal(({} as any)[marca], undefined, `Object.prototype poluido por "${marca}"`);
  assert.equal((Object.prototype as any)[marca], undefined, `Object.prototype poluido por "${marca}"`);
  assert.equal(([] as any)[marca], undefined, `Array.prototype poluido por "${marca}"`);
}

// -----------------------------------------------------------------------------
// 1. SQL injection classico no LOGIN
// -----------------------------------------------------------------------------
describe('SQLi no login', () => {
  it('payloads de SQLi com sintaxe invalida de e-mail nao burlam: 400 EMAIL_INVALIDO, nunca 200/500', async () => {
    const payloads = [
      "admin@empresa.com' OR '1'='1",
      "' OR '1'='1' --",
      '"; DROP TABLE users; --',
      "admin@empresa.com' OR 1=1#",
      'admin@empresa.com UNION SELECT * FROM User',
    ];
    for (const email of payloads) {
      const r = await chamar('POST', '/login', { body: { email, senha: 'Qualquer@1' } });
      nunca500(r, `login email=${email}`);
      assert.notEqual(r.status, 200, `NUNCA autenticar com payload ${email}`);
      esperaErro(r, 400, 'EMAIL_INVALIDO');
    }
  });

  it('SQLi que passa no formato de e-mail e tratado como literal: 401, sem bypass', async () => {
    // Estes strings sao e-mails validos pelo regex (sem espacos), mas o Prisma os
    // usa como valor parametrizado — nenhum usuario casa, logo 401.
    const payloads = [
      "a'or'1'='1@empresa.com",
      "x'--@empresa.com",
      "'or''='@empresa.com",
      "admin@empresa.com'--",
      "admin@empresa.com'/*",
    ];
    for (const email of payloads) {
      const r = await chamar('POST', '/login', { body: { email, senha: 'Qualquer@1' } });
      nunca500(r, `login literal ${email}`);
      esperaErro(r, 401, 'CREDENCIAIS_INVALIDAS');
    }
  });

  it('NUL byte e unicode no e-mail nao burlam autenticacao', async () => {
    const payloads = [
      'admin@empresa.com\u0000',
      'admin@empresa.com%00',
      'admin@empresa.com‮',
      'ADMIN@EMPRESA.COM\t',
    ];
    for (const email of payloads) {
      const r = await chamar('POST', '/login', { body: { email, senha: 'Qualquer@1' } });
      nunca500(r, `login nul/unicode ${JSON.stringify(email)}`);
      assert.notEqual(r.status, 200, `NUNCA autenticar com ${JSON.stringify(email)}`);
      assert.equal(r.body.status, 'erro');
    }
  });
});

// -----------------------------------------------------------------------------
// 2. NoSQL / operator injection (objeto onde se espera string)
// -----------------------------------------------------------------------------
describe('operator injection (objeto no lugar de string)', () => {
  it('login com email/senha como objeto (operator injection) nao autentica nem crasha', async () => {
    // O ataque NoSQL classico ({$ne:null}, {$gt:''}) nao vaza: o email nao e string
    // (400) e a senha objeto vira "[object Object]" no bcrypt.compare (401). Sem bypass.
    const casos: Array<Record<string, unknown>> = [
      { email: { $ne: null }, senha: 'x' },
      { email: { $gt: '' }, senha: { $gt: '' } },
      { email: ['a@empresa.com'], senha: 'x' },
      { email: ANALISTA.email, senha: { $ne: null } },
      { email: ANALISTA.email, senha: { $gt: '' } },
    ];
    for (const body of casos) {
      const r = await chamar('POST', '/login', { body });
      nunca500(r, `login ${JSON.stringify(body)}`);
      assert.notEqual(r.status, 200, `NUNCA autenticar com operator injection ${JSON.stringify(body)}`);
      assert.equal(r.body.status, 'erro');
    }
  });

  // ACHADO (confirmado, baixa severidade): a senha nao e validada como string. Enviada
  // como array de um elemento com a senha correta (`senha: ["Senha@123"]`), o handler
  // faz `bcrypt.compare(String(["Senha@123"]), hash)` -> "Senha@123" -> AUTENTICA (200).
  // Nao e bypass (exige ja conhecer a senha), mas o tipo deveria ser rejeitado (400).
  // Ver api.ts POST /login (senha nao checa `typeof === 'string'`).
  // TODO(seguranca): exigir `typeof senha === 'string'` antes do bcrypt.compare.
  it('[FINDING senha-array-coercion] senha como array deveria dar 400, nao autenticar', async () => {
    const r = await chamar('POST', '/login', { body: { email: ANALISTA.email, senha: [ANALISTA.senha] } });
    assert.notEqual(r.status, 200, 'senha em array nao deveria autenticar');
    assert.equal(r.status, 400);
  });

  it('operator injection na SENHA nao burla a conta real (senha continua valendo)', async () => {
    // Conta-vitima dedicada, para nao poluir o limitador das contas do seed.
    const vitima = await criarUsuario(admin, 'Colaborador', 'vitima-op');
    for (const senha of [{ $ne: null }, { $gt: '' }]) {
      const r = await chamar('POST', '/login', { body: { email: vitima.email, senha } });
      nunca500(r, 'senha objeto');
      // A senha nao-string e recusada como entrada invalida (400) ANTES de qualquer
      // comparacao — mais cedo e mais seguro do que deixar coagir e cair em 401.
      esperaErro(r, 400, 'SENHA_OBRIGATORIA');
    }
    // A senha provisoria real ainda autentica: a defesa nao quebrou a conta.
    const token = await login(vitima.email, SENHA_PROVISORIA);
    assert.equal((await chamar('GET', '/me', { token })).status, 200);
  });

  it('reset-password com e-mail como objeto e rejeitado (400) e nao gera token', async () => {
    for (const email of [{ $ne: null }, ['a@empresa.com'], { $regex: '.*' }]) {
      const r = await chamar('POST', '/auth/reset-password', { body: { email } });
      nunca500(r, `reset ${JSON.stringify(email)}`);
      esperaErro(r, 400, 'EMAIL_INVALIDO');
    }
    assert.equal(await prisma.passwordResetToken.count(), 0, 'operator injection nao deve gerar token de reset');
  });
});

// -----------------------------------------------------------------------------
// 3. Injecao em PATH params (lookup por id/token)
// -----------------------------------------------------------------------------
describe('SQLi em path params', () => {
  const PAYLOADS = [
    "' OR '1'='1",
    "'; DROP TABLE Finding; --",
    '1 OR 1=1',
    "%27%20OR%201%3D1",
    '../../../etc/passwd',
    'null',
  ];

  it('GET /treinamentos/:token (publico) -> 404, nunca 500/vazamento', async () => {
    for (const p of PAYLOADS) {
      const r = await chamar('GET', `/treinamentos/${encodeURIComponent(p)}`);
      nunca500(r, `treinamento ${p}`);
      esperaErro(r, 404, 'TREINAMENTO_NAO_ENCONTRADO');
    }
  });

  it('GET /vulnerabilidades/:id e /campanhas/:id -> 404 coerente', async () => {
    for (const p of PAYLOADS) {
      const rv = await chamar('GET', `/vulnerabilidades/${encodeURIComponent(p)}`, { token: analista });
      nunca500(rv, `vuln id ${p}`);
      esperaErro(rv, 404, 'FINDING_NAO_ENCONTRADO');
      const rc = await chamar('GET', `/campanhas/${encodeURIComponent(p)}`, { token: analista });
      nunca500(rc, `campanha id ${p}`);
      esperaErro(rc, 404, 'CAMPANHA_NAO_ENCONTRADA');
    }
  });

  it('PATCH/DELETE /users/:id com SQLi no id -> 404 USUARIO_NAO_ENCONTRADO, sem afetar outras linhas', async () => {
    const antes = await prisma.user.count();
    for (const p of PAYLOADS) {
      const rp = await chamar('PATCH', `/users/${encodeURIComponent(p)}`, { token: admin, body: { nome: 'X' } });
      nunca500(rp, `patch user ${p}`);
      esperaErro(rp, 404, 'USUARIO_NAO_ENCONTRADO');
      const rd = await chamar('DELETE', `/users/${encodeURIComponent(p)}`, { token: admin });
      nunca500(rd, `delete user ${p}`);
      esperaErro(rd, 404, 'USUARIO_NAO_ENCONTRADO');
    }
    assert.equal(await prisma.user.count(), antes, 'DROP/DELETE injetado nao deve remover usuarios');
  });
});

// -----------------------------------------------------------------------------
// 4. Injecao em QUERY string (filtros de /vulnerabilidades)
// -----------------------------------------------------------------------------
describe('injecao na query string de /vulnerabilidades', () => {
  it('?q= com SQLi (string) e tratado como filtro literal: 200 com lista coerente', async () => {
    for (const q of ["' OR '1'='1", "'; DROP TABLE Finding; --", '%00', 'A03']) {
      const r = await chamar('GET', `/vulnerabilidades?q=${encodeURIComponent(q)}`, { token: analista });
      nunca500(r, `q=${q}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.status, 'sucesso');
      assert.ok(Array.isArray(r.body.dados), 'dados deve ser uma lista');
    }
  });

  it('?severidade= e ?status= com SQLi (string) devolvem 200 e nao vazam tudo', async () => {
    const r = await chamar(
      'GET',
      `/vulnerabilidades?severidade=${encodeURIComponent("Alto' OR '1'='1")}&status=${encodeURIComponent("Aberta'--")}`,
      { token: analista },
    );
    nunca500(r, 'sev/status sqli');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'sucesso');
    // Nenhum finding tem severidade/status igual ao payload -> lista vazia.
    assert.equal(r.body.dados.length, 0, 'filtro injetado nao deve casar registros');
  });

  // ACHADO (confirmado): filtros de query aceitam sintaxe de objeto/array do parser
  // "extended" do Express (?q[$ne]=x, ?severidade[]=Alto). O handler chama
  // `q.toLowerCase()` / `severidade.toLowerCase()` num objeto/array -> TypeError ->
  // 500 ERRO_INTERNO. Entrada do usuario nao deve derrubar o handler (esperado: 400
  // ou 200). Ver read.ts GET /vulnerabilidades (linhas ~151-157).
  // TODO(seguranca): coagir req.query.{q,severidade,status} a string (ou 400) antes de usar.
  it('[FINDING q-object-injection] ?q[$ne]= / ?severidade[]= nao devem causar 500', async () => {
    for (const qs of ['q[$ne]=x', 'severidade[]=Alto', 'status[$gt]=']) {
      const r = await chamar('GET', `/vulnerabilidades?${qs}`, { token: analista });
      nunca500(r, qs);
      assert.ok(r.status === 200 || r.status === 400, `esperava 200/400, veio ${r.status}`);
    }
  });
});

// -----------------------------------------------------------------------------
// 5. Prototype pollution
// -----------------------------------------------------------------------------
describe('prototype pollution', () => {
  it('POST /users com __proto__/constructor nao polui objetos e ignora chaves extras', async () => {
    const email = emailUnico('proto-user');
    const r = await chamar('POST', '/users', {
      token: admin,
      body: {
        nome: 'Proto Teste',
        email,
        perfil: 'Colaborador',
        __proto__: { pollutedUser: 'sim' },
        constructor: { prototype: { pollutedUser: 'sim' } },
      } as any,
    });
    nunca500(r, 'users proto');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    protoLimpo('pollutedUser');
  });

  it('PUT /configuracoes/notificacoes com __proto__ nao polui e chave-lixo -> 400', async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'proto-pref');
    const token = await login(conta.email, SENHA_PROVISORIA);
    // Payload so com __proto__ (nenhuma preferencia valida) -> 400, sem poluir.
    const so = await chamar('PUT', '/configuracoes/notificacoes', { token, body: { __proto__: { pollutedPref: 1 } } as any });
    nunca500(so, 'pref proto only');
    esperaErro(so, 400, 'PREFERENCIA_INVALIDA');
    protoLimpo('pollutedPref');
    // Payload com __proto__ + campo valido -> aplica so o valido, sem poluir.
    const misto = await chamar('PUT', '/configuracoes/notificacoes', {
      token,
      body: { __proto__: { pollutedPref: 1 }, somenteCriticas: true } as any,
    });
    nunca500(misto, 'pref proto+valido');
    assert.equal(misto.status, 200);
    assert.equal(misto.body.dados.somenteCriticas, true);
    protoLimpo('pollutedPref');
  });

  it('POST /assets com __proto__/constructor nao polui objetos', async () => {
    const r = await chamar('POST', '/assets', {
      token: admin,
      body: {
        nome: 'Ativo Proto',
        tipo: 'Rede',
        host: `proto-${Date.now()}.empresa.com`,
        __proto__: { pollutedAsset: 'sim' },
        constructor: { prototype: { pollutedAsset: 'sim' } },
      } as any,
    });
    nunca500(r, 'assets proto');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    protoLimpo('pollutedAsset');
  });
});

// -----------------------------------------------------------------------------
// 6. Mass assignment / campos extras / tipos errados
// -----------------------------------------------------------------------------
describe('mass assignment e tipos errados', () => {
  it('POST /assets ignora campos extras (id/status): id gerado pelo servidor, status Ativo', async () => {
    const host = `mass-${Date.now()}.empresa.com`;
    const r = await chamar('POST', '/assets', {
      token: admin,
      body: { nome: 'Mass Assign', tipo: 'Servidor', host, id: 'id-forjado', status: 'Inativo', criadoEm: '1999-01-01' } as any,
    });
    nunca500(r, 'assets mass');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.notEqual(r.body.dados.id, 'id-forjado', 'id nao pode ser controlado pelo cliente');
    assert.equal(r.body.dados.status, 'Ativo', 'status nao pode ser injetado pelo cliente');
  });

  it('POST /users ignora status/senhaHash/perfil-fantasma forjados no corpo', async () => {
    const email = emailUnico('mass-user');
    const r = await chamar('POST', '/users', {
      token: admin,
      body: { nome: 'Mass User', email, perfil: 'Colaborador', status: 'Ativo', senhaHash: 'hash-forjado', id: 'u-hack' } as any,
    });
    nunca500(r, 'users mass');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.notEqual(r.body.dados.idUsuario, 'u-hack');
    // status forjado ("Ativo") nao vale: a conta nasce Pendente e a senha e a provisoria.
    const lista = await chamar('GET', '/usuarios', { token: admin });
    const criado = lista.body.dados.find((u: any) => u.email === email.toLowerCase());
    assert.ok(criado, 'usuario deveria existir');
    assert.equal(criado.status, 'Pendente', 'status Ativo forjado nao pode ser aceito');
    // senhaHash forjado nao vale: login so com a provisoria.
    await login(email, SENHA_PROVISORIA);
  });

  it('tipos errados em /assets (tipo array, host objeto) -> 400 de validacao, nunca 500', async () => {
    const t = await chamar('POST', '/assets', { token: admin, body: { nome: 'X', tipo: ['Rede'], host: '10.1.1.1' } as any });
    nunca500(t, 'tipo array');
    esperaErro(t, 400, 'TIPO_INVALIDO');
    const h = await chamar('POST', '/assets', { token: admin, body: { nome: 'X', tipo: 'Rede', host: { $ne: null } } as any });
    nunca500(h, 'host objeto');
    esperaErro(h, 400, 'HOST_INVALIDO');
  });

  it('template como array/objeto em /campaigns -> 400, sem crash', async () => {
    const a = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'C', destinatario: 'a@empresa.com', template: ['urgencia'] } as any });
    nunca500(a, 'template array');
    esperaErro(a, 400, 'TEMPLATE_OBRIGATORIO');
    const d = await chamar('POST', '/campaigns', { token: analista, body: { nome: 'C', destinatario: { $ne: null }, template: 'urgencia' } as any });
    nunca500(d, 'destinatario objeto');
    esperaErro(d, 400, 'EMAIL_INVALIDO');
  });

  // ACHADO (confirmado): campos String recebendo NUMERO passam pelas validacoes
  // (`vazio(123)` e falso) e chegam ao Prisma, que lanca PrismaClientValidationError
  // -> 500 ERRO_INTERNO. Esperado: 400 de validacao. Vale para nome em
  // POST /assets, /users e /campaigns. Ver api.ts (nome nao e checado por tipo).
  // TODO(seguranca): validar `typeof nome === 'string'` antes de gravar.
  it('[FINDING nome-numerico] nome numerico deve dar 400, nao 500', async () => {
    const r = await chamar('POST', '/assets', { token: admin, body: { nome: 12345, tipo: 'Rede', host: '10.2.2.2' } as any });
    nunca500(r, 'nome numero');
    assert.equal(r.status, 400);
  });
});

// -----------------------------------------------------------------------------
// 7. Header injection / CRLF em campo refletido
// -----------------------------------------------------------------------------
describe('CRLF / header injection em campo refletido', () => {
  it('CRLF no nome do usuario nao injeta cabecalho e volta como dado literal no JSON', async () => {
    const email = emailUnico('crlf');
    const nome = 'Fulano\r\nX-Injected: 1\r\nSet-Cookie: sid=evil';
    const r = await chamar('POST', '/users', { token: admin, body: { nome, email, perfil: 'Colaborador' } });
    nunca500(r, 'crlf nome');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.headers.get('x-injected'), null, 'CRLF nao pode virar cabecalho de resposta');
    assert.equal(r.headers.get('set-cookie'), null, 'CRLF nao pode injetar Set-Cookie');
    assert.equal(r.body.dados.nome, nome, 'o nome volta como string literal (dado), sem quebrar');
  });
});

// -----------------------------------------------------------------------------
// 8. A defesa NAO quebra dados legitimos (aspas, acentos, apostrofos)
// -----------------------------------------------------------------------------
describe('dados legitimos com aspas/acentos sao preservados', () => {
  it('usuario com aspas/apostrofo/acento no nome e criado e lido intacto', async () => {
    const email = emailUnico('acentos');
    const nome = `José "O'Brien" D'Ávila — Ação & Cia --`;
    const r = await chamar('POST', '/users', { token: admin, body: { nome, email, perfil: 'Analista' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.nome, nome);
    // Round-trip pela listagem (leitura vinda do banco).
    const lista = await chamar('GET', '/usuarios', { token: admin });
    const criado = lista.body.dados.find((u: any) => u.email === email.toLowerCase());
    assert.ok(criado, 'usuario com acentos deveria aparecer na listagem');
    assert.equal(criado.nome, nome, 'nome com aspas/acentos deve ser gravado e lido sem alteracao');
  });

  it('ativo com acentos no nome e host valido e criado e lido intacto', async () => {
    const host = `ação-são-paulo-${Date.now()}.empresa.com`;
    const nome = `Servidor "Ação" São Paulo O'Higgins`;
    // host com acento nao passa em hostValido -> uso host ASCII valido, nome com acentos.
    const hostAscii = `srv-${Date.now()}.empresa.com`;
    const r = await chamar('POST', '/assets', { token: admin, body: { nome, tipo: 'Servidor', host: hostAscii } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.nome, nome);
    const lista = await chamar('GET', '/assets', { token: admin });
    const criado = lista.body.dados.find((a: any) => a.host === hostAscii);
    assert.ok(criado, 'ativo deveria aparecer na listagem');
    assert.equal(criado.nome, nome, 'nome com aspas/acentos preservado');
    void host;
  });
});

// -----------------------------------------------------------------------------
// 9. Corpo JSON malformado
// -----------------------------------------------------------------------------
describe('JSON malformado', () => {
  it('corpo JSON quebrado -> 400 JSON_INVALIDO, nunca 500', async () => {
    const r = await chamar('POST', '/login', { raw: '{"email": "a@empresa.com", "senha": ' });
    nunca500(r, 'json malformado');
    esperaErro(r, 400, 'JSON_INVALIDO');
  });
});
