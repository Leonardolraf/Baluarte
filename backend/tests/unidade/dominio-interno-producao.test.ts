// Testes de UNIDADE da exigencia de DOMINIO_INTERNO em producao (DT28): sem banco. O padrao
// @empresa.com e o do contrato N2 AT1 e tem dono real; em producao a API recusa subir sem um
// dominio valido e proprio. Fora de producao nada muda (padrao @empresa.com).
// O ultimo bloco sobe o src/server.ts de verdade num processo filho (porta 0, sem banco) para
// conferir que a checagem esta ligada na subida, como a do JWT_SECRET.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { dominioInterno, destinatarioInterno, validarDominioInterno } from '../../src/models/dominio.model.js';

const salvo = { NODE_ENV: process.env.NODE_ENV, DOMINIO_INTERNO: process.env.DOMINIO_INTERNO };
afterEach(() => {
  for (const [k, v] of Object.entries(salvo)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('validarDominioInterno (DT28)', () => {
  it('produção sem a variável (ausente, vazia ou só espaços): recusa', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DOMINIO_INTERNO;
    assert.throws(() => validarDominioInterno(), /DOMINIO_INTERNO é obrigatório em produção/);
    for (const v of ['', '   ', ' , ; ']) {
      process.env.DOMINIO_INTERNO = v;
      assert.throws(() => validarDominioInterno(), /obrigatório/, JSON.stringify(v));
    }
  });

  it('produção com valor inválido (sozinho ou no meio de uma lista válida): recusa', () => {
    process.env.NODE_ENV = 'production';
    for (const v of ['baluarte', '@baluarte', '@@baluarte.test', '@baluarte..test', 'pessoa@gmail', 'pessoa@@gmail.com', '@baluarte.test,@typo', '@-x.com']) {
      process.env.DOMINIO_INTERNO = v;
      assert.throws(() => validarDominioInterno(), /DOMINIO_INTERNO inválido em produção/, v);
    }
  });

  it('produção com @empresa.com (sozinho, na lista, endereço ou subdomínio): recusa como domínio de terceiro', () => {
    process.env.NODE_ENV = 'production';
    for (const v of ['@empresa.com', 'EMPRESA.COM', '@baluarte.test,@empresa.com', 'fulano@empresa.com', '@rh.empresa.com']) {
      process.env.DOMINIO_INTERNO = v;
      assert.throws(() => validarDominioInterno(), /não pode usar @empresa\.com em produção.*terceiro/, v);
    }
  });

  it('produção com domínio válido: sobe e usa o valor da variável', () => {
    process.env.NODE_ENV = 'production';
    process.env.DOMINIO_INTERNO = '@baluarte.test, pessoa@gmail.com, minhaempresa.com.br';
    assert.doesNotThrow(() => validarDominioInterno());
    assert.equal(dominioInterno(), '@baluarte.test');
    assert.ok(destinatarioInterno('ana@baluarte.test'));
    assert.ok(destinatarioInterno('pessoa@gmail.com'));
    assert.ok(destinatarioInterno('rh@minhaempresa.com.br'));
    assert.equal(destinatarioInterno('ana@empresa.com'), false);
  });

  it('dev e teste sem a variável: não recusa e o padrão continua @empresa.com', () => {
    delete process.env.DOMINIO_INTERNO;
    for (const env of ['development', 'test']) {
      process.env.NODE_ENV = env;
      assert.doesNotThrow(() => validarDominioInterno());
      assert.equal(dominioInterno(), '@empresa.com');
      assert.ok(destinatarioInterno('colaborador@empresa.com'));
    }
    delete process.env.NODE_ENV;
    assert.doesNotThrow(() => validarDominioInterno());
  });
});

// Sobe src/server.ts e espera sair (recusa) ou anunciar que está ouvindo (sobe).
function subirServidor(dominio: string): Promise<{ subiu: boolean; codigo: number | null; saida: string }> {
  return new Promise((ok) => {
    const filho = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: resolve(import.meta.dirname, '../..'),
      // DOMINIO_INTERNO vazio (não ausente): o dotenv não sobrescreve variável já definida,
      // então o backend/.env local não interfere.
      env: { ...process.env, NODE_ENV: 'production', PORT: '0', JWT_SECRET: 'segredo-de-producao-do-teste-dt28', DOMINIO_INTERNO: dominio },
    });
    let saida = '';
    const ler = (b: Buffer) => {
      saida += b.toString();
      if (saida.includes('ouvindo')) { filho.kill(); ok({ subiu: true, codigo: null, saida }); }
    };
    filho.stdout.on('data', ler);
    filho.stderr.on('data', ler);
    filho.on('exit', (codigo) => ok({ subiu: false, codigo, saida }));
  });
}

describe('src/server.ts em produção (DT28)', () => {
  it('sem DOMINIO_INTERNO o processo não sobe e o log explica o motivo', async () => {
    const r = await subirServidor('');
    assert.equal(r.subiu, false, r.saida);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /DOMINIO_INTERNO é obrigatório em produção/);
  });

  it('com @empresa.com o processo não sobe', async () => {
    const r = await subirServidor('@empresa.com');
    assert.equal(r.subiu, false, r.saida);
    assert.match(r.saida, /não pode usar @empresa\.com/);
  });

  it('com um domínio válido o processo sobe', async () => {
    const r = await subirServidor('@baluarte.test');
    assert.equal(r.subiu, true, r.saida);
  });
});
