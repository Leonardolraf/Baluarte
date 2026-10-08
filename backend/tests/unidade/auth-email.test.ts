// Testes de UNIDADE (sem banco, sem servidor): JWT e middlewares de autenticacao/RBAC
// (caminhos que nao consultam o banco), envelope de resposta, transportes de e-mail e o
// texto do e-mail simulado da campanha.
import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'segredo-unitario-de-teste';
process.env.FRONTEND_URL = 'http://localhost:5173/';

const { gerarToken, validarSegredoJwt } = await import('../../src/services/token.service.js');
const { exigeToken, exigePerfil } = await import('../../src/middlewares/auth.middleware.js');
const { agora, enviar, erro, wrap } = await import('../../src/utils/resposta.js');
const { caixaDeSaida, enviarEmail, urlFrontend } = await import('../../src/config/email.js');
const { linksCampanha, mensagemCampanha } = await import('../../src/services/campanhaEmail.service.js');

/** Response falso: guarda status e corpo. */
function resposta() {
  const r = {
    statusCode: 0,
    body: undefined as any,
    headersSent: false,
    status(c: number) { r.statusCode = c; return r; },
    json(b: unknown) { r.body = b; r.headersSent = true; return r; },
  };
  return r;
}
const req = (h: Record<string, string> = {}, extra: object = {}) => ({ headers: h, ...extra }) as unknown as Request;

describe('envelope de resposta (util)', () => {
  it('agora() é ISO em UTC sem milissegundos', () => {
    assert.match(agora(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('erro() monta o envelope do contrato', () => {
    const r = resposta();
    erro(r as unknown as Response, 404, 'Rota não encontrada', 'ROTA_NAO_ENCONTRADA');
    assert.equal(r.statusCode, 404);
    assert.equal(r.body.status, 'erro');
    assert.equal(r.body.codigoErro, 'ROTA_NAO_ENCONTRADA');
    assert.equal(r.body.mensagem, 'Rota não encontrada');
  });

  it('wrap() transforma exceção do handler em 500 padronizado, sem vazar detalhe', async () => {
    const r = resposta();
    const original = console.error;
    console.error = () => {};
    try {
      wrap(async () => { throw new Error('detalhe interno'); })(req(), r as unknown as Response);
      await new Promise((ok) => setImmediate(ok));
    } finally {
      console.error = original;
    }
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.codigoErro, 'ERRO_INTERNO');
    assert.doesNotMatch(JSON.stringify(r.body), /detalhe interno/);
  });

  it('wrap() não sobrescreve resposta já enviada', async () => {
    const r = resposta();
    wrap(async (_q, s) => { enviar(s, 201, { ok: true }); throw new Error('depois'); })(req(), r as unknown as Response);
    const original = console.error;
    console.error = () => {};
    await new Promise((ok) => setImmediate(ok));
    console.error = original;
    assert.equal(r.statusCode, 201);
  });
});

describe('JWT', () => {
  it('gerarToken: HS256, 30 min, com início de sessão e emissão em milissegundos', () => {
    const antes = Date.now();
    const t = gerarToken({ idUsuario: 'u1', email: 'a@empresa.com', perfil: 'Analista' });
    const p = jwt.verify(t, process.env.JWT_SECRET!) as Record<string, number | string>;
    assert.equal(jwt.decode(t, { complete: true })!.header.alg, 'HS256');
    assert.equal((p.exp as number) - (p.iat as number), 30 * 60);
    assert.ok((p.emitidoEmMs as number) >= antes);
    assert.equal(p.perfil, 'Analista');
  });

  it('gerarToken preserva o início de sessão na renovação', () => {
    const t = gerarToken({ idUsuario: 'u1', email: 'a@empresa.com', perfil: 'Analista', inicioSessao: 1_700_000_000 });
    assert.equal((jwt.decode(t) as { inicioSessao: number }).inicioSessao, 1_700_000_000);
  });

  it('gerarToken não copia campos extras do payload para o token', () => {
    const t = gerarToken({ idUsuario: 'u1', email: 'a@empresa.com', perfil: 'Analista', extra: 'x' } as never);
    assert.equal((jwt.decode(t) as Record<string, unknown>).extra, undefined);
  });
});

describe('validarSegredoJwt', () => {
  const salvo = { NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET };
  afterEach(() => Object.assign(process.env, salvo));

  it('em produção recusa segredo ausente, curto ou de exemplo', () => {
    process.env.NODE_ENV = 'production';
    for (const s of ['', 'curto', 'troque-em-producao', 'baluarte-v2-dev-secret']) {
      process.env.JWT_SECRET = s;
      assert.throws(() => validarSegredoJwt(), /JWT_SECRET/, s || '(vazio)');
    }
    process.env.JWT_SECRET = 'um-segredo-de-producao-bem-longo';
    assert.doesNotThrow(() => validarSegredoJwt());
  });

  it('fora de produção só avisa', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    const original = console.warn;
    let avisou = false;
    console.warn = () => { avisou = true; };
    try { assert.doesNotThrow(() => validarSegredoJwt()); } finally { console.warn = original; }
    assert.ok(avisou);
  });
});

describe('exigeToken (caminhos sem banco) e exigePerfil', () => {
  it('sem token -> 401 TOKEN_AUSENTE; token adulterado ou de outro segredo -> 401 TOKEN_INVALIDO', () => {
    const casos: [Record<string, string>, string][] = [
      [{}, 'TOKEN_AUSENTE'],
      [{ authorization: 'Bearer ' }, 'TOKEN_AUSENTE'],
      [{ authorization: 'Bearer abc.def.ghi' }, 'TOKEN_INVALIDO'],
      [{ authorization: `Bearer ${jwt.sign({ idUsuario: 'u1' }, 'outro-segredo')}` }, 'TOKEN_INVALIDO'],
      [{ authorization: `Bearer ${jwt.sign({ idUsuario: 'u1' }, process.env.JWT_SECRET!, { expiresIn: -10 })}` }, 'TOKEN_INVALIDO'],
    ];
    for (const [h, codigo] of casos) {
      const r = resposta();
      let seguiu = false;
      exigeToken(req(h), r as unknown as Response, (() => { seguiu = true; }) as NextFunction);
      assert.equal(r.statusCode, 401, codigo);
      assert.equal(r.body.codigoErro, codigo);
      assert.equal(seguiu, false);
    }
  });

  it('exigePerfil decide pelo perfil carregado do banco, não pelo do token', () => {
    const so = exigePerfil('Administrador');
    const r1 = resposta();
    let seguiu = false;
    so(req({}, { usuarioAtual: { perfil: 'Administrador' }, usuario: { perfil: 'Colaborador' } }), r1 as unknown as Response, (() => { seguiu = true; }) as NextFunction);
    assert.ok(seguiu);

    const r2 = resposta();
    seguiu = false;
    so(req({}, { usuarioAtual: { perfil: 'Analista' }, usuario: { perfil: 'Administrador' } }), r2 as unknown as Response, (() => { seguiu = true; }) as NextFunction);
    assert.equal(seguiu, false);
    assert.equal(r2.statusCode, 403);
    assert.equal(r2.body.codigoErro, 'PERFIL_SEM_PERMISSAO');

    const r3 = resposta();
    so(req(), r3 as unknown as Response, (() => {}) as NextFunction);
    assert.equal(r3.statusCode, 403);
  });
});

describe('e-mail', () => {
  const salvo = { NODE_ENV: process.env.NODE_ENV, SMTP_HOST: process.env.SMTP_HOST };
  afterEach(() => {
    process.env.NODE_ENV = salvo.NODE_ENV;
    if (salvo.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = salvo.SMTP_HOST;
  });

  it('urlFrontend tira a barra final', () => {
    assert.equal(urlFrontend(), 'http://localhost:5173');
  });

  it('em teste vai para a caixa em memória', async () => {
    const antes = caixaDeSaida.length;
    assert.equal(await enviarEmail({ para: 'x@empresa.com', assunto: 'A', texto: 'B' }), true);
    assert.equal(caixaDeSaida.length, antes + 1);
  });

  it('em produção sem SMTP não envia nem imprime o conteúdo', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SMTP_HOST;
    const logs: string[] = [];
    const [e, l] = [console.error, console.log];
    console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
    try {
      assert.equal(await enviarEmail({ para: 'x@empresa.com', assunto: 'Assunto', texto: 'link-secreto' }), false);
    } finally {
      console.error = e;
      console.log = l;
    }
    assert.ok(!logs.some((x) => x.includes('link-secreto')), 'o conteúdo do e-mail não pode ir para o log');
  });

  it('fora de produção sem SMTP imprime o e-mail no log', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SMTP_HOST;
    const original = console.log;
    let impresso = '';
    console.log = (...a: unknown[]) => { impresso += a.join(' '); };
    try { assert.equal(await enviarEmail({ para: 'x@empresa.com', assunto: 'A', texto: 'conteudo' }), true); } finally { console.log = original; }
    assert.match(impresso, /conteudo/);
  });
});

describe('e-mail simulado da campanha', () => {
  const dest = { nome: 'Ana', email: 'ana@empresa.com', token: 'f'.repeat(64) };

  it('links só para o frontend da plataforma', () => {
    assert.deepEqual(linksCampanha('abc'), {
      treinamento: 'http://localhost:5173/t/abc',
      reportar: 'http://localhost:5173/t/abc/reportar',
    });
  });

  it('cada template tem assunto próprio e todos trazem os dois links e o aviso de simulação', () => {
    const assuntos = new Set<string>();
    for (const t of ['urgencia', 'autoridade', 'curiosidade']) {
      const m = mensagemCampanha(t, dest);
      assuntos.add(m.assunto);
      assert.equal(m.para, dest.email);
      assert.match(m.texto, /Ana/);
      assert.ok(m.texto.includes(`/t/${dest.token}`));
      assert.ok(m.texto.includes(`/t/${dest.token}/reportar`));
      assert.match(m.texto, /SIMULAÇÃO DE PHISHING/);
      // Nenhum link fora do frontend da plataforma.
      for (const url of m.texto.match(/https?:\/\/\S+/g) ?? []) assert.ok(url.startsWith('http://localhost:5173/'), url);
    }
    assert.equal(assuntos.size, 3);
  });

  it('template desconhecido cai no de urgência', () => {
    assert.equal(mensagemCampanha('inexistente', dest).assunto, mensagemCampanha('urgencia', dest).assunto);
  });
});
