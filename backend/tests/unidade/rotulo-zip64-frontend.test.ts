// DT27: o rotulo do Zip64 mora no backend (ROTULO_ZIP64 e ROTULO_ZIP64_INCOMPLETA, em
// models/analiseArquivo.model.ts) e a tela tem uma copia em baluarte-frontend/src/lib/files.ts
// (mapa UNANALYZABLE_LABEL, uma chave por assinatura Baluarte.Zip64.*). Este teste so LE o
// arquivo do frontend, sem altera-lo, e confere que cada copia e IDENTICA a constante: mudou o
// rotulo de um lado, ele falha ate o outro lado mudar junto (mesmo padrao do
// tests/aviso-monitoramento.test.ts com o mock).
//
// O valor e extraido do literal, nao da linha: o prettier do frontend quebra string longa em
// varias linhas, e a copia pode estar partida em concatenacao ('a' + 'b'). Os espacos em branco
// sao normalizados antes de comparar.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AMEACA_ZIP64,
  AMEACA_ZIP64_INCOMPLETA,
  ROTULO_ZIP64,
  ROTULO_ZIP64_INCOMPLETA,
} from '../../src/models/analiseArquivo.model.js';

const ARQUIVO_FRONTEND = fileURLToPath(new URL('../../../baluarte-frontend/src/lib/files.ts', import.meta.url));
const MAPA = 'UNANALYZABLE_LABEL';

/** Espacos em branco (inclusive quebra de linha) viram um espaco so, sem sobra nas pontas. */
const normalizar = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Le um literal de string ('...', "..." ou `...` sem interpolacao) a partir de `i`. */
function lerLiteral(fonte: string, i: number): { valor: string; fim: number } | null {
  const aspa = fonte[i];
  if (aspa !== "'" && aspa !== '"' && aspa !== '`') return null;
  let valor = '';
  for (let j = i + 1; j < fonte.length; j++) {
    const c = fonte[j];
    if (c === '\\') {
      const seguinte = fonte[j + 1];
      valor += seguinte === 'n' ? '\n' : seguinte === 't' ? '\t' : seguinte;
      j++;
      continue;
    }
    if (aspa === '`' && c === '$' && fonte[j + 1] === '{') throw new Error('rótulo com interpolação: compare à mão');
    if (c === aspa) return { valor, fim: j + 1 };
    if (aspa !== '`' && c === '\n') return null;
    valor += c;
  }
  return null;
}

/**
 * Valores das chaves Baluarte.Zip64.* do objeto `nomeDoMapa` no fonte: cada valor e a
 * sequencia de literais ligados por `+`, em quantas linhas for.
 */
function rotulosZip64DoFonte(fonte: string, nomeDoMapa = MAPA): Map<string, string> {
  const inicio = fonte.indexOf(nomeDoMapa);
  if (inicio < 0) throw new Error(`${nomeDoMapa} não encontrado no files.ts`);
  const abre = fonte.indexOf('{', inicio);
  const fecha = fonte.indexOf('};', abre);
  if (abre < 0 || fecha < 0) throw new Error(`corpo de ${nomeDoMapa} não encontrado`);
  const corpo = fonte.slice(abre + 1, fecha);

  const rotulos = new Map<string, string>();
  const chave = /(['"])(Baluarte\.Zip64\.[^'"]+)\1\s*:/g;
  for (let m = chave.exec(corpo); m; m = chave.exec(corpo)) {
    let i = m.index + m[0].length;
    const partes: string[] = [];
    for (;;) {
      while (/\s/.test(corpo[i] ?? '')) i++;
      const lit = lerLiteral(corpo, i);
      if (!lit) throw new Error(`valor de ${m[2]} não é um literal de string`);
      partes.push(lit.valor);
      i = lit.fim;
      while (/\s/.test(corpo[i] ?? '')) i++;
      if (corpo[i] !== '+') break;
      i++;
    }
    if (rotulos.has(m[2])) throw new Error(`${m[2]} aparece duas vezes`);
    rotulos.set(m[2], normalizar(partes.join('')));
  }
  return rotulos;
}

const ESPERADO = new Map([
  [AMEACA_ZIP64, ROTULO_ZIP64],
  [AMEACA_ZIP64_INCOMPLETA, ROTULO_ZIP64_INCOMPLETA],
]);

/** Confere as copias contra as constantes; lanca AssertionError na primeira diferenca. */
function conferir(rotulos: Map<string, string>) {
  assert.deepEqual([...rotulos.keys()].sort(), [...ESPERADO.keys()].sort(), 'assinaturas Baluarte.Zip64.* do files.ts');
  for (const [assinatura, rotulo] of ESPERADO) {
    assert.equal(rotulos.get(assinatura), normalizar(rotulo), `rótulo de ${assinatura} no files.ts difere do backend`);
  }
}

describe('extração do rótulo do files.ts (o parser tolera a formatação do prettier)', () => {
  const fonte = (valorZip64: string) => `
const ${MAPA}: Record<string, string> = {
  '${AMEACA_ZIP64}':
    ${valorZip64},
  '${AMEACA_ZIP64_INCOMPLETA}':
    '${ROTULO_ZIP64_INCOMPLETA}',
};
`;
  const [antes, depois] = [ROTULO_ZIP64.slice(0, 20), ROTULO_ZIP64.slice(20)];

  it('valor numa linha só passa', () => {
    conferir(rotulosZip64DoFonte(fonte(`'${ROTULO_ZIP64}'`)));
  });

  it('valor quebrado em 2 linhas por concatenação passa', () => {
    conferir(rotulosZip64DoFonte(fonte(`'${antes}' +\n    '${depois}'`)));
  });

  it('valor em template literal quebrado em 2 linhas (espaço normalizado) passa', () => {
    const [a, b] = ROTULO_ZIP64.split(' que ');
    conferir(rotulosZip64DoFonte(fonte(`\`${a}\n      que ${b}\``)));
  });

  it('uma palavra trocada falha', () => {
    const errado = ROTULO_ZIP64.replace('não lê', 'não analisa');
    assert.notEqual(errado, ROTULO_ZIP64);
    assert.throws(() => conferir(rotulosZip64DoFonte(fonte(`'${errado}'`))), assert.AssertionError);
    const [a, b] = [errado.slice(0, 20), errado.slice(20)];
    assert.throws(() => conferir(rotulosZip64DoFonte(fonte(`'${a}' +\n    '${b}'`))), assert.AssertionError);
  });

  it('assinatura faltando ou com outro nome falha', () => {
    const semUma = fonte(`'${ROTULO_ZIP64}'`).replace(`'${AMEACA_ZIP64}'`, "'Baluarte.Zip64.Outro'");
    assert.throws(() => conferir(rotulosZip64DoFonte(semUma)), assert.AssertionError);
  });
});

describe('rótulo do Zip64 no frontend = backend (baluarte-frontend/src/lib/files.ts, só leitura)', () => {
  it('cada assinatura Baluarte.Zip64.* tem no files.ts o texto idêntico a ROTULO_ZIP64 / ROTULO_ZIP64_INCOMPLETA', () => {
    assert.ok(existsSync(ARQUIVO_FRONTEND), `files.ts não encontrado em ${ARQUIVO_FRONTEND}`);
    conferir(rotulosZip64DoFonte(readFileSync(ARQUIVO_FRONTEND, 'utf8')));
  });
});
