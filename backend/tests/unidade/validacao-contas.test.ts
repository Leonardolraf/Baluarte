// Testes de UNIDADE (sem banco, sem servidor): validacoes de entrada, politica de senha,
// tokens de link, e-mails (conta e campanha) e helpers de conta.
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { emailFormatoValido, hostValido, queryString, textoPreenchido, validarSenha, vazio, POLITICA_SENHA } from '../../src/shared/validacao.js';
import { gerarTokenLink, hashToken } from '../../src/platform/tokens.js';
import { normalizarEmail, mapUsuario } from '../../src/modules/users/repository.js';
import { hashSemSenha, VALIDADE_LINK_MS } from '../../src/modules/auth/links.js';

before(() => {
  process.env.NODE_ENV = 'test';
  process.env.FRONTEND_URL = 'http://localhost:5173/';
});

describe('validação de entrada', () => {
  it('vazio e textoPreenchido', () => {
    for (const v of [undefined, null, '']) assert.equal(vazio(v), true);
    for (const v of [0, false, ' ', 'x']) assert.equal(vazio(v), false);
    assert.equal(textoPreenchido('  nome '), true);
    for (const v of ['   ', 42, true, {}, ['a'], null]) assert.equal(textoPreenchido(v), false);
  });

  it('queryString só deixa passar string (bloqueia ?q[$ne]=x)', () => {
    assert.equal(queryString('critico'), 'critico');
    assert.equal(queryString({ $ne: 'x' }), undefined);
    assert.equal(queryString(['a', 'b']), undefined);
  });

  it('emailFormatoValido', () => {
    assert.ok(emailFormatoValido('ana.souza@empresa.com'));
    for (const v of ['sem-arroba', 'a@b', 'a b@empresa.com', `${'a'.repeat(250)}@empresa.com`, 42, null]) {
      assert.equal(emailFormatoValido(v), false, String(v));
    }
  });

  it('hostValido: IPv4 com octetos de 0 a 255 e nomes de domínio', () => {
    for (const v of ['192.168.0.10', '0.0.0.0', '255.255.255.255', 'api.empresa.com', ' portal.empresa.com ']) assert.ok(hostValido(v), v);
    for (const v of ['256.1.1.1', '10.0.0', 'localhost', '-x.empresa.com', 'empresa..com', '', '   ', 7]) {
      assert.equal(hostValido(v), false, String(v));
    }
  });
});

describe('política de senha', () => {
  it('aceita senha que cumpre a política', () => {
    assert.equal(validarSenha('Forte@123'), null);
  });

  it('recusa cada regra com a mensagem própria', () => {
    assert.match(validarSenha('Ab@1')!, new RegExp(`mínimo ${POLITICA_SENHA.comprimentoMinimo}`));
    assert.match(validarSenha(`Aa1@${'x'.repeat(POLITICA_SENHA.comprimentoMaximo)}`)!, /máximo/);
    assert.match(validarSenha('semmaiuscula1!')!, /maiúsculas e minúsculas/);
    assert.match(validarSenha('SemNumeroSimbolo')!, /número e um símbolo/);
    assert.match(validarSenha(12345678)!, /mínimo/);
  });
});

describe('tokens de link', () => {
  it('gerarTokenLink: 256 bits em hexadecimal, sem repetir', () => {
    const tokens = new Set(Array.from({ length: 200 }, gerarTokenLink));
    assert.equal(tokens.size, 200);
    for (const t of tokens) assert.match(t, /^[0-9a-f]{64}$/);
  });

  it('hashToken: SHA-256 determinístico e diferente do token', () => {
    const t = gerarTokenLink();
    assert.equal(hashToken(t), hashToken(t));
    assert.notEqual(hashToken(t), t);
    assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('helpers de conta', () => {
  it('normalizarEmail: sem espaços e em minúsculas', () => {
    assert.equal(normalizarEmail('  Ana.Souza@Empresa.COM '), 'ana.souza@empresa.com');
    assert.equal(normalizarEmail(undefined), '');
  });

  it('mapUsuario achata o departamento para o nome', () => {
    assert.deepEqual(mapUsuario({ id: '1', department: { name: 'RH' } }), { id: '1', departamento: 'RH' });
    assert.deepEqual(mapUsuario({ id: '2', department: null }), { id: '2', departamento: null });
  });

  it('hashSemSenha: nenhuma senha digitada confere, e cada conta recebe um hash diferente', async () => {
    const [h1, h2] = [await hashSemSenha(), await hashSemSenha()];
    assert.notEqual(h1, h2);
    for (const tentativa of ['', 'Mudar@123', '123@!Teste', 'Admin@123']) {
      assert.equal(await bcrypt.compare(tentativa, h1), false, tentativa);
    }
  });

  it('validade dos links: convite 72 h, redefinição 30 min', () => {
    assert.equal(VALIDADE_LINK_MS.CONVITE, 72 * 3600 * 1000);
    assert.equal(VALIDADE_LINK_MS.RESET, 30 * 60 * 1000);
  });
});
