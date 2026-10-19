// Pentest em codigo — dimensao: XSS ARMAZENADO (OWASP A03, cartao #13 da lista "Melhorias").
//
// Tese: a API guarda texto livre COMO TEXTO e so o devolve como JSON. Ela nao higieniza nem
// escapa HTML (isso deformaria o dado e geraria dupla codificacao): quem escapa na hora de
// desenhar e o React do frontend (provado em baluarte-frontend/src/__tests__/xss.test.tsx).
// Para o payload nunca virar codigo no navegador, toda resposta que o carrega precisa:
//  - ter Content-Type application/json (nunca text/html);
//  - trazer X-Content-Type-Options: nosniff (o navegador nao "adivinha" HTML);
//  - trazer a CSP default-src 'none' do helmet (nem uma resposta aberta direto executa script);
//  - devolver o payload literal, byte a byte, no mesmo campo em que entrou.
//
// Campos cobertos: nome e descricao do ativo, nome de usuario (cadastro, edicao, /me),
// nome de departamento, nome de campanha (criacao, lista, relatorio, e-mail simulado) e o
// detalhe e o autor da trilha de auditoria. Tambem: payload no caminho e na query nao e
// refletido nas mensagens de erro.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepararBanco,
  iniciarServidor,
  encerrarServidor,
  chamar,
  login,
  esperaErro,
  emailUnico,
  tokenDoEmail,
  aceitarTermosNoBanco,
  ADMIN,
  ANALISTA,
  SENHA_CONTA,
  type Resposta,
} from '../helpers.js';

prepararBanco(import.meta.url);
const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/db.js');
const { caixaDeSaida } = await import('../../src/config/email.js');

/** Payloads classicos de XSS armazenado (todos com ate 60 caracteres, o limite do departamento). */
const P = {
  script: '<script>alert("xss")</script>',
  img: '"><img src=x onerror=alert(1)>',
  svg: '<svg/onload=alert(document.cookie)>',
  iframe: "</title><iframe srcdoc='<script>alert(1)</script>'>",
  url: 'javascript:alert(1)//',
  template: "{{constructor.constructor('alert(1)')()}}",
};

/** A resposta e JSON puro, com os cabecalhos que impedem o navegador de interpreta-la como HTML. */
function jsonSemExecucao(r: Resposta, contexto: string): void {
  const tipo = r.headers.get('content-type') ?? '';
  assert.match(tipo, /^application\/json; charset=utf-8$/i, `${contexto}: Content-Type "${tipo}"`);
  assert.doesNotMatch(tipo, /html/i, `${contexto}: resposta nunca e HTML`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `${contexto}: X-Content-Type-Options`);
  assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'none'/, `${contexto}: CSP`);
}

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

/** Cria a conta pelo contrato com o nome dado e aceita o convite (status Ativo). */
async function contaComNome(nome: string, perfil: string, departamento?: string) {
  const email = emailUnico('xss');
  const r = await chamar('POST', '/users', { token: admin, body: { nome, email, perfil, ...(departamento ? { departamento } : {}) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  jsonSemExecucao(r, 'POST /users');
  assert.equal(r.body.dados.nome, nome, 'o cadastro devolve o nome literal');
  const convite = await tokenDoEmail(email, 'definir-senha');
  assert.ok(convite);
  const aceite = await chamar('POST', '/auth/reset-password/confirm', { body: { token: convite, novaSenha: SENHA_CONTA } });
  assert.equal(aceite.status, 200, JSON.stringify(aceite.body));
  const id = r.body.dados.idUsuario as string;
  // Conta criada pelo convite nasce sem o aceite dos termos (Melhorias #5): aceita direto no banco.
  await aceitarTermosNoBanco(id);
  return { id, email, token: await login(email, SENHA_CONTA) };
}

// -----------------------------------------------------------------------------
describe('XSS armazenado: ativo', () => {
  it('nome e descricao com HTML/JS sao guardados e devolvidos literais, em JSON com nosniff', async () => {
    const host = `xss-ativo-${Date.now()}.empresa.com`;
    const descricao = `${P.img} ${P.svg} ${P.iframe}`;
    const r = await chamar('POST', '/assets', { token: analista, body: { nome: P.script, tipo: 'Servidor', host, descricao } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    jsonSemExecucao(r, 'POST /assets');
    assert.equal(r.body.dados.nome, P.script);
    assert.equal(r.body.dados.descricao, descricao);

    // No banco, o texto e o mesmo que entrou: nada foi escapado nem removido.
    const gravado = await prisma.asset.findUniqueOrThrow({ where: { id: r.body.dados.id } });
    assert.equal(gravado.nome, P.script);
    assert.equal(gravado.descricao, descricao);

    const lista = await chamar('GET', '/assets', { token: analista });
    assert.equal(lista.status, 200);
    jsonSemExecucao(lista, 'GET /assets');
    const lido = lista.body.dados.find((a: { host: string }) => a.host === host);
    assert.ok(lido, 'o ativo aparece na lista');
    assert.equal(lido.nome, P.script);
    assert.equal(lido.descricao, descricao);
  });
});

// -----------------------------------------------------------------------------
describe('XSS armazenado: usuario e departamento', () => {
  it('nome de usuario e de departamento voltam literais no cadastro, na lista, no /me e na edicao', async () => {
    const dep = await chamar('POST', '/departamentos', { token: admin, body: { nome: P.img } });
    assert.equal(dep.status, 201, JSON.stringify(dep.body));
    jsonSemExecucao(dep, 'POST /departamentos');
    assert.equal(dep.body.dados.nome, P.img);

    const conta = await contaComNome(P.svg, 'Colaborador', P.img);

    const me = await chamar('GET', '/me', { token: conta.token });
    assert.equal(me.status, 200);
    jsonSemExecucao(me, 'GET /me');
    assert.equal(me.body.dados.nome, P.svg);
    assert.equal(me.body.dados.departamento, P.img);

    const edicao = await chamar('PATCH', `/users/${conta.id}`, { token: admin, body: { nome: P.template } });
    assert.equal(edicao.status, 200, JSON.stringify(edicao.body));
    jsonSemExecucao(edicao, 'PATCH /users/:id');

    const lista = await chamar('GET', '/usuarios', { token: admin });
    assert.equal(lista.status, 200);
    jsonSemExecucao(lista, 'GET /usuarios');
    const lido = lista.body.dados.find((u: { id: string }) => u.id === conta.id);
    assert.equal(lido.nome, P.template);
    assert.equal(lido.departamento, P.img);

    const deps = await chamar('GET', '/departamentos', { token: admin });
    jsonSemExecucao(deps, 'GET /departamentos');
    assert.ok(deps.body.dados.some((d: { nome: string }) => d.nome === P.img));
  });
});

// -----------------------------------------------------------------------------
describe('XSS armazenado: campanha, e-mail simulado e trilha de auditoria', () => {
  it('nome da campanha, do destinatario e do departamento voltam literais; o e-mail e so texto; a auditoria guarda o literal', async () => {
    const depNome = `${P.url} dep`;
    assert.equal((await chamar('POST', '/departamentos', { token: admin, body: { nome: depNome } })).status, 201);
    const autor = await contaComNome(P.iframe, 'Analista');
    const alvo = await contaComNome(P.script, 'Colaborador', depNome);

    const desde = caixaDeSaida.length;
    const criada = await chamar('POST', '/campaigns', {
      token: autor.token,
      body: { nome: P.img, destinatarios: [alvo.email], template: 'urgencia' },
    });
    assert.equal(criada.status, 201, JSON.stringify(criada.body));
    jsonSemExecucao(criada, 'POST /campaigns');
    assert.equal(criada.body.dados.nome, P.img);
    const id = criada.body.dados.idCampanha as string;

    const lista = await chamar('GET', '/campanhas', { token: analista });
    jsonSemExecucao(lista, 'GET /campanhas');
    assert.equal(lista.body.dados.find((c: { id: string }) => c.id === id).nome, P.img);

    const relatorio = await chamar('GET', `/campanhas/${id}`, { token: analista });
    assert.equal(relatorio.status, 200);
    jsonSemExecucao(relatorio, 'GET /campanhas/:id');
    assert.equal(relatorio.body.dados.nome, P.img);
    assert.ok(relatorio.body.dados.porDepartamento.some((d: { departamento: string }) => d.departamento === depNome));

    // O e-mail simulado so tem texto (o tipo Email nao tem campo HTML): o nome vai literal,
    // e nenhum cliente de e-mail o interpreta como marcacao.
    const email = caixaDeSaida.slice(desde).find((e) => e.para === alvo.email);
    assert.ok(email, 'o destinatario recebeu o e-mail simulado');
    assert.deepEqual(Object.keys(email).sort(), ['assunto', 'para', 'texto']);
    assert.ok(email.texto.includes(P.script), 'o nome do destinatario vai como texto literal');

    // Trilha de auditoria: o detalhe guarda o nome literal da campanha e o autor sai com o nome literal.
    const trilha = await chamar('GET', '/auditoria?acao=CRIAR_CAMPANHA&tamanho=100', { token: admin });
    assert.equal(trilha.status, 200);
    jsonSemExecucao(trilha, 'GET /auditoria');
    const registro = trilha.body.dados.find((d: { detalhe: string | null }) => d.detalhe?.startsWith(`${id} (`));
    assert.ok(registro, 'a criacao da campanha esta na trilha');
    assert.equal(registro.detalhe, `${id} (${P.img}, urgencia, 1 destinatário(s))`);
    assert.equal(registro.usuario.nome, P.iframe);

    const depTrilha = await chamar('GET', '/auditoria?acao=CRIAR_DEPARTAMENTO&tamanho=100', { token: admin });
    assert.ok(depTrilha.body.dados.some((d: { detalhe: string | null }) => d.detalhe === depNome));
  });
});

// -----------------------------------------------------------------------------
describe('XSS refletido: entrada no caminho e na query nao volta na resposta', () => {
  it('rota inexistente com payload no caminho: 404 em JSON com mensagem fixa', async () => {
    const r = await chamar('GET', `/${encodeURIComponent(P.script)}`, { token: analista });
    esperaErro(r, 404, 'ROTA_NAO_ENCONTRADA');
    jsonSemExecucao(r, 'GET /<payload>');
    assert.doesNotMatch(JSON.stringify(r.body), /script|alert/i);
  });

  it('parametro invalido com payload na query: 400 em JSON com mensagem fixa', async () => {
    const r = await chamar('GET', `/findings/classificacao?cvss=${encodeURIComponent(P.img)}`);
    esperaErro(r, 400, 'CVSS_INVALIDO');
    jsonSemExecucao(r, 'GET /findings/classificacao?cvss=<payload>');
    assert.doesNotMatch(JSON.stringify(r.body), /onerror|alert|<img/i);
  });

  it('busca da lista de vulnerabilidades com payload: 200 em JSON, sem eco do termo', async () => {
    const r = await chamar('GET', `/vulnerabilidades?q=${encodeURIComponent(P.svg)}`, { token: analista });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    jsonSemExecucao(r, 'GET /vulnerabilidades?q=<payload>');
    assert.doesNotMatch(JSON.stringify(r.body), /onload|<svg/i);
  });
});
