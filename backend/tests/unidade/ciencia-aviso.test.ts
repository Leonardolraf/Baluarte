// Testes de UNIDADE (sem banco) do gate de ciencia do aviso de monitoramento (opcao C do Leo,
// 19/10/2026): o middleware exigeCienciaAviso sobre o usuario ja carregado, a ordem
// exigeSessao -> gate -> RBAC e a introspeccao do router: toda rota autenticada usa exigeToken
// (com o gate), menos as 4 excecoes, que usam exigeSessao. Rota nova autenticada que nao entrar
// nesta regra faz o teste falhar.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'segredo-unitario-de-teste';

const { exigeCienciaAviso, exigeSessao, exigeToken, exigePerfil } = await import('../../src/middlewares/auth.middleware.js');
const { apiRouter } = await import('../../src/routes/index.js');

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

/** As unicas rotas autenticadas liberadas sem ciencia (so exigeSessao). */
const EXCECOES_DO_GATE = ['POST /auth/logout', 'POST /auth/renovar', 'GET /monitoramento/aviso', 'POST /monitoramento/ciencia'];

/** Rotas publicas (sem sessao nem gate): login, conta por link, treinamento por link, agente, classificacao. */
const PUBLICAS = [
  'POST /login',
  'POST /auth/reset-password',
  'POST /auth/reset-password/confirm',
  'POST /auth/link/verificar',
  'GET /treinamentos/link/:token',
  'POST /treinamentos/link/:token/concluir',
  'POST /treinamentos/link/:token/reportar',
  'POST /agentes/osquery/enroll',
  'POST /agentes/osquery/config',
  'POST /agentes/osquery/logger',
  'GET /findings/classificacao',
];

type Camada = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };

/** Rotas do apiRouter com a lista de middlewares de cada uma, na ordem. */
function rotas() {
  return (apiRouter.stack as Camada[])
    .filter((c) => c.route)
    .flatMap((c) =>
      Object.keys(c.route!.methods).map((m) => ({ chave: `${m.toUpperCase()} ${c.route!.path}`, handles: c.route!.stack.map((s) => s.handle) })),
    );
}

describe('exigeCienciaAviso', () => {
  const rodar = (usuarioAtual: object | undefined) => {
    const r = resposta();
    let seguiu = false;
    exigeCienciaAviso({ headers: {}, usuarioAtual } as unknown as Request, r as unknown as Response, (() => { seguiu = true; }) as NextFunction);
    return { r, seguiu };
  };

  it('sem ciência da versão em vigor (ou sem usuário carregado) -> 403 CIENCIA_AVISO_PENDENTE', () => {
    for (const u of [{ cienciaAvisoEm: null }, {}, undefined]) {
      const { r, seguiu } = rodar(u);
      assert.equal(seguiu, false);
      assert.equal(r.statusCode, 403);
      assert.equal(r.body.codigoErro, 'CIENCIA_AVISO_PENDENTE');
      assert.equal(r.body.mensagem, 'Confirme que leu o aviso de monitoramento para usar o Baluarte');
      assert.equal(r.body.status, 'erro');
    }
  });

  it('com ciência segue adiante', () => {
    const { r, seguiu } = rodar({ cienciaAvisoEm: new Date() });
    assert.equal(seguiu, true);
    assert.equal(r.statusCode, 0);
  });

  it('exigeToken e exigeSessao recusam token ausente antes de olhar a ciência', () => {
    for (const mw of [exigeToken, exigeSessao]) {
      const r = resposta();
      mw({ headers: {} } as unknown as Request, r as unknown as Response, (() => assert.fail('não devia seguir')) as NextFunction);
      assert.equal(r.statusCode, 401);
      assert.equal(r.body.codigoErro, 'TOKEN_AUSENTE');
    }
  });

  it('o código de RBAC continua o mesmo (o gate não substitui exigePerfil)', () => {
    const r = resposta();
    exigePerfil('Administrador')({ usuarioAtual: { perfil: 'Colaborador', cienciaAvisoEm: new Date() } } as unknown as Request, r as unknown as Response, (() => assert.fail('não devia seguir')) as NextFunction);
    assert.equal(r.statusCode, 403);
    assert.equal(r.body.codigoErro, 'PERFIL_SEM_PERMISSAO');
  });
});

describe('introspecção do router: o gate cobre toda rota autenticada', () => {
  const todas = rotas();

  it('toda rota autenticada usa exigeToken (com o gate), menos as 4 exceções', () => {
    assert.ok(todas.length > 40, `poucas rotas lidas do router: ${todas.length}`);
    const comSessaoSemGate = todas.filter((r) => r.handles.includes(exigeSessao)).map((r) => r.chave).sort();
    assert.deepEqual(comSessaoSemGate, [...EXCECOES_DO_GATE].sort());
    for (const r of todas) {
      const autenticada = r.handles.includes(exigeToken) || r.handles.includes(exigeSessao);
      if (!autenticada) assert.ok(PUBLICAS.includes(r.chave), `rota sem autenticação fora da lista de públicas: ${r.chave}`);
      assert.ok(!(r.handles.includes(exigeToken) && r.handles.includes(exigeSessao)), `${r.chave} com os dois middlewares`);
    }
  });

  it('as rotas públicas continuam sem sessão e sem gate', () => {
    const chaves = new Set(todas.map((r) => r.chave));
    for (const p of PUBLICAS) assert.ok(chaves.has(p), `rota pública esperada não existe: ${p}`);
    for (const r of todas.filter((r) => PUBLICAS.includes(r.chave))) {
      assert.ok(!r.handles.includes(exigeToken), r.chave);
      assert.ok(!r.handles.includes(exigeSessao), r.chave);
    }
  });

  it('o gate vem antes do RBAC: exigeToken é o primeiro middleware de toda rota com perfil', () => {
    for (const r of todas.filter((r) => r.handles.includes(exigeToken))) assert.equal(r.handles[0], exigeToken, r.chave);
  });

  it('GET /monitoramento/ciencias segue com exigeToken (gate) e perfil de Administrador', () => {
    const r = todas.find((x) => x.chave === 'GET /monitoramento/ciencias');
    assert.ok(r);
    assert.equal(r.handles[0], exigeToken);
    assert.equal(r.handles.length, 3, 'exigeToken, exigePerfil e o controller');
  });

  it('as rotas do #5 (termos de uso) não existem mais', () => {
    assert.ok(!todas.some((r) => r.chave.includes('/conta/termos')));
  });
});
