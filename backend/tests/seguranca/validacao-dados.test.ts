// Testes AUTOMATIZADOS de segurança — DIMENSÃO: validacao-dados.
//
// Foco: validação de entrada e regras de negócio — impedir que dado inválido,
// perigoso ou com o tipo errado entre no sistema. Cada it() dispara payloads
// reais contra a API local (SQLite isolado, ver helpers.ts) e afirma o
// resultado SEGURO esperado (rejeição com o código certo / valor não aceito).
//
// Quando um caso documenta um comportamento INSEGURO real do backend, ele fica
// como it.skip com um TODO citando o finding — para o backend ser corrigido
// antes de destravar. Os demais devem estar todos verdes.
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
  SENHA_CONTA,
} from '../helpers.js';

prepararBanco(import.meta.url);
const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/config/db.js');

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

// -----------------------------------------------------------------------------
// Ativos: validação de host, tipo, nome e duplicidade
// -----------------------------------------------------------------------------
describe('POST /assets — validação de entrada', () => {
  it('rejeita hosts inválidos/perigosos com HOST_INVALIDO', async () => {
    const hostsRuins = [
      '999.1.1.1', // octeto fora de 0-255
      '256.0.0.1', // octeto fora de 0-255
      'meu host', // espaço interno
      ' ', // só espaço
      '', // vazio
      'javascript:alert(1)', // esquema de script
      'ftp://exemplo.com', // esquema que nao e http(s): nao e normalizado
      'https://', // so o esquema: host vazio
      'https://usuario:senha@exemplo.com/', // credenciais na URL nao viram host
      'https://exemplo.com:porta/', // porta nao numerica
      'https://999.1.1.1/login', // normalizado, mas o IPv4 continua fora da faixa
      'exemplo.com/rota', // barra no caminho (sem esquema o valor nao e normalizado)
      'semdominio', // rótulo único, sem ponto
      "10.0.0.1'; DROP TABLE assets;--", // tentativa de injeção no host
    ];
    for (const host of hostsRuins) {
      const r = await chamar('POST', '/assets', { token: analista, body: { nome: 'Ativo X', tipo: 'Rede', host } });
      esperaErro(r, 400, 'HOST_INVALIDO');
    }
  });

  it('aceita IPv4 em faixa e nome DNS válido (201) e ecoa os campos', async () => {
    const ip = await chamar('POST', '/assets', { token: analista, body: { nome: 'Borda IPv4', tipo: 'Rede', host: '198.51.100.40' } });
    assert.equal(ip.status, 201);
    assert.equal(ip.body.dados.host, '198.51.100.40');
    assert.equal(ip.body.dados.status, 'Ativo');

    const dns = await chamar('POST', '/assets', { token: analista, body: { nome: 'Servidor DNS', tipo: 'Servidor', host: 'app-teste.empresa.com' } });
    assert.equal(dns.status, 201);
    assert.equal(dns.body.dados.host, 'app-teste.empresa.com');

    // Limite inferior/superior do octeto é aceito.
    const borda = await chamar('POST', '/assets', { token: analista, body: { nome: 'Borda octeto', tipo: 'Rede', host: '0.0.0.255' } });
    assert.equal(borda.status, 201);
  });

  it('aceita endereço com http(s):// e guarda só o host (B10)', async () => {
    const casos: [string, string][] = [
      ['https://portal-b10.empresa.com/login', 'portal-b10.empresa.com'],
      ['HTTP://intranet-b10.empresa.com:8080/', 'intranet-b10.empresa.com'],
      ['  https://198.51.100.90:8443/a/b?x=1#topo  ', '198.51.100.90'],
      ['https://busca-b10.empresa.com?q=1', 'busca-b10.empresa.com'],
    ];
    for (const [enviado, guardado] of casos) {
      const r = await chamar('POST', '/assets', { token: analista, body: { nome: 'Com protocolo', tipo: 'Aplicacao', host: enviado } });
      assert.equal(r.status, 201, `${enviado}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.dados.host, guardado);
      assert.equal((await prisma.asset.findUniqueOrThrow({ where: { id: r.body.dados.id } })).host, guardado);
    }
    // O host normalizado colide com o mesmo host sem protocolo.
    esperaErro(
      await chamar('POST', '/assets', { token: analista, body: { nome: 'Repetido', tipo: 'Rede', host: 'portal-b10.empresa.com' } }),
      409,
      'ATIVO_DUPLICADO',
    );
    esperaErro(
      await chamar('POST', '/assets', { token: analista, body: { nome: 'Repetido', tipo: 'Rede', host: 'https://192.168.0.10/' } }),
      409,
      'ATIVO_DUPLICADO',
    );
    // Mensagem do contrato inalterada para o que continua inválido.
    const ruim = await chamar('POST', '/assets', { token: analista, body: { nome: 'X', tipo: 'Rede', host: 'https://meu host/' } });
    esperaErro(ruim, 400, 'HOST_INVALIDO');
    assert.equal(ruim.body.mensagem, 'Host inválido');
  });

  it('grava IP e descrição opcionais, devolve no POST e no GET /assets (B10)', async () => {
    const descricao = 'Servidor do portal do cliente — DMZ';
    const r = await chamar('POST', '/assets', {
      token: analista,
      body: { nome: 'Portal B10', tipo: 'Servidor', host: 'portal-ip.empresa.com', ip: ' 203.0.113.7 ', descricao: `  ${descricao}  ` },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.dados.ip, '203.0.113.7');
    assert.equal(r.body.dados.descricao, descricao);
    assert.ok(r.body.dados.criadoEm);

    const lista = await chamar('GET', '/assets', { token: analista });
    const salvo = lista.body.dados.find((a: { id: string }) => a.id === r.body.dados.id);
    assert.equal(salvo.ip, '203.0.113.7');
    assert.equal(salvo.descricao, descricao);

    // Sem os campos (o corpo do contrato): null. Vazio também vira null.
    const sem = await chamar('POST', '/assets', { token: analista, body: { nome: 'Sem extras', tipo: 'Rede', host: '198.51.100.91' } });
    assert.equal(sem.status, 201);
    assert.equal(sem.body.dados.ip, null);
    assert.equal(sem.body.dados.descricao, null);
    const vazio = await chamar('POST', '/assets', { token: analista, body: { nome: 'Vazio', tipo: 'Rede', host: '198.51.100.92', ip: '', descricao: '   ' } });
    assert.equal(vazio.status, 201);
    assert.equal(vazio.body.dados.ip, null);
    assert.equal(vazio.body.dados.descricao, null);

    // Limite: 500 caracteres passa.
    const limite = await chamar('POST', '/assets', { token: analista, body: { nome: 'Limite', tipo: 'Rede', host: '198.51.100.93', descricao: 'a'.repeat(500) } });
    assert.equal(limite.status, 201);
  });

  it('rejeita IP fora de IPv4 (IP_INVALIDO) e descrição longa ou não textual (DESCRICAO_INVALIDA) — B10', async () => {
    for (const ip of ['999.1.1.1', '10.0.0', 'abc', '::1', 42, ['10.0.0.1'], { $ne: null }]) {
      esperaErro(
        await chamar('POST', '/assets', { token: analista, body: { nome: 'IP ruim', tipo: 'Rede', host: '198.51.100.94', ip } }),
        400,
        'IP_INVALIDO',
      );
    }
    for (const descricao of ['a'.repeat(501), 123, ['x'], { a: 1 }]) {
      const r = await chamar('POST', '/assets', { token: analista, body: { nome: 'Desc ruim', tipo: 'Rede', host: '198.51.100.95', descricao } });
      esperaErro(r, 400, 'DESCRICAO_INVALIDA');
    }
    // Erros do contrato vêm antes das extensões: host inválido + IP inválido -> HOST_INVALIDO.
    esperaErro(
      await chamar('POST', '/assets', { token: analista, body: { nome: 'Ordem', tipo: 'Rede', host: '999.1.1.1', ip: 'x' } }),
      400,
      'HOST_INVALIDO',
    );
    assert.equal(await prisma.asset.count({ where: { host: { in: ['198.51.100.94', '198.51.100.95'] } } }), 0);
  });

  it('rejeita tipo fora da lista (TIPO_INVALIDO) e nome ausente (NOME_OBRIGATORIO)', async () => {
    esperaErro(
      await chamar('POST', '/assets', { token: analista, body: { nome: 'Y', tipo: 'Aplicação', host: '198.51.100.61' } }),
      400,
      'TIPO_INVALIDO', // 'Aplicacao' (sem acento) é o válido; com acento cai fora
    );
    esperaErro(
      await chamar('POST', '/assets', { token: analista, body: { nome: 'Y', tipo: 'Firewall', host: '198.51.100.62' } }),
      400,
      'TIPO_INVALIDO',
    );
    esperaErro(await chamar('POST', '/assets', { token: analista, body: { tipo: 'Rede', host: '198.51.100.64' } }), 400, 'NOME_OBRIGATORIO');
    esperaErro(await chamar('POST', '/assets', { token: analista, body: { nome: '', tipo: 'Rede', host: '198.51.100.65' } }), 400, 'NOME_OBRIGATORIO');
  });

  it('rejeita host duplicado, normalizando espaços das pontas (ATIVO_DUPLICADO)', async () => {
    const primeiro = await chamar('POST', '/assets', { token: analista, body: { nome: 'Único', tipo: 'Rede', host: '198.51.100.77' } });
    assert.equal(primeiro.status, 201);
    // Mesmo host com espaços nas pontas é normalizado (trim) e colide.
    esperaErro(
      await chamar('POST', '/assets', { token: analista, body: { nome: 'Repetido', tipo: 'Servidor', host: '  198.51.100.77  ' } }),
      409,
      'ATIVO_DUPLICADO',
    );
    // Host reservado do seed também colide.
    esperaErro(await chamar('POST', '/assets', { token: analista, body: { nome: 'Seed', tipo: 'Rede', host: '192.168.0.10' } }), 409, 'ATIVO_DUPLICADO');
  });
});

// -----------------------------------------------------------------------------
// Campanhas: destinatário interno/externo, formato e listas
// -----------------------------------------------------------------------------
describe('POST /campaigns — destinatários e template', () => {
  it('barra destinatário externo (@gmail) com 422 DESTINATARIO_EXTERNO', async () => {
    esperaErro(
      await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Externa', destinatario: 'vitima@gmail.com', template: 'urgencia' } }),
      422,
      'DESTINATARIO_EXTERNO',
    );
    // Subdomínio do domínio interno não conta como interno.
    esperaErro(
      await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Subdominio', destinatario: 'ana@rh.empresa.com', template: 'urgencia' } }),
      422,
      'DESTINATARIO_EXTERNO',
    );
  });

  it('rejeita e-mail malformado (400 EMAIL_INVALIDO) e template fora da lista (400 TEMPLATE_OBRIGATORIO)', async () => {
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: 'sem-arroba', template: 'urgencia' } }), 400, 'EMAIL_INVALIDO');
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: 'a b@empresa.com', template: 'urgencia' } }), 400, 'EMAIL_INVALIDO');
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'X', destinatario: 'ok@empresa.com', template: 'inexistente' } }), 400, 'TEMPLATE_OBRIGATORIO');
  });

  it('em destinatarios[], um externo no meio barra tudo; lista vazia cai em EMAIL_INVALIDO; duplicados são normalizados', async () => {
    esperaErro(
      await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Mista', destinatarios: ['a@empresa.com', 'fora@gmail.com', 'b@empresa.com'], template: 'urgencia' } }),
      422,
      'DESTINATARIO_EXTERNO',
    );
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Vazia', destinatarios: [], template: 'urgencia' } }), 400, 'EMAIL_INVALIDO');

    // Campanha so aceita destinatario cadastrado.
    for (const [nome, email] of [['Ana', 'ana@empresa.com'], ['Bruno', 'bruno@empresa.com']])
      assert.equal((await chamar('POST', '/users', { token: admin, body: { nome, email, perfil: 'Colaborador' } })).status, 201);
    const ok = await chamar('POST', '/campaigns', {
      token: analista,
      body: { nome: 'Dedup', destinatarios: ['Ana@empresa.com', 'ana@empresa.com', 'bruno@empresa.com'], template: 'curiosidade' },
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.dados.destinatarios.length, 2, 'e-mails repetidos (ignorando caixa) devem ser deduplicados');
  });
});

// -----------------------------------------------------------------------------
// Usuários: e-mail, perfil, duplicidade e tamanho
// -----------------------------------------------------------------------------
describe('POST /users — validação de e-mail e perfil', () => {
  it('rejeita e-mail malformado (EMAIL_INVALIDO) e perfil inválido (PERFIL_INVALIDO)', async () => {
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'A', email: 'arroba-faltando', perfil: 'Analista' } }), 400, 'EMAIL_INVALIDO');
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'A', email: emailUnico('u'), perfil: 'Root' } }), 400, 'PERFIL_INVALIDO');
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'A', email: emailUnico('u'), perfil: 'colaborador' } }), 400, 'PERFIL_INVALIDO'); // caixa importa
  });

  it('rejeita e-mail gigante (>254 chars) com EMAIL_INVALIDO', async () => {
    const gigante = `${'a'.repeat(250)}@empresa.com`; // 262 chars
    assert.ok(gigante.length > 254);
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'Gigante', email: gigante, perfil: 'Analista' } }), 400, 'EMAIL_INVALIDO');
  });

  it('duplicidade de e-mail ignora maiúsculas (EMAIL_DUPLICADO)', async () => {
    // admin@empresa.com já existe no seed; variar a caixa não deve criar segunda conta.
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'Clone', email: 'ADMIN@Empresa.com', perfil: 'Analista' } }), 409, 'EMAIL_DUPLICADO');
    // Criar um novo e tentar duplicá-lo com outra caixa.
    const novo = emailUnico('dup');
    assert.equal((await chamar('POST', '/users', { token: admin, body: { nome: 'Base', email: novo, perfil: 'Colaborador' } })).status, 201);
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'Base2', email: novo.toUpperCase(), perfil: 'Colaborador' } }), 409, 'EMAIL_DUPLICADO');
  });
});

// -----------------------------------------------------------------------------
// CVSS: classificação por faixa e limites de intervalo
// -----------------------------------------------------------------------------
describe('GET /findings/classificacao — limites do CVSS', () => {
  const classif = (v: string) => chamar('GET', `/findings/classificacao?cvss=${v}`);

  it('mapeia os limites de faixa exatamente (Baixo/Médio/Alto/Crítico)', async () => {
    const esperado: Array<[string, string]> = [
      ['0', 'Baixo'],
      ['0.1', 'Baixo'],
      ['3.9', 'Baixo'],
      ['4.0', 'Médio'],
      ['6.9', 'Médio'],
      ['7.0', 'Alto'],
      ['8.9', 'Alto'],
      ['9.0', 'Crítico'],
      ['10', 'Crítico'],
    ];
    for (const [valor, faixa] of esperado) {
      const r = await classif(valor);
      assert.equal(r.status, 200, `cvss=${valor} deveria ser 200`);
      assert.equal(r.body.dados.faixa, faixa, `cvss=${valor} deveria classificar como ${faixa}`);
    }
  });

  it('rejeita valores fora de 0.0–10.0 e não-numéricos com 400 CVSS_INVALIDO', async () => {
    for (const valor of ['10.1', '-0.1', '11', '100', 'abc', 'null', 'Infinity']) {
      esperaErro(await classif(valor), 400, 'CVSS_INVALIDO');
    }
    // Parâmetro vazio e ausente também são inválidos.
    esperaErro(await chamar('GET', '/findings/classificacao?cvss='), 400, 'CVSS_INVALIDO');
    esperaErro(await chamar('GET', '/findings/classificacao'), 400, 'CVSS_INVALIDO');
  });
});

// -----------------------------------------------------------------------------
// Corpo da requisição: JSON malformado, tamanho e obrigatórios
// -----------------------------------------------------------------------------
describe('Corpo da requisição — parsing, tamanho e obrigatórios', () => {
  it('JSON malformado no corpo → 400 JSON_INVALIDO', async () => {
    const r = await chamar('POST', '/login', { raw: '{ "email": "admin@empresa.com", "senha": ' });
    esperaErro(r, 400, 'JSON_INVALIDO');
  });

  it('corpo acima de 64kb é rejeitado (413)', async () => {
    // ~70kb de payload: acima do limite de 64kb do express.json.
    const r = await chamar('POST', '/login', { body: { email: ADMIN.email, senha: 'A'.repeat(70000) } });
    assert.equal(r.status, 413, `esperava 413 para corpo grande, veio ${r.status}`);
  });

  it('campos obrigatórios ausentes retornam o código certo', async () => {
    esperaErro(await chamar('POST', '/login', { body: {} }), 400, 'EMAIL_OBRIGATORIO');
    esperaErro(await chamar('POST', '/login', { body: { email: ADMIN.email } }), 400, 'SENHA_OBRIGATORIA');
    esperaErro(await chamar('POST', '/assets', { token: analista, body: {} }), 400, 'NOME_OBRIGATORIO');
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: {} }), 400, 'NOME_OBRIGATORIO');
    esperaErro(await chamar('POST', '/scans', { token: analista, body: {} }), 400, 'ATIVO_OBRIGATORIO');
  });
});

// -----------------------------------------------------------------------------
// Notificações: apenas booleanos, sem campos desconhecidos
// -----------------------------------------------------------------------------
describe('PUT /configuracoes/notificacoes — apenas booleanos', () => {
  let colaborador: string;

  before(async () => {
    const conta = await criarUsuario(admin, 'Colaborador', 'notif');
    colaborador = await login(conta.email, SENHA_CONTA);
  });

  it('valor não-booleano → 400 PREFERENCIA_INVALIDA', async () => {
    esperaErro(await chamar('PUT', '/configuracoes/notificacoes', { token: colaborador, body: { alertasEmail: 'sim' } }), 400, 'PREFERENCIA_INVALIDA');
    esperaErro(await chamar('PUT', '/configuracoes/notificacoes', { token: colaborador, body: { somenteCriticas: 1 } }), 400, 'PREFERENCIA_INVALIDA');
    esperaErro(await chamar('PUT', '/configuracoes/notificacoes', { token: colaborador, body: { resumoSemanal: null } }), 400, 'PREFERENCIA_INVALIDA');
  });

  it('corpo vazio ou só com campo desconhecido → 400 PREFERENCIA_INVALIDA', async () => {
    esperaErro(await chamar('PUT', '/configuracoes/notificacoes', { token: colaborador, body: {} }), 400, 'PREFERENCIA_INVALIDA');
    esperaErro(await chamar('PUT', '/configuracoes/notificacoes', { token: colaborador, body: { campoInexistente: true } }), 400, 'PREFERENCIA_INVALIDA');
    // Campo desconhecido junto de um válido: o desconhecido é ignorado e o válido é aplicado.
    const ok = await chamar('PUT', '/configuracoes/notificacoes', { token: colaborador, body: { somenteCriticas: true, campoInexistente: true } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.dados.somenteCriticas, true);
  });
});

// -----------------------------------------------------------------------------
// Confusão de tipo em campos de texto (probe de robustez de validação)
// -----------------------------------------------------------------------------
describe('confusão de tipo em campos String', () => {
  // ACHADO DE SEGURANÇA (validação): `vazio()` só barra undefined/null/'' — um
  // `nome` numérico, booleano, array ou objeto passa da validação e chega ao
  // Prisma, que estoura e vira 500 ERRO_INTERNO em vez de um 400 limpo. Isso é
  // rejeição de tipo ausente na borda + vazamento de erro interno.
  // Comportamento SEGURO esperado: 400 (campo obrigatório / formato inválido).
  // TODO(backend): validar `typeof nome === 'string'` em POST /assets, /users e
  // /campaigns (controllers de ativo, usuario e campanha) antes de gravar. Ver finding "nome não-string -> 500".
  it('POST /assets com nome não-string deve dar 400, não 500 [finding: nome não-string -> 500]', async () => {
    const r = await chamar('POST', '/assets', { token: analista, body: { nome: 123, tipo: 'Rede', host: '198.51.100.90' } });
    assert.equal(r.status, 400, `nome numérico deveria ser 400, veio ${r.status} ${JSON.stringify(r.body)}`);
    assert.notEqual(r.body.codigoErro, 'ERRO_INTERNO', 'não deve vazar erro interno para entrada malformada');
  });

  // ACHADO DE SEGURANÇA (validação): `vazio()` só barra undefined/null/'' e NÃO
  // faz trim antes de checar. Um `nome` só com espaços ("   ") passa como
  // obrigatório e é gravado em branco em /assets, /users e /campaigns — enquanto
  // PATCH /users/:id (manage.ts) corretamente usa `vazio(nome.trim())`. É uma
  // regra de campo obrigatório inconsistente e contornável com espaços.
  // Comportamento SEGURO esperado: 400 NOME_OBRIGATORIO.
  // TODO(backend): trocar `vazio(nome)` por checagem com trim em POST /assets,
  // /users e /campaigns (controllers de ativo, usuario e campanha). Ver finding "nome em branco (espaços) aceito".
  it('POST /assets com nome só de espaços deve dar 400 NOME_OBRIGATORIO [finding: nome em branco aceito]', async () => {
    esperaErro(await chamar('POST', '/assets', { token: analista, body: { nome: '   ', tipo: 'Rede', host: '198.51.100.93' } }), 400, 'NOME_OBRIGATORIO');
  });

  it('rejeita tipos não-string em campos validados por lista/formato sem 500', async () => {
    // Estes campos usam includes()/typeof e devem rejeitar limpo (400), sem 500.
    esperaErro(await chamar('POST', '/assets', { token: analista, body: { nome: 'Z', tipo: ['Rede'], host: '198.51.100.91' } }), 400, 'TIPO_INVALIDO');
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'Z', email: { toString: 'x' }, perfil: 'Analista' } }), 400, 'EMAIL_INVALIDO');
    esperaErro(await chamar('POST', '/users', { token: admin, body: { nome: 'Z', email: emailUnico('t'), perfil: 42 } }), 400, 'PERFIL_INVALIDO');
    esperaErro(await chamar('POST', '/campaigns', { token: analista, body: { nome: 'Z', destinatario: 12345, template: 'urgencia' } }), 400, 'EMAIL_INVALIDO');
  });
});
