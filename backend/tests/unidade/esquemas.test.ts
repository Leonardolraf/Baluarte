// Testes de UNIDADE da validacao de entrada com zod (B09): schemas de campo, ordem das
// regras (parte do contrato N2 AT1) e o erro de negocio gerado pela regra que falha.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ErroNegocio } from '../../src/http/resposta.js';
import {
  email, host, notaCvss, opcional, preenchido, problemaDaSenha, regra, senhaNova, texto, textoDeQuery, umDe, validar,
} from '../../src/shared/esquemas.js';

function erroDe(fn: () => unknown): ErroNegocio {
  try {
    fn();
  } catch (e) {
    if (e instanceof ErroNegocio) return e;
    throw e;
  }
  assert.fail('esperava ErroNegocio');
}

describe('validar: regras aplicadas na ordem do contrato', () => {
  // Mesmas regras do login: e-mail vazio -> senha vazia -> formato do e-mail.
  const LOGIN = [
    regra('email', preenchido, 'E-mail é obrigatório', 'EMAIL_OBRIGATORIO'),
    regra('senha', preenchido, 'Senha é obrigatória', 'SENHA_OBRIGATORIA'),
    regra('senha', z.string(), 'Senha é obrigatória', 'SENHA_OBRIGATORIA'),
    regra('email', email, 'Formato de e-mail inválido', 'EMAIL_INVALIDO'),
  ];

  it('a primeira regra que falha decide o erro, mesmo com outros campos errados', () => {
    assert.equal(erroDe(() => validar({}, LOGIN)).codigo, 'EMAIL_OBRIGATORIO');
    // E-mail mal formado E senha ausente: a senha vem antes do formato.
    assert.equal(erroDe(() => validar({ email: 'sem-arroba' }, LOGIN)).codigo, 'SENHA_OBRIGATORIA');
    assert.equal(erroDe(() => validar({ email: 'sem-arroba', senha: 123 }, LOGIN)).codigo, 'SENHA_OBRIGATORIA');
    const e = erroDe(() => validar({ email: 'sem-arroba', senha: 'x' }, LOGIN));
    assert.deepEqual([e.status, e.mensagem, e.codigo], [400, 'Formato de e-mail inválido', 'EMAIL_INVALIDO']);
  });

  it('corpo válido volta inteiro; corpo ausente vira objeto vazio', () => {
    assert.deepEqual(validar({ email: 'a@empresa.com', senha: 'x', extra: 1 }, LOGIN), { email: 'a@empresa.com', senha: 'x', extra: 1 });
    assert.deepEqual(validar(undefined, []), {});
  });

  it('mensagem calculada a partir do valor e status próprio', () => {
    const r = regra('x', z.number(), (v) => `recebi ${String(v)}`, 'X_INVALIDO', 422);
    const e = erroDe(() => validar({ x: 'abc' }, [r]));
    assert.deepEqual([e.status, e.mensagem], [422, 'recebi abc']);
  });

  it('opcional: ausente passa, presente é validado (null não é ausência)', () => {
    const NOME = opcional(regra('nome', texto, 'Nome é obrigatório', 'NOME_OBRIGATORIO'));
    assert.deepEqual(validar({}, [NOME]), {});
    assert.equal(erroDe(() => validar({ nome: '  ' }, [NOME])).codigo, 'NOME_OBRIGATORIO');
    assert.equal(erroDe(() => validar({ nome: null }, [NOME])).codigo, 'NOME_OBRIGATORIO');
  });
});

describe('schemas de campo', () => {
  it('preenchido: só undefined, null e "" falham (0 e false passam)', () => {
    for (const v of [undefined, null, '']) assert.equal(preenchido.safeParse(v).success, false);
    for (const v of [0, false, ' ', 'x', {}]) assert.equal(preenchido.safeParse(v).success, true);
  });

  it('umDe aceita só valores da lista, com o mesmo texto', () => {
    const tipo = umDe(['Servidor', 'Banco de Dados']);
    assert.ok(tipo.safeParse('Banco de Dados').success);
    for (const v of ['servidor', 'Rede', ['Servidor'], 1]) assert.equal(tipo.safeParse(v).success, false);
  });

  it('host: IPv4 válido, domínio, e recusa números sem formato de IPv4', () => {
    for (const v of ['10.0.0.5', ' api.empresa.com ']) assert.ok(host.safeParse(v).success, v);
    for (const v of ['10.0.0', '300.1.1.1', 'localhost', '', 7]) assert.equal(host.safeParse(v).success, false, String(v));
  });

  it('senhaNova e problemaDaSenha concordam em cada regra da política', () => {
    assert.ok(senhaNova.safeParse('Forte@123').success);
    for (const [senha, trecho] of [['Ab@1', 'mínimo'], [`Aa1@${'x'.repeat(70)}`, 'máximo'], ['semmaiuscula1!', 'maiúsculas'], ['SemNumero', 'número']]) {
      assert.equal(senhaNova.safeParse(senha).success, false, senha);
      assert.match(problemaDaSenha(senha), new RegExp(trecho));
    }
  });

  it('notaCvss: 0 a 10, aceita texto numérico; recusa vazio, ausente e fora da faixa', () => {
    for (const v of ['0', '9.8', '10', ['5']]) assert.ok(notaCvss.safeParse(v).success, String(v));
    for (const v of [undefined, '', 'abc', '-1', '10.1', ['1', '2']]) assert.equal(notaCvss.safeParse(v).success, false, String(v));
  });

  it('textoDeQuery: string passa; objeto ou array vira undefined (injeção de operador)', () => {
    assert.equal(textoDeQuery.parse('critico'), 'critico');
    assert.equal(textoDeQuery.parse({ $ne: 'x' }), undefined);
    assert.equal(textoDeQuery.parse(['a']), undefined);
    assert.equal(textoDeQuery.parse(undefined), undefined);
  });
});
