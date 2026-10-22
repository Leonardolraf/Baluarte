// Allowlist da campanha (CAMPANHA_SEM_TRAVA_DOMINIO): toggle do chokepoint destinatarioInterno,
// sem banco. OFF (padrao) mantem a trava de dominio (contrato N2 AT1); ON aceita qualquer dominio.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { destinatarioInterno, travaDeDominioDesligada } from '../../src/models/dominio.model.js';

afterEach(() => {
  delete process.env.CAMPANHA_SEM_TRAVA_DOMINIO;
  delete process.env.DOMINIO_INTERNO;
});

describe('CAMPANHA_SEM_TRAVA_DOMINIO (allowlist)', () => {
  it('OFF por padrão', () => {
    delete process.env.CAMPANHA_SEM_TRAVA_DOMINIO;
    assert.equal(travaDeDominioDesligada(), false);
    assert.equal(destinatarioInterno('alguem@gmail.com'), false);
    assert.equal(destinatarioInterno('alguem@empresa.com'), true); // domínio padrão interno
  });

  it('só "1" liga; outros valores não', () => {
    for (const v of ['0', 'true', 'sim', '', ' 1']) {
      process.env.CAMPANHA_SEM_TRAVA_DOMINIO = v;
      assert.equal(travaDeDominioDesligada(), false, `valor ${JSON.stringify(v)} não deve ligar`);
      assert.equal(destinatarioInterno('alguem@gmail.com'), false);
    }
  });

  it('ON: qualquer domínio passa', () => {
    process.env.CAMPANHA_SEM_TRAVA_DOMINIO = '1';
    assert.equal(travaDeDominioDesligada(), true);
    for (const e of ['x@gmail.com', 'y@outlook.com', 'z@empresa.com', 'w@qualquer.coisa.br']) {
      assert.equal(destinatarioInterno(e), true, `${e} deveria passar com a trava desligada`);
    }
  });

  it('OFF respeita a lista DOMINIO_INTERNO (DT19) como antes', () => {
    process.env.DOMINIO_INTERNO = '@baluarte.test, pessoa@gmail.com';
    assert.equal(destinatarioInterno('alguem@baluarte.test'), true);
    assert.equal(destinatarioInterno('pessoa@gmail.com'), true); // endereço liberado
    assert.equal(destinatarioInterno('outro@gmail.com'), false); // mesmo provedor, não liberado
  });
});
