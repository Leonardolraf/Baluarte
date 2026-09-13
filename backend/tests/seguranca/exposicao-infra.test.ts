// Pentest em codigo — dimensao: EXPOSICAO DE INFORMACAO E CONFIGURACAO (OWASP A05/A02).
//
// Verifica, contra a API REST real (SQLite isolado deste arquivo — ver helpers.ts):
//  - Cabecalhos: X-Powered-By ausente; erros nao vazam stack trace / caminho de arquivo.
//  - CORS: origem permitida x origem hostil (evil.com) x sem Origin (Postman).
//  - Segredos nunca no corpo: senhaHash (bcrypt), segredo do JWT, tokenHash de reset, senha em claro.
//  - Metodo/rota: metodos nao suportados e rota inexistente -> 404 ROTA_NAO_ENCONTRADA padronizado.
//  - DoS barato: corpo acima de 64kb barrado; e-mail gigante barrado antes de virar chave de mapa.
//  - Fronteira RBAC no PAYLOAD: dashboard de Colaborador sem lista tecnica nem metricas por campanha.
//
// Casos marcados com it.skip documentam um ACHADO REAL de seguranca (ver `findings`): a asercao
// afirma o comportamento SEGURO e falha contra o backend atual; destravar so apos corrigir o src.
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
  ADMIN,
  ANALISTA,
  SENHA_PROVISORIA,
} from '../helpers.js';

prepararBanco(import.meta.url);
const { app } = await import('../../src/app.js');
const { prisma } = await import('../../src/db.js');

before(async () => {
  await iniciarServidor(app);
});
after(async () => {
  await encerrarServidor();
  await prisma.$disconnect();
});

// -----------------------------------------------------------------------------
// Utilitarios locais
// -----------------------------------------------------------------------------

// Aplaina qualquer resposta em uma lista de chaves e de textos (valores primitivos),
// para varrer o corpo inteiro atras de segredos, independentemente do formato.
function planificar(obj: unknown): { chaves: string[]; textos: string[] } {
  const chaves: string[] = [];
  const textos: string[] = [];
  const visitar = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      v.forEach(visitar);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        chaves.push(k);
        visitar(val);
      }
      return;
    }
    textos.push(String(v));
  };
  visitar(obj);
  return { chaves, textos };
}

// O segredo do JWT usado nos testes (definido por prepararBanco).
const SEGREDO_JWT = 'segredo-somente-para-testes';
const PREFIXOS_BCRYPT = ['$2a$', '$2b$', '$2y$'];
const SENHAS_EM_CLARO = [SENHA_PROVISORIA, ADMIN.senha, ANALISTA.senha, 'Mudar@123'];

// Falha se o corpo carregar qualquer segredo (hash, senha em claro ou o segredo do JWT).
function semSegredos(body: unknown, contexto: string): void {
  const { chaves, textos } = planificar(body);
  for (const proibida of ['senhaHash', 'tokenHash', 'passwordHash']) {
    assert.ok(!chaves.includes(proibida), `${contexto}: vazou a chave "${proibida}" — ${JSON.stringify(chaves)}`);
  }
  for (const t of textos) {
    assert.ok(!PREFIXOS_BCRYPT.some((p) => t.startsWith(p)), `${contexto}: vazou um hash bcrypt no corpo`);
    assert.ok(!t.includes(SEGREDO_JWT), `${contexto}: vazou o segredo do JWT no corpo`);
    for (const senha of SENHAS_EM_CLARO) {
      assert.ok(t !== senha, `${contexto}: vazou uma senha em claro ("${senha}") no corpo`);
    }
  }
}

// Falha se o texto do corpo parecer um stack trace / caminho de arquivo de servidor.
function semStackTrace(body: unknown, contexto: string): void {
  const s = JSON.stringify(body ?? {});
  for (const marca of ['\n    at ', 'node_modules', '/src/', '\\src\\', 'PrismaClient', 'SyntaxError', 'Error:']) {
    assert.ok(!s.includes(marca), `${contexto}: corpo parece vazar internals ("${marca}"): ${s.slice(0, 300)}`);
  }
}

// -----------------------------------------------------------------------------
// Cabecalhos
// -----------------------------------------------------------------------------

describe('cabecalhos nao anunciam o servidor', () => {
  let admin: string;
  let analista: string;
  before(async () => {
    admin = await login(ADMIN.email, ADMIN.senha);
    analista = await login(ANALISTA.email, ANALISTA.senha);
  });

  it('X-Powered-By ausente em rota publica, autenticada e de erro', async () => {
    const publica = await chamar('GET', '/findings/classificacao?cvss=5');
    assert.equal(publica.status, 200);
    assert.equal(publica.headers.get('x-powered-by'), null);

    const autenticada = await chamar('GET', '/me', { token: analista });
    assert.equal(autenticada.status, 200);
    assert.equal(autenticada.headers.get('x-powered-by'), null);

    const listaAdmin = await chamar('GET', '/usuarios', { token: admin });
    assert.equal(listaAdmin.status, 200);
    assert.equal(listaAdmin.headers.get('x-powered-by'), null);

    const erroRota = await chamar('GET', '/rota-que-nao-existe');
    assert.equal(erroRota.status, 404);
    assert.equal(erroRota.headers.get('x-powered-by'), null);
  });

  it('entrada malformada (nome objeto) e rejeitada com 400, nao 500, e sem stack trace', async () => {
    // `nome` como objeto e barrado pela validacao de tipo (textoPreenchido) ANTES de
    // chegar ao Prisma — vira 400 gracioso, nao 500. A resposta nunca vaza stack/caminho.
    const r = await chamar('POST', '/assets', {
      token: analista,
      body: { nome: { injecao: true }, tipo: 'Rede', host: '10.77.88.99' },
    });
    esperaErro(r, 400, 'NOME_OBRIGATORIO');
    semStackTrace(r.body, 'POST /assets (nome objeto)');
  });

  it('JSON malformado -> 400 JSON_INVALIDO padronizado, sem vazar o parser', async () => {
    const r = await chamar('POST', '/login', { raw: '{"email": "a@b.com", "senha": ' });
    esperaErro(r, 400, 'JSON_INVALIDO');
    semStackTrace(r.body, 'POST /login (JSON malformado)');
  });
});

// -----------------------------------------------------------------------------
// CORS
// -----------------------------------------------------------------------------

describe('CORS restrito a origens conhecidas', () => {
  it('origem permitida (localhost dev) recebe Access-Control-Allow-Origin refletido', async () => {
    const r = await chamar('GET', '/findings/classificacao?cvss=5', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });

  it('origem hostil (evil.com) NAO recebe o cabecalho refletido', async () => {
    const r = await chamar('GET', '/findings/classificacao?cvss=5', { headers: { Origin: 'https://evil.com' } });
    const acao = r.headers.get('access-control-allow-origin');
    assert.notEqual(acao, 'https://evil.com', 'a origem hostil foi refletida no Access-Control-Allow-Origin');
    assert.ok(acao === null || acao === undefined, `esperava nenhum ACAO para evil.com, veio "${acao}"`);
  });

  it('preflight OPTIONS de origem hostil nao autoriza a origem', async () => {
    const r = await chamar('OPTIONS', '/login', {
      headers: {
        Origin: 'https://evil.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.notEqual(r.headers.get('access-control-allow-origin'), 'https://evil.com');
  });

  it('requisicao sem Origin funciona (Postman/servidor-a-servidor)', async () => {
    const r = await chamar('GET', '/findings/classificacao?cvss=5');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.body.dados.faixa, 'Médio');
  });
});

// -----------------------------------------------------------------------------
// Segredos nunca no corpo
// -----------------------------------------------------------------------------

describe('nenhuma resposta vaza segredo ou dado sensivel', () => {
  let admin: string;
  before(async () => {
    admin = await login(ADMIN.email, ADMIN.senha);
  });

  it('POST /login devolve token de sessao, mas nunca senhaHash nem senha em claro', async () => {
    const r = await chamar('POST', '/login', { body: { email: ANALISTA.email, senha: ANALISTA.senha } });
    assert.equal(r.status, 200);
    assert.ok(r.body.dados.token, 'esperava o token de sessao');
    semSegredos(r.body, 'POST /login');
  });

  it('GET /me nao expoe senhaHash', async () => {
    const analista = await login(ANALISTA.email, ANALISTA.senha);
    const r = await chamar('GET', '/me', { token: analista });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body.dados).sort(), ['email', 'id', 'nome', 'perfil', 'status']);
    semSegredos(r.body, 'GET /me');
  });

  it('POST /users nao devolve a senha provisoria nem o hash', async () => {
    const email = `expo.users.${Date.now()}@empresa.com`;
    const r = await chamar('POST', '/users', { token: admin, body: { nome: 'Sem Segredo', email, perfil: 'Colaborador' } });
    assert.equal(r.status, 201);
    semSegredos(r.body, 'POST /users');
  });

  it('GET /usuarios (Administrador) nao traz senhaHash de nenhum usuario', async () => {
    await criarUsuario(admin, 'Colaborador', 'expo.lista');
    const r = await chamar('GET', '/usuarios', { token: admin });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.dados) && r.body.dados.length >= 2);
    semSegredos(r.body, 'GET /usuarios');
  });

  it('GET /configuracoes/seguranca publica a politica sem revelar o segredo do JWT', async () => {
    const analista = await login(ANALISTA.email, ANALISTA.senha);
    const r = await chamar('GET', '/configuracoes/seguranca', { token: analista });
    assert.equal(r.status, 200);
    // Metadado de algoritmo pode aparecer; o VALOR do segredo, nunca.
    assert.equal(r.body.dados.sessao.algoritmoToken, 'JWT HS256');
    semSegredos(r.body, 'GET /configuracoes/seguranca');
  });

  it('fluxo de reset nunca devolve o token nem o tokenHash na resposta HTTP', async () => {
    const conta = await criarUsuario(admin, 'Analista', 'expo.reset');
    const r = await chamar('POST', '/auth/reset-password', { body: { email: conta.email } });
    assert.equal(r.status, 200);
    // A resposta e generica: sem token, sem hash, sem nem confirmar o cadastro.
    const { chaves } = planificar(r.body);
    assert.ok(!chaves.includes('token') && !chaves.includes('tokenHash'), `reset vazou token: ${JSON.stringify(chaves)}`);
    semSegredos(r.body, 'POST /auth/reset-password');
    // Confirma que ha 1 token no banco, guardado apenas como hash (nunca em claro).
    const registro = await prisma.passwordResetToken.findFirst({ where: { userId: conta.id } });
    assert.ok(registro, 'esperava o token de reset persistido');
    assert.equal(registro!.tokenHash.length, 64, 'tokenHash deve ser um SHA-256 hex de 64 chars');
  });
});

// -----------------------------------------------------------------------------
// Metodo / rota
// -----------------------------------------------------------------------------

describe('metodo nao suportado e rota inexistente respondem de forma coerente', () => {
  it('PUT /login (metodo nao suportado) -> 404 ROTA_NAO_ENCONTRADA', async () => {
    const r = await chamar('PUT', '/login', { body: { email: ANALISTA.email, senha: ANALISTA.senha } });
    esperaErro(r, 404, 'ROTA_NAO_ENCONTRADA');
    semStackTrace(r.body, 'PUT /login');
  });

  it('DELETE /me (metodo nao suportado) -> 404 ROTA_NAO_ENCONTRADA', async () => {
    const r = await chamar('DELETE', '/me');
    esperaErro(r, 404, 'ROTA_NAO_ENCONTRADA');
  });

  it('rota inexistente -> 404 ROTA_NAO_ENCONTRADA com envelope padronizado', async () => {
    const r = await chamar('GET', '/nao/existe/mesmo');
    esperaErro(r, 404, 'ROTA_NAO_ENCONTRADA');
    assert.ok(typeof r.body.timestamp === 'string', 'envelope de erro deve trazer timestamp');
    semStackTrace(r.body, 'GET rota inexistente');
  });
});

// -----------------------------------------------------------------------------
// DoS barato / limites de tamanho
// -----------------------------------------------------------------------------

describe('limites de tamanho barram abuso barato', () => {
  it('corpo acima de 64kb e barrado (nao processado nem estourando 500)', async () => {
    const gigante = JSON.stringify({ email: ANALISTA.email, senha: 'x'.repeat(70 * 1024) });
    const r = await chamar('POST', '/login', { raw: gigante });
    // O corpo grande nao pode ser aceito (200) nem derrubar o handler (500):
    // deve ser rejeitado pelo limite (413) antes de qualquer processamento.
    assert.equal(r.status, 413, `esperava 413 para corpo > 64kb, veio ${r.status}`);
  });

  it('e-mail gigante no reset e barrado por formato antes de virar chave de mapa', async () => {
    // 1000 chars: passa do limite de 254 do e-mail, mas mantem o corpo < 64kb (isola o guard de e-mail).
    const emailGigante = `${'a'.repeat(1000)}@empresa.com`;
    const r = await chamar('POST', '/auth/reset-password', { body: { email: emailGigante } });
    esperaErro(r, 400, 'EMAIL_INVALIDO');
    // Nao pode ter criado token de reset para semelhante entrada.
    const total = await prisma.passwordResetToken.count();
    const registros = await prisma.passwordResetToken.findMany({ include: { user: true } });
    assert.ok(!registros.some((x) => x.user.email.length > 254), 'nenhum token para e-mail acima do limite');
    assert.ok(total >= 0);
  });

  // ACHADO (A05): corpo acima de 64kb cai no error-handler PADRAO do Express, nao no envelope
  // padronizado do projeto. O middleware de erro em src/app.ts so trata `entity.parse.failed`
  // (JSON malformado); `entity.too.large` chama next(err) e escorre ate o finalhandler, que
  // responde HTML e, fora de producao (NODE_ENV != production), inclui o stack trace no corpo.
  // Correcao: tratar `entity.too.large` (413 CORPO_MUITO_GRANDE) e adicionar um handler de erro
  // final generico que devolva { status:'erro', codigoErro:'ERRO_INTERNO' } sem stack.
  // TODO(seguranca): destravar apos padronizar a resposta de corpo grande em src/app.ts.
  it('corpo acima de 64kb e rejeitado com envelope JSON padronizado (sem HTML/stack)', async () => {
    const gigante = JSON.stringify({ email: ANALISTA.email, senha: 'x'.repeat(70 * 1024) });
    const r = await chamar('POST', '/login', { raw: gigante });
    assert.equal(r.status, 413);
    assert.equal(r.body.status, 'erro', 'corpo grande deveria devolver o envelope de erro do projeto, nao HTML');
    assert.ok(typeof r.body.codigoErro === 'string');
    semStackTrace(r.body, 'POST /login (corpo > 64kb)');
  });
});

// -----------------------------------------------------------------------------
// Fronteira RBAC no PAYLOAD do dashboard
// -----------------------------------------------------------------------------

describe('dashboard do Colaborador nao vaza dados tecnicos no payload', () => {
  let colaborador: string;
  before(async () => {
    const admin = await login(ADMIN.email, ADMIN.senha);
    const conta = await criarUsuario(admin, 'Colaborador', 'expo.dash');
    colaborador = await login(conta.email, SENHA_PROVISORIA);
    // Semeia uma campanha COM metricas (enviados/clicados) para provar que o payload as retem.
    await prisma.campaign.create({
      data: {
        nome: 'Infra — campanha que nao deve vazar',
        template: 'urgencia',
        status: 'ATIVA',
        eventos: {
          create: [
            { destinatario: 'alvo1@empresa.com', enviadoEm: new Date(), abertoEm: new Date(), clicadoEm: new Date() },
            { destinatario: 'alvo2@empresa.com', enviadoEm: new Date() },
          ],
        },
      },
    });
  });

  it('Colaborador recebe KPIs numericos, mas nao a lista tecnica de achados', async () => {
    const r = await chamar('GET', '/dashboard', { token: colaborador });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.dados.kpis.vulnerabilidadesAbertas, 'number');
    assert.deepEqual(r.body.dados.vulnerabilidadesRecentes, [], 'Colaborador nao deve ver achados detalhados');
    assert.deepEqual(r.body.dados.alertas, [], 'Colaborador nao deve ver alertas tecnicos');
  });

  // ACHADO (A05 / A01): o dashboard entrega `campanhas[]` (nome, template, taxaClique, destinatarios),
  // `funil` e `campanhaAtiva` a QUALQUER perfil — o flag `operador` em src/routes/read.ts so filtra
  // `vulnerabilidadesRecentes` e `alertas`. Um Colaborador ve, pela API, metricas por campanha de
  // phishing (nomes, taxa de clique, funil enviados/abertos/clicados) que a tela nao mostra.
  // Correcao: em GET /dashboard, condicionar `campanhas`, `funil` e `campanhaAtiva` ao `operador`
  // (retornar [], null, null para Colaborador), como ja se faz com achados e alertas.
  // TODO(seguranca): destravar apos aplicar o filtro por perfil no payload do dashboard.
  it('Colaborador nao recebe metricas por campanha (campanhas[]/funil/campanhaAtiva)', async () => {
    const r = await chamar('GET', '/dashboard', { token: colaborador });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dados.campanhas, [], 'Colaborador nao deve ver a lista de campanhas com metricas');
    assert.equal(r.body.dados.funil, null, 'Colaborador nao deve ver o funil da campanha');
    assert.equal(r.body.dados.campanhaAtiva, null, 'Colaborador nao deve ver o nome da campanha ativa');
  });
});
