// #9: formato do codigo de vinculo, hash canonico e estado derivado (sem banco). O consumo
// atomico (uso unico, TTL, trava) e testado pela rota em tests/vinculo-estacao-enroll.test.ts.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALFABETO_CODIGO,
  codigoHash,
  ehCodigoVinculo,
  estadoDoVinculo,
  gerarCodigoVinculo,
  normalizarCodigo,
  ttlVinculoMs,
  TTL_VINCULO_MS_PADRAO,
} from '../../src/models/vinculoEstacao.model.js';
import { hashToken } from '../../src/utils/tokens.js';

afterEach(() => {
  delete process.env.VINCULO_TTL_MS;
});

describe('codigo de vinculo (#9)', () => {
  it('gerarCodigoVinculo: formato BLT-XXXX-XXXX-XXXX, so o alfabeto, sem repetir', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = gerarCodigoVinculo();
      assert.match(c, /^BLT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      assert.ok(ehCodigoVinculo(c), `${c} deveria ser um codigo valido`);
      for (const ch of c.replace(/^BLT-/, '').replace(/-/g, '')) assert.ok(ALFABETO_CODIGO.includes(ch), `char ${ch} fora do alfabeto`);
      vistos.add(c);
    }
    assert.equal(vistos.size, 500, 'os codigos gerados nao devem colidir');
  });

  it('ehCodigoVinculo: aceita o valido (inclusive minusculo), recusa segredo da org e malformados', () => {
    assert.equal(ehCodigoVinculo('BLT-ABCD-EFGH-JKLM'), true);
    assert.equal(ehCodigoVinculo('blt-abcd-efgh-jklm'), true); // normaliza para maiusculas
    assert.equal(ehCodigoVinculo('  BLT-ABCD-EFGH-JKLM  '), true); // apara as bordas
    // Segredo da org (nao comeca com BLT-) e coisas malformadas:
    assert.equal(ehCodigoVinculo('um-segredo-de-org-bem-grande'), false);
    assert.equal(ehCodigoVinculo('BLT-ABCD-EFGH'), false); // grupos de menos
    assert.equal(ehCodigoVinculo('BLT-ABCD-EFGH-JKLM-NPQR'), false); // grupos demais
    assert.equal(ehCodigoVinculo('BLT-ABC-EFGH-JKLM'), false); // grupo curto
    assert.equal(ehCodigoVinculo('BLT-IIII-OOOO-0000'), false); // caracteres ambiguos nao existem no alfabeto
    assert.equal(ehCodigoVinculo('BLT-A1CD-EFGH-JKLM'), false); // 1 nao esta no alfabeto
    assert.equal(ehCodigoVinculo(undefined), false);
    assert.equal(ehCodigoVinculo(12345678), false);
  });

  it('codigoHash: deterministico, canonico (maiusculas/trim), = hashToken do normalizado', () => {
    const c = 'BLT-ABCD-EFGH-JKLM';
    assert.equal(codigoHash(c), hashToken(c));
    assert.equal(codigoHash('  blt-abcd-efgh-jklm '), codigoHash(c)); // mesma forma canonica -> mesmo hash
    assert.notEqual(codigoHash('BLT-ABCD-EFGH-JKLN'), codigoHash(c));
    assert.match(codigoHash(c), /^[0-9a-f]{64}$/);
  });

  it('normalizarCodigo: trim + maiusculas', () => {
    assert.equal(normalizarCodigo('  blt-abcd-efgh-jklm '), 'BLT-ABCD-EFGH-JKLM');
  });

  it('estadoDoVinculo: pendente / consumido / expirado', () => {
    const agora = new Date('2026-10-21T12:00:00Z');
    const futuro = new Date('2026-10-22T12:00:00Z');
    const passado = new Date('2026-10-20T12:00:00Z');
    assert.equal(estadoDoVinculo({ consumidoEm: null, expiraEm: futuro }, agora), 'pendente');
    assert.equal(estadoDoVinculo({ consumidoEm: passado, expiraEm: futuro }, agora), 'consumido'); // consumo vence a expiracao
    assert.equal(estadoDoVinculo({ consumidoEm: null, expiraEm: passado }, agora), 'expirado');
  });

  it('ttlVinculoMs: 24h por padrao; VINCULO_TTL_MS sobrescreve; invalido volta ao padrao', () => {
    assert.equal(ttlVinculoMs(), TTL_VINCULO_MS_PADRAO);
    assert.equal(TTL_VINCULO_MS_PADRAO, 24 * 60 * 60 * 1000);
    process.env.VINCULO_TTL_MS = '60000';
    assert.equal(ttlVinculoMs(), 60000);
    for (const ruim of ['0', '-1', 'abc', '']) {
      process.env.VINCULO_TTL_MS = ruim;
      assert.equal(ttlVinculoMs(), TTL_VINCULO_MS_PADRAO, `"${ruim}" deveria cair no padrao`);
    }
  });
});
