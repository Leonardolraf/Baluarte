// Testes de UNIDADE (sem banco): a regra "aceitou os termos em vigor" (Melhorias #5), com e
// sem VIGENCIA_TERMOS, e o middleware exigeTermosAceitos sobre o usuario ja carregado.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'segredo-unitario-de-teste';

const { termosAceitos, VIGENCIA_TERMOS, TERMOS_RASCUNHO, TEXTO_TERMOS, VERSAO_TERMOS, versaoTermos } = await import('../../src/models/termos.model.js');
const { exigeTermosAceitos, exigeSessao, exigeToken } = await import('../../src/middlewares/auth.middleware.js');

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

describe('termosAceitos', () => {
  it('sem vigência: aceite = data não nula', () => {
    assert.equal(VIGENCIA_TERMOS, null, 'hoje vale qualquer aceite registrado');
    assert.equal(termosAceitos(null), false);
    assert.equal(termosAceitos(undefined), false);
    assert.equal(termosAceitos(new Date(0)), true);
  });

  it('com vigência: aceite anterior a ela não vale (texto novo pede aceite novo)', () => {
    const vigencia = new Date('2026-11-01T00:00:00Z');
    assert.equal(termosAceitos(new Date('2026-10-31T23:59:59Z'), vigencia), false);
    assert.equal(termosAceitos(vigencia, vigencia), true);
    assert.equal(termosAceitos(new Date('2026-11-02T00:00:00Z'), vigencia), true);
    assert.equal(termosAceitos(null, vigencia), false);
  });

  it('o texto ainda é o espaço reservado marcado como rascunho, com versão válida', () => {
    assert.equal(TERMOS_RASCUNHO, true);
    assert.match(TEXTO_TERMOS, /pendente de aprovação/);
    assert.ok(versaoTermos.safeParse(VERSAO_TERMOS).success);
  });
});

describe('exigeTermosAceitos', () => {
  const rodar = (usuarioAtual: object | undefined) => {
    const r = resposta();
    let seguiu = false;
    exigeTermosAceitos({ headers: {}, usuarioAtual } as unknown as Request, r as unknown as Response, (() => { seguiu = true; }) as NextFunction);
    return { r, seguiu };
  };

  it('sem aceite (ou sem usuário carregado) -> 403 TERMOS_NAO_ACEITOS', () => {
    for (const u of [{ termosAceitosEm: null }, {}, undefined]) {
      const { r, seguiu } = rodar(u);
      assert.equal(seguiu, false);
      assert.equal(r.statusCode, 403);
      assert.equal(r.body.codigoErro, 'TERMOS_NAO_ACEITOS');
    }
  });

  it('com aceite segue adiante', () => {
    const { r, seguiu } = rodar({ termosAceitosEm: new Date() });
    assert.equal(seguiu, true);
    assert.equal(r.statusCode, 0);
  });

  it('exigeToken e exigeSessao recusam token ausente antes de olhar os termos', () => {
    for (const mw of [exigeToken, exigeSessao]) {
      const r = resposta();
      mw({ headers: {} } as unknown as Request, r as unknown as Response, (() => assert.fail('não devia seguir')) as NextFunction);
      assert.equal(r.statusCode, 401);
      assert.equal(r.body.codigoErro, 'TOKEN_AUSENTE');
    }
  });
});
